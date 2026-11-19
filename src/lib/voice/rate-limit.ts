import { createHmac, timingSafeEqual } from "node:crypto";
import { RATE_LIMITS } from "./config";

// How often one visitor may start a demo call. Two counters back each other
// up: a table in this server instance's memory keyed by IP address, and a
// signed cookie holding the same start times, which still counts after the
// server instance is replaced (a cold start forgets the table). Clearing
// cookies only gets round the second one; ElevenLabs' own daily cap on the
// agent is the backstop for everything else. Nothing here is stored anywhere
// but memory and the visitor's own browser.

export const COOKIE_NAME = "dv_voice";

const LONGEST = Math.max(...RATE_LIMITS.map((l) => l.windowMs));
const MOST = Math.max(...RATE_LIMITS.map((l) => l.max));

/** Start times (ms) per IP address. */
const starts = new Map<string, number[]>();

/** Only for tests. */
export function resetRateLimit() {
  starts.clear();
}

function recent(times: number[], now: number): number[] {
  return (
    times
      // A second of slack: same-millisecond starts are nudged forward.
      .filter((t) => Number.isFinite(t) && t <= now + 1000 && now - t < LONGEST)
      .sort((a, b) => a - b)
      .slice(-MOST)
  );
}

/** Seconds until the limits allow another start; 0 if one can start now. */
export function retryAfter(times: number[], now: number): number {
  let wait = 0;
  for (const { windowMs, max } of RATE_LIMITS) {
    const inWindow = times.filter((t) => now - t < windowMs);
    if (inWindow.length >= max) {
      // Free again once the oldest start that still counts leaves the window.
      const frees = inWindow[inWindow.length - max] + windowMs;
      wait = Math.max(wait, frees - now);
    }
  }
  return Math.ceil(wait / 1000);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", `dialvo-voice-demo:${secret}`)
    .update(payload)
    .digest("base64url");
}

/** The start times in a cookie we signed; [] if it's missing or altered. */
export function readCookie(
  value: string | undefined,
  secret: string,
  now: number,
): number[] {
  if (!value) return [];
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return [];
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return [];
  }
  try {
    const times: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    );
    if (!Array.isArray(times)) return [];
    return recent(
      times.filter((t): t is number => typeof t === "number"),
      now,
    );
  } catch {
    return [];
  }
}

export function writeCookie(times: number[], secret: string): string {
  const payload = Buffer.from(JSON.stringify(times)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Whether this visitor may start a call now. The visitor's starts are the
 * IP table's and the cookie's put together, so whichever remembers more
 * decides.
 */
export function check(ip: string, cookieTimes: number[], now: number) {
  const times = recent(
    [...new Set([...(starts.get(ip) ?? []), ...cookieTimes])],
    now,
  );
  return { times, retryAfter: retryAfter(times, now) };
}

/** Counts a call that started. Returns the times to put in the cookie. */
export function record(ip: string, times: number[], now: number): number[] {
  // The two counters are merged by start time, so two starts must never
  // share one: nudge a same-millisecond start on by a millisecond.
  let at = now;
  while (times.includes(at)) at += 1;
  const next = recent([...times, at], at);
  starts.set(ip, next);
  // Keep the table from growing without end on a long-lived instance.
  if (starts.size > 5000) {
    for (const [key, value] of starts) {
      if (recent(value, now).length === 0) starts.delete(key);
    }
  }
  return next;
}

export const COOKIE_MAX_AGE = Math.ceil(LONGEST / 1000);
