import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeApiKey } from "@/lib/plays/api-key";

// The public API against a fake database: the key decides the workspace,
// every query is narrowed to it, and nothing from the request can widen it.

const calls: { table: string; ops: [string, unknown[]][] }[] = [];
let authorise: unknown = { status: "ok", workspace_id: "ws-A", remaining: 10 };
let rows: unknown[] = [];

function builder(table: string) {
  const entry = { table, ops: [] as [string, unknown[]][] };
  calls.push(entry);
  const b: Record<string, unknown> = {};
  for (const op of [
    "select",
    "eq",
    "or",
    "order",
    "limit",
    "gte",
    "insert",
    "update",
    "in",
  ])
    b[op] = (...args: unknown[]) => {
      entry.ops.push([op, args]);
      return b;
    };
  b.single = async () => ({ data: rows[0] ?? null, error: null });
  b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  b.then = (resolve: (v: unknown) => void) =>
    resolve({ data: rows, error: null });
  return b;
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async () => ({ data: authorise, error: null }),
    from: (table: string) => builder(table),
  }),
}));

const { GET, POST } = await import("./route");
const { key } = makeApiKey();
const req = (url: string, init: RequestInit = {}, auth = `Bearer ${key}`) =>
  new Request(`https://trydialvo.com${url}`, {
    ...init,
    headers: { authorization: auth, "x-forwarded-for": "203.0.113.7" },
  });

beforeEach(() => {
  calls.length = 0;
  rows = [];
  authorise = { status: "ok", workspace_id: "ws-A", remaining: 10 };
});

describe("/api/v1/leads", () => {
  it("needs a key, and answers the database's verdict on it", async () => {
    expect((await GET(req("/api/v1/leads", {}, ""))).status).toBe(401);
    authorise = { status: "unauthorised" };
    expect((await GET(req("/api/v1/leads"))).status).toBe(401);
    authorise = { status: "rate_limited" };
    const limited = await GET(req("/api/v1/leads"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("lists only the key's workspace", async () => {
    rows = [
      {
        id: "0b1c2d3e-0000-4000-8000-000000000001",
        created_at: "2026-11-21T00:00:00Z",
        consent_email: true,
      },
    ];
    const res = await GET(req("/api/v1/leads?limit=1&workspace_id=ws-B"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].consent.email).toBe(true);
    const ops = calls[0].ops;
    expect(ops).toContainEqual(["eq", ["workspace_id", "ws-A"]]);
    expect(JSON.stringify(ops)).not.toContain("ws-B");
  });

  it("creates a lead in the key's workspace, whatever the body says", async () => {
    rows = [{ id: "x", created_at: "2026-11-21T00:00:00Z" }];
    const res = await POST(
      req("/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({
          email: "dana@example.com",
          workspace_id: "ws-B",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const insert = calls[0].ops.find((o) => o[0] === "insert")![1][0] as Record<
      string,
      unknown
    >;
    expect(insert).toMatchObject({
      workspace_id: "ws-A",
      email: "dana@example.com",
      source: "api",
    });
  });

  it("refuses a body it can't read", async () => {
    expect(
      (await POST(req("/api/v1/leads", { method: "POST", body: "nope" })))
        .status,
    ).toBe(422);
    expect(
      (
        await POST(
          req("/api/v1/leads", {
            method: "POST",
            body: JSON.stringify({ name: "x" }),
          }),
        )
      ).status,
    ).toBe(422);
    expect((await GET(req("/api/v1/leads?limit=500"))).status).toBe(422);
    expect((await GET(req("/api/v1/leads?cursor=forged"))).status).toBe(422);
  });
});
