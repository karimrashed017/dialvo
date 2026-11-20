import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

// The contact database (Findymail) in "Find leads", proved against the real
// migrations: one workspace can't see or change another's contact settings;
// only the server can run the contact steps; the daily credit cap is
// reserved before anything is asked for; results are deduped against the
// workspace's prospects, leads and suppression list; and reading a site
// never replaces the contact or email the database returned.

const DENIED = /row-level security|permission denied/;

let db: TestDb;
let alice: string; // owner of A
let amy: string; // member of A
let bob: string; // owner of B
let carol: string; // in no workspace
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

const CAP = { credits: 100, per: 3 };

const startContactRun = (
  ws: string,
  search: string,
  user: string,
  o: { query?: string; titles?: unknown; credits?: number } = {},
) =>
  service<{ status: string; run_id?: string }>(
    "prospect_contact_run_start($1, $2, $3, 25, 1000, 3000000, $4, $5::jsonb, $6, 3)",
    [
      ws,
      search,
      user,
      o.query ?? "Independent dental clinics in Leeds",
      JSON.stringify(o.titles ?? [["Owner", "Founder"]]),
      o.credits ?? CAP.credits,
    ],
  );
type ContactClaim = {
  status: string;
  phase?: string;
  hash?: string;
  limit?: number | null;
  exclusion_list_id?: number | null;
  stop_reason?: string;
};
const contactClaim = (
  run: string,
  ws: string,
  o: { lease?: number; polls?: number } = {},
) =>
  service<ContactClaim | null>("prospect_contact_claim($1, $2, $3, $4)", [
    run,
    ws,
    o.lease ?? 0,
    o.polls ?? 180,
  ]);
const reserve = (run: string, ws: string, wanted = 25, cap = CAP.credits) =>
  service<number>("prospect_contact_reserve($1, $2, $3, 3, $4)", [
    run,
    ws,
    wanted,
    cap,
  ]);
const step = (
  run: string,
  ws: string,
  o: { phase?: string; hash?: string; wait?: number; refund?: number } = {},
) =>
  service("prospect_contact_step($1, $2, $3, $4, null, $5, $6)", [
    run,
    ws,
    o.phase ?? null,
    o.hash ?? null,
    o.wait ?? null,
    o.refund ?? 0,
  ]);
const add = (
  run: string,
  ws: string,
  rows: Record<string, unknown>[],
  returned: number,
  last = true,
) =>
  service<{ status: string; added: number } | null>(
    "prospect_contact_add($1, $2, $3::jsonb, $4, $5, 3)",
    [run, ws, JSON.stringify(rows), returned, last],
  );
const claim = (run: string, ws: string) =>
  service<{ status: string; work?: { id: string; domain: string }[] } | null>(
    "prospect_run_claim($1, $2, 0, 10, 2, 60)",
    [run, ws],
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
const creditsToday = async (ws: string) =>
  (
    await db.admin<{ c: number }>(
      `select coalesce((select contact_credits from outbound_usage where workspace_id = $1 and day = (now() at time zone 'utc')::date), 0) as c`,
      [ws],
    )
  )[0].c;

const row = (domain: string, extra: Record<string, unknown> = {}) => ({
  domain,
  company_name: `Company ${domain}`,
  description: "A dental clinic.",
  size_range: "11-50",
  industries: ["Dentistry"],
  country: "United Kingdom",
  match_score: 88,
  contact_name: "Dana Smith",
  contact_role: "Practice Owner",
  email: `dana@${domain}`,
  linkedin_url: "https://www.linkedin.com/in/dana",
  external_id: "1",
  ...extra,
});

async function newWorkspace(email: string, name: string) {
  const owner = await db.createUser(email, name);
  const [{ id }] = await db.user(owner)<{ id: string }>(
    `select create_workspace($1, 'UTC', null, 'We sell booking software') as id`,
    [name],
  );
  const [{ id: search }] = await db.user(owner)<{ id: string }>(
    `insert into prospect_searches (workspace_id, name, description, created_by)
     values ($1, 'Clinics', 'Dental clinics', $2) returning id`,
    [id, owner],
  );
  return { owner, ws: id, search };
}

const finish = (run: string, ws: string) =>
  db.admin(
    `update prospect_runs set status = 'done', locked_until = null where id = $1 and workspace_id = $2`,
    [run, ws],
  );

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.createUser("alice@a.example", "Alice");
  amy = await db.createUser("amy@a.example", "Amy");
  bob = await db.createUser("bob@b.example", "Bob");
  carol = await db.createUser("carol@nowhere.example", "Carol");
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
  for (const ws of [A, B])
    await service("prospect_contact_set_list($1, 7)", [ws]);
});

afterAll(async () => {
  await db.close();
});

describe("prospect_contact_settings", () => {
  it("shows a member their own workspace's row, and nobody else's", async () => {
    expect(
      await db.user(amy)(`select workspace_id from prospect_contact_settings`),
    ).toEqual([{ workspace_id: A }]);
    expect(
      await db.user(alice)(
        `select 1 from prospect_contact_settings where workspace_id = $1`,
        [B],
      ),
    ).toEqual([]);
    expect(
      await db.user(carol)(`select 1 from prospect_contact_settings`),
    ).toEqual([]);
    await expect(
      db.as({ role: "anon" }, `select 1 from prospect_contact_settings`),
    ).rejects.toThrow(/permission denied/);
  });

  it("can't be written by anyone but the server, even in their own workspace", async () => {
    for (const [who, sql] of [
      [
        alice,
        `insert into prospect_contact_settings (workspace_id, exclusion_list_id) values ('${B}', 1)`,
      ],
      [
        alice,
        `update prospect_contact_settings set exclusion_list_id = 1 where workspace_id = '${A}'`,
      ],
      [
        alice,
        `update prospect_contact_settings set exclusion_list_id = 1 where workspace_id = '${B}'`,
      ],
      [
        amy,
        `delete from prospect_contact_settings where workspace_id = '${A}'`,
      ],
      [
        carol,
        `insert into prospect_contact_settings (workspace_id) values ('${A}')`,
      ],
    ] as const)
      await expect(db.user(who)(sql), sql).rejects.toThrow(DENIED);
    const [{ n }] = await db.admin<{ n: number }>(
      `select count(*)::int as n from prospect_contact_settings where exclusion_list_id = 7`,
    );
    expect(n).toBe(2);
  });
});

describe("the server's contact functions", () => {
  it("can't be called by signed-in people or anon", async () => {
    const r = "00000000-0000-0000-0000-000000000000";
    const calls = [
      `select prospect_contact_run_start('${A}', '${r}', '${alice}', 25, 4, 3000000, 'q', '[]'::jsonb, 100, 3)`,
      `select prospect_contact_claim('${r}', '${A}', 90, 180)`,
      `select prospect_contact_reserve('${r}', '${A}', 25, 3, 100000)`,
      `select prospect_contact_step('${r}', '${A}', null, null, null, null, 0)`,
      `select prospect_contact_add('${r}', '${A}', '[]'::jsonb, 0, true, 3)`,
      `select prospect_contact_exclusions('${A}', 100)`,
      `select prospect_contact_set_list('${A}', 1)`,
      `select prospect_contact_synced('${A}', now())`,
      `select prospect_save_research('${r}', '${A}', '${r}', '{}'::jsonb, 0, 0, 0)`,
      `select private.contact_credits_today('${A}')`,
    ];
    for (const call of calls) {
      await expect(db.user(alice)(call), call).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.as({ role: "anon" }, call), call).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("let a member edit their own search's details, and not another workspace's", async () => {
    const [{ id }] = await db.user(alice)<{ id: string }>(
      `insert into prospect_searches (workspace_id, name, description, created_by) values ($1, 'S', 'D', $2) returning id`,
      [A, alice],
    );
    const [{ id: theirs }] = await db.user(bob)<{ id: string }>(
      `insert into prospect_searches (workspace_id, name, description, created_by) values ($1, 'S', 'D', $2) returning id`,
      [B, bob],
    );
    const ok = await db.user(amy)(
      `update prospect_searches set contact_query = 'Dental clinics', contact_titles = '[["Owner"]]', contact_query_edited = true where id = $1`,
      [id],
    );
    expect(ok.affected).toBe(1);
    const no = await db.user(alice)(
      `update prospect_searches set contact_query = 'x' where id = $1`,
      [theirs],
    );
    expect(no.affected).toBe(0);
    await expect(
      db.user(amy)(
        `update prospect_searches set contact_titles = '[[1],[2],[3],[4]]' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/check constraint/);
    // The run's own counters stay the server's.
    await expect(
      db.user(alice)(
        `update prospect_runs set contact_credits = 0 where workspace_id = $1`,
        [A],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.user(alice)(
        `update prospects set email_verified = true where workspace_id = $1`,
        [A],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("a contact-database run", () => {
  it("starts marked as one, with its query, and only within the day's caps", async () => {
    const w = await newWorkspace("w1@w.example", "W1");
    expect(
      (await startContactRun(w.ws, w.search, w.owner, { query: "" })).status,
    ).toBe("invalid");
    expect(
      (
        await startContactRun(w.ws, w.search, w.owner, {
          titles: [["a"], ["b"], ["c"], ["d"]],
        })
      ).status,
    ).toBe("invalid");
    expect((await startContactRun(w.ws, w.search, bob)).status).toBe(
      "not_found",
    );
    expect(
      (await startContactRun(w.ws, w.search, w.owner, { credits: 2 })).status,
    ).toBe("capped");
    const started = await startContactRun(w.ws, w.search, w.owner);
    expect(started.status).toBe("started");
    const [r] = await db.admin(
      `select source, contact_phase, contact_query, contact_titles from prospect_runs where id = $1`,
      [started.run_id],
    );
    expect(r).toEqual({
      source: "findymail",
      contact_phase: "start",
      contact_query: "Independent dental clinics in Leeds",
      contact_titles: [["Owner", "Founder"]],
    });
    // One at a time, as for web runs.
    expect((await startContactRun(w.ws, w.search, w.owner)).status).toBe(
      "busy",
    );
    // Only with its own workspace's id.
    expect(await contactClaim(started.run_id!, B)).toBeNull();
  });

  it("reserves credits before the search, never past the day's cap, and only once per run", async () => {
    const w = await newWorkspace("w2@w.example", "W2");
    const first = (await startContactRun(w.ws, w.search, w.owner)).run_id!;
    expect((await contactClaim(first, w.ws))!.phase).toBe("start");
    expect(await reserve(first, w.ws, 25)).toBe(25);
    expect(await creditsToday(w.ws)).toBe(75);
    // Asking again (a retry after a 429) grants what was granted, no more.
    expect(await reserve(first, w.ws, 25)).toBe(25);
    expect(await creditsToday(w.ws)).toBe(75);
    await finish(first, w.ws);

    // 25 credits left today: 8 companies' worth.
    const second = (await startContactRun(w.ws, w.search, w.owner)).run_id!;
    expect(await reserve(second, w.ws, 25)).toBe(8);
    expect(await creditsToday(w.ws)).toBe(99);
    const [{ contact_limit, contact_credits }] = await db.admin<{
      contact_limit: number;
      contact_credits: number;
    }>(
      `select contact_limit, contact_credits from prospect_runs where id = $1`,
      [second],
    );
    expect([contact_limit, contact_credits]).toEqual([8, 24]);
    await finish(second, w.ws);

    // 1 credit left: not even one company. The run isn't started at all.
    expect((await startContactRun(w.ws, w.search, w.owner)).status).toBe(
      "capped",
    );
    // And another workspace's day is its own.
    expect(await creditsToday(A)).toBe(0);
  });

  it("gives back reserved credits that weren't spent", async () => {
    const w = await newWorkspace("w3@w.example", "W3");
    const run = (await startContactRun(w.ws, w.search, w.owner)).run_id!;
    await contactClaim(run, w.ws);
    await reserve(run, w.ws, 25);
    await step(run, w.ws, { refund: 75 });
    expect(await creditsToday(w.ws)).toBe(0);
    // Never more than was reserved.
    await step(run, w.ws, { refund: 500 });
    expect(await creditsToday(w.ws)).toBe(0);
  });

  it("waits between questions, holds a lease, and gives up after too many", async () => {
    const w = await newWorkspace("w4@w.example", "W4");
    const run = (await startContactRun(w.ws, w.search, w.owner)).run_id!;
    await contactClaim(run, w.ws);
    await step(run, w.ws, { phase: "wait", hash: "abc123", wait: 60 });
    expect((await contactClaim(run, w.ws))!.status).toBe("waiting");
    await db.admin(
      `update prospect_runs set contact_next_at = now() - interval '1 second' where id = $1`,
      [run],
    );
    const ready = await contactClaim(run, w.ws, { lease: 60 });
    expect(ready).toMatchObject({
      status: "searching",
      phase: "wait",
      hash: "abc123",
    });
    expect((await contactClaim(run, w.ws))!.status).toBe("busy");
    await db.admin(
      `update prospect_runs set locked_until = null where id = $1`,
      [run],
    );
    expect(await contactClaim(run, w.ws, { polls: 2 })).toEqual({
      status: "stopped",
      stop_reason: "contact_timeout",
    });
    // A web run goes the usual way.
    const web = await newWorkspace("w5@w.example", "W5");
    const [{ r }] = await db.as<{ r: { run_id: string } }>(
      { role: "service_role" },
      `select prospect_run_start($1, $2, $3, 25, 4, 3000000) as r`,
      [web.ws, web.search, web.owner],
    );
    expect((await contactClaim(r.run_id, web.ws))!.status).toBe("not_contact");
    await expect(
      db.admin(
        `update prospect_runs set contact_hash = 'bad hash; drop' where id = $1`,
        [run],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("stores only companies the workspace doesn't have, isn't a lead and hasn't suppressed, then reads their sites", async () => {
    const w = await newWorkspace("w6@w.example", "W6");
    await db.admin(
      `insert into leads (workspace_id, name, email, website) values
        ($1, 'By site', null, 'https://www.lead-site.example/'),
        ($1, 'By email domain', 'jo@lead-mail.example', null),
        ($1, 'By address', 'dana@other-domain.example', null)`,
      [w.ws],
    );
    await db.user(w.owner)(
      `insert into outbound_suppressions (workspace_id, kind, value, created_by) values
        ($1, 'domain', 'blocked.example', $2), ($1, 'email', 'dana@listed.example', $2)`,
      [w.ws, w.owner],
    );
    // A company an earlier web run found and kept.
    const old = (
      await db.as<{ r: { run_id: string } }>(
        { role: "service_role" },
        `select prospect_run_start($1, $2, $3, 25, 4, 3000000) as r`,
        [w.ws, w.search, w.owner],
      )
    )[0].r.run_id;
    await db.admin(
      `insert into prospects (workspace_id, run_id, search_id, domain, website, research_status)
       values ($1, $2, $3, 'have.example', 'https://have.example/', 'found')`,
      [w.ws, old, w.search],
    );
    await finish(old, w.ws);

    const run = (await startContactRun(w.ws, w.search, w.owner)).run_id!;
    await contactClaim(run, w.ws);
    expect(await reserve(run, w.ws, 10)).toBe(10);
    const result = await add(
      run,
      w.ws,
      [
        row("new.example"),
        row("have.example"),
        row("lead-site.example"),
        row("lead-mail.example"),
        row("other.example", { email: "dana@other-domain.example" }),
        row("blocked.example"),
        row("listed.example"),
        row("nameless.example", { contact_name: "", contact_role: "CEO" }),
        row("noemail.example", { email: null }),
        row("bad.example", { email: "not an address" }),
      ],
      10,
    );
    expect(result).toEqual({ status: "researching", added: 3 });
    const stored = await db.admin(
      `select domain, source, contact_name, contact_role, email, email_kind, email_verified, email_source_url,
              match_score, size_range, industries, country, contact_linkedin_url, research_status
       from prospects where run_id = $1 order by domain`,
      [run],
    );
    expect(stored).toEqual([
      expect.objectContaining({
        domain: "nameless.example",
        contact_name: "",
        contact_role: "",
        email_kind: "business",
        email_verified: true,
      }),
      {
        domain: "new.example",
        source: "findymail",
        contact_name: "Dana Smith",
        contact_role: "Practice Owner",
        email: "dana@new.example",
        email_kind: "person",
        email_verified: true,
        email_source_url: null,
        match_score: 88,
        size_range: "11-50",
        industries: ["Dentistry"],
        country: "United Kingdom",
        contact_linkedin_url: "https://www.linkedin.com/in/dana",
        research_status: "candidate",
      },
      expect.objectContaining({
        domain: "noemail.example",
        email: null,
        email_kind: null,
        email_verified: false,
      }),
    ]);
    // 10 rows returned, 10 reserved: all 30 credits stand.
    expect(await creditsToday(w.ws)).toBe(30);
    // From here it is a normal run: its sites are read.
    const c = await claim(run, w.ws);
    expect(c!.status).toBe("researching");
    expect(c!.work!.map((x) => x.domain).sort()).toEqual([
      "nameless.example",
      "new.example",
      "noemail.example",
    ]);
  });

  it("settles the credits on the last page: what wasn't returned goes back to the day", async () => {
    const w = await newWorkspace("w7@w.example", "W7");
    const run = (await startContactRun(w.ws, w.search, w.owner)).run_id!;
    await contactClaim(run, w.ws);
    await reserve(run, w.ws, 25);
    expect(await creditsToday(w.ws)).toBe(75);
    expect(await add(run, w.ws, [row("a.example")], 4, false)).toEqual({
      status: "searching",
      added: 1,
    });
    const [{ contact_page, contact_phase }] = await db.admin<{
      contact_page: number;
      contact_phase: string;
    }>(`select contact_page, contact_phase from prospect_runs where id = $1`, [
      run,
    ]);
    expect([contact_page, contact_phase]).toEqual([2, "read"]);
    expect(await add(run, w.ws, [row("b.example")], 2, true)).toEqual({
      status: "researching",
      added: 1,
    });
    // 6 returned x 3 credits.
    expect(await creditsToday(w.ws)).toBe(18);
    const [{ contact_credits, contact_returned }] = await db.admin<{
      contact_credits: number;
      contact_returned: number;
    }>(
      `select contact_credits, contact_returned from prospect_runs where id = $1`,
      [run],
    );
    expect([contact_credits, contact_returned]).toEqual([18, 6]);

    // A search that returned nothing new ends with nothing found.
    const w2 = await newWorkspace("w8@w.example", "W8");
    const empty = (await startContactRun(w2.ws, w2.search, w2.owner)).run_id!;
    await contactClaim(empty, w2.ws);
    await reserve(empty, w2.ws, 25);
    expect(await add(empty, w2.ws, [], 0, true)).toEqual({
      status: "done",
      added: 0,
    });
    expect(await creditsToday(w2.ws)).toBe(0);
    const [{ stop_reason }] = await db.admin<{ stop_reason: string }>(
      `select stop_reason from prospect_runs where id = $1`,
      [empty],
    );
    expect(stop_reason).toBe("nothing_found");
  });

  it("lists the domains for the exclusion list, then only the new ones", async () => {
    const w = await newWorkspace("w9@w.example", "W9");
    await db.admin(
      `insert into leads (workspace_id, name, website) values ($1, 'L', 'https://www.leadco.example/x')`,
      [w.ws],
    );
    await db.user(w.owner)(
      `insert into outbound_suppressions (workspace_id, kind, value, created_by) values ($1, 'domain', 'never.example', $2), ($1, 'email', 'a@person.example', $2)`,
      [w.ws, w.owner],
    );
    const run = (await startContactRun(w.ws, w.search, w.owner)).run_id!;
    await contactClaim(run, w.ws);
    await reserve(run, w.ws, 5);
    await add(run, w.ws, [row("found.example")], 1, true);
    const first = await service<{
      list_id: number | null;
      read_at: string;
      domains: string[];
    }>("prospect_contact_exclusions($1, 100)", [w.ws]);
    expect(first.list_id).toBeNull();
    expect(first.domains).toEqual([
      "found.example",
      "leadco.example",
      "never.example",
    ]);
    await service("prospect_contact_set_list($1, 99)", [w.ws]);
    await service("prospect_contact_synced($1, $2::timestamptz)", [
      w.ws,
      first.read_at,
    ]);
    await db.user(w.owner)(
      `insert into outbound_suppressions (workspace_id, kind, value, created_by) values ($1, 'domain', 'later.example', $2)`,
      [w.ws, w.owner],
    );
    const next = await service<{ list_id: number; domains: string[] }>(
      "prospect_contact_exclusions($1, 100)",
      [w.ws],
    );
    expect(next).toMatchObject({ list_id: 99, domains: ["later.example"] });
    // Another workspace's list is its own.
    const theirs = await service<{ domains: string[] }>(
      "prospect_contact_exclusions($1, 100)",
      [B],
    );
    expect(theirs.domains).not.toContain("later.example");
  });
});

describe("reading a contact-database company's site", () => {
  let w: { owner: string; ws: string; search: string };
  let run: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    w = await newWorkspace("site@w.example", "Site");
    await db.admin(
      `insert into leads (workspace_id, name, email) values ($1, 'Lead', 'owner@lead-mail.example')`,
      [w.ws],
    );
    run = (await startContactRun(w.ws, w.search, w.owner)).run_id!;
    await contactClaim(run, w.ws);
    await reserve(run, w.ws, 10);
    await add(
      run,
      w.ws,
      [
        row("keep.example"),
        row("noemail.example", { email: null, contact_name: "" }),
        row("robots.example"),
        row("down.example"),
        row("rival.example"),
        row("lead.example", { email: null, contact_name: "" }),
      ],
      6,
    );
    const c = await claim(run, w.ws);
    for (const item of c!.work!) ids[item.domain.split(".")[0]] = item.id;
  });

  const found = (extra: Record<string, unknown> = {}) => ({
    status: "found",
    company_name: "From the site",
    website: "https://keep.example/",
    summary: "A family dental clinic in Leeds.",
    location: "Leeds, UK",
    contact_name: "Someone Else",
    contact_role: "Receptionist",
    contact_source_url: "https://keep.example/team",
    email: "hello@keep.example",
    email_source_url: "https://keep.example/contact",
    email_kind: "business",
    phone: "+441130000000",
    phone_source_url: "https://keep.example/contact",
    facts: [
      {
        fact: "Open since 1998.",
        quote: "open since 1998 in Leeds",
        source_url: "https://keep.example/",
      },
    ],
    pages: ["https://keep.example/"],
    ...extra,
  });

  it("never lets an address from the site replace the contact the database returned", async () => {
    expect(await saveResearch(run, w.ws, ids.keep, found())).toBe("found");
    const [p] = await db.admin(
      `select contact_name, contact_role, email, email_kind, email_verified, email_source_url, summary, location, facts, phone
       from prospects where id = $1`,
      [ids.keep],
    );
    expect(p).toEqual({
      contact_name: "Dana Smith",
      contact_role: "Practice Owner",
      email: "dana@keep.example",
      email_kind: "person",
      email_verified: true,
      email_source_url: null,
      summary: "A family dental clinic in Leeds.",
      location: "Leeds, UK",
      facts: [
        {
          fact: "Open since 1998.",
          quote: "open since 1998 in Leeds",
          source_url: "https://keep.example/",
        },
      ],
      phone: "+441130000000",
    });
  });

  it("uses the site's address only when the database returned none, and only with its page", async () => {
    expect(
      await saveResearch(
        run,
        w.ws,
        ids.noemail,
        found({
          email: "hello@noemail.example",
          email_source_url: "https://noemail.example/contact",
        }),
      ),
    ).toBe("found");
    const [p] = await db.admin(
      `select email, email_kind, email_verified, email_source_url, contact_name from prospects where id = $1`,
      [ids.noemail],
    );
    expect(p).toEqual({
      email: "hello@noemail.example",
      email_kind: "business",
      email_verified: false,
      email_source_url: "https://noemail.example/contact",
      contact_name: "Someone Else",
    });
  });

  it("keeps a company whose site can't be or asks not to be read, and leaves out a competitor", async () => {
    expect(
      await saveResearch(run, w.ws, ids.robots, {
        status: "skipped",
        reason: "robots_disallowed",
      }),
    ).toBe("found");
    expect(await saveResearch(run, w.ws, ids.down, { status: "retry" })).toBe(
      "found",
    );
    expect(
      await saveResearch(run, w.ws, ids.rival, {
        status: "skipped",
        reason: "competitor",
      }),
    ).toBe("skipped");
    const rows = await db.admin(
      `select domain, research_status, skip_reason, email from prospects where id = any($1::uuid[]) order by domain`,
      [[ids.robots, ids.down, ids.rival]],
    );
    expect(rows).toEqual([
      {
        domain: "down.example",
        research_status: "found",
        skip_reason: "unreadable",
        email: "dana@down.example",
      },
      {
        domain: "rival.example",
        research_status: "skipped",
        skip_reason: "competitor",
        email: "dana@rival.example",
      },
      {
        domain: "robots.example",
        research_status: "found",
        skip_reason: "robots_disallowed",
        email: "dana@robots.example",
      },
    ]);
  });

  it("still won't keep an address that is already a lead's", async () => {
    expect(
      await saveResearch(
        run,
        w.ws,
        ids.lead,
        found({
          email: "owner@lead-mail.example",
          email_source_url: "https://lead.example/",
        }),
      ),
    ).toBe("skipped");
  });

  it("never stores a web prospect's email without its page, or a 'verified' email that isn't from the database", async () => {
    await expect(
      db.admin(`update prospects set source = 'web' where id = $1`, [ids.keep]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.admin(
        `insert into prospects (workspace_id, run_id, search_id, domain, website, email, email_kind)
         values ($1, $2, $3, 'web-only.example', 'https://web-only.example/', 'a@web-only.example', 'business')`,
        [w.ws, run, w.search],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.admin(
        `update prospects set email_verified = true, email = null where id = $1`,
        [ids.keep],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.admin(`update prospects set email_kind = 'guessed' where id = $1`, [
        ids.keep,
      ]),
    ).rejects.toThrow(/check constraint/);
  });
});
