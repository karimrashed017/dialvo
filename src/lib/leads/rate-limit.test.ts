import { describe, expect, it } from "vitest";
import { createLimiter } from "./rate-limit";

describe("createLimiter", () => {
  it("lets `max` through per window, per key, then says how long to wait", () => {
    const limiter = createLimiter({ windowMs: 60_000, max: 3 });
    const t = 1_000_000;
    expect(limiter.take("a", t)).toBe(0);
    expect(limiter.take("a", t + 1000)).toBe(0);
    expect(limiter.take("a", t + 2000)).toBe(0);
    expect(limiter.take("a", t + 3000)).toBe(57);
    // Refused attempts don't extend the wait.
    expect(limiter.take("a", t + 30_000)).toBe(30);
    expect(limiter.take("b", t + 3000)).toBe(0);
    // The oldest hit leaves the window.
    expect(limiter.take("a", t + 60_000)).toBe(0);
    expect(limiter.take("a", t + 60_500)).toBe(1);
  });

  it("can be reset", () => {
    const limiter = createLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.take("a", 0)).toBe(0);
    expect(limiter.take("a", 1)).toBeGreaterThan(0);
    limiter.reset();
    expect(limiter.take("a", 2)).toBe(0);
  });
});
