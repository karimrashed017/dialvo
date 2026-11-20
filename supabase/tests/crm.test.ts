import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { CRM_TABLES } from "./crm-tables";

// CRM sync, proved against the real migrations: one workspace can't see or
// change another's connection, queue, links or exclusion list; the token
// sits in Vault and only the secret key reads it; the triggers queue each
// event once; the queue's lease, retries and outcomes; the import stores
// hashes only and drops what the CRM no longer has; the skip rule; and
// disconnecting.

const DENIED = /row-level security|permission denied/;
const TOKEN = "fake.token.for.database.tests.only";

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

const connect = (
  ws: string,
  user: string,
  provider = "hubspot",
  token = TOKEN,
) =>
  service<{ status: string; provider?: string }>(
    "crm_connect($1, $2, $3, $4, 'HubSpot account 1', null, true, true)",
    [ws, user, provider, token],
  );

type ClaimedJob = {
  id: string;
  kind: string;
  source_key: string;
  attempts: number;
  external_id: string | null;
  lead: { id: string; email: string | null };
  link: { contact_id: string | null } | null;
  detail: Record<string, unknown> | null;
  connection: { provider: string };
};
const claim = (ws: string | null = null, limit = 50, lease = 60) =>
  service<ClaimedJob[]>("crm_jobs_claim($1, $2, 3, $3)", [limit, lease, ws]);
const finish = (
  job: string,
  ws: string,
  outcome: string,
  o: { delay?: number; error?: string; external?: string; link?: object } = {},
) =>
  service<string>("crm_job_finish($1, $2, $3, $4, $5, $6, $7::jsonb, 3)", [
    job,
    ws,
    outcome,
    o.delay ?? 60,
    o.error ?? null,
    o.external ?? null,
    o.link ? JSON.stringify(o.link) : null,
  ]);
const jobs = (ws: string) =>
  db.admin<{
    kind: string;
    source_key: string;
    status: string;
    attempts: number;
  }>(
    `select kind, source_key, status, attempts from crm_sync_jobs where workspace_id = $1 order by created_at, source_key`,
    [ws],
  );
const addLead = async (ws: string, email: string | null) =>
  (
    await db.admin<{ id: string }>(
      `insert into leads (workspace_id, name, email) values ($1, 'Lead', $2) returning id`,
      [ws, email],
    )
  )[0].id;
const known = (ws: string, email: string | null, domain: string | null) =>
  service<boolean>("crm_is_known($1, $2, $3)", [ws, email, domain]);
const pullClaim = () =>
  service<{
    workspace_id: string;
    generation: number;
    cursor: object;
  } | null>("crm_pull_claim(60)");
const pullSave = (
  ws: string,
  gen: number,
  entries: { k: string; v: string; f?: boolean }[],
  o: { done?: boolean; seen?: number; cap?: number; error?: string } = {},
) =>
  service<string | null>(
    "crm_pull_save($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)",
    [
      ws,
      gen,
      JSON.stringify(entries),
      JSON.stringify({ after: "x" }),
      o.seen ?? entries.length,
      o.done ?? false,
      o.cap ?? 50000,
      o.error ?? null,
    ],
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
});

afterAll(async () => {
  await db.close();
});

describe("before a CRM is connected", () => {
  it("nothing is queued and nobody is known to a CRM", async () => {
    await addLead(A, "early@lead.example");
    expect(await jobs(A)).toEqual([]);
    expect(await known(A, "early@lead.example", null)).toBe(false);
  });
});

describe("connecting", () => {
  it("is refused for someone who isn't an owner or admin of the workspace", async () => {
    expect(await connect(A, amy)).toEqual({ status: "not_found" });
    expect(await connect(A, bob)).toEqual({ status: "not_found" });
    expect(await db.admin(`select 1 from crm_connections`)).toEqual([]);
  });

  it("can't be done by a signed-in person directly", async () => {
    await expect(
      db.user(alice)(
        `select crm_connect($1, $2, 'hubspot', $3, '', null, false, false)`,
        [A, alice, TOKEN],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.user(alice)(
        `insert into crm_connections (workspace_id, provider) values ($1, 'hubspot')`,
        [A],
      ),
    ).rejects.toThrow(DENIED);
  });

  it("stores the token in Vault only, and queues the first import", async () => {
    expect(await connect(A, alice)).toEqual({ status: "connected" });
    const [row] = await db.admin<Record<string, unknown>>(
      `select * from crm_connections where workspace_id = $1`,
      [A],
    );
    expect(row.status).toBe("active");
    expect(row.pull_status).toBe("queued");
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    const secrets = await db.admin<{ secret: string }>(
      `select secret from vault.secrets where name = $1`,
      [`crm_token:${A}`],
    );
    expect(secrets).toEqual([{ secret: TOKEN }]);
    // No table in public holds it.
    for (const table of CRM_TABLES) {
      const rows = await db.admin(`select * from ${table}`);
      expect(JSON.stringify(rows), table).not.toContain(TOKEN);
    }
  });

  it("gives the token to the secret key and to nobody else", async () => {
    expect(
      await service<{ token: string; provider: string }>(
        "crm_credentials($1)",
        [A],
      ),
    ).toMatchObject({ token: TOKEN, provider: "hubspot" });
    for (const who of [alice, bob])
      await expect(
        db.user(who)(`select crm_credentials($1)`, [A]),
      ).rejects.toThrow(/permission denied/);
    await expect(
      db.as({ role: "anon" }, `select crm_credentials($1)`, [A]),
    ).rejects.toThrow(/permission denied/);
    for (const who of [alice, bob])
      await expect(
        db.user(who)(`select * from vault.decrypted_secrets`),
      ).rejects.toThrow(/permission denied/);
  });

  it("allows one CRM per workspace; a new token for the same one replaces the old", async () => {
    expect(await connect(A, alice, "pipedrive")).toEqual({
      status: "other_connected",
      provider: "hubspot",
    });
    expect(await connect(A, alice, "hubspot", TOKEN + "-new")).toEqual({
      status: "connected",
    });
    expect(
      await db.admin(`select secret from vault.secrets where name = $1`, [
        `crm_token:${A}`,
      ]),
    ).toEqual([{ secret: TOKEN + "-new" }]);
    await connect(A, alice);
    expect(await connect(B, bob, "pipedrive")).toEqual({
      status: "connected",
    });
  });
});

describe("one workspace and another", () => {
  it("can't see each other's connection, queue, links or exclusion list", async () => {
    const lead = await addLead(B, "b-private@b.example");
    await db.admin(
      `insert into crm_lead_links (workspace_id, lead_id, provider, contact_id) values ($1, $2, 'pipedrive', '77')`,
      [B, lead],
    );
    await db.admin(
      `insert into crm_known_contacts (workspace_id, kind, value_hash, generation)
       values ($1, 'email', sha256('x@b.example'::bytea), 1)`,
      [B],
    );
    for (const table of CRM_TABLES) {
      const mine = await db.user(alice)<{ workspace_id: string }>(
        `select workspace_id from ${table}`,
      );
      expect(
        mine.every((r) => r.workspace_id === A),
        table,
      ).toBe(true);
      expect(
        (
          await db.user(bob)<{ workspace_id: string }>(
            `select workspace_id from ${table}`,
          )
        ).length,
        table,
      ).toBeGreaterThan(0);
    }
  });

  it("can't change each other's settings, and members can't change their own", async () => {
    const r = await db.user(alice)(
      `update crm_connections set skip_rule = 'customers_and_open_deals' where workspace_id = $1`,
      [B],
    );
    expect(r.affected).toBe(0);
    const m = await db.user(amy)(
      `update crm_connections set skip_rule = 'customers_and_open_deals' where workspace_id = $1`,
      [A],
    );
    expect(m.affected).toBe(0);
    await expect(
      db.user(alice)(
        `update crm_connections set status = 'active', provider = 'pipedrive' where workspace_id = $1`,
        [A],
      ),
    ).rejects.toThrow(DENIED);
    const ok = await db.user(alice)(
      `update crm_connections set skip_rule = 'any_contact' where workspace_id = $1`,
      [A],
    );
    expect(ok.affected).toBe(1);
  });

  it("can't write to the queue, the links or the list at all", async () => {
    const lead = await addLead(A, null);
    for (const [sql, params] of [
      [
        `insert into crm_sync_jobs (workspace_id, lead_id, kind, source_key) values ($1, $2, 'contact', 'x:1')`,
        [A, lead],
      ],
      [
        `insert into crm_lead_links (workspace_id, lead_id, provider) values ($1, $2, 'hubspot')`,
        [A, lead],
      ],
      [
        `insert into crm_known_contacts (workspace_id, kind, value_hash, generation) values ($1, 'email', sha256('y'::bytea), 1)`,
        [A],
      ],
    ] as [string, unknown[]][])
      await expect(db.user(alice)(sql, params)).rejects.toThrow(DENIED);
    for (const table of CRM_TABLES) {
      await expect(db.user(alice)(`delete from ${table}`)).rejects.toThrow(
        DENIED,
      );
    }
    await expect(
      db.user(alice)(`update crm_sync_jobs set status = 'done'`),
    ).rejects.toThrow(DENIED);
  });

  it("only the secret key may run the queue, the import or the checks", async () => {
    for (const call of [
      `select crm_jobs_claim(10, 60, 3, null)`,
      `select crm_job_finish(gen_random_uuid(), gen_random_uuid(), 'done', 1, null, null, null, 3)`,
      `select crm_pull_claim(60)`,
      `select crm_pull_save(gen_random_uuid(), 1, '[]', '{}', 0, true, 10, null)`,
      `select crm_is_known(gen_random_uuid(), 'a@b.example', null)`,
      `select crm_cron_token_ok('x')`,
      `select private.crm_is_known(gen_random_uuid(), 'a@b.example', null)`,
    ]) {
      await expect(db.user(alice)(call), call).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.as({ role: "anon" }, call), call).rejects.toThrow(
        /permission denied/,
      );
    }
    for (const call of [
      `select crm_disconnect(gen_random_uuid())`,
      `select crm_retry_jobs(gen_random_uuid(), null)`,
      `select crm_pull_now(gen_random_uuid())`,
    ])
      await expect(db.as({ role: "anon" }, call), call).rejects.toThrow(
        /permission denied/,
      );
  });

  it("admins of one workspace can't disconnect, retry or re-import another's", async () => {
    expect(
      (
        await db.user(alice)<{ r: boolean }>(`select crm_disconnect($1) r`, [B])
      )[0].r,
    ).toBe(false);
    expect(
      (
        await db.user(alice)<{ r: boolean }>(`select crm_pull_now($1) r`, [B])
      )[0].r,
    ).toBe(false);
    expect(
      (
        await db.user(alice)<{ r: number }>(
          `select crm_retry_jobs($1, null) r`,
          [B],
        )
      )[0].r,
    ).toBe(0);
    expect(
      (
        await db.user(amy)<{ r: boolean }>(`select crm_disconnect($1) r`, [A])
      )[0].r,
    ).toBe(false);
    expect(
      await db.admin(`select status from crm_connections order by provider`),
    ).toEqual([{ status: "active" }, { status: "active" }]);
  });
});

describe("what gets queued", () => {
  it("a new lead with an email, once", async () => {
    await db.admin(`delete from crm_sync_jobs`);
    const lead = await addLead(A, "new@lead.example");
    await db.admin(`update leads set name = 'Renamed' where id = $1`, [lead]);
    expect(await jobs(A)).toEqual([
      {
        kind: "contact",
        source_key: `contact:${lead}`,
        status: "pending",
        attempts: 0,
      },
    ]);
  });

  it("a lead qualified again after its contact was written, and a deal only when switched on", async () => {
    await db.admin(`delete from crm_sync_jobs`);
    const lead = await addLead(A, "qual@lead.example");
    await db.admin(
      `update crm_sync_jobs set status = 'done' where source_key = $1`,
      [`contact:${lead}`],
    );
    await db.admin(`update leads set status = 'qualified' where id = $1`, [
      lead,
    ]);
    expect(await jobs(A)).toEqual([
      expect.objectContaining({
        source_key: `contact:${lead}`,
        status: "pending",
      }),
    ]);

    await db.admin(
      `update crm_connections set deal_trigger = 'qualified', deal_pipeline_id = 'default' where workspace_id = $1`,
      [A],
    );
    const other = await addLead(A, "deal@lead.example");
    await db.admin(`update leads set status = 'qualified' where id = $1`, [
      other,
    ]);
    await db.admin(`update leads set status = 'engaged' where id = $1`, [
      other,
    ]);
    await db.admin(`update leads set status = 'qualified' where id = $1`, [
      other,
    ]);
    const deals = (await jobs(A)).filter((j) => j.kind === "deal");
    expect(deals).toEqual([
      expect.objectContaining({ source_key: `deal:${other}` }),
    ]);
    await db.admin(
      `update crm_connections set deal_trigger = 'off' where workspace_id = $1`,
      [A],
    );
  });

  it("do not contact and unsubscribed, once", async () => {
    await db.admin(`delete from crm_sync_jobs`);
    const lead = await addLead(A, "stop@lead.example");
    await db.admin(`update leads set do_not_contact = true where id = $1`, [
      lead,
    ]);
    await db.admin(`update leads set status = 'unsubscribed' where id = $1`, [
      lead,
    ]);
    expect((await jobs(A)).filter((j) => j.kind === "opt_out")).toEqual([
      expect.objectContaining({ source_key: `opt_out:${lead}` }),
    ]);
  });

  it("a chat's outcome as one note, and no second one when it closes", async () => {
    await db.admin(`delete from crm_sync_jobs`);
    const lead = await addLead(A, null);
    const [{ id: conv }] = await db.admin<{ id: string }>(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'chat') returning id`,
      [A, lead],
    );
    await db.admin(
      `update conversations set outcome = 'qualified', outcome_summary = 'Wants a demo' where id = $1`,
      [conv],
    );
    await db.admin(`update conversations set status = 'closed' where id = $1`, [
      conv,
    ]);
    expect(await jobs(A)).toEqual([
      expect.objectContaining({
        kind: "note",
        source_key: `chat:${conv}:qualified`,
      }),
    ]);
    // A chat with no outcome gets its note when it is closed.
    const [{ id: quiet }] = await db.admin<{ id: string }>(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'chat') returning id`,
      [A, lead],
    );
    await db.admin(`update conversations set status = 'closed' where id = $1`, [
      quiet,
    ]);
    expect((await jobs(A)).map((j) => j.source_key)).toContain(
      `chat:${quiet}:closed`,
    );
  });

  it("emails sent and received as notes, not out-of-office replies or unsent drafts", async () => {
    await db.admin(`delete from crm_sync_jobs`);
    const lead = await addLead(A, null);
    const [{ id: conv }] = await db.admin<{ id: string }>(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'email') returning id`,
      [A, lead],
    );
    const msg = async (
      dir: string,
      author: string,
      status: string,
      meta = {},
    ) =>
      (
        await db.admin<{ id: string }>(
          `insert into messages (workspace_id, conversation_id, direction, author, body, delivery_status, metadata)
           values ($1, $2, $3, $4, 'Hello', $5, $6::jsonb) returning id`,
          [A, conv, dir, author, status, JSON.stringify(meta)],
        )
      )[0].id;
    const sent = await msg("out", "agent", "sent");
    const reply = await msg("in", "lead", "received");
    await msg("in", "lead", "received", { auto_reply: true });
    await msg("out", "user", "not_delivered");
    expect((await jobs(A)).map((j) => j.source_key).sort()).toEqual(
      [`msg:${sent}`, `msg:${reply}`].sort(),
    );
  });

  it("a meeting, again when it changes, and a deal when that is the setting", async () => {
    await db.admin(`delete from crm_sync_jobs`);
    await db.admin(
      `update crm_connections set deal_trigger = 'meeting_booked', deal_pipeline_id = 'default' where workspace_id = $1`,
      [A],
    );
    const lead = await addLead(A, "meet@lead.example");
    const [{ id: meeting }] = await db.admin<{ id: string }>(
      `insert into meetings (workspace_id, lead_id, title, starts_at, ends_at)
       values ($1, $2, 'Intro', now() + interval '1 day', now() + interval '25 hours') returning id`,
      [A, lead],
    );
    expect((await jobs(A)).map((j) => j.source_key).sort()).toEqual(
      [`contact:${lead}`, `deal:${lead}`, `meeting:${meeting}`].sort(),
    );
    await db.admin(
      `update crm_sync_jobs set status = 'done' where source_key = $1`,
      [`meeting:${meeting}`],
    );
    await db.admin(`update meetings set status = 'completed' where id = $1`, [
      meeting,
    ]);
    expect(
      (await jobs(A)).find((j) => j.source_key === `meeting:${meeting}`)
        ?.status,
    ).toBe("pending");
    await db.admin(
      `update crm_connections set deal_trigger = 'off' where workspace_id = $1`,
      [A],
    );
  });
});

describe("running the queue", () => {
  it("hands out each due job once, with what it needs", async () => {
    await db.admin(`delete from crm_sync_jobs`);
    const lead = await addLead(A, "run@lead.example");
    const [{ id: conv }] = await db.admin<{ id: string }>(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'chat') returning id`,
      [A, lead],
    );
    await db.admin(
      `insert into messages (workspace_id, conversation_id, direction, author, body, delivery_status)
       values ($1, $2, 'in', 'lead', 'Do you integrate with my CRM?', 'received')`,
      [A, conv],
    );
    await db.admin(
      `update conversations set outcome = 'needs_human', outcome_summary = 'Asked about CRM' where id = $1`,
      [conv],
    );
    const first = await claim(A);
    expect(first.map((j) => j.kind).sort()).toEqual(["contact", "note"]);
    const note = first.find((j) => j.kind === "note")!;
    expect(note.lead.email).toBe("run@lead.example");
    expect(note.connection.provider).toBe("hubspot");
    expect(note.detail).toMatchObject({
      type: "chat",
      outcome: "needs_human",
      outcome_summary: "Asked about CRM",
    });
    expect(note.detail!.transcript).toContain(
      "Visitor: Do you integrate with my CRM?",
    );
    // Leased: a second claim gets nothing, and B's queue is not A's.
    expect(await claim(A)).toEqual([]);
    expect(
      (await claim(B)).every((j) => j.connection.provider === "pipedrive"),
    ).toBe(true);
  });

  it("stores the CRM ids on the lead when a job is done, once", async () => {
    const [job] = await db.admin<{ id: string; lead_id: string }>(
      `select id, lead_id from crm_sync_jobs where workspace_id = $1 and kind = 'contact' and status = 'running'`,
      [A],
    );
    const link = {
      contact_id: "501",
      company_id: "601",
      contact_created: true,
      company_created: false,
      company_domain: "lead.example",
    };
    expect(await finish(job.id, A, "done", { link })).toBe("done");
    expect(await finish(job.id, A, "failed")).toBe("ignored");
    expect(
      await db.admin(
        `select contact_id, company_id, contact_created from crm_lead_links where lead_id = $1`,
        [job.lead_id],
      ),
    ).toEqual([
      { contact_id: "501", company_id: "601", contact_created: true },
    ]);
    // The lead's later jobs carry the link.
    await db.admin(
      `update crm_sync_jobs set status = 'pending', locked_until = null, attempts = 0 where workspace_id = $1 and kind = 'note'`,
      [A],
    );
    const [note] = await claim(A);
    expect(note.link?.contact_id).toBe("501");
  });

  it("retries later, then fails after the last attempt, and Retry puts it back", async () => {
    const [job] = await db.admin<{ id: string }>(
      `select id from crm_sync_jobs where workspace_id = $1 and kind = 'note' and status = 'running'`,
      [A],
    );
    expect(
      await finish(job.id, A, "retry", {
        delay: 120,
        error: "HubSpot is busy",
      }),
    ).toBe("retry");
    const [row] = await db.admin<{ due: boolean; status: string }>(
      `select next_attempt_at > now() + interval '100 seconds' as due, status from crm_sync_jobs where id = $1`,
      [job.id],
    );
    expect(row).toEqual({ due: true, status: "pending" });
    expect(await claim(A)).toEqual([]); // not due yet
    for (let i = 0; i < 2; i++) {
      await db.admin(
        `update crm_sync_jobs set next_attempt_at = now() where id = $1`,
        [job.id],
      );
      const [again] = await claim(A);
      expect(again.id).toBe(job.id);
      await finish(job.id, A, "retry", { error: "HubSpot is busy" });
    }
    const [failed] = await db.admin<{ status: string; attempts: number }>(
      `select status, attempts from crm_sync_jobs where id = $1`,
      [job.id],
    );
    expect(failed).toEqual({ status: "failed", attempts: 3 });
    expect(
      (
        await db.admin<{ last_error: string }>(
          `select last_error from crm_connections where workspace_id = $1`,
          [A],
        )
      )[0].last_error,
    ).toBe("HubSpot is busy");

    // A member can't retry; an admin can.
    expect(
      (
        await db.user(amy)<{ r: number }>(`select crm_retry_jobs($1, $2) r`, [
          A,
          job.id,
        ])
      )[0].r,
    ).toBe(0);
    expect(
      (
        await db.user(alice)<{ r: number }>(`select crm_retry_jobs($1, $2) r`, [
          A,
          job.id,
        ])
      )[0].r,
    ).toBe(1);
    expect((await claim(A)).map((j) => j.id)).toEqual([job.id]);
  });

  it("picks up a job whose step died once its lease runs out", async () => {
    const [job] = await db.admin<{ id: string }>(
      `select id from crm_sync_jobs where workspace_id = $1 and status = 'running'`,
      [A],
    );
    await db.admin(
      `update crm_sync_jobs set locked_until = now() - interval '1 second' where id = $1`,
      [job.id],
    );
    const [again] = await claim(A);
    expect(again.id).toBe(job.id);
    expect(again.attempts).toBe(2);
  });

  it("stops pushing when the CRM refuses the token, without using up attempts", async () => {
    const [job] = await db.admin<{ id: string; attempts: number }>(
      `select id, attempts from crm_sync_jobs where workspace_id = $1 and status = 'running'`,
      [A],
    );
    expect(
      await finish(job.id, A, "auth", { error: "HubSpot refused the token." }),
    ).toBe("auth");
    const [c] = await db.admin<{ status: string; status_reason: string }>(
      `select status, status_reason from crm_connections where workspace_id = $1`,
      [A],
    );
    expect(c).toEqual({
      status: "error",
      status_reason: "HubSpot refused the token.",
    });
    expect(await claim(A)).toEqual([]);
    const [after] = await db.admin<{ status: string; attempts: number }>(
      `select status, attempts from crm_sync_jobs where id = $1`,
      [job.id],
    );
    expect(after).toEqual({ status: "pending", attempts: job.attempts - 1 });
    // Connecting again with a working token carries on.
    await connect(A, alice);
    expect((await claim(A)).map((j) => j.id)).toContain(job.id);
  });

  it("skips a job whose conversation or meeting is gone", async () => {
    await db.admin(`delete from crm_sync_jobs`);
    const lead = await addLead(A, null);
    const [{ id: m }] = await db.admin<{ id: string }>(
      `insert into meetings (workspace_id, lead_id, starts_at, ends_at)
       values ($1, $2, now(), now() + interval '1 hour') returning id`,
      [A, lead],
    );
    await db.admin(`delete from meetings where id = $1`, [m]);
    const [job] = await claim(A);
    expect(job.kind).toBe("meeting");
    expect(job.detail).toBeNull();
    expect(await finish(job.id, A, "skipped", { error: "Gone" })).toBe(
      "skipped",
    );
  });
});

describe("the import and the skip rule", () => {
  let gen: number;

  it("stores hashes only, never the addresses", async () => {
    await db.admin(
      `update crm_connections set pull_status = 'queued' where workspace_id = $1`,
      [A],
    );
    await db.admin(
      `update crm_connections set pull_status = 'done' where workspace_id = $1`,
      [B],
    );
    const c = await pullClaim();
    expect(c?.workspace_id).toBe(A);
    gen = c!.generation;
    expect(await pullClaim()).toBeNull(); // leased
    expect(
      await pullSave(A, gen, [
        { k: "email", v: "customer@client.example", f: true },
        { k: "email", v: "contact@other.example" },
        { k: "domain", v: "client.example", f: true },
        { k: "domain", v: "prospect.example" },
        { k: "email", v: "not an email" },
        { k: "domain", v: "bad domain!" },
      ]),
    ).toBe("running");
    const rows = await db.admin<Record<string, unknown>>(
      `select * from crm_known_contacts where workspace_id = $1`,
      [A],
    );
    expect(rows).toHaveLength(4);
    expect(JSON.stringify(rows)).not.toMatch(/client|other|prospect/);
  });

  it("knows those people and companies, and nobody else", async () => {
    expect(await known(A, "customer@client.example", null)).toBe(true);
    expect(await known(A, "CONTACT@other.example", null)).toBe(true);
    expect(await known(A, "someone@prospect.example", null)).toBe(true);
    expect(await known(A, null, "https://www.prospect.example/about")).toBe(
      true,
    );
    expect(await known(A, "new@fresh.example", "fresh.example")).toBe(false);
    expect(await known(B, "customer@client.example", null)).toBe(false);
  });

  it("with 'only customers and open deals', knows only those", async () => {
    await db.user(alice)(
      `update crm_connections set skip_rule = 'customers_and_open_deals' where workspace_id = $1`,
      [A],
    );
    expect(await known(A, "customer@client.example", null)).toBe(true);
    expect(await known(A, "anyone@client.example", null)).toBe(true);
    expect(await known(A, "contact@other.example", null)).toBe(false);
    expect(await known(A, "someone@prospect.example", null)).toBe(false);
    await db.user(alice)(
      `update crm_connections set skip_rule = 'any_contact' where workspace_id = $1`,
      [A],
    );
  });

  it("doesn't count contacts and companies Dialvo itself created", async () => {
    const lead = await addLead(A, "mine@ours.example");
    await db.admin(
      `insert into crm_lead_links (workspace_id, lead_id, provider, contact_id, contact_created, company_created, company_domain)
       values ($1, $2, 'hubspot', '9', true, true, 'ours.example')`,
      [A, lead],
    );
    const [{ generation }] = await db.admin<{ generation: number }>(
      `select pull_generation as generation from crm_connections where workspace_id = $1`,
      [A],
    );
    await pullSave(A, generation, [
      { k: "email", v: "mine@ours.example" },
      { k: "domain", v: "ours.example" },
    ]);
    expect(await known(A, "mine@ours.example", null)).toBe(false);
    expect(await known(A, "colleague@ours.example", null)).toBe(false);
  });

  it("is the never-contact rule for Find leads, drafting and sending", async () => {
    const suppressed = (email: string | null, domain: string | null) =>
      db
        .admin<{ r: boolean }>(
          `select private.outbound_is_suppressed($1, $2, $3) as r`,
          [A, email, domain],
        )
        .then((r) => r[0].r);
    expect(await suppressed("customer@client.example", null)).toBe(true);
    expect(await suppressed(null, "prospect.example")).toBe(true);
    expect(await suppressed("new@fresh.example", "fresh.example")).toBe(false);

    // A search that finds a company already in the CRM leaves it out.
    const [{ id: search }] = await db.admin<{ id: string }>(
      `insert into prospect_searches (workspace_id, name, description) values ($1, 'S', 'Agencies') returning id`,
      [A],
    );
    const run = await service<{ run_id: string }>(
      "prospect_run_start($1, $2, $3, 25, 100, 3000000)",
      [A, search, alice],
    );
    await service("prospect_run_claim($1, $2, 90, 2, 2, 60)", [run.run_id, A]);
    const added = await service<{ added: number }>(
      "prospect_run_add_candidates($1, $2, $3::jsonb, 1, 0, 0, 0, 6, 2)",
      [
        run.run_id,
        A,
        JSON.stringify([
          { domain: "prospect.example" },
          { domain: "client.example" },
          { domain: "fresh.example" },
        ]),
      ],
    );
    expect(added.added).toBe(1);
    expect(
      await db.admin(`select domain from prospects where workspace_id = $1`, [
        A,
      ]),
    ).toEqual([{ domain: "fresh.example" }]);
  });

  it("finishing drops what the CRM no longer has; a capped import keeps it", async () => {
    // A capped import (generation n+1) sees only one contact and keeps the rest.
    await db.admin(
      `update crm_connections set pull_status = 'queued' where workspace_id = $1`,
      [A],
    );
    const capped = await pullClaim();
    expect(
      await pullSave(
        A,
        capped!.generation,
        [{ k: "email", v: "customer@client.example", f: true }],
        { cap: 1 },
      ),
    ).toBe("capped");
    expect(await known(A, "contact@other.example", null)).toBe(true);

    // A complete one drops the rest.
    await db.admin(
      `update crm_connections set pull_status = 'queued' where workspace_id = $1`,
      [A],
    );
    const full = await pullClaim();
    expect(
      await pullSave(
        A,
        full!.generation,
        [{ k: "email", v: "customer@client.example", f: true }],
        { done: true },
      ),
    ).toBe("done");
    expect(await known(A, "customer@client.example", null)).toBe(true);
    expect(await known(A, "contact@other.example", null)).toBe(false);
    const [c] = await db.admin<{ known_count: number; pull_status: string }>(
      `select known_count, pull_status from crm_connections where workspace_id = $1`,
      [A],
    );
    expect(c).toEqual({ known_count: 1, pull_status: "done" });
    // A late save from an old generation changes nothing.
    expect(await pullSave(A, gen, [{ k: "email", v: "late@x.example" }])).toBe(
      null,
    );
  });

  it("a failed step stops the import and says why", async () => {
    await db.admin(
      `update crm_connections set pull_status = 'queued' where workspace_id = $1`,
      [A],
    );
    const c = await pullClaim();
    expect(
      await pullSave(A, c!.generation, [], { error: "HubSpot is down" }),
    ).toBe("failed");
    const [row] = await db.admin<{ last_pull_error: string }>(
      `select last_pull_error from crm_connections where workspace_id = $1`,
      [A],
    );
    expect(row.last_pull_error).toBe("HubSpot is down");
    expect(await known(A, "customer@client.example", null)).toBe(true);
  });
});

describe("the scheduler", () => {
  const due = () =>
    db
      .admin<{ r: string[] }>(`select private.crm_due_work() r`)
      .then((r) => r[0].r);

  it("asks for a push only when a job is due, and queues imports that are a day old", async () => {
    await db.admin(`delete from crm_sync_jobs`);
    await db.admin(
      `update crm_connections set pull_status = 'done', last_pull_at = now()`,
    );
    expect(await due()).toEqual([]);
    await addLead(A, "tick@lead.example");
    expect(await due()).toEqual(["push"]);
    await db.admin(`delete from crm_sync_jobs`);
    await db.admin(
      `update crm_connections set last_pull_at = now() - interval '25 hours' where workspace_id = $1`,
      [B],
    );
    expect(await due()).toEqual(["pull"]);
    expect(
      await db.admin(
        `select pull_status from crm_connections where workspace_id = $1`,
        [B],
      ),
    ).toEqual([{ pull_status: "queued" }]);
  });

  it("checks the token kept in Vault, for the secret key only", async () => {
    const [{ secret }] = await db.admin<{ secret: string }>(
      `select secret from vault.secrets where name = 'dialvo_cron_token'`,
    );
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(await service<boolean>("crm_cron_token_ok($1)", [secret])).toBe(
      true,
    );
    expect(
      await service<boolean>("crm_cron_token_ok($1)", ["x".repeat(40)]),
    ).toBe(false);
    expect(await service<boolean>("crm_cron_token_ok($1)", [null])).toBe(false);
  });
});

describe("disconnecting", () => {
  it("deletes the token, stops the queue and forgets the list", async () => {
    await addLead(A, "pending@lead.example");
    expect(
      (
        await db.user(alice)<{ r: boolean }>(`select crm_disconnect($1) r`, [A])
      )[0].r,
    ).toBe(true);
    expect(
      await db.admin(`select 1 from vault.secrets where name = $1`, [
        `crm_token:${A}`,
      ]),
    ).toEqual([]);
    expect(await service("crm_credentials($1)", [A])).toBeNull();
    expect(
      await db.admin(
        `select 1 from crm_sync_jobs where workspace_id = $1 and status in ('pending', 'running')`,
        [A],
      ),
    ).toEqual([]);
    expect(
      await db.admin(
        `select 1 from crm_known_contacts where workspace_id = $1`,
        [A],
      ),
    ).toEqual([]);
    expect(await known(A, "customer@client.example", null)).toBe(false);
    // Nothing is queued any more, and B is untouched.
    await addLead(A, "after@lead.example");
    expect(
      await db.admin(
        `select 1 from crm_sync_jobs where workspace_id = $1 and status = 'pending'`,
        [A],
      ),
    ).toEqual([]);
    expect(await service("crm_credentials($1)", [B])).toMatchObject({
      provider: "pipedrive",
    });
  });

  it("then lets the workspace connect a different CRM", async () => {
    expect(await connect(A, alice, "pipedrive")).toEqual({
      status: "connected",
    });
  });
});
