import { describe, expect, it, vi } from "vitest";
import { readEndpoint } from "./endpoints";
import { checkTargetUrl, postJson, type PostDeps } from "./post";
import { readSlackUrl, slackMessage, slackRevoked, slackText } from "./slack";
import { backoffSeconds, deliverStep, sendDelivery } from "./steps";
import type { ClaimedDelivery, IntegrationStore } from "./store";
import {
  makeWebhookSecret,
  signWebhook,
  verifyWebhook,
  webhookBody,
  webhookHeaders,
} from "./webhooks";

const fakePost = (
  answer: { status: number; body?: string } | Error,
  addresses = [{ address: "93.184.216.34", family: 4 as const }],
) => {
  const request = vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return { status: answer.status, body: answer.body ?? "" };
  });
  const deps: PostDeps = { resolve: async () => addresses, request };
  return { deps, request };
};

describe("Slack", () => {
  it("takes only incoming-webhook URLs", () => {
    expect(
      readSlackUrl(" https://hooks.slack.com/services/T0/B0/abcdefghij "),
    ).toBe("https://hooks.slack.com/services/T0/B0/abcdefghij");
    expect(
      readSlackUrl("https://hooks.slack.com.evil.example/services/x"),
    ).toBe(null);
    expect(
      readSlackUrl("http://hooks.slack.com/services/T0/B0/abcdefghij"),
    ).toBe(null);
  });

  it("escapes outside text so it can't become a link or a mention", () => {
    expect(slackText("<!channel> & <https://x.example|click>")).toBe(
      "&lt;!channel&gt; &amp; &lt;https://x.example|click&gt;",
    );
    const text = slackMessage(
      "hot_reply",
      {
        summary: "<!here> buy",
        conversation_id: "c1",
        lead: { name: "Dana <x>", company: "Acme" },
      },
      "Ws",
      "https://app.example",
    )!;
    expect(text).toContain("Dana &lt;x&gt; (Acme) wants to talk");
    expect(text).toContain("&lt;!here&gt;");
    expect(text).toContain(
      "<https://app.example/app/inbox?c=c1|Open in Dialvo>",
    );
  });

  it("writes the digest only when something waits, and never offers to approve in Slack", () => {
    expect(
      slackMessage(
        "approvals_digest",
        { first_emails: 0, replies: 0, chat: 0 },
        "W",
      ),
    ).toBe(null);
    const d = slackMessage(
      "approvals_digest",
      { first_emails: 3, replies: 1, chat: 0 },
      "W",
    )!;
    expect(d).toContain("3 first emails, 1 reply");
    expect(d).toContain("Nothing is sent until someone approves it in Dialvo.");
    expect(slackMessage("lead.created", {}, "W")).toBe(null);
  });

  it("knows when Slack has removed a webhook", () => {
    expect(slackRevoked(404, "no_service")).toBe(true);
    expect(slackRevoked(400, "400: invalid_payload")).toBe(false);
    expect(slackRevoked(500, "")).toBe(false);
  });
});

describe("webhook signatures", () => {
  it("sign the timestamp and the exact body, and verify", () => {
    const secret = makeWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{40}$/);
    const body = webhookBody({
      id: "d1",
      type: "lead.created",
      createdAt: "2026-11-21T00:00:00Z",
      data: { a: 1 },
    });
    const header = signWebhook(secret, body, 1_763_700_000);
    expect(verifyWebhook(secret, body, header, 1_763_700_100)).toBe(true);
    expect(verifyWebhook(secret, body + " ", header, 1_763_700_100)).toBe(
      false,
    );
    expect(verifyWebhook("whsec_other", body, header, 1_763_700_100)).toBe(
      false,
    );
    // Too old.
    expect(verifyWebhook(secret, body, header, 1_763_700_000 + 301)).toBe(
      false,
    );
    expect(
      webhookHeaders({
        secret,
        body,
        event: "lead.created",
        deliveryId: "d1",
        now: 5,
      }),
    ).toEqual({
      "dialvo-event": "lead.created",
      "dialvo-delivery": "d1",
      "dialvo-signature": signWebhook(secret, body, 5),
    });
  });
});

describe("posting to a customer's address", () => {
  it("refuses anything but public https", async () => {
    expect(checkTargetUrl("http://example.com/x").ok).toBe(false);
    expect(checkTargetUrl("https://localhost/x").ok).toBe(false);
    expect(checkTargetUrl("https://10.0.0.1/x").ok).toBe(false);
    expect(checkTargetUrl("https://example.com:8443/x").ok).toBe(false);
    expect(checkTargetUrl("https://hooks.example.com/dialvo").ok).toBe(true);
    const { deps, request } = fakePost({ status: 200 }, [
      { address: "127.0.0.1", family: 4 },
    ]);
    const r = await postJson("https://sneaky.example.com/x", "{}", {}, deps);
    expect(r).toMatchObject({ ok: false, permanent: true });
    expect(request).not.toHaveBeenCalled();
  });

  it("connects to the address it checked, and reads the answer", async () => {
    const { deps, request } = fakePost({ status: 204 });
    expect(
      await postJson(
        "https://hooks.example.com/x?y=1",
        '{"a":1}',
        { h: "v" },
        deps,
      ),
    ).toEqual({ ok: true, status: 204 });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        address: { address: "93.184.216.34", family: 4 },
        body: '{"a":1}',
        headers: { h: "v" },
      }),
    );
    const bad = await postJson(
      "https://hooks.example.com/x",
      "{}",
      {},
      fakePost({ status: 410, body: "<b>Gone</b>" }).deps,
    );
    expect(bad).toEqual({
      ok: false,
      status: 410,
      error: "410: Gone",
      permanent: true,
    });
    expect(
      (await postJson(
        "https://hooks.example.com/x",
        "{}",
        {},
        fakePost({ status: 503 }).deps,
      )) as { permanent: boolean },
    ).toMatchObject({ permanent: false });
    expect(
      (await postJson(
        "https://hooks.example.com/x",
        "{}",
        {},
        fakePost({ status: 429 }).deps,
      )) as { permanent: boolean },
    ).toMatchObject({ permanent: false });
    expect(
      (await postJson(
        "https://hooks.example.com/x",
        "{}",
        {},
        fakePost(new Error("socket hang up")).deps,
      )) as { permanent: boolean },
    ).toMatchObject({ permanent: false, error: "socket hang up" });
  });
});

describe("the delivery step", () => {
  const base: ClaimedDelivery = {
    id: "11111111-1111-1111-1111-111111111111",
    workspace_id: "w",
    workspace_name: "Acme",
    target: "webhook",
    event: "lead.created",
    payload: { id: "l1", email: "dana@example.com" },
    attempt: 1,
    created_at: "2026-11-21T00:00:00Z",
    url: "https://hooks.example.com/d",
    secret: "whsec_" + "x".repeat(40),
  };

  it("signs a webhook body the receiver can verify", async () => {
    const { deps, request } = fakePost({ status: 200 });
    await sendDelivery(base, deps, () => 1000);
    const call = (
      request.mock.calls[0] as unknown as [
        { body: string; headers: Record<string, string> },
      ]
    )[0];
    expect(JSON.parse(call.body)).toEqual({
      id: base.id,
      type: "lead.created",
      created_at: base.created_at,
      data: base.payload,
    });
    expect(
      verifyWebhook(
        base.secret!,
        call.body,
        call.headers["dialvo-signature"],
        1000,
      ),
    ).toBe(true);
    expect(call.headers["dialvo-delivery"]).toBe(base.id);
  });

  it("records delivered, retry with backoff, failed and revoked", async () => {
    const finish = vi.fn(async (_id: string, outcome: string) =>
      outcome === "delivered"
        ? "delivered"
        : outcome === "retry"
          ? "pending"
          : "failed",
    );
    const claimed: ClaimedDelivery[] = [
      base,
      { ...base, id: "2", attempt: 3 },
      {
        ...base,
        id: "3",
        target: "slack",
        event: "hot_reply",
        url: "https://hooks.slack.com/services/T/B/abcdefghij",
        secret: null,
      },
      { ...base, id: "4", url: null },
    ];
    const store = {
      claim: vi.fn(async () => claimed),
      finish,
    } as unknown as IntegrationStore;
    const answers: Record<string, { status: number; body: string }> = {
      "hooks.example.com": { status: 200, body: "" },
    };
    let n = 0;
    const deps: PostDeps = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async ({ url }) => {
        if (url.hostname === "hooks.slack.com")
          return { status: 404, body: "no_service" };
        return n++ === 0
          ? answers["hooks.example.com"]
          : { status: 502, body: "" };
      },
    };
    const r = await deliverStep({ store, post: deps });
    expect(r.claimed).toBe(4);
    const outcomes = Object.fromEntries(
      finish.mock.calls.map((c) => [c[0], c[1]]),
    );
    expect(outcomes[base.id]).toBe("delivered");
    expect(outcomes["2"]).toBe("retry");
    expect(outcomes["3"]).toBe("revoked");
    expect(outcomes["4"]).toBe("failed");
    const retry = finish.mock.calls.find((c) => c[0] === "2")!;
    expect((retry as unknown[])[4]).toBe(backoffSeconds(3));
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(99)).toBe(12 * 3600);
  });
});

describe("reading an endpoint", () => {
  it("needs public https and known events", () => {
    expect(
      readEndpoint({
        url: "https://h.example.com/x",
        events: ["lead.created", "meeting.booked"],
      }),
    ).toMatchObject({ ok: true, events: ["lead.created", "meeting.booked"] });
    expect(
      readEndpoint({
        url: "https://h.example.com/x",
        events: ["lead.created", "nope"],
      }),
    ).toMatchObject({ ok: false, field: "events" });
    expect(
      readEndpoint({ url: "http://h.example.com/x", events: ["lead.created"] }),
    ).toMatchObject({ ok: false, field: "url" });
    expect(
      readEndpoint({ url: "https://192.168.1.2/x", events: ["lead.created"] }),
    ).toMatchObject({ ok: false, field: "url" });
  });
});

describe("posts for briefs and workflows", () => {
  it("say what happened, escaped, and link back", async () => {
    const { slackMessage } = await import("./slack");
    const brief = slackMessage(
      "account_brief",
      {
        kind: "brief",
        summary: "<!channel> wants 20 seats",
        lead_id: "l1",
        lead: { name: "Pat", company: "Acme" },
        starts_at: "2026-11-22T15:00:00Z",
      },
      "Agency A",
      "https://example.test",
    )!;
    expect(brief).toContain(
      "*Account brief ready* in Agency A: Pat (Acme) for the meeting at",
    );
    expect(brief).toContain("&lt;!channel&gt;");
    expect(brief).toContain(
      "<https://example.test/app/leads/l1#brief|Read it in Dialvo>",
    );
    const wf = slackMessage(
      "workflow_post",
      { text: "Hot lead <@U1>", workflow: "Replies", lead_id: "l2" },
      "A",
      "https://example.test",
    )!;
    expect(wf).toContain("Hot lead &lt;@U1&gt;");
    expect(wf).toContain('_From the workflow "Replies" in A._');
    expect(slackMessage("workflow_post", { text: "" }, "A")).toBeNull();
  });
});
