/**
 * The tables of the plays, campaigns, signals and product events. Their
 * isolation tests are in plays.test.ts.
 */
export const PLAYS_TABLES = [
  "lead_product_events",
  "outbound_campaigns",
  "outbound_campaign_targets",
  "signal_monitors",
  "signals",
  "play_settings",
];

/**
 * Tables a signed-in person can't select * from: the API keys (members may
 * read every column but the hash) and the rate limit's counter (server only).
 */
export const PLAYS_SECRET_TABLES = [
  "workspace_api_keys",
  "api_key_minute_usage",
];
