import {
  SCHEDULE_LEADS_LOOKED_AT,
  SCHEDULE_LEADS_PER_RUN,
  SCHEDULE_REPEAT_DAYS,
  WORKFLOW_RUNS_PER_STEP,
} from "./config";
import {
  ACTION_LABEL,
  CLASSIFICATION_LABEL,
  describeCondition,
  NEEDS_LEAD,
  STAGE_LABEL,
  type ActionKind,
  type Condition,
  type Step,
  type TriggerConfig,
} from "./types";

// Running a workflow: the trigger's own filter, the conditions, then each
// step in order, with a line in the log for every one saying what happened
// and why. The decisions are here (pure, tested); each action itself is one
// database function (public.workflow_act), so it names the run's workspace
// and can't reach another's.

export type LeadFacts = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  website: string | null;
  status: string;
  source: string;
  owner_id: string | null;
  do_not_contact: boolean;
  country: string | null;
  size: string | null;
  size_lo: number | null;
  size_hi: number | null;
};

export type ClaimedRun = {
  id: string;
  workspace_id: string;
  trigger: string;
  event: Record<string, unknown>;
  created_at: string;
  workflow: {
    id: string;
    name: string;
    enabled: boolean;
    trigger_config: TriggerConfig;
    conditions: Condition[];
    steps: Step[];
  } | null;
  lead: LeadFacts | null;
};

export type LogLine = {
  step: number;
  action: string;
  outcome: "done" | "skipped" | "failed";
  why: string;
};

export interface WorkflowStore {
  claim(limit: number): Promise<ClaimedRun[]>;
  act(
    workspaceId: string,
    runId: string,
    index: number,
    step: Step,
    text: string,
  ): Promise<{ outcome: LogLine["outcome"]; why: string }>;
  finish(
    workspaceId: string,
    runId: string,
    status: "done" | "skipped" | "failed",
    log: LogLine[],
  ): Promise<boolean>;
  scheduleLeads(workspaceId: string, workflowId: string): Promise<LeadFacts[]>;
  spawn(
    workspaceId: string,
    workflowId: string,
    leadIds: string[],
    key: string,
  ): Promise<number>;
}

/** Whether the event is one this workflow waits for (the trigger's filter). */
export function triggerHolds(
  trigger: string,
  config: TriggerConfig,
  event: Record<string, unknown>,
): { ok: true } | { ok: false; why: string } {
  if (event.manual === true) return { ok: true };
  if (trigger === "lead_stage_changed" && config.stages?.length) {
    const stage = String(event.stage ?? "");
    if (!config.stages.includes(stage))
      return {
        ok: false,
        why: `The stage changed to ${STAGE_LABEL[stage] ?? stage}; this workflow waits for ${config.stages.map((s) => STAGE_LABEL[s] ?? s).join(" or ")}.`,
      };
  }
  if (trigger === "reply_received" && config.classifications?.length) {
    const c = String(event.classification ?? "");
    if (!config.classifications.includes(c))
      return {
        ok: false,
        why: `The reply was sorted as ${CLASSIFICATION_LABEL[c] ?? c}; this workflow waits for ${config.classifications.map((x) => CLASSIFICATION_LABEL[x] ?? x).join(" or ")}.`,
      };
  }
  return { ok: true };
}

const lower = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase();

function countryMatches(wanted: string, have: string | null): boolean {
  const w = lower(wanted);
  const h = lower(have);
  if (!w || !h) return false;
  if (w === h) return true;
  if (w.length >= 4) return h.includes(w);
  return new RegExp(`(^|[ ,(])${w.replace(/[^a-z]/g, "")}([ ,)]|$)`).test(h);
}

/** One condition against the lead: whether it holds, and why not. */
export function conditionHolds(
  c: Condition,
  lead: LeadFacts | null,
): { ok: boolean; why: string } {
  const said = describeCondition(c);
  if (!lead)
    return {
      ok: false,
      why: `"${said}" needs a lead, and this event has none.`,
    };
  const list = Array.isArray(c.value) ? c.value.map(lower) : [];
  let ok = false;
  switch (c.field) {
    case "status":
      ok = list.includes(lower(lead.status));
      break;
    case "source":
      ok = list.includes(lower(lead.source));
      break;
    case "country":
      ok = list.some((w) => countryMatches(w, lead.country));
      break;
    case "company_size": {
      const n = Number(c.value);
      ok =
        c.op === "at_least"
          ? lead.size_hi !== null && lead.size_hi >= n
          : lead.size_lo !== null && lead.size_lo <= n;
      break;
    }
    case "company":
      ok = lower(lead.company).includes(lower(c.value));
      break;
    case "email":
      ok = Boolean(lead.email);
      break;
    case "owner":
      ok = Boolean(lead.owner_id);
      break;
  }
  if (c.op === "is_not" || c.op === "is_empty") ok = !ok;
  if (ok) return { ok, why: "" };
  const known =
    c.field === "country"
      ? lead.country || "not known"
      : c.field === "company_size"
        ? lead.size || "not known"
        : c.field === "status"
          ? (STAGE_LABEL[lead.status] ?? lead.status)
          : c.field === "source"
            ? lead.source
            : c.field === "company"
              ? lead.company || "not known"
              : "";
  return {
    ok,
    why: `"${said}" doesn't hold${known ? ` (it is ${known})` : ""}.`,
  };
}

/** {{lead.name}}, {{lead.company}}, {{lead.email}}, {{event.summary}} filled in. */
export function fillText(
  template: string,
  lead: LeadFacts | null,
  event: Record<string, unknown>,
): string {
  return template
    .replace(
      /\{\{\s*lead\.(name|company|email|status|source|country)\s*\}\}/g,
      (_, k: keyof LeadFacts) => String(lead?.[k] ?? "").slice(0, 200),
    )
    .replace(
      /\{\{\s*event\.summary\s*\}\}/g,
      String(event.summary ?? "").slice(0, 600),
    )
    .trim();
}

const STATUS_OF = (log: LogLine[]): "done" | "skipped" | "failed" =>
  log.some((l) => l.outcome === "done")
    ? "done"
    : log.some((l) => l.outcome === "failed")
      ? "failed"
      : "skipped";

/** Runs one claimed run and returns its log (the store records it). */
export async function runOne(
  store: WorkflowStore,
  run: ClaimedRun,
): Promise<{ status: "done" | "skipped" | "failed"; log: LogLine[] }> {
  const log: LogLine[] = [];
  const wf = run.workflow;
  if (!wf || !wf.enabled) {
    log.push({
      step: 0,
      action: "run",
      outcome: "skipped",
      why: "The workflow was switched off before this ran.",
    });
    return { status: "skipped", log };
  }
  const t = triggerHolds(run.trigger, wf.trigger_config ?? {}, run.event ?? {});
  if (!t.ok) {
    log.push({ step: 0, action: "trigger", outcome: "skipped", why: t.why });
    return { status: "skipped", log };
  }

  // A schedule's own run picks the leads; each becomes a run of its own.
  if (run.trigger === "schedule" && !run.lead) {
    const candidates = await store.scheduleLeads(run.workspace_id, wf.id);
    const picked = candidates
      .filter((l) =>
        (wf.conditions ?? []).every((c) => conditionHolds(c, l).ok),
      )
      .slice(0, SCHEDULE_LEADS_PER_RUN);
    if (picked.length === 0) {
      log.push({
        step: 0,
        action: "schedule",
        outcome: "skipped",
        why: `No lead met the conditions (looked at up to ${SCHEDULE_LEADS_LOOKED_AT}, leaving out leads this workflow ran on in the last ${SCHEDULE_REPEAT_DAYS} days).`,
      });
      return { status: "skipped", log };
    }
    const n = await store.spawn(
      run.workspace_id,
      wf.id,
      picked.map((l) => l.id),
      run.id,
    );
    log.push({
      step: 0,
      action: "schedule",
      outcome: n > 0 ? "done" : "skipped",
      why:
        n > 0
          ? `Picked ${n} ${n === 1 ? "lead" : "leads"} (at most ${SCHEDULE_LEADS_PER_RUN} a run); each runs the steps on its own.`
          : "Today's limit of workflow runs was reached.",
    });
    return { status: n > 0 ? "done" : "skipped", log };
  }

  for (const c of wf.conditions ?? []) {
    const held = conditionHolds(c, run.lead);
    if (!held.ok) {
      log.push({
        step: 0,
        action: "condition",
        outcome: "skipped",
        why: held.why,
      });
      return { status: "skipped", log };
    }
  }
  let index = 0;
  for (const step of wf.steps ?? []) {
    index++;
    const action = step.action as ActionKind;
    const label = ACTION_LABEL[action] ?? step.action;
    if (NEEDS_LEAD.includes(action) && !run.lead) {
      log.push({
        step: index,
        action: step.action,
        outcome: "skipped",
        why: `${label}: this event has no lead to act on.`,
      });
      continue;
    }
    const text =
      "text" in step && typeof step.text === "string"
        ? fillText(step.text, run.lead, run.event ?? {})
        : "";
    try {
      const r = await store.act(run.workspace_id, run.id, index, step, text);
      log.push({
        step: index,
        action: step.action,
        outcome: r.outcome,
        why: r.why,
      });
    } catch (error) {
      console.error("[workflows] action failed:", (error as Error).message);
      log.push({
        step: index,
        action: step.action,
        outcome: "failed",
        why: "It couldn't be done just now.",
      });
    }
  }
  return { status: STATUS_OF(log), log };
}

export type WorkflowStepResult = {
  claimed: number;
  done: number;
  skipped: number;
  failed: number;
};

export async function workflowStep(
  store: WorkflowStore,
): Promise<WorkflowStepResult> {
  const runs = await store.claim(WORKFLOW_RUNS_PER_STEP);
  const result: WorkflowStepResult = {
    claimed: runs.length,
    done: 0,
    skipped: 0,
    failed: 0,
  };
  for (const run of runs) {
    let outcome: { status: "done" | "skipped" | "failed"; log: LogLine[] };
    try {
      outcome = await runOne(store, run);
    } catch (error) {
      console.error("[workflows] run failed:", (error as Error).message);
      outcome = {
        status: "failed",
        log: [
          {
            step: 0,
            action: "run",
            outcome: "failed",
            why: "It couldn't be run.",
          },
        ],
      };
    }
    await store
      .finish(run.workspace_id, run.id, outcome.status, outcome.log)
      .catch(() => false);
    result[outcome.status]++;
  }
  return result;
}
