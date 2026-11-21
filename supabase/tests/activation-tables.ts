/**
 * The tables of account briefs, calendar feeds, workflows, company news and
 * ad audiences. Their isolation and behaviour tests are in activation-features.test.ts.
 */
export const ACTIVATION_TABLES = [
  "account_briefs",
  "brief_settings",
  "calendar_feeds",
  "workflow_runs",
  "workflow_tasks",
  "news_settings",
  "news_companies",
  "company_news",
  "ad_audiences",
  "ad_audience_exports",
];

/**
 * Tables a signed-in person can't select * from: workflows (members read
 * every column but the inbound webhook token's hash).
 */
export const ACTIVATION_SECRET_TABLES = ["workflows"];
