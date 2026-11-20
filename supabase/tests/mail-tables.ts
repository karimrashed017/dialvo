/** The tables of sending and replies. Their isolation tests are in mail.test.ts. */
export const MAIL_TABLES = [
  "mailboxes",
  "workspace_sending",
  "mail_threads",
  "outbound_emails",
  "mail_received",
];

/**
 * Holds where a mailbox's password is in Vault. No role that reaches the
 * database through the API may read it at all, so it is checked on its own
 * in mail.test.ts rather than with "select *" like the others.
 */
export const MAIL_SECRET_TABLES = ["mailbox_secrets"];
