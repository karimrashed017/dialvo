import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/lib/voice/rate-limit";

// The route with ElevenLabs faked: `fetch` is replaced, so no test ever
// reaches the network or needs a real key.

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => {},
}));

const AGENT = { agent_id: "agent_test", name: "Dialvo website demo" };

function fakeElevenLabs() {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = String(url);
    expect(new Headers(init?.headers).get("xi-api-key")).toBe("test-key");
    if (path.includes("/conversation/token")) {
      return Response.json({ token: "tok_123" });
    }
    if (path.includes("/agents/create")) return Response.json(AGENT);
    if (path.includes("/agents?")) return Response.json({ agents: [] });
    return new Response("not found", { status: 404 });
  });
}

async function load() {
  vi.resetModules();
  return import("./route");
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://trydialvo.com/api/voice/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "trydialvo.com",
      "x-real-ip": "203.0.113.7",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const GOOD = { scenario: "new-enquiry", voice: "warm" };

describe("POST /api/voice/session", () => {
  let fetchMock: ReturnType<typeof fakeElevenLabs>;

  beforeEach(() => {
    resetRateLimit();
    fetchMock = fakeElevenLabs();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_AGENT_ID", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("answers 503 not_configured without a key, and calls nobody", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const { POST, GET } = await load();
    const res = await POST(post(GOOD));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ reason: "not_configured" });
    expect(await (await GET()).json()).toEqual({ configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says it's configured when the key is set", async () => {
    const { GET } = await load();
    expect(await (await GET()).json()).toEqual({ configured: true });
  });

  it.each([
    ["an unknown scenario", { scenario: "pirate", voice: "warm" }],
    ["an unknown voice", { scenario: "customer", voice: "robot" }],
    ["a missing voice", { scenario: "customer" }],
    ["a prompt of the caller's own", { ...GOOD, scenario: { prompt: "x" } }],
    ["no object", null],
    ["broken JSON", "{nope"],
  ])("rejects %s", async (_, body) => {
    const { POST } = await load();
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ reason: "bad_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request made from another site", async () => {
    const { POST } = await load();
    const res = await POST(post(GOOD, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the agent once, then returns a token, script and voice", async () => {
    const { POST } = await load();
    const res = await POST(
      post(
        { scenario: "receptionist", voice: "british" },
        {
          origin: "https://trydialvo.com",
        },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversationToken).toBe("tok_123");
    expect(body.maxSeconds).toBe(120);
    expect(body.overrides.tts.voiceId).toBe("JBFqnCBsd6RMkjVDRZzb");
    expect(body.dynamicVariables.opening_line).toMatch(/AI assistant/);
    expect(body.overrides.agent.prompt.prompt).toMatch(/receptionist/i);
    expect(JSON.stringify(body)).not.toContain("test-key");
    expect(res.headers.get("set-cookie")).toMatch(/^dv_voice=.+HttpOnly/i);

    const created = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/agents/create"),
    );
    const settings = JSON.parse(String(created?.[1]?.body));
    expect(settings.name).toBe("Dialvo website demo");
    expect(settings.conversation_config.conversation.max_duration_seconds).toBe(
      120,
    );
    expect(settings.conversation_config.agent.first_message).toBe(
      "{{opening_line}}",
    );
    expect(settings.platform_settings.auth.enable_auth).toBe(true);
    expect(settings.platform_settings.privacy).toEqual({
      record_voice: false,
      retention_days: 0,
    });

    // A second call reuses the remembered agent.
    await POST(post(GOOD, { "x-real-ip": "203.0.113.8" }));
    const paths = fetchMock.mock.calls.map(([u]) => String(u));
    expect(paths.filter((p) => p.includes("/agents")).length).toBe(2);
    expect(paths.filter((p) => p.includes("/token")).length).toBe(2);
  });

  it("updates an agent whose settings are old, and leaves a current one", async () => {
    const calls: string[] = [];
    let tags = ["dialvo-demo-settings-v0"];
    fetchMock.mockImplementation(async (url, init) => {
      const path = String(url);
      calls.push(`${init?.method ?? "GET"} ${path.split("/convai")[1]}`);
      if (path.includes("/token")) return Response.json({ token: "tok" });
      if (path.includes("/agents?")) {
        return Response.json({ agents: [{ ...AGENT, tags }] });
      }
      if (init?.method === "PATCH") {
        tags = JSON.parse(String(init.body)).tags;
        return Response.json(AGENT);
      }
      return new Response("unexpected", { status: 500 });
    });
    let { POST } = await load();
    expect((await POST(post(GOOD))).status).toBe(200);
    expect(calls.filter((c) => c.startsWith("PATCH"))).toEqual([
      "PATCH /agents/agent_test",
    ]);
    // A new server instance finds it up to date and changes nothing.
    calls.length = 0;
    ({ POST } = await load());
    expect(
      (await POST(post(GOOD, { "x-real-ip": "203.0.113.9" }))).status,
    ).toBe(200);
    expect(calls.some((c) => c.startsWith("PATCH"))).toBe(false);
    expect(calls.some((c) => c.includes("/agents/create"))).toBe(false);
  });

  it("uses ELEVENLABS_AGENT_ID without looking the agent up", async () => {
    vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_fixed");
    const { POST } = await load();
    expect((await POST(post(GOOD))).status).toBe(200);
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      "https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_fixed",
    ]);
  });

  it("every scenario's opening line says it's an AI assistant", async () => {
    const { POST } = await load();
    for (const [i, scenario] of [
      "new-enquiry",
      "receptionist",
      "customer",
    ].entries()) {
      const res = await POST(
        post({ scenario, voice: "calm" }, { "x-real-ip": `198.51.100.${i}` }),
      );
      const body = await res.json();
      expect(body.dynamicVariables.opening_line).toMatch(
        /I'm the AI assistant/,
      );
    }
  });

  it("limits one address to three calls in ten minutes", async () => {
    const { POST } = await load();
    for (let i = 0; i < 3; i++) {
      expect((await POST(post(GOOD))).status).toBe(200);
    }
    const res = await POST(post(GOOD));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.reason).toBe("rate_limited");
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(res.headers.get("retry-after")).toBe(String(body.retryAfter));
    // Someone else can still call.
    expect(
      (await POST(post(GOOD, { "x-real-ip": "203.0.113.99" }))).status,
    ).toBe(200);
  });

  it("holds the limit through a cold start, from the cookie", async () => {
    let { POST } = await load();
    let cookie = "";
    for (let i = 0; i < 3; i++) {
      const res = await POST(post(GOOD, cookie ? { cookie } : {}));
      cookie = res.headers.get("set-cookie")!.split(";")[0];
    }
    resetRateLimit();
    ({ POST } = await load());
    expect((await POST(post(GOOD, { cookie }))).status).toBe(429);
  });

  it("answers 502 and doesn't count the call when ElevenLabs fails", async () => {
    fetchMock.mockImplementation(
      async () => new Response("down", { status: 500 }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await load();
    for (let i = 0; i < 5; i++) {
      const res = await POST(post(GOOD));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ reason: "unavailable" });
    }
    log.mockRestore();
  });
});
