import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureLimit } from "@/lib/leads/rate-limit";

// The route with the database faked: what reaches capture_lead(), and what
// each kind of caller gets back.

const rpc = vi.fn();
vi.mock("@/lib/supabase/capture", () => ({
  createCaptureClient: () => ({ rpc }),
}));
vi.mock("@/lib/supabase/env", () => ({ APP_CONFIGURED: true }));

const TOKEN = "ab".repeat(32);
const URL_ = `https://trydialvo.com/api/leads/capture/${TOKEN}`;

async function post(
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
  token = TOKEN,
) {
  const { POST } = await import("./route");
  return POST(
    new Request(URL_, {
      method: "POST",
      headers: { "x-real-ip": "203.0.113.9", ...headers },
      body,
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: { ok: true, redirect_url: null },
    error: null,
  });
  captureLimit.reset();
});

describe("POST /api/leads/capture/[token]", () => {
  it("saves a JSON submission and answers any origin", async () => {
    const res = await post(
      JSON.stringify({
        name: "Nora Field",
        email: "Nora@Field.example",
        message: "Hi",
        consent_call: true,
        extra: "ignored",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("capture_lead", {
      p_token: TOKEN,
      p_lead: {
        name: "Nora Field",
        email: "nora@field.example",
        phone: null,
        company: null,
        website: null,
        message: "Hi",
        consent: { call: true },
      },
    });
  });

  it("sends no consent when the payload has none", async () => {
    await post(JSON.stringify({ email: "a@b.example" }));
    expect(rpc.mock.calls[0][1].p_lead.consent).toEqual({});
  });

  it("takes an ordinary form post and answers with a page", async () => {
    const res = await post(
      "name=Ada+Lovelace&phone=%28555%29+010-1234&consent_sms=on",
      {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html,application/xhtml+xml",
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Thank you");
    expect(rpc.mock.calls[0][1].p_lead).toMatchObject({
      name: "Ada Lovelace",
      phone: "5550101234",
      consent: { sms: true },
    });
  });

  it("sends a form's visitor on to the form's own thank-you address", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, redirect_url: "https://customer.example/thanks" },
      error: null,
    });
    const form = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
    };
    const res = await post("email=a%40b.example", form);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://customer.example/thanks");
    // The address comes from the form's settings, never from the post.
    rpc.mockResolvedValue({
      data: { ok: true, redirect_url: null },
      error: null,
    });
    const res2 = await post(
      "email=a%40b.example&redirect=https%3A%2F%2Fevil.example&_next=https%3A%2F%2Fevil.example",
      form,
    );
    expect(res2.status).toBe(200);
    expect(res2.headers.get("location")).toBeNull();
    // And a stored address that isn't http(s) is not followed.
    rpc.mockResolvedValue({
      data: { ok: true, redirect_url: "javascript:alert(1)" },
      error: null,
    });
    expect((await post("email=a%40b.example", form)).status).toBe(200);
  });

  it("refuses bad input without touching the database", async () => {
    for (const [body, field] of [
      ["{}", "email"],
      ['{"email":"nope"}', "email"],
      ["not json", "body"],
      ["[]", "body"],
      [
        JSON.stringify({ email: "a@b.example", consent_call: "maybe" }),
        "consent_call",
      ],
    ]) {
      const res = await post(body);
      expect(res.status, body).toBe(400);
      expect(await res.json()).toMatchObject({
        ok: false,
        reason: "invalid",
        field,
      });
    }
    const big = await post(
      JSON.stringify({ email: "a@b.example", message: "x".repeat(21000) }),
    );
    expect(big.status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed or unknown token", async () => {
    expect(
      (await post('{"email":"a@b.example"}', undefined, "short")).status,
    ).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await post('{"email":"a@b.example"}');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: "unknown_form" });
  });

  it("tells a bot it worked and saves nothing", async () => {
    const res = await post(
      JSON.stringify({ email: "a@b.example", _hp: "spam" }),
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("limits one address to 10 a minute, and passes on the form's own limit", async () => {
    for (let i = 0; i < 10; i++)
      expect((await post(`{"email":"a${i}@b.example"}`)).status).toBe(200);
    const res = await post('{"email":"a10@b.example"}');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(rpc).toHaveBeenCalledTimes(10);
    // Someone else is unaffected.
    expect(
      (
        await post('{"email":"c@b.example"}', {
          "content-type": "application/json",
          "x-real-ip": "198.51.100.4",
        })
      ).status,
    ).toBe(200);

    captureLimit.reset();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "DV429", message: "too many" },
    });
    expect((await post('{"email":"a@b.example"}')).status).toBe(429);
    rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "boom" },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = await post('{"email":"a@b.example"}');
    expect(down.status).toBe(502);
    // The database's message stays on the server.
    expect(JSON.stringify(await down.json())).not.toContain("boom");
    errors.mockRestore();
  });

  it("answers the preflight", async () => {
    const { OPTIONS } = await import("./route");
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
