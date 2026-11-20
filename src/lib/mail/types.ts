import type { Provider } from "./presets";

// What the app reads about sending, as the signed-in person sees it.

export type MailboxStatus = "active" | "paused" | "disconnected";

export type Mailbox = {
  id: string;
  provider: Provider;
  email: string;
  sender_name: string;
  username: string;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "tls" | "starttls";
  imap_host: string;
  imap_port: number;
  daily_limit: number;
  status: MailboxStatus;
  pause_reason: string | null;
  last_error: string | null;
  connected_at: string;
  last_sent_at: string | null;
  last_polled_at: string | null;
};

export type SendingSettings = {
  business_name: string;
  postal_address: string;
  allowed_confirmed_at: string | null;
  booking_url: string | null;
  followups_enabled: boolean;
  followup_1_days: number;
  followup_2_days: number;
  reply_mode: "approve_first" | "auto";
  sending_on: boolean;
};

export const NO_SETTINGS: SendingSettings = {
  business_name: "",
  postal_address: "",
  allowed_confirmed_at: null,
  booking_url: null,
  followups_enabled: true,
  followup_1_days: 3,
  followup_2_days: 7,
  reply_mode: "approve_first",
  sending_on: false,
};

/** The sender's details every email must carry. */
export function senderDetailsReady(s: SendingSettings): boolean {
  return Boolean(
    s.business_name.trim() && s.postal_address.trim() && s.allowed_confirmed_at,
  );
}

export type EmailStatus =
  | "writing"
  | "draft"
  | "queued"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "needs_check"
  | "cancelled";

export type OutboundEmail = {
  id: string;
  lead_id: string;
  prospect_id: string | null;
  draft_id: string | null;
  thread_id: string | null;
  mailbox_id: string | null;
  kind: "first" | "followup" | "reply";
  step: number;
  written_by: "agent" | "user";
  to_email: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  error: string | null;
  cancel_reason: string | null;
  bounced_at: string | null;
  created_at: string;
};

export type ThreadStatus =
  "active" | "replied" | "bounced" | "unsubscribed" | "stopped" | "finished";

export type MailThread = {
  id: string;
  lead_id: string;
  conversation_id: string;
  mailbox_id: string;
  to_email: string;
  subject: string;
  status: ThreadStatus;
  stop_reason: string | null;
  followups_sent: number;
  next_followup_at: string | null;
  last_reply_at: string | null;
  reply_class: ReplyClass | null;
};

export const REPLY_CLASSES = [
  "interested",
  "question",
  "not_now",
  "not_interested",
  "wrong_person",
  "unsubscribe",
  "unclear",
] as const;
export type ReplyClass = (typeof REPLY_CLASSES)[number];

export const REPLY_CLASS_LABEL: Record<ReplyClass, string> = {
  interested: "Interested",
  question: "Asked a question",
  not_now: "Not now",
  not_interested: "Not interested",
  wrong_person: "Wrong person",
  unsubscribe: "Asked to stop",
  unclear: "Needs reading",
};
