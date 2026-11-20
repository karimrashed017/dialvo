import { afterEach, describe, expect, it, vi } from "vitest";

// Whether a widget's workspace is locked, with the database faked. The rule
// that matters most: nothing is ever locked unless BILLING_ENFORCED is 1.

const rpc = vi.fn();
let hasClient = true;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => (hasClient ? { rpc } : null),
}));

const TOKEN = "ab".repeat(32);
const ended = {
  trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
  billing_status: "trialing",
};

afterEach(() => {
  vi.unstubAllEnvs();
  rpc.mockReset();
  hasClient = true;
});

describe("widgetLocked", () => {
  it("is false, without asking the database, while billing isn't enforced", async () => {
    const { widgetLocked } = await import("./widget");
    for (const value of ["", "0", "true"]) {
      vi.stubEnv("BILLING_ENFORCED", value);
      rpc.mockResolvedValue({ data: ended, error: null });
      expect(await widgetLocked(TOKEN)).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("with BILLING_ENFORCED=1, locks an ended trial and nothing else", async () => {
    const { widgetLocked } = await import("./widget");
    vi.stubEnv("BILLING_ENFORCED", "1");
    rpc.mockResolvedValue({ data: ended, error: null });
    expect(await widgetLocked(TOKEN)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("chat_billing_state", { p_token: TOKEN });

    rpc.mockResolvedValue({
      data: { ...ended, billing_status: "active" },
      error: null,
    });
    expect(await widgetLocked(TOKEN)).toBe(false);
    rpc.mockResolvedValue({
      data: {
        trial_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
        billing_status: "trialing",
      },
      error: null,
    });
    expect(await widgetLocked(TOKEN)).toBe(false);
  });

  it("never locks when the answer can't be read", async () => {
    const { widgetLocked } = await import("./widget");
    vi.stubEnv("BILLING_ENFORCED", "1");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect(await widgetLocked(TOKEN)).toBe(false);
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await widgetLocked(TOKEN)).toBe(false);
    hasClient = false;
    expect(await widgetLocked(TOKEN)).toBe(false);
    log.mockRestore();
  });
});
