import { SITE_URL } from "@/lib/site";

// What Dialvo posts to a workspace's Slack channel, in Slack's own markup
// (mrkdwn), and the one shape of URL it accepts. Pure.
//
// Text that came from outside (a lead's name, a summary, a play's name) is
// escaped the way Slack asks (&, <, >), so it can't become a link or a
// mention. Every post links back to the right page of the app; nothing can
// be approved from Slack (see docs/app-setup.md: approving needs a signed-in
// person in the app).

export const SLACK_EVENTS = [
  "hot_reply",
  "needs_human",
  "meeting_booked",
  "approvals_digest",
  "play_finished",
] as const;
export type SlackEvent = (typeof SLACK_EVENTS)[number];

export const SLACK_EVENT_LABEL: Record<SlackEvent, string> = {
  hot_reply: "Someone replies interested",
  needs_human: "A chat needs a person",
  meeting_booked: "A meeting is booked",
  approvals_digest: "Daily: what waits for your approval",
  play_finished: "A play has finished",
};

const SLACK_URL =
  /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{10,200}$/;

/** A Slack incoming-webhook URL, or null. */
export function readSlackUrl(value: unknown): string | null {
  const url = typeof value === "string" ? value.trim() : "";
  return SLACK_URL.test(url) ? url : null;
}

/** Slack's escaping for text in a message. */
export const slackText = (text: unknown, max = 300) =>
  String(text ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, max)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const link = (path: string, label: string, base = SITE_URL) =>
  `<${base}${path}|${label}>`;

type Lead = { id?: string; name?: string; email?: string; company?: string };

function who(lead: Lead | null | undefined): string {
  if (!lead) return "Someone";
  const name = (lead.name ?? "").trim();
  const shown =
    name && name !== "Website visitor"
      ? name
      : (lead.email ?? "").trim() || "A website visitor";
  return slackText(lead.company ? `${shown} (${lead.company})` : shown, 160);
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The text of one post. Null for an event Slack doesn't get. */
export function slackMessage(
  event: string,
  payload: Record<string, unknown>,
  workspace: string,
  base = SITE_URL,
): string | null {
  const ws = slackText(workspace, 80);
  const lead = payload.lead as Lead | null | undefined;
  const summary = slackText(payload.summary, 500);
  const conv =
    typeof payload.conversation_id === "string"
      ? `/app/inbox?c=${payload.conversation_id}`
      : "/app/inbox";
  switch (event) {
    case "hot_reply":
      return [
        `*Hot reply* in ${ws}: ${who(lead)} wants to talk.`,
        summary && `> ${summary}`,
        link(conv, "Open in Dialvo", base),
      ]
        .filter(Boolean)
        .join("\n");
    case "needs_human":
      return [
        `*A chat needs a person* in ${ws}: ${who(lead)}.`,
        summary && `> ${summary}`,
        link(conv, "Answer in Dialvo", base),
      ]
        .filter(Boolean)
        .join("\n");
    case "meeting_booked": {
      const at =
        typeof payload.starts_at === "string"
          ? new Date(payload.starts_at)
          : null;
      const when =
        at && !Number.isNaN(at.getTime())
          ? ` for ${at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`
          : "";
      const title = slackText(payload.title, 120);
      return [
        `*Meeting booked* in ${ws}: ${who(lead)}${when}.`,
        title && `> ${title}`,
        link(
          typeof payload.lead_id === "string"
            ? `/app/leads/${payload.lead_id}`
            : "/app/leads",
          "Open the lead",
          base,
        ),
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "approvals_digest": {
      const first = Number(payload.first_emails ?? 0);
      const replies = Number(payload.replies ?? 0);
      const chat = Number(payload.chat ?? 0);
      const parts = [
        first > 0 && plural(first, "first email", "first emails"),
        replies > 0 && plural(replies, "reply", "replies"),
        chat > 0 && plural(chat, "chat answer", "chat answers"),
      ].filter(Boolean);
      if (parts.length === 0) return null;
      return [
        `*Waiting for your approval* in ${ws}: ${parts.join(", ")}.`,
        "Nothing is sent until someone approves it in Dialvo.",
        link("/app", "Review them", base),
      ].join("\n");
    }
    case "play_finished": {
      const drafts = Number(payload.drafts ?? 0);
      return [
        `*Play finished* in ${ws}: ${slackText(payload.name, 120)}.`,
        `${plural(Number(payload.targets ?? 0), "lead or company", "leads or companies")} worked through, ${plural(drafts, "email", "emails")} written.`,
        link("/app/plays", "Open Plays", base),
      ].join("\n");
    }
    case "test":
      return `Dialvo is connected to this channel for ${ws}. Alerts you choose in Settings, Slack, will appear here.`;
    default:
      return null;
  }
}

/** Whether Slack's answer means the URL will never work again. */
export function slackRevoked(status: number | null, body: string): boolean {
  return (
    status === 404 ||
    status === 410 ||
    (status === 403 &&
      /invalid_token|action_prohibited|channel_is_archived|no_service/.test(
        body,
      )) ||
    /no_service|channel_not_found|channel_is_archived|invalid_token/.test(body)
  );
}
