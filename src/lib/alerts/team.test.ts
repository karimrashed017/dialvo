import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_FROM,
  alertEmailStatus,
  buildAlertEmail,
  sendEmail,
} from "./email";
import {
  defaultAlertDeps,
  sendTeamAlerts,
  type AlertStore,
  type ClaimedAlerts,
} from "./team";

// Team alerts with Resend and the database faked. No network: what is
// checked is who is emailed, what the email says, that each event is sent
// once, and that nothing happens (quietly) without the key.

const CONVERSATION = "7b0f3a52-58a4-4a7e-9d3c-0d6f0c1f2a11";
const where = { token: "ab".repeat(32), conversationId: CONVERSATION };

const claimed = (over: Partial<ClaimedAlerts> = {}): ClaimedAlerts => ({
  workspace: "Northwind Web",
  conversation_id: CONVERSATION,
  lead: "Dana Reyes",
  recipients: ["alice@northwind.example", "amy@northwind.example"],
  alerts: [
    {
      id: "alert-1",
      kind: "qualified",
      summary:
        "Qualified in the website chat: three clinics, wants to start in May.",
    },
  ],
  ...over,
});

function store(result: ClaimedAlerts | null) {
  const claim = vi.fn<AlertStore["claim"]>(async () => result);
  const finish = vi.fn<AlertStore["finish"]>(async () => {});
  return { claim, finish, store: { claim, finish } as AlertStore };
}

function resend(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ id: "email-1" }), { status });
    },
  ) as unknown as typeof globalThis.fetch;
  return {
    fetch,
    calls,
    body: (i = 0) => JSON.parse(String(calls[i].init.body)),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("alertEmailStatus", () => {
  it("is on only with the Resend key and the secret key", () => {
    expect(alertEmailStatus({})).toEqual({
      on: false,
      missing: ["RESEND_API_KEY", "SUPABASE_SECRET_KEY"],
    });
    expect(alertEmailStatus({ RESEND_API_KEY: "x" }).on).toBe(false);
    expect(
      alertEmailStatus({ RESEND_API_KEY: "x", SUPABASE_SECRET_KEY: "y" }).on,
    ).toBe(true);
  });
});

describe("buildAlertEmail", () => {
  const base = {
    workspace: "Northwind Web",
    lead: "Dana Reyes",
    summary: "Three clinics, wants to start in May.",
    conversationId: CONVERSATION,
  };

  it("has a short summary and a link to the conversation", () => {
    const email = buildAlertEmail({ ...base, kind: "qualified" });
    expect(email.subject).toBe(
      "A lead was qualified in your website chat: Dana Reyes (Northwind Web)",
    );
    const link = `https://trydialvo.com/app/inbox?c=${CONVERSATION}`;
    expect(email.text).toContain("Three clinics, wants to start in May.");
    expect(email.text).toContain(link);
    expect(email.html).toContain(`href="${link}"`);
    // How to stop them is in every alert.
    expect(email.text).toContain("https://trydialvo.com/app/settings#alerts");
  });

  it("words each kind for what the person has to do", () => {
    expect(buildAlertEmail({ ...base, kind: "needs_human" }).subject).toMatch(
      /^A website chat needs a person/,
    );
    const draft = buildAlertEmail({ ...base, kind: "draft_waiting" });
    expect(draft.subject).toMatch(
      /^A draft reply is waiting for your approval/,
    );
    expect(draft.text).toMatch(/Nothing is sent to the visitor until you do/);
  });

  it("treats what a visitor typed as text: no markup, no extra headers", () => {
    const email = buildAlertEmail({
      ...base,
      kind: "needs_human",
      lead: "Eve\r\nBcc: everyone@example.com",
      summary:
        '<img src=x onerror="alert(1)"> <a href="https://evil.example">click</a>',
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain('href="https://evil.example"');
    expect(email.html).toContain("&lt;img");
  });

  it("doesn't name a visitor who never gave a name", () => {
    const email = buildAlertEmail({
      ...base,
      kind: "needs_human",
      lead: "Website visitor",
    });
    expect(email.subject).toBe("A website chat needs a person (Northwind Web)");
    expect(email.text).not.toContain("Lead:");
  });
});

describe("sendEmail", () => {
  const email = {
    ...buildAlertEmail({
      kind: "qualified",
      workspace: "W",
      lead: "L",
      summary: "S",
      conversationId: CONVERSATION,
    }),
    to: ["a@example.com"],
  };

  it("posts to Resend from Dialvo's address, with the key in the header only", async () => {
    const r = resend();
    expect(
      await sendEmail(
        { ...email, idempotencyKey: "team-alert-1" },
        { fetch: r.fetch, apiKey: "re_test" },
      ),
    ).toBe(true);
    expect(r.calls[0].url).toBe("https://api.resend.com/emails");
    const headers = r.calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test");
    expect(headers["idempotency-key"]).toBe("team-alert-1");
    expect(r.body()).toMatchObject({
      from: ALERT_FROM,
      to: ["a@example.com"],
      subject: email.subject,
    });
    expect(ALERT_FROM).toBe("Dialvo <contact@trydialvo.com>");
    expect(String(r.calls[0].init.body)).not.toContain("re_test");
  });

  it("sends nothing without a key or without anyone to send to", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const r = resend();
    expect(await sendEmail(email, { fetch: r.fetch })).toBe(false);
    expect(
      await sendEmail({ ...email, to: [] }, { fetch: r.fetch, apiKey: "re" }),
    ).toBe(false);
    expect(r.fetch).not.toHaveBeenCalled();
  });

  it("reports a refusal or a network failure as not sent, without throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await sendEmail(email, { fetch: resend(422).fetch, apiKey: "re" }),
    ).toBe(false);
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await sendEmail(email, { fetch: down, apiKey: "re" })).toBe(false);
    log.mockRestore();
  });
});

describe("sendTeamAlerts", () => {
  it("emails the members with alerts on, once per event, and records it", async () => {
    const s = store(
      claimed({
        alerts: [
          { id: "alert-1", kind: "qualified", summary: "Three clinics." },
          { id: "alert-2", kind: "needs_human", summary: "Wants a call." },
        ],
      }),
    );
    const r = resend();
    expect(
      await sendTeamAlerts(where, {
        store: s.store,
        send: { fetch: r.fetch, apiKey: "re_test" },
      }),
    ).toEqual({ status: "sent", sent: 2 });
    expect(s.claim).toHaveBeenCalledWith(where.token, CONVERSATION);
    expect(r.calls).toHaveLength(2);
    expect(r.body(0).to).toEqual([
      "alice@northwind.example",
      "amy@northwind.example",
    ]);
    expect(r.body(0).subject).toMatch(/qualified/);
    expect(r.body(1).subject).toMatch(/needs a person/);
    expect(s.finish.mock.calls).toEqual([
      ["alert-1", true, 2],
      ["alert-2", true, 2],
    ]);
  });

  it("skips silently without the keys: nothing is claimed, nothing is sent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(defaultAlertDeps().store).toBeNull();
    expect(await sendTeamAlerts(where)).toEqual({
      status: "not_configured",
      sent: 0,
    });
  });

  it("does nothing when there is nothing waiting or the chat isn't this widget's", async () => {
    for (const result of [null, claimed({ alerts: [] })]) {
      const r = resend();
      expect(
        await sendTeamAlerts(where, {
          store: store(result).store,
          send: { fetch: r.fetch, apiKey: "re" },
        }),
      ).toEqual({ status: "none", sent: 0 });
      expect(r.fetch).not.toHaveBeenCalled();
    }
  });

  it("records a failed send, and never throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = store(claimed());
    expect(
      await sendTeamAlerts(where, {
        store: s.store,
        send: { fetch: resend(500).fetch, apiKey: "re" },
      }),
    ).toEqual({ status: "failed", sent: 0 });
    expect(s.finish).toHaveBeenCalledWith("alert-1", false, 0);

    const broken = {
      claim: vi.fn(async () => {
        throw new Error("connection reset");
      }),
      finish: vi.fn(),
    } as unknown as AlertStore;
    expect(
      await sendTeamAlerts(where, { store: broken, send: { apiKey: "re" } }),
    ).toEqual({ status: "failed", sent: 0 });
    log.mockRestore();
  });

  it("never emails for a kind it doesn't know", async () => {
    const s = store(
      claimed({ alerts: [{ id: "alert-9", kind: "marketing", summary: "x" }] }),
    );
    const r = resend();
    await sendTeamAlerts(where, {
      store: s.store,
      send: { fetch: r.fetch, apiKey: "re" },
    });
    expect(r.fetch).not.toHaveBeenCalled();
    expect(s.finish).toHaveBeenCalledWith("alert-9", false, 0);
  });
});
