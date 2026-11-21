// Multi-channel sequence steps: the fixed limits. LINKEDIN_DAILY_TASKS is
// also written into the scheduler (private.channel_cron_tick in
// 20261121004956_sequence_channel_steps.sql): change both together.

export const STEP_CHANNELS = ["linkedin", "sms", "call_task"] as const;
export type StepChannel = (typeof STEP_CHANNELS)[number];

export const STEP_CHANNEL_LABEL: Record<StepChannel, string> = {
  linkedin: "LinkedIn message (you send it)",
  sms: "Text message",
  call_task: "Call task (you call)",
};

/** Extra steps a workspace may have at once. */
export const MAX_STEPS = 6;
/**
 * LinkedIn tasks handed out per workspace per day. Kept low on purpose: a
 * person sends each one from their own profile, and LinkedIn limits how
 * many invitations an account may send.
 */
export const LINKEDIN_DAILY_TASKS = 20;
/** A text step's message, before "Reply STOP to opt out" is added. */
export const SMS_MAX_CHARS = 300;
export const LINKEDIN_MAX_CHARS = 1000;
/** LinkedIn's own limit on a connection request's note. */
export const LINKEDIN_NOTE_CHARS = 300;
export const MAX_DAY_OFFSET = 60;
