// Every limit on account briefs, closed-lost notes and calendar feeds, in one
// place. The database functions take these as arguments (see store.ts), so
// this file is where they are set; BRIEFS_PER_DAY is also written in the
// account_briefs migration for the scheduler and the closed-lost trigger.
//
// CHANGING A NUMBER HERE IS A COST DECISION: ask the founder first.
//
// What one brief costs (estimates from the Claude API price list of 20 Nov
// 2026, claude-haiku-4-5 at $1 / $5 per million tokens in / out, web search
// at $10 per 1,000): about 12,000 tokens in (the company's pages, the
// conversation, search results) and 1,500 out, plus up to 3 searches: about
// $0.02 + $0.0075 + $0.03 = roughly 6 cents. A closed-lost note reads no
// pages and searches nothing: about 1 cent. Every brief also counts against
// the workspace's daily model spend (DAILY_SPEND_CAP_MICROS, $3), shared
// with Find leads and the email writer.

/** Briefs and closed-lost notes a workspace may ask for in a day (UTC). */
export const BRIEFS_PER_DAY = 40;

/** Web searches the model may make for one brief. */
export const BRIEF_SEARCHES = 3;

/** Pages of the company's own website read for one brief. */
export const BRIEF_SITE_PAGES = 3;

/** How much of each page, and of the conversation, the model is shown. */
export const BRIEF_PAGE_CHARS = 4_000;
export const BRIEF_HISTORY_CHARS = 12_000;

export const BRIEF_MAX_TOKENS = 2_000;
export const CLOSED_LOST_MAX_TOKENS = 700;

/** One brief's model call may take this long (it runs searches). */
export const BRIEF_TIMEOUT_MS = 45_000;

/** Briefs made in one scheduler call, side by side. */
export const BRIEFS_PER_STEP = 2;

/** Times a brief is tried before it is marked as failed. */
export const BRIEF_MAX_ATTEMPTS = 2;

export const BRIEF_LEASE_SECONDS = 150;

// --- Calendar feeds (secret iCal addresses) ------------------------------------
// Reading a feed costs nothing but a request to the calendar's host.

/** Feeds read in one scheduler call. */
export const CALENDAR_FEEDS_PER_STEP = 10;

/** How often a feed is read, in minutes. */
export const CALENDAR_EVERY_MINUTES = 30;

/** Events from this far back to this far ahead are imported. */
export const CALENDAR_PAST_DAYS = 1;
export const CALENDAR_AHEAD_DAYS = 14;

/** New meetings one read may add. */
export const CALENDAR_MEETINGS_PER_READ = 100;

/** Events sent to the database from one read, at most. */
export const CALENDAR_EVENTS_PER_READ = 500;

export const CALENDAR_LEASE_SECONDS = 90;
