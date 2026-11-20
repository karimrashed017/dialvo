import "server-only";
import { startOfDayInTz } from "@/lib/app/time";
import type { Supabase } from "@/lib/supabase/server";
import {
  NO_SETTINGS,
  type Mailbox,
  type MailThread,
  type OutboundEmail,
  type ReplyClass,
  type SendingSettings,
} from "./types";

// What the app's pages read about sending, as the signed-in person:
// row-level security applies to every query, and each one names the
// workspace too. A mailbox's password is not in any table read here.

function rows<T>(result: {
  data: unknown;
  error: { message: string } | null;
}): T[] {
  if (result.error)
    throw new Error(`Database read failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

const MAILBOX_COLUMNS =
  "id, provider, email, sender_name, username, smtp_host, smtp_port, smtp_security, imap_host, imap_port, daily_limit, status, pause_reason, last_error, connected_at, last_sent_at, last_polled_at";
const EMAIL_COLUMNS =
  "id, lead_id, prospect_id, draft_id, thread_id, mailbox_id, kind, step, written_by, to_email, subject, body, status, scheduled_at, sent_at, error, cancel_reason, bounced_at, created_at";
const THREAD_COLUMNS =
  "id, lead_id, conversation_id, mailbox_id, to_email, subject, status, stop_reason, followups_sent, next_followup_at, last_reply_at, reply_class";

export type EmailWithLead = OutboundEmail & {
  lead: { id: string; name: string; company: string | null } | null;
};

export type SendingSummary = {
  sent: number;
  replies: number;
  positive: number;
  bounces: number;
  unsubscribes: number;
};

export function mailReads(supabase: Supabase, workspaceId: string) {
  const from = (table: string) => supabase.from(table);
  return {
    /** Connected and paused mailboxes, oldest first. */
    async mailboxes() {
      return rows<Mailbox>(
        await from("mailboxes")
          .select(MAILBOX_COLUMNS)
          .eq("workspace_id", workspaceId)
          .neq("status", "disconnected")
          .order("created_at"),
      );
    },
    async settings(): Promise<SendingSettings> {
      const [row] = rows<SendingSettings>(
        await from("workspace_sending")
          .select(
            "business_name, postal_address, allowed_confirmed_at, booking_url, followups_enabled, followup_1_days, followup_2_days, reply_mode, sending_on",
          )
          .eq("workspace_id", workspaceId),
      );
      return row ?? NO_SETTINGS;
    },
    /** The latest emails, whatever their state, newest first. */
    async emails() {
      return rows<EmailWithLead>(
        await from("outbound_emails")
          .select(`${EMAIL_COLUMNS}, lead:leads(id, name, company)`)
          .eq("workspace_id", workspaceId)
          .neq("status", "cancelled")
          .order("created_at", { ascending: false })
          .limit(400),
      );
    },
    async threads() {
      return rows<MailThread>(
        await from("mail_threads")
          .select(THREAD_COLUMNS)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(400),
      );
    },
    /** The email thread behind one Inbox conversation, with what is pending. */
    async conversation(conversationId: string) {
      const [thread] = rows<MailThread>(
        await from("mail_threads")
          .select(THREAD_COLUMNS)
          .eq("workspace_id", workspaceId)
          .eq("conversation_id", conversationId),
      );
      if (!thread) return null;
      const [pending, mailbox, summary] = await Promise.all([
        from("outbound_emails")
          .select(EMAIL_COLUMNS)
          .eq("workspace_id", workspaceId)
          .eq("thread_id", thread.id)
          .in("status", [
            "writing",
            "draft",
            "queued",
            "scheduled",
            "sending",
            "failed",
            "needs_check",
          ])
          .order("created_at"),
        from("mailboxes")
          .select("id, email, sender_name, status")
          .eq("workspace_id", workspaceId)
          .eq("id", thread.mailbox_id),
        from("mail_received")
          .select("classification, class_summary, kind, received_at")
          .eq("workspace_id", workspaceId)
          .eq("thread_id", thread.id)
          .eq("kind", "reply")
          .order("received_at", { ascending: false })
          .limit(1),
      ]);
      return {
        thread,
        pending: rows<OutboundEmail>(pending),
        mailbox:
          rows<Pick<Mailbox, "id" | "email" | "sender_name" | "status">>(
            mailbox,
          )[0] ?? null,
        latest:
          rows<{
            classification: ReplyClass | null;
            class_summary: string | null;
          }>(summary)[0] ?? null,
      };
    },
    /** Today's numbers, in the workspace's own day. */
    async summary(timeZone: string): Promise<SendingSummary> {
      const since = startOfDayInTz(new Date(), timeZone).toISOString();
      const count = async (
        table: string,
        filter: (q: ReturnType<typeof from>) => unknown,
      ) => {
        const query = from(table)
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId);
        const result = (await filter(query as never)) as {
          count: number | null;
          error: { message: string } | null;
        };
        if (result.error)
          throw new Error(`Database read failed: ${result.error.message}`);
        return result.count ?? 0;
      };
      type Q = {
        eq(c: string, v: unknown): Q;
        gte(c: string, v: unknown): Q;
        in(c: string, v: unknown[]): Q;
      };
      const [sent, replies, positive, bounces, unsubscribes] =
        await Promise.all([
          count("outbound_emails", (q) =>
            (q as unknown as Q).eq("status", "sent").gte("sent_at", since),
          ),
          count("mail_received", (q) =>
            (q as unknown as Q).eq("kind", "reply").gte("received_at", since),
          ),
          count("mail_received", (q) =>
            (q as unknown as Q)
              .eq("kind", "reply")
              .eq("classification", "interested")
              .gte("received_at", since),
          ),
          count("mail_received", (q) =>
            (q as unknown as Q).eq("kind", "bounce").gte("received_at", since),
          ),
          count("mail_threads", (q) =>
            (q as unknown as Q)
              .eq("status", "unsubscribed")
              .gte("updated_at", since),
          ),
        ]);
      return { sent, replies, positive, bounces, unsubscribes };
    },
  };
}
