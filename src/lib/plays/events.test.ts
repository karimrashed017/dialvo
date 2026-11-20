import { describe, expect, it } from "vitest";
import { hashApiKey, keyFromHeader, makeApiKey } from "./api-key";
import { readEventBody } from "./events";

describe("API keys", () => {
  it("are made random, shown once, and stored only as a hash", () => {
    const a = makeApiKey();
    const b = makeApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.key).toMatch(/^dv_live_[A-Za-z0-9_-]{32}$/);
    expect(a.prefix).toBe(a.key.slice(0, 12));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).not.toContain(a.key.slice(8));
  });

  it("are read only from a Bearer header in the right shape", () => {
    const { key } = makeApiKey();
    expect(keyFromHeader(`Bearer ${key}`)).toBe(key);
    expect(keyFromHeader(key)).toBeNull();
    expect(keyFromHeader("Bearer sk-something")).toBeNull();
    expect(keyFromHeader(null)).toBeNull();
  });
});

describe("an event's body", () => {
  it("takes the five events, an email and small flat properties", () => {
    expect(
      readEventBody({
        email: " Dana@Example.com ",
        event: "trial_ending",
        occurred_at: "2026-11-20T10:00:00Z",
        properties: { ends_at: "2026-11-23", seats: 3, paid: false },
      }),
    ).toEqual({
      ok: true,
      value: {
        email: "dana@example.com",
        event: "trial_ending",
        occurred_at: "2026-11-20T10:00:00.000Z",
        properties: { ends_at: "2026-11-23", seats: 3, paid: false },
      },
    });
  });

  it("refuses what it doesn't take", () => {
    expect(readEventBody({ email: "x", event: "trial_started" }).ok).toBe(
      false,
    );
    expect(
      readEventBody({ email: "a@b.example", event: "deleted_account" }).ok,
    ).toBe(false);
    expect(
      readEventBody({
        email: "a@b.example",
        event: "limit_reached",
        properties: { nested: { a: 1 } },
      }).ok,
    ).toBe(false);
    expect(
      readEventBody({
        email: "a@b.example",
        event: "limit_reached",
        occurred_at: "yesterday",
      }).ok,
    ).toBe(false);
    expect(readEventBody([1]).ok).toBe(false);
  });

  it("strips markup from property values", () => {
    const r = readEventBody({
      email: "a@b.example",
      event: "limit_reached",
      properties: { limit: "<b>projects</b>" },
    });
    expect(r.ok && r.value.properties.limit).toBe(" b projects /b ");
  });
});
