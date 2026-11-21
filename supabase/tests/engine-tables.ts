/**
 * The tables of sequences, playbooks and lead routing. Their isolation and
 * behaviour tests are in engine.test.ts.
 */
export const ENGINE_TABLES = [
  "sequences",
  "playbooks",
  "routing_rules",
  "routing_rule_assignees",
];

/**
 * Tables a signed-in person can't select * from: the chat's booking links
 * (members read every column but the token).
 */
export const ENGINE_SECRET_TABLES = ["booking_links"];
