// CRM sync's limits, all in one place. Changing any of these is a cost and
// rate-limit decision: every number below turns into requests against the
// customer's CRM (whose API budget is theirs, shared with their other
// tools) and into time spent in Dialvo's background steps.
//
// The CRMs' own limits these are set against (read 20 Nov 2026):
//   HubSpot: 100 requests per 10 seconds per app on Free and Starter, 190 on
//     Professional and Enterprise; 250,000 to 1,000,000 a day per account;
//     CRM search 5 requests a second per account.
//   Pipedrive (API token): 20 requests per 2 seconds on Lite, up to 120 on
//     Ultimate; search 10 per 2 seconds on every plan; a daily token budget
//     of 30,000 x plan multiplier x seats (a list costs 20, a search 40).

/** Jobs one push step claims. A job is 1 to 6 requests. */
export const PUSH_BATCH = 20;

/** How long a claimed job is held before another step may take it over. */
export const JOB_LEASE_SECONDS = 120;

/** Tries per job before it shows as failed (with Retry in Settings). */
export const MAX_JOB_ATTEMPTS = 6;

/** Retry delay: 30 s, 1 min, 2 min, 4 min, ... at most 6 hours, plus jitter. */
export const RETRY_BASE_SECONDS = 30;
export const RETRY_MAX_SECONDS = 6 * 60 * 60;

/** A step stops taking new work after this long (the route allows 60 s). */
export const STEP_BUDGET_MS = 45_000;

/** Per request. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Gap between two requests to the same CRM from one step. */
export const MIN_GAP_MS = { hubspot: 120, pipedrive: 120 } as const;
/** Gap between two search requests (both CRMs limit search harder). */
export const SEARCH_GAP_MS = { hubspot: 250, pipedrive: 250 } as const;

/**
 * A 429 that asks to wait at most this long is waited out in the step
 * (twice at most); a longer one puts the job back with that delay.
 */
export const MAX_INLINE_WAIT_MS = 5_000;

/** The import: contacts and companies read per step (pages x page size). */
export const PULL_PAGES_PER_STEP = 10;
export const HUBSPOT_PAGE_SIZE = 100; // HubSpot's maximum for list calls
export const PIPEDRIVE_PAGE_SIZE = 500; // Pipedrive's maximum for list calls
export const PULL_LEASE_SECONDS = 90;

/**
 * The most contacts plus companies one import reads. Beyond it the import
 * stops as "capped", and what was read stays on the list.
 */
export const PULL_CONTACT_CAP = 50_000;

/** What Dialvo writes into a note, at most (both CRMs allow far more). */
export const NOTE_MAX_CHARS = 8_000;
