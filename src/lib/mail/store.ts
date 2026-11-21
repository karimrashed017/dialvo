import "server-only";
import { DAILY_SPEND_CAP_MICROS } from "@/lib/prospects/config";
import { createServiceClient } from "@/lib/supabase/service";
import type { ClaimedEmail } from "./compose";
import {
  AUTH_FAILURES_BEFORE_PAUSE,
  DAILY_MAIL_WRITE_CAP,
  HEALTH_BOUNCE_PCT,
  HEALTH_MIN_BOUNCES,
  HEALTH_MIN_STOPS,
  HEALTH_STOP_PCT,
  HEALTH_WINDOW_DAYS,
  IMAP_POLL_INTERVAL_SECONDS,
  IMAP_POLL_LEASE_SECONDS,
  MAILBOXES_PER_POLL_STEP,
  PLAN_PER_STEP,
  RAMP_START,
  RAMP_STEP,
  SENDS_PER_STEP,
  STALE_SENDING_SECONDS,
  WORKSPACE_DAILY_SEND_CAP,
  WRITE_MAX_ATTEMPTS,
  WRITES_PER_STEP,
} from "./config";
import type { ImapSettings, PollCursor } from "./imap";
import type { InboundMessage } from "./inbound";
import type { ReadReply } from "./model";
import type { FollowupItem, ReplyItem, WriteContext } from "./prompt";
import type { Plan, PlanMailbox, Waiting } from "./schedule";
import type { SmtpSettings } from "./smtp";

// The mail steps' database calls, made with the secret key. Each one is a
// function in the database that takes the workspace's id and touches that
// workspace only. The limits from config.ts are passed in here and nowhere
// else.

/** A mailbox's settings with its password. Server only; never logged. */
export type MailboxSecret = SmtpSettings &
  ImapSettings & { id: string; email: string; sender_name: string };

export type ScheduleContext = {
  on: boolean;
  timezone: string;
  window: unknown;
  sent_today: number;
  mailboxes: PlanMailbox[];
  waiting: Waiting[];
};

export type PollTarget = PollCursor & {
  mailbox_id: string;
  workspace_id: string;
};

export type WriteClaim = {
  capped: boolean;
  context: WriteContext;
  replies: ReplyItem[];
  followups: FollowupItem[];
};

export type MailAlerts = {
  workspace: string;
  recipients: string[];
  alerts: {
    id: string;
    kind: string;
    summary: string;
    conversation_id: string | null;
    /** The lead, for an alert about a lead rather than a conversation. */
    lead_id?: string | null;
    lead: string;
    /** Who this one goes to (a personal alert goes to one person only). */
    to?: string[];
  }[];
};

/** The database, as the mail steps need it. Faked in the unit tests. */
export interface MailStore {
  cronTokenOk(token: string): Promise<boolean>;
  workList(): Promise<string[]>;
  writeWorkList(): Promise<string[]>;
  alertWorkList(): Promise<string[]>;
  mailboxSecret(
    workspaceId: string,
    mailboxId: string,
  ): Promise<MailboxSecret | null>;
  mailboxResult(
    workspaceId: string,
    mailboxId: string,
    outcome: "ok" | "auth_failed" | "error",
    error?: string,
  ): Promise<{ paused: boolean; newly_paused: boolean }>;
  scheduleContext(workspaceId: string): Promise<ScheduleContext | null>;
  scheduleCommit(workspaceId: string, plans: Plan[]): Promise<number>;
  sendClaim(workspaceId: string): Promise<ClaimedEmail[]>;
  sendResult(
    workspaceId: string,
    emailId: string,
    outcome: "sent" | "retry" | "failed" | "unknown",
    o?: { error?: string; retryAt?: Date; maxAttempts?: number },
  ): Promise<string>;
  pollClaim(): Promise<PollTarget[]>;
  pollDone(
    target: PollTarget,
    result: { ok: true; uidvalidity: number; last_uid: number } | { ok: false },
  ): Promise<void>;
  inboundCommit(
    workspaceId: string,
    mailboxId: string,
    message: InboundMessage,
  ): Promise<string>;
  writeClaim(workspaceId: string): Promise<WriteClaim | null>;
  followupSave(
    workspaceId: string,
    emailId: string,
    written: { body: string; model: string } | null,
    costMicros: number,
  ): Promise<string>;
  replyCommit(
    workspaceId: string,
    receivedId: string,
    result: ReadReply | null,
    costMicros: number,
  ): Promise<string>;
  claimAlerts(workspaceId: string): Promise<MailAlerts | null>;
  /**
   * Pauses the workspace's mailboxes whose bounces or stop requests are over
   * the limits in config.ts. Returns how many were paused.
   */
  healthCheck(workspaceId: string): Promise<number>;
  finishAlert(
    alertId: string,
    sent: boolean,
    recipients: number,
  ): Promise<void>;
}

/** Null when the server has no secret key. */
export function createMailStore(): MailStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const rpc = async <T>(name: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  };
  return {
    cronTokenOk: (token) =>
      rpc<boolean>("mail_cron_token_ok", { p_token: token }),
    workList: () => rpc<string[]>("mail_work_list"),
    writeWorkList: () => rpc<string[]>("mail_write_work_list"),
    alertWorkList: () => rpc<string[]>("mail_alert_work_list"),
    mailboxSecret: (workspaceId, mailboxId) =>
      rpc<MailboxSecret | null>("mail_mailbox_secret", {
        p_workspace_id: workspaceId,
        p_mailbox_id: mailboxId,
      }),
    mailboxResult: (workspaceId, mailboxId, outcome, error) =>
      rpc("mail_mailbox_result", {
        p_workspace_id: workspaceId,
        p_mailbox_id: mailboxId,
        p_outcome: outcome,
        p_error: error ?? null,
        p_pause_after: AUTH_FAILURES_BEFORE_PAUSE,
      }),
    scheduleContext: (workspaceId) =>
      rpc<ScheduleContext | null>("mail_schedule_context", {
        p_workspace_id: workspaceId,
        p_limit: PLAN_PER_STEP,
        p_ramp_start: RAMP_START,
        p_ramp_step: RAMP_STEP,
      }),
    scheduleCommit: (workspaceId, plans) =>
      rpc<number>("mail_schedule_commit", {
        p_workspace_id: workspaceId,
        p_plans: plans,
      }),
    async sendClaim(workspaceId) {
      const claimed = await rpc<{ emails: ClaimedEmail[] } | null>(
        "mail_send_claim",
        {
          p_workspace_id: workspaceId,
          p_limit: SENDS_PER_STEP,
          p_ramp_start: RAMP_START,
          p_ramp_step: RAMP_STEP,
          p_workspace_cap: WORKSPACE_DAILY_SEND_CAP,
          p_stale_seconds: STALE_SENDING_SECONDS,
        },
      );
      return claimed?.emails ?? [];
    },
    sendResult: (workspaceId, emailId, outcome, o = {}) =>
      rpc<string>("mail_send_result", {
        p_workspace_id: workspaceId,
        p_email_id: emailId,
        p_outcome: outcome,
        p_error: o.error ?? null,
        p_retry_at: o.retryAt?.toISOString() ?? null,
        p_max_attempts: o.maxAttempts ?? 1,
      }),
    pollClaim: () =>
      rpc<PollTarget[]>("mail_poll_claim", {
        p_limit: MAILBOXES_PER_POLL_STEP,
        p_interval_seconds: IMAP_POLL_INTERVAL_SECONDS,
        p_lease_seconds: IMAP_POLL_LEASE_SECONDS,
      }),
    async pollDone(target, result) {
      await rpc("mail_poll_done", {
        p_workspace_id: target.workspace_id,
        p_mailbox_id: target.mailbox_id,
        p_ok: result.ok,
        p_uidvalidity: result.ok ? result.uidvalidity : null,
        p_last_uid: result.ok ? result.last_uid : null,
      });
    },
    inboundCommit: (workspaceId, mailboxId, message) =>
      rpc<string>("mail_inbound_commit", {
        p_workspace_id: workspaceId,
        p_mailbox_id: mailboxId,
        p_message: message,
      }),
    writeClaim: (workspaceId) =>
      rpc<WriteClaim | null>("mail_write_claim", {
        p_workspace_id: workspaceId,
        p_limit: WRITES_PER_STEP,
        p_max_writes_per_day: DAILY_MAIL_WRITE_CAP,
        p_max_cost_micros_per_day: DAILY_SPEND_CAP_MICROS,
        p_max_attempts: WRITE_MAX_ATTEMPTS,
      }),
    followupSave: (workspaceId, emailId, written, costMicros) =>
      rpc<string>("mail_followup_save", {
        p_workspace_id: workspaceId,
        p_email_id: emailId,
        p_ok: written !== null,
        p_body: written?.body ?? null,
        p_model: written?.model ?? null,
        p_cost_micros: costMicros,
      }),
    replyCommit: (workspaceId, receivedId, result, costMicros) =>
      rpc<string>("mail_reply_commit", {
        p_workspace_id: workspaceId,
        p_received_id: receivedId,
        p_ok: result !== null,
        p_result: result ?? {},
        p_cost_micros: costMicros,
      }),
    healthCheck: (workspaceId) =>
      rpc<number>("mail_health_check", {
        p_workspace_id: workspaceId,
        p_days: HEALTH_WINDOW_DAYS,
        p_min_bounces: HEALTH_MIN_BOUNCES,
        p_bounce_pct: HEALTH_BOUNCE_PCT,
        p_min_stops: HEALTH_MIN_STOPS,
        p_stop_pct: HEALTH_STOP_PCT,
      }),
    claimAlerts: (workspaceId) =>
      rpc<MailAlerts | null>("mail_claim_team_alerts", {
        p_workspace_id: workspaceId,
      }),
    async finishAlert(alertId, sent, recipients) {
      await rpc("finish_team_alert", {
        p_alert_id: alertId,
        p_sent: sent,
        p_recipients: recipients,
      });
    },
  };
}
