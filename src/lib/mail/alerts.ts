import "server-only";
import { sendEmail, type AlertEmail, type SendDeps } from "@/lib/alerts/email";
import { SITE_URL } from "@/lib/site";
import type { MailStore } from "./store";

// Emails to a workspace's own team about its outbound email: a lead
// replied and sounds interested, or a mailbox was paused. They go through
// the same sender as the website chat's alerts (Resend), to the members
// who have alerts on, within the same hourly cap (20 per workspace, in the
// database). Nothing here ever writes to a lead.

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const oneLine = (text: string, max: number) =>
  text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export type MailAlertKind = "reply_interested" | "mailbox_paused";

const COPY: Record<
  MailAlertKind,
  { headline: string; next: string; button: string }
> = {
  reply_interested: {
    headline: "A lead replied to your email and sounds interested",
    next: "Open the conversation to read the reply and answer it.",
    button: "Open the conversation",
  },
  mailbox_paused: {
    headline: "Dialvo paused one of your mailboxes",
    next: "Open Mailboxes, connect it again with a new app password, then resume it. Emails waiting for that mailbox are held until you do.",
    button: "Open Mailboxes",
  },
};

/**
 * A short summary and a link. The lead's name and the summary come from an
 * email someone outside wrote, so both are treated as plain text.
 */
export function buildMailAlert(alert: {
  kind: MailAlertKind;
  workspace: string;
  lead: string;
  summary: string;
  conversationId: string | null;
}): AlertEmail {
  const copy = COPY[alert.kind];
  const workspace = oneLine(alert.workspace, 120);
  const lead = oneLine(alert.lead, 80);
  const summary = alert.summary.replace(/\s+/g, " ").trim().slice(0, 600);
  const link =
    alert.kind === "reply_interested" && alert.conversationId
      ? `${SITE_URL}/app/inbox?c=${encodeURIComponent(alert.conversationId)}`
      : `${SITE_URL}/app/settings/mailboxes`;
  const settings = `${SITE_URL}/app/settings#alerts`;
  const subject = oneLine(
    `${copy.headline}${lead ? `: ${lead}` : ""} (${workspace})`,
    200,
  );
  const why = `You get these because email alerts are on for you in ${workspace} on Dialvo. Turn them off in Settings: ${settings}`;
  const text = [
    `${copy.headline}.`,
    lead && `Lead: ${lead}`,
    summary,
    copy.next,
    link,
    why,
  ]
    .filter(Boolean)
    .join("\n\n");
  const p =
    'style="margin:0 0 14px;font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0B0B0C"';
  const html = [
    `<div style="max-width:520px;margin:0 auto;padding:24px 16px">`,
    `<p ${p}><strong>${escapeHtml(copy.headline)}.</strong></p>`,
    lead ? `<p ${p}>Lead: ${escapeHtml(lead)}</p>` : "",
    summary ? `<p ${p}>${escapeHtml(summary)}</p>` : "",
    `<p ${p}>${escapeHtml(copy.next)}</p>`,
    `<p ${p}><a href="${escapeHtml(link)}" style="display:inline-block;background:#0B0B0C;color:#ffffff;text-decoration:none;border-radius:999px;padding:10px 18px;font-weight:600">${escapeHtml(copy.button)}</a></p>`,
    `<p style="margin:24px 0 0;font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6b6b6d">You get these because email alerts are on for you in ${escapeHtml(workspace)} on Dialvo. <a href="${escapeHtml(settings)}" style="color:#6b6b6d">Turn them off in Settings</a>.</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}

const isKind = (kind: string): kind is MailAlertKind =>
  kind === "reply_interested" || kind === "mailbox_paused";

/** Never throws: an alert that can't be sent must not disturb a step. */
export async function sendMailAlerts(
  store: MailStore,
  send: Partial<SendDeps> = {},
): Promise<number> {
  let sent = 0;
  try {
    for (const workspaceId of await store.alertWorkList()) {
      const claimed = await store.claimAlerts(workspaceId);
      if (!claimed) continue;
      for (const alert of claimed.alerts) {
        const ok =
          isKind(alert.kind) &&
          (await sendEmail(
            {
              ...buildMailAlert({
                kind: alert.kind,
                workspace: claimed.workspace,
                lead: alert.lead,
                summary: alert.summary,
                conversationId: alert.conversation_id,
              }),
              to: claimed.recipients,
              idempotencyKey: `dialvo-alert-${alert.id}`,
            },
            send,
          ));
        await store.finishAlert(
          alert.id,
          ok,
          ok ? claimed.recipients.length : 0,
        );
        if (ok) sent += 1;
      }
    }
  } catch (error) {
    console.error("[mail] alerts failed:", (error as Error).message);
  }
  return sent;
}
