import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ClaimedEmail } from "./compose";
import type { Fetched } from "./imap";
import type { ModelClient } from "./model";
import type { SendOutcome } from "./smtp";
import {
  pollStep,
  sendStep,
  writeStep,
  type MailDeps,
  type MailTransport,
} from "./steps";
import type { MailStore, MailboxSecret, WriteClaim } from "./store";

// The three steps with the database, the mail servers and the model faked.
// What the database itself guarantees (an email is claimed once, limits at
// send time) is proved against the real migrations in
// supabase/tests/mail.test.ts; this proves the steps report honestly.

const PASSWORD = "the-app-password-1234";
const WS = "ws-1";
const NOW = new Date("2026-11-23T10:00:00Z"); // a Monday morning in London

const secret: MailboxSecret = {
  id: "box-1",
  email: "alice@agency.example",
  sender_name: "Alice Sender",
  username: "alice@agency.example",
  password: PASSWORD,
  smtp_host: "smtp.agency.example",
  smtp_port: 587,
  smtp_security: "starttls",
  imap_host: "imap.agency.example",
  imap_port: 993,
};

const claimed = (id: string, o: Partial<ClaimedEmail> = {}): ClaimedEmail => ({
  id,
  kind: "first",
  mailbox_id: "box-1",
  attempts: 1,
  to: `${id}@company.example`,
  subject: "Quick question",
  body: "Hello.",
  message_id: `<${id}@agency.example>`,
  in_reply_to: null,
  references: null,
  from_email: "alice@agency.example",
  sender_name: "Alice Sender",
  business_name: "Agency Ltd",
  postal_address: "1 High Street",
  unsubscribe_token: `11111111-2222-3333-4444-555555555555.${"c".repeat(64)}`,
  ...o,
});

type FakeStore = { [K in keyof MailStore]: Mock<MailStore[K]> };

function fakeStore(o: Partial<MailStore> = {}): FakeStore {
  const store = {
    cronTokenOk: vi.fn(async () => true),
    workList: vi.fn(async () => [WS]),
    writeWorkList: vi.fn(async () => [WS]),
    alertWorkList: vi.fn(async () => []),
    mailboxSecret: vi.fn(async () => secret as MailboxSecret | null),
    mailboxResult: vi.fn(async () => ({ paused: false, newly_paused: false })),
    scheduleContext: vi.fn(async () => null),
    scheduleCommit: vi.fn(
      async (_ws: string, plans: unknown[]) => plans.length,
    ),
    sendClaim: vi.fn(async () => [] as ClaimedEmail[]),
    sendResult: vi.fn(async (_ws: string, _id: string, outcome: string) =>
      outcome === "sent" ? "sent" : outcome === "retry" ? "scheduled" : outcome,
    ),
    pollClaim: vi.fn(async () => []),
    pollDone: vi.fn(async () => {}),
    inboundCommit: vi.fn(async () => "reply"),
    writeClaim: vi.fn(async () => null as WriteClaim | null),
    followupSave: vi.fn(async () => "draft"),
    replyCommit: vi.fn(async () => "interested"),
    claimAlerts: vi.fn(async () => null),
    finishAlert: vi.fn(async () => {}),
    healthCheck: vi.fn(async () => 0),
    ...o,
  };
  return store as unknown as FakeStore;
}

const transport = (o: Partial<MailTransport> = {}): MailTransport => ({
  send: vi.fn(async (): Promise<SendOutcome> => ({
    ok: true,
    response: "250 OK",
  })),
  fetchNew: vi.fn(async (): Promise<Fetched> => ({
    ok: true,
    uidvalidity: 7,
    last_uid: 1,
    messages: [],
  })),
  ...o,
});

const deps = (
  store: MailStore | null,
  t: MailTransport = transport(),
  client: ModelClient | null = null,
): MailDeps => ({
  store,
  transport: t,
  client,
  now: () => NOW,
  random: () => 0.5,
});

const failing = (kind: string, message = "nope") =>
  transport({
    send: vi.fn(async (): Promise<SendOutcome> => ({
      ok: false,
      failure: { kind: kind as "auth", message },
    })),
  });

afterEach(() => vi.restoreAllMocks());

describe("the send step", () => {
  it("does nothing without the secret key", async () => {
    expect(await sendStep(deps(null))).toMatchObject({
      status: "not_configured",
      sent: 0,
    });
  });

  it("plans what is waiting, across the mailboxes, inside the window", async () => {
    const store = fakeStore({
      scheduleContext: vi.fn(async () => ({
        on: true,
        timezone: "Europe/London",
        window: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
        sent_today: 0,
        mailboxes: ["a", "b"].map((id) => ({
          id,
          daily_limit: 30,
          connected_at: "2026-10-01T00:00:00Z",
          used: 0,
          planned: [],
        })),
        waiting: [{ draft_id: "d1" }, { draft_id: "d2" }, { draft_id: "d3" }],
      })),
    });
    const result = await sendStep(deps(store));
    expect(result.planned).toBe(3);
    const plans = store.scheduleCommit.mock.calls[0][1] as {
      draft_id: string;
      mailbox_id: string;
      send_at: string;
    }[];
    expect(plans.map((p) => p.mailbox_id)).toEqual(["a", "b", "a"]);
    expect(plans[0].send_at).toBe(NOW.toISOString());
    expect(new Date(plans[2].send_at).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("plans nothing while sending is off", async () => {
    const store = fakeStore({
      scheduleContext: vi.fn(async () => ({
        on: false,
        timezone: "UTC",
        window: {},
        sent_today: 0,
        mailboxes: [
          {
            id: "a",
            daily_limit: 30,
            connected_at: "2026-10-01T00:00:00Z",
            used: 0,
            planned: [],
          },
        ],
        waiting: [{ draft_id: "d1" }],
      })),
    });
    await sendStep(deps(store));
    expect(store.scheduleCommit).not.toHaveBeenCalled();
  });

  it("sends each claimed email once and records it as sent", async () => {
    const store = fakeStore({
      sendClaim: vi.fn(async () => [
        claimed("e1"),
        claimed("e2", { mailbox_id: "box-2" }),
      ]),
    });
    const t = transport();
    const result = await sendStep(deps(store, t));
    expect(result).toMatchObject({ sent: 2, failed: 0, unknown: 0 });
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(store.sendResult.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["e1", "sent"],
      ["e2", "sent"],
    ]);
    // One recipient, and the sender is the mailbox's own address.
    const composed = vi.mocked(t.send).mock.calls[0][1];
    expect(composed.to).toBe("e1@company.example");
    expect(composed.from.address).toBe("alice@agency.example");
  });

  it("retries 'try later' with a growing wait, and counts the tries", async () => {
    const store = fakeStore({
      sendClaim: vi.fn(async () => [claimed("e1", { attempts: 2 })]),
    });
    const result = await sendStep(
      deps(store, failing("temporary", "451 later")),
    );
    expect(result).toMatchObject({ retried: 1, sent: 0 });
    const [, , outcome, o] = store.sendResult.mock.calls[0] as unknown as [
      string,
      string,
      string,
      { retryAt: Date; maxAttempts: number; error: string },
    ];
    expect(outcome).toBe("retry");
    expect(o.maxAttempts).toBe(3);
    // Second try failed: wait an hour before the third.
    expect(o.retryAt.toISOString()).toBe("2026-11-23T11:00:00.000Z");
    expect(o.error).toBe("451 later");
  });

  it("fails a refused email for good, with the reason", async () => {
    const store = fakeStore({ sendClaim: vi.fn(async () => [claimed("e1")]) });
    const result = await sendStep(
      deps(store, failing("permanent", "550 No such user")),
    );
    expect(result).toMatchObject({ failed: 1 });
    expect(store.sendResult.mock.calls[0].slice(1, 4)).toEqual([
      "e1",
      "failed",
      { error: "550 No such user" },
    ]);
  });

  it("never asks for a resend when the email's fate is unknown", async () => {
    const store = fakeStore({ sendClaim: vi.fn(async () => [claimed("e1")]) });
    const result = await sendStep(deps(store, failing("unknown", "dropped")));
    expect(result).toMatchObject({ unknown: 1, retried: 0 });
    expect(store.sendResult.mock.calls[0][2]).toBe("unknown");
  });

  it("reports nothing when the transport blows up, so the email stays claimed and is never resent", async () => {
    const store = fakeStore({ sendClaim: vi.fn(async () => [claimed("e1")]) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = transport({
      send: vi.fn(async () => {
        throw new Error("socket exploded");
      }),
    });
    const result = await sendStep(deps(store, t));
    expect(result).toMatchObject({ unknown: 1, sent: 0, retried: 0 });
    expect(store.sendResult).not.toHaveBeenCalled();
  });

  it("counts a refused login against the mailbox, not the email", async () => {
    const store = fakeStore({
      sendClaim: vi.fn(async () => [claimed("e1", { attempts: 3 })]),
    });
    const result = await sendStep(deps(store, failing("auth", "535 refused")));
    expect(result).toMatchObject({ retried: 1, failed: 0 });
    expect(store.mailboxResult).toHaveBeenCalledWith(
      WS,
      "box-1",
      "auth_failed",
      "535 refused",
    );
    const o = store.sendResult.mock.calls[0][3] as unknown as {
      maxAttempts: number;
    };
    // Its third try, and still not failed: the mailbox is what is wrong.
    expect(o.maxAttempts).toBeGreaterThan(1000);
  });

  it("doesn't send when the mailbox has gone, and says so", async () => {
    const store = fakeStore({
      sendClaim: vi.fn(async () => [claimed("e1")]),
      mailboxSecret: vi.fn(async () => null),
    });
    const t = transport();
    const result = await sendStep(deps(store, t));
    expect(t.send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ retried: 1 });
  });

  it("never writes a mailbox's password to a log, whatever goes wrong", async () => {
    const logged: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, level).mockImplementation((...args) => {
        logged.push(args.map(String).join(" "));
      });
    for (const t of [
      transport(),
      failing("auth", "535 refused"),
      failing("unknown", "dropped"),
      transport({
        send: vi.fn(async () => {
          throw new Error("exploded");
        }),
      }),
    ]) {
      const store = fakeStore({
        sendClaim: vi.fn(async () => [claimed("e1")]),
      });
      const result = await sendStep(deps(store, t));
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
      expect(JSON.stringify(store.sendResult.mock.calls)).not.toContain(
        PASSWORD,
      );
      expect(JSON.stringify(store.mailboxResult.mock.calls)).not.toContain(
        PASSWORD,
      );
    }
    const store = fakeStore({
      pollClaim: vi.fn(async () => [
        {
          mailbox_id: "box-1",
          workspace_id: WS,
          uidvalidity: 7,
          last_uid: 0,
          connected_at: "2026-11-01T00:00:00Z",
        },
      ]),
      inboundCommit: vi.fn(async () => {
        throw new Error("database down");
      }),
    });
    await pollStep(
      deps(
        store,
        transport({
          fetchNew: vi.fn(async (): Promise<Fetched> => ({
            ok: true,
            uidvalidity: 7,
            last_uid: 2,
            messages: [Buffer.from(REPLY)],
          })),
        }),
      ),
    );
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).not.toContain(PASSWORD);
  });

  it("emails the team about what is waiting, once the sending is done", async () => {
    const send = vi.fn(async () => new Response("{}", { status: 200 }));
    const store = fakeStore({
      alertWorkList: vi.fn(async () => [WS]),
      claimAlerts: vi.fn(async () => ({
        workspace: "Agency",
        recipients: ["alice@agency.example"],
        alerts: [
          {
            id: "a1",
            kind: "mailbox_paused",
            summary: "Paused.",
            conversation_id: null,
            lead: "",
          },
          {
            id: "a2",
            kind: "reply_interested",
            summary: "Wants a call.",
            conversation_id: "c1",
            lead: "Pat",
          },
        ],
      })),
    });
    await sendStep({
      ...deps(store),
      alerts: { fetch: send as unknown as typeof fetch, apiKey: "test-key" },
    });
    expect(send).toHaveBeenCalledTimes(2);
    const bodies = send.mock.calls.map(
      (c) =>
        JSON.parse((c as unknown as [string, { body: string }])[1].body) as {
          subject: string;
          text: string;
          to: string[];
        },
    );
    expect(bodies[0].subject).toContain("paused one of your mailboxes");
    expect(bodies[0].text).toContain(
      "https://trydialvo.com/app/settings/mailboxes",
    );
    expect(bodies[1].subject).toContain("sounds interested: Pat");
    expect(bodies[1].text).toContain("https://trydialvo.com/app/inbox?c=c1");
    expect(bodies[1].to).toEqual(["alice@agency.example"]);
    expect(store.finishAlert.mock.calls).toEqual([
      ["a1", true, 1],
      ["a2", true, 1],
    ]);
  });

  it("sends a routed lead's alert only to that person, and checks mailbox health before sending", async () => {
    const send = vi.fn(async () => new Response("{}", { status: 200 }));
    const store = fakeStore({
      alertWorkList: vi.fn(async () => [WS]),
      claimAlerts: vi.fn(async () => ({
        workspace: "Agency",
        recipients: ["alice@agency.example", "amy@agency.example"],
        alerts: [
          {
            id: "a3",
            kind: "lead_assigned",
            summary: 'Routed to you by the rule "UK".',
            conversation_id: null,
            lead_id: "lead-9",
            lead: "Dana",
            to: ["amy@agency.example"],
          },
          {
            id: "a4",
            kind: "mailbox_health",
            summary: "3 of the last 10 emails bounced.",
            conversation_id: null,
            lead: "",
            to: ["alice@agency.example", "amy@agency.example"],
          },
        ],
      })),
    });
    await sendStep({
      ...deps(store),
      alerts: { fetch: send as unknown as typeof fetch, apiKey: "test-key" },
    });
    expect(store.healthCheck).toHaveBeenCalledWith(WS);
    const bodies = send.mock.calls.map(
      (c) =>
        JSON.parse((c as unknown as [string, { body: string }])[1].body) as {
          subject: string;
          text: string;
          to: string[];
        },
    );
    expect(bodies[0].to).toEqual(["amy@agency.example"]);
    expect(bodies[0].subject).toContain("A lead was routed to you: Dana");
    expect(bodies[0].text).toContain("https://trydialvo.com/app/leads/lead-9");
    expect(bodies[1].subject).toContain("protect its reputation");
    expect(store.finishAlert.mock.calls).toEqual([
      ["a3", true, 1],
      ["a4", true, 2],
    ]);
  });
});

const REPLY = [
  "From: Pat <pat@company.example>",
  "To: alice@agency.example",
  "Subject: Re: Quick question",
  "Message-ID: <r1@company.example>",
  "In-Reply-To: <e1@agency.example>",
  "Content-Type: text/plain",
  "",
  "Please stop emailing me. Unsubscribe.",
  "",
].join("\r\n");

const target = {
  mailbox_id: "box-1",
  workspace_id: WS,
  uidvalidity: 7,
  last_uid: 4,
  connected_at: "2026-11-01T00:00:00Z",
};

describe("the poll step", () => {
  it("stores what it read, then moves the cursor", async () => {
    const order: string[] = [];
    const store = fakeStore({
      pollClaim: vi.fn(async () => [target]),
      inboundCommit: vi.fn(async () => {
        order.push("commit");
        return "stopped";
      }),
      pollDone: vi.fn(async () => {
        order.push("done");
      }),
    });
    const t = transport({
      fetchNew: vi.fn(async (): Promise<Fetched> => ({
        ok: true,
        uidvalidity: 7,
        last_uid: 9,
        messages: [Buffer.from(REPLY), Buffer.from("garbage with no headers")],
      })),
    });
    const result = await pollStep(deps(store, t));
    expect(result).toMatchObject({ mailboxes: 1, stopped: 1, replies: 0 });
    expect(order).toEqual(["commit", "done"]);
    const message = store.inboundCommit.mock.calls[0] as unknown as [
      string,
      string,
      { asks_to_stop: boolean; references: string[]; from_email: string },
    ];
    expect(message[0]).toBe(WS);
    expect(message[2]).toMatchObject({
      asks_to_stop: true,
      references: ["<e1@agency.example>"],
      from_email: "pat@company.example",
    });
    expect(store.pollDone).toHaveBeenCalledWith(target, {
      ok: true,
      uidvalidity: 7,
      last_uid: 9,
      messages: expect.anything(),
    });
  });

  it("doesn't move the cursor when storing fails, so nothing is skipped", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = fakeStore({
      pollClaim: vi.fn(async () => [target]),
      inboundCommit: vi.fn(async () => {
        throw new Error("database down");
      }),
    });
    const t = transport({
      fetchNew: vi.fn(async (): Promise<Fetched> => ({
        ok: true,
        uidvalidity: 7,
        last_uid: 9,
        messages: [Buffer.from(REPLY)],
      })),
    });
    await pollStep(deps(store, t));
    expect(store.pollDone.mock.calls).toEqual([[target, { ok: false }]]);
  });

  it("counts a refused login and leaves the cursor alone", async () => {
    const store = fakeStore({ pollClaim: vi.fn(async () => [target]) });
    const t = transport({
      fetchNew: vi.fn(async (): Promise<Fetched> => ({
        ok: false,
        failure: { kind: "auth", message: "IMAP login refused" },
      })),
    });
    const result = await pollStep(deps(store, t));
    expect(result.mailboxes).toBe(0);
    expect(store.mailboxResult).toHaveBeenCalledWith(
      WS,
      "box-1",
      "auth_failed",
      "IMAP login refused",
    );
    expect(store.pollDone.mock.calls).toEqual([[target, { ok: false }]]);
  });
});

const usage = { input_tokens: 100, output_tokens: 50 } as Anthropic.Usage;
const model = (answers: (Record<string, unknown> | Error)[]): ModelClient => {
  const queue = [...answers];
  return {
    messages: {
      create: vi.fn(async () => {
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return {
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          usage,
          content: [{ type: "text", text: JSON.stringify(next) }],
        };
      }),
    },
  } as unknown as ModelClient;
};

const context = {
  workspace: { name: "Agency", website: "agency.example" },
  business_name: "Agency Ltd",
  booking_url: "https://cal.example/alice",
  instructions: "",
  knowledge: [
    { title: "What we do", content: "We build websites.", source_url: null },
  ],
};
const replyItem = (id: string, body: string) => ({
  received_id: id,
  subject: "Quick question",
  body,
  sender_name: "Alice Sender",
  lead: { name: "Pat", company: "Company" },
  history: [{ from: "us" as const, body: "Hello Pat." }],
});
const followupItem = (id: string, step: number) => ({
  email_id: id,
  step,
  subject: "Quick question",
  sender_name: "Alice Sender",
  lead: { name: "Pat", company: "Company" },
  prospect: { summary: "A bakery.", facts: [{ fact: "Opened in 2019." }] },
  sent: [{ step: 0, body: "Hello Pat, a first email of some length." }],
});

describe("the write step", () => {
  it("does nothing without both keys", async () => {
    expect(await writeStep(deps(fakeStore(), transport(), null))).toMatchObject(
      {
        status: "not_configured",
      },
    );
    expect(await writeStep(deps(null, transport(), model([])))).toMatchObject({
      status: "not_configured",
    });
  });

  it("stores what the model made of each reply, and each follow-up it wrote", async () => {
    const store = fakeStore({
      writeClaim: vi.fn(async () => ({
        capped: false,
        context,
        replies: [replyItem("r1", "Tell me more.")],
        followups: [followupItem("f1", 1)],
      })),
    });
    const client = model([
      {
        class: "interested",
        summary: "Wants more.",
        reply: "Hi Pat,\n\nGladly.\n\nAlice",
      },
      { body: "Hi Pat,\n\nOne more thing worth knowing.\n\nAlice" },
    ]);
    const result = await writeStep(deps(store, transport(), client));
    expect(result).toMatchObject({ read: 1, followups: 1, failed: 0 });
    expect(store.replyCommit).toHaveBeenCalledWith(
      WS,
      "r1",
      {
        class: "interested",
        summary: "Wants more.",
        reply: "Hi Pat,\n\nGladly.\n\nAlice",
        model: "claude-haiku-4-5",
      },
      350,
    );
    expect(store.followupSave).toHaveBeenCalledWith(
      WS,
      "f1",
      {
        body: "Hi Pat,\n\nOne more thing worth knowing.\n\nAlice",
        model: "claude-haiku-4-5",
      },
      350,
    );
  });

  it("releases a reply and a follow-up the model couldn't do, to be tried again", async () => {
    const store = fakeStore({
      writeClaim: vi.fn(async () => ({
        capped: false,
        context,
        replies: [replyItem("r1", "Hm.")],
        followups: [followupItem("f1", 2)],
      })),
    });
    const client = model([
      { class: "banana", summary: "", reply: "" },
      { body: "" },
    ]);
    const result = await writeStep(deps(store, transport(), client));
    expect(result).toMatchObject({ read: 0, followups: 0, failed: 2 });
    expect(store.replyCommit).toHaveBeenCalledWith(WS, "r1", null, 350);
    expect(store.followupSave).toHaveBeenCalledWith(WS, "f1", null, 350);
  });
});
