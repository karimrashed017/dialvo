import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { PLAYS_SECRET_TABLES, PLAYS_TABLES } from "./plays-tables";

// The plays, campaigns, signals and product events, proved against the real
// migrations: one workspace can't see or change another's rows; the API
// key's hash is never readable; who each play picks and who it never picks;
// event lists; speed to lead and its auto-approval; single-touch plays get
// no cold follow-ups; a play's approved draft is scheduled on its own lead;
// and the numbers on Analytics stay inside the workspace.

const DENIED = /row-level security|permission denied/;
const HASH = "a".repeat(64);

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

const lead = (
  ws: string,
  email: string,
  extra: {
    status?: string;
    days?: number;
    consent?: boolean;
    dnc?: boolean;
    source?: string;
  } = {},
) =>
  one(
    `insert into leads (workspace_id, name, email, status, consent_email, do_not_contact, source, created_at, updated_at)
     values ($1, 'Lead', $2, $3, $4, $5, $6, now() - make_interval(days => $7), now() - make_interval(days => $7))
     returning id`,
    [
      ws,
      email,
      extra.status ?? "new",
      extra.consent ?? false,
      extra.dnc ?? false,
      extra.source ?? "manual",
      extra.days ?? 0,
    ],
  );

type Candidate = { lead_id: string; fact: string };
const preview = (ws: string, user: string, kind: string, days: number) =>
  service<{ count: number; leads: Candidate[] } | null>(
    "play_preview($1, $2, $3, $4, 30, 50)",
    [ws, user, kind, days],
  );

async function mailbox(ws: string, email: string) {
  return one(
    `insert into mailboxes (workspace_id, provider, email, sender_name, username, smtp_host, smtp_port, imap_host, imap_port)
     values ($1, 'other', $2, 'Sam', $2, 'smtp.example.com', 587, 'imap.example.com', 993) returning id`,
    [ws, email],
  );
}

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

describe("one workspace and another", () => {
  it("can't read each other's plays, campaigns, signals, events or keys", async () => {
    const leadB = await lead(B, "secret@b-customer.example");
    const campaign = await one(
      `insert into outbound_campaigns (workspace_id, kind, name) values ($1, 'reactivation', 'B play') returning id`,
      [B],
    );
    await db.admin(
      `insert into outbound_campaign_targets (workspace_id, campaign_id, lead_id, status) values ($1, $2, $3, 'selected')`,
      [B, campaign, leadB],
    );
    const monitor = await one(
      `insert into signal_monitors (workspace_id, name, signal_type, max_matches, status, external_id)
       values ($1, 'Hiring', 'new_hire', 50, 'active', 77) returning id`,
      [B],
    );
    await db.admin(
      `insert into signals (workspace_id, monitor_id, external_id, signal_type, summary) values ($1, $2, 'x1', 'new_hire', 'A hire')`,
      [B, monitor],
    );
    const key = await one(
      `insert into workspace_api_keys (workspace_id, key_prefix, key_hash) values ($1, 'dv_abcdef', $2) returning id`,
      [B, HASH],
    );
    await db.admin(
      `insert into lead_product_events (workspace_id, lead_id, event, api_key_id) values ($1, $2, 'trial_started', $3)`,
      [B, leadB, key],
    );
    await db.admin(
      `insert into api_key_minute_usage (key_id, workspace_id, minute, events) values ($1, $2, date_trunc('minute', now()), 1)`,
      [key, B],
    );
    await db.admin(
      `insert into play_settings (workspace_id, play, enabled, updated_by) values ($1, 'speed_to_lead', true, $2)`,
      [B, bob],
    );

    for (const table of PLAYS_TABLES) {
      const own = await db.user(bob)(`select workspace_id from ${table}`);
      expect(own.length, table).toBeGreaterThan(0);
      const other = await db.user(alice)(`select workspace_id from ${table}`);
      expect(other, table).toEqual([]);
    }
    expect(
      await db.user(alice)(`select id, key_prefix from workspace_api_keys`),
    ).toEqual([]);
    expect(
      (await db.user(bob)(`select id, key_prefix from workspace_api_keys`))
        .length,
    ).toBe(1);
  });

  it("can't write to any of them directly", async () => {
    for (const table of [...PLAYS_TABLES, ...PLAYS_SECRET_TABLES]) {
      await expect(db.user(bob)(`delete from ${table}`), table).rejects.toThrow(
        DENIED,
      );
      await expect(
        db.user(bob)(`update ${table} set workspace_id = workspace_id`),
        table,
      ).rejects.toThrow(DENIED);
    }
    await expect(
      db.user(bob)(
        `insert into outbound_campaigns (workspace_id, kind, name) values ($1, 'reactivation', 'x')`,
        [B],
      ),
    ).rejects.toThrow(DENIED);
  });

  it("never shows anyone a key's hash, or the rate limit's counter", async () => {
    await expect(
      db.user(bob)(`select key_hash from workspace_api_keys`),
    ).rejects.toThrow(DENIED);
    await expect(
      db.user(bob)(`select * from api_key_minute_usage`),
    ).rejects.toThrow(DENIED);
  });

  it("only the secret key may run the plays' server functions", async () => {
    for (const call of [
      `play_start('${A}', '${alice}', 'reactivation', 'x', 30, 30, 10)`,
      `campaign_draft_claim('${A}', '${alice}', 3, 100, 3000000, 2)`,
      `event_import('${A}', '${alice}', 'Webinar', '', '', 'registered', '[]'::jsonb, 2000)`,
      `speed_to_lead_sweep('${A}', 10)`,
      `play_auto_approve('${A}')`,
      `api_event_record('${HASH}', 'x@y.example', 'trial_started', null, '{}'::jsonb, 60)`,
      `contact_credits_reserve('${A}', 1, 100)`,
      `prospect_add_fact('${A}', gen_random_uuid(), '{"fact":"x"}'::jsonb)`,
      `signal_pull_claim(5, 60, 23, 50)`,
    ])
      await expect(db.user(alice)(`select ${call}`), call).rejects.toThrow(
        /permission denied/,
      );
  });

  it("each sees only their own numbers on Analytics and the plays page", async () => {
    expect(
      (await db.user(alice)(`select analytics_summary($1, 30) as r`, [B]))[0].r,
    ).toBeNull();
    expect(
      (await db.user(alice)(`select play_counts($1) as r`, [B]))[0].r,
    ).toBeNull();
    const [{ r }] = await db.user(bob)<{
      r: { totals: Record<string, number> };
    }>(`select analytics_summary($1, 30) as r`, [B]);
    expect(r.totals.emails_sent).toBe(0);
    const [{ r: counts }] = await db.user(bob)<{
      r: Record<string, { targeted: number }>;
    }>(`select play_counts($1) as r`, [B]);
    expect(counts.reactivation.targeted).toBe(1);
  });

  it("can't change each other's play settings, and members can't change their own", async () => {
    await expect(
      db.user(alice)(
        `select play_settings_save($1, 'speed_to_lead', false, false)`,
        [B],
      ),
    ).rejects.toThrow(/owner or admin/);
    await expect(
      db.user(amy)(
        `select play_settings_save($1, 'speed_to_lead', true, false)`,
        [A],
      ),
    ).rejects.toThrow(/owner or admin/);
  });
});

describe("the product events endpoint's function", () => {
  it("records an event on the lead with that email, refuses a revoked key, and rate-limits", async () => {
    const hash = "b".repeat(64);
    const [{ r: keyId }] = await db.user(alice)<{ r: string }>(
      `select api_key_create($1, 'Events', 'dv_test01', $2) as r`,
      [A, hash],
    );
    const leadA = await lead(A, "trial@user.example");
    const record = (email: string, max = 2) =>
      service<{ status: string; lead_id?: string }>(
        "api_event_record($1, $2, 'limit_reached', null, '{\"limit\":\"projects\"}'::jsonb, $3)",
        [hash, email, max],
      );
    expect(await record("TRIAL@user.example")).toEqual({
      status: "recorded",
      lead_id: leadA,
    });
    expect((await record("nobody@user.example")).status).toBe("no_lead");
    expect((await record("trial@user.example")).status).toBe("rate_limited");
    // Another workspace's lead with the same address is never matched.
    await lead(B, "only-b@user.example");
    const [{ r: other }] = await db.user(alice)<{ r: string }>(
      `select api_key_create($1, 'Events 2', 'dv_test02', $2) as r`,
      [A, "c".repeat(64)],
    );
    expect(other).toBeTruthy();
    expect(
      (
        await service<{ status: string }>(
          "api_event_record($1, 'only-b@user.example', 'trial_started', null, '{}'::jsonb, 60)",
          ["c".repeat(64)],
        )
      ).status,
    ).toBe("no_lead");
    await db.user(alice)(`select api_key_revoke($1)`, [keyId]);
    expect((await record("trial@user.example", 60)).status).toBe(
      "unauthorised",
    );
  });

  it("lets only an owner or admin make a key", async () => {
    await expect(
      db.user(amy)(`select api_key_create($1, 'x', 'dv_test03', $2)`, [
        A,
        "d".repeat(64),
      ]),
    ).rejects.toThrow(/owner or admin/);
  });
});

describe("who a play picks", () => {
  it("reactivation: quiet for N days and never said no; never do not contact or the never-contact list", async () => {
    const quiet = await lead(A, "quiet@react.example", { days: 40 });
    await lead(A, "fresh@react.example", { days: 5 });
    await lead(A, "dnc@react.example", { days: 40, dnc: true });
    await lead(A, "won@react.example", { days: 40, status: "won" });
    const blocked = await lead(A, "blocked@nope.example", { days: 40 });
    await db.admin(
      `insert into outbound_suppressions (workspace_id, kind, value) values ($1, 'domain', 'nope.example')`,
      [A],
    );
    const picked = (await preview(A, alice, "reactivation", 30))!.leads.map(
      (l) => l.lead_id,
    );
    expect(picked).toContain(quiet);
    expect(picked).not.toContain(blocked);
    expect(picked).toHaveLength(
      picked.filter((id) => id === quiet).length +
        picked.filter((id) => id !== quiet).length,
    );
    const emails = await db.admin<{ email: string }>(
      `select email from leads where id = any($1::uuid[])`,
      [picked],
    );
    expect(emails.map((e) => e.email).sort()).toEqual(["quiet@react.example"]);
  });

  it("closed lost: marked lost more than N days ago", async () => {
    const lost = await lead(A, "lost@cl.example", { status: "lost" });
    await db.admin(
      `insert into activity_events (workspace_id, lead_id, kind, summary, metadata, created_at)
       values ($1, $2, 'lead_status_changed', 'Lost', '{"to":"lost"}', now() - interval '120 days')`,
      [A, lost],
    );
    const recent = await lead(A, "recent-lost@cl.example", { status: "lost" });
    const result = (await preview(A, alice, "closed_lost", 90))!;
    const ids = result.leads.map((l) => l.lead_id);
    expect(ids).toContain(lost);
    expect(ids).not.toContain(recent);
    expect(result.leads.find((l) => l.lead_id === lost)!.fact).toMatch(
      /^Marked lost on/,
    );
  });

  it("expansion and onboarding: customers with consent or a prior conversation only", async () => {
    const consented = await lead(A, "c1@cust.example", {
      status: "won",
      consent: true,
    });
    const silent = await lead(A, "c2@cust.example", { status: "won" });
    const talked = await lead(A, "c3@cust.example", { status: "won" });
    const conv = await one(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'chat') returning id`,
      [A, talked],
    );
    await db.admin(
      `insert into messages (workspace_id, conversation_id, direction, author, body, delivery_status) values ($1, $2, 'in', 'lead', 'Hi', 'received')`,
      [A, conv],
    );
    for (const kind of ["expansion", "onboarding"]) {
      const ids = (await preview(A, alice, kind, 30))!.leads.map(
        (l) => l.lead_id,
      );
      expect(ids, kind).toContain(consented);
      expect(ids, kind).toContain(talked);
      expect(ids, kind).not.toContain(silent);
    }
  });

  it("nurture: a finished sequence with no reply, long enough ago, at most twice", async () => {
    const box = await mailbox(A, "sam@a.example");
    const quietLead = await lead(A, "nurture@n.example", { days: 60 });
    const repliedLead = await lead(A, "replied@n.example", { days: 60 });
    for (const [id, email, replied] of [
      [quietLead, "nurture@n.example", false],
      [repliedLead, "replied@n.example", true],
    ] as const) {
      const conv = await one(
        `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'email') returning id`,
        [A, id],
      );
      await db.admin(
        `insert into mail_threads (workspace_id, lead_id, conversation_id, mailbox_id, to_email, subject, status, first_sent_at, last_sent_at, last_reply_at)
         values ($1, $2, $3, $4, $5, 'Hello', 'finished', now() - interval '40 days', now() - interval '30 days', $6)`,
        [A, id, conv, box, email, replied ? new Date().toISOString() : null],
      );
    }
    const ids = (await preview(A, alice, "nurture", 21))!.leads.map(
      (l) => l.lead_id,
    );
    expect(ids).toContain(quietLead);
    expect(ids).not.toContain(repliedLead);
    expect((await preview(A, alice, "nurture", 45))!.leads).toEqual([]);
  });

  it("starting a play takes the leads once, and its drafts carry the play and the reason", async () => {
    const started = await service<{ status: string; selected: number }>(
      "play_start($1, $2, 'reactivation', 'Reactivation', 30, 30, 50)",
      [A, alice],
    );
    expect(started.status).toBe("created");
    // The same leads aren't picked again while they are in it.
    expect(
      (
        await service<{ status: string }>(
          "play_start($1, $2, 'reactivation', 'Again', 30, 30, 50)",
          [A, alice],
        )
      ).status,
    ).toBe("empty");
    const claim = await service<{
      drafts: { draft_id: string; play: string; lead: { why_now: string } }[];
      context: { booking_url: string | null };
    }>("campaign_draft_claim($1, $2, 10, 100, 3000000, 2)", [A, alice]);
    const mine = claim.drafts.filter((d) => d.play === "reactivation");
    expect(mine.length).toBe(started.selected);
    expect(mine[0].lead.why_now).toMatch(/^No activity since/);
    // A teammate of another workspace gets nothing.
    expect(
      await service("campaign_draft_claim($1, $2, 10, 100, 3000000, 2)", [
        A,
        bob,
      ]),
    ).toBeNull();
  });
});

describe("event lists", () => {
  const rows = JSON.stringify([
    {
      name: "Ann",
      email: "ann@event.example",
      company: "Ann Co",
      attended: true,
    },
    { name: "Ben", email: "ben@event.example", company: "", attended: false },
    { name: "Bad", email: "not-an-email", attended: true },
  ]);

  it("writes to the right audience, makes leads for new people, skips bad rows", async () => {
    const attended = await service<{
      status: string;
      selected: number;
      new_leads: number;
      skipped: number;
    }>(
      "event_import($1, $2, 'Spring webinar', 'https://a.example/replay', '12 Mar', 'attended', $3::jsonb, 2000)",
      [A, alice, rows],
    );
    expect(attended).toMatchObject({
      status: "created",
      selected: 1,
      new_leads: 1,
    });
    const noShow = await service<{ selected: number; new_leads: number }>(
      "event_import($1, $2, 'Spring webinar', '', '', 'no_show', $3::jsonb, 2000)",
      [A, alice, rows],
    );
    expect(noShow).toMatchObject({ selected: 1, new_leads: 1 });
    const facts = await db.admin<{ fact: string; play: string }>(
      `select why_now ->> 'fact' as fact, why_now ->> 'play' as play from outbound_campaign_targets t
       join outbound_campaigns c on c.id = t.campaign_id where c.kind = 'event' and c.workspace_id = $1 order by play`,
      [A],
    );
    expect(facts).toEqual([
      { fact: "Attended Spring webinar (12 Mar)", play: "event_followup" },
      {
        fact: "Registered for Spring webinar but didn't attend",
        play: "event_no_show",
      },
    ]);
  });

  it("refuses a link that isn't https and a list over the cap", async () => {
    expect(
      (
        await service<{ status: string }>(
          "event_import($1, $2, 'W', 'http://x.example', '', 'registered', $3::jsonb, 2000)",
          [A, alice, rows],
        )
      ).status,
    ).toBe("invalid");
    expect(
      (
        await service<{ status: string }>(
          "event_import($1, $2, 'W', '', '', 'registered', $3::jsonb, 2)",
          [A, alice, rows],
        )
      ).status,
    ).toBe("invalid");
  });
});

describe("speed to lead", () => {
  it("does nothing until an owner switches it on, then picks new form leads once", async () => {
    await lead(B, "early@form.example", { source: "form: Contact" });
    expect(await service<number>("speed_to_lead_sweep($1, 10)", [B])).toBe(0);
    await db.admin(`delete from play_settings where workspace_id = $1`, [B]);
    expect(await service<number>("speed_to_lead_sweep($1, 10)", [B])).toBe(0);
    await db.user(bob)(
      `select play_settings_save($1, 'speed_to_lead', true, false)`,
      [B],
    );
    // A lead from before it was switched on is not written to.
    expect(await service<number>("speed_to_lead_sweep($1, 10)", [B])).toBe(0);
    await lead(B, "new@form.example", { source: "form: Contact" });
    await lead(B, "manual@form.example");
    expect(await service<number>("speed_to_lead_sweep($1, 10)", [B])).toBe(1);
    expect(await service<number>("speed_to_lead_sweep($1, 10)", [B])).toBe(0);
    const list = await service<{ workspace_id: string }[]>(
      "speed_to_lead_worklist()",
    );
    expect(list.map((w) => w.workspace_id)).toContain(B);
  });

  it("approves its drafts on its own only when told to, and never a do-not-contact lead", async () => {
    const claim = await service<{
      drafts: { draft_id: string; play: string }[];
    }>("campaign_draft_claim($1, $2, 10, 100, 3000000, 2)", [B, bob]);
    const draft = claim.drafts.find((d) => d.play === "speed_to_lead")!;
    await service(
      "outbound_draft_save($1, $2, true, 'Thanks for getting in touch', 'Hi', 'm', 0)",
      [B, draft.draft_id],
    );
    expect(await service<number>("play_auto_approve($1)", [B])).toBe(0);
    await db.user(bob)(
      `select play_settings_save($1, 'speed_to_lead', true, true)`,
      [B],
    );
    await db.admin(
      `update leads set do_not_contact = true where email = 'new@form.example'`,
    );
    expect(await service<number>("play_auto_approve($1)", [B])).toBe(0);
    await db.admin(
      `update leads set do_not_contact = false where email = 'new@form.example'`,
    );
    expect(await service<number>("play_auto_approve($1)", [B])).toBe(1);
  });
});

describe("sending a play's email", () => {
  it("schedules it on its own lead, and an onboarding email starts no follow-ups", async () => {
    const box = await mailbox(B, "bob@b.example");
    const customer = await lead(B, "onboard@cust-b.example", {
      status: "won",
      consent: true,
    });
    const started = await service<{ status: string }>(
      "play_start($1, $2, 'onboarding', 'Onboarding', 30, 365, 10)",
      [B, bob],
    );
    expect(started.status).toBe("created");
    const claim = await service<{
      drafts: { draft_id: string; play: string }[];
    }>("campaign_draft_claim($1, $2, 10, 100, 3000000, 2)", [B, bob]);
    const draft = claim.drafts.find((d) => d.play === "onboarding")!;
    await service(
      "outbound_draft_save($1, $2, true, 'Getting started', 'Hi', 'm', 0)",
      [B, draft.draft_id],
    );
    await db.user(bob)(`select outbound_draft_decide($1, 'approve')`, [
      draft.draft_id,
    ]);
    const planned = await service<number>(
      "mail_schedule_commit($1, $2::jsonb)",
      [
        B,
        JSON.stringify([
          {
            draft_id: draft.draft_id,
            mailbox_id: box,
            send_at: new Date().toISOString(),
          },
        ]),
      ],
    );
    expect(planned).toBe(1);
    const [email] = await db.admin<{ id: string; lead_id: string }>(
      `select id, lead_id from outbound_emails where draft_id = $1`,
      [draft.draft_id],
    );
    expect(email.lead_id).toBe(customer);
    // As private.mail_mark_sent does it.
    await db.admin(`select private.mail_mark_sent($1)`, [email.id]);
    const [thread] = await db.admin<{
      status: string;
      next_followup_at: string | null;
    }>(`select status, next_followup_at from mail_threads where lead_id = $1`, [
      customer,
    ]);
    expect(thread).toEqual({ status: "finished", next_followup_at: null });
  });

  it("refuses to approve a play's draft for a do-not-contact lead", async () => {
    const id = await lead(B, "dnc-play@cust-b.example");
    const draft = await one(
      `insert into outbound_drafts (workspace_id, lead_id, to_email, play, status, subject, body)
       values ($1, $2, 'other-address@cust-b.example', 'reactivation', 'draft', 'S', 'B') returning id`,
      [B, id],
    );
    await db.admin(`update leads set do_not_contact = true where id = $1`, [
      id,
    ]);
    await expect(
      db.user(bob)(`select outbound_draft_decide($1, 'approve')`, [draft]),
    ).rejects.toThrow(/do not contact/);
  });
});

describe("competitive takeout", () => {
  it("a prospect's first email remembers the play of the search that found it", async () => {
    const search = await one(
      `insert into prospect_searches (workspace_id, name, description, play, competitor)
       values ($1, 'Takeout', 'Companies using X', 'takeout', 'X') returning id`,
      [A],
    );
    const run = await one(
      `insert into prospect_runs (workspace_id, search_id, brief, target_count) values ($1, $2, '{}'::jsonb, 25) returning id`,
      [A, search],
    );
    const prospect = await one(
      `insert into prospects (workspace_id, run_id, search_id, domain, website, company_name)
       values ($1, $2, $3, 'takeout.example', 'https://takeout.example/', 'T') returning id`,
      [A, run, search],
    );
    expect(
      await service<boolean>("prospect_add_fact($1, $2, $3::jsonb)", [
        A,
        prospect,
        JSON.stringify({
          fact: "Uses X (detected 1 Mar 2026)",
          kind: "technology",
        }),
      ]),
    ).toBe(true);
    // Once.
    expect(
      await service<boolean>("prospect_add_fact($1, $2, $3::jsonb)", [
        A,
        prospect,
        JSON.stringify({ fact: "Uses X (detected 1 Mar 2026)" }),
      ]),
    ).toBe(false);
    // Another workspace's prospect is never touched.
    expect(
      await service<boolean>("prospect_add_fact($1, $2, $3::jsonb)", [
        B,
        prospect,
        JSON.stringify({ fact: "Injected" }),
      ]),
    ).toBe(false);
    const draft = await one(
      `insert into outbound_drafts (workspace_id, prospect_id, to_email) values ($1, $2, 'cto@takeout.example') returning id`,
      [A, prospect],
    );
    const [row] = await db.admin<{ play: string }>(
      `select play from outbound_drafts where id = $1`,
      [draft],
    );
    expect(row.play).toBe("takeout");
  });

  it("reserves credits under the daily cap, and gives them back", async () => {
    expect(
      await service<boolean>("contact_credits_reserve($1, 3, 4)", [A]),
    ).toBe(true);
    expect(
      await service<boolean>("contact_credits_reserve($1, 3, 4)", [A]),
    ).toBe(false);
    expect(
      await service<boolean>("contact_credits_reserve($1, -3, 4)", [A]),
    ).toBe(true);
    expect(
      await service<boolean>("contact_credits_reserve($1, 3, 4)", [A]),
    ).toBe(true);
  });
});

describe("sequence settings", () => {
  it("stop a thread after one follow-up when that is the setting, and only admins change it", async () => {
    await expect(
      db.user(amy)(
        `select sequence_settings_save($1, 1, 3, 7, 'approve_first')`,
        [A],
      ),
    ).rejects.toThrow(/owner or admin/);
    await expect(
      db.user(alice)(
        `select sequence_settings_save($1, 1, 3, 7, 'approve_first')`,
        [B],
      ),
    ).rejects.toThrow(/owner or admin/);
    await db.user(alice)(`select sequence_settings_save($1, 1, 3, 7, 'auto')`, [
      A,
    ]);
    const [agent] = await db.admin<{ approval_mode: string }>(
      `select approval_mode from agents where workspace_id = $1 and role = 'outbound'`,
      [A],
    );
    expect(agent.approval_mode).toBe("auto");
    const box = await mailbox(A, "seq@a.example");
    const id = await lead(A, "seq@seq.example");
    const conv = await one(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'email') returning id`,
      [A, id],
    );
    const thread = await one(
      `insert into mail_threads (workspace_id, lead_id, conversation_id, mailbox_id, to_email, subject, next_followup_at)
       values ($1, $2, $3, $4, 'seq@seq.example', 'Hello', now()) returning id`,
      [A, id, conv, box],
    );
    await db.admin(`update mail_threads set followups_sent = 1 where id = $1`, [
      thread,
    ]);
    const [t] = await db.admin<{ status: string }>(
      `select status from mail_threads where id = $1`,
      [thread],
    );
    expect(t.status).toBe("finished");
    await expect(
      db.user(alice)(`select sequence_settings_save($1, 3, 3, 7, 'auto')`, [A]),
    ).rejects.toThrow(/out of range/);
  });
});
