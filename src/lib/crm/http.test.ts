import { describe, expect, it } from "vitest";
import { cleanCrmMessage, createHttp, retryAfterSeconds } from "./http";
import { fakeCrm } from "./testing/fake-fetch";
import { CrmError } from "./types";

const TOKEN = "fake.token.for.http.tests.only";

const httpFor = (crm: ReturnType<typeof fakeCrm>) =>
  createHttp({
    provider: "hubspot",
    baseUrl: "https://api.hubapi.com",
    token: TOKEN,
    headers: { Authorization: `Bearer ${TOKEN}` },
    gapMs: 120,
    searchGapMs: 250,
    deps: crm.deps,
  });

const error = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as CrmError;
  }
  throw new Error("expected an error");
};

describe("requests to a CRM", () => {
  it("wait out a short 429 and try again", async () => {
    const crm = fakeCrm([
      [
        "GET",
        /^\/x/,
        (_c, n) =>
          n === 0
            ? { status: 429, headers: { "Retry-After": "2" }, json: {} }
            : { json: { ok: 1 } },
      ],
    ]);
    expect(await httpFor(crm)("/x")).toEqual({ ok: 1 });
    expect(crm.calls).toHaveLength(2);
    expect(crm.sleeps).toContain(2000);
  });

  it("hand a long 429 back with how long to wait", async () => {
    const crm = fakeCrm([
      ["GET", /^\/x/, { status: 429, headers: { "Retry-After": "120" } }],
    ]);
    const e = await error(httpFor(crm)("/x"));
    expect(e.kind).toBe("rate");
    expect(e.retryAfterSeconds).toBe(120);
    expect(crm.calls).toHaveLength(1);
  });

  it("give up on 429s after two short waits", async () => {
    const crm = fakeCrm([
      ["GET", /^\/x/, { status: 429, headers: { "Retry-After": "1" } }],
    ]);
    const e = await error(httpFor(crm)("/x"));
    expect(e.kind).toBe("rate");
    expect(crm.calls).toHaveLength(3);
  });

  it("read the wait from Pipedrive's and HubSpot's own headers", () => {
    expect(
      retryAfterSeconds(new Headers({ "x-ratelimit-reset": "3" }), 0),
    ).toBe(3);
    expect(
      retryAfterSeconds(
        new Headers({ "x-hubspot-ratelimit-interval-milliseconds": "10000" }),
        0,
      ),
    ).toBe(10);
    expect(retryAfterSeconds(new Headers(), 0)).toBeNull();
  });

  it("space requests out, and searches more", async () => {
    const crm = fakeCrm([["GET", /./, { json: {} }]]);
    const http = httpFor(crm);
    await http("/a");
    await http("/b");
    await http("/c", { search: true });
    await http("/d", { search: true });
    expect(crm.sleeps.some((ms) => ms > 100 && ms <= 120)).toBe(true);
    expect(crm.sleeps.some((ms) => ms > 200 && ms <= 250)).toBe(true);
  });

  it("say plainly what each refusal means", async () => {
    const answer = (status: number, json: unknown = {}) =>
      error(httpFor(fakeCrm([["GET", /./, { status, json }]]))("/x"));
    expect((await answer(401)).kind).toBe("auth");
    expect((await answer(401)).message).toMatch(/Connect HubSpot again/);
    const scope = await answer(403, {
      category: "MISSING_SCOPES",
      errors: [
        {
          context: { requiredGranularScopes: ["crm.objects.deals.write"] },
        },
      ],
    });
    expect(scope.kind).toBe("forbidden");
    expect(scope.message).toContain("crm.objects.deals.write");
    expect((await answer(500)).kind).toBe("server");
    expect((await answer(404)).kind).toBe("not_found");
    expect((await answer(409)).kind).toBe("conflict");
    const bad = await answer(400, {
      message: "Property values were not valid",
    });
    expect(bad.kind).toBe("bad_request");
    expect(bad.message).toContain("Property values were not valid");
  });

  it("call a network failure a network failure", async () => {
    const crm = fakeCrm([]);
    crm.deps.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect((await error(httpFor(crm)("/x"))).kind).toBe("network");
  });

  it("never put the token in a message, even when the CRM echoes it", async () => {
    const crm = fakeCrm([
      [
        "GET",
        /./,
        { status: 400, json: { message: `Bad token ${TOKEN} <b>here</b>` } },
      ],
    ]);
    const e = await error(httpFor(crm)("/x"));
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).toContain("[token]");
    expect(e.message).not.toContain("<b>");
    expect(cleanCrmMessage("x".repeat(500), TOKEN)).toHaveLength(200);
  });

  it("send the token only in the header, never in the address", async () => {
    const crm = fakeCrm([["GET", /./, { json: {} }]]);
    await httpFor(crm)("/x?y=1");
    expect(crm.calls[0].url).not.toContain(TOKEN);
    expect(crm.calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
  });
});
