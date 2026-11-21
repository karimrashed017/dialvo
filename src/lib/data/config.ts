// Every limit on lists, research columns, recipes, enrichment, sourcing,
// accounts and audiences, in one place.
//
// CHANGING ANY NUMBER HERE IS A COST DECISION: each one bounds what a
// workspace can make Dialvo spend on the model, on web searches or on
// contact database (Findymail) credits. Ask the founder first. The database
// functions take these as arguments (see store.ts), so this file is the
// only place they are set.
//
// Prices and credit costs: the Claude API pricing in
// src/lib/prospects/config.ts (claude-haiku-4-5, $1 / $5 per million tokens,
// $10 per 1,000 web searches), and Findymail's docs read 21 Nov 2026:
//   POST /api/search/name            1 credit when an email is found
//   POST /api/verify                 1 verifier credit per check
//   POST /api/search/reverse-email   1 when a profile is found, +1 with the
//                                    profile's details (we ask for them)
//   POST /api/search/company         1 when the company is found
//   POST /api/technologies           1 when any technology is returned
//   POST /api/search/employees       1 per person returned (max 3 a call)
// Every Findymail lookup is free when nothing is found.

export { PROSPECT_MODEL as DATA_MODEL } from "@/lib/prospects/config";

// --- Lists -----------------------------------------------------------------------

/** Lists per workspace (not counting removed ones). */
export const LISTS_MAX = 50;

/** Rows in one list. */
export const LIST_ROWS_MAX = 2_000;

/** Added columns per list. */
export const LIST_COLUMNS_MAX = 20;

/** Rows shown on one page of a list. */
export const LIST_PAGE_SIZE = 100;

/** A CSV import, at most (under the 1 MB a Server Action may receive). */
export const LIST_IMPORT_MAX_BYTES = 900_000;

// --- Research columns ----------------------------------------------------------

/** Cells one "Run" may queue (rows x columns). */
export const RUN_MAX_CELLS = 500;

/** Web searches the model may make for one cell. */
export const RESEARCH_SEARCHES_PER_CELL = 2;

/** The model's answer for one cell, at most. */
export const RESEARCH_MAX_TOKENS = 500;

/** One cell's model call. */
export const RESEARCH_TIMEOUT_MS = 40_000;

/**
 * Estimated spend for one research cell, in millionths of a dollar,
 * reserved before it runs and corrected after: about 12,000 input tokens of
 * search results ($0.012), 300 output tokens ($0.0015) and two searches
 * ($0.02), rounded up to $0.04.
 */
export const RESEARCH_EST_MICROS_PER_CELL = 40_000;

/** Research cells a workspace may run in a day (UTC). */
export const DAILY_RESEARCH_CELLS = 150;

/**
 * Estimated model and search spend on research cells for a workspace in a
 * day (UTC): $5. Separate from Find leads' own $3 a day.
 */
export const DAILY_RESEARCH_SPEND_MICROS = 5_000_000;

/** Contact database credits data columns may use per workspace per day. */
export const DAILY_DATA_CREDITS = 200;

/**
 * Estimated credits per data cell, reserved before it runs and corrected
 * after (nothing is charged when nothing is found).
 */
export const DATA_CELL_CREDITS = {
  work_email: 1,
  verify_email: 1,
  title: 2,
  company_size: 1,
  industry: 1,
  technologies: 1,
} as const;

/** Cells answered in one scheduler call, side by side. */
export const CELLS_PER_STEP = 6;
export const CELLS_IN_PARALLEL = 3;
export const CELL_LEASE_SECONDS = 90;
export const CELL_MAX_ATTEMPTS = 2;

// --- Recipes ------------------------------------------------------------------------

export const RECIPES_MAX = 50;

// --- Accounts and buying committees -----------------------------------------------

/** Target accounts per workspace. */
export const ACCOUNTS_MAX = 1_000;

/** People looked up for one account's buying committee (one call, max 3). */
export const COMMITTEE_PEOPLE = 3;

/** Job titles sent in one committee search (Findymail takes up to 10). */
export const COMMITTEE_TITLES_MAX = 10;

/**
 * Estimated credits for one committee: 1 per person found, plus 1 per work
 * email found. Reserved from the day's data credits above.
 */
export const COMMITTEE_CREDITS = COMMITTEE_PEOPLE * 2;

// --- Audiences ------------------------------------------------------------------------

export const AUDIENCES_MAX = 50;

/** Leads one audience shows, exports or sends to a play, at most. */
export const AUDIENCE_MAX_LEADS = 5_000;

/** Leads one play start from a list, account or audience picks at most. */
export const SEND_TO_PLAY_MAX = 50;

// --- Lead scoring --------------------------------------------------------------------

/** Leads rescored at once when the settings change (the rest within 10 minutes). */
export const RESCORE_NOW = 500;

/** "Suggest rules from my description": one small model call. */
export const SCORING_SUGGEST_MAX_TOKENS = 500;

// --- Enrichment -------------------------------------------------------------------------

/** How often a lead is checked again, by default (the team can change it). */
export const ENRICH_REFRESH_DAYS_DEFAULT = 30;

/** The highest monthly credit cap a workspace may set. */
export const ENRICH_MONTHLY_CAP_MAX = 2_000;

/** The monthly credit cap a workspace starts with. */
export const ENRICH_MONTHLY_CAP_DEFAULT = 300;

/**
 * Credits reserved per lead before it is checked, and corrected after: an
 * email check (1) and a profile lookup (2), or a work-email search (1) and
 * a company lookup (1). At most 4 are ever spent on one lead.
 */
export const ENRICH_RESERVE_PER_LEAD = 3;
export const ENRICH_MAX_CREDITS_PER_LEAD = 4;

/** Leads checked in one scheduler call, and side by side. */
export const ENRICH_PER_STEP = 10;
export const ENRICH_IN_PARALLEL = 3;
export const ENRICH_LEASE_SECONDS = 120;
export const ENRICH_MAX_ATTEMPTS = 2;

/** "Check now" queues at most this many leads. */
export const ENRICH_CHECK_NOW_MAX = 500;

// --- Always-on sourcing -------------------------------------------------------------

/** Schedules per workspace. */
export const SOURCING_MAX = 3;

/** How often a schedule runs, by default. */
export const SOURCING_EVERY_DAYS_DEFAULT = 7;

/**
 * Scheduled runs a workspace may start in a month (UTC). Each is a Find
 * leads run and also counts against Find leads' own caps (4 runs a day, $3
 * of model spend a day, 100 contact credits a day, 25 companies a run).
 */
export const SOURCING_RUNS_PER_MONTH = 8;

/** Steps of a run one scheduler call takes, within its minute. */
export const SOURCING_STEPS_PER_CALL = 8;
export const SOURCING_STEP_BUDGET_MS = 45_000;
export const SOURCING_LEASE_SECONDS = 70;

/** When a run couldn't start (another run is going, or a cap): try again in. */
export const SOURCING_RETRY_MINUTES = 60;

/** Rows a sourcing run's recipe is answered for at once. */
export const SOURCING_RECIPE_ROWS = 25;
