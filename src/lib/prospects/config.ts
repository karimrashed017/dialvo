// Every limit on "Find leads" and the first-email drafts, in one place.
//
// CHANGING ANY NUMBER HERE IS A COST DECISION: each one bounds what a
// workspace can make Dialvo spend on the model and on web searches. Ask the
// founder first. The database functions take these as arguments (see
// store.ts), so this file is the only place they are set.

/** The model that searches, reads and writes. Changing it is a cost decision. */
export const PROSPECT_MODEL = "claude-haiku-4-5";

/**
 * The web search tool, as the Claude API names it. This is the basic version,
 * which is the one claude-haiku-4-5 calls directly; the newer versions filter
 * results with code execution, which that model doesn't do.
 */
export const WEB_SEARCH_TOOL = "web_search_20250305";

// --- One run -----------------------------------------------------------------

/** The most companies one run looks at (found, skipped and unreadable). */
export const MAX_COMPANIES_PER_RUN = 25;

/** Web searches the model may make in one search round (one model call). */
export const SEARCHES_PER_ROUND = 3;

/** Search rounds per run, at most. With the line above: 18 searches a run. */
export const MAX_SEARCH_ROUNDS = 6;

/** Search rounds in a row that find nobody new before the run moves on. */
export const MAX_DRY_ROUNDS = 2;

/** Companies read in one step, side by side. */
export const RESEARCH_PER_STEP = 2;

/** Pages read per company: the home page, plus contact and about pages. */
export const PAGES_PER_COMPANY = 3;

/** How much of each page's text the model is shown. */
export const PAGE_CHARS_FOR_MODEL = 6_000;

/** Times one company's site is tried before it is marked unreadable. */
export const MAX_RESEARCH_ATTEMPTS = 2;

/** Steps one run may take in all: a backstop against a run that never ends. */
export const MAX_STEPS_PER_RUN = 60;

/**
 * How long one step holds the run. A step that dies leaves the run locked
 * for at most this long, then the next call carries on.
 */
export const STEP_LEASE_SECONDS = 90;

// --- One workspace, one day (UTC) ----------------------------------------------

/** Runs a workspace may start in a day. */
export const DAILY_RUN_CAP = 4;

/** Web searches a workspace may use in a day, across its runs. */
export const DAILY_SEARCH_CAP = 60;

/** First emails drafted for a workspace in a day. */
export const DAILY_DRAFT_CAP = 100;

/** "Suggest who we sell to" calls for a workspace in a day. */
export const DAILY_SUGGESTION_CAP = 10;

/**
 * Estimated model and search spend for a workspace in a day, in millionths
 * of a US dollar (3_000_000 = $3). When it is reached, runs stop and no
 * more drafts are written until tomorrow.
 */
export const DAILY_SPEND_CAP_MICROS = 3_000_000;

// --- Model calls ---------------------------------------------------------------

export const SEARCH_MAX_TOKENS = 1_500;
export const RESEARCH_MAX_TOKENS = 900;
export const DRAFT_MAX_TOKENS = 600;
export const SUGGEST_MAX_TOKENS = 500;

/** One search round may take this long: it runs several searches. */
export const SEARCH_TIMEOUT_MS = 40_000;
/** Reading one company, writing one email, or the suggestion. */
export const MODEL_TIMEOUT_MS = 25_000;

/** How much of the workspace's knowledge goes into a draft or a suggestion. */
export const KNOWLEDGE_CHARS_FOR_DRAFT = 20_000;

/** First emails written per call to the drafting step, side by side. */
export const DRAFTS_PER_STEP = 3;

/** Times one first email is tried before it is left as "couldn't be written". */
export const MAX_DRAFT_ATTEMPTS = 2;

// --- The first email -------------------------------------------------------------

/** What the writer is asked to stay under. */
export const EMAIL_TARGET_WORDS = 120;
/** A draft longer than this is thrown away rather than shown. */
export const EMAIL_MAX_WORDS = 160;
export const SUBJECT_MAX_CHARS = 90;

// --- Prices, for the spend estimate ------------------------------------------------
// From the Claude API pricing page on 20 Nov 2026. $1 per million tokens is
// exactly one millionth of a dollar per token, so these read as dollars per
// million tokens. If the model or the prices change, change these too.

export const PRICE_INPUT_MICROS_PER_TOKEN = 1; // $1 / MTok
export const PRICE_OUTPUT_MICROS_PER_TOKEN = 5; // $5 / MTok
export const PRICE_CACHE_WRITE_MICROS_PER_TOKEN = 1.25;
export const PRICE_CACHE_READ_MICROS_PER_TOKEN = 0.1;
/** $10 per 1,000 web searches. */
export const PRICE_SEARCH_MICROS = 10_000;

// --- The contact database (Findymail) --------------------------------------------
// Used instead of the web search when FINDYMAIL_API_KEY is set. Its credits
// are bought by Dialvo and shared by every workspace, so these caps are what
// stop one workspace from using up the account. Credits are estimated from
// Findymail's published costs (docs, 20 Nov 2026): in "targeted" mode, 1 per
// company, +1 per contact found, +1 per email found. Phones are never asked
// for (they cost 10 each).

/** Companies (each with one contact) one run asks the database for. */
export const CONTACT_COMPANIES_PER_RUN = MAX_COMPANIES_PER_RUN;

/** Estimated credits per company returned: company + contact + email. */
export const CONTACT_CREDITS_PER_COMPANY = 3;

/**
 * Findymail credits a workspace may use in a day (UTC), estimated. Checked
 * and reserved in the database before the search that spends them. 100
 * covers one full run of 25 companies (75) a day.
 */
export const DAILY_CONTACT_CREDIT_CAP = 100;

/** Seconds between two "is the export ready?" questions. */
export const CONTACT_POLL_SECONDS = 5;

/** Questions asked before a run gives up waiting (about 15 minutes). */
export const CONTACT_MAX_POLLS = 180;

/** Results read per page of the export (Findymail allows up to 500). */
export const CONTACT_PAGE_SIZE = 100;

/** One request to Findymail. */
export const CONTACT_TIMEOUT_MS = 15_000;

/** Domains sent to the workspace's exclusion list in one step, at most. */
export const CONTACT_EXCLUSIONS_PER_SYNC = 2_000;

/** Writing the Intellimatch query and job titles from a saved search. */
export const CONTACT_QUERY_MAX_TOKENS = 600;

/**
 * Whether runs use the contact database. Without the key, runs search the
 * web as before and nothing else changes.
 */
export function contactDatabaseStatus(
  env: Record<string, string | undefined> = process.env,
): { on: boolean } {
  return { on: Boolean(env.FINDYMAIL_API_KEY) };
}

/**
 * Whether this server can find leads at all: it needs the Anthropic key for
 * the model and the web search, and the Supabase secret key to run and count
 * a search without relying on a browser's session. Without either, the page
 * says so, saved searches and the suppression list still work, and nothing
 * else runs.
 */
export function prospectRuntimeStatus(
  env: Record<string, string | undefined> = process.env,
): { on: boolean; missing: string[] } {
  const missing = ["ANTHROPIC_API_KEY", "SUPABASE_SECRET_KEY"].filter(
    (name) => !env[name],
  );
  return { on: missing.length === 0, missing };
}
