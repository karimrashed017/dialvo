// Every limit on sending, reading replies and the emails the agent writes
// after the first one, in one place.
//
// CHANGING ANY NUMBER HERE IS A DELIVERABILITY AND COST DECISION. The send
// limits decide whether a customer's mailbox keeps a good reputation or
// lands in spam; the model limits bound what a workspace can make Dialvo
// spend. Ask the founder first. The database functions take these as
// arguments (see store.ts), so this file is the only place they are set.
// The database has its own hard ceilings as a backstop (50 emails a day per
// mailbox, 10 mailboxes per workspace), which this file must stay under.

/** The model that writes follow-ups, reads replies and drafts answers. */
export const MAIL_MODEL = "claude-haiku-4-5";

// --- One mailbox -----------------------------------------------------------------

/** What a mailbox sends in a day once it has ramped up, unless set lower. */
export const MAILBOX_DAILY_LIMIT_DEFAULT = 30;
/** The most a workspace may set a mailbox's daily limit to. */
export const MAILBOX_DAILY_LIMIT_MAX = 50;
/** A newly connected mailbox sends this many on its first day... */
export const RAMP_START = 10;
/** ...and this many more each day after, up to its limit. */
export const RAMP_STEP = 5;
/** Mailboxes one workspace may have connected at once. */
export const MAX_MAILBOXES = 5;
/** Logins refused in a row before a mailbox is paused and the team told. */
export const AUTH_FAILURES_BEFORE_PAUSE = 3;
/** "Send me a test email" presses per person per hour. */
export const TEST_EMAILS_PER_HOUR = 5;

// --- One workspace, one day (its own time zone) --------------------------------------

/** Emails a workspace sends in a day, across all its mailboxes. */
export const WORKSPACE_DAILY_SEND_CAP = 150;
/**
 * Follow-ups written and replies read by the model for a workspace in a day
 * (UTC). The day's spend cap in src/lib/prospects/config.ts
 * (DAILY_SPEND_CAP_MICROS) applies to these calls as well.
 */
export const DAILY_MAIL_WRITE_CAP = 100;

// --- Spacing -----------------------------------------------------------------------

/** Two emails from one mailbox are at least this far apart... */
export const MIN_GAP_MINUTES = 4;
/** ...and the gap is picked at random up to this. */
export const MAX_GAP_MINUTES = 11;
/** How far ahead emails are given a time. Later ones wait their turn. */
export const PLAN_AHEAD_DAYS = 7;
/** Emails given a time in one step. */
export const PLAN_PER_STEP = 60;

// --- Sending -----------------------------------------------------------------------

/** Emails one workspace sends in one step: at most one per mailbox. */
export const SENDS_PER_STEP = 5;
/** Times one email is tried when the mail server says "try later". */
export const SEND_MAX_ATTEMPTS = 3;
/** How long to wait before the second and third try, in minutes. */
export const RETRY_BACKOFF_MINUTES = [10, 60];
/**
 * An email claimed for sending and not heard of for this long is marked
 * "needs checking". It is never sent again on its own.
 */
export const STALE_SENDING_SECONDS = 600;
/** One conversation with a mail server may take this long. */
export const SMTP_TIMEOUT_MS = 20_000;

// --- Reading replies ------------------------------------------------------------------

/** Each connected mailbox's inbox is read this often. */
export const IMAP_POLL_INTERVAL_SECONDS = 180;
/** How long one reader holds a mailbox. A reader that dies frees it after this. */
export const IMAP_POLL_LEASE_SECONDS = 120;
/** Mailboxes read in one step. */
export const MAILBOXES_PER_POLL_STEP = 3;
/** New messages looked at per mailbox per read; the rest wait for the next. */
export const MESSAGES_PER_POLL = 40;
/** A message bigger than this is matched by its headers only. */
export const MAX_MESSAGE_BYTES = 400_000;
export const IMAP_TIMEOUT_MS = 20_000;
/** How much of a reply's text is kept and shown to the model. */
export const REPLY_CHARS_KEPT = 6_000;

// --- Writing ------------------------------------------------------------------------

/** Replies read and follow-ups written for one workspace in one step. */
export const WRITES_PER_STEP = 4;
/** Times one reply is read, or one follow-up written, before giving up. */
export const WRITE_MAX_ATTEMPTS = 2;
export const WRITE_MAX_TOKENS = 700;
export const MODEL_TIMEOUT_MS = 25_000;
/** How much of the workspace's knowledge goes into one prompt. */
export const KNOWLEDGE_CHARS = 20_000;
/** What the first and the second follow-up are asked to stay under. */
export const FOLLOWUP_TARGET_WORDS = [70, 45];
/** A follow-up longer than this is thrown away rather than shown. */
export const FOLLOWUP_MAX_WORDS = [100, 70];
/** An answer to a reply longer than this is thrown away. */
export const REPLY_MAX_WORDS = 180;

// --- One step -----------------------------------------------------------------------

/** A step stops starting new work after this long, to finish inside its request. */
export const STEP_BUDGET_MS = 40_000;

/**
 * Whether this server can send and read mail at all: it needs the Supabase
 * secret key, the only thing that can read a mailbox's password back out of
 * Vault. Without it, mailboxes can still be connected and checked, and
 * nothing is sent. Writing follow-ups and answers also needs the Anthropic
 * key.
 */
export function mailRuntimeStatus(
  env: Record<string, string | undefined> = process.env,
): { on: boolean; writer: boolean; missing: string[] } {
  const missing = ["SUPABASE_SECRET_KEY", "ANTHROPIC_API_KEY"].filter(
    (name) => !env[name],
  );
  return {
    on: Boolean(env.SUPABASE_SECRET_KEY),
    writer: missing.length === 0,
    missing,
  };
}
