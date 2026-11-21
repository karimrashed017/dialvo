import { MAX_FOLLOWUPS, STEP_WAIT_DAYS_MAX } from "@/lib/mail/config";

// A sequence's follow-up steps, as the builder sends them and the database
// keeps them (sequences.steps): each waits a number of days after the email
// before it and may carry the team's instructions for the writer. The
// database checks the same rules again (private.sequence_steps_ok).

export type Step = { wait_days: number; angle: string };

export const ANGLE_MAX_CHARS = 600;

export type StepsRead =
  { ok: true; steps: Step[] } | { ok: false; error: string };

/** Reads the builder's JSON. Never throws. */
export function readSteps(raw: unknown): StepsRead {
  let value: unknown;
  try {
    value = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
  } catch {
    return { ok: false, error: "The steps couldn't be read. Try again." };
  }
  if (!Array.isArray(value))
    return { ok: false, error: "The steps couldn't be read. Try again." };
  if (value.length > MAX_FOLLOWUPS)
    return {
      ok: false,
      error: `A sequence has at most ${MAX_FOLLOWUPS} follow-ups.`,
    };
  const steps: Step[] = [];
  for (const [i, item] of value.entries()) {
    const wait = Number((item as { wait_days?: unknown })?.wait_days);
    if (!Number.isInteger(wait) || wait < 1 || wait > STEP_WAIT_DAYS_MAX)
      return {
        ok: false,
        error: `Follow-up ${i + 1}: wait 1 to ${STEP_WAIT_DAYS_MAX} days after the email before it.`,
      };
    const angle = String((item as { angle?: unknown })?.angle ?? "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim();
    if (angle.length > ANGLE_MAX_CHARS)
      return {
        ok: false,
        error: `Follow-up ${i + 1}: keep the instructions under ${ANGLE_MAX_CHARS} characters.`,
      };
    steps.push({ wait_days: wait, angle });
  }
  return { ok: true, steps };
}

/** "Day 3, day 10, day 24": when each follow-up goes, after the first email. */
export function stepDays(steps: Step[]): number[] {
  let day = 0;
  return steps.map((s) => (day += s.wait_days));
}

/** The ready-made sequences two plays start with. The team can edit both. */
export const PURPOSE_SEQUENCES = {
  onboarding: {
    name: "Customer onboarding",
    steps: [
      {
        wait_days: 3,
        angle:
          "Check in on getting started: ask whether the first setup step the Knowledge describes went smoothly, and say where to get help.",
      },
      {
        wait_days: 7,
        angle:
          "Share one useful tip or feature from the Knowledge that new customers often miss. No selling.",
      },
      {
        wait_days: 14,
        angle:
          "Ask how it is going so far and whether anything is in their way. Offer a short call with the team if it would help.",
      },
    ],
  },
  nurture: {
    name: "Lead nurture",
    steps: [
      {
        wait_days: 14,
        angle:
          "Share a different useful thing from the Knowledge, such as the answer to a common question. Ask for nothing more than an easy reply.",
      },
      {
        wait_days: 21,
        angle:
          "Explain how one thing the business does works, or give a practical tip from the Knowledge. No ask.",
      },
      {
        wait_days: 30,
        angle:
          "A last short note: say you won't keep writing, and that they can reply any time if it becomes relevant.",
      },
    ],
  },
} satisfies Record<string, { name: string; steps: Step[] }>;

export type Purpose = keyof typeof PURPOSE_SEQUENCES;
