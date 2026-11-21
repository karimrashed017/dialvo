import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { DATA_TABLES } from "./data-tables";

// Lists, research columns, recipes, scoring and tiers, accounts and
// territories, audiences, enrichment and sourcing, proved against the real
// migrations: one workspace can't see or change another's rows; writes go
// only through the functions, which check who is asking; the day's caps are
// checked and reserved before anything runs; enrichment only fills what is
// empty; routing gives a lead to its account's owner, then its territory,
// then the rules; and a playbook started on chosen leads keeps every rule.

const DENIED = /row-level security|permission denied/;

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

const as = (user: string) => db.user(user);
const one = async <T = string>(
  user: string,
  sql: string,
  params: unknown[] = [],
) => (await as(user)<{ r: T }>(`select ${sql} as r`, params))[0].r;

const addLead = async (ws: string, fields: Record<string, unknown>) => {
  const cols = Object.keys(fields);
  const [{ id }] = await db.admin<{ id: string }>(
    `insert into leads (workspace_id, ${cols.join(", ")}) values ($1, ${cols
      .map((_, i) => `$${i + 2}`)
      .join(", ")}) returning id`,
    [ws, ...Object.values(fields)],
  );
  return id;
};

const newList = (user: string, ws: string, kind = "companies", name = "Gyms") =>
  one(user, `data_list_save($1, null, $2, $3, 'manual', false, 50)`, [
    ws,
    name,
    kind,
  ]);

const QUEUE = (
  ws: string,
  user: string,
  list: string,
  columns: string[],
  rows: string[] | null,
  opts: {
    dry?: boolean;
    rerun?: boolean;
    cells?: number;
    micros?: number;
    credits?: number;
  } = {},
) =>
  service<Record<string, number | string>>(
    `data_cells_queue($1, $2, $3, $4::uuid[], $5::uuid[], $6, $7, 100, $8, $9, $10, 40000, '{"work_email": 1, "title": 2}'::jsonb)`,
    [
      ws,
      user,
      list,
      columns,
      rows,
      opts.rerun ?? false,
      opts.dry ?? false,
      opts.cells ?? 150,
      opts.micros ?? 5_000_000,
      opts.credits ?? 200,
    ],
  );

let listA: string;
let listB: string;
let rowB: string;
let colA: string;
let colB: string;

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.createUser("alice@a.example", "Alice");
  amy = await db.createUser("amy@a.example", "Amy");
  bob = await db.createUser("bob@b.example", "Bob");
  [{ id: A }] = await as(alice)<{ id: string }>(
    `select create_workspace('Agency A', 'UTC', 'agency-a.example', 'We sell A') as id`,
  );
  [{ id: B }] = await as(bob)<{ id: string }>(
    `select create_workspace('Agency B', 'UTC', null, 'We sell B') as id`,
  );
  await db.admin(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
    [A, amy],
  );
  listA = await newList(alice, A);
  listB = await newList(bob, B);
  await one(alice, `data_rows_add($1, $2, $3::jsonb, 2000)`, [
    A,
    listA,
    JSON.stringify([
      { company: "Harbor Fitness", domain: "harbor.example", country: "GB" },
      { company: "Peak Climbing", website: "https://www.peak.example/about" },
    ]),
  ]);
  await one(bob, `data_rows_add($1, $2, $3::jsonb, 2000)`, [
    B,
    listB,
    JSON.stringify([{ company: "B's secret", domain: "secret-b.example" }]),
  ]);
  [{ id: rowB }] = await db.admin<{ id: string }>(
    `select id from data_list_rows where list_id = $1`,
    [listB],
  );
  colA = await one(
    alice,
    `data_column_save($1, $2, null, 'Has a café', 'research', 'Does this gym have a café?', 'yes_no', '[]'::jsonb, null, null, 20)`,
    [A, listA],
  );
  colB = await one(
    bob,
    `data_column_save($1, $2, null, 'Secret', 'research', 'Is this secret?', 'yes_no', '[]'::jsonb, null, null, 20)`,
    [B, listB],
  );
  // One row of every new table in B, made the way the app makes them.
  await QUEUE(B, bob, listB, [colB], null);
  await one(
    bob,
    `data_recipe_save($1, null, 'B recipe', 'companies', 'Is this secret?', 'yes_no', '[]'::jsonb, 50)`,
    [B],
  );
  await one(
    bob,
    `territory_save($1, null, 'B land', 0, '["DE"]'::jsonb, '[]'::jsonb, null, null, $2::uuid[])`,
    [B, [bob]],
  );
  await one(bob, `accounts_from_list($1, $2, 1000)`, [B, listB]);
  await one(
    bob,
    `scoring_save($1, '{"countries": ["DE"]}'::jsonb, null, 1, 70, 40, 40, 100)`,
    [B],
  );
  await one(bob, `audience_save($1, null, 'B tier 1', '{"tiers": [1]}', 50)`, [
    B,
  ]);
  await one(
    bob,
    `enrichment_save($1, true, true, true, true, true, true, true, 30, 100, 1000)`,
    [B],
  );
  const leadB = await addLead(B, {
    name: "Bea",
    email: "bea@secret-b.example",
  });
  await db.admin(
    `insert into lead_enrichment (lead_id, workspace_id, status) values ($1, $2, 'done') on conflict (lead_id) do nothing`,
    [leadB, B],
  );
  await db.admin(
    `insert into enrichment_events (workspace_id, lead_id, kind, summary) values ($1, $2, 'filled', 'B secret')`,
    [B, leadB],
  );
  await db.admin(
    `insert into enrichment_usage (workspace_id, month) values ($1, date_trunc('month', now())::date) on conflict do nothing`,
    [B],
  );
  const [{ id: searchB }] = await db.admin<{ id: string }>(
    `insert into prospect_searches (workspace_id, name, description) values ($1, 's', 'd') returning id`,
    [B],
  );
  await one(bob, `sourcing_save($1, null, $2, $3, null, 7, true, 3)`, [
    B,
    searchB,
    listB,
  ]);
});

afterAll(async () => {
  await db.close();
});

describe("isolation", () => {
  it("has a row of B in every new table", async () => {
    for (const t of DATA_TABLES) {
      const [{ n }] = await db.admin<{ n: number }>(
        `select count(*)::int as n from ${t} where workspace_id = $1`,
        [B],
      );
      expect(n, t).toBeGreaterThan(0);
    }
  });

  it("shows A nothing of B, and lets nobody write a table directly", async () => {
    for (const t of DATA_TABLES) {
      for (const user of [alice, amy]) {
        const rows = await as(user)(
          `select * from ${t} where workspace_id = $1`,
          [B],
        );
        expect(rows, t).toEqual([]);
      }
      // Bob can read his own, but not write even that directly.
      expect(
        (await as(bob)(`select 1 from ${t} where workspace_id = $1`, [B]))
          .length,
        t,
      ).toBeGreaterThan(0);
      await expect(
        as(bob)(`delete from ${t} where workspace_id = $1`, [B]),
        t,
      ).rejects.toThrow(DENIED);
      await expect(
        as(alice)(`update ${t} set workspace_id = $1 where workspace_id = $2`, [
          A,
          B,
        ]),
        t,
      ).rejects.toThrow(DENIED);
    }
  });

  it("refuses every function on another workspace's rows", async () => {
    await expect(
      one(
        alice,
        `data_rows_add($1, $2, '[{"company": "x", "domain": "x.example"}]'::jsonb, 2000)`,
        [B, listB],
      ),
    ).rejects.toThrow(/not a member/);
    await expect(
      one(
        alice,
        `data_rows_add($1, $2, '[{"company": "x", "domain": "x.example"}]'::jsonb, 2000)`,
        [A, listB],
      ),
    ).rejects.toThrow(/list not found/);
    await expect(
      one(
        alice,
        `data_column_save($1, $2, null, 'x', 'data', null, null, '[]'::jsonb, 'work_email', null, 20)`,
        [A, listB],
      ),
    ).rejects.toThrow(/list not found/);
    await expect(
      one(alice, `data_column_delete($1, $2)`, [A, colB]),
    ).rejects.toThrow(/column not found/);
    expect(
      await one(alice, `data_rows_delete($1, $2, $3::uuid[])`, [
        A,
        listB,
        [rowB],
      ]),
    ).toBe(0);
    expect(
      await one(alice, `data_rows_to_leads($1, $2, $3::uuid[])`, [
        A,
        listB,
        [rowB],
      ]),
    ).toMatchObject({ added: 0 });
    expect(await QUEUE(A, alice, listB, [colB], null)).toEqual({
      status: "not_found",
    });
    expect(await QUEUE(B, alice, listB, [colB], null)).toEqual({
      status: "not_found",
    });
    await expect(
      one(alice, `audience_lead_ids($1, null, '{}'::jsonb, 10)`, [B]),
    ).rejects.toThrow(/not a member/);
    // The service-only functions can't be called by a signed-in person.
    await expect(as(bob)(`select data_cells_claim(10, 60, 2)`)).rejects.toThrow(
      DENIED,
    );
    await expect(
      as(bob)(`select enrichment_claim(10, 60, 2, 3)`),
    ).rejects.toThrow(DENIED);
    await expect(as(bob)(`select sourcing_claim(10, 60)`)).rejects.toThrow(
      DENIED,
    );
  });

  it("lets only owners and admins change scoring, territories, enrichment and sourcing", async () => {
    await expect(
      one(amy, `scoring_save($1, '{}'::jsonb, null, 1, 70, 40, 40, 0)`, [A]),
    ).rejects.toThrow(/owner or admin/);
    await expect(
      one(
        amy,
        `territory_save($1, null, 'T', 0, '[]'::jsonb, '[]'::jsonb, null, null, $2::uuid[])`,
        [A, [amy]],
      ),
    ).rejects.toThrow(/owner or admin/);
    await expect(
      one(
        amy,
        `enrichment_save($1, true, true, true, true, true, true, true, 30, 100, 1000)`,
        [A],
      ),
    ).rejects.toThrow(/owner or admin/);
    // Nobody from another workspace can be a rep.
    await expect(
      one(
        alice,
        `territory_save($1, null, 'T', 0, '[]'::jsonb, '[]'::jsonb, null, null, $2::uuid[])`,
        [A, [bob]],
      ),
    ).rejects.toThrow(/must be in the workspace/);
  });
});

describe("lists", () => {
  it("dedupes rows by domain and caps the list", async () => {
    const r = await one<Record<string, unknown>>(
      alice,
      `data_rows_add($1, $2, $3::jsonb, 3)`,
      [
        A,
        listA,
        JSON.stringify([
          { company: "Harbor again", domain: "HARBOR.example" },
          { company: "Third", domain: "third.example" },
          { company: "Fourth", domain: "fourth.example" },
        ]),
      ],
    );
    expect(r).toEqual({ added: 1, skipped: 2, full: true });
    const rows = await db.admin<{ domain: string }>(
      `select domain from data_list_rows where list_id = $1 order by position`,
      [listA],
    );
    expect(rows.map((x) => x.domain)).toEqual([
      "harbor.example",
      "peak.example",
      "third.example",
    ]);
  });

  it("checks the day's caps before queuing, and reserves the estimate", async () => {
    const est = await QUEUE(A, amy, listA, [colA], null, { dry: true });
    expect(est).toMatchObject({
      status: "estimate",
      cells: 3,
      research: 3,
      micros: 120000,
    });
    expect(
      await QUEUE(A, amy, listA, [colA], null, { micros: 100000 }),
    ).toMatchObject({ status: "capped" });
    expect(
      await QUEUE(A, amy, listA, [colA], null, { cells: 2 }),
    ).toMatchObject({ status: "capped" });
    expect(await QUEUE(A, amy, listA, [colA], null)).toMatchObject({
      status: "queued",
      cells: 3,
    });
    const [u] = await db.admin(
      `select research_cells, model_micros from data_usage where workspace_id = $1`,
      [A],
    );
    expect(u).toEqual({ research_cells: 3, model_micros: 120000 });
    // Queued cells aren't queued twice.
    expect(await QUEUE(A, amy, listA, [colA], null)).toMatchObject({
      status: "empty",
    });
  });

  it("claims under a lease, finishes once, and settles the spend", async () => {
    const claimed = await service<
      {
        workspace_id: string;
        row_id: string;
        column_id: string;
        row: { domain: string };
        column: { question: string };
      }[]
    >(`data_cells_claim(10, 60, 2)`);
    const mine = claimed.filter((c) => c.workspace_id === A);
    expect(mine).toHaveLength(3);
    expect(mine[0].column.question).toBe("Does this gym have a café?");
    const c = mine[0];
    expect(
      await service(
        `data_cell_finish($1, $2, $3, 'done', 'true'::jsonb, 'Yes', 'https://harbor.example/cafe', 'The menu page says so.', 30000, 0, null)`,
        [A, c.row_id, c.column_id],
      ),
    ).toBe("done");
    // A repeated finish changes nothing.
    expect(
      await service(
        `data_cell_finish($1, $2, $3, 'done', 'false'::jsonb, 'No', null, '', 30000, 0, null)`,
        [A, c.row_id, c.column_id],
      ),
    ).toBe("ignored");
    const [u] = await db.admin(
      `select model_micros from data_usage where workspace_id = $1`,
      [A],
    );
    expect(u.model_micros).toBe(110000);
    for (const x of mine.slice(1))
      await service(
        `data_cell_finish($1, $2, $3, 'skipped', null, '', null, 'No website.', 0, 0, null)`,
        [A, x.row_id, x.column_id],
      );
    const [v] = await db.admin(
      `select model_micros from data_usage where workspace_id = $1`,
      [A],
    );
    expect(v.model_micros).toBe(30000);
  });

  it("saves a column as a recipe, and sends rows to leads", async () => {
    const recipe = await one(alice, `data_recipe_from_column($1, $2, 50)`, [
      A,
      colA,
    ]);
    expect(
      await one(alice, `data_recipe_from_column($1, $2, 50)`, [A, colA]),
    ).toBe(recipe);
    const rows = await db.admin<{ id: string }>(
      `select id from data_list_rows where list_id = $1 order by position`,
      [listA],
    );
    const r = await one<{ added: number; lead_ids: string[] }>(
      amy,
      `data_rows_to_leads($1, $2, $3::uuid[])`,
      [A, listA, rows.map((x) => x.id)],
    );
    expect(r.added).toBe(3);
    const [lead] = await db.admin(
      `select company, website, source from leads where id = $1`,
      [r.lead_ids[0]],
    );
    expect(lead).toEqual({
      company: "Harbor Fitness",
      website: "https://harbor.example",
      source: "list",
    });
  });
});

describe("scoring, tiers and routing", () => {
  it("scores fit from the rules and engagement from what people did", async () => {
    await one(
      alice,
      `scoring_save($1, '{"countries": ["GB"], "titles": ["founder"]}'::jsonb, null, 1, 70, 40, 40, 100)`,
      [A],
    );
    const lead = await addLead(A, {
      name: "Pat",
      email: "pat@harbor.example",
      custom_fields: JSON.stringify({ country: "GB", title: "Co-Founder" }),
    });
    const [l] = await db.admin(
      `select fit_score, engagement_score, tier from leads where id = $1`,
      [lead],
    );
    expect(l).toEqual({ fit_score: 100, engagement_score: 0, tier: 2 });
    const [{ id: conv }] = await db.admin<{ id: string }>(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'email') returning id`,
      [A, lead],
    );
    await db.admin(
      `insert into messages (workspace_id, conversation_id, direction, author, body, delivery_status) values ($1, $2, 'in', 'lead', 'Hi', 'received')`,
      [A, conv],
    );
    await db.admin(`select private.score_lead($1, $2)`, [A, lead]);
    const [m] = await db.admin(
      `select engagement_score, tier from leads where id = $1`,
      [lead],
    );
    expect(m).toEqual({ engagement_score: 25, tier: 1 });
  });

  it("routes to the account's owner, then a territory's rep, then tier rules", async () => {
    // Harbor is a target account owned by Amy.
    await one(alice, `accounts_from_list($1, $2, 1000)`, [A, listA]);
    const [{ id: harbor }] = await db.admin<{ id: string }>(
      `select id from accounts where workspace_id = $1 and domain = 'harbor.example'`,
      [A],
    );
    await one(alice, `account_set_owner($1, $2, $3)`, [A, harbor, amy]);
    const atHarbor = await addLead(A, {
      name: "Hal",
      email: "hal@harbor.example",
    });
    const [h] = await db.admin(
      `select owner_id, account_id from leads where id = $1`,
      [atHarbor],
    );
    expect(h).toEqual({ owner_id: amy, account_id: harbor });

    await one(
      alice,
      `territory_save($1, null, 'France', 0, '["FR", "France"]'::jsonb, '[]'::jsonb, null, null, $2::uuid[])`,
      [A, [alice]],
    );
    const french = await addLead(A, {
      name: "Zoé",
      email: "zoe@paris.example",
      custom_fields: JSON.stringify({ country: "France" }),
    });
    expect(
      (await db.admin(`select owner_id from leads where id = $1`, [french]))[0],
    ).toEqual({ owner_id: alice });

    await one(
      alice,
      `routing_rule_save($1, null, 'Tier 1 to Amy', true, 0, '{"tiers": [1]}'::jsonb, 'one', $2::uuid[])`,
      [A, [amy]],
    );
    await expect(
      one(
        alice,
        `routing_rule_save($1, null, 'Bad', true, 0, '{"tiers": [4]}'::jsonb, 'one', $2::uuid[])`,
        [A, [amy]],
      ),
    ).rejects.toThrow(/out of range/);
    const nowhere = await addLead(A, { name: "Nia", email: "nia@x.example" });
    // Fit 0 of 2, no engagement: tier 3, so the tier 1 rule doesn't take it.
    expect(
      (
        await db.admin(`select owner_id, tier from leads where id = $1`, [
          nowhere,
        ])
      )[0],
    ).toEqual({ owner_id: null, tier: 3 });
  });

  it("balances accounts across a territory's reps", async () => {
    const t = await one(
      alice,
      `territory_save($1, null, 'Everywhere', 5, '[]'::jsonb, '[]'::jsonb, null, null, $2::uuid[])`,
      [A, [alice, amy]],
    );
    expect(t).toBeTruthy();
    const r = await one<Record<string, number>>(
      alice,
      `territories_assign($1, 'count', true)`,
      [A],
    );
    expect(r.accounts).toBe(3);
    const owners = await db.admin<{ owner_id: string }>(
      `select owner_id from accounts where workspace_id = $1`,
      [A],
    );
    const counts = new Map<string, number>();
    for (const o of owners)
      counts.set(o.owner_id, (counts.get(o.owner_id) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([1, 2]);
  });
});

describe("audiences and playbooks", () => {
  it("matches leads on tiers, scores and list membership, always up to date", async () => {
    const all = await one<string[]>(
      amy,
      `audience_lead_ids($1, null, '{"tiers": [1]}'::jsonb, 100)`,
      [A],
    );
    expect(all.length).toBeGreaterThan(0);
    const onList = await one<string[]>(
      amy,
      `audience_lead_ids($1, null, $2::jsonb, 100)`,
      [A, JSON.stringify({ list_id: listA })],
    );
    const domains = await db.admin<{
      email: string | null;
      website: string | null;
    }>(`select email, website from leads where id = any($1::uuid[])`, [onList]);
    expect(domains.length).toBeGreaterThanOrEqual(3);
    await expect(
      one(amy, `audience_save($1, null, 'Bad', '{"tiers": [7]}'::jsonb, 50)`, [
        A,
      ]),
    ).rejects.toThrow(/out of range/);
  });

  it("starts a playbook on chosen leads, keeping the playbook's rules", async () => {
    const [{ id: pb }] = await db.admin<{ id: string }>(
      `insert into playbooks (workspace_id, name, goal, filters) values ($1, 'Tier 1 hello', 'Say hello', '{"tiers": [1]}') returning id`,
      [A],
    );
    const leads = await db.admin<{
      id: string;
      tier: number;
      email: string | null;
    }>(`select id, tier, email from leads where workspace_id = $1`, [A]);
    const r = await service<{
      status: string;
      selected: number;
      left_out: number;
    }>(`playbook_start_for($1, $2, $3, $4::uuid[], 50, 'From a list')`, [
      A,
      amy,
      pb,
      leads.map((l) => l.id),
    ]);
    const eligible = leads.filter((l) => l.tier === 1 && l.email);
    expect(r.status).toBe("created");
    expect(r.selected).toBe(eligible.length);
    expect(r.left_out).toBe(leads.length - eligible.length);
    expect(
      await service(`playbook_start_for($1, $2, $3, $4::uuid[], 50, '')`, [
        A,
        bob,
        pb,
        leads.map((l) => l.id),
      ]),
    ).toEqual({ status: "not_found" });
  });
});

describe("enrichment", () => {
  it("queues due leads, reserves credits, and fills only what is empty", async () => {
    await db.admin(
      `insert into crm_connections (workspace_id, provider) values ($1, 'hubspot')`,
      [A],
    );
    await one(
      alice,
      `enrichment_save($1, true, true, true, true, true, true, true, 30, 100, 1000)`,
      [A],
    );
    const lead = await addLead(A, {
      name: "Sam",
      email: "sam@gmail.com",
      custom_fields: JSON.stringify({ title: "Owner" }),
    });
    expect(
      await one(alice, `enrichment_check_now($1, false, 500)`, [A]),
    ).toBeGreaterThan(0);
    const claimed = await service<{ lead_id: string; reserved: number }[]>(
      `enrichment_claim(50, 60, 2, 3)`,
    );
    const mine = claimed.find((c) => c.lead_id === lead)!;
    expect(mine.reserved).toBe(3);
    expect(
      await service(
        `enrichment_finish($1, $2, 'done', $3::jsonb, $4::jsonb, $5::jsonb, 2, 3, 30, null)`,
        [
          A,
          lead,
          JSON.stringify({
            title: "Head of Ops",
            work_email: "sam@samco.example",
            company: "SamCo",
            website: "https://samco.example",
          }),
          JSON.stringify({
            email_status: "valid",
            profile_title: "Head of Ops",
          }),
          JSON.stringify([
            { kind: "work_email", summary: "Found Sam's work email at SamCo." },
          ]),
        ],
      ),
    ).toBe("done");
    const [l] = await db.admin(
      `select email, company, website, custom_fields from leads where id = $1`,
      [lead],
    );
    expect(l).toMatchObject({
      email: "sam@gmail.com",
      company: "SamCo",
      website: "https://samco.example",
      custom_fields: { title: "Owner", work_email: "sam@samco.example" },
    });
    const jobs = await db.admin(
      `select kind from crm_sync_jobs where workspace_id = $1 and lead_id = $2 and kind = 'enrichment'`,
      [A, lead],
    );
    expect(jobs).toHaveLength(1);
    const claimedJobs = await service<
      { kind: string; detail: { type: string; summary: string } }[]
    >(`crm_jobs_claim(50, 60, 3, $1)`, [A]);
    const job = claimedJobs.find((j) => j.kind === "enrichment")!;
    expect(job.detail).toMatchObject({
      type: "enrichment",
      summary: "Found Sam's work email at SamCo.",
    });
  });

  it("stops at the month's cap", async () => {
    // 100 a month and 98 used: a lead's 3 won't fit.
    await db.admin(
      `update enrichment_usage set credits = 98 where workspace_id = $1`,
      [A],
    );
    await addLead(A, { name: "Late", email: "late@late.example" });
    await one(alice, `enrichment_check_now($1, true, 500)`, [A]);
    const claimed = await service<{ workspace_id: string }[]>(
      `enrichment_claim(50, 60, 2, 3)`,
    );
    expect(claimed.filter((c) => c.workspace_id === A)).toEqual([]);
  });
});

describe("sourcing and the scheduler", () => {
  it("adds a finished run's new companies to the list, and waits a week", async () => {
    const list = await newList(alice, A, "companies", "Market");
    const [{ id: search }] = await db.admin<{ id: string }>(
      `insert into prospect_searches (workspace_id, name, description) values ($1, 's', 'd') returning id`,
      [A],
    );
    await expect(
      one(amy, `sourcing_save($1, null, $2, $3, null, 7, true, 3)`, [
        A,
        search,
        list,
      ]),
    ).rejects.toThrow(/owner or admin/);
    const sched = await one(
      alice,
      `sourcing_save($1, null, $2, $3, null, 7, true, 3)`,
      [A, search, list],
    );
    expect(await db.admin(`select private.data_due_work() as w`)).toEqual([
      { w: expect.arrayContaining(["source"]) },
    ]);
    const claimed = await service<{ id: string; user_id: string }[]>(
      `sourcing_claim(10, 60)`,
    );
    expect(claimed.find((c) => c.id === sched)?.user_id).toBe(alice);
    const [{ id: run }] = await db.admin<{ id: string }>(
      `insert into prospect_runs (workspace_id, search_id, status, brief, target_count) values ($1, $2, 'done', '{}'::jsonb, 25) returning id`,
      [A, search],
    );
    await service(
      `sourcing_step_done($1, $2, 'started', $3, null, 'Started', 2000)`,
      [A, sched, run],
    );
    await db.admin(
      `insert into prospects (workspace_id, run_id, search_id, company_name, domain, website, research_status)
       values ($1, $2, $3, 'New Gym', 'newgym.example', 'https://newgym.example/', 'found')`,
      [A, run, search],
    );
    const done = await service<{ added: number }>(
      `sourcing_step_done($1, $2, 'finished', null, null, 'Done', 2000)`,
      [A, sched],
    );
    expect(done.added).toBe(1);
    const [s] = await db.admin<{
      status: string;
      due: boolean;
      month_runs: number;
    }>(
      `select status, next_run_at > now() + interval '6 days' as due, month_runs from sourcing_schedules where id = $1`,
      [sched],
    );
    expect(s).toEqual({ status: "idle", due: true, month_runs: 1 });
  });

  it("asks for list cells only when some are queued", async () => {
    // B's cell from the setup was claimed and is running under its lease.
    const due = async () =>
      (
        await db.admin<{ w: string[] }>(`select private.data_due_work() as w`)
      )[0].w;
    expect(await due()).not.toContain("cells");
    await db.admin(
      `update data_cells set locked_until = now() - interval '1 second' where workspace_id = $1`,
      [B],
    );
    expect(await due()).toContain("cells");
  });
});
