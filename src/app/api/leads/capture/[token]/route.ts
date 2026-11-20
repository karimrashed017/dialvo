import "server-only";
import { MAX_CAPTURE_BYTES, parseCapture } from "@/lib/leads/capture";
import { captureLimit } from "@/lib/leads/rate-limit";
import { createCaptureClient } from "@/lib/supabase/capture";
import { APP_CONFIGURED } from "@/lib/supabase/env";

// The public lead form posts here, from the customer's own website: JSON
// (fetch) or an ordinary HTML form. The token in the address names the form;
// the database function capture_lead() does the write, scoped to the
// workspace that owns that form, and returns nothing about the lead.
//
// There is no session and no cookie on this route. Anyone may post, so:
// the body is small and validated, a hidden field catches simple bots, one
// address gets 10 posts a minute here, and each form has its own limit in
// the database.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
  // Never cached, never indexed.
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

const TOKEN = /^[0-9a-f]{64}$/;

function json(
  body: Record<string, unknown>,
  status = 200,
  extra: HeadersInit = {},
) {
  return Response.json(body, { status, headers: { ...CORS, ...extra } });
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** For visitors whose browser posted a plain form: a page, not JSON. */
function page(title: string, text: string, status: number) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F5F1;color:#0B0B0C;font:16px/1.5 system-ui,sans-serif"><main style="max-width:420px;padding:32px;text-align:center"><h1 style="font-size:24px;font-weight:500;margin:0 0 8px">${escapeHtml(title)}</h1><p style="margin:0;opacity:.65">${escapeHtml(text)}</p></main></body></html>`,
    {
      status,
      headers: { ...CORS, "content-type": "text/html; charset=utf-8" },
    },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

async function readBody(
  request: Request,
): Promise<unknown | "too_large" | "unreadable"> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_CAPTURE_BYTES) return "too_large";
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  try {
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const fields: Record<string, string> = {};
      let size = 0;
      for (const [key, value] of form) {
        if (typeof value !== "string") continue; // no files
        size += key.length + value.length;
        if (size > MAX_CAPTURE_BYTES) return "too_large";
        fields[key] = value;
      }
      return fields;
    }
    const text = await request.text();
    if (text.length > MAX_CAPTURE_BYTES) return "too_large";
    if (type.includes("application/x-www-form-urlencoded"))
      return Object.fromEntries(new URLSearchParams(text));
    // JSON, including "text/plain" bodies that browsers send without a
    // preflight (navigator.sendBeacon, no-cors fetch).
    return JSON.parse(text) as unknown;
  } catch {
    return "unreadable";
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  // A browser navigating from a plain <form> wants a page back.
  const wantsPage =
    !type.includes("json") &&
    (request.headers.get("accept") ?? "").includes("text/html");
  const fail = (
    status: number,
    reason: string,
    message: string,
    extra: Record<string, unknown> = {},
    headers: HeadersInit = {},
  ) =>
    wantsPage
      ? page("That didn't go through", message, status)
      : json({ ok: false, reason, message, ...extra }, status, headers);

  if (!APP_CONFIGURED)
    return fail(503, "not_configured", "This form isn't switched on yet.");
  if (!TOKEN.test(token))
    return fail(404, "unknown_form", "This form doesn't exist.");

  const body = await readBody(request);
  if (body === "too_large")
    return fail(413, "too_large", "That's too much to send in one go.");
  if (body === "unreadable")
    return fail(400, "invalid", "Send JSON or a form post.", { field: "body" });

  const parsed = parseCapture(body);
  if (!parsed.ok)
    return fail(400, "invalid", parsed.problem, { field: parsed.field });

  const done = (redirect: string | null) => {
    if (!wantsPage) return json({ ok: true });
    if (redirect)
      return new Response(null, {
        status: 303,
        headers: { ...CORS, Location: redirect },
      });
    return page(
      "Thank you",
      "We've got your details and will be in touch.",
      200,
    );
  };

  // Bots that fill in the hidden field are told it worked.
  if (parsed.bot) return done(null);

  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const wait = captureLimit.take(ip);
  if (wait > 0)
    return fail(
      429,
      "limited",
      "Too many submissions. Please try again in a minute.",
      {},
      {
        "Retry-After": String(wait),
      },
    );

  const { name, email, phone, company, website, message, consent } =
    parsed.lead;
  const { data, error } = await createCaptureClient().rpc("capture_lead", {
    p_token: token,
    p_lead: { name, email, phone, company, website, message, consent },
  });
  if (error) {
    if (error.code === "DV429")
      return fail(
        429,
        "limited",
        "This form is very busy. Please try again in a minute.",
        {},
        {
          "Retry-After": "60",
        },
      );
    if (error.code === "22023")
      return fail(400, "invalid", "Please check the form and try again.");
    console.error(
      "[capture] could not save a lead:",
      error.code,
      error.message,
    );
    return fail(
      502,
      "unavailable",
      "We couldn't save that just now. Please try again.",
    );
  }
  if (!data) return fail(404, "unknown_form", "This form doesn't exist.");
  const redirect = (data as { redirect_url?: string | null }).redirect_url;
  return done(
    typeof redirect === "string" && /^https?:\/\//.test(redirect)
      ? redirect
      : null,
  );
}
