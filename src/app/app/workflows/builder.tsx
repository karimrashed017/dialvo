"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import {
  ACTION_LABEL,
  ACTIONS,
  CLASSIFICATION_LABEL,
  CLASSIFICATIONS,
  CONDITION_FIELDS,
  OP_LABEL,
  STAGE_LABEL,
  STAGES,
  TRIGGER_LABEL,
  TRIGGERS,
  type ActionKind,
  type Condition,
  type ConditionField,
  type Trigger,
  type TriggerConfig,
} from "@/lib/workflows/types";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import { btn, hint, input, labelCls, panel, panelHead } from "../_ui/kit";

// The workflow builder: a trigger, conditions, then steps in order. No
// canvas: a list you add to, reorder and remove from. What it sends is
// checked again on the server (src/lib/workflows/types.ts).

export type BuilderOptions = {
  members: { id: string; name: string }[];
  plays: { id: string; name: string }[];
  endpoints: { id: string; label: string }[];
  slack: boolean;
};

type StepDraft = Record<string, string> & { action: ActionKind };

export type BuilderInitial = {
  id: string | null;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  trigger_config: TriggerConfig;
  conditions: Condition[];
  steps: StepDraft[];
};

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const blankStep = (action: ActionKind): StepDraft => {
  switch (action) {
    case "assign":
      return { action, to: "rules" };
    case "set_stage":
      return { action, stage: "qualified" };
    case "task":
      return { action, text: "", assignee: "owner", due_days: "1" };
    case "slack":
      return {
        action,
        text: "New lead: {{lead.name}} at {{lead.company}}. {{event.summary}}",
      };
    default:
      return { action, text: "" } as StepDraft;
  }
};

export function WorkflowBuilder({
  initial,
  options,
  action,
  admin,
}: {
  initial: BuilderInitial;
  options: BuilderOptions;
  action: (form: FormData) => Promise<{ ok: boolean; message?: string }>;
  admin: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [trigger, setTrigger] = useState<Trigger>(initial.trigger);
  const [config, setConfig] = useState<TriggerConfig>(initial.trigger_config);
  const [conditions, setConditions] = useState<Condition[]>(initial.conditions);
  const [steps, setSteps] = useState<StepDraft[]>(
    initial.steps.length ? initial.steps : [blankStep("note")],
  );
  const [adding, setAdding] = useState<ActionKind>("research");

  const payload = JSON.stringify({
    name,
    trigger,
    trigger_config: config,
    conditions,
    steps,
  });
  const setStep = (i: number, patch: Record<string, string>) =>
    setSteps((s) =>
      s.map((x, j) => (j === i ? ({ ...x, ...patch } as StepDraft) : x)),
    );
  const move = (i: number, by: number) =>
    setSteps((s) => {
      const t = [...s];
      const [x] = t.splice(i, 1);
      t.splice(Math.max(0, Math.min(t.length, i + by)), 0, x);
      return t;
    });
  const toggle = (list: string[] | undefined, v: string) =>
    list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v];

  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      <input type="hidden" name="workflow" value={payload} />
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <fieldset disabled={!admin} className="contents">
        <section className={panel}>
          <h2 className={panelHead}>1. When</h2>
          <div className="space-y-3 p-4 text-[13px]">
            <label className={labelCls}>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                className={cn(input, "mt-1")}
              />
            </label>
            <label className={labelCls}>
              What starts it
              <select
                value={trigger}
                onChange={(e) => {
                  setTrigger(e.target.value as Trigger);
                  setConfig(
                    e.target.value === "schedule"
                      ? { every: "day", hour: 8 }
                      : {},
                  );
                }}
                className={cn(input, "mt-1")}
              >
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            {trigger === "lead_stage_changed" && (
              <fieldset>
                <legend className={labelCls}>
                  Only when the new stage is (none ticked: any)
                </legend>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {STAGES.map((s) => (
                    <label key={s} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={config.stages?.includes(s) ?? false}
                        onChange={() =>
                          setConfig({
                            ...config,
                            stages: toggle(config.stages, s),
                          })
                        }
                        className="accent-[#0B0B0C]"
                      />
                      {STAGE_LABEL[s]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {trigger === "reply_received" && (
              <fieldset>
                <legend className={labelCls}>
                  Only replies sorted as (none ticked: any)
                </legend>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {CLASSIFICATIONS.map((c) => (
                    <label key={c} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={config.classifications?.includes(c) ?? false}
                        onChange={() =>
                          setConfig({
                            ...config,
                            classifications: toggle(config.classifications, c),
                          })
                        }
                        className="accent-[#0B0B0C]"
                      />
                      {CLASSIFICATION_LABEL[c]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {trigger === "schedule" && (
              <div className="flex flex-wrap gap-2">
                <select
                  value={config.every ?? "day"}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      every: e.target.value as "day" | "week",
                    })
                  }
                  className={cn(input, "w-auto")}
                  aria-label="How often"
                >
                  <option value="day">Every day</option>
                  <option value="week">Every week</option>
                </select>
                {config.every === "week" && (
                  <select
                    value={config.weekday ?? 1}
                    onChange={(e) =>
                      setConfig({ ...config, weekday: Number(e.target.value) })
                    }
                    className={cn(input, "w-auto")}
                    aria-label="Day"
                  >
                    {DAYS.map((d, i) => (
                      <option key={d} value={i}>
                        on {d}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={config.hour ?? 8}
                  onChange={(e) =>
                    setConfig({ ...config, hour: Number(e.target.value) })
                  }
                  className={cn(input, "w-auto")}
                  aria-label="Hour (UTC)"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      at {String(h).padStart(2, "0")}:00 UTC
                    </option>
                  ))}
                </select>
                <p className={cn(hint, "w-full")}>
                  Each time, it picks up to 25 leads that meet the conditions
                  below (not ones it ran on in the last 7 days) and runs the
                  steps for each.
                </p>
              </div>
            )}
            {trigger === "webhook" && (
              <p className={hint}>
                After saving, make the secret address on this page and call it
                from your own system with a JSON body. Include &quot;email&quot;
                to run it for that lead.
              </p>
            )}
            {trigger === "signal_kept" && (
              <p className={hint}>
                Buying signals and review-site intent become companies to
                research, not leads yet, so steps that need a lead are skipped
                for them. Company news kept on an existing lead runs every step.
              </p>
            )}
          </div>
        </section>

        <section className={panel}>
          <h2 className={panelHead}>2. Only if</h2>
          <div className="space-y-2 p-4 text-[13px]">
            {conditions.length === 0 && (
              <p className={hint}>No conditions: every event runs the steps.</p>
            )}
            {conditions.map((c, i) => {
              const spec = CONDITION_FIELDS[c.field];
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    value={c.field}
                    aria-label="Field"
                    onChange={(e) => {
                      const field = e.target.value as ConditionField;
                      const op = CONDITION_FIELDS[field].ops[0];
                      setConditions((cs) =>
                        cs.map((x, j) => (j === i ? { field, op } : x)),
                      );
                    }}
                    className={cn(input, "w-auto")}
                  >
                    {Object.entries(CONDITION_FIELDS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.op}
                    aria-label="Comparison"
                    onChange={(e) =>
                      setConditions((cs) =>
                        cs.map((x, j) =>
                          j === i ? { ...x, op: e.target.value } : x,
                        ),
                      )
                    }
                    className={cn(input, "w-auto")}
                  >
                    {spec.ops.map((o) => (
                      <option key={o} value={o}>
                        {OP_LABEL[o]}
                      </option>
                    ))}
                  </select>
                  {c.field === "status" &&
                  (c.op === "is" || c.op === "is_not") ? (
                    <select
                      value={
                        Array.isArray(c.value) ? (c.value[0] ?? "new") : "new"
                      }
                      aria-label="Stage"
                      onChange={(e) =>
                        setConditions((cs) =>
                          cs.map((x, j) =>
                            j === i ? { ...x, value: [e.target.value] } : x,
                          ),
                        )
                      }
                      className={cn(input, "w-auto")}
                    >
                      {[...STAGES, "unsubscribed"].map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  ) : c.op === "is_set" || c.op === "is_empty" ? null : (
                    <input
                      aria-label="Value"
                      value={
                        Array.isArray(c.value)
                          ? c.value.join(", ")
                          : (c.value ?? "").toString()
                      }
                      placeholder={
                        c.field === "company_size"
                          ? "people, e.g. 50"
                          : c.field === "country"
                            ? "e.g. United Kingdom, DE"
                            : c.field === "source"
                              ? "e.g. form, chat, import"
                              : ""
                      }
                      onChange={(e) =>
                        setConditions((cs) =>
                          cs.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  value:
                                    c.op === "is" || c.op === "is_not"
                                      ? e.target.value
                                          .split(",")
                                          .map((v) => v.trim())
                                      : c.field === "company_size"
                                        ? Number(e.target.value) || 0
                                        : e.target.value,
                                }
                              : x,
                          ),
                        )
                      }
                      className={cn(input, "w-56 max-w-full")}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setConditions((cs) => cs.filter((_, j) => j !== i))
                    }
                    className={cn(btn.ghost, btn.small)}
                    aria-label="Remove condition"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </div>
              );
            })}
            {conditions.length < 10 && (
              <button
                type="button"
                onClick={() =>
                  setConditions((cs) => [
                    ...cs,
                    { field: "source", op: "is", value: [] },
                  ])
                }
                className={cn(btn.secondary, btn.small)}
              >
                <Plus aria-hidden className="size-3.5" />
                Add a condition
              </button>
            )}
            <p className={hint}>
              Country and size come from the company&apos;s research or the
              lead&apos;s own fields.
            </p>
          </div>
        </section>

        <section className={panel}>
          <h2 className={panelHead}>3. Do</h2>
          <ol className="divide-y divide-black/[0.06]">
            {steps.map((s, i) => (
              <li key={i} className="space-y-2 px-4 py-3 text-[13px]">
                <div className="flex items-center gap-2">
                  <span className="grid size-6 place-items-center rounded-full bg-black/[0.06] text-[11.5px] tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 font-medium">
                    {ACTION_LABEL[s.action]}
                  </span>
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className={cn(btn.ghost, btn.small)}
                    aria-label="Move up"
                  >
                    <ArrowUp aria-hidden className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === steps.length - 1}
                    className={cn(btn.ghost, btn.small)}
                    aria-label="Move down"
                  >
                    <ArrowDown aria-hidden className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}
                    className={cn(btn.ghost, btn.small)}
                    aria-label="Remove step"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </div>
                {s.action === "add_to_play" &&
                  (options.plays.length ? (
                    <select
                      value={s.campaign_id ?? ""}
                      onChange={(e) =>
                        setStep(i, { campaign_id: e.target.value })
                      }
                      className={input}
                      aria-label="Play"
                    >
                      <option value="">Choose a running play…</option>
                      {options.plays.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className={hint}>
                      No play on your leads is running. Start one on Plays
                      first.
                    </p>
                  ))}
                {s.action === "add_to_play" && (
                  <p className={hint}>
                    Its first email is written by Dialvo and waits for approval
                    under the play&apos;s own rules.
                  </p>
                )}
                {s.action === "assign" && (
                  <select
                    value={s.to === "rules" ? "rules" : (s.user_id ?? "")}
                    onChange={(e) =>
                      setStep(
                        i,
                        e.target.value === "rules"
                          ? { to: "rules", user_id: "" }
                          : { to: "user", user_id: e.target.value },
                      )
                    }
                    className={input}
                    aria-label="Who"
                  >
                    <option value="rules">
                      By your routing rules (only leads with no owner)
                    </option>
                    {options.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
                {s.action === "set_stage" && (
                  <select
                    value={s.stage}
                    onChange={(e) => setStep(i, { stage: e.target.value })}
                    className={input}
                    aria-label="Stage"
                  >
                    {STAGES.map((x) => (
                      <option key={x} value={x}>
                        {STAGE_LABEL[x]}
                      </option>
                    ))}
                  </select>
                )}
                {s.action === "webhook" &&
                  (options.endpoints.length ? (
                    <select
                      value={s.endpoint_id ?? ""}
                      onChange={(e) =>
                        setStep(i, { endpoint_id: e.target.value })
                      }
                      className={input}
                      aria-label="Endpoint"
                    >
                      <option value="">Choose an endpoint…</option>
                      {options.endpoints.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className={hint}>
                      Add an endpoint in Settings, API and webhooks first.
                      Deliveries are signed and retried like every other.
                    </p>
                  ))}
                {(s.action === "slack" ||
                  s.action === "note" ||
                  s.action === "task") && (
                  <textarea
                    value={s.text ?? ""}
                    onChange={(e) => setStep(i, { text: e.target.value })}
                    rows={2}
                    maxLength={s.action === "task" ? 200 : 1000}
                    placeholder={
                      s.action === "task"
                        ? "Call them back about pricing"
                        : "Write it; {{lead.name}}, {{lead.company}} and {{event.summary}} are filled in"
                    }
                    className={input}
                    aria-label="Text"
                  />
                )}
                {s.action === "slack" && !options.slack && (
                  <p className={hint}>
                    Slack isn&apos;t connected yet (Settings, Slack); until it
                    is, this step is skipped.
                  </p>
                )}
                {s.action === "task" && (
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={s.assignee}
                      onChange={(e) => setStep(i, { assignee: e.target.value })}
                      className={cn(input, "w-auto")}
                      aria-label="For"
                    >
                      <option value="owner">For the lead&apos;s owner</option>
                      <option value="team">For the team</option>
                      {options.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          For {m.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={s.due_days ?? ""}
                      onChange={(e) => setStep(i, { due_days: e.target.value })}
                      className={cn(input, "w-auto")}
                      aria-label="Due"
                    >
                      <option value="">No due date</option>
                      <option value="0">Due today</option>
                      <option value="1">Due tomorrow</option>
                      <option value="3">Due in 3 days</option>
                      <option value="7">Due in a week</option>
                    </select>
                  </div>
                )}
                {s.action === "research" && (
                  <p className={hint}>
                    Makes an account brief; its summary goes on the lead&apos;s
                    timeline. Counts against the day&apos;s briefs.
                  </p>
                )}
              </li>
            ))}
          </ol>
          {steps.length < 8 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-black/[0.06] px-4 py-3">
              <select
                value={adding}
                onChange={(e) => setAdding(e.target.value as ActionKind)}
                className={cn(input, "w-auto")}
                aria-label="Step to add"
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABEL[a]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSteps((x) => [...x, blankStep(adding)])}
                className={cn(btn.secondary, btn.small)}
              >
                <Plus aria-hidden className="size-3.5" />
                Add step
              </button>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3 px-1">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={initial.enabled}
              className="accent-[#0B0B0C]"
            />
            Switched on
          </label>
          {admin && (
            <SubmitButton>
              {initial.id ? "Save" : "Create workflow"}
            </SubmitButton>
          )}
          {!admin && (
            <p className={hint}>
              Only the workspace&apos;s owner or an admin can change workflows.
            </p>
          )}
        </div>
      </fieldset>
    </ActionForm>
  );
}
