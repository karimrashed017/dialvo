import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import {
  INTEGRATION_SECRET_TABLES,
  INTEGRATION_TABLES,
} from "./integrations-tables";

// Slack, webhooks, the public API's calls, website visitors (and the
// retargeting play) and review-site intent, proved against the real
// migrations: one workspace can't see or change another's rows; secrets sit
// in Vault and only the secret key reads them; each trigger queues an event
// once and only for a workspace that asked for it; the outbox's lease,
// retries and outcomes; tracking is off until switched on; and the plays
// write campaigns in the right workspace only.

const DENIED = /row-level security|permission denied/;
const SLACK_URL = "https://hooks.slack.com/services/T000/B000/fakefakefakefake";
const SECRET = "whsec_" + "a".repeat(40);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let db: TestDb;
let alice: string; // owner of A
let amy: string; // member of A
let bob: string; // owner of B
let A: string;
let B: string;
let tokenA: string; // A's chat widget token
let tokenB: string;

const service = async <T>(sql: string, params: unknown[] = []) =>
  (
    await db.as<{ r: T }>(
      { role: "service_role" },
      `select ${sql} as r`,
      params,
    )
  )[0].r;

const addLead = async (ws: string, email: string | null, extra = "") =>
  (
    await db.admin<{ id: string }>(
      `insert into leads (workspace_id, name, email${extra ? ", website" : ""}) values ($1, 'Lead', $2${extra ? ", $3" : ""}) returning id`,
      extra ? [ws, email, extra] : [ws, email],
    )
  )[0].id;

const addProspect = async (
  ws: string,
  domain: string,
  email: string,
  extra: { play?: string; campaign?: string; search?: string } = {},
) => {
  const search =
    extra.search ??
    (
      await db.admin<{ id: string }>(
        `insert into prospect_searches (workspace_id, name, description) values ($1, 's', 'd') returning id`,
        [ws],
      )
    )[0].id;
  const [{ id: run }] = await db.admin<{ id: string }>(
    `insert into prospect_runs (workspace_id, search_id, status, brief, target_count)
     values ($1, $2, 'done', '{}'::jsonb, 25) returning id`,
    [ws, search],
  );
  const [{ id }] = await db.admin<{ id: string }>(
    `insert into prospects (workspace_id, run_id, search_id, company_name, domain, website,
       research_status, contact_name, email, email_source_url, email_kind, decision, play, campaign_id)
     values ($1, $2, $3, 'Co', $4, 'https://' || $4 || '/', 'found', 'Pat', $5,
       'https://' || $4 || '/', 'business', 'kept', $6, $7) returning id`,
    [
      ws,
      run,
      search,
      domain,
      email,
      extra.play ?? null,
      extra.campaign ?? null,
    ],
  );
  return id;
};

const deliveries = (ws: string) =>
  db.admin<{
    target: string;
    event: string;
    status: string;
    source_key: string;
    payload: Record<string, unknown>;
  }>(
    `select target, event, status, source_key, payload from integration_deliveries
     where workspace_id = $1 order by created_at, event, target`,
    [ws],
  );

type Claimed = {
  id: string;
  workspace_id: string;
  target: string;
  event: string;
  url: string;
  secret: string | null;
  attempt: number;
};
const claim = (ws: string | null = null) =>
  service<Claimed[]>("integration_claim(50, 60, $1)", [ws]);
const finish = (id: string, outcome: string, status = 200, error = "") =>
  service<string | null>("integration_finish($1, $2, $3, $4, 60, 3, 2)", [
    id,
    outcome,
    status,
    error,
  ]);

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

// ---------------------------------------------------------------------------
describe("Slack", () => {
  it("queues nothing before it is connected", async () => {
    await db.as({ role: "service_role" }, `select chat_start($1, 'hello')`, [
      tokenA,
    ]);
    expect((await deliveries(A)).filter((d) => d.target === "slack")).toEqual(
      [],
    );
  });

  it("is connected by the server for an owner or admin only, and the URL is in Vault only", async () => {
    const connect = (ws: string, user: string, url = SLACK_URL) =>
      service<{ status: string }>("slack_connect($1, $2, $3, '#sales')", [
        ws,
        user,
        url,
      ]);
    expect(await connect(A, amy)).toEqual({ status: "not_found" });
    expect(await connect(A, bob)).toEqual({ status: "not_found" });
    expect(await connect(A, alice, "https://evil.example/hook")).toEqual({
      status: "invalid",
    });
    await expect(
      db.user(alice)(`select slack_connect($1, $2, $3, '')`, [
        A,
        alice,
        SLACK_URL,
      ]),
    ).rejects.toThrow(/permission denied/);
    expect(await connect(A, alice)).toEqual({ status: "connected" });
    const rows = await db.admin(`select * from slack_connections`);
    expect(JSON.stringify(rows)).not.toContain("fakefake");
    expect(
      await db.admin(`select secret from vault.secrets where name = $1`, [
        `slack_webhook:${A}`,
      ]),
    ).toEqual([{ secret: SLACK_URL }]);
    expect(await service<string>("slack_credentials($1)", [A])).toBe(SLACK_URL);
    expect(await service<string | null>("slack_credentials($1)", [B])).toBe(
      null,
    );
    for (const who of [alice, bob])
      await expect(
        db.user(who)(`select slack_credentials($1)`, [A]),
      ).rejects.toThrow(/permission denied/);
  });

  it("posts chats that need a person and hot replies, once each", async () => {
    await db.as({ role: "service_role" }, `select chat_start($1, 'hello')`, [
      tokenA,
    ]);
    const lead = await addLead(A, "hot@lead.example");
    const [{ id: conv }] = await db.admin<{ id: string }>(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'email') returning id`,
      [A, lead],
    );
    await db.admin(
      `insert into team_alerts (workspace_id, conversation_id, kind, summary) values ($1, $2, 'reply_interested', 'Wants a demo')`,
      [A, conv],
    );
    await db.admin(
      `insert into team_alerts (workspace_id, conversation_id, kind, summary) values ($1, $2, 'mailbox_paused', 'x')`,
      [A, conv],
    );
    const slack = (await deliveries(A)).filter((d) => d.target === "slack");
    expect(slack.map((d) => d.event).sort()).toEqual([
      "hot_reply",
      "needs_human",
    ]);
    const hot = slack.find((d) => d.event === "hot_reply")!;
    expect(hot.payload).toMatchObject({
      summary: "Wants a demo",
      lead: { email: "hot@lead.example" },
    });
  });

  it("follows the events the team chose, and only an admin of the workspace can choose", async () => {
    expect(
      (
        await db.user(bob)<{ ok: boolean }>(
          `select slack_settings_save($1, array['meeting_booked'], 9) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(false);
    expect(
      (
        await db.user(amy)<{ ok: boolean }>(
          `select slack_settings_save($1, array['meeting_booked'], 9) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(false);
    expect(
      (
        await db.user(alice)<{ ok: boolean }>(
          `select slack_settings_save($1, array['meeting_booked', 'approvals_digest', 'nonsense'], 9) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(true);
    const [row] = await db.admin<{ events: string[]; digest_hour: number }>(
      `select events, digest_hour from slack_connections where workspace_id = $1`,
      [A],
    );
    expect(row.events.sort()).toEqual(["approvals_digest", "meeting_booked"]);
    expect(row.digest_hour).toBe(9);
    const before = (await deliveries(A)).length;
    await db.as({ role: "service_role" }, `select chat_start($1, 'again')`, [
      tokenA,
    ]);
    expect(
      (await deliveries(A)).filter((d) => d.event === "needs_human").length,
    ).toBe(1);
    expect((await deliveries(A)).length).toBeGreaterThanOrEqual(before);
  });

  it("posts a meeting booked", async () => {
    const lead = await addLead(A, "meet@lead.example");
    await db.admin(
      `insert into meetings (workspace_id, lead_id, title, starts_at, ends_at) values ($1, $2, 'Intro', now() + interval '1 day', now() + interval '1 day 30 minutes')`,
      [A, lead],
    );
    const m = (await deliveries(A)).filter((d) => d.event === "meeting_booked");
    expect(m).toHaveLength(1);
    expect(m[0].payload).toMatchObject({
      title: "Intro",
      lead: { email: "meet@lead.example" },
    });
  });

  it("queues the approvals digest once a day, only when something waits", async () => {
    await db.admin(
      `update slack_connections set digest_hour = 0 where workspace_id = $1`,
      [A],
    );
    await db.admin(`select private.integration_due_work()`);
    // Nothing waits for approval in A yet.
    expect(
      (await deliveries(A)).filter((d) => d.event === "approvals_digest"),
    ).toEqual([]);
    await db.admin(
      `update slack_connections set last_digest_on = null where workspace_id = $1`,
      [A],
    );
    await db.admin(
      `insert into message_drafts (workspace_id, conversation_id, body)
       select workspace_id, id, 'A drafted chat answer' from conversations where workspace_id = $1 and channel = 'chat' limit 1`,
      [A],
    );
    await db.admin(`select private.integration_due_work()`);
    await db.admin(`select private.integration_due_work()`);
    const digest = (await deliveries(A)).filter(
      (d) => d.event === "approvals_digest",
    );
    expect(digest).toHaveLength(1);
    expect(digest[0].payload).toMatchObject({ chat: 1 });
  });

  it("goes to error when Slack says the URL is gone, and skips what waits", async () => {
    await db.admin(
      `update slack_connections set events = array['hot_reply','needs_human','meeting_booked','approvals_digest','play_finished'] where workspace_id = $1`,
      [A],
    );
    const work = (await claim(A)).filter((c) => c.target === "slack");
    expect(work.length).toBeGreaterThan(0);
    expect(work[0].url).toBe(SLACK_URL);
    // Claimed work isn't handed out twice while its lease holds.
    expect((await claim(A)).filter((c) => c.target === "slack")).toEqual([]);
    expect(await finish(work[0].id, "delivered")).toBe("delivered");
    expect(await finish(work[1].id, "revoked", 404, "no_service")).toBe(
      "failed",
    );
    const [conn] = await db.admin<{ status: string; status_reason: string }>(
      `select status, status_reason from slack_connections where workspace_id = $1`,
      [A],
    );
    expect(conn).toEqual({ status: "error", status_reason: "no_service" });
    await db.admin(
      `update integration_deliveries set locked_until = now() - interval '1 second' where workspace_id = $1 and status = 'running'`,
      [A],
    );
    expect((await claim(A)).filter((c) => c.target === "slack")).toEqual([]);
    expect(
      (await deliveries(A)).filter(
        (d) => d.target === "slack" && d.status === "skipped",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("is disconnected by an admin: the URL is deleted", async () => {
    expect(
      (
        await db.user(bob)<{ ok: boolean }>(
          `select slack_disconnect($1) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(false);
    expect(
      (
        await db.user(alice)<{ ok: boolean }>(
          `select slack_disconnect($1) as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(true);
    expect(
      await db.admin(`select 1 from vault.secrets where name = $1`, [
        `slack_webhook:${A}`,
      ]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("webhooks", () => {
  let endpoint: string;

  it("are registered with the secret in Vault, at most p_max, and only by an admin or the API", async () => {
    const create = (ws: string, user: string | null, url: string) =>
      service<{ status: string; id?: string }>(
        "webhook_endpoint_create($1, $2, $3, array['lead.created','reply.received','meeting.booked'], 'CRM', $4, 2)",
        [ws, user, url, SECRET],
      );
    expect(await create(A, amy, "https://hooks.a.example/dialvo")).toEqual({
      status: "not_found",
    });
    expect(await create(A, bob, "https://hooks.a.example/dialvo")).toEqual({
      status: "not_found",
    });
    expect(await create(A, alice, "http://hooks.a.example/dialvo")).toEqual({
      status: "invalid",
    });
    const made = await create(A, alice, "https://hooks.a.example/dialvo");
    expect(made.status).toBe("created");
    endpoint = made.id!;
    // Through the API (no person), for the same workspace.
    expect((await create(A, null, "https://two.a.example/x")).status).toBe(
      "created",
    );
    expect(await create(A, null, "https://three.a.example/x")).toEqual({
      status: "capped",
    });
    const rows = await db.admin(`select * from webhook_endpoints`);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    expect(
      await service<{ url: string; secret: string }>(
        "webhook_endpoint_credentials($1, $2)",
        [A, endpoint],
      ),
    ).toEqual({ url: "https://hooks.a.example/dialvo", secret: SECRET });
    expect(
      await service<unknown>("webhook_endpoint_credentials($1, $2)", [
        B,
        endpoint,
      ]),
    ).toBe(null);
    await expect(
      db.user(alice)(`select webhook_endpoint_credentials($1, $2)`, [
        A,
        endpoint,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("deliver lead.created, reply.received (not chat) and meeting.booked to each endpoint", async () => {
    const lead = await addLead(A, "hook@lead.example");
    const [{ id: conv }] = await db.admin<{ id: string }>(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'email') returning id`,
      [A, lead],
    );
    await db.admin(
      `insert into messages (workspace_id, conversation_id, direction, author, body) values ($1, $2, 'in', 'lead', 'Yes please')`,
      [A, conv],
    );
    await db.admin(
      `insert into messages (workspace_id, conversation_id, direction, author, body) values ($1, $2, 'out', 'user', 'Great')`,
      [A, conv],
    );
    await db.admin(
      `insert into meetings (workspace_id, lead_id, starts_at, ends_at) values ($1, $2, now(), now() + interval '1 hour')`,
      [A, lead],
    );
    const hooks = (await deliveries(A)).filter((d) => d.target === "webhook");
    const forLead = hooks.filter(
      (d) =>
        (d.payload as { email?: string }).email === "hook@lead.example" ||
        (d.payload as { lead_id?: string }).lead_id === lead,
    );
    // Two endpoints, three events each.
    expect(forLead.map((d) => d.event).sort()).toEqual([
      "lead.created",
      "lead.created",
      "meeting.booked",
      "meeting.booked",
      "reply.received",
      "reply.received",
    ]);
    const reply = forLead.find((d) => d.event === "reply.received")!;
    expect(reply.payload).toMatchObject({
      body: "Yes please",
      channel: "email",
      lead_email: "hook@lead.example",
    });
    // A chat message is not a reply.received.
    await db.as({ role: "service_role" }, `select chat_start($1, 'hi')`, [
      tokenA,
    ]);
    const msgs = (await deliveries(A)).filter(
      (d) => d.event === "reply.received",
    );
    expect(msgs).toHaveLength(2);
  });

  it("are retried, and an endpoint failing too often in a row is disabled", async () => {
    await db.admin(
      `update integration_deliveries set status = 'skipped' where workspace_id = $1 and target = 'webhook' and endpoint_id <> $2`,
      [A, endpoint],
    );
    const work = (await claim(A)).filter((c) => c.target === "webhook");
    // Three for the lead, and lead.created for the chat visitor.
    expect(work.length).toBe(4);
    expect(work[0]).toMatchObject({
      url: "https://hooks.a.example/dialvo",
      secret: SECRET,
      attempt: 1,
    });
    expect(await finish(work[0].id, "retry", 503, "Service Unavailable")).toBe(
      "pending",
    );
    expect(await finish(work[1].id, "failed", 400, "Bad Request")).toBe(
      "failed",
    );
    const [ep] = await db.admin<{ status: string }>(
      `select status from webhook_endpoints where id = $1`,
      [endpoint],
    );
    // Two failures in a row with p_disable_after = 2.
    expect(ep.status).toBe("disabled");
    expect(await finish(work[1].id, "delivered")).toBe(null);
  });

  it("can be paused, switched back on and deleted by an admin of the workspace only", async () => {
    const update = (user: string | null, ws: string, active: boolean) =>
      service<boolean>("webhook_endpoint_update($1, $2, $3, null, $4)", [
        ws,
        user,
        endpoint,
        active,
      ]);
    expect(await update(bob, A, true)).toBe(false);
    expect(await update(null, B, true)).toBe(false);
    expect(await update(alice, A, true)).toBe(true);
    expect(
      (
        await db.admin<{ status: string; consecutive_failures: number }>(
          `select status, consecutive_failures from webhook_endpoints where id = $1`,
          [endpoint],
        )
      )[0],
    ).toEqual({ status: "active", consecutive_failures: 0 });
    expect(
      await service<boolean>("webhook_endpoint_delete($1, $2, $3)", [
        B,
        null,
        endpoint,
      ]),
    ).toBe(false);
    expect(
      await service<boolean>("webhook_endpoint_delete($1, $2, $3)", [
        A,
        alice,
        endpoint,
      ]),
    ).toBe(true);
    expect(
      await db.admin(`select 1 from vault.secrets where name = $1`, [
        `webhook_secret:${endpoint}`,
      ]),
    ).toEqual([]);
  });

  it("a failed delivery can be retried by an admin of its workspace only", async () => {
    const [failed] = await db.admin<{ id: string }>(
      `select id from integration_deliveries where workspace_id = $1 and status = 'failed' limit 1`,
      [A],
    );
    const retry = (who: string, ws: string) =>
      db.user(who)<{ ok: boolean }>(
        `select integration_delivery_retry($1, $2) as ok`,
        [ws, failed.id],
      );
    expect((await retry(bob, B))[0].ok).toBe(false);
    expect((await retry(bob, A))[0].ok).toBe(false);
    expect((await retry(alice, A))[0].ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("the public API's calls", () => {
  let keyHash: string;

  beforeAll(async () => {
    keyHash = sha("dv_live_test_key_for_A");
    await db.user(alice)(
      `select api_key_create($1, 'Test', 'dv_live_test', $2)`,
      [A, keyHash],
    );
  });

  it("authorise a key to its own workspace, within the minute's cap", async () => {
    const auth = () =>
      service<{ status: string; workspace_id?: string }>(
        "api_key_authorise($1, 2)",
        [keyHash],
      );
    expect(await auth()).toMatchObject({ status: "ok", workspace_id: A });
    expect((await auth()).status).toBe("ok");
    expect((await auth()).status).toBe("rate_limited");
    expect(
      await service<{ status: string }>("api_key_authorise($1, 2)", [
        sha("nope"),
      ]),
    ).toEqual({ status: "unauthorised" });
    await expect(
      db.user(alice)(`select api_key_authorise($1, 2)`, [keyHash]),
    ).rejects.toThrow(/permission denied/);
  });

  it("add a lead to a running lead play of the same workspace only", async () => {
    const [{ id: play }] = await db.admin<{ id: string }>(
      `insert into outbound_campaigns (workspace_id, kind, name) values ($1, 'reactivation', 'P') returning id`,
      [A],
    );
    const [{ id: accounts }] = await db.admin<{ id: string }>(
      `insert into outbound_campaigns (workspace_id, kind, name) values ($1, 'accounts', 'Acc') returning id`,
      [A],
    );
    const leadA = await addLead(A, "api-play@lead.example");
    const leadB = await addLead(B, "b-lead@lead.example");
    const add = (ws: string, c: string, l: string) =>
      service<{ status: string }>("api_play_add_lead($1, $2, $3, null)", [
        ws,
        c,
        l,
      ]);
    expect(await add(B, play, leadB)).toEqual({ status: "not_found" });
    expect(await add(A, play, leadB)).toEqual({ status: "not_found" });
    expect(await add(A, accounts, leadA)).toEqual({
      status: "not_a_lead_play",
    });
    expect((await add(A, play, leadA)).status).toBe("added");
    expect(await add(A, play, leadA)).toEqual({ status: "already_added" });
    await db.admin(`update leads set do_not_contact = true where id = $1`, [
      leadA,
    ]);
    const other = await addLead(A, null);
    expect(await add(A, play, other)).toEqual({ status: "no_email" });
  });
});

// ---------------------------------------------------------------------------
describe("website visitors", () => {
  const visitor = sha("browser-1");
  const ip = sha(`${"x"}|203.0.113.5`);
  const track = (
    token: string,
    path = "/",
    o: { visitor?: string; conv?: string; key?: string; link?: string } = {},
  ) =>
    service<{
      status: string;
      visitor_id?: string;
      lookup?: boolean;
    }>(
      "site_track($1, $2, 'session-0001', $3, 'Title', 'google.com', $4, $5, $6, $7, 1000)",
      [
        token,
        o.visitor ?? visitor,
        path,
        ip,
        o.conv ?? null,
        o.key ?? null,
        o.link ?? null,
      ],
    );

  it("is off until an admin switches it on", async () => {
    expect(
      await service<{ on: boolean }>("site_tracker_config($1)", [tokenA]),
    ).toEqual({ on: false });
    expect(await track(tokenA)).toEqual({ status: "off" });
    expect(await db.admin(`select 1 from site_page_views`)).toEqual([]);
    const save = (who: string, ws: string) =>
      db.user(who)<{ ok: boolean }>(
        `select site_tracking_save($1, true, 'wait', array['/pricing', '/plans'], true) as ok`,
        [ws],
      );
    expect((await save(amy, A))[0].ok).toBe(false);
    expect((await save(bob, A))[0].ok).toBe(false);
    expect((await save(alice, A))[0].ok).toBe(true);
    expect(
      await service<{ on: boolean; consent: string }>(
        "site_tracker_config($1)",
        [tokenA],
      ),
    ).toEqual({ on: true, consent: "wait" });
    expect(await track(tokenB)).toEqual({ status: "off" });
  });

  it("records page views, counts the pricing page and asks for one lookup per address", async () => {
    const first = await track(tokenA, "/");
    expect(first).toMatchObject({ status: "recorded", lookup: true });
    await track(tokenA, "/pricing");
    await track(tokenA, "/plans/team");
    const [v] = await db.admin<{ page_views: number; pricing_views: number }>(
      `select page_views, pricing_views from site_visitors where workspace_id = $1`,
      [A],
    );
    expect(v).toEqual({ page_views: 3, pricing_views: 2 });
    expect(await track(tokenA, "not-a-path").then((r) => r.status)).toBe(
      "invalid",
    );

    // The lookup said: a company. Its counts include what was read so far.
    const company = await service<string>(
      "site_lookup_save($1, $2, $3, $4::jsonb)",
      [
        A,
        first.visitor_id,
        ip,
        JSON.stringify({
          domain: "acme.example",
          name: "Acme",
          source: "ipapi",
        }),
      ],
    );
    expect(company).toBeTruthy();
    const second = await track(tokenA, "/pricing");
    expect(second.lookup).toBe(false);
    const [c] = await db.admin<{ page_views: number; pricing_views: number }>(
      `select page_views, pricing_views from site_companies where id = $1`,
      [company],
    );
    expect(c).toEqual({ page_views: 4, pricing_views: 3 });
    // A new browser on the same address joins the company from the cache.
    const other = await track(tokenA, "/", { visitor: sha("browser-2") });
    expect(other.lookup).toBe(false);
    const [{ visitors }] = await db.admin<{ visitors: number }>(
      `select visitors from site_companies where id = $1`,
      [company],
    );
    expect(visitors).toBe(2);
  });

  it("never makes a company of the workspace's own domain", async () => {
    const id = await service<string | null>(
      "site_lookup_save($1, null, $2, $3::jsonb)",
      [A, sha("own-ip"), JSON.stringify({ domain: "agency-a.example" })],
    );
    expect(id).toBe(null);
  });

  it("links a visitor to a lead by chat key, by a form email (even before the lead exists), and by an email link", async () => {
    const started = await service<{
      conversation_id: string;
      visitor_key: string;
    }>("chat_start($1, 'pricing question')", [tokenA]);
    const chatter = sha("browser-chat");
    // The wrong key proves nothing.
    await track(tokenA, "/", {
      visitor: chatter,
      conv: started.conversation_id,
      key: "wrong",
    });
    expect(
      (
        await db.admin<{ lead_id: string | null }>(
          `select lead_id from site_visitors where visitor_hash = $1`,
          [chatter],
        )
      )[0].lead_id,
    ).toBe(null);
    await track(tokenA, "/", {
      visitor: chatter,
      conv: started.conversation_id,
      key: started.visitor_key,
    });
    const [linked] = await db.admin<{
      lead_id: string;
      identified_by: string;
    }>(
      `select lead_id, identified_by from site_visitors where visitor_hash = $1`,
      [chatter],
    );
    expect(linked.identified_by).toBe("chat");
    expect(linked.lead_id).toBeTruthy();

    const former = sha("browser-form");
    await track(tokenA, "/pricing", { visitor: former });
    expect(
      await service<{ status: string }>(
        "site_identify($1, $2, 'Later@Lead.example')",
        [tokenA, former],
      ),
    ).toEqual({ status: "pending" });
    const later = await addLead(A, "later@lead.example");
    expect(
      (
        await db.admin<{ lead_id: string; pending_email: string | null }>(
          `select lead_id, pending_email from site_visitors where visitor_hash = $1`,
          [former],
        )
      )[0],
    ).toEqual({ lead_id: later, pending_email: null });

    // An email link token.
    const clicker = sha("browser-click");
    const known = await addLead(A, "clicker@lead.example");
    const token = (
      await db.admin<{ t: string }>(
        `select private.site_link_token($1, 'clicker@lead.example') as t`,
        [A],
      )
    )[0].t;
    expect(token).toMatch(/^[A-Za-z0-9]{16}$/);
    // The same token in B's workspace means nothing.
    await db.admin(
      `update site_tracking set enabled = true where workspace_id = $1`,
      [B],
    );
    await track(tokenA, "/", { visitor: clicker, link: token });
    expect(
      (
        await db.admin<{ lead_id: string }>(
          `select lead_id from site_visitors where visitor_hash = $1 and workspace_id = $2`,
          [clicker, A],
        )
      )[0].lead_id,
    ).toBe(known);
  });

  it("tags links to the workspace's own site in a first email when switched on", async () => {
    const prospect = await addProspect(A, "zed.example", "zed@zed.example");
    const [{ id: draft }] = await db.admin<{ id: string }>(
      `insert into outbound_drafts (workspace_id, prospect_id, to_email) values ($1, $2, 'zed@zed.example') returning id`,
      [A, prospect],
    );
    await db.admin(
      `update outbound_drafts set status = 'draft', subject = 'Hi', body = 'See https://agency-a.example/guide. And https://other.example/x' where id = $1`,
      [draft],
    );
    const [{ body }] = await db.admin<{ body: string }>(
      `select body from outbound_drafts where id = $1`,
      [draft],
    );
    expect(body).toMatch(
      /https:\/\/agency-a\.example\/guide\?dvl=[A-Za-z0-9]{16}\. And https:\/\/other\.example\/x$/,
    );
  });

  it("can't be seen or changed by another workspace", async () => {
    for (const table of INTEGRATION_TABLES) {
      const rows = await db.user(bob)<{ workspace_id: string }>(
        `select * from ${table}`,
      );
      expect(
        rows.filter((r) => r.workspace_id === A),
        table,
      ).toEqual([]);
    }
    const [{ id: company }] = await db.admin<{ id: string }>(
      `select id from site_companies where workspace_id = $1 limit 1`,
      [A],
    );
    expect(
      (
        await db.user(bob)<{ ok: boolean }>(
          `select site_company_dismiss($1) as ok`,
          [company],
        )
      )[0].ok,
    ).toBe(false);
    await expect(
      db.user(alice)(`update site_companies set status = 'dismissed'`),
    ).rejects.toThrow(DENIED);
    for (const table of INTEGRATION_SECRET_TABLES.filter(
      (t) => t !== "intent_sources",
    ))
      await expect(
        db.user(alice)(`select * from ${table}`),
        table,
      ).rejects.toThrow(/permission denied/);
    for (const table of [...INTEGRATION_TABLES, ...INTEGRATION_SECRET_TABLES])
      await expect(
        db.as({ role: "anon" }, `select * from ${table}`),
        table,
      ).rejects.toThrow(/permission denied/);
  });

  it("the play: companies become a target-accounts campaign marked as retargeting", async () => {
    const [{ id: company }] = await db.admin<{ id: string }>(
      `select id from site_companies where workspace_id = $1 and domain = 'acme.example'`,
      [A],
    );
    const made = await service<{ status: string; campaign_id?: string }>(
      "site_retarget_companies($1, $2, array[$3::uuid], 'Visitors', '[\"CEO\"]'::jsonb, 'retargeting', 200)",
      [B, bob, company],
    );
    expect(made.status).toBe("invalid");
    const ok = await service<{ status: string; campaign_id: string }>(
      "site_retarget_companies($1, $2, array[$3::uuid], 'Visitors', '[\"CEO\"]'::jsonb, 'retargeting', 200)",
      [A, alice, company],
    );
    expect(ok.status).toBe("created");
    const [campaign] = await db.admin<{
      kind: string;
      settings: { source: string };
    }>(`select kind, settings from outbound_campaigns where id = $1`, [
      ok.campaign_id,
    ]);
    expect(campaign).toMatchObject({
      kind: "accounts",
      settings: { source: "retargeting" },
    });
    expect(
      (
        await db.admin<{ status: string }>(
          `select status from site_companies where id = $1`,
          [company],
        )
      )[0].status,
    ).toBe("retargeted");

    // A first email to a prospect of that campaign counts as this play.
    const [{ search_id }] = await db.admin<{ search_id: string }>(
      `select search_id from outbound_campaigns where id = $1`,
      [ok.campaign_id],
    );
    const prospect = await addProspect(A, "acme.example", "ceo@acme.example", {
      play: "accounts",
      campaign: ok.campaign_id,
      search: search_id,
    });
    const [{ play }] = await db.admin<{ play: string }>(
      `insert into outbound_drafts (workspace_id, prospect_id, to_email) values ($1, $2, 'ceo@acme.example') returning play`,
      [A, prospect],
    );
    expect(play).toBe("retargeting");
  });

  it("the play: known leads who read the pricing page get a retargeting lead play", async () => {
    expect(
      await service<{ status: string }>(
        "site_retarget_leads($1, $2, null, 7, 30, 50)",
        [B, bob],
      ),
    ).toEqual({ status: "empty" });
    expect(
      await service<{ status: string }>(
        "site_retarget_leads($1, $2, null, 7, 30, 50)",
        [A, bob],
      ),
    ).toEqual({ status: "not_found" });
    const made = await service<{
      status: string;
      campaign_id: string;
      selected: number;
    }>("site_retarget_leads($1, $2, null, 7, 30, 50)", [A, alice]);
    expect(made.status).toBe("created");
    // later@ read the pricing page; the chat visitor has no email; the
    // clicker only read "/".
    expect(made.selected).toBe(1);
    const [t] = await db.admin<{ why_now: { fact: string }; email: string }>(
      `select t.why_now, l.email from outbound_campaign_targets t join leads l on l.id = t.lead_id where t.campaign_id = $1`,
      [made.campaign_id],
    );
    expect(t.email).toBe("later@lead.example");
    expect(t.why_now.fact).toMatch(/including the pricing page/);
    // Not again within the repeat window.
    expect(
      await service<{ status: string }>(
        "site_retarget_leads($1, $2, null, 7, 30, 50)",
        [A, alice],
      ),
    ).toEqual({ status: "empty" });
  });

  it("forgets a visitor on an admin's request, in their own workspace only", async () => {
    const [{ id }] = await db.admin<{ id: string }>(
      `select id from site_visitors where workspace_id = $1 and visitor_hash = $2`,
      [A, visitor],
    );
    const forget = (who: string) =>
      db.user(who)<{ ok: boolean }>(`select site_visitor_forget($1) as ok`, [
        id,
      ]);
    expect((await forget(bob))[0].ok).toBe(false);
    expect((await forget(amy))[0].ok).toBe(false);
    expect((await forget(alice))[0].ok).toBe(true);
    expect(
      await db.admin(`select 1 from site_page_views where visitor_id = $1`, [
        id,
      ]),
    ).toEqual([]);
  });

  it("stops at the day's cap", async () => {
    const capped = await service<{ status: string }>(
      "site_track($1, $2, 'session-0001', '/', '', null, null, null, null, null, 0)",
      [tokenA, visitor],
    );
    expect(capped).toEqual({ status: "capped" });
  });
});

// ---------------------------------------------------------------------------
describe("review-site intent", () => {
  const rows = [
    {
      provider: "G2",
      company_name: "Beta Corp",
      company_domain: "https://www.beta.example/x",
      signal_type: "competitive/pricing",
      topic: "Sales software",
      seen_on: "2026-11-19",
      activity: "12",
    },
    {
      provider: "capterra",
      company_name: "Acme",
      company_domain: "acme.example",
      signal_type: "compare",
    },
    { provider: "g2", company_name: "No domain" },
  ];
  const ingest = (ws: string, data: unknown, perDay = 100) =>
    service<Record<string, unknown>>(
      "intent_ingest($1, 'csv', null, $2::jsonb, 10, $3)",
      [ws, JSON.stringify(data), perDay],
    );

  it("imports rows, deduplicated, skipping companies the workspace already has", async () => {
    expect(await ingest(A, rows)).toEqual({
      status: "ok",
      added: 1,
      duplicates: 0,
      // acme.example is already a prospect of A (the retargeting play).
      skipped: 1,
      invalid: 1,
    });
    expect(await ingest(A, rows)).toMatchObject({
      added: 0,
      duplicates: 2,
    });
    const [beta] = await db.admin<Record<string, unknown>>(
      `select provider, company_domain, signal_type, activity from intent_signals where workspace_id = $1 and company_domain = 'beta.example'`,
      [A],
    );
    expect(beta).toEqual({
      provider: "g2",
      company_domain: "beta.example",
      signal_type: "pricing",
      activity: 12,
    });
    expect(await ingest(A, new Array(11).fill(rows[0]))).toEqual({
      status: "too_many",
    });
    expect(await ingest(B, rows, 1)).toEqual({ status: "capped" });
  });

  it("finds a webhook's workspace by its token's hash only, and hides the hash from members", async () => {
    const hash = sha("intent-token-a");
    expect(
      await service<boolean>("intent_webhook_set($1, $2, $3, 'dvi_abcd')", [
        A,
        amy,
        hash,
      ]),
    ).toBe(false);
    expect(
      await service<boolean>("intent_webhook_set($1, $2, $3, 'dvi_abcd')", [
        A,
        alice,
        hash,
      ]),
    ).toBe(true);
    expect(
      await service<{ workspace_id: string }>("intent_webhook_source($1)", [
        hash,
      ]),
    ).toMatchObject({ workspace_id: A });
    expect(
      await service<unknown>("intent_webhook_source($1)", [sha("other")]),
    ).toBe(null);
    await expect(
      db.user(alice)(`select * from intent_sources`),
    ).rejects.toThrow(/permission denied/);
    expect(
      await db.user(alice)(
        `select kind, token_prefix from intent_sources where workspace_id = $1`,
        [A],
      ),
    ).toEqual([{ kind: "webhook", token_prefix: "dvi_abcd" }]);
    expect(await db.user(bob)(`select kind from intent_sources`)).toEqual([]);
  });

  it("keeps the G2 token in Vault and hands it to the secret key's pull only", async () => {
    expect(
      await service<{ status: string }>(
        "intent_g2_connect($1, $2, 'g2-token-for-tests')",
        [A, bob],
      ),
    ).toEqual({ status: "not_found" });
    expect(
      await service<{ status: string }>(
        "intent_g2_connect($1, $2, 'g2-token-for-tests')",
        [A, alice],
      ),
    ).toEqual({ status: "connected" });
    const claimed = await service<{ workspace_id: string; token: string }>(
      "intent_pull_claim(60)",
    );
    expect(claimed).toMatchObject({
      workspace_id: A,
      token: "g2-token-for-tests",
    });
    expect(await service<unknown>("intent_pull_claim(60)")).toBe(null);
    await expect(
      db.user(alice)(`select intent_pull_claim(60)`),
    ).rejects.toThrow(/permission denied/);
    expect(
      (
        await db.user(alice)<{ ok: boolean }>(
          `select intent_source_disconnect($1, 'g2') as ok`,
          [A],
        )
      )[0].ok,
    ).toBe(true);
    expect(
      await db.admin(`select 1 from vault.secrets where name = $1`, [
        `intent_g2:${A}`,
      ]),
    ).toEqual([]);
  });

  it("keeps signals into a campaign marked as intent, in their own workspace only", async () => {
    const [{ id: signal }] = await db.admin<{ id: string }>(
      `select id from intent_signals where workspace_id = $1 and status = 'new'`,
      [A],
    );
    expect(
      (
        await db.user(bob)<{ ok: boolean }>(
          `select intent_signal_dismiss($1) as ok`,
          [signal],
        )
      )[0].ok,
    ).toBe(false);
    expect(
      await service<{ status: string }>(
        "intent_signals_keep($1, $2, array[$3::uuid], 'Intent', '[]'::jsonb, 200)",
        [B, bob, signal],
      ),
    ).toEqual({ status: "invalid" });
    const kept = await service<{ status: string; campaign_id: string }>(
      "intent_signals_keep($1, $2, array[$3::uuid], 'Intent', '[]'::jsonb, 200)",
      [A, alice, signal],
    );
    expect(kept.status).toBe("created");
    expect(
      (
        await db.admin<{ settings: { source: string } }>(
          `select settings from outbound_campaigns where id = $1`,
          [kept.campaign_id],
        )
      )[0].settings.source,
    ).toBe("intent");
    expect(
      (
        await db.admin<{ status: string }>(
          `select status from intent_signals where id = $1`,
          [signal],
        )
      )[0].status,
    ).toBe("queued");
  });
});
