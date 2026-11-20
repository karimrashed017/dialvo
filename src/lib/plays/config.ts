// Every limit the plays add, in one place.
//
// CHANGING ANY NUMBER HERE IS A COST DECISION: each one bounds what a
// workspace can make Dialvo spend on Findymail credits, on the model, or on
// sending. Ask the founder first. The database functions take these as
// arguments (see store.ts), so this file is the only place they are set.
//
// What is NOT new here, and is reused as it is:
//   * first-email drafts per day and the day's model spend: DAILY_DRAFT_CAP
//     and DAILY_SPEND_CAP_MICROS in src/lib/prospects/config.ts. A play's
//     drafts count against the same counters as Find leads' drafts.
//   * Findymail credits per day: DAILY_CONTACT_CREDIT_CAP in the same file.
//     Every Findymail lookup a play makes (lookalike, target accounts, the
//     technology check, keeping a signal) is reserved against that one
//     counter (outbound_usage.contact_credits) before it is made.
//   * runs per day (DAILY_RUN_CAP): a target-account or lookalike run is a
//     Find leads run and counts as one.

// --- Plays on the workspace's own leads ------------------------------------------

/** Leads one play start picks at most. */
export const PLAY_MAX_LEADS_PER_START = 50;

/** A lead isn't picked by the same play again within this many days. */
export const PLAY_REPEAT_DAYS: Record<string, number> = {
  reactivation: 60,
  closed_lost: 90,
  plg: 14,
  expansion: 60,
  nurture: 30,
  onboarding: 365,
};

/** The "N days" each play starts with; the team can change it per start. */
export const PLAY_DEFAULT_DAYS: Record<string, number> = {
  reactivation: 30,
  closed_lost: 90,
  plg: 7,
  expansion: 30,
  nurture: 21,
  onboarding: 30,
};

/** The range the team may pick N from. */
export const PLAY_DAYS_MIN = 1;
export const PLAY_DAYS_MAX = 365;

// --- Event lists ------------------------------------------------------------------

/** Rows in one uploaded registrant or attendee list. */
export const EVENT_LIST_MAX_ROWS = 2_000;

/** The uploaded file's size, at most (about 2,000 rows of four columns). */
export const EVENT_LIST_MAX_BYTES = 500_000;

// --- Target accounts and lookalike -----------------------------------------------

/** Companies in one target-account list. */
export const TARGET_ACCOUNTS_MAX = 200;

/** Seed companies for one lookalike search. */
export const LOOKALIKE_MAX_SEEDS = 3;

/**
 * Companies one target-account or lookalike run works through, at most. The
 * rest of a list waits for the next run (which also counts as a run).
 */
export const CAMPAIGN_COMPANIES_PER_RUN = 25;

/** Companies looked up in one step, side by side. */
export const CAMPAIGN_TARGETS_PER_STEP = 3;

/** Times one company is tried before it is marked as failed. */
export const CAMPAIGN_MAX_ATTEMPTS = 2;

/**
 * Estimated Findymail credits per company, from Findymail's published costs
 * (docs, 20 Nov 2026), reserved before the lookups and given back for what
 * wasn't spent:
 *   POST /api/search/company   1 when found (only when the team gave a name,
 *                              not a website)
 *   POST /api/search/employees 1 per person returned (we ask for one)
 *   POST /api/search/name      1 when an email is found
 * So 2 per company with a website, 3 with only a name.
 */
export const CREDITS_COMPANY_LOOKUP = 1;
export const CREDITS_EMPLOYEE = 1;
export const CREDITS_EMAIL = 1;

/** Lookalike: 1 credit per 10 companies returned, rounded up. */
export const LOOKALIKE_COMPANIES_PER_CREDIT = 10;

// --- Competitive takeout -----------------------------------------------------------

/**
 * POST /api/technologies: 1 credit when at least one technology is returned
 * (we ask only about the named competitor, so 1 when it is found, 0 when not).
 */
export const CREDITS_TECHNOLOGY_CHECK = 1;

/** Prospects checked in one click (one search's kept companies, at most). */
export const TAKEOUT_CHECKS_PER_CLICK = 25;

// --- Buying signals ---------------------------------------------------------------

/** Signals stored per workspace per day (UTC); the rest are counted as over. */
export const SIGNALS_PER_DAY = 50;

/** Active signal monitors per workspace. */
export const SIGNAL_MONITORS_MAX = 3;

/**
 * Findymail's own lifetime cap on what one monitor delivers (and charges
 * for). Findymail charges for every signal a monitor delivers whether or not
 * Dialvo pulls it, so this, not the daily cap above, bounds the real spend.
 */
export const SIGNAL_MONITOR_MAX_MATCHES = 100;

/**
 * Estimated credits per delivered signal: 1, plus 1 for a keyword monitor
 * with company filters (Findymail docs, 20 Nov 2026). Monitors are made
 * without contact filters and without enrichment, so never more than 2.
 */
export const CREDITS_PER_SIGNAL = 2;

/** "Keep" on a signal: one email lookup (POST /api/search/name). */
export const CREDITS_SIGNAL_KEEP = 1;

/** A monitor is pulled once a day. */
export const SIGNAL_PULL_EVERY_HOURS = 23;

/** Monitors pulled in one scheduler call. */
export const SIGNAL_MONITORS_PER_STEP = 5;

/** Pages (of 100) read from one monitor in one pull. */
export const SIGNAL_PAGES_PER_PULL = 2;

export const SIGNAL_LEASE_SECONDS = 120;

// --- Speed to lead ----------------------------------------------------------------

/** New leads picked up per workspace per scheduler call. */
export const SPEED_TO_LEAD_PER_STEP = 5;

// --- Product events (PLG) ---------------------------------------------------------

/** Events one API key may send in a minute. Over it: 429. */
export const API_EVENTS_PER_MINUTE = 60;

/** Active API keys per workspace (also written in the database function). */
export const API_KEYS_MAX = 3;

/** The request body of POST /api/v1/events, at most. */
export const API_EVENT_MAX_BYTES = 4_000;

/** The events the endpoint takes. */
export const PRODUCT_EVENTS = [
  "trial_started",
  "limit_reached",
  "teammate_invited",
  "trial_ending",
  "trial_converted",
] as const;
export type ProductEvent = (typeof PRODUCT_EVENTS)[number];
