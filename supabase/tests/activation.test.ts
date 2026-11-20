import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationFiles, TestDb } from "./harness";

// Slice 2b, proved against the real migrations: what a new workspace starts
// with, the trial clock, the install check, "Try your agent", and the
// team's email alerts. And for each: that one workspace can't reach
// another's.

const DENIED = /row-level security|permission denied/;
const ACTIVATION = migrationFiles().find((f) => f.endsWith("_activation.sql"))!;

let db: TestDb;
let alice: string; // owner of A
let amy: string; // member of A
let bob: string; // owner of B
let A: string;
let B: string;
let tokenA: string;
let tokenB: string;

const call = async <T>(
  role: "anon" | "authenticated" | "service_role",
  sql: string,
  params: unknown[] = [],
  userId?: string,
) =>
  (await db.as<{ r: T }>({ role, userId }, `select ${sql} as r`, params))[0].r;

const uuid = async () =>
  (await db.admin<{ id: string }>(`select gen_random_uuid() as id`))[0].id;

type Context = {
  workspace: Record<string, unknown>;
  agent: Record<string, unknown> | null;
  replies_today: number;
  latest_visitor_message_id: string;
  knowledge: { title: string }[];
  messages: { id: string; author: string; body: string }[];
};

const begin = (ws: string, user: string, session: string, body: string) =>
  call<Context | null>("service_role", "agent_test_begin($1, $2, $3, $4)", [
    ws,
    user,
    session,
    body,
  ]);
const commitTest = (
  ws: string,
  user: string,
  session: string,
  inReplyTo: string,
  result: Record<string, unknown>,
) =>
  call<{ status: string; message_id?: string } | null>(
    "service_role",
    "agent_test_commit($1, $2, $3, $4, $5::jsonb)",
    [ws, user, session, inReplyTo, JSON.stringify(result)],
  );

type Claimed = {
  workspace: string;
  conversation_id: string;
  lead: string;
  recipients: string[];
  alerts: { id: string; kind: string; summary: string }[];
};
const claim = (token: string, conversation: string) =>
  call<Claimed | null>("service_role", "claim_team_alerts($1, $2)", [
    token,
    conversation,
  ]);
const startChat = async (token: string, body = "Hello") =>
  (await call<{ conversation_id: string; message_id: string }>(
    "anon",
    "chat_start($1, $2)",
    [token, body],
  ))!;
const commitChat = (
  token: string,
  conversation: string,
  inReplyTo: string,
  result: Record<string, unknown>,
) =>
  call<{ status: string }>(
    "service_role",
    "chat_agent_commit($1, $2, $3, $4::jsonb)",
    [token, conversation, inReplyTo, JSON.stringify(result)],
  );
const alertsFor = (conversation: string) =>
  db.admin<{ kind: string; status: string; summary: string }>(
    `select kind, status, summary from team_alerts where conversation_id = $1 order by created_at, kind`,
    [conversation],
  );
const setAgent = (ws: string, enabled: boolean, mode = "auto") =>
  db.admin(
    `update agents set enabled = $2, approval_mode = $3 where workspace_id = $1 and role = 'inbound'`,
    [ws, enabled, mode],
  );

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.createUser("alice@a.example", "Alice");
  amy = await db.createUser("amy@a.example", "Amy");
  bob = await db.createUser("bob@b.example", "Bob");
  [{ id: A }] = await db.user(alice)<{ id: string }>(
    `select create_workspace('Agency A', 'UTC', 'a.example', 'We sell A') as id`,
  );
  [{ id: B }] = await db.user(bob)<{ id: string }>(
    `select create_workspace('Agency B', 'UTC', null, 'We sell B') as id`,
  );
  await db.admin(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [A, amy],
  );
  [{ token: tokenA }] = await db.admin<{ token: string }>(
    `select token from chat_widgets where workspace_id = $1`,
    [A],
  );
  [{ token: tokenB }] = await db.admin<{ token: string }>(
    `select token from chat_widgets where workspace_id = $1`,
    [B],
  );
});

afterAll(async () => {
  await db.close();
});

describe("a new workspace", () => {
  it("starts with a chat widget, switched on, and a checklist row", async () => {
    expect(
      await db.user(alice)(
        `select name, enabled, title, first_seen_at, last_seen_at from chat_widgets where workspace_id = $1`,
        [A],
      ),
    ).toEqual([
      {
        name: "Website chat",
        enabled: true,
        title: "Chat with us",
        first_seen_at: null,
        last_seen_at: null,
      },
    ]);
    expect(
      await db.user(alice)(
        `select site_status, site_pages, tried_agent_at, dismissed_at from workspace_setup where workspace_id = $1`,
        [A],
      ),
    ).toEqual([
      {
        site_status: "none",
        site_pages: 0,
        tried_agent_at: null,
        dismissed_at: null,
      },
    ]);
    // The agent still starts switched off.
    expect(
      await db.admin(
        `select enabled from agents where workspace_id = $1 and role = 'inbound'`,
        [A],
      ),
    ).toEqual([{ enabled: false }]);
  });

  it("gets a 7-day trial from the moment it is made", async () => {
    const [row] = await db.user(alice)<{
      days: number;
      billing_status: string;
      plan: string;
    }>(
      `select extract(epoch from (trial_ends_at - created_at)) / 86400 as days, billing_status, plan from workspaces where id = $1`,
      [A],
    );
    expect(Number(row.days)).toBeCloseTo(7, 3);
    expect(row.billing_status).toBe("trialing");
    expect(row.plan).toBe("starter");
  });

  it("can't extend its own trial or mark itself paid", async () => {
    for (const change of [
      `trial_ends_at = now() + interval '10 years'`,
      `billing_status = 'active'`,
      `plan = 'scale'`,
    ])
      await expect(
        db.user(alice)(`update workspaces set ${change} where id = $1`, [A]),
        change,
      ).rejects.toThrow(DENIED);
  });
});

describe("workspaces that existed before this migration", () => {
  it("get a trial counted from when they were created, a checklist row, and keep their widgets as they were", async () => {
    const old = await TestDb.create({ before: ACTIVATION });
    try {
      const carol = await old.createUser("carol@old.example", "Carol");
      const [{ id }] = await old.user(carol)<{ id: string }>(
        `select create_workspace('Old Co', 'UTC', null, 'We sell old things') as id`,
      );
      await old.admin(
        `update workspaces set created_at = now() - interval '30 days' where id = $1`,
        [id],
      );
      await old.migrate(ACTIVATION);

      const [row] = await old.admin<{ days: number; billing_status: string }>(
        `select extract(epoch from (trial_ends_at - created_at)) / 86400 as days, billing_status from workspaces where id = $1`,
        [id],
      );
      expect(Number(row.days)).toBeCloseTo(7, 6);
      expect(row.billing_status).toBe("trialing");
      // Created 30 days ago, so its trial ended 23 days ago.
      expect(
        await old.admin(
          `select trial_ends_at < now() - interval '22 days' as ended from workspaces where id = $1`,
          [id],
        ),
      ).toEqual([{ ended: true }]);
      expect(
        await old.admin(
          `select site_status from workspace_setup where workspace_id = $1`,
          [id],
        ),
      ).toEqual([{ site_status: "none" }]);
      // No widget is made for them: Settings still offers "Create the chat".
      expect(
        await old.admin(`select 1 from chat_widgets where workspace_id = $1`, [
          id,
        ]),
      ).toEqual([]);
      expect(
        await old.admin(`select alert_emails from profiles where id = $1`, [
          carol,
        ]),
      ).toEqual([{ alert_emails: true }]);
    } finally {
      await old.close();
    }
  });
});

describe("the email alert switch", () => {
  it("is on by default, and each person turns their own off and on", async () => {
    expect(
      await db.user(amy)(`select alert_emails from profiles where id = $1`, [
        amy,
      ]),
    ).toEqual([{ alert_emails: true }]);
    const off = await db.user(amy)(
      `update profiles set alert_emails = false where id = $1`,
      [amy],
    );
    expect(off.affected).toBe(1);
    // Nobody switches it for someone else, teammate or not.
    for (const who of [alice, bob]) {
      const other = await db.user(who)(
        `update profiles set alert_emails = true where id = $1`,
        [amy],
      );
      expect(other.affected).toBe(0);
    }
    expect(
      await db.admin(`select alert_emails from profiles where id = $1`, [amy]),
    ).toEqual([{ alert_emails: false }]);
  });
});

describe("the install check", () => {
  const seen = (token: string, origin: string) =>
    call<boolean>("anon", "chat_widget_seen($1, $2)", [token, origin]);
  const row = async () =>
    (
      await db.admin<{
        first_seen_origin: string | null;
        last_seen_origin: string | null;
        first: boolean;
        last: boolean;
      }>(
        `select first_seen_origin, last_seen_origin, first_seen_at is not null as first, last_seen_at is not null as last from chat_widgets where token = $1`,
        [tokenA],
      )
    )[0];

  it("refuses anything that isn't a plain origin, and says nothing about unknown widgets", async () => {
    for (const origin of [
      "",
      "example.com",
      "https://example.com/pricing?visitor=dana",
      "https://user:pw@example.com",
      "javascript:alert(1)",
      "https://exa mple.com",
      "null",
    ])
      expect(await seen(tokenA, origin), origin).toBe(false);
    expect(await seen("nope", "https://example.com")).toBe(false);
    expect(await row()).toEqual({
      first_seen_origin: null,
      last_seen_origin: null,
      first: false,
      last: false,
    });
  });

  it("records the first and the latest site the widget loaded on, and nothing about the visitor", async () => {
    expect(await seen(tokenA, "https://Example.com")).toBe(true);
    expect(await row()).toEqual({
      first_seen_origin: "https://example.com",
      last_seen_origin: "https://example.com",
      first: true,
      last: true,
    });
    // The whole record is two origins and two times.
    const columns = await db.admin<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'chat_widgets' and column_name like '%seen%' order by 1`,
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "first_seen_at",
      "first_seen_origin",
      "last_seen_at",
      "last_seen_origin",
    ]);
  });

  it("writes at most once every 30 seconds per widget", async () => {
    expect(await seen(tokenA, "https://shop.example.com")).toBe(false);
    expect((await row()).last_seen_origin).toBe("https://example.com");
    await db.admin(
      `update chat_widgets set last_seen_at = now() - interval '31 seconds' where token = $1`,
      [tokenA],
    );
    expect(await seen(tokenA, "https://shop.example.com:8443")).toBe(true);
    expect(await row()).toMatchObject({
      first_seen_origin: "https://example.com",
      last_seen_origin: "https://shop.example.com:8443",
    });
  });

  it("ignores a widget that is switched off", async () => {
    const [{ token }] = await db.admin<{ token: string }>(
      `insert into chat_widgets (workspace_id, name, enabled) values ($1, 'Off', false) returning token`,
      [A],
    );
    expect(await seen(token, "https://example.com")).toBe(false);
  });

  it("is read by the team and written by nobody signed in", async () => {
    expect(
      await db.user(amy)(
        `select last_seen_origin from chat_widgets where token = $1`,
        [tokenA],
      ),
    ).toEqual([{ last_seen_origin: "https://shop.example.com:8443" }]);
    await expect(
      db.user(alice)(
        `update chat_widgets set last_seen_origin = 'https://fake.example' where token = $1`,
        [tokenA],
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      call(
        "authenticated",
        "chat_widget_seen($1, $2)",
        [tokenA, "https://x.example"],
        alice,
      ),
    ).rejects.toThrow(/permission denied/);
    // The other workspace sees nothing of it.
    expect(
      await db.user(bob)(`select 1 from chat_widgets where token = $1`, [
        tokenA,
      ]),
    ).toEqual([]);
  });
});

describe("the checklist's row", () => {
  it("is moved along by members of the workspace only", async () => {
    const mine = await db.user(amy)(
      `update workspace_setup set site_status = 'reading', site_url = 'a.example', site_started_at = now() where workspace_id = $1`,
      [A],
    );
    expect(mine.affected).toBe(1);
    const theirs = await db.user(bob)(
      `update workspace_setup set dismissed_at = now() where workspace_id = $1`,
      [A],
    );
    expect(theirs.affected).toBe(0);
    expect(
      await db.user(bob)(`select workspace_id from workspace_setup`),
    ).toEqual([{ workspace_id: B }]);
  });

  it("can't be told the agent was tried: only the server records that", async () => {
    await expect(
      db.user(alice)(
        `update workspace_setup set tried_agent_at = now() where workspace_id = $1`,
        [A],
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      db.user(alice)(`delete from workspace_setup where workspace_id = $1`, [
        A,
      ]),
    ).rejects.toThrow(DENIED);
  });
});

describe("try your agent", () => {
  const counts = async (ws: string) =>
    (
      await db.admin<Record<string, number>>(
        `select
           (select count(*)::int from leads where workspace_id = $1) as leads,
           (select count(*)::int from conversations where workspace_id = $1) as conversations,
           (select count(*)::int from messages where workspace_id = $1) as messages,
           (select count(*)::int from message_drafts where workspace_id = $1) as drafts,
           (select count(*)::int from activity_events where workspace_id = $1) as events,
           (select count(*)::int from team_alerts where workspace_id = $1) as alerts`,
        [ws],
      )
    )[0];

  it("works while the agent is switched off, with the workspace's real knowledge", async () => {
    const session = await uuid();
    const ctx = (await begin(A, alice, session, "Do you work with dentists?"))!;
    expect(ctx.agent).toMatchObject({
      name: "Inbound agent",
      approval_mode: "approve_first",
    });
    expect(ctx.workspace).toMatchObject({
      name: "Agency A",
      website: "a.example",
      billing_status: "trialing",
    });
    expect(ctx.workspace.trial_ends_at).toBeTruthy();
    expect(ctx.knowledge.map((k) => k.title)).toEqual(["What we sell"]);
    expect(ctx.messages).toEqual([
      {
        id: ctx.latest_visitor_message_id,
        author: "lead",
        body: "Do you work with dentists?",
      },
    ]);
  });

  it("never creates a lead, a conversation, a message, a feed event or an alert", async () => {
    const before = await counts(A);
    const session = await uuid();
    const ctx = (await begin(A, alice, session, "How much is it?"))!;
    expect(
      await commitTest(A, alice, session, ctx.latest_visitor_message_id, {
        reply: "Plans start at $900 a month.",
        outcome: "qualified",
        summary: "Wants a site.",
        handoff: true,
        stop_contact: false,
        model: "claude-haiku-4-5",
      }),
    ).toMatchObject({ status: "sent" });
    expect(await counts(A)).toEqual(before);
    // Nothing for Today's numbers or the Inbox to count.
    expect(before.conversations).toBe(0);
  });

  it("keeps the turn, what the agent concluded, and marks the agent as tried", async () => {
    const session = await uuid();
    const ctx = (await begin(A, amy, session, "Can I talk to someone?"))!;
    await commitTest(A, amy, session, ctx.latest_visitor_message_id, {
      reply: "Of course. Someone from the team will reply here.",
      outcome: "needs_human",
      summary: "Asked for a person.",
      handoff: true,
      stop_contact: false,
      model: "claude-haiku-4-5",
    });
    expect(
      await db.user(amy)(
        `select author, body, metadata ->> 'outcome' as outcome, (metadata ->> 'handoff')::boolean as handoff from agent_test_messages where session_id = $1 order by created_at`,
        [session],
      ),
    ).toEqual([
      {
        author: "user",
        body: "Can I talk to someone?",
        outcome: null,
        handoff: null,
      },
      {
        author: "agent",
        body: "Of course. Someone from the team will reply here.",
        outcome: "needs_human",
        handoff: true,
      },
    ]);
    expect(
      await db.admin(
        `select tried_agent_at is not null as tried from workspace_setup where workspace_id = any($1) order by workspace_id = $2 desc`,
        [[A, B], A],
      ),
    ).toEqual([{ tried: true }, { tried: false }]);

    // The next turn carries the conversation so far, in order.
    const next = (await begin(A, amy, session, "Thanks"))!;
    expect(next.messages.map((m) => [m.author, m.body])).toEqual([
      ["lead", "Can I talk to someone?"],
      ["agent", "Of course. Someone from the team will reply here."],
      ["lead", "Thanks"],
    ]);
  });

  it("drops an answer to a message the person has typed past, and stores nothing for a silent handoff", async () => {
    const session = await uuid();
    const first = (await begin(A, alice, session, "One"))!;
    const second = (await begin(A, alice, session, "Two"))!;
    expect(
      await commitTest(A, alice, session, first.latest_visitor_message_id, {
        reply: "Late answer",
      }),
    ).toEqual({ status: "stale" });
    expect(
      await commitTest(A, alice, session, second.latest_visitor_message_id, {
        reply: "  ",
        handoff: true,
      }),
    ).toEqual({ status: "silent" });
    expect(
      await db.admin(
        `select author from agent_test_messages where session_id = $1 and author = 'agent'`,
        [session],
      ),
    ).toEqual([]);
  });

  it("counts test replies against the same daily cap as real ones", async () => {
    const [{ n: tests }] = await db.admin<{ n: number }>(
      `select count(*)::int as n from agent_test_messages where workspace_id = $1 and author = 'agent'`,
      [A],
    );
    expect(tests).toBeGreaterThan(0);
    // Workspace B has its own count.
    const ctxB = (await begin(B, bob, await uuid(), "Hi"))!;
    expect(ctxB.replies_today).toBe(0);
    // A real chat's context counts A's test replies too.
    const chat = await startChat(tokenA);
    const real = (await call<Context>(
      "service_role",
      "chat_agent_context($1, $2)",
      [tokenA, chat.conversation_id],
    ))!;
    expect(real.replies_today).toBe(tests);
  });

  it("refuses someone who isn't in the workspace, and reads only the asker's own chat", async () => {
    const session = await uuid();
    expect(await begin(A, bob, session, "Let me in")).toBeNull();
    expect(
      await commitTest(A, bob, session, await uuid(), { reply: "x" }),
    ).toBeNull();
    // Amy's session isn't Alice's: the same id under another person is empty.
    const [{ session_id }] = await db.admin<{ session_id: string }>(
      `select session_id from agent_test_messages where user_id = $1 limit 1`,
      [amy],
    );
    const ctx = (await begin(A, alice, session_id, "Mine"))!;
    expect(ctx.messages.map((m) => m.body)).toEqual(["Mine"]);
    // And B's people can't read A's test chats at all.
    expect(
      await db.user(bob)(`select workspace_id from agent_test_messages`),
    ).toEqual([{ workspace_id: B }]);
  });

  it("has its own tight limit: 8 messages a minute per person", async () => {
    const dana = await db.createUser("dana@a.example", "Dana");
    await db.admin(
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
      [A, dana],
    );
    const session = await uuid();
    for (let i = 0; i < 8; i++) await begin(A, dana, session, `Message ${i}`);
    await expect(begin(A, dana, session, "One too many")).rejects.toThrow(
      /too many test messages/,
    );
    // Someone else in the workspace isn't held up by it.
    expect(await begin(A, alice, await uuid(), "Still fine")).not.toBeNull();
  });

  it("refuses an empty or oversized message", async () => {
    for (const body of ["", "   ", "x".repeat(2001)])
      await expect(begin(B, bob, await uuid(), body)).rejects.toThrow(
        /1 to 2000 characters/,
      );
  });

  it("can only be run by the server", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        call(
          role,
          "agent_test_begin($1, $2, $3, 'Hi')",
          [A, alice, await uuid()],
          alice,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        call(
          role,
          "agent_test_commit($1, $2, $3, $4, '{}'::jsonb)",
          [A, alice, await uuid(), await uuid()],
          alice,
        ),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      db.user(alice)(
        `insert into agent_test_messages (workspace_id, user_id, session_id, author, body) values ($1, $2, gen_random_uuid(), 'agent', 'Forged')`,
        [A, alice],
      ),
    ).rejects.toThrow(DENIED);
  });
});

describe("team alerts", () => {
  it("queues one when a new chat arrives and no agent is answering", async () => {
    await setAgent(A, false);
    const chat = await startChat(tokenA, "Anyone there?");
    expect(await alertsFor(chat.conversation_id)).toEqual([
      {
        kind: "needs_human",
        status: "pending",
        summary: "A new website chat is waiting for your team.",
      },
    ]);
  });

  it("queues nothing for a new chat the agent will answer", async () => {
    await setAgent(A, true);
    const chat = await startChat(tokenA);
    expect(await alertsFor(chat.conversation_id)).toEqual([]);
  });

  it("queues one each when the agent qualifies a lead, hands over, or leaves a draft", async () => {
    await setAgent(A, true, "approve_first");
    const chat = await startChat(tokenA, "We have three clinics.");
    await commitChat(tokenA, chat.conversation_id, chat.message_id, {
      reply: "Great, the team will be in touch.",
      outcome: "qualified",
      summary: "Three clinics, ready to start.",
      handoff: true,
      visitor_name: "Dana Reyes",
    });
    expect(
      (await alertsFor(chat.conversation_id)).map((a) => a.kind).sort(),
    ).toEqual(["draft_waiting", "needs_human", "qualified"]);
  });

  it("hands each alert to the server once, with the members who want email", async () => {
    await setAgent(A, true, "approve_first");
    const chat = await startChat(tokenA, "We have three clinics.");
    await commitChat(tokenA, chat.conversation_id, chat.message_id, {
      reply: "Thanks.",
      outcome: "qualified",
      summary: "Three clinics.",
      visitor_name: "Dana Reyes",
    });
    const first = (await claim(tokenA, chat.conversation_id))!;
    expect(first.workspace).toBe("Agency A");
    expect(first.conversation_id).toBe(chat.conversation_id);
    expect(first.lead).toBe("Dana Reyes");
    // Amy switched hers off above; Dana and Alice have it on.
    expect(first.recipients).toEqual(["alice@a.example", "dana@a.example"]);
    expect(first.alerts.map((a) => a.kind).sort()).toEqual([
      "draft_waiting",
      "qualified",
    ]);
    expect(
      (await alertsFor(chat.conversation_id)).map((a) => a.status),
    ).toEqual(["sending", "sending"]);

    // One email per event: a second claim finds nothing left.
    expect((await claim(tokenA, chat.conversation_id))!.alerts).toEqual([]);

    const [sent, failed] = first.alerts;
    expect(
      await call("service_role", "finish_team_alert($1, true, 2)", [sent.id]),
    ).toBe(true);
    expect(
      await call("service_role", "finish_team_alert($1, false, 0)", [
        failed.id,
      ]),
    ).toBe(true);
    // And it can't be finished twice.
    expect(
      await call("service_role", "finish_team_alert($1, true, 2)", [sent.id]),
    ).toBe(false);
    expect(
      await db.admin(
        `select status, recipients, sent_at is not null as stamped from team_alerts where id = any($1) order by status`,
        [[sent.id, failed.id]],
      ),
    ).toEqual([
      { status: "failed", recipients: 0, stamped: false },
      { status: "sent", recipients: 2, stamped: true },
    ]);
  });

  it("only gives a conversation's alerts to the widget token of its own workspace", async () => {
    await setAgent(A, false);
    const chat = await startChat(tokenA);
    expect(await claim(tokenB, chat.conversation_id)).toBeNull();
    expect(await claim("nope", chat.conversation_id)).toBeNull();
    expect((await alertsFor(chat.conversation_id))[0].status).toBe("pending");
  });

  it("stops at 20 alert emails per workspace per hour, and B is unaffected", async () => {
    await setAgent(A, false);
    await setAgent(B, false);
    await db.admin(
      `update team_alerts set created_at = now() - interval '2 hours'`,
    );
    // Twenty alerts already claimed this hour.
    const used = await startChat(tokenA);
    await db.admin(
      `insert into team_alerts (workspace_id, conversation_id, kind, status)
       select $1, $2, 'needs_human', 'sent' from generate_series(1, 20)`,
      [A, used.conversation_id],
    );
    const over = await startChat(tokenA);
    expect((await claim(tokenA, over.conversation_id))!.alerts).toEqual([]);
    expect((await alertsFor(over.conversation_id))[0].status).toBe("skipped");

    const other = await startChat(tokenB);
    const claimed = (await claim(tokenB, other.conversation_id))!;
    expect(claimed.alerts).toHaveLength(1);
    expect(claimed.recipients).toEqual(["bob@b.example"]);
    await db.admin(
      `update team_alerts set created_at = now() - interval '2 hours'`,
    );
  });

  it("leaves old alerts alone, so switching email on later sends no backlog", async () => {
    await setAgent(A, false);
    const chat = await startChat(tokenA);
    await db.admin(
      `update team_alerts set created_at = now() - interval '16 minutes' where conversation_id = $1`,
      [chat.conversation_id],
    );
    expect((await claim(tokenA, chat.conversation_id))!.alerts).toEqual([]);
    expect((await alertsFor(chat.conversation_id))[0].status).toBe("pending");
  });

  it("skips an alert when nobody in the workspace wants email", async () => {
    await setAgent(B, false);
    await db.admin(`update profiles set alert_emails = false where id = $1`, [
      bob,
    ]);
    const chat = await startChat(tokenB);
    const claimed = (await claim(tokenB, chat.conversation_id))!;
    expect(claimed).toMatchObject({ recipients: [], alerts: [] });
    expect((await alertsFor(chat.conversation_id))[0].status).toBe("skipped");
    await db.admin(`update profiles set alert_emails = true where id = $1`, [
      bob,
    ]);
  });

  it("never gets in the way of the chat, even when an event can't be queued", async () => {
    await setAgent(A, false);
    // A feed event with no conversation in it: nothing is queued, nothing fails.
    const inserted = await db.admin(
      `insert into activity_events (workspace_id, kind, summary, channel, metadata)
       values ($1, 'handoff_requested', 'Odd', 'chat', '{"conversation_id": "not-a-uuid"}') returning id`,
      [A],
    );
    expect(inserted).toHaveLength(1);
  });

  it("can't be set off by a signed-in person writing a feed event by hand", async () => {
    const chat = await startChat(tokenA);
    const before = await alertsFor(chat.conversation_id);
    const [{ lead_id }] = await db.admin<{ lead_id: string }>(
      `select lead_id from conversations where id = $1`,
      [chat.conversation_id],
    );
    await db.user(amy)(
      `insert into activity_events (workspace_id, lead_id, actor_id, kind, summary, channel, metadata)
       values ($1, $2, $3, 'handoff_requested', 'Buy cheap watches', 'chat', jsonb_build_object('conversation_id', $4::text))`,
      [A, lead_id, amy, chat.conversation_id],
    );
    expect(await alertsFor(chat.conversation_id)).toEqual(before);
  });

  it("is read by the team, written by nobody signed in, and claimed only by the server", async () => {
    expect(
      (
        await db.user(amy)(
          `select 1 from team_alerts where workspace_id = $1`,
          [A],
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      await db.user(bob)(`select 1 from team_alerts where workspace_id = $1`, [
        A,
      ]),
    ).toEqual([]);
    await expect(
      db.user(alice)(`update team_alerts set status = 'pending'`),
    ).rejects.toThrow(DENIED);
    const chat = await startChat(tokenA);
    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        call(
          role,
          "claim_team_alerts($1, $2)",
          [tokenA, chat.conversation_id],
          alice,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        call(role, "finish_team_alert($1, true, 1)", [await uuid()], alice),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("the trial dates for the server", () => {
  it("come with the agent's context and on their own, for the server only", async () => {
    const state = await call<Record<string, string>>(
      "service_role",
      "chat_billing_state($1)",
      [tokenA],
    );
    expect(state.billing_status).toBe("trialing");
    expect(new Date(state.trial_ends_at).getTime()).toBeGreaterThan(Date.now());
    expect(
      await call("service_role", "chat_billing_state($1)", ["nope"]),
    ).toBeNull();
    for (const role of ["anon", "authenticated"] as const)
      await expect(
        call(role, "chat_billing_state($1)", [tokenA], alice),
      ).rejects.toThrow(/permission denied/);

    const chat = await startChat(tokenA);
    const ctx = (await call<Context>(
      "service_role",
      "chat_agent_context($1, $2)",
      [tokenA, chat.conversation_id],
    ))!;
    expect(ctx.workspace).toMatchObject({
      name: "Agency A",
      billing_status: "trialing",
      trial_ends_at: state.trial_ends_at,
    });
  });
});
