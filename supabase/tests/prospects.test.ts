import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { OUTBOUND_TABLES } from "./outbound-tables";

// "Find leads", proved against the real migrations: one workspace can't see
// or change another's searches, runs, prospects, drafts, suppression list or
// usage; only the server can run a search or move a counter; and the run's
// steps, caps, dedupe and suppression behave as the app relies on.

const DENIED = /row-level security|permission denied/;

let db: TestDb;
let alice: string; // owner of A
let amy: string; // member of A
let bob: string; // owner of B
let carol: string; // in no workspace
let A: string;
let B: string;
const a: Record<string, string> = {};
const b: Record<string, string> = {};

const service = async <T>(sql: string, params: unknown[] = []) =>
  (
    await db.as<{ r: T }>(
      { role: "service_role" },
      `select ${sql} as r`,
      params,
    )
  )[0].r;

const CAPS = { target: 25, runsPerDay: 1000, spendPerDay: 3_000_000 };

const startRun = (ws: string, search: string, user: string, caps = CAPS) =>
  service<{ status: string; run_id?: string }>(
    "prospect_run_start($1, $2, $3, $4, $5, $6)",
    [ws, search, user, caps.target, caps.runsPerDay, caps.spendPerDay],
  );
type Claim = {
  status: string;
  stop_reason?: string;
  run?: { found: number; brief: Record<string, string>; target_count: number };
  usage?: Record<string, number>;
  work?: { id: string; domain: string; website: string }[];
  known?: string[];
};
const claim = (
  run: string,
  ws: string,
  o: { lease?: number; steps?: number } = {},
) =>
  service<Claim | null>("prospect_run_claim($1, $2, $3, 2, 2, $4)", [
    run,
    ws,
    o.lease ?? 90,
    o.steps ?? 60,
  ]);
const addCandidates = (
  run: string,
  ws: string,
  candidates: { domain: string; company_name?: string }[],
  o: { searches?: number; cost?: number; maxRounds?: number } = {},
) =>
  service<{ status: string; added: number } | null>(
    "prospect_run_add_candidates($1, $2, $3::jsonb, $4, 100, 50, $5, $6, 2)",
    [
      run,
      ws,
      JSON.stringify(candidates),
      o.searches ?? 1,
      o.cost ?? 1000,
      o.maxRounds ?? 6,
    ],
  );
const saveResearch = (
  run: string,
  ws: string,
  prospect: string,
  result: Record<string, unknown>,
) =>
  service<string | null>(
    "prospect_save_research($1, $2, $3, $4::jsonb, 100, 50, 500)",
    [run, ws, prospect, JSON.stringify(result)],
  );
const found = (extra: Record<string, unknown> = {}) => ({
  status: "found",
  company_name: "Acme Ltd",
  website: "https://acme.example/",
  summary: "Makes anvils.",
  location: "Leeds, UK",
  contact_name: "Dana Smith",
  contact_role: "Founder",
  contact_source_url: "https://acme.example/about",
  email: "hello@acme.example",
  email_source_url: "https://acme.example/contact",
  email_kind: "business",
  phone: "+441130000000",
  phone_source_url: "https://acme.example/contact",
  facts: [
    {
      fact: "They have made anvils since 1950.",
      quote: "making anvils since 1950",
      source_url: "https://acme.example/about",
    },
  ],
  pages: ["https://acme.example/", "https://acme.example/contact"],
  ...extra,
});
const claimDrafts = (ws: string, user: string, limit = 3, cap = 100) =>
  service<{
    capped: boolean;
    remaining: number;
    context: {
      sender_name: string;
      instructions: string;
      knowledge: unknown[];
    };
    drafts: { draft_id: string; prospect: { company_name: string } }[];
  } | null>("outbound_draft_claim($1, $2, $3, $4, 3000000, 2)", [
    ws,
    user,
    limit,
    cap,
  ]);
const saveDraft = (ws: string, id: string, ok = true) =>
  service<string>(
    "outbound_draft_save($1, $2, $3, 'A subject', 'Hello,\n\nA body.', 'claude-haiku-4-5', 700)",
    [ws, id, ok],
  );

/** A finished run with one found, kept prospect. Returns its ids. */
async function scene(ws: string, owner: string, domain: string) {
  const [{ id: search }] = await db.admin<{ id: string }>(
    `insert into prospect_searches (workspace_id, name, description, created_by)
     values ($1, 'Search', 'Dental clinics', $2) returning id`,
    [ws, owner],
  );
  const started = await startRun(ws, search, owner);
  const run = started.run_id!;
  await claim(run, ws);
  await addCandidates(run, ws, [{ domain, company_name: "Acme" }], {
    maxRounds: 1,
  });
  const c = await claim(run, ws);
  const prospect = c!.work![0].id;
  await saveResearch(
    run,
    ws,
    prospect,
    found({ email: `hello@${domain}`, website: `https://${domain}/` }),
  );
  await service("prospect_run_release($1, $2)", [run, ws]);
  await claim(run, ws); // nothing left: done
  return { search, run, prospect };
}

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.createUser("alice@a.example", "Alice");
  amy = await db.createUser("amy@a.example", "Amy");
  bob = await db.createUser("bob@b.example", "Bob");
  carol = await db.createUser("carol@nowhere.example", "Carol");
  [{ id: A }] = await db.user(alice)<{ id: string }>(
    `select create_workspace('Agency A', 'Europe/London', 'a.example', 'We sell A') as id`,
  );
  [{ id: B }] = await db.user(bob)<{ id: string }>(
    `select create_workspace('Agency B', 'UTC', null, 'We sell B') as id`,
  );
  await db.admin(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [A, amy],
  );
  for (const [ws, owner, ids, domain] of [
    [A, alice, a, "acme-a.example"],
    [B, bob, b, "acme-b.example"],
  ] as const) {
    Object.assign(ids, await scene(ws, owner, domain));
    await db.user(owner)(
      `update prospects set decision = 'kept' where id = $1`,
      [ids.prospect],
    );
    const drafts = await claimDrafts(ws, owner);
    ids.draft = drafts!.drafts[0].draft_id;
    await saveDraft(ws, ids.draft);
    [{ id: ids.suppression }] = await db.user(owner)<{ id: string }>(
      `insert into outbound_suppressions (workspace_id, kind, value, created_by)
       values ($1, 'domain', 'never.example', $2) returning id`,
      [ws, owner],
    );
  }
});

afterAll(async () => {
  await db.close();
});

async function expectNoEffect(run: () => Promise<{ affected: number }>) {
  let affected = 0;
  try {
    affected = (await run()).affected;
  } catch (error) {
    expect((error as Error).message).toMatch(DENIED);
    return;
  }
  expect(affected).toBe(0);
}

/** For each table: B's row, a valid-looking insert into B, a harmless update. */
const TABLES: {
  table: string;
  where: () => [string, unknown[]];
  insert: () => [string, unknown[]];
  touch: string;
}[] = [
  {
    table: "prospect_searches",
    where: () => ["id = $1", [b.search]],
    insert: () => [
      `insert into prospect_searches (workspace_id, name, description, created_by) values ($1, 'Planted', 'x', $2)`,
      [B, alice],
    ],
    touch: "name = 'Changed'",
  },
  {
    table: "prospect_runs",
    where: () => ["id = $1", [b.run]],
    insert: () => [
      `insert into prospect_runs (workspace_id, search_id, brief, target_count) values ($1, $2, '{}'::jsonb, 5)`,
      [B, b.search],
    ],
    touch: "status = 'stopped'",
  },
  {
    table: "prospects",
    where: () => ["id = $1", [b.prospect]],
    insert: () => [
      `insert into prospects (workspace_id, run_id, search_id, domain, website) values ($1, $2, $3, 'planted.example', 'https://planted.example/')`,
      [B, b.run, b.search],
    ],
    touch: "decision = 'removed'",
  },
  {
    table: "outbound_drafts",
    where: () => ["id = $1", [b.draft]],
    insert: () => [
      `insert into outbound_drafts (workspace_id, prospect_id, to_email) values ($1, $2, 'x@planted.example')`,
      [B, b.prospect],
    ],
    touch: "status = 'approved'",
  },
  {
    table: "outbound_suppressions",
    where: () => ["id = $1", [b.suppression]],
    insert: () => [
      `insert into outbound_suppressions (workspace_id, kind, value, created_by) values ($1, 'domain', 'planted.example', $2)`,
      [B, alice],
    ],
    touch: "note = 'Changed'",
  },
  {
    table: "outbound_usage",
    where: () => ["workspace_id = $1", [B]],
    insert: () => [
      `insert into outbound_usage (workspace_id, day) values ($1, current_date - 1)`,
      [B],
    ],
    touch: "runs = 0",
  },
];

describe("the tables of Find leads", () => {
  it("are all covered here", () => {
    expect(TABLES.map((t) => t.table).sort()).toEqual(
      [...OUTBOUND_TABLES].sort(),
    );
  });

  it("show a member their own workspace's rows", async () => {
    for (const t of TABLES) {
      const rows = await db.user(amy)(
        `select 1 from ${t.table} where workspace_id = $1`,
        [A],
      );
      expect(rows.length, t.table).toBeGreaterThan(0);
    }
  });

  for (const t of TABLES)
    describe(t.table, () => {
      it("hides workspace B's rows from a member of A", async () => {
        const [where, params] = t.where();
        for (const who of [alice, amy]) {
          expect(
            await db.user(who)(
              `select 1 from ${t.table} where ${where}`,
              params,
            ),
          ).toEqual([]);
          expect(
            await db.user(who)(
              `select 1 from ${t.table} where workspace_id = $1`,
              [B],
            ),
          ).toEqual([]);
        }
      });

      it("refuses an insert into workspace B", async () => {
        const [sql, params] = t.insert();
        await expect(db.user(alice)(sql, params)).rejects.toThrow(DENIED);
      });

      it("refuses updates and deletes of workspace B's rows", async () => {
        const [where, params] = t.where();
        await expectNoEffect(() =>
          db.user(alice)(
            `update ${t.table} set ${t.touch} where ${where}`,
            params,
          ),
        );
        await expectNoEffect(() =>
          db.user(alice)(`delete from ${t.table} where ${where}`, params),
        );
        const [{ n }] = await db.admin<{ n: number }>(
          `select count(*)::int as n from ${t.table} where ${where}`,
          params,
        );
        expect(n).toBe(1);
      });

      it("shows nothing to someone in no workspace, or to anon", async () => {
        expect(await db.user(carol)(`select 1 from ${t.table}`)).toEqual([]);
        const [sql, params] = t.insert();
        await expect(db.user(carol)(sql, params)).rejects.toThrow(DENIED);
        await expect(
          db.as({ role: "anon" }, `select 1 from ${t.table}`),
        ).rejects.toThrow(/permission denied/);
      });
    });

  it("let members write only what is theirs to write, in their own workspace", async () => {
    // A member can't run a search, write research, a draft or a counter
    // directly, even in their own workspace: the server does those.
    for (const sql of [
      `insert into prospect_runs (workspace_id, search_id, brief, target_count) values ('${A}', '${a.search}', '{}'::jsonb, 100)`,
      `update prospect_runs set status = 'searching' where id = '${a.run}'`,
      `update prospects set email = 'made-up@acme-a.example' where id = '${a.prospect}'`,
      `insert into prospects (workspace_id, run_id, search_id, domain, website) values ('${A}', '${a.run}', '${a.search}', 'x.example', 'https://x.example/')`,
      `update outbound_drafts set status = 'approved' where id = '${a.draft}'`,
      `update outbound_usage set runs = 0 where workspace_id = '${A}'`,
      `delete from prospects where id = '${a.prospect}'`,
    ])
      await expect(db.user(amy)(sql), sql).rejects.toThrow(/permission denied/);
    // Keep / Remove is theirs.
    const kept = await db.user(amy)(
      `update prospects set decision = 'kept' where id = $1`,
      [a.prospect],
    );
    expect(kept.affected).toBe(1);
    // A member adds to the suppression list; only an admin takes off it.
    const [{ id }] = await db.user(amy)<{ id: string }>(
      `insert into outbound_suppressions (workspace_id, kind, value, created_by) values ($1, 'email', 'stop@x.example', $2) returning id`,
      [A, amy],
    );
    expect(
      (
        await db.user(amy)(`delete from outbound_suppressions where id = $1`, [
          id,
        ])
      ).affected,
    ).toBe(0);
    expect(
      (
        await db.user(alice)(
          `delete from outbound_suppressions where id = $1`,
          [id],
        )
      ).affected,
    ).toBe(1);
    // Not as someone else, and not a malformed entry.
    await expect(
      db.user(amy)(
        `insert into outbound_suppressions (workspace_id, kind, value, created_by) values ($1, 'email', 'a@b.example', $2)`,
        [A, alice],
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      db.user(amy)(
        `insert into outbound_suppressions (workspace_id, kind, value, created_by) values ($1, 'domain', 'Not A Domain', $2)`,
        [A, amy],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("can't hang a row off another workspace's parent", async () => {
    await expect(
      db.admin(
        `insert into prospects (workspace_id, run_id, search_id, domain, website) values ($1, $2, $3, 'cross.example', 'https://cross.example/')`,
        [A, b.run, b.search],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.admin(
        `insert into prospect_runs (workspace_id, search_id, brief, target_count, status) values ($1, $2, '{}'::jsonb, 5, 'done')`,
        [A, b.search],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.admin(`update outbound_drafts set workspace_id = $1 where id = $2`, [
        A,
        b.draft,
      ]),
    ).rejects.toThrow(/foreign key/);
  });

  it("never store an email address without the page it was found on", async () => {
    await expect(
      db.admin(`update prospects set email_source_url = null where id = $1`, [
        a.prospect,
      ]),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("the server's functions", () => {
  it("can't be called by signed-in people or anon", async () => {
    const calls = [
      `select outbound_take_suggestion('${A}', '${alice}', 10)`,
      `select outbound_record_spend('${A}', 1)`,
      `select prospect_run_start('${A}', '${a.search}', '${alice}', 25, 4, 3000000)`,
      `select prospect_run_claim('${a.run}', '${A}', 90, 2, 2, 60)`,
      `select prospect_run_add_candidates('${a.run}', '${A}', '[]'::jsonb, 0, 0, 0, 0, 6, 2)`,
      `select prospect_save_research('${a.run}', '${A}', '${a.prospect}', '{}'::jsonb, 0, 0, 0)`,
      `select prospect_run_release('${a.run}', '${A}')`,
      `select outbound_draft_claim('${A}', '${alice}', 3, 100, 3000000, 2)`,
      `select outbound_draft_save('${A}', '${a.draft}', true, 's', 'b', 'm', 0)`,
      `select private.outbound_is_suppressed('${A}', 'a@b.example', 'b.example')`,
      `select private.outbound_usage_add('${A}', 1, 1, 1)`,
    ];
    for (const call of calls) {
      await expect(db.user(alice)(call), call).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.as({ role: "anon" }, call), call).rejects.toThrow(
        /permission denied/,
      );
    }
    for (const call of [
      `select outbound_draft_decide('${a.draft}', 'approve')`,
      `select outbound_drafts_approve(array['${a.draft}']::uuid[])`,
      `select prospects_add_to_leads('${A}')`,
    ])
      await expect(db.as({ role: "anon" }, call), call).rejects.toThrow(
        /permission denied/,
      );
  });

  it("won't start a run for someone who isn't a member, or for another workspace's search", async () => {
    expect((await startRun(A, a.search, bob)).status).toBe("not_found");
    expect((await startRun(A, b.search, alice)).status).toBe("not_found");
    expect(await claimDrafts(A, bob)).toBeNull();
    expect(
      await service("outbound_take_suggestion($1, $2, 10)", [A, bob]),
    ).toBe(false);
    // A run is only reachable with its own workspace's id.
    expect(await claim(a.run, B)).toBeNull();
    expect(await addCandidates(a.run, B, [{ domain: "x.example" }])).toBeNull();
  });
});

describe("a run", () => {
  let W: string;
  let dave: string;
  let search: string;

  beforeAll(async () => {
    dave = await db.createUser("dave@w.example", "Dave");
    [{ id: W }] = await db.user(dave)<{ id: string }>(
      `select create_workspace('Workspace W', 'UTC', null, 'We sell W') as id`,
    );
    [{ id: search }] = await db.user(dave)<{ id: string }>(
      `insert into prospect_searches (workspace_id, name, description, location, exclusions, created_by)
       values ($1, 'Clinics', 'Dental clinics', 'Leeds', 'chains', $2) returning id`,
      [W, dave],
    );
    await db.admin(
      `insert into leads (workspace_id, name, email, website) values
        ($1, 'Known by site', null, 'https://www.Known-Site.example/contact'),
        ($1, 'Known by email', 'jo@known-mail.example', null)`,
      [W],
    );
    await db.user(dave)(
      `insert into outbound_suppressions (workspace_id, kind, value, created_by) values
        ($1, 'domain', 'blocked.example', $2), ($1, 'email', 'stop@listed.example', $2)`,
      [W, dave],
    );
  });

  const reset = () =>
    db.admin(`delete from prospect_runs where workspace_id = $1; `.trim(), [W]);

  it("starts once, snapshots the search, and is one at a time", async () => {
    const first = await startRun(W, search, dave);
    expect(first.status).toBe("started");
    const again = await startRun(W, search, dave);
    expect(again).toEqual({ status: "busy", run_id: first.run_id });
    const c = await claim(first.run_id!, W);
    expect(c!.status).toBe("searching");
    expect(c!.run!.brief).toEqual({
      description: "Dental clinics",
      location: "Leeds",
      company_size: "",
      exclusions: "chains",
    });
    expect(c!.run!.target_count).toBe(25);
    // The lease: a second step is told to wait.
    expect((await claim(first.run_id!, W))!.status).toBe("busy");
    await reset();
  });

  it("dedupes candidates against prospects, leads and the suppression list, and never exceeds the target", async () => {
    const { run_id: run } = await startRun(W, search, dave, {
      ...CAPS,
      target: 4,
    });
    await claim(run!, W);
    const stored = await addCandidates(run!, W, [
      { domain: "one.example", company_name: "One" },
      { domain: "https://WWW.One.example/about" }, // the same company again
      { domain: "known-site.example" }, // a lead's website
      { domain: "known-mail.example" }, // a lead's email domain
      { domain: "blocked.example" }, // suppressed
      { domain: "shop.blocked.example" }, // a subdomain of a suppressed one
      { domain: "acme-a.example" }, // another workspace's prospect: fine here
      { domain: "not a domain" },
      { domain: "two.example" },
      { domain: "three.example" },
      { domain: "four.example" }, // over the target of 4
    ]);
    expect(stored).toEqual({ status: "researching", added: 4 });
    const rows = await db.admin<{ domain: string; website: string }>(
      `select domain, website from prospects where run_id = $1 order by created_at, domain`,
      [run],
    );
    expect(rows.map((r) => r.domain).sort()).toEqual([
      "acme-a.example",
      "one.example",
      "three.example",
      "two.example",
    ]);
    expect(rows[0].website).toMatch(/^https:\/\/[a-z.-]+\/$/);
    // A's own prospect of the same domain is untouched.
    const [{ n }] = await db.admin<{ n: number }>(
      `select count(*)::int as n from prospects where domain = 'acme-a.example'`,
    );
    expect(n).toBe(2);
    await reset();
  });

  it("moves on after enough rounds, or when the search runs dry, and ends when nothing was found", async () => {
    let { run_id: run } = await startRun(W, search, dave);
    await claim(run!, W);
    expect(await addCandidates(run!, W, [{ domain: "a1.example" }])).toEqual({
      status: "searching",
      added: 1,
    });
    await claim(run!, W);
    expect((await addCandidates(run!, W, []))!.status).toBe("searching");
    await claim(run!, W);
    // Two dry rounds in a row.
    expect(
      (await addCandidates(run!, W, [{ domain: "a1.example" }]))!.status,
    ).toBe("researching");
    // Not searching any more: a late search result is ignored.
    expect(
      await addCandidates(run!, W, [{ domain: "late.example" }]),
    ).toBeNull();
    await reset();

    ({ run_id: run } = await startRun(W, search, dave));
    await claim(run!, W);
    expect(
      (await addCandidates(run!, W, [{ domain: "b1.example" }], {
        maxRounds: 1,
      }))!.status,
    ).toBe("researching");
    await reset();

    ({ run_id: run } = await startRun(W, search, dave));
    await claim(run!, W);
    await addCandidates(run!, W, []);
    await claim(run!, W);
    expect((await addCandidates(run!, W, []))!.status).toBe("done");
    const [row] = await db.admin<{ status: string; stop_reason: string }>(
      `select status, stop_reason from prospect_runs where id = $1`,
      [run],
    );
    expect(row).toEqual({ status: "done", stop_reason: "nothing_found" });
    await reset();
  });

  it("hands out companies two at a time, writes each once, and finishes", async () => {
    const { run_id: run } = await startRun(W, search, dave);
    await claim(run!, W);
    await addCandidates(
      run!,
      W,
      ["c1", "c2", "c3"].map((d) => ({ domain: `${d}.example` })),
      { maxRounds: 1 },
    );
    // Candidates stored together share a timestamp, and are then handed out
    // in no particular order. Space them out so this test can name them.
    await db.admin(
      `update prospects
       set created_at = created_at + right(split_part(domain, '.', 1), 1)::int * interval '1 second'
       where run_id = $1`,
      [run],
    );
    const first = await claim(run!, W);
    expect(first!.status).toBe("researching");
    expect(first!.work!.map((w) => w.domain)).toEqual([
      "c1.example",
      "c2.example",
    ]);
    expect(first!.known).toContain("c3.example");

    expect(
      await saveResearch(
        run!,
        W,
        first!.work![0].id,
        found({ email: "hello@c1.example" }),
      ),
    ).toBe("found");
    // The same result again changes nothing.
    expect(
      await saveResearch(
        run!,
        W,
        first!.work![0].id,
        found({ email: "other@c1.example", summary: "Changed" }),
      ),
    ).toBe("ignored");
    expect(
      await saveResearch(run!, W, first!.work![1].id, {
        status: "skipped",
        reason: "not_a_business",
      }),
    ).toBe("skipped");
    // A prospect of another run or workspace can't be written through this run.
    expect(await saveResearch(run!, W, a.prospect, found())).toBe("ignored");
    await service("prospect_run_release($1, $2)", [run, W]);

    const second = await claim(run!, W);
    expect(second!.work!.map((w) => w.domain)).toEqual(["c3.example"]);
    await saveResearch(run!, W, second!.work![0].id, found({ email: "" }));
    await service("prospect_run_release($1, $2)", [run, W]);
    expect((await claim(run!, W))!.status).toBe("done");
    expect((await claim(run!, W))!.status).toBe("done");

    const rows = await db.admin<Record<string, unknown>>(
      `select domain, research_status, skip_reason, email, email_source_url, email_kind, summary
       from prospects where run_id = $1 order by domain`,
      [run],
    );
    expect(rows).toEqual([
      {
        domain: "c1.example",
        research_status: "found",
        skip_reason: null,
        email: "hello@c1.example",
        email_source_url: "https://acme.example/contact",
        email_kind: "business",
        summary: "Makes anvils.",
      },
      {
        domain: "c2.example",
        research_status: "skipped",
        skip_reason: "not_a_business",
        email: null,
        email_source_url: null,
        email_kind: null,
        summary: "",
      },
      {
        domain: "c3.example",
        research_status: "found",
        skip_reason: null,
        email: null,
        email_source_url: null,
        email_kind: null,
        summary: "Makes anvils.",
      },
    ]);
    const [totals] = await db.admin<Record<string, unknown>>(
      `select searches_used, cost_micros::int as cost, steps from prospect_runs where id = $1`,
      [run],
    );
    // One search round (1000) and four research writes that were paid for.
    expect(totals).toEqual({
      searches_used: 1,
      cost: 1000 + 5 * 500,
      steps: 3,
    });
    await reset();
  });

  it("drops an email with no source, and skips suppressed addresses and existing leads", async () => {
    const { run_id: run } = await startRun(W, search, dave);
    await claim(run!, W);
    await addCandidates(
      run!,
      W,
      ["d1", "d2", "d3", "d4"].map((d) => ({ domain: `${d}.example` })),
      { maxRounds: 1 },
    );
    const save = async (result: Record<string, unknown>) => {
      const c = await claim(run!, W);
      const id = c!.work![0].id;
      const status = await saveResearch(run!, W, id, result);
      // Finish the other one of the pair too, so the next claim is fresh.
      if (c!.work![1])
        await saveResearch(run!, W, c!.work![1].id, { status: "retry" });
      await service("prospect_run_release($1, $2)", [run, W]);
      return { id, status };
    };
    const noSource = await save(
      found({ email: "x@d1.example", email_source_url: "" }),
    );
    expect(noSource.status).toBe("found");
    expect(
      await db.admin(
        `select email, email_source_url from prospects where id = $1`,
        [noSource.id],
      ),
    ).toEqual([{ email: null, email_source_url: null }]);

    expect((await save(found({ email: "stop@listed.example" }))).status).toBe(
      "skipped",
    );
    expect((await save(found({ email: "jo@known-mail.example" }))).status).toBe(
      "skipped",
    );
    const reasons = await db.admin<{ skip_reason: string }>(
      `select skip_reason from prospects where run_id = $1 and research_status = 'skipped' order by skip_reason`,
      [run],
    );
    expect(reasons.map((r) => r.skip_reason)).toEqual([
      "already_a_lead",
      "suppressed",
    ]);
    await reset();
  });

  it("carries on after a step that died, and gives up on a site after two tries", async () => {
    const { run_id: run } = await startRun(W, search, dave);
    await claim(run!, W);
    await addCandidates(run!, W, [{ domain: "e1.example" }], { maxRounds: 1 });
    // A step claims the company and never comes back.
    const lost = await claim(run!, W, { lease: 1 });
    expect(lost!.work).toHaveLength(1);
    expect((await claim(run!, W))!.status).toBe("busy");
    await db.admin(
      `update prospect_runs set locked_until = now() - interval '1 second' where id = $1`,
      [run],
    );
    // The lease ran out: the same company is handed out again.
    const again = await claim(run!, W);
    expect(again!.work!.map((w) => w.id)).toEqual(lost!.work!.map((w) => w.id));
    // That step dies too. Third time, the company is marked unreadable and the run ends.
    await db.admin(
      `update prospect_runs set locked_until = null where id = $1`,
      [run],
    );
    expect((await claim(run!, W))!.status).toBe("done");
    expect(
      await db.admin(
        `select research_status, skip_reason, attempts from prospects where run_id = $1`,
        [run],
      ),
    ).toEqual([
      { research_status: "failed", skip_reason: "unreadable", attempts: 2 },
    ]);
    await reset();
  });

  it("stops at the step limit, can be stopped, and a stopped run stays stopped", async () => {
    let { run_id: run } = await startRun(W, search, dave);
    expect((await claim(run!, W, { steps: 1 }))!.status).toBe("searching");
    await service("prospect_run_release($1, $2)", [run, W]);
    expect(await claim(run!, W, { steps: 1 })).toEqual({
      status: "stopped",
      stop_reason: "too_many_steps",
    });
    await reset();

    ({ run_id: run } = await startRun(W, search, dave));
    await claim(run!, W);
    await addCandidates(run!, W, [{ domain: "f1.example" }]);
    await service(
      "prospect_run_release($1, $2, 'stopped', 'stopped_by_user')",
      [run, W],
    );
    expect(await claim(run!, W)).toEqual({
      status: "stopped",
      stop_reason: "stopped_by_user",
    });
    await service("prospect_run_release($1, $2, 'failed', 'x')", [run, W]);
    expect((await claim(run!, W))!.status).toBe("stopped");
    // A later run takes over the company the stopped one never read.
    const next = await startRun(W, search, dave);
    await claim(next.run_id!, W);
    expect(
      await addCandidates(next.run_id!, W, [{ domain: "f1.example" }], {
        maxRounds: 1,
      }),
    ).toEqual({ status: "researching", added: 1 });
    expect((await claim(next.run_id!, W))!.work).toHaveLength(1);
    await reset();
  });

  it("counts the day's runs, searches and spend, and refuses past the caps", async () => {
    await db.admin(`delete from outbound_usage where workspace_id = $1`, [W]);
    const tight = { target: 25, runsPerDay: 2, spendPerDay: 5000 };
    const one = await startRun(W, search, dave, tight);
    await claim(one.run_id!, W);
    await addCandidates(one.run_id!, W, [], { searches: 3, cost: 2000 });
    await service(
      "prospect_run_release($1, $2, 'stopped', 'stopped_by_user')",
      [one.run_id, W],
    );
    const two = await startRun(W, search, dave, tight);
    expect(two.status).toBe("started");
    const c = await claim(two.run_id!, W);
    expect(c!.usage).toEqual({
      runs: 2,
      searches: 3,
      suggestions: 0,
      drafts: 0,
      cost_micros: 2000,
    });
    await service(
      "prospect_run_release($1, $2, 'stopped', 'stopped_by_user')",
      [two.run_id, W],
    );
    // The third run of the day is refused, and nothing is counted for it.
    expect(await startRun(W, search, dave, tight)).toEqual({
      status: "capped",
    });
    // So is a run once the day's spend is used up.
    await service("outbound_record_spend($1, 3000)", [W]);
    expect(
      await startRun(W, search, dave, { ...tight, runsPerDay: 10 }),
    ).toEqual({
      status: "capped",
    });
    const [usage] = await db.admin<Record<string, unknown>>(
      `select runs, searches, cost_micros::int as cost from outbound_usage where workspace_id = $1`,
      [W],
    );
    expect(usage).toEqual({ runs: 2, searches: 3, cost: 5000 });

    // Suggestions have their own cap.
    expect(
      await service("outbound_take_suggestion($1, $2, 2)", [W, dave]),
    ).toBe(true);
    expect(
      await service("outbound_take_suggestion($1, $2, 2)", [W, dave]),
    ).toBe(true);
    expect(
      await service("outbound_take_suggestion($1, $2, 2)", [W, dave]),
    ).toBe(false);
    await reset();
    await db.admin(`delete from outbound_usage where workspace_id = $1`, [W]);
  });
});

describe("keeping, adding to leads and first emails", () => {
  let W: string;
  let erin: string;
  let frank: string; // a member, not an admin
  let search: string;
  const p: Record<string, string> = {};

  beforeAll(async () => {
    erin = await db.createUser("erin@x.example", "Erin Jones");
    frank = await db.createUser("frank@x.example", "Frank");
    [{ id: W }] = await db.user(erin)<{ id: string }>(
      `select create_workspace('Workspace X', 'UTC', 'x.example', 'We sell X') as id`,
    );
    await db.admin(
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
      [W, frank],
    );
    await db.admin(
      `update agents set instructions = 'Keep it short.' where workspace_id = $1 and role = 'outbound'`,
      [W],
    );
    [{ id: search }] = await db.user(erin)<{ id: string }>(
      `insert into prospect_searches (workspace_id, name, description, created_by)
       values ($1, 'S', 'Anyone', $2) returning id`,
      [W, erin],
    );
    const { run_id: run } = await startRun(W, search, erin);
    await claim(run!, W);
    const names = [
      "withmail",
      "nomail",
      "phoneonly",
      "nothing",
      "existing",
      "removed",
    ];
    await addCandidates(
      run!,
      W,
      names.map((n) => ({ domain: `${n}.example`, company_name: n })),
      { maxRounds: 1 },
    );
    for (;;) {
      const c = await claim(run!, W);
      if (c!.status !== "researching") break;
      for (const w of c!.work!) {
        const name = w.domain.split(".")[0];
        p[name] = w.id;
        await saveResearch(
          run!,
          W,
          w.id,
          found({
            company_name: name,
            website: `https://${w.domain}/`,
            email: ["withmail", "existing", "removed"].includes(name)
              ? `hello@${w.domain}`
              : "",
            phone:
              name === "nomail" || name === "nothing" ? "" : "+441130000000",
            contact_name: name === "nothing" ? "" : "Dana Smith",
          }),
        );
      }
      await service("prospect_run_release($1, $2)", [run, W]);
    }
    // 'nomail' has a phone-less, email-less record but a contact name.
  });

  it("adds kept prospects to leads with their research, links known addresses, and leaves the rest", async () => {
    await db.admin(
      `insert into leads (workspace_id, name, email) values ($1, 'Already here', 'hello@existing.example')`,
      [W],
    );
    await db.user(frank)(
      `update prospects set decision = 'kept' where id = any($1::uuid[])`,
      [[p.withmail, p.phoneonly, p.nothing, p.existing, p.nomail]],
    );
    await db.user(frank)(
      `update prospects set decision = 'removed' where id = $1`,
      [p.removed],
    );
    // Someone from another workspace can't do it for them.
    await expect(
      db.user(bob)(`select prospects_add_to_leads($1)`, [W]),
    ).rejects.toThrow(/workspace not found/);

    const [{ r }] = await db.user(frank)<{ r: Record<string, number> }>(
      `select prospects_add_to_leads($1, $2) as r`,
      [W, search],
    );
    expect(r).toEqual({ added: 2, linked: 1, no_contact: 2 });
    const leads = await db.admin<Record<string, unknown>>(
      `select l.name, l.email, l.phone, l.company, l.website, l.source, l.consent_email,
              l.custom_fields -> 'research' ->> 'summary' as summary,
              l.custom_fields -> 'research' ->> 'email_source_url' as email_source
       from leads l where l.workspace_id = $1 and l.source = 'found by Dialvo' order by l.company`,
      [W],
    );
    expect(leads).toEqual([
      {
        name: "Dana Smith",
        email: null,
        phone: "+441130000000",
        company: "phoneonly",
        website: "https://phoneonly.example/",
        source: "found by Dialvo",
        consent_email: false,
        summary: "Makes anvils.",
        email_source: null,
      },
      {
        name: "Dana Smith",
        email: "hello@withmail.example",
        phone: "+441130000000",
        company: "withmail",
        website: "https://withmail.example/",
        source: "found by Dialvo",
        consent_email: false,
        summary: "Makes anvils.",
        email_source: "https://acme.example/contact",
      },
    ]);
    const [event] = await db.admin<{ summary: string; actor_id: string }>(
      `select e.summary, e.actor_id from activity_events e
       join leads l on l.id = e.lead_id where l.email = 'hello@withmail.example'`,
    );
    expect(event.actor_id).toBe(frank);
    expect(event.summary).toContain("Found by Dialvo");
    expect(event.summary).toContain(
      "They have made anvils since 1950. (https://acme.example/about)",
    );
    // Doing it again adds nothing.
    const [{ r: again }] = await db.user(frank)<{ r: Record<string, number> }>(
      `select prospects_add_to_leads($1) as r`,
      [W],
    );
    expect(again).toEqual({ added: 0, linked: 0, no_contact: 2 });
  });

  it("drafts only for kept prospects with an email, once each, within the day's cap", async () => {
    await db.admin(`delete from outbound_usage where workspace_id = $1`, [W]);
    const none = await claimDrafts(W, erin, 3, 0);
    expect(none!.drafts).toEqual([]);
    expect(none!.capped).toBe(true);
    expect(none!.remaining).toBe(2);

    const first = await claimDrafts(W, erin, 1);
    expect(first!.drafts.map((d) => d.prospect.company_name)).toEqual([
      "withmail",
    ]);
    expect(first!.remaining).toBe(1);
    expect(first!.context.sender_name).toBe("Erin Jones");
    expect(first!.context.instructions).toBe("Keep it short.");
    expect(first!.context.knowledge.length).toBeGreaterThan(0);
    // A second caller at the same moment gets the other one, never the same.
    const second = await claimDrafts(W, frank, 3);
    expect(second!.drafts.map((d) => d.prospect.company_name)).toEqual([
      "existing",
    ]);
    expect((await claimDrafts(W, erin, 3))!.drafts).toEqual([]);

    p.draftA = first!.drafts[0].draft_id;
    p.draftB = second!.drafts[0].draft_id;
    expect(await saveDraft(W, p.draftA)).toBe("draft");
    expect(await saveDraft(W, p.draftA)).toBe("ignored");
    expect(await saveDraft(W, p.draftB, false)).toBe("failed");
    // A failed one is tried once more, then left.
    const retry = await claimDrafts(W, erin, 3);
    expect(retry!.drafts.map((d) => d.draft_id)).toEqual([p.draftB]);
    expect(await saveDraft(W, p.draftB)).toBe("draft");
    const [usage] = await db.admin<Record<string, unknown>>(
      `select drafts, cost_micros::int as cost from outbound_usage where workspace_id = $1`,
      [W],
    );
    expect(usage).toEqual({ drafts: 3, cost: 4 * 700 });
    // Another workspace's draft can't be written with this workspace's id.
    expect(await saveDraft(W, a.draft)).toBe("ignored");
  });

  it("lets a teammate edit, approve, reopen and discard, and nobody else", async () => {
    await expect(
      db.user(bob)(`select outbound_draft_decide($1, 'approve')`, [p.draftA]),
    ).rejects.toThrow(/draft not found/);
    await expect(
      db.user(carol)(`select outbound_draft_decide($1, 'discard')`, [p.draftA]),
    ).rejects.toThrow(/draft not found/);
    expect(
      (
        await db.user(bob)<{ n: number }>(
          `select outbound_drafts_approve($1::uuid[]) as n`,
          [[p.draftA, p.draftB]],
        )
      )[0].n,
    ).toBe(0);

    const decide = async (
      id: string,
      action: string,
      subject?: string,
      body?: string,
    ) =>
      (
        await db.user(frank)<{ r: string }>(
          `select outbound_draft_decide($1, $2, $3, $4) as r`,
          [id, action, subject ?? null, body ?? null],
        )
      )[0].r;
    expect(
      await decide(p.draftA, "save", "A better\nsubject", "Hello,\n\nEdited."),
    ).toBe("draft");
    expect(await decide(p.draftA, "approve")).toBe("approved");
    expect(
      await db.admin(
        `select subject, body, status, edited, decided_by from outbound_drafts where id = $1`,
        [p.draftA],
      ),
    ).toEqual([
      {
        subject: "A better subject",
        body: "Hello,\n\nEdited.",
        status: "approved",
        edited: true,
        decided_by: frank,
      },
    ]);
    expect(await decide(p.draftA, "reopen")).toBe("draft");
    await expect(decide(p.draftA, "send")).rejects.toThrow(/unknown action/);
    await expect(
      decide(p.draftA, "save", "s", "x".repeat(5001)),
    ).rejects.toThrow(/too long/);
    const [{ n }] = await db.user(frank)<{ n: number }>(
      `select outbound_drafts_approve($1::uuid[]) as n`,
      [[p.draftA, p.draftB, a.draft]],
    );
    expect(n).toBe(2);
    // Approving stores it as ready to send. Nothing is sent: no message exists.
    const [{ m }] = await db.admin<{ m: number }>(
      `select count(*)::int as m from messages where workspace_id = $1`,
      [W],
    );
    expect(m).toBe(0);
    expect(await decide(p.draftB, "discard")).toBe("discarded");
    await expect(decide(p.draftB, "approve")).rejects.toThrow(
      /draft not found/,
    );
    // One first email per prospect: a discarded one isn't written again.
    expect((await claimDrafts(W, erin, 3))!.drafts).toEqual([]);
  });

  it("honours the suppression list and do not contact, at once and afterwards", async () => {
    // draftA (withmail.example) is approved, ready to send.
    await db.user(frank)(
      `insert into outbound_suppressions (workspace_id, kind, value, created_by) values ($1, 'domain', 'withmail.example', $2)`,
      [W, frank],
    );
    expect(
      await db.admin(
        `select status, discard_reason from outbound_drafts where id = $1`,
        [p.draftA],
      ),
    ).toEqual([{ status: "discarded", discard_reason: "suppressed" }]);
    // B's draft to a different domain is untouched.
    expect(
      await db.admin(`select status from outbound_drafts where id = $1`, [
        b.draft,
      ]),
    ).toEqual([{ status: "draft" }]);

    // A fresh prospect at a suppressed address gets no draft, and can't be approved.
    const { run_id: run } = await startRun(W, search, erin);
    await claim(run!, W);
    await addCandidates(
      run!,
      W,
      [{ domain: "later.example" }, { domain: "dnc.example" }],
      { maxRounds: 1 },
    );
    const c = await claim(run!, W);
    for (const w of c!.work!)
      await saveResearch(run!, W, w.id, found({ email: `hello@${w.domain}` }));
    await service("prospect_run_release($1, $2)", [run, W]);
    await db.user(erin)(
      `update prospects set decision = 'kept' where run_id = $1`,
      [run],
    );
    const drafts = await claimDrafts(W, erin, 3);
    expect(drafts!.drafts).toHaveLength(2);
    for (const d of drafts!.drafts) await saveDraft(W, d.draft_id);
    const idOf = async (domain: string) =>
      (
        await db.admin<{ id: string }>(
          `select d.id from outbound_drafts d join prospects p on p.id = d.prospect_id where p.domain = $1`,
          [domain],
        )
      )[0].id;
    const later = await idOf("later.example");
    const dnc = await idOf("dnc.example");

    // The lead for dnc.example is marked do not contact.
    await db.user(erin)(`select prospects_add_to_leads($1)`, [W]);
    await db.admin(
      `update leads set do_not_contact = true where workspace_id = $1 and email = 'hello@dnc.example'`,
      [W],
    );
    await expect(
      db.user(erin)(`select outbound_draft_decide($1, 'approve')`, [dnc]),
    ).rejects.toThrow(/do not contact/);
    const [{ n }] = await db.user(erin)<{ n: number }>(
      `select outbound_drafts_approve($1::uuid[]) as n`,
      [[dnc]],
    );
    expect(n).toBe(0);

    // An admin takes an address off the list by hand; with it on, approving is refused.
    await db.admin(
      `insert into outbound_suppressions (workspace_id, kind, value) values ($1, 'email', 'hello@later.example')`,
      [W],
    );
    expect(
      await db.admin(`select status from outbound_drafts where id = $1`, [
        later,
      ]),
    ).toEqual([{ status: "discarded" }]);
    await db.admin(
      `update outbound_drafts set status = 'draft', discard_reason = null where id = $1`,
      [later],
    );
    await expect(
      db.user(erin)(`select outbound_draft_decide($1, 'approve')`, [later]),
    ).rejects.toThrow(/suppression list/);
  });
});
