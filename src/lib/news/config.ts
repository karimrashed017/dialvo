// Every limit on company news, in one place. NEWS_COMPANIES_MAX is also
// written in the company_news migration (the hourly refresh).
//
// CHANGING A NUMBER HERE IS A COST DECISION: ask the founder first.
//
// What it costs: one model call with up to NEWS_SEARCHES_PER_COMPANY web
// searches per tracked company per week (claude-haiku-4-5, prices of 20 Nov
// 2026): about 6,000 tokens in and 500 out ($0.0085) plus 2 searches
// ($0.02), so roughly 3 cents a company a week. At the cap of 100
// companies, about $3 a workspace a week. Every call also counts against
// the workspace's daily model spend (DAILY_SPEND_CAP_MICROS, $3): a day
// that reaches it stops the checks until the next day.

/** Companies a workspace tracks for news, at most. */
export const NEWS_COMPANIES_MAX = 100;

/** Each company is searched once a week (in the migration: 7 days). */
export const NEWS_CHECK_EVERY_DAYS = 7;

/** Web searches for one company's check. */
export const NEWS_SEARCHES_PER_COMPANY = 2;

/** News is looked for from this many days back. */
export const NEWS_LOOKBACK_DAYS = 45;

/** Items kept from one check. */
export const NEWS_ITEMS_PER_COMPANY = 3;

/** Companies checked in one scheduler call, side by side two at a time. */
export const NEWS_COMPANIES_PER_STEP = 6;

export const NEWS_MAX_TOKENS = 900;
export const NEWS_TIMEOUT_MS = 40_000;
export const NEWS_LEASE_SECONDS = 120;

/** Companies kept into one target-accounts campaign at once. */
export const NEWS_KEEP_MAX = 25;

export const NEWS_KINDS = [
  "funding",
  "launch",
  "leadership",
  "expansion",
] as const;
export type NewsKind = (typeof NEWS_KINDS)[number];
export const NEWS_KIND_LABEL: Record<NewsKind, string> = {
  funding: "Funding",
  launch: "Launch",
  leadership: "Leadership hire",
  expansion: "Expansion",
};
