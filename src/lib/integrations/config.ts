// Every limit Slack, webhooks, the public API, website visitors and
// review-site intent add, in one place. The database functions take these as
// arguments, so this file is the only place they are set.
//
// CHANGING A NUMBER HERE CAN BE A COST DECISION (the company lookups are
// paid per request once past the provider's free allowance): ask the
// founder first.

// --- Slack and webhooks ------------------------------------------------------------

/** Deliveries one step claims. */
export const DELIVERIES_PER_STEP = 50;
/** How long a claimed delivery is held before another step may take it. */
export const DELIVERY_LEASE_SECONDS = 60;
/** How long one POST may take. */
export const DELIVERY_TIMEOUT_MS = 10_000;
/** Tries per delivery before it is marked failed. */
export const DELIVERY_MAX_ATTEMPTS = 8;
/** Wait before try n+1, in seconds (the last value repeats). */
export const DELIVERY_BACKOFF_SECONDS = [
  60,
  300,
  900,
  3600,
  3 * 3600,
  6 * 3600,
  12 * 3600,
];
/** An endpoint failing this many deliveries in a row is switched off. */
export const ENDPOINT_DISABLE_AFTER = 50;
/** Endpoints per workspace. */
export const WEBHOOK_ENDPOINTS_MAX = 5;
/** The most of a receiver's answer we read (and keep 300 characters of). */
export const RESPONSE_MAX_BYTES = 4_000;

// --- The public API ----------------------------------------------------------------

/** Requests a minute per key (events have their own cap in plays/config). */
export const API_REQUESTS_PER_MINUTE = 120;
/** Rows per page, at most, and by default. */
export const API_PAGE_MAX = 100;
export const API_PAGE_DEFAULT = 25;
/** The largest request body the API reads. */
export const API_BODY_MAX_BYTES = 20_000;

// --- Website visitors ----------------------------------------------------------------

/** Page views a workspace records a day; more are dropped. */
export const SITE_VIEWS_PER_DAY = 20_000;
/**
 * Company lookups a workspace may make a day. Each is one request to the
 * provider (ipapi.is: 1,000 a day free with a key, then from $20 a month for
 * 20,000 a day across all workspaces), and an address is looked up at most
 * once a month per workspace.
 */
export const IP_LOOKUPS_PER_DAY = 300;
/** Leads one start of the known-lead retargeting play picks at most. */
export const RETARGET_LEADS_MAX = 50;
/** How far back a known lead's pricing-page visit counts, in days. */
export const RETARGET_LEAD_DAYS = 14;
/** A lead isn't written to by this play again within this many days. */
export const RETARGET_REPEAT_DAYS = 30;
/** Companies one retargeting start takes (the same as Target accounts). */
export const RETARGET_COMPANIES_MAX = 25;

// --- Review-site intent ---------------------------------------------------------------

/** Rows one import (CSV, webhook call or G2 page) may carry. */
export const INTENT_ROWS_PER_CALL = 500;
/** Rows a workspace may import a day. */
export const INTENT_ROWS_PER_DAY = 5_000;
/** The uploaded CSV's size, at most. */
export const INTENT_CSV_MAX_BYTES = 1_000_000;
/** Pages of G2 results one daily pull reads (250 rows each). */
export const G2_PAGES_PER_PULL = 8;
