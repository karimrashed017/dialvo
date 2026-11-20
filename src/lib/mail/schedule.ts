import {
  MAX_GAP_MINUTES,
  MIN_GAP_MINUTES,
  PLAN_AHEAD_DAYS,
  RAMP_START,
  RAMP_STEP,
} from "./config";

// Giving waiting emails a time and a mailbox. Pure functions: the same
// inputs and the same random numbers always give the same plan.
//
// The plan is what makes sending look like a person working through a list
// rather than a blast: emails are spread over the outbound agent's send
// window in the workspace's own time zone, a few minutes apart at random,
// rotated across the connected mailboxes, and never more in a day than each
// mailbox's allowance or the workspace's cap. The database checks all of
// this again when an email is actually claimed for sending
// (mail_send_claim), so a plan made on stale numbers can't overshoot.

export type SendWindow = { days: number[]; start: string; end: string };

export const DEFAULT_WINDOW: SendWindow = {
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "17:00",
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Local = { y: number; m: number; d: number; minutes: number; dow: number };

/** The wall-clock date and time of an instant in a zone. dow: 1 Mon .. 7 Sun. */
export function localParts(at: Date, timeZone: string): Local {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dow =
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) +
    1;
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    dow,
  };
}

/** The instant a wall-clock date and time happens in a zone. */
export function instantAt(
  timeZone: string,
  y: number,
  m: number,
  d: number,
  minutes: number,
): Date {
  const wanted = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = wanted;
  // Twice: the offset at the first guess can differ from the offset at the
  // answer when a clock change falls in between.
  for (let i = 0; i < 2; i++) {
    const l = localParts(new Date(guess), timeZone);
    const shown = Date.UTC(l.y, l.m - 1, l.d, 0, l.minutes);
    guess += wanted - shown;
  }
  return new Date(guess);
}

const dayKey = (l: Local) =>
  `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;

function clock(text: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(text ?? "");
  if (!match) return fallback;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : fallback;
}

/** A window as stored on an agent, made safe to work with. */
export function readWindow(value: unknown): SendWindow {
  const v = (value ?? {}) as Partial<SendWindow>;
  const days = Array.isArray(v.days)
    ? v.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    : DEFAULT_WINDOW.days;
  return {
    days,
    start: typeof v.start === "string" ? v.start : DEFAULT_WINDOW.start,
    end: typeof v.end === "string" ? v.end : DEFAULT_WINDOW.end,
  };
}

/**
 * The first instant at or after `at` that is inside the send window, and
 * when that day's window closes. Null when the window never opens (no days,
 * or it ends before it starts).
 */
export function nextOpen(
  at: Date,
  window: SendWindow,
  timeZone: string,
): { at: Date; closes: Date; day: string } | null {
  const start = clock(window.start, 9 * 60);
  const end = clock(window.end, 17 * 60);
  if (end <= start || window.days.length === 0) return null;
  let cursor = at;
  for (let i = 0; i < 9; i++) {
    const l = localParts(cursor, timeZone);
    if (window.days.includes(l.dow) && l.minutes < end) {
      const opens = instantAt(timeZone, l.y, l.m, l.d, start);
      const closes = instantAt(timeZone, l.y, l.m, l.d, end);
      const when = cursor.getTime() < opens.getTime() ? opens : cursor;
      if (when.getTime() < closes.getTime())
        return { at: when, closes, day: dayKey(l) };
    }
    // Midnight tonight in that zone, plus a minute to be safely in tomorrow.
    cursor = new Date(
      instantAt(timeZone, l.y, l.m, l.d, 24 * 60).getTime() + MINUTE,
    );
  }
  return null;
}

/**
 * How many emails a mailbox may send on a given day. A newly connected
 * mailbox starts low and climbs: 10 on its first day, 15 the next, and so
 * on up to its own limit. The database computes the same thing
 * (private.mailbox_allowance).
 */
export function allowanceOn(
  mailbox: { daily_limit: number; connected_at: string },
  day: Date,
  timeZone: string,
  ramp = { start: RAMP_START, step: RAMP_STEP },
): number {
  const a = localParts(new Date(mailbox.connected_at), timeZone);
  const b = localParts(day, timeZone);
  const days = Math.round(
    (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY,
  );
  return Math.min(
    mailbox.daily_limit,
    Math.max(ramp.start, 1) + Math.max(ramp.step, 0) * Math.max(days, 0),
  );
}

export type PlanMailbox = {
  id: string;
  daily_limit: number;
  connected_at: string;
  /** Sent (or claimed) today already. */
  used: number;
  /** Times of emails that already have a slot. */
  planned: string[];
};

export type Waiting =
  | { draft_id: string }
  | {
      email_id: string;
      /** Follow-ups and replies leave from their thread's mailbox. */
      mailbox_id: string | null;
      /** A teammate's own reply: goes now, whatever the window or the caps. */
      by_person: boolean;
      kind: "first" | "followup" | "reply";
    };

export type Plan = {
  draft_id?: string;
  email_id?: string;
  mailbox_id: string;
  send_at: string;
};

export type PlanInput = {
  now: Date;
  timeZone: string;
  window: SendWindow;
  mailboxes: PlanMailbox[];
  waiting: Waiting[];
  /** Sent (or claimed) today across the workspace. */
  sentToday: number;
  workspaceCap: number;
  /** 0 <= n < 1. Injected so tests can fix it. */
  random?: () => number;
  ramp?: { start: number; step: number };
};

/**
 * Gives as many waiting emails as possible a mailbox and a time within the
 * next week. Whatever doesn't fit is left out and simply waits for the next
 * run of the planner.
 */
export function planSchedule(input: PlanInput): Plan[] {
  const { now, timeZone, window, workspaceCap } = input;
  const random = input.random ?? Math.random;
  const gap = () =>
    Math.round(
      (MIN_GAP_MINUTES + random() * (MAX_GAP_MINUTES - MIN_GAP_MINUTES)) *
        MINUTE,
    );
  const horizon = now.getTime() + PLAN_AHEAD_DAYS * DAY;
  const today = dayKey(localParts(now, timeZone));

  // Per mailbox: how many are already set for each day, and the earliest
  // moment its next email may go.
  const boxes = input.mailboxes.map((m) => {
    const perDay = new Map<string, number>([[today, m.used]]);
    let last = 0;
    for (const iso of m.planned) {
      const at = new Date(iso);
      const key = dayKey(localParts(at, timeZone));
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
      last = Math.max(last, at.getTime());
    }
    return { ...m, perDay, free: last ? last + gap() : now.getTime() };
  });
  const workspacePerDay = new Map<string, number>([[today, input.sentToday]]);
  for (const b of boxes)
    for (const [day, count] of b.perDay)
      if (day !== today)
        workspacePerDay.set(day, (workspacePerDay.get(day) ?? 0) + count);
  // Today's count already includes what was sent; add what is still planned.
  for (const m of input.mailboxes)
    for (const iso of m.planned)
      if (dayKey(localParts(new Date(iso), timeZone)) === today)
        workspacePerDay.set(today, (workspacePerDay.get(today) ?? 0) + 1);

  type Box = (typeof boxes)[number];
  /** The next slot this mailbox could take, respecting window and caps. */
  const slotFor = (box: Box, capped: boolean) => {
    let from = new Date(Math.max(box.free, now.getTime()));
    for (let i = 0; i < PLAN_AHEAD_DAYS + 2; i++) {
      const open = nextOpen(from, window, timeZone);
      if (!open || open.at.getTime() > horizon) return null;
      const dayFull =
        capped &&
        ((box.perDay.get(open.day) ?? 0) >=
          allowanceOn(box, open.at, timeZone, input.ramp) ||
          (workspacePerDay.get(open.day) ?? 0) >= workspaceCap);
      if (!dayFull) {
        // A window that has only just opened doesn't start on the dot.
        const justOpened = open.at.getTime() > from.getTime();
        const at = justOpened
          ? Math.min(
              open.at.getTime() + Math.round(random() * 10 * MINUTE),
              open.closes.getTime() - MINUTE,
            )
          : open.at.getTime();
        return { at, day: open.day };
      }
      from = new Date(open.closes.getTime() + MINUTE);
    }
    return null;
  };

  const plans: Plan[] = [];
  for (const item of input.waiting) {
    const fixed = "email_id" in item ? item.mailbox_id : null;
    if ("email_id" in item && item.by_person) {
      const box = boxes.find((b) => b.id === fixed);
      if (box)
        plans.push({
          email_id: item.email_id,
          mailbox_id: box.id,
          send_at: now.toISOString(),
        });
      continue;
    }
    // An answer to someone who wrote isn't cold outreach: it keeps to the
    // window and the spacing, not to the caps.
    const capped = !("email_id" in item && item.kind === "reply");
    const candidates = fixed ? boxes.filter((b) => b.id === fixed) : boxes;
    let best: { box: Box; at: number; day: string } | null = null;
    for (const box of candidates) {
      const slot = slotFor(box, capped);
      if (!slot) continue;
      // Earliest slot wins; a tie goes to the mailbox with less to do that
      // day, which is what rotates the mailboxes.
      if (
        !best ||
        slot.at < best.at ||
        (slot.at === best.at &&
          (box.perDay.get(slot.day) ?? 0) <
            (best.box.perDay.get(best.day) ?? 0))
      )
        best = { box, ...slot };
    }
    if (!best) continue;
    plans.push({
      ...("draft_id" in item
        ? { draft_id: item.draft_id }
        : { email_id: item.email_id }),
      mailbox_id: best.box.id,
      send_at: new Date(best.at).toISOString(),
    });
    best.box.free = best.at + gap();
    best.box.perDay.set(best.day, (best.box.perDay.get(best.day) ?? 0) + 1);
    workspacePerDay.set(best.day, (workspacePerDay.get(best.day) ?? 0) + 1);
  }
  return plans;
}

/** When to try again after the mail server said "try later". */
export function retryAt(
  attempt: number,
  backoffMinutes: number[],
  now: Date,
): Date {
  const minutes =
    backoffMinutes[Math.min(attempt - 1, backoffMinutes.length - 1)] ?? 10;
  return new Date(now.getTime() + minutes * MINUTE);
}
