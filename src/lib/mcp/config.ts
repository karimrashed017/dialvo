// The MCP server's limits, in one place.
//
// CHANGING A NUMBER HERE CAN BE A COST DECISION: ask the founder first.
// "find_contacts" spends Findymail credits (bought by Dialvo, shared by every
// workspace): 1 per person found (/api/search/employees) and 1 per email
// found (/api/search/name), reserved against the workspace's daily
// DAILY_CONTACT_CREDIT_CAP (100, src/lib/prospects/config.ts) before the
// call and given back when not spent. "get_account_brief" with make=true
// makes a brief (about 6 cents, src/lib/briefs/config.ts), counted against
// BRIEFS_PER_DAY. Every other tool only reads or writes the database.

/** Calls a minute per key (the REST API has its own 120). */
export const MCP_CALLS_PER_MINUTE = 60;

/** Rows a list tool returns at most. */
export const MCP_LIST_MAX = 25;

/** People find_contacts looks up at one company, at most. */
export const MCP_CONTACTS_MAX = 3;

/** Messages get_lead returns, newest first. */
export const MCP_HISTORY_MAX = 30;

/** The largest request body the endpoint reads. */
export const MCP_BODY_MAX_BYTES = 64_000;
