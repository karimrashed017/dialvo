import { beforeEach, describe, expect, it } from "vitest";
import {
  check,
  readCookie,
  record,
  resetRateLimit,
  retryAfter,
  writeCookie,
} from "./rate-limit";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 19, 12);

function start(ip: string, now: number, cookie: number[] = []) {
  const { times, retryAfter } = check(ip, cookie, now);
  if (retryAfter > 0) return { ok: false as const, retryAfter };
  return { ok: true as const, times: record(ip, times, now) };
}

describe("voice demo rate limit", () => {
  beforeEach(resetRateLimit);

  it("allows three calls in ten minutes, then says when to come back", () => {
    expect(start("1.1.1.1", T0).ok).toBe(true);
    expect(start("1.1.1.1", T0 + MIN).ok).toBe(true);
    expect(start("1.1.1.1", T0 + 2 * MIN).ok).toBe(true);
    const fourth = start("1.1.1.1", T0 + 3 * MIN);
    expect(fourth).toEqual({ ok: false, retryAfter: 7 * 60 });
    // The first call has left the window.
    expect(start("1.1.1.1", T0 + 10 * MIN).ok).toBe(true);
  });

  it("counts calls that start in the same millisecond", () => {
    for (let i = 0; i < 3; i++) expect(start("1.1.1.1", T0).ok).toBe(true);
    expect(start("1.1.1.1", T0).ok).toBe(false);
  });

  it("counts each address separately", () => {
    for (let i = 0; i < 3; i++) start("1.1.1.1", T0 + i);
    expect(start("1.1.1.1", T0 + 10).ok).toBe(false);
    expect(start("2.2.2.2", T0 + 10).ok).toBe(true);
  });

  it("allows ten calls in a day", () => {
    // Four an hour apart never trips the ten-minute limit.
    for (let i = 0; i < 10; i++) {
      expect(start("1.1.1.1", T0 + i * 60 * MIN).ok).toBe(true);
    }
    const eleventh = start("1.1.1.1", T0 + 10 * 60 * MIN);
    expect(eleventh).toEqual({ ok: false, retryAfter: 14 * 60 * 60 });
    expect(start("1.1.1.1", T0 + 24 * 60 * MIN).ok).toBe(true);
  });

  it("still counts from the cookie after the server forgets", () => {
    let cookie: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = start("1.1.1.1", T0 + i, cookie);
      if (r.ok) cookie = r.times;
    }
    resetRateLimit(); // a cold start
    expect(start("1.1.1.1", T0 + 10).ok).toBe(true); // no cookie: IP only
    resetRateLimit();
    expect(start("1.1.1.1", T0 + 10, cookie).ok).toBe(false);
    // The cookie follows the browser to a new address, too.
    expect(start("9.9.9.9", T0 + 10, cookie).ok).toBe(false);
  });

  it("reads back only cookies it signed", () => {
    const times = [T0, T0 + 1];
    const cookie = writeCookie(times, "secret");
    expect(readCookie(cookie, "secret", T0 + 2)).toEqual(times);
    expect(readCookie(cookie, "other-secret", T0 + 2)).toEqual([]);
    const [payload, mac] = cookie.split(".");
    const forged = Buffer.from("[]").toString("base64url");
    expect(readCookie(`${forged}.${mac}`, "secret", T0 + 2)).toEqual([]);
    expect(readCookie(`${payload}.`, "secret", T0 + 2)).toEqual([]);
    expect(readCookie("nonsense", "secret", T0 + 2)).toEqual([]);
    expect(readCookie(undefined, "secret", T0 + 2)).toEqual([]);
  });

  it("ignores cookie times that are old or in the future", () => {
    const cookie = writeCookie([T0 - 25 * 60 * MIN, T0 + 5 * MIN], "s");
    expect(readCookie(cookie, "s", T0)).toEqual([]);
  });

  it("has nothing to wait for with no calls", () => {
    expect(retryAfter([], T0)).toBe(0);
  });
});
