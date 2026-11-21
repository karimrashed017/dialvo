import { describe, expect, it } from "vitest";
import { PURPOSE_SEQUENCES, readSteps, stepDays } from "./steps";

describe("a sequence's steps", () => {
  it("reads up to five, each with its own wait and instructions", () => {
    const read = readSteps(
      JSON.stringify([
        { wait_days: 3, angle: "  Ask one question.  " },
        { wait_days: 7, angle: "" },
      ]),
    );
    expect(read).toEqual({
      ok: true,
      steps: [
        { wait_days: 3, angle: "Ask one question." },
        { wait_days: 7, angle: "" },
      ],
    });
    expect(readSteps("[]")).toEqual({ ok: true, steps: [] });
  });

  it("refuses six follow-ups, waits out of range and unreadable input", () => {
    const six = Array.from({ length: 6 }, () => ({ wait_days: 2 }));
    expect(readSteps(JSON.stringify(six)).ok).toBe(false);
    for (const wait of [0, 61, 2.5, "x"])
      expect(readSteps(JSON.stringify([{ wait_days: wait }])).ok).toBe(false);
    expect(
      readSteps(JSON.stringify([{ wait_days: 2, angle: "x".repeat(601) }])).ok,
    ).toBe(false);
    expect(readSteps("{").ok).toBe(false);
    expect(readSteps(JSON.stringify({ wait_days: 2 })).ok).toBe(false);
  });

  it("says which day after the first email each one goes", () => {
    expect(
      stepDays([
        { wait_days: 3, angle: "" },
        { wait_days: 7, angle: "" },
        { wait_days: 14, angle: "" },
      ]),
    ).toEqual([3, 10, 24]);
  });

  it("ships ready-made onboarding and nurture steps the database accepts", () => {
    for (const s of Object.values(PURPOSE_SEQUENCES))
      expect(readSteps(JSON.stringify(s.steps)).ok).toBe(true);
  });
});
