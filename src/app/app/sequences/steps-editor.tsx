"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, hint, input } from "../_ui/kit";

// The steps of one sequence: add, remove and reorder follow-ups, each with
// its own wait and its own instructions for the writer. What it holds goes
// to the Server Action as JSON in one hidden field ("steps"); the action and
// the database check it again.

export type EditorStep = { wait_days: number; angle: string };

const MAX = 5;
const WAIT_MAX = 60;
const ANGLE_MAX = 600;

export function StepsEditor({
  initial,
  disabled,
}: {
  initial: EditorStep[];
  disabled?: boolean;
}) {
  const [steps, setSteps] = useState<EditorStep[]>(initial);
  const set = (i: number, patch: Partial<EditorStep>) =>
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: number) =>
    setSteps((s) => {
      const next = [...s];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item);
      return next;
    });
  // Which day after the first email each follow-up goes.
  const days = steps.reduce<number[]>(
    (acc, step) => [...acc, (acc.at(-1) ?? 0) + (step.wait_days || 0)],
    [],
  );
  return (
    <div className="space-y-2">
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <div className="rounded-xl border border-black/[0.08] px-3 py-2 text-[12.5px]">
        <span className="font-medium">First email</span>
        <span className="text-[#0B0B0C]/55">
          {" "}
          · written by the play or search, sent once you approve it
        </span>
      </div>
      {steps.map((step, i) => {
        return (
          <div
            key={i}
            className="space-y-2 rounded-xl border border-black/[0.08] p-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="font-medium">Follow-up {i + 1}</span>
              <label className="flex items-center gap-1.5 text-[#0B0B0C]/70">
                waits
                <input
                  type="number"
                  min={1}
                  max={WAIT_MAX}
                  required
                  disabled={disabled}
                  value={step.wait_days}
                  onChange={(e) =>
                    set(i, { wait_days: Number(e.target.value) })
                  }
                  aria-label={`Follow-up ${i + 1}: days after the email before it`}
                  className={cn(input, "h-8 w-[72px] px-2 py-1 text-[13px]")}
                />
                days after the email before it
              </label>
              <span className="text-[#0B0B0C]/45 tabular-nums">
                (day {days[i]})
              </span>
              <span className="ml-auto flex gap-1">
                <button
                  type="button"
                  disabled={disabled || i === 0}
                  onClick={() => move(i, -1)}
                  className={cn(btn.ghost, btn.small, "px-2")}
                  aria-label={`Move follow-up ${i + 1} up`}
                >
                  <ArrowUp aria-hidden className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={disabled || i === steps.length - 1}
                  onClick={() => move(i, 1)}
                  className={cn(btn.ghost, btn.small, "px-2")}
                  aria-label={`Move follow-up ${i + 1} down`}
                >
                  <ArrowDown aria-hidden className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setSteps((s) => s.filter((_, j) => j !== i))}
                  className={cn(btn.ghost, btn.small, "px-2")}
                  aria-label={`Remove follow-up ${i + 1}`}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </span>
            </div>
            <textarea
              rows={2}
              maxLength={ANGLE_MAX}
              disabled={disabled}
              value={step.angle}
              onChange={(e) => set(i, { angle: e.target.value })}
              aria-label={`Follow-up ${i + 1}: what it should say`}
              placeholder="What this one should be about (optional). For example: share the setup guide, or ask one question about their timing."
              className={cn(input, "text-[13px]")}
            />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || steps.length >= MAX}
          onClick={() =>
            setSteps((s) => [...s, { wait_days: s.length ? 4 : 3, angle: "" }])
          }
          className={cn(btn.secondary, btn.small)}
        >
          <Plus aria-hidden className="size-3.5" />
          Add a follow-up
        </button>
        <span className={hint}>
          {steps.length === 0
            ? "No follow-ups: just the first email."
            : `${steps.length} of ${MAX} follow-ups.`}{" "}
          A reply, an unsubscribe or a bounce stops every step after it.
        </span>
      </div>
    </div>
  );
}
