import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

// The website chat, proved against the real migrations: what a visitor can
// do with nothing but the widget's public token, what the two workspaces can
// and can't do to each other's chats and drafts, and what the agent's two
// server-only functions write.

const DENIED = /row-level security|permission denied/;

let db: TestDb;
let alice: string; // owner of A
let amy: string; // member of A
let bob: string; // owner of B
let A: string;
let B: string;
let tokenA: string;
let tokenB: string;
let widgetA: string;

type Started = { conversation_id: string; visitor_key: string };
type Polled = {
  state: string;
  messages: { id: string; from: string; body: string }[];
};

const call = async <T>(
  role: "anon" | "service_role",
  sql: string,
  params: unknown[],
) => (await db.as<{ r: T }>({ role }, `select ${sql} as r`, params))[0].r;

const start = (token: string, body: string) =>
  call<Started | null>("anon", "chat_start($1, $2)", [token, body]);
const post = (token: string, c: Started, body: string) =>
  call<{ message_id: string } | null>("anon", "chat_post($1, $2, $3, $4)", [
    token,
    c.conversation_id,
    c.visitor_key,
    body,
  ]);
const poll = (token: string, c: Started) =>
  call<Polled | null>("anon", "chat_poll($1, $2, $3)", [
    token,
    c.conversation_id,
    c.visitor_key,
  ]);
const context = (token: string, conversation: string) =>
  call<Record<string, unknown> | null>(
    "service_role",
    "chat_agent_context($1, $2)",
    [token, conversation],
  );
const commit = (
  token: string,
  conversation: string,
  inReplyTo: string,
  result: Record<string, unknown>,
) =>
  call<{ status: string; handoff?: boolean } | null>(
    "service_role",
    "chat_agent_commit($1, $2, $3, $4::jsonb)",
    [token, conversation, inReplyTo, JSON.stringify(result)],
  );

const latest = async (conversation: string) =>
  (
    await db.admin<{ id: string }>(
      `select id from messages where conversation_id = $1 and direction = 'in' order by sent_at desc, created_at desc limit 1`,
      [conversation],
    )
  )[0].id;
const conversationRow = async (id: string) =>
  (
    await db.admin<{
      status: string;
      agent_paused: boolean;
      outcome: string | null;
      outcome_summary: string | null;
      workspace_id: string;
      lead_id: string;
      channel: string;
      visitor_key_hash: string;
    }>(`select * from conversations where id = $1`, [id])
  )[0];
const setAgent = (ws: string, enabled: boolean, mode = "approve_first") =>
  db.admin(
    `update agents set enabled = $2, approval_mode = $3 where workspace_id = $1 and role = 'inbound'`,
    [ws, enabled, mode],
  );
const reply = (text: string, extra: Record<string, unknown> = {}) => ({
  reply: text,
  outcome: "none",
  summary: "",
  handoff: false,
  stop_contact: false,
  visitor_name: "",
  visitor_email: "",
  model: "test",
  ...extra,
});

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.createUser("alice@a.example", "Alice");
  amy = await db.createUser("amy@a.example", "Amy");
  bob = await db.createUser("bob@b.example", "Bob");
  [{ id: A }] = await db.user(alice)<{ id: string }>(
    `select create_workspace('Agency A', 'UTC', null, 'We sell A') as id`,
  );
  [{ id: B }] = await db.user(bob)<{ id: string }>(
    `select create_workspace('Agency B', 'UTC', null, 'We sell B') as id`,
  );
  await db.admin(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [A, amy],
  );
  // Admins create widgets through the table, under the policies.
  [{ id: widgetA, token: tokenA }] = await db.user(alice)<{
    id: string;
    token: string;
  }>(
    `insert into chat_widgets (workspace_id, name, created_by) values ($1, 'Website chat', $2) returning id, token`,
    [A, alice],
  );
  [{ token: tokenB }] = await db.user(bob)<{ token: string }>(
    `insert into chat_widgets (workspace_id, name, created_by) values ($1, 'Website chat', $2) returning token`,
    [B, bob],
  );
});

afterAll(async () => {
  await db.close();
});

describe("chat widgets", () => {
  it("are created by admins only, with a token nobody chooses", async () => {
    await expect(
      db.user(amy)(
        `insert into chat_widgets (workspace_id, name, created_by) values ($1, 'Mine', $2)`,
        [A, amy],
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      db.user(alice)(
        `insert into chat_widgets (workspace_id, name, created_by, token) values ($1, 'Mine', $2, 'chosen')`,
        [A, alice],
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      db.user(alice)(`update chat_widgets set token = 'x' where id = $1`, [
        widgetA,
      ]),
    ).rejects.toThrow(DENIED);
    expect(tokenA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tell a visitor the title and greeting, and nothing for an unknown or switched-off one", async () => {
    expect(await call("anon", "chat_widget_info($1)", [tokenA])).toEqual({
      title: "Chat with us",
      welcome: "Hi. How can we help?",
    });
    expect(await call("anon", "chat_widget_info($1)", ["nope"])).toBeNull();
    const [{ token }] = await db.admin<{ token: string }>(
      `insert into chat_widgets (workspace_id, name, enabled) values ($1, 'Off', false) returning token`,
      [A],
    );
    expect(await call("anon", "chat_widget_info($1)", [token])).toBeNull();
    expect(await start(token, "Hello")).toBeNull();
  });
});

describe("a visitor", () => {
  let chat: Started;

  it("starts a chat: a lead, a waiting chat conversation, the message and a feed event, in the widget's workspace only", async () => {
    const before = await db.admin(
      `select (select count(*) from leads where workspace_id = $1) as leads, (select count(*) from messages where workspace_id = $1) as messages`,
      [B],
    );
    chat = (await start(tokenA, "  Do you work with dentists?  "))!;
    expect(chat.visitor_key).toMatch(/^[0-9a-f]{64}$/);
    const c = await conversationRow(chat.conversation_id);
    expect(c).toMatchObject({
      workspace_id: A,
      channel: "chat",
      status: "waiting_for_you",
      agent_paused: false,
    });
    // The key itself is not stored, only its hash.
    expect(c.visitor_key_hash).not.toBe(chat.visitor_key);
    expect(
      await db.admin(
        `select name, source, status, email from leads where id = $1`,
        [c.lead_id],
      ),
    ).toEqual([
      {
        name: "Website visitor",
        source: "chat: Website chat",
        status: "new",
        email: null,
      },
    ]);
    expect(
      await db.admin(
        `select direction, author, body, delivery_status from messages where conversation_id = $1`,
        [chat.conversation_id],
      ),
    ).toEqual([
      {
        direction: "in",
        author: "lead",
        body: "Do you work with dentists?",
        delivery_status: "received",
      },
    ]);
    expect(
      await db.admin(
        `select kind, summary from activity_events where lead_id = $1`,
        [c.lead_id],
      ),
    ).toEqual([
      { kind: "chat_started", summary: 'New chat on "Website chat"' },
    ]);
    expect(
      await db.admin(
        `select (select count(*) from leads where workspace_id = $1) as leads, (select count(*) from messages where workspace_id = $1) as messages`,
        [B],
      ),
    ).toEqual(before);
  });

  it("posts and reads with their key, and with nothing less", async () => {
    expect(await post(tokenA, chat, "And what does it cost?")).not.toBeNull();
    const seen = (await poll(tokenA, chat))!;
    expect(seen.state).toBe("open");
    expect(seen.messages.map((m) => [m.from, m.body])).toEqual([
      ["visitor", "Do you work with dentists?"],
      ["visitor", "And what does it cost?"],
    ]);
    const wrongKey = { ...chat, visitor_key: "0".repeat(64) };
    expect(await poll(tokenA, wrongKey)).toBeNull();
    expect(await post(tokenA, wrongKey, "Let me in")).toBeNull();
    // Another workspace's widget token doesn't open it, even with the key.
    expect(await poll(tokenB, chat)).toBeNull();
    expect(await post(tokenB, chat, "Let me in")).toBeNull();
    // And a key from one chat doesn't open another.
    const other = (await start(tokenA, "A second visitor"))!;
    expect(
      await poll(tokenA, { ...other, visitor_key: chat.visitor_key }),
    ).toBeNull();
  });

  it("is refused empty and over-long messages", async () => {
    for (const body of ["", "   ", "x".repeat(2001)]) {
      await expect(start(tokenA, body)).rejects.toThrow(/1 to 2000/);
      await expect(post(tokenA, chat, body)).rejects.toThrow(/1 to 2000/);
    }
  });

  it("can't call the team's or the server's functions, or read a table", async () => {
    for (const sql of [
      `select send_chat_reply($1, 'x')`,
      `select chat_agent_context('${tokenA}', $1)`,
      `select chat_agent_commit('${tokenA}', $1, $1, '{}'::jsonb)`,
    ])
      await expect(
        db.as({ role: "anon" }, sql, [chat.conversation_id]),
      ).rejects.toThrow(/permission denied/);
    for (const table of ["chat_widgets", "message_drafts", "conversations"])
      await expect(
        db.as({ role: "anon" }, `select * from ${table}`),
      ).rejects.toThrow(/permission denied/);
  });

  it("is stopped at 10 messages a minute and 60 per conversation", async () => {
    const c = (await start(tokenA, "1"))!;
    for (let i = 2; i <= 10; i++) await post(tokenA, c, String(i));
    await expect(post(tokenA, c, "11")).rejects.toThrow(/too many messages/);
    // Spread over time, the conversation itself fills up at 60.
    await db.admin(
      `update messages set sent_at = now() - interval '1 hour' where conversation_id = $1`,
      [c.conversation_id],
    );
    await db.admin(
      `insert into messages (workspace_id, conversation_id, direction, author, body, delivery_status, sent_at)
       select $1, $2, 'in', 'lead', 'older', 'received', now() - interval '2 hours' from generate_series(1, 50)`,
      [A, c.conversation_id],
    );
    await expect(post(tokenA, c, "61")).rejects.toThrow(/length limit/);
  });

  it("can't flood a widget with new chats: 20 a minute", async () => {
    const [{ token }] = await db.admin<{ token: string }>(
      `insert into chat_widgets (workspace_id, name) values ($1, 'Busy page') returning token`,
      [B],
    );
    for (let i = 0; i < 20; i++) await start(token, `Hello ${i}`);
    await expect(start(token, "One more")).rejects.toThrow(
      /too many new chats/,
    );
    // The other widget in the same workspace is unaffected.
    expect(await start(tokenB, "Still fine")).not.toBeNull();
  });
});

describe("a teammate in the Inbox", () => {
  let chat: Started;

  beforeAll(async () => {
    chat = (await start(tokenA, "Is anyone there?"))!;
  });

  it("replies by hand: the visitor sees it and the agent is paused", async () => {
    const [{ id }] = await db.user(amy)<{ id: string }>(
      `select send_chat_reply($1, 'Hi, Amy here.') as id`,
      [chat.conversation_id],
    );
    expect(id).toBeTruthy();
    expect(await conversationRow(chat.conversation_id)).toMatchObject({
      status: "open",
      agent_paused: true,
    });
    const seen = (await poll(tokenA, chat))!;
    expect(seen.state).toBe("team");
    expect(seen.messages.at(-1)).toMatchObject({
      from: "team",
      body: "Hi, Amy here.",
    });
    expect(
      await db.admin(
        `select author, author_user_id, delivery_status from messages where id = $1`,
        [id],
      ),
    ).toEqual([
      { author: "user", author_user_id: amy, delivery_status: "sent" },
    ]);
  });

  it("hands it back with an ordinary update", async () => {
    const done = await db.user(amy)(
      `update conversations set agent_paused = false where id = $1`,
      [chat.conversation_id],
    );
    expect(done.affected).toBe(1);
    expect((await poll(tokenA, chat))!.state).toBe("open");
  });

  it("can't reply in another workspace's chat, or outside a website chat", async () => {
    await expect(
      db.user(bob)(`select send_chat_reply($1, 'Hello from B')`, [
        chat.conversation_id,
      ]),
    ).rejects.toThrow(/conversation not found/);
    const [{ id: emailConversation }] = await db.admin<{ id: string }>(
      `insert into conversations (workspace_id, lead_id, channel)
       select workspace_id, lead_id, 'email' from conversations where id = $1 returning id`,
      [chat.conversation_id],
    );
    await expect(
      db.user(amy)(`select send_chat_reply($1, 'Hello')`, [emailConversation]),
    ).rejects.toThrow(/not a website chat/);
    // The old direct insert still can't mark a message as sent.
    await expect(
      db.user(amy)(
        `insert into messages (workspace_id, conversation_id, direction, author, author_user_id, body, delivery_status) values ($1, $2, 'out', 'user', $3, 'x', 'sent')`,
        [A, chat.conversation_id, amy],
      ),
    ).rejects.toThrow(DENIED);
  });
});

describe("the agent's context (server only)", () => {
  it("is the workspace's own agent, knowledge and conversation, and nobody else's", async () => {
    await db.admin(
      `insert into knowledge_items (workspace_id, title, kind, content, status, source_url) values
         ($1, 'A pricing', 'text', 'A costs 10', 'ready', null),
         ($1, 'A page', 'url', 'Text read from the page', 'ready', 'https://a.example/'),
         ($1, 'A unread page', 'url', 'https://a.example/later', 'not_fetched', null),
         ($2, 'B pricing', 'text', 'B SECRET', 'ready', null)`,
      [A, B],
    );
    await db.admin(
      `update agents set instructions = 'Be brief.', qualifying_questions = 'How many locations?' where workspace_id = $1 and role = 'inbound'`,
      [A],
    );
    await setAgent(A, true);
    const chat = (await start(tokenA, "Hello"))!;
    const ctx = (await context(tokenA, chat.conversation_id))!;
    expect(ctx.workspace).toEqual({ name: "Agency A", website: null });
    expect(ctx.agent).toMatchObject({
      name: "Inbound agent",
      instructions: "Be brief.",
      qualifying_questions: "How many locations?",
      approval_mode: "approve_first",
    });
    expect(ctx.paused).toBe(false);
    const titles = (ctx.knowledge as { title: string }[]).map((k) => k.title);
    expect(titles.sort()).toEqual(["A page", "A pricing", "What we sell"]);
    expect(JSON.stringify(ctx)).not.toContain("B SECRET");
    expect(
      (ctx.messages as { author: string; body: string }[]).map((m) => [
        m.author,
        m.body,
      ]),
    ).toEqual([["lead", "Hello"]]);
    expect(ctx.latest_visitor_message_id).toBe(
      await latest(chat.conversation_id),
    );
    // Workspace B's token gets nothing for A's conversation.
    expect(await context(tokenB, chat.conversation_id)).toBeNull();
    expect(
      await commit(
        tokenB,
        chat.conversation_id,
        await latest(chat.conversation_id),
        reply("Hi"),
      ),
    ).toBeNull();
  });

  it("has no agent when the inbound chat agent is switched off", async () => {
    await setAgent(A, false);
    const chat = (await start(tokenA, "Hello"))!;
    expect((await context(tokenA, chat.conversation_id))!.agent).toBeNull();
    expect(
      await commit(
        tokenA,
        chat.conversation_id,
        await latest(chat.conversation_id),
        reply("Hi"),
      ),
    ).toEqual({ status: "off" });
  });

  it("is refused to signed-in people", async () => {
    await expect(
      db.user(alice)(`select chat_agent_context($1, gen_random_uuid())`, [
        tokenA,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.user(alice)(
        `select chat_agent_commit($1, gen_random_uuid(), gen_random_uuid(), '{}'::jsonb)`,
        [tokenA],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("the agent's reply", () => {
  it("on 'send on its own' goes straight to the visitor", async () => {
    await setAgent(A, true, "auto");
    const chat = (await start(tokenA, "Do you work with dentists?"))!;
    expect(
      await commit(
        tokenA,
        chat.conversation_id,
        await latest(chat.conversation_id),
        reply("Yes, we do."),
      ),
    ).toEqual({ status: "sent", handoff: false });
    const seen = (await poll(tokenA, chat))!;
    expect(seen.state).toBe("open");
    expect(seen.messages.at(-1)).toMatchObject({
      from: "agent",
      body: "Yes, we do.",
    });
    expect((await conversationRow(chat.conversation_id)).status).toBe("open");
  });

  it("on 'ask me first' waits as a draft the visitor can't see, until a person approves, edits or discards it", async () => {
    await setAgent(A, true, "approve_first");
    const chat = (await start(tokenA, "What does it cost?"))!;
    const run = async (text: string) =>
      commit(
        tokenA,
        chat.conversation_id,
        await latest(chat.conversation_id),
        reply(text),
      );
    expect(await run("It costs 10.")).toEqual({
      status: "draft",
      handoff: false,
    });
    let seen = (await poll(tokenA, chat))!;
    expect(seen.state).toBe("review");
    expect(seen.messages.map((m) => m.from)).toEqual(["visitor"]);
    expect((await conversationRow(chat.conversation_id)).status).toBe(
      "waiting_for_you",
    );
    const drafts = () =>
      db.user(amy)<{ id: string; body: string; status: string }>(
        `select id, body, status from message_drafts where conversation_id = $1 order by created_at, status`,
        [chat.conversation_id],
      );
    const [draft] = await drafts();
    expect(draft).toMatchObject({ body: "It costs 10.", status: "pending" });
    expect(
      await db.admin(
        `select count(*)::int as n from activity_events where kind = 'draft_waiting' and metadata ->> 'conversation_id' = $1`,
        [chat.conversation_id],
      ),
    ).toEqual([{ n: 1 }]);

    // Workspace B can neither see nor decide it.
    expect(
      await db.user(bob)(`select 1 from message_drafts where id = $1`, [
        draft.id,
      ]),
    ).toEqual([]);
    for (const sql of [
      `select approve_chat_draft($1)`,
      `select discard_chat_draft($1)`,
    ])
      await expect(db.user(bob)(sql, [draft.id])).rejects.toThrow(
        /draft not found/,
      );
    // Nobody edits a draft's row directly, not even a member of A.
    await expect(
      db.user(amy)(`update message_drafts set status = 'approved'`),
    ).rejects.toThrow(DENIED);

    // A newer visitor message replaces the waiting draft.
    await post(tokenA, chat, "Per month?");
    expect((await run("10 a month."))!.status).toBe("draft");
    expect((await drafts()).map((d) => d.status).sort()).toEqual([
      "discarded",
      "pending",
    ]);
    const pending = (await drafts()).find((d) => d.status === "pending")!;

    // Edited, then sent.
    await db.user(amy)(`select approve_chat_draft($1, $2)`, [
      pending.id,
      "It is 10 a month, billed monthly.",
    ]);
    seen = (await poll(tokenA, chat))!;
    expect(seen.state).toBe("open");
    expect(seen.messages.at(-1)).toMatchObject({
      from: "agent",
      body: "It is 10 a month, billed monthly.",
    });
    expect(
      await db.admin(
        `select metadata ->> 'edited' as edited, metadata ->> 'approved_by' as by from messages where conversation_id = $1 and author = 'agent'`,
        [chat.conversation_id],
      ),
    ).toEqual([{ edited: "true", by: amy }]);
    // A decided draft can't be decided again.
    await expect(
      db.user(amy)(`select approve_chat_draft($1)`, [pending.id]),
    ).rejects.toThrow(/draft not found/);

    // Discarded: nothing is sent and it keeps waiting for a person.
    await post(tokenA, chat, "Any discount?");
    await run("Sure, 50% off.");
    const next = (await drafts()).find((d) => d.status === "pending")!;
    await db.user(amy)(`select discard_chat_draft($1)`, [next.id]);
    seen = (await poll(tokenA, chat))!;
    expect(seen.messages.some((m) => m.body.includes("50%"))).toBe(false);
    expect((await conversationRow(chat.conversation_id)).status).toBe(
      "waiting_for_you",
    );
  });

  it("is dropped when a newer message arrived or a person took over", async () => {
    await setAgent(A, true, "auto");
    const chat = (await start(tokenA, "First"))!;
    const first = await latest(chat.conversation_id);
    await post(tokenA, chat, "Second");
    expect(
      await commit(tokenA, chat.conversation_id, first, reply("Late")),
    ).toEqual({ status: "stale" });
    await db.user(amy)(`select send_chat_reply($1, 'I have this one.')`, [
      chat.conversation_id,
    ]);
    expect(
      await commit(
        tokenA,
        chat.conversation_id,
        await latest(chat.conversation_id),
        reply("Me too"),
      ),
    ).toEqual({ status: "paused" });
    expect((await poll(tokenA, chat))!.messages.map((m) => m.body)).toEqual([
      "First",
      "Second",
      "I have this one.",
    ]);
  });

  it("records a qualified lead the way Today counts it, with the visitor's details", async () => {
    await setAgent(A, true, "auto");
    const chat = (await start(tokenA, "We have 4 clinics"))!;
    const result = reply("Great, the team will be in touch.", {
      outcome: "qualified",
      summary: "4 clinics, wants a site this quarter.",
      visitor_name: "Dana Reyes",
      visitor_email: "Dana@Clinic.Example",
    });
    const run = async () =>
      commit(
        tokenA,
        chat.conversation_id,
        await latest(chat.conversation_id),
        result,
      );
    expect((await run())!.status).toBe("sent");
    const c = await conversationRow(chat.conversation_id);
    expect(c).toMatchObject({
      outcome: "qualified",
      outcome_summary: "4 clinics, wants a site this quarter.",
    });
    const [lead] = await db.admin<{
      name: string;
      email: string;
      status: string;
      custom_fields: { qualification: { outcome: string } };
    }>(`select * from leads where id = $1`, [c.lead_id]);
    expect(lead).toMatchObject({
      name: "Dana Reyes",
      email: "dana@clinic.example",
      status: "qualified",
    });
    expect(lead.custom_fields.qualification.outcome).toBe("qualified");
    const events = () =>
      db.admin(
        `select kind, metadata ->> 'to' as "to" from activity_events where lead_id = $1 and kind = 'lead_status_changed'`,
        [c.lead_id],
      );
    expect(await events()).toEqual([
      { kind: "lead_status_changed", to: "qualified" },
    ]);
    // Saying it again on the next turn records nothing new.
    await post(tokenA, chat, "Thanks");
    await run();
    expect((await events()).length).toBe(1);

    // An address another lead already has is noted, not taken.
    const other = (await start(tokenA, "Me again"))!;
    await commit(
      tokenA,
      other.conversation_id,
      await latest(other.conversation_id),
      reply("Hello again", { visitor_email: "dana@clinic.example" }),
    );
    const o = await conversationRow(other.conversation_id);
    expect(
      await db.admin(
        `select email, custom_fields ->> 'chat_email' as noted from leads where id = $1`,
        [o.lead_id],
      ),
    ).toEqual([{ email: null, noted: "dana@clinic.example" }]);
  });

  it("hands over and marks do not contact when the visitor asks to stop, and stays quiet afterwards", async () => {
    await setAgent(A, true, "auto");
    const chat = (await start(tokenA, "Stop contacting me"))!;
    expect(
      await commit(
        tokenA,
        chat.conversation_id,
        await latest(chat.conversation_id),
        reply("Understood. I've passed this to the team.", {
          stop_contact: true,
        }),
      ),
    ).toEqual({ status: "sent", handoff: true });
    const c = await conversationRow(chat.conversation_id);
    expect(c).toMatchObject({ agent_paused: true, status: "waiting_for_you" });
    expect(
      await db.admin(`select do_not_contact from leads where id = $1`, [
        c.lead_id,
      ]),
    ).toEqual([{ do_not_contact: true }]);
    expect(
      (
        await db.admin<{ kind: string }>(
          `select kind from activity_events where lead_id = $1 order by kind`,
          [c.lead_id],
        )
      ).map((e) => e.kind),
    ).toEqual(["chat_started", "do_not_contact", "handoff_requested"]);
    expect((await poll(tokenA, chat))!.state).toBe("team");
    await post(tokenA, chat, "Hello?");
    expect(
      await commit(
        tokenA,
        chat.conversation_id,
        await latest(chat.conversation_id),
        reply("Still here"),
      ),
    ).toEqual({ status: "paused" });
  });

  it("counts every reply and draft of the last day towards the workspace's cap", async () => {
    const chat = (await start(tokenA, "Count me"))!;
    const ctx = (await context(tokenA, chat.conversation_id))!;
    const [{ n }] = await db.admin<{ n: number }>(
      `select (select count(*) from messages where workspace_id = $1 and author = 'agent' and not (metadata ? 'draft_id'))::int
            + (select count(*) from message_drafts where workspace_id = $1)::int as n`,
      [A],
    );
    expect(n).toBeGreaterThan(3);
    expect(ctx.replies_today).toBe(n);
  });
});
