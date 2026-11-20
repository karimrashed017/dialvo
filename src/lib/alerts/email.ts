import { SITE_URL } from "@/lib/site";

// The emails Dialvo sends to a workspace's own team about its website
// chats. They go through Resend's HTTP API with a plain fetch. Nothing in
// this file ever writes to a lead or a visitor.

export const ALERT_FROM = "Dialvo <contact@trydialvo.com>";
const RESEND_URL = "https://api.resend.com/emails";
/** Resend accepts up to 50 addresses in one email. */
export const MAX_RECIPIENTS = 50;

export const ALERT_KINDS = [
  "qualified",
  "needs_human",
  "draft_waiting",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/**
 * Whether this server can send alerts: it needs the Resend key to send and
 * the Supabase secret key to read who to send to. Without either, alerts
 * are skipped silently and Settings says they aren't switched on yet.
 */
export function alertEmailStatus(
  env: Record<string, string | undefined> = process.env,
): { on: boolean; missing: string[] } {
  const missing = ["RESEND_API_KEY", "SUPABASE_SECRET_KEY"].filter(
    (name) => !env[name],
  );
  return { on: missing.length === 0, missing };
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** One line, no control characters: safe in a subject. */
const oneLine = (text: string, max: number) =>
  text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const HEADLINE: Record<AlertKind, string> = {
  qualified: "A lead was qualified in your website chat",
  needs_human: "A website chat needs a person",
  draft_waiting: "A draft reply is waiting for your approval",
};

const NEXT: Record<AlertKind, string> = {
  qualified: "Open the conversation to follow up.",
  needs_human:
    "Open the conversation to reply. The visitor has been told a team member will answer.",
  draft_waiting:
    "Open the conversation to approve, edit or discard it. Nothing is sent to the visitor until you do.",
};

export type AlertEmail = { subject: string; text: string; html: string };

/**
 * A short summary and a link to the conversation. The lead's name and the
 * summary come from a visitor's chat, so both are treated as plain text.
 */
export function buildAlertEmail(alert: {
  kind: AlertKind;
  workspace: string;
  lead: string;
  summary: string;
  conversationId: string;
}): AlertEmail {
  const workspace = oneLine(alert.workspace, 120);
  const lead = oneLine(alert.lead, 80);
  const named = lead && lead !== "Website visitor" ? lead : "";
  const summary = alert.summary.replace(/\s+/g, " ").trim().slice(0, 600);
  const link = `${SITE_URL}/app/inbox?c=${encodeURIComponent(alert.conversationId)}`;
  const settings = `${SITE_URL}/app/settings#alerts`;
  const headline = HEADLINE[alert.kind];
  const subject = oneLine(
    `${headline}${named ? `: ${named}` : ""} (${workspace})`,
    200,
  );
  const why = `You get these because email alerts are on for you in ${workspace} on Dialvo. Turn them off in Settings: ${settings}`;
  const text = [
    `${headline}.`,
    named && `Lead: ${named}`,
    summary,
    NEXT[alert.kind],
    link,
    why,
  ]
    .filter(Boolean)
    .join("\n\n");
  const p =
    'style="margin:0 0 14px;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0B0B0C"';
  const html = [
    `<div style="max-width:520px;margin:0 auto;padding:24px 16px">`,
    `<p ${p}><strong>${escapeHtml(headline)}.</strong></p>`,
    named ? `<p ${p}>Lead: ${escapeHtml(named)}</p>` : "",
    summary ? `<p ${p}>${escapeHtml(summary)}</p>` : "",
    `<p ${p}>${escapeHtml(NEXT[alert.kind])}</p>`,
    `<p ${p}><a href="${escapeHtml(link)}" style="display:inline-block;background:#0B0B0C;color:#ffffff;text-decoration:none;border-radius:999px;padding:10px 18px;font-weight:600">Open the conversation</a></p>`,
    `<p style="margin:24px 0 0;font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6b6b6d">You get these because email alerts are on for you in ${escapeHtml(workspace)} on Dialvo. <a href="${escapeHtml(settings)}" style="color:#6b6b6d">Turn them off in Settings</a>.</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}

export type SendDeps = {
  fetch: typeof fetch;
  apiKey: string | undefined;
};

/**
 * Sends one email through Resend. Never throws: false means it didn't go.
 * `idempotencyKey` makes a repeated call for the same alert send once.
 */
export async function sendEmail(
  email: AlertEmail & { to: string[]; idempotencyKey?: string },
  deps: Partial<SendDeps> = {},
): Promise<boolean> {
  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY;
  const send = deps.fetch ?? fetch;
  const to = email.to.slice(0, MAX_RECIPIENTS);
  if (!apiKey || to.length === 0) return false;
  try {
    const response = await send(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(email.idempotencyKey
          ? { "idempotency-key": email.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        from: ALERT_FROM,
        to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      console.error("[alerts] the email provider answered", response.status);
    return response.ok;
  } catch (error) {
    console.error("[alerts] could not send:", (error as Error).name);
    return false;
  }
}
