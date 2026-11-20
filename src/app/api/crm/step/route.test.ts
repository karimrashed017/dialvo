import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  on: true,
  tokenOk: vi.fn(async (token: string) => token === "t".repeat(40)),
  push: vi.fn(async () => ({
    claimed: 2,
    done: 2,
    retried: 0,
    failed: 0,
    skipped: 0,
  })),
  pull: vi.fn(async () => ({ status: "running", entries: 10 })),
}));

vi.mock("@/lib/crm/runtime", () => ({
  crmRuntimeStatus: () => ({ on: state.on }),
}));
vi.mock("@/lib/crm/store", () => ({
  createCrmStore: () => ({ cronTokenOk: state.tokenOk }),
}));
vi.mock("@/lib/crm/steps", () => ({
  pushStep: state.push,
  pullStep: state.pull,
}));

import { POST } from "./route";

const call = (job: string, token?: string) =>
  POST(
    new Request(`https://trydialvo.com/api/crm/step?job=${job}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );

beforeEach(() => {
  state.on = true;
  state.push.mockClear();
  state.pull.mockClear();
});

describe("the scheduler's door for CRM sync", () => {
  it("refuses a call without the scheduler's token, and runs nothing", async () => {
    for (const token of [undefined, "short", "x".repeat(40)]) {
      const res = await call("push", token);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false });
    }
    expect(state.push).not.toHaveBeenCalled();
  });

  it("refuses everything on a server without the secret key", async () => {
    state.on = false;
    expect((await call("push", "t".repeat(40))).status).toBe(401);
  });

  it("runs one push or one import step", async () => {
    const push = await call("push", "t".repeat(40));
    expect(await push.json()).toMatchObject({ ok: true, job: "push", done: 2 });
    const pull = await call("pull", "t".repeat(40));
    expect(await pull.json()).toMatchObject({
      ok: true,
      job: "pull",
      status: "running",
    });
    expect((await call("nope", "t".repeat(40))).status).toBe(400);
  });
});
