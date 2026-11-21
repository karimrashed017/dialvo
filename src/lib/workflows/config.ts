// Every limit on workflows, in one place. WORKFLOW_RUNS_PER_DAY is also
// written in the workflows migration (private.workflow_enqueue), which
// queues runs from database triggers and so can't be passed a number.
//
// CHANGING A NUMBER HERE CAN BE A COST DECISION: ask the founder first.
//
// What a workflow costs: most actions are database writes and cost nothing
// outside Dialvo. "Research the company" makes an account brief (about 6
// cents each, see src/lib/briefs/config.ts) and counts against
// BRIEFS_PER_DAY and the day's model spend cap. "Post to Slack" counts
// against Slack's 60 posts an hour per workspace. "Add to a play" writes a
// first email with the model (counted against the play's own caps) that
// waits for approval under the play's rules.

/** Workflows a workspace may have. */
export const WORKFLOWS_MAX = 20;

/** Steps in one workflow (also in the table's check). */
export const WORKFLOW_STEPS_MAX = 8;

/** Conditions in one workflow (also in the table's check). */
export const WORKFLOW_CONDITIONS_MAX = 10;

/** Runs queued per workspace per day (UTC); more events are not queued. */
export const WORKFLOW_RUNS_PER_DAY = 500;

/** Actions carried out per workspace per day (UTC). */
export const WORKFLOW_ACTIONS_PER_DAY = 1_000;

/** Runs claimed in one scheduler call. */
export const WORKFLOW_RUNS_PER_STEP = 40;

export const WORKFLOW_LEASE_SECONDS = 60;

/** Leads one scheduled run may pick, and how many it looks at to find them. */
export const SCHEDULE_LEADS_PER_RUN = 25;
export const SCHEDULE_LEADS_LOOKED_AT = 300;

/** A scheduled workflow doesn't pick the same lead again within this many days. */
export const SCHEDULE_REPEAT_DAYS = 7;

/** The inbound webhook: body size, and calls a minute per address. */
export const HOOK_BODY_MAX_BYTES = 8_000;
export const HOOK_CALLS_PER_MINUTE = 60;
