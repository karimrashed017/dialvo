/**
 * The tables of the phone agent, calls, numbers, SMS and the multi-channel
 * sequence steps. Their isolation tests are in channels.test.ts.
 */
export const CHANNEL_TABLES = [
  "workspace_phone",
  "phone_numbers",
  "phone_opt_outs",
  "call_batches",
  "call_batch_leads",
  "sms_log",
  "sequence_channel_steps",
  "sequence_channel_runs",
];
