import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeApiKey } from "@/lib/plays/api-key";

const recordEvent = vi.fn();
vi.mock("@/lib/plays/store", () => ({
  createPlayStore: () => ({ recordEvent }),
}));

const { POST } = await import("./route");
const { key, hash } = makeApiKey();

const post = (body: unknown, auth = `Bearer ${key}`, ip = "203.0.113.1") =>
  POST(
    new Request("https://trydialvo.com/api/v1/events", {
      method: "POST",
      headers: { authorization: auth, "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => recordEvent.mockReset());

describe("POST /api/v1/events", () => {
  it("records an event with the key's hash, never the key itself", async () => {
    recordEvent.mockResolvedValue({ status: "recorded", lead_id: "l1" });
    const res = await post({
      email: "Dana@Example.com",
      event: "limit_reached",
      properties: { limit: "projects" },
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "recorded" });
    expect(recordEvent).toHaveBeenCalledWith(hash, {
      email: "dana@example.com",
      event: "limit_reached",
      occurredAt: null,
      properties: { limit: "projects" },
    });
  });

  it("refuses a missing or malformed key without asking the database", async () => {
    expect((await post({}, "")).status).toBe(401);
    expect((await post({}, "Bearer nope")).status).toBe(401);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("answers the database's verdicts plainly", async () => {
    recordEvent.mockResolvedValueOnce({ status: "unauthorised" });
    expect(
      (await post({ email: "a@b.example", event: "trial_started" })).status,
    ).toBe(401);
    recordEvent.mockResolvedValueOnce({ status: "rate_limited" });
    const limited = await post({
      email: "a@b.example",
      event: "trial_started",
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    recordEvent.mockResolvedValueOnce({ status: "no_lead" });
    expect(
      (await post({ email: "a@b.example", event: "trial_started" })).status,
    ).toBe(404);
  });

  it("refuses bodies that aren't valid, or too large", async () => {
    expect((await post("not json")).status).toBe(422);
    expect((await post({ email: "a@b.example", event: "nope" })).status).toBe(
      422,
    );
    expect(
      (
        await post({
          email: "a@b.example",
          event: "trial_started",
          properties: { x: "y".repeat(5000) },
        })
      ).status,
    ).toBe(413);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("slows one address that floods it", async () => {
    let last = 0;
    for (let i = 0; i < 125; i++)
      last = (await post({}, "", "198.51.100.9")).status;
    expect(last).toBe(429);
  });
});
