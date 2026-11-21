import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import {
  ACTIVATION_SECRET_TABLES,
  ACTIVATION_TABLES,
} from "./activation-tables";

// Account briefs and calendar feeds, workflows, scoped API keys (the MCP
// server's), company news and ad audiences, proved against the real
// migrations: one workspace can't see or change another's rows; secrets
// (calendar addresses, webhook token hashes) are out of reach; the caps
// hold; and each trigger and action does what it says, in its own
// workspace only.

const DENIED = /row-level security|permission denied/;
const SLACK_URL = "https://hooks.slack.com/services/T000/B000/fakefakefakefake";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let db: TestDb;
let alice: string; // owner of A
let amy: string; // member of A
let bob: string; // owner of B
let A: string;
let B: string;

const service = async <T>(sql: string, params: unknown[] = []) =>
  (
    await db.as<{ r: T }>(
      { role: "service_role" },
      `select ${sql} as r`,
      params,
    )
  )[0].r;

const one = async (sql: string, params: unknown[] = []) =>
  (await db.admin<{ id: string }>(sql, params))[0].id;

const addLead = (ws: string, email: string | null, extra: string = "") =>
  one(
    `insert into leads (workspace_id, name, email, company, website, source, custom_fields)
     values ($1, 'Pat Lead', $2, 'Acme', $3, 'form', '{"country": "United Kingdom", "company_size": "11-50"}')
     returning id`,
    [ws, email, extra || null],
  );

const addConversation = async (ws: string, lead: string, body = "Hello") => {
  const conv = await one(
    `insert into conversations (workspace_id, lead_id, channel, last_message_at) values ($1, $2, 'email', now()) returning id`,
    [ws, lead],
  );
  await db.admin(
    `insert into messages (workspace_id, conversation_id, direction, author, body, delivery_status)
     values ($1, $2, 'in', 'lead', $3, 'received')`,
    [ws, conv, body],
  );
  return conv;
};

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.createUser("alice@a.example", "Alice");
  amy = await db.createUser("amy@a.example", "Amy");
  bob = await db.createUser("bob@b.example", "Bob");
  [{ id: A }] = await db.user(alice)<{ id: string }>(
    `select create_workspace('Agency A', 'UTC', 'agency-a.example', 'We sell A') as id`,
  );
  [{ id: B }] = await db.user(bob)<{ id: string }>(
    `select create_workspace('Agency B', 'UTC', null, 'We sell B') as id`,
  );
  await db.admin(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [A, amy],
  );
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
describe("account briefs", () => {
  it("are asked for by a member of the workspace only, once at a time, within the day's cap", async () => {
    const lead = await addLead(A, "brief@lead.example", "https://acme.example");
    const ask = (ws: string, user: string, l = lead, max = 3) =>
      service<{ status: string; id?: string }>(
        "brief_request($1, $2, $3, 'brief', 'manual', $4)",
        [ws, user, l, max],
      );
    expect(await ask(A, bob)).toEqual({ status: "not_found" });
    expect(await ask(B, bob)).toEqual({ status: "not_found" });
    const first = await ask(A, amy);
    expect(first.status).toBe("queued");
    expect(await ask(A, alice)).toEqual({ status: "waiting", id: first.id });
    await expect(
      db.user(alice)(`select brief_request($1, $2, $3, 'brief', 'manual', 3)`, [
        A,
        alice,
        lead,
      ]),
    ).rejects.toThrow(/permission denied/);
    // The cap: two more leads fill it, the next is refused.
    for (const e of ["c1@lead.example", "c2@lead.example"])
      expect((await ask(A, amy, await addLead(A, e), 3)).status).toBe("queued");
    expect(await ask(A, amy, await addLead(A, "c3@lead.example"), 3)).toEqual({
      status: "capped",
    });
    expect(
      await db.user(bob)(
        `select id from account_briefs where workspace_id = $1`,
        [A],
      ),
    ).toEqual([]);
    expect(
      (
        await db.user(amy)(
          `select id from account_briefs where workspace_id = $1`,
          [A],
        )
      ).length,
    ).toBe(3);
  });

  it("are written from the brief's own workspace only, and finish onto the timeline, Slack and the host's email", async () => {
    await db.admin(`delete from account_briefs`);
    await db.admin(`delete from outbound_usage`);
    const lead = await addLead(A, "ctx@lead.example", "https://ctx.example");
    await addConversation(A, lead, "We need pricing for 20 seats");
    const leadB = await addLead(B, "ctx@lead.example", "https://ctx.example");
    await addConversation(B, leadB, "SECRET of B");
    await service("slack_connect($1, $2, $3, '#sales')", [A, alice, SLACK_URL]);
    const meeting = await one(
      `insert into meetings (workspace_id, lead_id, title, starts_at, ends_at, host_id)
       values ($1, $2, 'Intro', now() + interval '1 hour', now() + interval '90 minutes', $3) returning id`,
      [A, lead, amy],
    );
    // The scheduler queues it: it starts within two hours.
    await db.admin(`select private.brief_due_work()`);
    const claimed = await service<{ id: string; workspace_id: string }[]>(
      "brief_claim(5, 60, 3000000, 2)",
    );
    expect(claimed.map((c) => c.workspace_id)).toEqual([A]);
    const ctx = await service<Record<string, unknown>>(
      "brief_context($1, $2)",
      [A, claimed[0].id],
    );
    expect(JSON.stringify(ctx)).toContain("20 seats");
    expect(JSON.stringify(ctx)).not.toContain("SECRET of B");
    expect((ctx.meeting as { id: string }).id).toBe(meeting);
    // Asking with B's id for A's brief finds nothing.
    expect(
      await service("brief_context($1, $2)", [B, claimed[0].id]),
    ).toBeNull();
    const done = await service<{ status: string; email: unknown }>(
      "brief_finish($1, $2, true, $3, 'They want 20 seats.', '[]'::jsonb, null, 1200, 2)",
      [A, claimed[0].id, JSON.stringify({ sections: [] })],
    );
    expect(done).toEqual({
      status: "ready",
      email: { to: "amy@a.example", name: "Amy" },
    });
    const timeline = await db.admin<{ kind: string }>(
      `select kind from activity_events where lead_id = $1 and kind = 'account_brief'`,
      [lead],
    );
    expect(timeline.length).toBe(1);
    const slack = await db.admin<{ event: string }>(
      `select event from integration_deliveries where workspace_id = $1 and event = 'account_brief'`,
      [A],
    );
    expect(slack.length).toBe(1);
    const [{ cost_micros }] = await db.admin<{ cost_micros: string }>(
      `select cost_micros from outbound_usage where workspace_id = $1`,
      [A],
    );
    expect(Number(cost_micros)).toBe(1200);
    // Only one brief per meeting, however often the scheduler looks.
    await db.admin(`select private.brief_due_work()`);
    expect(
      (
        await db.admin(`select id from account_briefs where meeting_id = $1`, [
          meeting,
        ])
      ).length,
    ).toBe(1);
  });

  it("are skipped, with the reason, once the day's spend is used", async () => {
    await db.admin(`delete from account_briefs`);
    const lead = await addLead(A, "spend@lead.example");
    await db.admin(
      `insert into outbound_usage (workspace_id, day, cost_micros) values ($1, (now() at time zone 'utc')::date, 5000)
       on conflict (workspace_id, day) do update set cost_micros = 5000`,
      [A],
    );
    await service("brief_request($1, $2, $3, 'brief', 'manual', 40)", [
      A,
      alice,
      lead,
    ]);
    expect(await service("brief_claim(5, 60, 1000, 2)")).toEqual([]);
    const [row] = await db.admin<{ status: string; error: string }>(
      `select status, error from account_briefs where lead_id = $1`,
      [lead],
    );
    expect(row.status).toBe("skipped");
    expect(row.error).toMatch(/spending limit/);
  });

  it("queue a closed-lost note when a lead with a conversation is marked lost, if the workspace wants them", async () => {
    await db.admin(`delete from outbound_usage`);
    const talked = await addLead(A, "lost@lead.example");
    await addConversation(A, talked, "Too expensive for us right now");
    const silent = await addLead(A, "silent@lead.example");
    await db.admin(`update leads set status = 'lost' where id = any($1)`, [
      [talked, silent],
    ]);
    const rows = await db.admin<{
      lead_id: string;
      kind: string;
      reason: string;
    }>(
      `select lead_id, kind, reason from account_briefs where kind = 'closed_lost'`,
    );
    expect(rows).toEqual([
      { lead_id: talked, kind: "closed_lost", reason: "lost" },
    ]);
    // Switched off: nothing.
    expect(
      (
        await db.user(amy)<{ ok: boolean }>(
          `select brief_settings_save($1, 'before', 120, 7, true, true, false) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(false);
    expect(
      (
        await db.user(bob)<{ ok: boolean }>(
          `select brief_settings_save($1, 'before', 120, 7, true, true, false) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(false);
    expect(
      (
        await db.user(alice)<{ ok: boolean }>(
          `select brief_settings_save($1, 'before', 120, 7, true, true, false) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(true);
    const other = await addLead(A, "lost2@lead.example");
    await addConversation(A, other);
    await db.admin(`update leads set status = 'lost' where id = $1`, [other]);
    expect(
      await db.admin(`select id from account_briefs where lead_id = $1`, [
        other,
      ]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("calendar feeds", () => {
  const URL = "https://calendar.example/ical/secret-abc/basic.ics";

  it("keep the address in Vault only, for a member of the workspace", async () => {
    expect(
      await service("calendar_feed_save($1, $2, $3, 'calendar.example')", [
        A,
        bob,
        URL,
      ]),
    ).toEqual({ status: "not_found" });
    expect(
      await service<{ status: string }>(
        "calendar_feed_save($1, $2, 'http://insecure.example/x.ics', 'insecure.example')",
        [A, amy],
      ),
    ).toEqual({ status: "invalid" });
    const saved = await service<{ status: string; id: string }>(
      "calendar_feed_save($1, $2, $3, 'calendar.example')",
      [A, amy, URL],
    );
    expect(saved.status).toBe("saved");
    expect(
      JSON.stringify(await db.admin(`select * from calendar_feeds`)),
    ).not.toContain("secret-abc");
    expect(
      await db.admin(`select secret from vault.secrets where name = $1`, [
        `calendar_feed:${saved.id}`,
      ]),
    ).toEqual([{ secret: URL }]);
    await expect(db.user(amy)(`select calendar_claim(5, 60)`)).rejects.toThrow(
      /permission denied/,
    );
    expect(
      await db.user(bob)(
        `select id from calendar_feeds where workspace_id = $1`,
        [A],
      ),
    ).toEqual([]);
  });

  it("turn events with a lead among the attendees into that lead's meetings, without posting them as booked", async () => {
    await db.admin(`delete from integration_deliveries`);
    await service("slack_connect($1, $2, $3, '#sales')", [A, alice, SLACK_URL]);
    const lead = await addLead(A, "guest@client.example");
    await addLead(B, "guest-b@client.example");
    const [feed] = await service<
      { id: string; url: string; own_emails: string[] }[]
    >("calendar_claim(5, 60)");
    expect(feed.url).toBe(URL);
    expect(feed.own_emails).toContain("amy@a.example");
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 90_000_000).toISOString();
    const events = [
      {
        uid: "evt-1",
        title: "Demo with Client",
        starts_at: start,
        ends_at: end,
        attendees: [{ email: "GUEST@client.example", name: "Guest" }],
      },
      {
        uid: "evt-2",
        title: "B's lead",
        starts_at: start,
        ends_at: end,
        attendees: [{ email: "guest-b@client.example" }],
      },
      {
        uid: "evt-3",
        title: "Lunch",
        starts_at: start,
        ends_at: end,
        attendees: [],
      },
    ];
    const r = await service<Record<string, number>>(
      "calendar_ingest($1, $2, $3, 100, 30)",
      [feed.id, A, JSON.stringify(events)],
    );
    expect(r).toMatchObject({ seen: 3, matched: 1, added: 1 });
    const meetings = await db.admin<{
      lead_id: string;
      host_id: string;
      source: string;
    }>(
      `select lead_id, host_id, source from meetings where external_uid is not null`,
    );
    expect(meetings).toEqual([
      { lead_id: lead, host_id: amy, source: "calendar" },
    ]);
    expect(
      await db.admin(
        `select id from integration_deliveries where event = 'meeting_booked'`,
      ),
    ).toEqual([]);
    // Read again: the same event updates, never duplicates; cancelled is kept.
    await db.admin(`update calendar_feeds set next_sync_at = now()`);
    const [again] = await service<{ id: string }[]>("calendar_claim(5, 60)");
    await service("calendar_ingest($1, $2, $3, 100, 30)", [
      again.id,
      A,
      JSON.stringify([{ ...events[0], cancelled: true }]),
    ]);
    expect(
      await db.admin(
        `select status from meetings where external_uid = 'evt-1'`,
      ),
    ).toEqual([{ status: "cancelled" }]);
  });

  it("are removed by their own person, with the address", async () => {
    expect(
      (
        await db.user(alice)<{ ok: boolean }>(
          `select calendar_feed_remove($1) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(false);
    expect(
      (
        await db.user(amy)<{ ok: boolean }>(
          `select calendar_feed_remove($1) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(true);
    expect(
      await db.admin(
        `select id from vault.secrets where name like 'calendar_feed:%'`,
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("workflows", () => {
  let wf: string;
  const save = (
    who: string,
    ws: string,
    trigger: string,
    steps: unknown[],
    enabled = true,
    config: Record<string, unknown> = {},
  ) =>
    db.user(who)<{ r: { status: string; id?: string } }>(
      `select workflow_save($1, null, 'Test', $2, $3, '[]'::jsonb, $4, $5, 20) as r`,
      [ws, trigger, JSON.stringify(config), JSON.stringify(steps), enabled],
    );

  it("are saved by an owner or admin of the workspace only", async () => {
    expect(
      (await save(amy, A, "lead_created", [{ action: "note", text: "x" }]))[0]
        .r,
    ).toEqual({ status: "not_found" });
    expect(
      (await save(bob, A, "lead_created", [{ action: "note", text: "x" }]))[0]
        .r,
    ).toEqual({ status: "not_found" });
    expect((await save(alice, A, "lead_created", []))[0].r).toEqual({
      status: "invalid",
    });
    const r = (
      await save(alice, A, "lead_created", [{ action: "note", text: "Hi" }])
    )[0].r;
    expect(r.status).toBe("saved");
    wf = r.id!;
    expect(
      await db.user(bob)(`select id from workflows where workspace_id = $1`, [
        A,
      ]),
    ).toEqual([]);
    await expect(
      db.user(amy)(`select hook_hash from workflows`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.user(alice)(`update workflows set enabled = false`),
    ).rejects.toThrow(DENIED);
  });

  it("queue a run when their trigger happens, in their own workspace, and only when enabled", async () => {
    const lead = await addLead(A, "wf1@lead.example");
    await addLead(B, "wf1b@lead.example");
    const runs = await db.admin<{
      workflow_id: string;
      lead_id: string;
      trigger: string;
    }>(`select workflow_id, lead_id, trigger from workflow_runs`);
    expect(runs).toEqual([
      { workflow_id: wf, lead_id: lead, trigger: "lead_created" },
    ]);
    expect(
      (
        await db.user(alice)<{ ok: boolean }>(
          `select workflow_set_enabled($1, $2, false) as ok`,
          [A, wf],
        )
      )[0].ok,
    ).toBe(true);
    await addLead(A, "wf2@lead.example");
    expect((await db.admin(`select id from workflow_runs`)).length).toBe(1);
    await db.user(alice)(`select workflow_set_enabled($1, $2, true)`, [A, wf]);
    expect(
      await db.user(bob)(
        `select id from workflow_runs where workspace_id = $1`,
        [A],
      ),
    ).toEqual([]);
  });

  it("are claimed with the lead's facts, and their actions don't start other workflows", async () => {
    await db.admin(`delete from workflow_runs`);
    const stage = (
      await save(alice, A, "lead_stage_changed", [
        { action: "set_stage", stage: "qualified" },
      ])
    )[0].r.id!;
    const lead = await addLead(A, "wf3@lead.example");
    const [claimed] = await service<
      { id: string; lead: Record<string, unknown>; workflow: { id: string } }[]
    >("workflow_claim(10, 60)");
    expect(claimed.workflow.id).toBe(wf);
    expect(claimed.lead).toMatchObject({
      id: lead,
      country: "United Kingdom",
      size_lo: 11,
      size_hi: 50,
      source: "form",
    });
    // A stage change by a workflow's action starts nothing.
    const acted = await service<{ outcome: string }>(
      "workflow_act($1, $2, 0, $3, '', 100, 40)",
      [
        A,
        claimed.id,
        JSON.stringify({ action: "set_stage", stage: "engaged" }),
      ],
    );
    expect(acted.outcome).toBe("done");
    expect(
      await db.admin(`select id from workflow_runs where workflow_id = $1`, [
        stage,
      ]),
    ).toEqual([]);
    // The same change by a person does.
    await db.admin(`update leads set status = 'qualified' where id = $1`, [
      lead,
    ]);
    expect(
      (
        await db.admin(`select id from workflow_runs where workflow_id = $1`, [
          stage,
        ])
      ).length,
    ).toBe(1);
    await db.user(alice)(`select workflow_delete($1, $2)`, [A, stage]);
  });

  it("act on their own workspace only: notes, tasks, owners, plays, Slack and webhooks", async () => {
    await db.admin(`delete from workflow_runs`);
    const lead = await addLead(A, "wf4@lead.example");
    const [run] = await service<{ id: string }[]>("workflow_claim(10, 60)");
    const act = (step: Record<string, unknown>, text = "") =>
      service<{ outcome: string; why: string }>(
        "workflow_act($1, $2, 1, $3, $4, 100, 40)",
        [A, run.id, JSON.stringify(step), text],
      );
    expect((await act({ action: "note" }, "Called them")).outcome).toBe("done");
    expect(
      (await act({ action: "task", assignee: amy, due_days: "2" }, "Call back"))
        .outcome,
    ).toBe("done");
    // Bob isn't in A: refused.
    expect((await act({ action: "assign", user_id: bob })).outcome).toBe(
      "failed",
    );
    expect((await act({ action: "assign", user_id: amy })).outcome).toBe(
      "done",
    );
    expect(
      await db.admin(`select owner_id from leads where id = $1`, [lead]),
    ).toEqual([{ owner_id: amy }]);
    // A play of B can't be used from A.
    const playB = await one(
      `insert into outbound_campaigns (workspace_id, kind, name) values ($1, 'reactivation', 'B play') returning id`,
      [B],
    );
    expect(
      (await act({ action: "add_to_play", campaign_id: playB })).outcome,
    ).toBe("failed");
    const playA = await one(
      `insert into outbound_campaigns (workspace_id, kind, name) values ($1, 'reactivation', 'A play') returning id`,
      [A],
    );
    expect(
      (await act({ action: "add_to_play", campaign_id: playA })).outcome,
    ).toBe("done");
    expect(
      (await act({ action: "add_to_play", campaign_id: playA })).outcome,
    ).toBe("skipped");
    // Slack is connected for A (above).
    expect((await act({ action: "slack" }, "New lead!")).outcome).toBe("done");
    // B's endpoint can't be used from A.
    const endpointB = await service<{ id: string }>(
      `webhook_endpoint_create($1, null, 'https://hooks.b.example/in', array['lead.created'], '', $2, 5)`,
      [B, "whsec_" + "b".repeat(40)],
    );
    expect(
      (await act({ action: "webhook", endpoint_id: endpointB.id })).outcome,
    ).toBe("skipped");
    expect((await act({ action: "fly" })).outcome).toBe("failed");
    expect(
      await service("workflow_finish($1, $2, 'done', '[]'::jsonb)", [
        B,
        run.id,
      ]),
    ).toBe(false);
    expect(
      await service("workflow_finish($1, $2, 'done', '[]'::jsonb)", [
        A,
        run.id,
      ]),
    ).toBe(true);
    const tasks = await db.admin<{ assignee_id: string; title: string }>(
      `select assignee_id, title from workflow_tasks`,
    );
    expect(tasks).toEqual([{ assignee_id: amy, title: "Call back" }]);
    const [{ id: task }] = await db.admin<{ id: string }>(
      `select id from workflow_tasks`,
    );
    expect(
      (
        await db.user(bob)<{ ok: boolean }>(
          `select workflow_task_set($1, true) as ok`,
          [task],
        )
      )[0].ok,
    ).toBe(false);
    expect(
      (
        await db.user(amy)<{ ok: boolean }>(
          `select workflow_task_set($1, true) as ok`,
          [task],
        )
      )[0].ok,
    ).toBe(true);
  });

  it("stop queueing at the day's cap", async () => {
    await db.admin(
      `insert into outbound_usage (workspace_id, day, workflow_runs) values ($1, (now() at time zone 'utc')::date, 500)
       on conflict (workspace_id, day) do update set workflow_runs = 500`,
      [A],
    );
    const before = (await db.admin(`select id from workflow_runs`)).length;
    await addLead(A, "capped@lead.example");
    expect((await db.admin(`select id from workflow_runs`)).length).toBe(
      before,
    );
    await db.admin(`update outbound_usage set workflow_runs = 0`);
  });

  it("take an inbound webhook by its token's hash only", async () => {
    const r = (
      await save(alice, A, "webhook", [{ action: "note", text: "x" }])
    )[0].r;
    const token = "dvw_test_token_value_1234567890";
    expect(
      (
        await db.user(bob)<{ ok: boolean }>(
          `select workflow_hook_set($1, $2, $3, 'dvw_test') as ok`,
          [A, r.id, sha(token)],
        )
      )[0].ok,
    ).toBe(false);
    expect(
      (
        await db.user(alice)<{ ok: boolean }>(
          `select workflow_hook_set($1, $2, $3, 'dvw_test') as ok`,
          [A, r.id, sha(token)],
        )
      )[0].ok,
    ).toBe(true);
    expect(
      await service("workflow_hook_receive($1, '{}'::jsonb, 'k1')", [
        sha("wrong"),
      ]),
    ).toEqual({ status: "not_found" });
    const lead = await addLead(A, "hook@lead.example");
    expect(
      await service("workflow_hook_receive($1, $2, 'k1')", [
        sha(token),
        JSON.stringify({ email: "HOOK@lead.example" }),
      ]),
    ).toEqual({ status: "queued" });
    expect(
      await service("workflow_hook_receive($1, '{}'::jsonb, 'k1')", [
        sha(token),
      ]),
    ).toEqual({ status: "duplicate" });
    expect(
      await db.admin(
        `select lead_id from workflow_runs where workflow_id = $1`,
        [r.id],
      ),
    ).toEqual([{ lead_id: lead }]);
  });
});

// ---------------------------------------------------------------------------
describe("scoped API keys", () => {
  const hash = (k: string) => sha(k);

  it("are made personal by any member and for the workspace by an admin only", async () => {
    await expect(
      db.user(amy)(
        `select api_key_create_scoped($1, 'Mine', 'dv_live_amy1', $2, 'read', false)`,
        [A, hash("k-amy-ws")],
      ),
    ).rejects.toThrow(/only an owner or admin/);
    await expect(
      db.user(bob)(
        `select api_key_create_scoped($1, 'Mine', 'dv_live_bob1', $2, 'read', true)`,
        [A, hash("k-bob")],
      ),
    ).rejects.toThrow(/not a member/);
    await db.user(amy)(
      `select api_key_create_scoped($1, 'Mine', 'dv_live_amy1', $2, 'read', true)`,
      [A, hash("k-amy")],
    );
    await db.user(alice)(
      `select api_key_create_scoped($1, 'Team', 'dv_live_ali1', $2, 'write', false)`,
      [A, hash("k-alice")],
    );
    expect(
      await service<Record<string, unknown>>("api_key_authorise($1, 10)", [
        hash("k-amy"),
      ]),
    ).toMatchObject({
      status: "ok",
      workspace_id: A,
      scope: "read",
      user_id: amy,
      role: "member",
    });
    expect(
      await service<Record<string, unknown>>("api_key_authorise($1, 10)", [
        hash("k-alice"),
      ]),
    ).toMatchObject({ status: "ok", scope: "write", user_id: null });
    expect(await service("api_key_scope($1)", [hash("k-amy")])).toBe("read");
    expect(
      await db.user(bob)(
        `select id from workspace_api_keys where workspace_id = $1`,
        [A],
      ),
    ).toEqual([]);
  });

  it("stop working when their person leaves, and are revoked by their own person", async () => {
    const [{ id }] = await db.admin<{ id: string }>(
      `select id from workspace_api_keys where key_hash = $1`,
      [hash("k-amy")],
    );
    expect(
      (
        await db.user(alice)<{ ok: boolean }>(
          `select api_key_revoke_own($1) as ok`,
          [id],
        )
      )[0].ok,
    ).toBe(false);
    await db.user(amy)(
      `select api_key_create_scoped($1, 'Second', 'dv_live_amy2', $2, 'write', true)`,
      [A, hash("k-amy-2")],
    );
    expect(
      (
        await db.user(amy)<{ ok: boolean }>(
          `select api_key_revoke_own($1) as ok`,
          [id],
        )
      )[0].ok,
    ).toBe(true);
    expect(await service("api_key_authorise($1, 10)", [hash("k-amy")])).toEqual(
      {
        status: "unauthorised",
      },
    );
    await db.admin(
      `delete from workspace_members where workspace_id = $1 and user_id = $2`,
      [A, amy],
    );
    expect(
      await service("api_key_authorise($1, 10)", [hash("k-amy-2")]),
    ).toEqual({
      status: "unauthorised",
    });
    await db.admin(
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
      [A, amy],
    );
  });
});

// ---------------------------------------------------------------------------
describe("company news", () => {
  it("is switched on by an admin, tracks the workspace's own companies and dedupes what it finds", async () => {
    expect(
      (
        await db.user(amy)<{ ok: boolean }>(
          `select news_settings_save($1, true, true, true, array['new'], array['funding']) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(false);
    expect(
      (
        await db.user(alice)<{ ok: boolean }>(
          `select news_settings_save($1, true, true, true, array['new','engaged','qualified'], array['funding','launch']) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(true);
    await addLead(A, "ceo@newsy.example", "https://www.newsy.example/");
    await addLead(B, "ceo@other.example", "https://other.example/");
    await db.admin(`select private.news_refresh($1, 100)`, [A]);
    await db.admin(`select private.news_refresh($1, 100)`, [B]);
    const tracked = await db.admin<{ domain: string; workspace_id: string }>(
      `select domain, workspace_id from news_companies`,
    );
    expect(tracked.map((t) => t.workspace_id).every((w) => w === A)).toBe(true);
    expect(tracked.map((t) => t.domain)).toContain("newsy.example");
    const claimed = await service<
      { id: string; domain: string; kinds: string[] }[]
    >("news_claim(20, 60, 3000000)");
    const c = claimed.find((x) => x.domain === "newsy.example")!;
    expect(c.kinds.sort()).toEqual(["funding", "launch"]);
    const item = {
      kind: "funding",
      headline: "Newsy raises $5M",
      summary: "A seed round.",
      source_url: "https://news.example/newsy-raises?utm=1",
      source_title: "News",
      published_on: "2026-11-10",
    };
    expect(
      await service("news_ingest($1, $2, $3, 500)", [
        A,
        c.id,
        JSON.stringify([
          item,
          item,
          {
            ...item,
            source_url: "https://other.example/x",
            headline: "NEWSY RAISES $5M",
          },
        ]),
      ]),
    ).toEqual({ status: "ok", added: 1, duplicates: 2 });
    expect(
      await service("news_ingest($1, $2, $3, 0)", [
        B,
        c.id,
        JSON.stringify([item]),
      ]),
    ).toEqual({ status: "not_found" });
    expect(
      await db.user(bob)(
        `select id from company_news where workspace_id = $1`,
        [A],
      ),
    ).toEqual([]);
  });

  it("is kept onto the lead (a note and a brief), or dismissed, in its own workspace only", async () => {
    const [{ id }] = await db.admin<{ id: string }>(
      `select id from company_news`,
    );
    expect(
      (
        await db.user(bob)<{ ok: boolean }>(`select news_dismiss($1) as ok`, [
          id,
        ])
      )[0].ok,
    ).toBe(false);
    expect(
      await service("news_keep($1, $2, $3, 'News', '[]'::jsonb, 25, 40)", [
        A,
        bob,
        [id],
      ]),
    ).toEqual({ status: "not_found" });
    const kept = await service<{ status: string; leads: number }>(
      "news_keep($1, $2, $3, 'News', '[]'::jsonb, 25, 40)",
      [A, amy, [id]],
    );
    expect(kept).toMatchObject({ status: "kept", leads: 1 });
    const notes = await db.admin<{ summary: string }>(
      `select summary from activity_events where kind = 'company_news'`,
    );
    expect(notes[0].summary).toContain("Newsy raises $5M");
  });
});

// ---------------------------------------------------------------------------
describe("ad audiences", () => {
  let audience: string;

  it("are saved and read by members of their own workspace only", async () => {
    await expect(
      db.user(bob)(
        `insert into ad_audiences (workspace_id, name, kind, created_by) values ($1, 'x', 'contacts', $2)`,
        [A, bob],
      ),
    ).rejects.toThrow(DENIED);
    [{ id: audience }] = await db.user(amy)<{ id: string }>(
      `insert into ad_audiences (workspace_id, name, kind, filters, created_by)
       values ($1, 'Everyone', 'contacts', '{}'::jsonb, $2) returning id`,
      [A, amy],
    );
    expect(
      await db.user(bob)(
        `select id from ad_audiences where workspace_id = $1`,
        [A],
      ),
    ).toEqual([]);
    expect(
      (await db.user(bob)(`delete from ad_audiences where id = $1`, [audience]))
        .affected,
    ).toBe(0);
  });

  it("leave out do not contact, unsubscribed, the never-contact list and customers, and record the export", async () => {
    await db.admin(`delete from leads where workspace_id = $1`, [A]);
    const ok = await addLead(A, "keep@aud.example");
    const dnc = await addLead(A, "dnc@aud.example");
    const unsub = await addLead(A, "unsub@aud.example");
    const won = await addLead(A, "won@aud.example");
    await addLead(A, "blocked@aud.example");
    await db.admin(`update leads set do_not_contact = true where id = $1`, [
      dnc,
    ]);
    await db.admin(`update leads set status = 'unsubscribed' where id = $1`, [
      unsub,
    ]);
    await db.admin(`update leads set status = 'won' where id = $1`, [won]);
    await db.admin(
      `insert into outbound_suppressions (workspace_id, kind, value) values ($1, 'email', 'blocked@aud.example')`,
      [A],
    );
    const r = await db.user(amy)<{
      r: { status: string; rows: { email: string }[] };
    }>(`select ad_audience_rows($1, 'meta', true, 100) as r`, [audience]);
    expect(r[0].r.rows.map((x) => x.email)).toEqual(["keep@aud.example"]);
    expect(ok).toBeTruthy();
    expect(
      (
        await db.user(bob)<{ r: unknown }>(
          `select ad_audience_rows($1, 'meta', true, 100) as r`,
          [audience],
        )
      )[0].r,
    ).toEqual({ status: "not_found" });
    const exports = await db.admin<{
      format: string;
      rows: number;
      exported_by: string;
    }>(`select format, rows, exported_by from ad_audience_exports`);
    expect(exports).toEqual([{ format: "meta", rows: 1, exported_by: amy }]);
    // A suppression list of do-not-contact holds exactly those.
    const [{ id: sup }] = await db.user(amy)<{ id: string }>(
      `insert into ad_audiences (workspace_id, name, kind, filters, created_by)
       values ($1, 'DNC', 'suppression', '{"preset": "do_not_contact"}'::jsonb, $2) returning id`,
      [A, amy],
    );
    const s = await db.user(amy)<{ r: { rows: { email: string }[] } }>(
      `select ad_audience_rows($1, 'google', true, 100) as r`,
      [sup],
    );
    expect(s[0].r.rows.map((x) => x.email).sort()).toEqual([
      "dnc@aud.example",
      "unsub@aud.example",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("every new table", () => {
  it("is out of reach of the anon role, and secrets of members", async () => {
    for (const table of [...ACTIVATION_TABLES, ...ACTIVATION_SECRET_TABLES])
      await expect(
        db.as({ role: "anon" }, `select * from ${table}`),
        table,
      ).rejects.toThrow(/permission denied/);
    for (const table of ACTIVATION_SECRET_TABLES)
      await expect(
        db.user(alice)(`select * from ${table}`),
        table,
      ).rejects.toThrow(/permission denied/);
  });

  it("can't be written to directly by a member, except their own audiences", async () => {
    for (const table of ACTIVATION_TABLES.filter((t) => t !== "ad_audiences"))
      await expect(
        db.user(alice)(`delete from ${table}`),
        table,
      ).rejects.toThrow(DENIED);
  });
});
