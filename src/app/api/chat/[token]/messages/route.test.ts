import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatPollLimit, chatPostLimit, chatStartLimit } from "@/lib/chat/http";

// The chat endpoints with the database and the agent faked: what reaches the
// database functions, what a visitor gets back, and that the agent only runs
// when this server has its keys.

const rpc = vi.fn();
vi.mock("@/lib/supabase/capture", () => ({
  createCaptureClient: () => ({ rpc }),
}));
vi.mock("@/lib/supabase/env", () => ({ APP_CONFIGURED: true }));
const runChatAgent = vi.fn(async () => ({ status: "sent" }));
vi.mock("@/lib/agents/runtime", () => ({ runChatAgent }));
const later: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({
  after: (work: () => Promise<void>) => later.push(work),
}));

const TOKEN = "ab".repeat(32);
const KEY = "cd".repeat(32);
const CONVERSATION = "7b0f3a52-58a4-4a7e-9d3c-0d6f0c1f2a11";

async function send(body: unknown, token = TOKEN, ip = "203.0.113.9") {
  const { POST } = await import("./route");
  return POST(
    new Request(`https://trydialvo.com/api/chat/${token}/messages`, {
      method: "POST",
      // What the widget sends: JSON as text/plain, so there is no preflight.
      headers: { "content-type": "text/plain", "x-real-ip": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

async function poll(body: unknown, token = TOKEN) {
  const { POST } = await import("../poll/route");
  return POST(
    new Request(`https://trydialvo.com/api/chat/${token}/poll`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-real-ip": "203.0.113.9" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  rpc.mockReset();
  runChatAgent.mockClear();
  later.length = 0;
  chatStartLimit.reset();
  chatPostLimit.reset();
  chatPollLimit.reset();
  vi.unstubAllEnvs();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
});

const started = {
  conversation_id: CONVERSATION,
  visitor_key: KEY,
  message_id: "m1",
};

describe("POST /api/chat/[token]/messages", () => {
  it("starts a chat, answers any origin, and hands the visitor their key", async () => {
    rpc.mockResolvedValue({ data: started, error: null });
    const res = await send({ message: "  Do you work with dentists?  " });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      conversation: CONVERSATION,
      key: KEY,
      message: { id: "m1", body: "Do you work with dentists?" },
      agent: "saved",
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("chat_start", {
      p_token: TOKEN,
      p_body: "Do you work with dentists?",
    });
  });

  it("without the agent's keys, saves the message and runs no agent", async () => {
    rpc.mockResolvedValue({ data: started, error: null });
    const res = await send({ message: "Hello" });
    expect((await res.json()).agent).toBe("saved");
    expect(later).toEqual([]);
    expect(runChatAgent).not.toHaveBeenCalled();
  });

  it("with the keys, saves first and runs the agent after the response", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
    rpc.mockResolvedValue({ data: started, error: null });
    const res = await send({ message: "Hello" });
    expect((await res.json()).agent).toBe("replying");
    expect(runChatAgent).not.toHaveBeenCalled();
    expect(later.length).toBe(1);
    await later[0]();
    expect(runChatAgent).toHaveBeenCalledExactlyOnceWith({
      token: TOKEN,
      conversationId: CONVERSATION,
    });
  });

  it("continues a chat with the conversation and the key, and returns no key", async () => {
    rpc.mockResolvedValue({ data: { message_id: "m2" }, error: null });
    const res = await send({
      message: "And the price?",
      conversation: CONVERSATION,
      key: KEY,
    });
    expect(await res.json()).toEqual({
      ok: true,
      conversation: CONVERSATION,
      message: { id: "m2", body: "And the price?" },
      agent: "saved",
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("chat_post", {
      p_token: TOKEN,
      p_conversation_id: CONVERSATION,
      p_visitor_key: KEY,
      p_body: "And the price?",
    });
  });

  it("takes card numbers out before anything is stored", async () => {
    rpc.mockResolvedValue({ data: started, error: null });
    const res = await send({ message: "Charge 4242 4242 4242 4242 please" });
    expect((await res.json()).message.body).toBe(
      "Charge [card number removed] please",
    );
    expect(rpc.mock.calls[0][1].p_body).toBe(
      "Charge [card number removed] please",
    );
  });

  it("refuses empty, over-long, oversized and unreadable messages without touching the database", async () => {
    const cases: [unknown, number, string][] = [
      [{ message: "   " }, 400, "invalid"],
      [{}, 400, "invalid"],
      [{ message: 42 }, 400, "invalid"],
      [{ message: "x".repeat(2001) }, 400, "too_long"],
      [{ message: "x".repeat(13_000) }, 413, "too_large"],
      ["not json", 400, "invalid"],
      ["[1]", 400, "invalid"],
    ];
    for (const [body, status, reason] of cases) {
      const res = await send(body);
      expect(res.status, reason).toBe(status);
      expect((await res.json()).reason).toBe(reason);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed token, conversation or key, and for ones the database doesn't know", async () => {
    expect((await send({ message: "Hi" }, "nope")).status).toBe(404);
    for (const body of [
      { message: "Hi", conversation: "1", key: KEY },
      { message: "Hi", conversation: CONVERSATION },
      { message: "Hi", conversation: CONVERSATION, key: "short" },
      { message: "Hi", key: KEY },
    ]) {
      const res = await send(body);
      expect(res.status).toBe(404);
      expect((await res.json()).reason).toBe("unknown_chat");
    }
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await (await send({ message: "Hi" })).json()).reason).toBe(
      "unknown_widget",
    );
    expect(
      (
        await (
          await send({ message: "Hi", conversation: CONVERSATION, key: KEY })
        ).json()
      ).reason,
    ).toBe("unknown_chat");
    expect(later).toEqual([]);
  });

  it("passes on the database's limits", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [string, number, string][] = [
      ["DV429", 429, "limited"],
      ["DV413", 413, "chat_full"],
      ["22023", 400, "invalid"],
      ["XX000", 502, "unavailable"],
    ];
    for (const [code, status, reason] of cases) {
      rpc.mockResolvedValue({ data: null, error: { code, message: "no" } });
      const res = await send(
        { message: "Hi" },
        TOKEN,
        `198.51.100.${status % 250}`,
      );
      expect(res.status, code).toBe(status);
      expect((await res.json()).reason).toBe(reason);
    }
    quiet.mockRestore();
  });

  it("slows one address: 6 new chats and 20 messages a minute", async () => {
    rpc.mockResolvedValue({ data: started, error: null });
    for (let i = 0; i < 6; i++)
      expect((await send({ message: "Hi" })).status).toBe(200);
    const blocked = await send({ message: "Hi" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    // Another address is unaffected, and so is continuing an existing chat.
    expect((await send({ message: "Hi" }, TOKEN, "203.0.113.77")).status).toBe(
      200,
    );
    rpc.mockResolvedValue({ data: { message_id: "m" }, error: null });
    const next = { message: "Hi", conversation: CONVERSATION, key: KEY };
    for (let i = 0; i < 20; i++) expect((await send(next)).status).toBe(200);
    expect((await send(next)).status).toBe(429);
  });

  it("answers the preflight", async () => {
    const { OPTIONS } = await import("./route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("POST /api/chat/[token]/poll", () => {
  it("returns the chat for the right key", async () => {
    const messages = [{ id: "m1", from: "visitor", body: "Hi", sent_at: "t" }];
    rpc.mockResolvedValue({ data: { state: "review", messages }, error: null });
    const res = await poll({ conversation: CONVERSATION, key: KEY });
    expect(await res.json()).toEqual({ ok: true, state: "review", messages });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("chat_poll", {
      p_token: TOKEN,
      p_conversation_id: CONVERSATION,
      p_visitor_key: KEY,
    });
  });

  it("answers 404 without a well-formed conversation and key, or when the database knows neither", async () => {
    for (const body of [{}, { conversation: CONVERSATION }, { key: KEY }])
      expect((await poll(body)).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await poll({ conversation: CONVERSATION, key: KEY })).status).toBe(
      404,
    );
  });

  it("slows one address", async () => {
    rpc.mockResolvedValue({
      data: { state: "open", messages: [] },
      error: null,
    });
    const body = { conversation: CONVERSATION, key: KEY };
    for (let i = 0; i < 240; i++) await poll(body);
    expect((await poll(body)).status).toBe(429);
  });
});
