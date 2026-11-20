import { describe, expect, it } from "vitest";
import { billingEnforced, planLine, trialBanner, trialState } from "./trial";

const NOW = new Date("2026-11-20T12:00:00Z");
const inDays = (d: number) =>
  new Date(NOW.getTime() + d * 86_400_000).toISOString();

describe("billingEnforced", () => {
  it("is off unless the switch is exactly 1", () => {
    expect(billingEnforced({})).toBe(false);
    expect(billingEnforced({ BILLING_ENFORCED: "" })).toBe(false);
    expect(billingEnforced({ BILLING_ENFORCED: "true" })).toBe(false);
    expect(billingEnforced({ BILLING_ENFORCED: "0" })).toBe(false);
    expect(billingEnforced({ BILLING_ENFORCED: "1" })).toBe(true);
  });
});

describe("trialState", () => {
  it("counts whole days left, rounded up", () => {
    const state = (d: number) =>
      trialState(
        { trial_ends_at: inDays(d), billing_status: "trialing" },
        NOW,
        false,
      );
    expect(state(7)).toEqual({ phase: "trial", daysLeft: 7, locked: false });
    expect(state(5.2).daysLeft).toBe(6);
    expect(state(0.01).daysLeft).toBe(1);
  });

  it("ends the trial at its last moment, and blocks nothing with the switch off", () => {
    for (const d of [0, -0.01, -30])
      expect(
        trialState(
          { trial_ends_at: inDays(d), billing_status: "trialing" },
          NOW,
          false,
        ),
      ).toEqual({ phase: "ended", daysLeft: 0, locked: false });
  });

  it("locks an ended trial only when billing is enforced", () => {
    const ended = { trial_ends_at: inDays(-1), billing_status: "trialing" };
    expect(trialState(ended, NOW, true).locked).toBe(true);
    expect(trialState(ended, NOW, false).locked).toBe(false);
    // A running trial is never locked, enforced or not.
    expect(
      trialState(
        { trial_ends_at: inDays(2), billing_status: "trialing" },
        NOW,
        true,
      ).locked,
    ).toBe(false);
  });

  it("never locks a paid workspace, whatever its trial date says", () => {
    expect(
      trialState(
        { trial_ends_at: inDays(-90), billing_status: "active" },
        NOW,
        true,
      ),
    ).toEqual({ phase: "paid", daysLeft: 0, locked: false });
  });

  it("treats a lapsed plan like an ended trial", () => {
    for (const billing_status of ["past_due", "canceled"])
      expect(
        trialState({ trial_ends_at: inDays(3), billing_status }, NOW, true),
      ).toEqual({ phase: "ended", daysLeft: 0, locked: true });
  });

  it("never locks a workspace whose dates can't be read", () => {
    for (const trial_ends_at of [undefined, null, "", "not a date"])
      expect(trialState({ trial_ends_at }, NOW, true).locked).toBe(false);
  });
});

describe("trialBanner", () => {
  const banner = (d: number, enforced: boolean, billing_status = "trialing") =>
    trialBanner(
      trialState({ trial_ends_at: inDays(d), billing_status }, NOW, enforced),
    );

  it("says how long is left", () => {
    expect(banner(6, false)?.text).toBe("6 days left in your free trial");
    expect(banner(0.5, false)?.text).toBe("1 day left in your free trial");
    expect(banner(6, false)?.ended).toBe(false);
  });

  it("after the end, with the switch off, says plans are coming and how to reach us", () => {
    const b = banner(-1, false)!;
    expect(b.text).toMatch(/^Your free trial has ended/);
    expect(b.text).toMatch(/plans are coming/i);
    expect(b.text).toMatch(/nothing has been switched off/i);
    expect(b.action).toEqual({
      label: "contact@trydialvo.com",
      href: "mailto:contact@trydialvo.com",
    });
  });

  it("after the end, enforced, asks for a plan", () => {
    const b = banner(-1, true)!;
    expect(b.text).toMatch(/^Your free trial has ended/);
    expect(b.text).toMatch(/stopped replying/);
    expect(b.action?.label).toBe("Pick a plan");
  });

  it("shows nothing once a plan is active", () => {
    expect(banner(-10, true, "active")).toBeNull();
  });
});

describe("planLine", () => {
  const line = (d: number, billing_status = "trialing") =>
    planLine(
      trialState({ trial_ends_at: inDays(d), billing_status }, NOW, false),
      "Starter",
    );

  it("says a trial is a trial, not a plan", () => {
    expect(line(6)).toBe("Free trial · 6 days left");
    expect(line(0.5)).toBe("Free trial · 1 day left");
  });

  it("names the plan only once it is paid for", () => {
    expect(line(3, "active")).toBe("Starter plan");
    expect(line(-20, "active")).toBe("Starter plan");
  });

  it("says when the trial is over", () => {
    expect(line(-1)).toBe("Free trial ended");
    expect(line(3, "canceled")).toBe("Free trial ended");
  });
});
