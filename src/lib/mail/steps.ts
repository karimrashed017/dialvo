import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SendDeps } from "@/lib/alerts/email";
import { sendMailAlerts } from "./alerts";
import { composeEmail, type ClaimedEmail, type ComposedEmail } from "./compose";
import {
  mailRuntimeStatus,
  RETRY_BACKOFF_MINUTES,
  SEND_MAX_ATTEMPTS,
  STEP_BUDGET_MS,
  WORKSPACE_DAILY_SEND_CAP,
} from "./config";
import {
  fetchNew,
  type Fetched,
  type ImapSettings,
  type PollCursor,
} from "./imap";
import { readInbound } from "./inbound";
import { readReply, writeFollowup, type ModelClient } from "./model";
import { planSchedule, readWindow, retryAt } from "./schedule";
import { sendSmtp, type SendOutcome, type SmtpSettings } from "./smtp";
import { createMailStore, type MailStore } from "./store";

// HOW MAIL GETS SENT AND READ WITH NOBODY'S BROWSER OPEN
//
// Once a minute the database calls POST /api/mail/step three times (pg_cron
// + pg_net, see the scheduler migration), once per job below. Each job is
// one short pass over whatever is due, and returns. Nothing is kept in
// memory between calls: all state is rows in the database.
//
//   send   gives waiting emails a time and a mailbox, then sends what is due
//   poll   reads the connected mailboxes' inboxes for replies
//   write  reads replies with the model, drafts answers and follow-ups
//
// Every job starts by claiming its work in the database, so a call that
// dies, runs twice or overlaps another is harmless:
//
//   * an email is claimed (scheduled -> sending) under a row lock, then
//     sent, then marked sent. Only 'scheduled' emails can be claimed, so
//     two calls never send the same one. If a call dies between claiming
//     and reporting, the email stays 'sending' and is NEVER claimed again:
//     after ten minutes it becomes "needs checking" and a person decides,
//     because resending might send it twice. The same happens when the
//     connection drops after the email was handed to the mail server.
//     Only an email that certainly was not sent (the server said "try
//     later", or was never reached) goes back to be tried again.
//   * a mailbox is read under a lease; where the reader got to is saved
//     only after everything it read was stored, and an email already
//     stored is recognised by its Message-ID. A reader that dies re-reads.
//   * a reply to classify is leased for two minutes; a follow-up to write
//     is reserved as a row. A writer that dies leaves both to be handed
//     out again, a limited number of times.

/** The mail servers, as the steps need them. Faked in the unit tests. */
export interface MailTransport {
  send(settings: SmtpSettings, email: ComposedEmail): Promise<SendOutcome>;
  fetchNew(settings: ImapSettings, cursor: PollCursor): Promise<Fetched>;
}

export const realTransport: MailTransport = { send: sendSmtp, fetchNew };

export type MailDeps = {
  store: MailStore | null;
  transport: MailTransport;
  client: ModelClient | null;
  now?: () => Date;
  random?: () => number;
  /** For tests: how alert emails are sent. */
  alerts?: Partial<SendDeps>;
};

/** The real database, mail servers and model, or nulls without their keys. */
export function defaultMailDeps(): MailDeps {
  const status = mailRuntimeStatus();
  return {
    store: status.on ? createMailStore() : null,
    transport: realTransport,
    // Reads ANTHROPIC_API_KEY from the environment.
    client: status.writer ? new Anthropic() : null,
  };
}

const within = (started: number, now: () => Date) =>
  now().getTime() - started < STEP_BUDGET_MS;

// --- send ---------------------------------------------------------------------------

export type SendStepResult = {
  status: "ok" | "not_configured";
  planned: number;
  sent: number;
  retried: number;
  failed: number;
  unknown: number;
};

async function sendOne(
  workspaceId: string,
  email: ClaimedEmail,
  deps: MailDeps & { store: MailStore },
  now: Date,
): Promise<"sent" | "retried" | "failed" | "unknown"> {
  const { store, transport } = deps;
  // Read only here, used once, and never logged.
  const secret = await store.mailboxSecret(workspaceId, email.mailbox_id);
  if (!secret) {
    // The mailbox went away between the claim and now. Nothing was sent.
    await store.sendResult(workspaceId, email.id, "retry", {
      error: "The mailbox is no longer connected.",
      retryAt: retryAt(1, RETRY_BACKOFF_MINUTES, now),
      maxAttempts: SEND_MAX_ATTEMPTS,
    });
    return "retried";
  }
  const outcome = await transport.send(secret, composeEmail(email));
  if (outcome.ok) {
    const stored = await store.sendResult(workspaceId, email.id, "sent");
    await store.mailboxResult(workspaceId, secret.id, "ok");
    return stored === "sent" ? "sent" : "unknown";
  }
  const { failure } = outcome;
  switch (failure.kind) {
    case "auth":
      // Not this email's fault: it keeps its tries, and the mailbox is
      // paused after a few refusals in a row (and the team is told).
      await store.mailboxResult(
        workspaceId,
        secret.id,
        "auth_failed",
        failure.message,
      );
      await store.sendResult(workspaceId, email.id, "retry", {
        error: failure.message,
        retryAt: retryAt(email.attempts, RETRY_BACKOFF_MINUTES, now),
        maxAttempts: 1_000_000,
      });
      return "retried";
    case "temporary":
    case "connection": {
      const stored = await store.sendResult(workspaceId, email.id, "retry", {
        error: failure.message,
        retryAt: retryAt(email.attempts, RETRY_BACKOFF_MINUTES, now),
        maxAttempts: SEND_MAX_ATTEMPTS,
      });
      await store.mailboxResult(
        workspaceId,
        secret.id,
        "error",
        failure.message,
      );
      return stored === "failed" ? "failed" : "retried";
    }
    case "permanent":
      await store.sendResult(workspaceId, email.id, "failed", {
        error: failure.message,
      });
      return "failed";
    default:
      await store.sendResult(workspaceId, email.id, "unknown", {
        error: failure.message,
      });
      return "unknown";
  }
}

export async function sendStep(
  deps: MailDeps = defaultMailDeps(),
): Promise<SendStepResult> {
  const result: SendStepResult = {
    status: "ok",
    planned: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    unknown: 0,
  };
  const { store } = deps;
  if (!store) return { ...result, status: "not_configured" };
  const now = deps.now ?? (() => new Date());
  const started = now().getTime();
  for (const workspaceId of await store.workList()) {
    if (!within(started, now)) break;
    try {
      const context = await store.scheduleContext(workspaceId);
      if (context?.on && context.waiting.length && context.mailboxes.length) {
        const plans = planSchedule({
          now: now(),
          timeZone: context.timezone,
          window: readWindow(context.window),
          mailboxes: context.mailboxes,
          waiting: context.waiting,
          sentToday: context.sent_today,
          workspaceCap: WORKSPACE_DAILY_SEND_CAP,
          random: deps.random,
        });
        if (plans.length)
          result.planned += await store.scheduleCommit(workspaceId, plans);
      }
      // At most one per mailbox, so these are different mail servers.
      const claimed = await store.sendClaim(workspaceId);
      const outcomes = await Promise.all(
        claimed.map((email) =>
          sendOne(workspaceId, email, { ...deps, store }, now()).catch(
            (error) => {
              // The email stays 'sending' and becomes "needs checking".
              console.error("[mail] send failed:", (error as Error).message);
              return "unknown" as const;
            },
          ),
        ),
      );
      for (const outcome of outcomes) result[outcome] += 1;
    } catch (error) {
      console.error("[mail] send step failed:", (error as Error).message);
    }
  }
  await sendMailAlerts(store, deps.alerts);
  return result;
}

// --- poll ---------------------------------------------------------------------------

export type PollStepResult = {
  status: "ok" | "not_configured";
  mailboxes: number;
  replies: number;
  bounces: number;
  auto_replies: number;
  stopped: number;
};

export async function pollStep(
  deps: MailDeps = defaultMailDeps(),
): Promise<PollStepResult> {
  const result: PollStepResult = {
    status: "ok",
    mailboxes: 0,
    replies: 0,
    bounces: 0,
    auto_replies: 0,
    stopped: 0,
  };
  const { store, transport } = deps;
  if (!store) return { ...result, status: "not_configured" };
  const targets = await store.pollClaim();
  await Promise.all(
    targets.map(async (target) => {
      try {
        const secret = await store.mailboxSecret(
          target.workspace_id,
          target.mailbox_id,
        );
        if (!secret) return await store.pollDone(target, { ok: false });
        const fetched = await transport.fetchNew(secret, target);
        if (!fetched.ok) {
          await store.mailboxResult(
            target.workspace_id,
            target.mailbox_id,
            fetched.failure.kind === "auth" ? "auth_failed" : "error",
            fetched.failure.message,
          );
          return await store.pollDone(target, { ok: false });
        }
        for (const source of fetched.messages) {
          const message = await readInbound(source, secret.email);
          if (!message) continue;
          const stored = await store.inboundCommit(
            target.workspace_id,
            target.mailbox_id,
            message,
          );
          if (stored === "reply") result.replies += 1;
          else if (stored === "bounce") result.bounces += 1;
          else if (stored === "auto_reply") result.auto_replies += 1;
          else if (stored === "stopped") result.stopped += 1;
        }
        // Only now, with everything stored, does the reader move on.
        await store.pollDone(target, fetched);
        result.mailboxes += 1;
      } catch (error) {
        console.error("[mail] poll failed:", (error as Error).message);
        await store.pollDone(target, { ok: false }).catch(() => {});
      }
    }),
  );
  return result;
}

// --- write --------------------------------------------------------------------------

export type WriteStepResult = {
  status: "ok" | "not_configured";
  read: number;
  followups: number;
  failed: number;
};

export async function writeStep(
  deps: MailDeps = defaultMailDeps(),
): Promise<WriteStepResult> {
  const result: WriteStepResult = {
    status: "ok",
    read: 0,
    followups: 0,
    failed: 0,
  };
  const { store, client } = deps;
  if (!store || !client) return { ...result, status: "not_configured" };
  const now = deps.now ?? (() => new Date());
  const started = now().getTime();
  for (const workspaceId of await store.writeWorkList()) {
    if (!within(started, now)) break;
    try {
      const claim = await store.writeClaim(workspaceId);
      if (!claim) continue;
      await Promise.all([
        ...claim.replies.map(async (item) => {
          const read = await readReply(client, claim.context, item).catch(
            () => null,
          );
          await store.replyCommit(
            workspaceId,
            item.received_id,
            read?.ok ? read.result : null,
            read?.spend.cost_micros ?? 0,
          );
          if (read?.ok) result.read += 1;
          else result.failed += 1;
        }),
        ...claim.followups.map(async (item) => {
          const written = await writeFollowup(
            client,
            claim.context,
            item,
          ).catch(() => null);
          await store.followupSave(
            workspaceId,
            item.email_id,
            written?.ok ? { body: written.body, model: written.model } : null,
            written?.spend.cost_micros ?? 0,
          );
          if (written?.ok) result.followups += 1;
          else result.failed += 1;
        }),
      ]);
    } catch (error) {
      console.error("[mail] write step failed:", (error as Error).message);
    }
  }
  // An interested reply queues an alert: send it now, not a minute later.
  await sendMailAlerts(store, deps.alerts);
  return result;
}
