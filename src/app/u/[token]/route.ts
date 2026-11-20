import "server-only";
import { createLimiter } from "@/lib/leads/rate-limit";
import { createCaptureClient } from "@/lib/supabase/capture";
import { APP_CONFIGURED } from "@/lib/supabase/env";

// The unsubscribe link in every email Dialvo sends for a customer:
//   https://trydialvo.com/u/<token>
//
// No login. The token is the email's id with a signature made in the
// database, so it can't be guessed or made up for another email.
//
//   GET   a small page asking "stop emails from <business>?" with one
//         button. Looking at the page changes nothing, because mail
//         scanners and link previews open links on their own.
//   POST  unsubscribes. This is what the button does, and what a mail
//         app's own "Unsubscribe" button does (RFC 8058 one-click: the
//         List-Unsubscribe-Post header in the email points here).
//
// Unsubscribing adds the address to the workspace's never-contact list,
// marks the lead do not contact and cancels anything waiting to go to it.

const TOKEN = /^[0-9a-f-]{36}\.[0-9a-f]{64}$/;
const limit = createLimiter({ windowMs: 60_000, max: 30 });

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, text: string, status = 200, form = false) {
  const button = form
    ? `<form method="post" style="margin:20px 0 0"><button type="submit" style="font:inherit;font-weight:500;color:#fff;background:#0B0B0C;border:0;border-radius:999px;padding:11px 22px;cursor:pointer">Unsubscribe</button></form>`
    : "";
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F5F1;color:#0B0B0C;font:16px/1.5 system-ui,sans-serif"><main style="max-width:440px;padding:32px;text-align:center"><h1 style="font-size:24px;font-weight:500;margin:0 0 8px">${escapeHtml(title)}</h1><p style="margin:0;opacity:.7">${escapeHtml(text)}</p>${button}</main></body></html>`,
    { status, headers: HEADERS },
  );
}

const notFound = () =>
  page(
    "This link doesn't work",
    "It may be incomplete. To stop the emails, reply to one of them with the word unsubscribe.",
    404,
  );

type Answer = { status: "invalid" | "ok" | "done"; business?: string };

async function ask(
  request: Request,
  token: string,
  confirm: boolean,
): Promise<Answer | "limited" | "down"> {
  if (!TOKEN.test(token)) return { status: "invalid" };
  if (!APP_CONFIGURED) return "down";
  const who = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "?";
  if (limit.take(who) > 0) return "limited";
  const { data, error } = await createCaptureClient().rpc("mail_unsubscribe", {
    p_token: token,
    p_confirm: confirm,
  });
  if (error) {
    console.error("[mail] unsubscribe failed:", error.code);
    return "down";
  }
  return (data as Answer | null) ?? { status: "invalid" };
}

const trouble = (answer: "limited" | "down") =>
  answer === "limited"
    ? page("Please try again in a minute", "Too many requests just now.", 429)
    : page(
        "That didn't work",
        "Please try again in a moment, or reply to the email with the word unsubscribe.",
        503,
      );

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const answer = await ask(request, (await params).token, false);
  if (typeof answer === "string") return trouble(answer);
  if (answer.status === "invalid") return notFound();
  return page(
    `Stop emails from ${answer.business}?`,
    "Press the button and you won't be emailed by them again.",
    200,
    true,
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const answer = await ask(request, (await params).token, true);
  if (typeof answer === "string") return trouble(answer);
  if (answer.status === "invalid") return notFound();
  return page(
    "You're unsubscribed",
    `${answer.business} won't email you again. Nothing else is needed.`,
  );
}
