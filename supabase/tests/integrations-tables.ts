/**
 * The tables of Slack, webhooks, website visitors and review-site intent.
 * Their isolation tests are in integrations.test.ts.
 */
export const INTEGRATION_TABLES = [
  "slack_connections",
  "webhook_endpoints",
  "integration_deliveries",
  "site_tracking",
  "site_companies",
  "site_visitors",
  "site_page_views",
  "intent_signals",
];

/**
 * Tables a signed-in person can't select * from: what a company lookup said
 * about an address hash and the email-link tokens (server only), and the
 * intent sources (members may read every column but the webhook token's
 * hash).
 */
export const INTEGRATION_SECRET_TABLES = [
  "site_ip_lookups",
  "site_link_tokens",
  "intent_sources",
];
