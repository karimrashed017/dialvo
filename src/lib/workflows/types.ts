import { WORKFLOW_CONDITIONS_MAX, WORKFLOW_STEPS_MAX } from "./config";

// What a workflow is made of, as the builder edits it and the database keeps
// it (workflows.trigger, trigger_config, conditions, steps), with the checks
// every save goes through. Pure.

export const TRIGGERS = [
  "lead_created",
  "lead_stage_changed",
  "reply_received",
  "chat_needs_person",
  "meeting_booked",
  "signal_kept",
  "webhook",
  "schedule",
] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const TRIGGER_LABEL: Record<Trigger, string> = {
  lead_created: "A lead is added",
  lead_stage_changed: "A lead's stage changes",
  reply_received: "Someone replies to an email",
  chat_needs_person: "A chat needs a person",
  meeting_booked: "A meeting is booked",
  signal_kept: "A signal is kept",
  webhook: "Your system calls a webhook",
  schedule: "On a schedule",
};

export const STAGES = [
  "new",
  "engaged",
  "qualified",
  "meeting_booked",
  "won",
  "lost",
] as const;
export const STAGE_LABEL: Record<string, string> = {
  new: "New",
  engaged: "Engaged",
  qualified: "Qualified",
  meeting_booked: "Meeting booked",
  won: "Won",
  lost: "Lost",
  unsubscribed: "Unsubscribed",
};

export const CLASSIFICATIONS = [
  "interested",
  "question",
  "not_now",
  "not_interested",
  "wrong_person",
  "unsubscribe",
  "unclear",
] as const;
export const CLASSIFICATION_LABEL: Record<string, string> = {
  interested: "Interested",
  question: "A question",
  not_now: "Not now",
  not_interested: "Not interested",
  wrong_person: "Wrong person",
  unsubscribe: "Unsubscribe",
  unclear: "Unclear",
};

export type TriggerConfig = {
  stages?: string[];
  classifications?: string[];
  every?: "day" | "week";
  hour?: number;
  weekday?: number;
};

export const CONDITION_FIELDS = {
  status: { label: "Stage", ops: ["is", "is_not"] },
  source: { label: "Source", ops: ["is", "is_not"] },
  country: { label: "Country", ops: ["is", "is_not"] },
  company_size: { label: "Company size", ops: ["at_least", "at_most"] },
  company: { label: "Company name", ops: ["contains"] },
  email: { label: "Email address", ops: ["is_set", "is_empty"] },
  owner: { label: "Owner", ops: ["is_set", "is_empty"] },
} as const;
export type ConditionField = keyof typeof CONDITION_FIELDS;

export const OP_LABEL: Record<string, string> = {
  is: "is",
  is_not: "is not",
  at_least: "is at least",
  at_most: "is at most",
  contains: "contains",
  is_set: "is known",
  is_empty: "is missing",
};

export type Condition = {
  field: ConditionField;
  op: string;
  /** A list for is / is_not, a number for sizes, text for contains. */
  value?: string[] | number | string;
};

export const ACTIONS = [
  "research",
  "add_to_play",
  "assign",
  "set_stage",
  "slack",
  "webhook",
  "task",
  "note",
] as const;
export type ActionKind = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<ActionKind, string> = {
  research: "Research the company (summary on the lead)",
  add_to_play: "Add the lead to a running play",
  assign: "Give the lead to a teammate",
  set_stage: "Change the lead's stage",
  slack: "Post to Slack",
  webhook: "Send to your webhook endpoint",
  task: "Create a task for a person",
  note: "Add a note to the lead",
};

/** The actions that need a lead to act on. */
export const NEEDS_LEAD: ActionKind[] = [
  "research",
  "add_to_play",
  "assign",
  "set_stage",
  "note",
];

export type Step =
  | { action: "research" }
  | { action: "add_to_play"; campaign_id: string }
  | { action: "assign"; to: "rules" | "user"; user_id?: string }
  | { action: "set_stage"; stage: string }
  | { action: "slack"; text: string }
  | { action: "webhook"; endpoint_id: string }
  | { action: "task"; text: string; assignee: string; due_days?: string }
  | { action: "note"; text: string };

export type Workflow = {
  name: string;
  trigger: Trigger;
  trigger_config: TriggerConfig;
  conditions: Condition[];
  steps: Step[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const text = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
        .trim()
        .slice(0, max)
    : "";
const words = (v: unknown, max = 20) =>
  (Array.isArray(v) ? v : [])
    .map((x) => text(x, 80))
    .filter(Boolean)
    .slice(0, max);

export type Checked =
  { ok: true; workflow: Workflow } | { ok: false; error: string };

/** A workflow as the builder sent it, checked, or what is wrong with it. */
export function checkWorkflow(input: {
  name: unknown;
  trigger: unknown;
  trigger_config: unknown;
  conditions: unknown;
  steps: unknown;
}): Checked {
  const name = text(input.name, 80);
  if (!name) return { ok: false, error: "Give the workflow a name." };
  if (!(TRIGGERS as readonly string[]).includes(String(input.trigger)))
    return { ok: false, error: "Choose what starts the workflow." };
  const trigger = input.trigger as Trigger;
  const raw = (input.trigger_config ?? {}) as Record<string, unknown>;
  const config: TriggerConfig = {};
  if (trigger === "lead_stage_changed") {
    const stages = words(raw.stages).filter((s) =>
      (STAGES as readonly string[]).includes(s),
    );
    if (stages.length) config.stages = stages;
  }
  if (trigger === "reply_received") {
    const c = words(raw.classifications).filter((s) =>
      (CLASSIFICATIONS as readonly string[]).includes(s),
    );
    if (c.length) config.classifications = c;
  }
  if (trigger === "schedule") {
    config.every = raw.every === "week" ? "week" : "day";
    const hour = Number(raw.hour);
    config.hour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8;
    if (config.every === "week") {
      const day = Number(raw.weekday);
      config.weekday = Number.isInteger(day) && day >= 0 && day <= 6 ? day : 1;
    }
  }

  const conditions: Condition[] = [];
  for (const c of Array.isArray(input.conditions) ? input.conditions : []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const field = String(o.field) as ConditionField;
    const spec = CONDITION_FIELDS[field];
    if (!spec) continue;
    const op = String(o.op);
    if (!(spec.ops as readonly string[]).includes(op))
      return {
        ok: false,
        error: `Choose how to compare ${spec.label.toLowerCase()}.`,
      };
    if (op === "is" || op === "is_not") {
      const value = Array.isArray(o.value)
        ? words(o.value)
        : words(String(o.value ?? "").split(","));
      if (!value.length)
        return { ok: false, error: `Say which ${spec.label.toLowerCase()}.` };
      conditions.push({ field, op, value });
    } else if (op === "at_least" || op === "at_most") {
      const n = Number(o.value);
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000)
        return {
          ok: false,
          error: "Give the company size as a number of people.",
        };
      conditions.push({ field, op, value: Math.round(n) });
    } else if (op === "contains") {
      const value = text(o.value, 80);
      if (!value)
        return { ok: false, error: "Say what the company name contains." };
      conditions.push({ field, op, value });
    } else conditions.push({ field, op });
  }
  if (conditions.length > WORKFLOW_CONDITIONS_MAX)
    return {
      ok: false,
      error: `At most ${WORKFLOW_CONDITIONS_MAX} conditions.`,
    };

  const steps: Step[] = [];
  for (const s of Array.isArray(input.steps) ? input.steps : []) {
    const o = (s ?? {}) as Record<string, unknown>;
    switch (o.action) {
      case "research":
        steps.push({ action: "research" });
        break;
      case "add_to_play":
        if (!isId(o.campaign_id))
          return { ok: false, error: "Choose the play to add the lead to." };
        steps.push({ action: "add_to_play", campaign_id: o.campaign_id });
        break;
      case "assign":
        if (o.to === "rules") steps.push({ action: "assign", to: "rules" });
        else if (isId(o.user_id))
          steps.push({ action: "assign", to: "user", user_id: o.user_id });
        else return { ok: false, error: "Choose who gets the lead." };
        break;
      case "set_stage":
        if (!(STAGES as readonly string[]).includes(String(o.stage)))
          return { ok: false, error: "Choose the new stage." };
        steps.push({ action: "set_stage", stage: String(o.stage) });
        break;
      case "slack":
      case "note": {
        const t = text(o.text, 1000);
        if (!t)
          return {
            ok: false,
            error:
              o.action === "slack"
                ? "Write the Slack message."
                : "Write the note.",
          };
        steps.push({ action: o.action, text: t });
        break;
      }
      case "webhook":
        if (!isId(o.endpoint_id))
          return { ok: false, error: "Choose the webhook endpoint." };
        steps.push({ action: "webhook", endpoint_id: o.endpoint_id });
        break;
      case "task": {
        const t = text(o.text, 200);
        if (!t) return { ok: false, error: "Write what the task is." };
        const assignee =
          o.assignee === "owner" || isId(o.assignee)
            ? String(o.assignee)
            : "team";
        const due = Number(o.due_days);
        steps.push({
          action: "task",
          text: t,
          assignee,
          ...(Number.isInteger(due) && due >= 0 && due <= 60
            ? { due_days: String(due) }
            : {}),
        });
        break;
      }
      default:
        break;
    }
  }
  if (steps.length === 0) return { ok: false, error: "Add at least one step." };
  if (steps.length > WORKFLOW_STEPS_MAX)
    return { ok: false, error: `At most ${WORKFLOW_STEPS_MAX} steps.` };
  return {
    ok: true,
    workflow: { name, trigger, trigger_config: config, conditions, steps },
  };
}

/** A condition in words, for the list and the run log. */
export function describeCondition(c: Condition): string {
  const spec = CONDITION_FIELDS[c.field];
  const value = Array.isArray(c.value)
    ? c.value.map((v) => STAGE_LABEL[v] ?? v).join(" or ")
    : c.value === undefined
      ? ""
      : String(c.value);
  return `${spec.label} ${OP_LABEL[c.op] ?? c.op}${value ? ` ${value}` : ""}`.trim();
}
