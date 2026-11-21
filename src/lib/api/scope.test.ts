import { describe, expect, it, vi } from "vitest";

// A read-only key: the REST API refuses every method that changes
// something, and the MCP endpoint (which always POSTs) lets it in to read.

const answer = {
  status: "ok",
  workspace_id: "w1",
  key_id: "k1",
  remaining: 5,
  scope: "read",
  user_id: "u1",
  role: "member",
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async () => ({ data: answer, error: null }),
  }),
}));

const { authorise } = await import("./v1");
const request = (method: string) =>
  new Request("https://trydialvo.com/api/v1/leads", {
    method,
    headers: {
      authorization: `Bearer dv_live_${"a".repeat(32)}`,
      "x-forwarded-for": `10.0.0.${method.length}`,
    },
  });

describe("scoped keys", () => {
  it("read keys read, and are refused for writes", async () => {
    const get = await authorise(request("GET"));
    expect(get.ok && get.ctx).toMatchObject({
      workspaceId: "w1",
      scope: "read",
      userId: "u1",
      role: "member",
    });
    const post = await authorise(request("POST"));
    expect(post.ok).toBe(false);
    if (!post.ok) {
      expect(post.response.status).toBe(403);
      expect(await post.response.json()).toMatchObject({
        error: "read_only_key",
      });
    }
    expect((await authorise(request("POST"), { readOnPost: true })).ok).toBe(
      true,
    );
  });
});
