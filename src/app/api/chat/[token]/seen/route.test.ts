import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatSeenLimit, pageOrigin } from "@/lib/chat/http";

// The install check's endpoint with the database faked: what it stores (an
// origin, nothing else), what it ignores, and its limits.

const rpc = vi.fn();
vi.mock("@/lib/supabase/capture", () => ({
  createCaptureClient: () => ({ rpc }),
}));
vi.mock("@/lib/supabase/env", () => ({ APP_CONFIGURED: true }));

const TOKEN = "ab".repeat(32);

async function ping(
  headers: Record<string, string>,
  token = TOKEN,
  ip = "203.0.113.9",
) {
  const { POST } = await import("./route");
  return POST(
    new Request(`https://trydialvo.com/api/chat/${token}/seen`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-real-ip": ip, ...headers },
      body: "{}",
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
  chatSeenLimit.reset();
});

describe("POST /api/chat/[token]/seen", () => {
  it("records the origin of the page the widget loaded on, and only that", async () => {
    const response = await ping({
      origin: "https://Shop.Example.com",
      referer: "https://shop.example.com/checkout?email=dana@example.com",
      cookie: "session=abc",
      "user-agent": "Mozilla/5.0",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("chat_widget_seen", {
      p_token: TOKEN,
      p_origin: "https://shop.example.com",
    });
  });

  it("answers any site, sets no cookie and can't be cached", async () => {
    const response = await ping({ origin: "https://example.com" });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("doesn't count Dialvo's own pages: the preview in Settings isn't an install", async () => {
    const own: Record<string, string>[] = [
      { origin: "https://trydialvo.com" },
      { origin: "http://localhost:3000", host: "localhost:3000" },
      {
        origin: "https://preview.example",
        "x-forwarded-host": "preview.example",
      },
    ];
    for (const headers of own) {
      const response = await ping(headers);
      expect(await response.json()).toEqual({ ok: true });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a request with no usable origin, with the same answer", async () => {
    for (const origin of [
      "",
      "null",
      "https://example.com/path",
      "ftp://example.com",
      "x".repeat(400),
    ]) {
      const response = await ping(origin ? { origin } : {});
      expect(response.status).toBe(200);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a malformed widget id", async () => {
    const response = await ping({ origin: "https://example.com" }, "nope");
    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is rate-limited per address and per widget", async () => {
    for (let i = 0; i < 30; i++)
      expect((await ping({ origin: "https://example.com" })).status).toBe(200);
    const limited = await ping({ origin: "https://example.com" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(rpc).toHaveBeenCalledTimes(30);

    // Many addresses hitting one widget are held to the widget's own limit.
    chatSeenLimit.reset();
    let ok = 0;
    for (let i = 0; i < 40; i++)
      if (
        (
          await ping(
            { origin: "https://example.com" },
            TOKEN,
            `198.51.100.${i}`,
          )
        ).status === 200
      )
        ok++;
    expect(ok).toBe(30);
  });

  it("stays quiet when the database fails: the chat must not notice", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "down" },
    });
    const response = await ping({ origin: "https://example.com" });
    expect(response.status).toBe(200);
    log.mockRestore();
  });
});

describe("pageOrigin", () => {
  const request = (headers: Record<string, string>) =>
    new Request("https://trydialvo.com/api/chat/x/seen", { headers });
  it("lower-cases and keeps the port", () => {
    expect(pageOrigin(request({ origin: "HTTP://127.0.0.1:8080" }))).toBe(
      "http://127.0.0.1:8080",
    );
  });
  it("is null without an Origin header", () => {
    expect(pageOrigin(request({}))).toBeNull();
  });
});
