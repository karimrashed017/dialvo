import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { ENGINE_SECRET_TABLES, ENGINE_TABLES } from "./engine-tables";

// Sequences (custom steps, up to five follow-ups, a language each),
// playbooks, lead routing, mailbox health and the chat's booking links,
// proved against the real migrations: one workspace can't see or change
// another's rows; a sequence's steps drive the follow-ups and every stop
// rule still ends them; a playbook picks by its filters and never breaks a
// play's rules; routing gives a lead to the right person and tells only
// them; a mailbox with too many bounces is paused; a booking is recorded
// once, on its own lead.

const DENIED = /row-level security|permission denied/;

let db: TestDb;
let alice: string; // owner of A
let amy: string; // member of A
let ann: string; // admin of A
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
    source?: string;
    fields?: Record<string, unknown>;
  } = {},
) =>
  one(
    `insert into leads (workspace_id, name, email, status, consent_email, source, custom_fields, created_at, updated_at)
     values ($1, 'Lead', $2, $3, $4, $5, $6::jsonb, now() - make_interval(days => $7), now() - make_interval(days => $7))
     returning id`,
    [
      ws,
      email,
      extra.status ?? "new",
      extra.consent ?? false,
      extra.source ?? "manual",
      JSON.stringify(extra.fields ?? {}),
      extra.days ?? 0,
    ],
  );

async function mailbox(ws: string, email: string) {
  return one(
    `insert into mailboxes (workspace_id, provider, email, sender_name, username, smtp_host, smtp_port, imap_host, imap_port)
     values ($1, 'other', $2, 'Sam', $2, 'smtp.example.com', 587, 'imap.example.com', 993) returning id`,
    [ws, email],
  );
}

const steps = (n: number) =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      wait_days: i + 1,
      angle: `Angle ${i + 1}`,
    })),
  );

async function sequence(
  user: string,
  ws: string,
  n: number,
  opts: { language?: string; approval?: string; isDefault?: boolean } = {},
) {
  const [{ id }] = await db.user(user)<{ id: string }>(
    `select sequence_save($1, null, 'Seq', $2, $3, $4::jsonb, $5) as id`,
    [
      ws,
      opts.language ?? "auto",
      opts.approval ?? "approve_first",
      steps(n),
      opts.isDefault ?? false,
    ],
  );
  return id;
}

/** A first email to a lead, from a campaign on a sequence, sent. */
async function sendFirst(
  ws: string,
  box: string,
  email: string,
  campaign: { sequence?: string | null; play?: string; language?: string },
) {
  const leadId = await lead(ws, email);
  const c = await one(
    `insert into outbound_campaigns (workspace_id, kind, name, sequence_id, language)
     values ($1, 'reactivation', 'C', $2, $3) returning id`,
    [ws, campaign.sequence ?? null, campaign.language ?? null],
  );
  const draft = await one(
    `insert into outbound_drafts (workspace_id, lead_id, campaign_id, to_email, play, status, subject, body)
     values ($1, $2, $3, $4, $5, 'approved', 'Hello', 'Body') returning id`,
    [ws, leadId, c, email, campaign.play ?? "reactivation"],
  );
  const first = await one(
    `insert into outbound_emails (workspace_id, lead_id, draft_id, mailbox_id, kind, to_email, subject, body, status)
     values ($1, $2, $3, $4, 'first', $5, 'Hello', 'Body', 'sending') returning id`,
    [ws, leadId, draft, box, email],
  );
  await db.admin(`select private.mail_mark_sent($1)`, [first]);
  const [thread] = await db.admin<{
    id: string;
    status: string;
    sequence_id: string | null;
    language: string;
    next_followup_at: string | null;
  }>(
    `select id, status, sequence_id, language, next_followup_at from mail_threads where lead_id = $1`,
    [leadId],
  );
  return { leadId, draft, thread };
}

type Followup = {
  email_id: string;
  step: number;
  total: number;
  angle: string;
  language: string;
};
const claimFollowups = async (ws: string) =>
  (
    await service<{ followups: Followup[] }>(
      "mail_write_claim($1, 20, 100, 3000000, 2)",
      [ws],
    )
  ).followups;

/** Makes the thread's next follow-up due, writes it, and sends it. */
async function runStep(ws: string, threadId: string) {
  await db.admin(
    `update mail_threads set next_followup_at = now() - interval '1 minute' where id = $1`,
    [threadId],
  );
  const items = (await claimFollowups(ws)).filter((f) =>
    f.email_id ? true : false,
  );
  const [mine] = await db.admin<{ id: string }>(
    `select id from outbound_emails where thread_id = $1 and status = 'writing'`,
    [threadId],
  );
  const item = items.find((f) => f.email_id === mine?.id);
  if (!item) return null;
  const saved = await service<string>(
    "mail_followup_save($1, $2, true, 'A follow-up', 'm', 0)",
    [ws, item.email_id],
  );
  await db.admin(
    `update outbound_emails set status = 'sending' where id = $1`,
    [item.email_id],
  );
  await db.admin(`select private.mail_mark_sent($1)`, [item.email_id]);
  return { item, saved };
}

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.createUser("alice@a.example", "Alice");
  amy = await db.createUser("amy@a.example", "Amy");
  ann = await db.createUser("ann@a.example", "Ann");
  bob = await db.createUser("bob@b.example", "Bob");
  [{ id: A }] = await db.user(alice)<{ id: string }>(
    `select create_workspace('Agency A', 'UTC', 'a.example', 'We sell A') as id`,
  );
  [{ id: B }] = await db.user(bob)<{ id: string }>(
    `select create_workspace('Agency B', 'UTC', null, 'We sell B') as id`,
  );
  await db.admin(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'admin')`,
    [A, amy, ann],
  );
  await db.admin(
    `insert into workspace_sending (workspace_id, sending_on, business_name, postal_address, allowed_confirmed_at)
     values ($1, true, 'A', '1 Road', now()), ($2, true, 'B', '2 Road', now())`,
    [A, B],
  );
});

afterAll(async () => {
  await db.close();
});

describe("one workspace and another", () => {
  it("can't read each other's sequences, playbooks, routing rules or booking links", async () => {
    const seq = await sequence(bob, B, 2);
    await db.user(bob)(
      `select playbook_save($1, null, 'Quiet', '{}'::jsonb, 'Check in', $2, 'auto', 'approve_first', 90)`,
      [B, seq],
    );
    await db.user(bob)(
      `select routing_rule_save($1, null, 'All', true, 0, '{}'::jsonb, 'one', array[$2]::uuid[])`,
      [B, bob],
    );
    const leadB = await lead(B, "visitor@b-site.example");
    const conv = await one(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'chat') returning id`,
      [B, leadB],
    );
    await db.admin(
      `insert into booking_links (workspace_id, conversation_id, lead_id, token) values ($1, $2, $3, $4)`,
      [B, conv, leadB, "b".repeat(64)],
    );
    for (const table of ENGINE_TABLES) {
      expect(await db.user(alice)(`select * from ${table}`), table).toEqual([]);
      expect(
        (await db.user(bob)(`select * from ${table}`)).length,
        table,
      ).toBeGreaterThan(0);
    }
    expect(
      await db.user(alice)(`select id, booked_at from booking_links`),
    ).toEqual([]);
    expect(
      (await db.user(bob)(`select id, booked_at from booking_links`)).length,
    ).toBe(1);
    // Nobody signed in ever reads a booking link's token.
    for (const table of ENGINE_SECRET_TABLES)
      await expect(db.user(bob)(`select token from ${table}`)).rejects.toThrow(
        DENIED,
      );
  });

  it("can't write to them directly, or through another workspace's functions", async () => {
    await expect(
      db.user(alice)(
        `insert into sequences (workspace_id, name) values ($1, 'Mine')`,
        [A],
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      db.user(alice)(
        `insert into routing_rules (workspace_id, name) values ($1, 'Mine')`,
        [A],
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      db.user(alice)(
        `insert into playbooks (workspace_id, name, goal) values ($1, 'Mine', 'x')`,
        [A],
      ),
    ).rejects.toThrow(DENIED);
    // Alice is no admin of B; Amy is only a member of A.
    await expect(
      db.user(alice)(
        `select sequence_save($1, null, 'X', 'auto', 'approve_first', '[]'::jsonb, false)`,
        [B],
      ),
    ).rejects.toThrow(/owner or admin/);
    await expect(
      db.user(amy)(
        `select sequence_save($1, null, 'X', 'auto', 'approve_first', '[]'::jsonb, false)`,
        [A],
      ),
    ).rejects.toThrow(/owner or admin/);
    await expect(
      db.user(amy)(
        `select playbook_save($1, null, 'X', '{}'::jsonb, 'x', null, 'auto', 'auto', 90)`,
        [A],
      ),
    ).rejects.toThrow(/owner or admin/);
    // B's sequence can't be named by A: not by a playbook, not by a search.
    const [seqB] = await db.admin<{ id: string }>(
      `select id from sequences where workspace_id = $1 limit 1`,
      [B],
    );
    await expect(
      db.user(alice)(
        `select playbook_save($1, null, 'X', '{}'::jsonb, 'x', $2, 'auto', 'approve_first', 90)`,
        [A, seqB.id],
      ),
    ).rejects.toThrow(/sequence not found/);
    const search = await one(
      `insert into prospect_searches (workspace_id, name, description, created_by) values ($1, 'S', 'd', $2) returning id`,
      [A, alice],
    );
    await expect(
      db.user(alice)(
        `update prospect_searches set sequence_id = $2 where id = $1`,
        [search, seqB.id],
      ),
    ).rejects.toThrow(/foreign key/);
    // A routing rule can't name someone outside the workspace.
    await expect(
      db.user(alice)(
        `select routing_rule_save($1, null, 'X', true, 0, '{}'::jsonb, 'one', array[$2]::uuid[])`,
        [A, bob],
      ),
    ).rejects.toThrow(/in the workspace/);
    // The server-only functions are the server's.
    for (const call of [
      `playbook_start('${A}', '${alice}', '${seqB.id}', 10)`,
      `playbook_auto_approve('${A}')`,
      `mail_health_check('${A}', 14, 3, 5, 5, 10)`,
      `booking_open('${"b".repeat(64)}')`,
      `chat_booking_offer('x', '${seqB.id}')`,
      `sequence_for_purpose('${A}', 'onboarding', 'O', '[]'::jsonb)`,
    ])
      await expect(db.user(alice)(`select ${call}`)).rejects.toThrow(
        /permission denied/,
      );
  });
});

describe("a sequence", () => {
  it("refuses more than five follow-ups and steps out of range", async () => {
    for (const bad of [
      steps(6),
      JSON.stringify([{ wait_days: 0 }]),
      JSON.stringify([{ wait_days: 61 }]),
      JSON.stringify([{ wait_days: 2.5 }]),
      JSON.stringify([{ wait_days: 2, angle: "x".repeat(601) }]),
      JSON.stringify({ wait_days: 2 }),
    ])
      await expect(
        db.user(alice)(
          `select sequence_save($1, null, 'Bad', 'auto', 'approve_first', $2::jsonb, false)`,
          [A, bad],
        ),
      ).rejects.toThrow(/out of range/);
    await expect(
      db.user(alice)(
        `select sequence_save($1, null, 'Bad', 'english', 'approve_first', '[]'::jsonb, false)`,
        [A],
      ),
    ).rejects.toThrow(/out of range/);
  });

  it("runs five follow-ups with each step's own wait and instructions, then finishes", async () => {
    const box = await mailbox(A, "five@a.example");
    const seq = await sequence(ann, A, 5, { language: "de" });
    const { thread } = await sendFirst(A, box, "five@five.example", {
      sequence: seq,
    });
    expect(thread.sequence_id).toBe(seq);
    expect(thread.language).toBe("de");
    expect(thread.status).toBe("active");
    // Step 1 waits one day after the first email.
    const wait = new Date(thread.next_followup_at!).getTime() - Date.now();
    expect(wait).toBeGreaterThan(23 * 3600_000);
    expect(wait).toBeLessThan(25 * 3600_000);
    for (let n = 1; n <= 5; n += 1) {
      const done = await runStep(A, thread.id);
      expect(done, `step ${n}`).not.toBeNull();
      expect(done!.item).toMatchObject({
        step: n,
        total: 5,
        angle: `Angle ${n}`,
        language: "de",
      });
      expect(done!.saved).toBe("draft");
    }
    const [t] = await db.admin<{ status: string; followups_sent: number }>(
      `select status, followups_sent from mail_threads where id = $1`,
      [thread.id],
    );
    expect(t).toEqual({ status: "finished", followups_sent: 5 });
    expect(await runStep(A, thread.id)).toBeNull();
  });

  it("stops at a reply, a bounce or an unsubscribe like any other", async () => {
    const box = await mailbox(A, "stop@a.example");
    const seq = await sequence(alice, A, 4, { approval: "auto" });
    for (const end of ["replied", "bounced", "unsubscribed"]) {
      const { thread } = await sendFirst(A, box, `stop-${end}@x.example`, {
        sequence: seq,
      });
      const done = await runStep(A, thread.id);
      expect(done!.saved).toBe("queued");
      await db.admin(
        `update mail_threads set status = $2, next_followup_at = now() - interval '1 minute' where id = $1`,
        [thread.id, end],
      );
      expect(await runStep(A, thread.id), end).toBeNull();
    }
  });

  it("takes the default sequence when none is named, and keeps a single-touch play single", async () => {
    const box = await mailbox(B, "default@b.example");
    const seq = await sequence(bob, B, 3, {
      isDefault: true,
      language: "fr",
    });
    const plain = await sendFirst(B, box, "plain@x.example", {});
    expect(plain.thread.sequence_id).toBe(seq);
    expect(plain.thread.language).toBe("fr");
    const single = await sendFirst(B, box, "single@x.example", {
      play: "expansion",
    });
    expect(single.thread.sequence_id).toBeNull();
    expect(single.thread.status).toBe("finished");
    // Onboarding with its own sequence runs it.
    const onboarding = await service<string>(
      `sequence_for_purpose($1, 'onboarding', 'Customer onboarding', $2::jsonb)`,
      [B, steps(2)],
    );
    const again = await service<string>(
      `sequence_for_purpose($1, 'onboarding', 'Other name', '[]'::jsonb)`,
      [B],
    );
    expect(again).toBe(onboarding);
    const onb = await sendFirst(B, box, "onb@x.example", {
      play: "onboarding",
      sequence: onboarding,
    });
    expect(onb.thread.status).toBe("active");
    expect(onb.thread.sequence_id).toBe(onboarding);
  });

  it("a campaign's own language wins over its sequence's", async () => {
    const box = await mailbox(B, "lang@b.example");
    const seq = await sequence(bob, B, 1, { language: "es" });
    const { draft, thread } = await sendFirst(B, box, "lang@x.example", {
      sequence: seq,
      language: "it",
    });
    const [d] = await db.admin<{ language: string; sequence_id: string }>(
      `select language, sequence_id from outbound_drafts where id = $1`,
      [draft],
    );
    expect(d).toEqual({ language: "it", sequence_id: seq });
    expect(thread.language).toBe("it");
  });

  it("leaves a thread without a sequence on the old two follow-ups", async () => {
    const box = await mailbox(A, "old@a.example");
    // A's default from earlier tests would apply: archive any.
    for (const s of await db.admin<{ id: string }>(
      `select id from sequences where workspace_id = $1 and is_default`,
      [A],
    ))
      await db.user(alice)(`select sequence_archive($1, $2)`, [A, s.id]);
    const { thread } = await sendFirst(A, box, "old@x.example", {});
    expect(thread.sequence_id).toBeNull();
    expect((await runStep(A, thread.id))!.item.total).toBe(2);
    expect((await runStep(A, thread.id))!.item.step).toBe(2);
    expect(await runStep(A, thread.id)).toBeNull();
  });
});

describe("a playbook", () => {
  it("picks by stage, source and inactivity, keeps every play rule, and runs like a play", async () => {
    const quiet = await lead(A, "quiet@pb.example", {
      status: "engaged",
      days: 60,
      source: "Webinar",
    });
    await lead(A, "fresh@pb.example", {
      status: "engaged",
      days: 1,
      source: "webinar",
    });
    await lead(A, "other-source@pb.example", {
      status: "engaged",
      days: 60,
      source: "manual",
    });
    const dnc = await lead(A, "dnc@pb.example", {
      status: "engaged",
      days: 60,
      source: "webinar",
    });
    await db.admin(`update leads set do_not_contact = true where id = $1`, [
      dnc,
    ]);
    // A customer without consent or a conversation is never picked.
    await lead(A, "customer@pb.example", {
      status: "won",
      days: 60,
      source: "webinar",
    });
    const seq = await sequence(alice, A, 2, { language: "nl" });
    const [{ id: pb }] = await db.user(alice)<{ id: string }>(
      `select playbook_save($1, null, 'Webinar, gone quiet', $2::jsonb, 'Offer the recording', $3, 'auto', 'approve_first', 90) as id`,
      [
        A,
        JSON.stringify({
          statuses: ["engaged", "won"],
          sources: ["webinar"],
          inactive_days: 30,
        }),
        seq,
      ],
    );
    expect(
      await service<{ count: number }>("playbook_preview($1, $2, $3, 50)", [
        A,
        amy,
        pb,
      ]),
    ).toEqual({ count: 1 });
    // A member can run it; someone outside can't.
    expect(
      (
        await service<{ status: string }>("playbook_start($1, $2, $3, 50)", [
          A,
          bob,
          pb,
        ])
      ).status,
    ).toBe("not_found");
    const started = await service<{ status: string; selected: number }>(
      "playbook_start($1, $2, $3, 50)",
      [A, amy, pb],
    );
    expect(started).toMatchObject({ status: "created", selected: 1 });
    expect(
      (
        await service<{ status: string }>("playbook_start($1, $2, $3, 50)", [
          A,
          amy,
          pb,
        ])
      ).status,
    ).toBe("empty");
    const claim = await service<{
      drafts: { draft_id: string; play: string; lead: { why_now: string } }[];
    }>("campaign_draft_claim($1, $2, 10, 100, 3000000, 2)", [A, amy]);
    const mine = claim.drafts.filter((d) => d.play === "playbook");
    expect(mine.length).toBe(1);
    expect(mine[0].lead.why_now).toMatch(/^No activity since/);
    const [d] = await db.admin<{
      lead_id: string;
      sequence_id: string;
      language: string;
      guidance: string;
    }>(
      `select lead_id, sequence_id, language, guidance from outbound_drafts where id = $1`,
      [mine[0].draft_id],
    );
    expect(d).toEqual({
      lead_id: quiet,
      sequence_id: seq,
      language: "nl",
      guidance: "Offer the recording",
    });
    // Waits for approval: auto-approve does nothing.
    await service(
      "outbound_draft_save($1, $2, true, 'Recording', 'Hi', 'm', 0)",
      [A, mine[0].draft_id],
    );
    expect(await service<number>("playbook_auto_approve($1)", [A])).toBe(0);
    // Switched to send on its own by an admin: approved, by that admin.
    await db.user(ann)(
      `select playbook_save($1, $2, 'Webinar, gone quiet', '{"statuses":["engaged"]}'::jsonb, 'Offer the recording', $3, 'auto', 'auto', 90)`,
      [A, pb, seq],
    );
    expect(await service<number>("playbook_auto_approve($1)", [A])).toBe(1);
    const [after] = await db.admin<{ status: string; decided_by: string }>(
      `select status, decided_by from outbound_drafts where id = $1`,
      [mine[0].draft_id],
    );
    expect(after).toEqual({ status: "approved", decided_by: ann });
  });

  it("refuses filters it doesn't know", async () => {
    for (const bad of [
      { statuses: ["unsubscribed"] },
      { inactive_days: 0 },
      { sources: [""] },
      { sources: "webinar" },
    ])
      await expect(
        db.user(alice)(
          `select playbook_save($1, null, 'Bad', $2::jsonb, 'x', null, 'auto', 'approve_first', 90)`,
          [A, JSON.stringify(bad)],
        ),
      ).rejects.toThrow(/out of range/);
  });
});

describe("lead routing", () => {
  it("gives a new lead to the first matching rule's person, and alerts only them", async () => {
    await db.user(alice)(
      `select routing_rule_save($1, null, 'UK', true, 0, '{"countries":["GB","United Kingdom"]}'::jsonb, 'one', array[$2]::uuid[])`,
      [A, amy],
    );
    await db.user(alice)(
      `select routing_rule_save($1, null, 'Big', true, 1, '{"size_min":200}'::jsonb, 'one', array[$2]::uuid[])`,
      [A, ann],
    );
    await db.user(alice)(
      `select routing_rule_save($1, null, 'Forms', true, 2, '{"sources":["form"]}'::jsonb, 'round_robin', array[$2, $3]::uuid[])`,
      [A, amy, ann],
    );
    const uk = await lead(A, "uk@route.example", {
      fields: { country: "United Kingdom", company_size: "1000+" },
    });
    const big = await lead(A, "big@route.example", {
      fields: { company_size: "201-500" },
    });
    const small = await lead(A, "small@route.example", {
      fields: { company_size: "11-50" },
    });
    const owners = await db.admin<{ id: string; owner_id: string | null }>(
      `select id, owner_id from leads where id = any($1::uuid[])`,
      [[uk, big, small]],
    );
    const owner = (id: string) => owners.find((o) => o.id === id)!.owner_id;
    expect(owner(uk)).toBe(amy);
    expect(owner(big)).toBe(ann);
    expect(owner(small)).toBeNull();
    const alerts = await db.admin<{ recipient_user_id: string }>(
      `select recipient_user_id from team_alerts where lead_id = $1 and kind = 'lead_assigned'`,
      [uk],
    );
    expect(alerts).toEqual([{ recipient_user_id: amy }]);
    // Round robin takes turns.
    const f1 = await lead(A, "f1@route.example", { source: "form" });
    const f2 = await lead(A, "f2@route.example", { source: "Form" });
    const f3 = await lead(A, "f3@route.example", { source: "form" });
    const rr = await db.admin<{ id: string; owner_id: string }>(
      `select id, owner_id from leads where id = any($1::uuid[])`,
      [[f1, f2, f3]],
    );
    const by = (id: string) => rr.find((o) => o.id === id)!.owner_id;
    expect(by(f1)).not.toBe(by(f2));
    expect(by(f3)).toBe(by(f1));
    // A conversation with a routed lead goes to its owner.
    const conv = await one(
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'chat') returning id`,
      [A, uk],
    );
    const [c] = await db.admin<{ assigned_to: string }>(
      `select assigned_to from conversations where id = $1`,
      [conv],
    );
    expect(c.assigned_to).toBe(amy);
    // The personal alert goes only to that person; B's rules never touch A.
    await db.admin(`update profiles set alert_emails = true`);
    const claimed = await service<{
      alerts: { kind: string; to: string[]; lead_id: string }[];
    }>("mail_claim_team_alerts($1)", [A]);
    const assigned = claimed.alerts.filter(
      (a) => a.kind === "lead_assigned" && a.lead_id === uk,
    );
    expect(assigned.map((a) => a.to)).toEqual([["amy@a.example"]]);
  });

  it("routes by play when the first email's thread starts", async () => {
    await db.user(bob)(
      `select routing_rule_save($1, null, 'Reactivation', true, 0, '{"plays":["reactivation"]}'::jsonb, 'one', array[$2]::uuid[])`,
      [B, bob],
    );
    // B's catch-all rule from the first test would take it on insert: drop it.
    for (const r of await db.admin<{ id: string }>(
      `select id from routing_rules where workspace_id = $1 and name = 'All'`,
      [B],
    ))
      await db.user(bob)(`select routing_rule_delete($1, $2)`, [B, r.id]);
    const box = await mailbox(B, "route@b.example");
    const { leadId } = await sendFirst(B, box, "play-route@x.example", {
      play: "reactivation",
    });
    const [l] = await db.admin<{ owner_id: string }>(
      `select owner_id from leads where id = $1`,
      [leadId],
    );
    expect(l.owner_id).toBe(bob);
  });
});

describe("mailbox health", () => {
  it("pauses a mailbox whose bounces are over the limit, and resuming starts afresh", async () => {
    const box = await mailbox(B, "bouncy@b.example");
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const l = await lead(B, `bounce${i}@x.example`);
      ids.push(
        await one(
          `insert into outbound_emails (workspace_id, lead_id, mailbox_id, kind, to_email, subject, body, status, sent_at)
           values ($1, $2, $3, 'first', $4, 'S', 'B', 'sent', now()) returning id`,
          [B, l, box, `bounce${i}@x.example`],
        ),
      );
    }
    await db.admin(
      `update outbound_emails set bounced_at = now() where id = any($1::uuid[])`,
      [ids.slice(0, 2)],
    );
    expect(
      await service<number>("mail_health_check($1, 14, 3, 5, 5, 10)", [B]),
    ).toBe(0);
    await db.admin(
      `update outbound_emails set bounced_at = now() where id = $1`,
      [ids[2]],
    );
    expect(
      await service<number>("mail_health_check($1, 14, 3, 5, 5, 10)", [B]),
    ).toBe(1);
    const [m] = await db.admin<{ status: string; pause_reason: string }>(
      `select status, pause_reason from mailboxes where id = $1`,
      [box],
    );
    expect(m).toEqual({ status: "paused", pause_reason: "bounce_rate" });
    const [alert] = await db.admin<{ summary: string }>(
      `select summary from team_alerts where workspace_id = $1 and kind = 'mailbox_health'`,
      [B],
    );
    expect(alert.summary).toMatch(/3 of the last 10 emails bounced/);
    // A's numbers are A's.
    expect(
      await db.user(alice)<{ r: unknown[] }>(
        `select mailbox_health_stats($1, 14) as r`,
        [B],
      ),
    ).toEqual([{ r: [] }]);
    await db.user(bob)(`select mailbox_resume($1)`, [box]);
    expect(
      await service<number>("mail_health_check($1, 14, 3, 5, 5, 10)", [B]),
    ).toBe(0);
    // Members store a DNS check; nobody outside can.
    await db.user(bob)(
      `select mailbox_dns_save($1, '{"domain":"b.example"}'::jsonb)`,
      [box],
    );
    await expect(
      db.user(alice)(`select mailbox_dns_save($1, '{"domain":"x"}'::jsonb)`, [
        box,
      ]),
    ).rejects.toThrow(/not found/);
  });
});

describe("booking from the website chat", () => {
  it("records a booking once, on its own lead, with a meeting when the time is known", async () => {
    await db.admin(
      `update workspace_sending set booking_url = 'https://cal.example/a' where workspace_id = $1`,
      [A],
    );
    const [w] = await db.admin<{ token: string }>(
      `select token from chat_widgets where workspace_id = $1 limit 1`,
      [A],
    );
    const widget =
      w?.token ??
      (
        await db.admin<{ token: string }>(
          `insert into chat_widgets (workspace_id) values ($1) returning token`,
          [A],
        )
      )[0].token;
    const visitor = await lead(A, "booker@visit.example", {
      status: "qualified",
    });
    const conv = await one(
      `insert into conversations (workspace_id, lead_id, channel, widget_id)
       values ($1, $2, 'chat', (select id from chat_widgets where token = $3)) returning id`,
      [A, visitor, widget],
    );
    expect(
      await service<string>("chat_booking_url($1, $2)", [widget, conv]),
    ).toBe("https://cal.example/a");
    const link = await service<string>("chat_booking_offer($1, $2)", [
      widget,
      conv,
    ]);
    expect(link).toMatch(/^[0-9a-f]{64}$/);
    // Asking again before a booking gives the same link.
    expect(
      await service<string>("chat_booking_offer($1, $2)", [widget, conv]),
    ).toBe(link);
    // Another workspace's widget gets nothing for this conversation.
    expect(await service("chat_booking_offer($1, $2)", ["nope", conv])).toBe(
      null,
    );
    expect(await service<string>("booking_open($1)", [link])).toBe(
      "https://cal.example/a",
    );
    const starts = new Date(Date.now() + 2 * 86400_000).toISOString();
    expect(
      await service<{ status: string }>(
        "booking_done($1, $2::timestamptz, null)",
        [link, starts],
      ),
    ).toEqual({ status: "booked" });
    expect(
      await service<{ status: string }>(
        "booking_done($1, $2::timestamptz, null)",
        [link, starts],
      ),
    ).toEqual({ status: "already" });
    expect(
      await service<{ status: string }>("booking_done($1, null, null)", [
        "c".repeat(64),
      ]),
    ).toEqual({ status: "invalid" });
    const [l] = await db.admin<{ status: string }>(
      `select status from leads where id = $1`,
      [visitor],
    );
    expect(l.status).toBe("meeting_booked");
    const meetings = await db.admin<{ booked_by: string; channel: string }>(
      `select booked_by, channel from meetings where lead_id = $1`,
      [visitor],
    );
    expect(meetings).toEqual([{ booked_by: "lead", channel: "chat" }]);
    // Without a time from the booking page, no meeting row is invented.
    const visitor2 = await lead(A, "booker2@visit.example");
    const conv2 = await one(
      `insert into conversations (workspace_id, lead_id, channel, widget_id)
       values ($1, $2, 'chat', (select id from chat_widgets where token = $3)) returning id`,
      [A, visitor2, widget],
    );
    const link2 = await service<string>("chat_booking_offer($1, $2)", [
      widget,
      conv2,
    ]);
    await service("booking_done($1, null, null)", [link2]);
    expect(
      await db.admin(`select id from meetings where lead_id = $1`, [visitor2]),
    ).toEqual([]);
  });
});
