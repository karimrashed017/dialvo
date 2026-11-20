import { describe, expect, it } from "vitest";
import {
  allowanceOn,
  instantAt,
  localParts,
  nextOpen,
  planSchedule,
  readWindow,
  retryAt,
  type PlanInput,
  type PlanMailbox,
} from "./schedule";

const WINDOW = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
const LONDON = "Europe/London";
// Monday 23 Nov 2026, 10:00 in London (GMT).
const MONDAY_10 = new Date("2026-11-23T10:00:00Z");

const box = (id: string, o: Partial<PlanMailbox> = {}): PlanMailbox => ({
  id,
  daily_limit: 30,
  connected_at: "2026-10-01T09:00:00Z",
  used: 0,
  planned: [],
  ...o,
});
const drafts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ draft_id: `d${i + 1}` }));
const plan = (o: Partial<PlanInput>) =>
  planSchedule({
    now: MONDAY_10,
    timeZone: LONDON,
    window: WINDOW,
    mailboxes: [box("a")],
    waiting: [],
    sentToday: 0,
    workspaceCap: 150,
    random: () => 0.5,
    ...o,
  });
const minutesApart = (a: string, b: string) =>
  (new Date(b).getTime() - new Date(a).getTime()) / 60000;
const local = (iso: string, tz = LONDON) => localParts(new Date(iso), tz);

describe("the send window", () => {
  it("is read in the workspace's own time zone", () => {
    // 08:30 in New York on a Monday is 13:30 UTC: not open yet there.
    const early = new Date("2026-11-23T13:30:00Z");
    const open = nextOpen(early, WINDOW, "America/New_York")!;
    expect(open.at.toISOString()).toBe("2026-11-23T14:00:00.000Z");
    expect(open.closes.toISOString()).toBe("2026-11-23T22:00:00.000Z");
    // The same instant is inside the window in London.
    expect(nextOpen(early, WINDOW, LONDON)!.at).toEqual(early);
  });

  it("skips evenings and weekends", () => {
    const fridayEvening = new Date("2026-11-27T18:00:00Z");
    expect(nextOpen(fridayEvening, WINDOW, LONDON)!.at.toISOString()).toBe(
      "2026-11-30T09:00:00.000Z",
    );
  });

  it("follows the clocks when they change", () => {
    // British Summer Time: 09:00 in London is 08:00 UTC.
    expect(instantAt(LONDON, 2026, 6, 15, 9 * 60).toISOString()).toBe(
      "2026-06-15T08:00:00.000Z",
    );
    const open = nextOpen(new Date("2026-06-15T05:00:00Z"), WINDOW, LONDON)!;
    expect(open.at.toISOString()).toBe("2026-06-15T08:00:00.000Z");
  });

  it("never opens when it has no days or ends before it starts", () => {
    expect(nextOpen(MONDAY_10, { ...WINDOW, days: [] }, LONDON)).toBeNull();
    expect(
      nextOpen(MONDAY_10, { ...WINDOW, start: "17:00", end: "09:00" }, LONDON),
    ).toBeNull();
    expect(readWindow({ days: ["x", 9, 2], start: 5 })).toEqual({
      days: [2],
      start: "09:00",
      end: "17:00",
    });
  });
});

describe("the ramp", () => {
  const m = { daily_limit: 30, connected_at: "2026-11-23T10:00:00Z" };
  const on = (day: string, mailbox = m) =>
    allowanceOn(mailbox, new Date(day), LONDON);

  it("starts a new mailbox at 10 a day and adds 5 a day up to its limit", () => {
    expect(on("2026-11-23T16:00:00Z")).toBe(10);
    expect(on("2026-11-24T09:00:00Z")).toBe(15);
    expect(on("2026-11-25T09:00:00Z")).toBe(20);
    expect(on("2026-11-26T09:00:00Z")).toBe(25);
    expect(on("2026-11-27T09:00:00Z")).toBe(30);
    expect(on("2026-12-25T09:00:00Z")).toBe(30);
  });

  it("never passes the mailbox's own limit, whatever the ramp says", () => {
    expect(on("2026-11-23T16:00:00Z", { ...m, daily_limit: 6 })).toBe(6);
    expect(on("2027-01-01T09:00:00Z", { ...m, daily_limit: 50 })).toBe(50);
  });

  it("counts days in the workspace's zone, not UTC", () => {
    // Connected 23:30 on the 23rd in Los Angeles (07:30 UTC on the 24th).
    const la = { daily_limit: 30, connected_at: "2026-11-24T07:30:00Z" };
    const at = new Date("2026-11-24T20:00:00Z"); // noon on the 24th in LA
    expect(allowanceOn(la, at, "America/Los_Angeles")).toBe(15);
    expect(allowanceOn(la, at, "UTC")).toBe(10);
  });
});

describe("the plan", () => {
  it("spreads emails out with gaps of a few minutes, not all at once", () => {
    const plans = plan({ waiting: drafts(6) });
    expect(plans).toHaveLength(6);
    expect(plans[0].send_at).toBe(MONDAY_10.toISOString());
    for (let i = 1; i < plans.length; i++) {
      const gap = minutesApart(plans[i - 1].send_at, plans[i].send_at);
      expect(gap).toBeGreaterThanOrEqual(4);
      expect(gap).toBeLessThanOrEqual(11);
    }
  });

  it("uses random gaps: different numbers, different times", () => {
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const plans = plan({ waiting: drafts(8), random });
    const gaps = plans
      .slice(1)
      .map((p, i) => minutesApart(plans[i].send_at, p.send_at));
    expect(new Set(gaps).size).toBeGreaterThan(3);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(11);
  });

  it("rotates across mailboxes", () => {
    const plans = plan({
      mailboxes: [box("a"), box("b"), box("c")],
      waiting: drafts(9),
    });
    const counts = new Map<string, number>();
    for (const p of plans)
      counts.set(p.mailbox_id, (counts.get(p.mailbox_id) ?? 0) + 1);
    expect([...counts.values()]).toEqual([3, 3, 3]);
    // No mailbox sends two in a row while another is free.
    expect(
      plans
        .slice(0, 3)
        .map((p) => p.mailbox_id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("stays inside each mailbox's allowance for the day and rolls the rest over", () => {
    // Connected today: 10 today, 15 tomorrow.
    const fresh = box("a", { connected_at: MONDAY_10.toISOString(), used: 4 });
    const plans = plan({ mailboxes: [fresh], waiting: drafts(20) });
    const perDay = new Map<number, number>();
    for (const p of plans) {
      const d = local(p.send_at).d;
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    expect(perDay.get(23)).toBe(6); // 10 allowed, 4 already sent
    expect(perDay.get(24)).toBe(14); // the rest, within tomorrow's 15
    expect(plans).toHaveLength(20);
  });

  it("counts emails that already have a slot", () => {
    const planned = ["2026-11-23T10:05:00Z", "2026-11-23T10:12:00Z"];
    const fresh = box("a", {
      connected_at: MONDAY_10.toISOString(),
      used: 7,
      planned,
    });
    const plans = plan({ mailboxes: [fresh], waiting: drafts(3) });
    // 7 sent + 2 planned leaves one for today.
    expect(plans.filter((p) => local(p.send_at).d === 23)).toHaveLength(1);
    // And it goes after the last planned one, with a gap.
    expect(
      minutesApart("2026-11-23T10:12:00Z", plans[0].send_at),
    ).toBeGreaterThanOrEqual(4);
  });

  it("keeps the workspace under its daily cap across mailboxes", () => {
    const plans = plan({
      mailboxes: [box("a"), box("b")],
      waiting: drafts(12),
      sentToday: 145,
      workspaceCap: 150,
    });
    const today = plans.filter((p) => local(p.send_at).d === 23);
    expect(today).toHaveLength(5);
    expect(plans).toHaveLength(12);
  });

  it("only ever picks times inside the window", () => {
    const plans = plan({
      now: new Date("2026-11-27T16:40:00Z"), // Friday, 20 minutes to closing
      waiting: drafts(30),
    });
    expect(plans.length).toBeGreaterThan(3);
    for (const p of plans) {
      const l = local(p.send_at);
      expect(WINDOW.days).toContain(l.dow);
      expect(l.minutes).toBeGreaterThanOrEqual(9 * 60);
      expect(l.minutes).toBeLessThan(17 * 60);
    }
    // What didn't fit before closing went to Monday, not to the weekend.
    expect(plans.some((p) => local(p.send_at).d === 30)).toBe(true);
  });

  it("plans at most a week ahead and leaves the rest waiting", () => {
    const tiny = box("a", { daily_limit: 2 });
    const plans = plan({ mailboxes: [tiny], waiting: drafts(40) });
    expect(plans.length).toBeLessThan(40);
    expect(plans.length).toBeGreaterThanOrEqual(10);
    const last = new Date(plans.at(-1)!.send_at).getTime();
    expect(last - MONDAY_10.getTime()).toBeLessThanOrEqual(7 * 86400000);
  });

  it("keeps a follow-up or a reply on its own mailbox, and skips it if that mailbox isn't available", () => {
    const plans = plan({
      mailboxes: [box("a"), box("b")],
      waiting: [
        { email_id: "f1", mailbox_id: "b", by_person: false, kind: "followup" },
        {
          email_id: "f2",
          mailbox_id: "gone",
          by_person: false,
          kind: "followup",
        },
        { email_id: "f3", mailbox_id: "b", by_person: false, kind: "followup" },
      ],
    });
    expect(plans.map((p) => [p.email_id, p.mailbox_id])).toEqual([
      ["f1", "b"],
      ["f3", "b"],
    ]);
  });

  it("sends a person's own reply now, whatever the window or the caps", () => {
    const saturdayNight = new Date("2026-11-28T23:00:00Z");
    const plans = plan({
      now: saturdayNight,
      mailboxes: [box("a", { used: 30 })],
      sentToday: 150,
      waiting: [
        { email_id: "mine", mailbox_id: "a", by_person: true, kind: "reply" },
        { draft_id: "cold" },
      ],
    });
    expect(plans[0]).toEqual({
      email_id: "mine",
      mailbox_id: "a",
      send_at: saturdayNight.toISOString(),
    });
    // The cold email waits for Monday.
    expect(local(plans[1].send_at)).toMatchObject({ d: 30, dow: 1 });
  });

  it("lets the agent's answer to a reply past the caps, but not past the window", () => {
    const plans = plan({
      mailboxes: [box("a", { used: 30 })],
      sentToday: 150,
      waiting: [
        {
          email_id: "answer",
          mailbox_id: "a",
          by_person: false,
          kind: "reply",
        },
        { draft_id: "cold" },
      ],
    });
    expect(local(plans[0].send_at).d).toBe(23);
    expect(local(plans[1].send_at).d).toBe(24);
  });

  it("plans nothing with no mailbox or a window that never opens", () => {
    expect(plan({ mailboxes: [], waiting: drafts(3) })).toEqual([]);
    expect(
      plan({ window: { ...WINDOW, days: [] }, waiting: drafts(3) }),
    ).toEqual([]);
  });
});

describe("retries", () => {
  it("back off: ten minutes, then an hour", () => {
    const now = new Date("2026-11-23T10:00:00Z");
    expect(retryAt(1, [10, 60], now).toISOString()).toBe(
      "2026-11-23T10:10:00.000Z",
    );
    expect(retryAt(2, [10, 60], now).toISOString()).toBe(
      "2026-11-23T11:00:00.000Z",
    );
    expect(retryAt(9, [10, 60], now).toISOString()).toBe(
      "2026-11-23T11:00:00.000Z",
    );
  });
});
