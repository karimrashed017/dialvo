import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";
import { CHANNEL_TABLES } from "./channel-tables";

// The phone agent, outbound calls, numbers, SMS and the multi-channel
// sequence steps, proved against the real migrations: one workspace can't
// see or change another's rows; only owners buy numbers and only owners or
// admins approve calls; every outbound call rule (consent, do not contact,
// do-not-call list, time zone, call window, approval, the switch and both
// caps); STOP and START; and steps on other channels that stop when the
// lead replies anywhere. Twilio is never involved: these are the database's
// rules alone.

const DENIED = /row-level security|permission denied/;

let db: TestDb;
let alice: string; // owner of A
let amy: string; // member of A
let adam: string; // admin of A
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

/** A zone where the local hour is `hour` right now (Etc/GMT signs are reversed). */
function zoneAt(hour: number) {
  let offset = hour - new Date().getUTCHours();
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  return offset === 0
    ? "Etc/GMT"
    : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}
const OPEN_ZONE = () => zoneAt(12);
const EVERY_DAY = {
  days: [1, 2, 3, 4, 5, 6, 7],
  start: "09:00",
  end: "20:00",
};

let phoneSeq = 1000;
const lead = (
  ws: string,
  o: {
    phone?: string | null;
    call?: boolean;
    sms?: boolean;
    tz?: string | null;
    dnc?: boolean;
    name?: string;
  } = {},
) =>
  one(
    `insert into leads (workspace_id, name, phone, time_zone, consent_call, consent_call_source, consent_sms, consent_sms_source, do_not_contact)
     values ($1, $2, $3, $4, $5, case when $5 then 'Asked on the form' end, $6, case when $6 then 'Ticked the texting box' end, $7)
     returning id`,
    [
      ws,
      o.name ?? "Pat Lee",
      o.phone === undefined ? `+1415555${phoneSeq++}` : o.phone,
      o.tz === undefined ? OPEN_ZONE() : o.tz,
      o.call ?? true,
      o.sms ?? false,
      o.dnc ?? false,
    ],
  );

const settings = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    agent_on: true,
    greeting: "",
    voice: "Polly.Joanna-Neural",
    language: "en-US",
    transfer_number: "+14155550100",
    recording_on: false,
    outbound_on: true,
    call_window: EVERY_DAY,
    daily_call_cap: 50,
    max_call_minutes: 10,
    sms_on: true,
    sms_daily_cap: 100,
    a2p_brand_status: "approved",
    a2p_campaign_status: "approved",
    messaging_service_sid: "",
    ...overrides,
  });

async function buyNumber(ws: string, owner: string, e164: string) {
  const r = await service<{ status: string; id: string }>(
    "phone_number_reserve($1, $2, $3, 'US', 'local', 1150000, 'USD', 3)",
    [ws, owner, e164],
  );
  expect(r.status).toBe("ok");
  await service("phone_number_bought($1, $2, $3)", [
    ws,
    r.id,
    "PN" + "a".repeat(30) + String(phoneSeq++).slice(-2),
  ]);
  return r.id;
}

const callSid = () => "CA" + crypto.randomUUID().replace(/-/g, "");
const smsSid = () => "SM" + crypto.randomUUID().replace(/-/g, "");

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.createUser("alice@a.example", "Alice");
  amy = await db.createUser("amy@a.example", "Amy");
  adam = await db.createUser("adam@a.example", "Adam");
  bob = await db.createUser("bob@b.example", "Bob");
  [{ id: A }] = await db.user(alice)<{ id: string }>(
    `select create_workspace('Agency A', 'UTC', 'a.example', 'We sell A') as id`,
  );
  [{ id: B }] = await db.user(bob)<{ id: string }>(
    `select create_workspace('Agency B', 'UTC', null, 'We sell B') as id`,
  );
  await db.admin(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'admin')`,
    [A, amy, adam],
  );
  await db.user(alice)(`select phone_settings_save($1, $2::jsonb)`, [
    A,
    settings(),
  ]);
  await db.user(bob)(`select phone_settings_save($1, $2::jsonb)`, [
    B,
    settings(),
  ]);
});

afterAll(async () => {
  await db.close();
});

describe("one workspace and another", () => {
  it("can't read each other's phone, call, text or step rows", async () => {
    const number = await buyNumber(B, bob, "+14155550199");
    const leadB = await lead(B, { sms: true });
    expect(leadB).toBeTruthy();
    await db.user(bob)(
      `insert into phone_opt_outs (workspace_id, phone, channel, source, added_by) values ($1, '+14155550198', 'call', 'person', $2)`,
      [B, bob],
    );
    await service("sms_inbound('+14155550199', '+14155550197', 'Hello', $1)", [
      smsSid(),
    ]);
    const step = await one(
      `insert into sequence_channel_steps (workspace_id, channel, day_offset, message) values ($1, 'linkedin', 2, 'Hi {first_name}') returning id`,
      [B],
    );
    expect(number && step).toBeTruthy();

    for (const table of CHANNEL_TABLES) {
      const all = await db.admin(
        `select 1 from ${table} where workspace_id = $1`,
        [B],
      );
      // No call batches can exist any more (no outbound calls), and runs
      // only appear once a sequence ticks.
      if (
        !["sequence_channel_runs", "call_batches", "call_batch_leads"].includes(
          table,
        )
      )
        expect(all.length, table).toBeGreaterThan(0);
      for (const who of [alice, amy, adam]) {
        expect(
          await db.user(who)(`select 1 from ${table} where workspace_id = $1`, [
            B,
          ]),
          table,
        ).toEqual([]);
        // No update grant on any of them: every change goes through a function.
        await expect(
          db.user(who)(
            `update ${table} set workspace_id = workspace_id where workspace_id = $1`,
            [B],
          ),
        ).rejects.toThrow(DENIED);
      }
    }
    // Nobody signed out sees anything.
    for (const table of CHANNEL_TABLES)
      await expect(
        db.as({ role: "anon" }, `select 1 from ${table}`),
      ).rejects.toThrow(DENIED);
  });

  it("can't write to the other's do-not-call list, settings or steps", async () => {
    await expect(
      db.user(alice)(
        `insert into phone_opt_outs (workspace_id, phone, channel, source, added_by) values ($1, '+14155550111', 'call', 'person', $2)`,
        [B, alice],
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      db.user(alice)(`select phone_settings_save($1, $2::jsonb)`, [
        B,
        settings({ outbound_on: false }),
      ]),
    ).rejects.toThrow(/only an owner or admin/);
    await expect(
      db.user(alice)(
        `select channel_step_save($1, null, 'sequences', 'sms', 1, 'Hi', '', 6)`,
        [B],
      ),
    ).rejects.toThrow(/only an owner or admin/);
    const [stepB] = await db.admin<{ id: string }>(
      `select id from sequence_channel_steps where workspace_id = $1`,
      [B],
    );
    expect(
      (
        await db.user(alice)<{ r: boolean }>(
          `select channel_step_remove($1) as r`,
          [stepB.id],
        )
      )[0].r,
    ).toBe(false);
  });

  it("keeps the server's functions away from signed-in people and visitors", async () => {
    for (const fn of [
      "call_claim(5, 20, 0.15)",
      "channel_tick(20)",
      "channel_sms_claim(5)",
      "call_context(gen_random_uuid())",
      "sms_inbound('+1', '+1', 'x', 'SMx')",
    ]) {
      await expect(db.user(alice)(`select ${fn}`)).rejects.toThrow(DENIED);
      await expect(db.as({ role: "anon" }, `select ${fn}`)).rejects.toThrow(
        DENIED,
      );
    }
  });
});

describe("numbers", () => {
  it("are bought by an owner only, up to the cap, and one workspace at a time", async () => {
    expect(
      await service<{ status: string }>(
        "phone_number_reserve($1, $2, '+14155550120', 'US', 'local', 1150000, 'USD', 3)",
        [A, adam],
      ),
    ).toEqual({ status: "not_owner" });
    // B already holds +14155550199.
    expect(
      await service<{ status: string }>(
        "phone_number_reserve($1, $2, '+14155550199', 'US', 'local', 1150000, 'USD', 3)",
        [A, alice],
      ),
    ).toEqual({ status: "taken" });
    await buyNumber(A, alice, "+14155550121");
    await buyNumber(A, alice, "+14155550122");
    await buyNumber(A, alice, "+14155550123");
    expect(
      await service<{ status: string }>(
        "phone_number_reserve($1, $2, '+14155550124', 'US', 'local', 1150000, 'USD', 3)",
        [A, alice],
      ),
    ).toEqual({ status: "cap" });
    const [n] = await db.admin<{ id: string }>(
      `select id from phone_numbers where e164 = '+14155550123'`,
    );
    expect(
      await service("phone_number_released($1, $2, $3)", [A, adam, n.id]),
    ).toBe(false);
    expect(
      await service("phone_number_released($1, $2, $3)", [A, alice, n.id]),
    ).toBe(true);
    // A failed purchase gives the hold back.
    const r = await service<{ status: string; id: string }>(
      "phone_number_reserve($1, $2, '+14155550125', 'US', 'local', 1150000, 'USD', 3)",
      [A, alice],
    );
    await service("phone_number_bought($1, $2, null)", [A, r.id]);
    expect(
      await db.admin(`select 1 from phone_numbers where id = $1`, [r.id]),
    ).toEqual([]);
  });

  it("have caps and health a member can't change but an admin can", async () => {
    const [n] = await db.admin<{ id: string }>(
      `select id from phone_numbers where e164 = '+14155550121'`,
    );
    const update = (who: string) =>
      db.user(who)<{ r: boolean }>(
        `select phone_number_update($1, 10, 'clean', 'submitted', 'approved') as r`,
        [n.id],
      );
    expect((await update(amy))[0].r).toBe(false);
    expect((await update(bob))[0].r).toBe(false);
    expect((await update(adam))[0].r).toBe(true);
    expect(
      await db.admin(
        `select daily_call_cap, spam_status, shaken_status from phone_numbers where id = $1`,
        [n.id],
      ),
    ).toEqual([
      { daily_call_cap: 10, spam_status: "clean", shaken_status: "approved" },
    ]);
  });
});

describe("an incoming call", () => {
  it("is answered for the workspace that owns the number, and logged on the lead", async () => {
    const sid = callSid();
    const begun = await service<{ call_id: string; over_cap: boolean }>(
      "call_inbound_begin('+14155550121', '+1 (415) 555-7000', $1, 200)",
      [sid],
    );
    expect(begun.over_cap).toBe(false);
    // A retried webhook is the same call.
    expect(
      (
        await service<{ call_id: string }>(
          "call_inbound_begin('+14155550121', '+14155557000', $1, 200)",
          [sid],
        )
      ).call_id,
    ).toBe(begun.call_id);
    const context = await service<{
      call: { workspace_id: string; direction: string };
      workspace: { name: string };
      knowledge: { title: string }[];
    }>("call_context($1)", [begun.call_id]);
    expect(context.call.workspace_id).toBe(A);
    expect(context.workspace.name).toBe("Agency A");
    expect(context.knowledge.map((k) => k.title)).toContain("What we sell");

    const turn = await service<{ alert_to: string[] }>(
      "call_turn_commit($1, 'I want a quote, I am Sam', 'Happy to help, Sam.', $2::jsonb)",
      [
        begun.call_id,
        JSON.stringify({
          outcome: "qualified",
          summary: "Sam wants a quote.",
          caller_name: "Sam",
        }),
      ],
    );
    expect(turn.alert_to).toEqual([]);
    const handoff = await service<{ alert_to: string[] }>(
      "call_turn_commit($1, 'Can I talk to a person?', 'Putting you through.', $2::jsonb)",
      [begun.call_id, JSON.stringify({ outcome: "none", handoff: true })],
    );
    expect(handoff.alert_to.sort()).toEqual([
      "adam@a.example",
      "alice@a.example",
      "amy@a.example",
    ]);
    await service("call_status($1, 'completed', 42, null, null)", [sid]);
    const [call] = await db.admin<{
      status: string;
      duration_seconds: number;
      transcript: { speaker: string }[];
      outcome: string;
      lead_id: string;
      conversation_id: string;
    }>(`select * from calls where id = $1`, [begun.call_id]);
    expect(call).toMatchObject({
      status: "completed",
      duration_seconds: 42,
      outcome: "qualified",
    });
    expect(call.transcript.map((t) => t.speaker)).toEqual([
      "lead",
      "agent",
      "lead",
      "agent",
    ]);
    expect(
      await db.admin(`select name, status, source from leads where id = $1`, [
        call.lead_id,
      ]),
    ).toEqual([{ name: "Sam", status: "qualified", source: "phone" }]);
    expect(
      await db.admin(
        `select channel, status from conversations where id = $1`,
        [call.conversation_id],
      ),
    ).toEqual([{ channel: "voice", status: "waiting_for_you" }]);
    expect(
      (
        await db.user(amy)(
          `select 1 from messages where conversation_id = $1`,
          [call.conversation_id],
        )
      ).length,
    ).toBe(4);
    expect(
      await db.user(bob)(`select 1 from calls where id = $1`, [begun.call_id]),
    ).toEqual([]);
  });

  it("isn't anyone's when the number isn't, and says when the day's cap is reached", async () => {
    expect(
      await service(
        "call_inbound_begin('+14155550999', '+14155557001', $1, 200)",
        [callSid()],
      ),
    ).toBeNull();
    expect(
      (
        await service<{ over_cap: boolean }>(
          "call_inbound_begin('+14155550121', '+14155557001', $1, 1)",
          [callSid()],
        )
      ).over_cap,
    ).toBe(true);
  });

  it("puts a caller who asks on the do-not-call list and withdraws their consent", async () => {
    const leadId = await lead(A, { phone: "+14155557002" });
    const begun = await service<{ call_id: string }>(
      "call_inbound_begin('+14155550121', '+14155557002', $1, 200)",
      [callSid()],
    );
    await service(
      "call_turn_commit($1, 'Never call me again', 'Understood.', $2::jsonb)",
      [begun.call_id, JSON.stringify({ outcome: "none", stop_calls: true })],
    );
    expect(
      await db.admin(
        `select consent_call, do_not_contact from leads where id = $1`,
        [leadId],
      ),
    ).toEqual([{ consent_call: false, do_not_contact: false }]);
    expect(
      await db.admin(
        `select channel, source from phone_opt_outs where workspace_id = $1 and phone = '+14155557002'`,
        [A],
      ),
    ).toEqual([{ channel: "call", source: "call" }]);
  });
});

describe("outbound calls", () => {
  it("can't be made at all: no batches, no claims, no outbound rows, no call tasks", async () => {
    const leadA = await lead(A, { call: true });
    await expect(
      db.user(alice)(
        `select call_batch_create($1, 'Callbacks', '', array[$2]::uuid[], 200, 5)`,
        [A, leadA],
      ),
    ).rejects.toThrow(/does not make outbound calls/);
    await expect(
      db.admin(
        `insert into call_batches (workspace_id, name) values ($1, 'x')`,
        [A],
      ),
    ).rejects.toThrow(/call_batches_none/);
    expect(
      (
        await db.user(alice)<{ r: boolean }>(
          `select call_batch_decide(gen_random_uuid(), true) as r`,
        )
      )[0].r,
    ).toBe(false);
    expect(await service("call_claim(20, 20, 0.15)")).toEqual([]);
    await expect(
      db.admin(
        `insert into calls (workspace_id, lead_id, direction) values ($1, $2, 'outbound')`,
        [A, leadA],
      ),
    ).rejects.toThrow(/calls_inbound_only/);
    await expect(
      db.user(adam)(
        `select channel_step_save($1, null, 'sequences', 'call_task', 2, '', 'Ask about timing', 6)`,
        [A],
      ),
    ).rejects.toThrow(/sequence_channel_steps_no_calls|call_task/);
  });
});

describe("texts", () => {
  it("STOP opts the number out and START opts it back in", async () => {
    const leadId = await lead(A, { phone: "+14155557010", sms: true });
    expect(
      (
        await service<{ kind: string }>(
          "sms_inbound('+14155550121', '+14155557010', ' Stop ', $1)",
          [smsSid()],
        )
      ).kind,
    ).toBe("stop");
    expect(
      await db.admin(`select consent_sms from leads where id = $1`, [leadId]),
    ).toEqual([{ consent_sms: false }]);
    // Nobody can take a STOP off the list by hand, not even the owner.
    expect(
      (
        await db.user(alice)(
          `delete from phone_opt_outs where workspace_id = $1 and phone = '+14155557010'`,
          [A],
        )
      ).affected,
    ).toBe(0);
    expect(
      (
        await service<{ kind: string }>(
          "sms_inbound('+14155550121', '+14155557010', 'START', $1)",
          [smsSid()],
        )
      ).kind,
    ).toBe("start");
    expect(
      await db.admin(
        `select consent_sms, consent_sms_source like 'Texted START%' as noted from leads where id = $1`,
        [leadId],
      ),
    ).toEqual([{ consent_sms: true, noted: true }]);
    expect(
      await db.admin(
        `select 1 from phone_opt_outs where workspace_id = $1 and phone = '+14155557010'`,
        [A],
      ),
    ).toEqual([]);
  });

  it("a message waits for the team, once even if the webhook repeats", async () => {
    const sid = smsSid();
    const r = await service<{ kind: string; lead_id: string }>(
      "sms_inbound('+14155550121', '+14155557011', 'Is Tuesday OK?', $1)",
      [sid],
    );
    expect(r.kind).toBe("message");
    expect(
      (
        await service<{ kind: string }>(
          "sms_inbound('+14155550121', '+14155557011', 'Is Tuesday OK?', $1)",
          [sid],
        )
      ).kind,
    ).toBe("repeat");
    expect(
      await db.admin(
        `select c.status, count(m.*)::int as n from conversations c join messages m on m.conversation_id = c.id
         where c.lead_id = $1 and c.channel = 'sms' group by c.status`,
        [r.lead_id],
      ),
    ).toEqual([{ status: "waiting_for_you", n: 1 }]);
  });
});

describe("sequence steps on other channels", () => {
  let mailbox: string;
  async function sequence(ws: string, leadId: string, daysAgo = 0) {
    const conv = await one(
      `insert into conversations (workspace_id, lead_id, channel, created_at) values ($1, $2, 'email', now() - make_interval(days => $3)) returning id`,
      [ws, leadId, daysAgo],
    );
    return one(
      `insert into mail_threads (workspace_id, lead_id, conversation_id, mailbox_id, to_email, subject, first_sent_at)
       values ($1, $2, $3, $4, $5, 'Hello', now() - make_interval(days => $6)) returning id`,
      [ws, leadId, conv, mailbox, `l${phoneSeq++}@x.example`, daysAgo],
    );
  }
  const tick = () => service<{ scheduled: number }>("channel_tick(20)");
  const runs = (thread: string) =>
    db.admin<{
      channel: string;
      status: string;
      skip_reason: string | null;
      body: string | null;
      profile_url: string | null;
      id: string;
    }>(
      `select r.id, r.channel, r.status, r.skip_reason, r.body, r.profile_url from sequence_channel_runs r
       join sequence_channel_steps s on s.id = r.step_id where r.thread_id = $1 order by s.day_offset`,
      [thread],
    );

  beforeAll(async () => {
    mailbox = await one(
      `insert into mailboxes (workspace_id, provider, email, sender_name, username, smtp_host, smtp_port, imap_host, imap_port)
       values ($1, 'other', 'sam@a.example', 'Sam', 'sam@a.example', 'smtp.example.com', 587, 'imap.example.com', 993) returning id`,
      [A],
    );
    // Only an owner or admin adds steps, and only so many.
    await expect(
      db.user(amy)(
        `select channel_step_save($1, null, 'sequences', 'linkedin', 0, 'Hi {first_name}', '', 6)`,
        [A],
      ),
    ).rejects.toThrow(/only an owner or admin/);
    await db.user(adam)(
      `select channel_step_save($1, null, 'sequences', 'linkedin', 0, 'Hi {first_name}, saw {company}.', '', 6)`,
      [A],
    );
    await db.user(adam)(
      `select channel_step_save($1, null, 'sequences', 'sms', 1, 'Quick note from Sam.', '', 6)`,
      [A],
    );
  });

  it("are scheduled per sequence, with the reason when one can't run", async () => {
    const withConsent = await lead(A, { sms: true, name: "Kim Park" });
    await db.admin(`update leads set company = 'Parkworks' where id = $1`, [
      withConsent,
    ]);
    const without = await lead(A, { sms: false });
    const t1 = await sequence(A, withConsent);
    const t2 = await sequence(A, without);
    await tick();
    expect((await runs(t1)).map((r) => [r.channel, r.status])).toEqual([
      ["linkedin", "due"],
      ["sms", "scheduled"],
    ]);
    const first = (await runs(t1))[0];
    expect(first.body).toBe("Hi Kim, saw Parkworks.");
    expect(first.profile_url).toMatch(
      /^https:\/\/www\.linkedin\.com\/search\/results\/people\/\?keywords=Kim%20Park%20Parkworks$/,
    );
    expect((await runs(t2))[1]).toMatchObject({
      channel: "sms",
      status: "skipped",
      skip_reason: "No recorded consent to be texted",
    });
    // Another workspace can't mark A's task done.
    expect(
      (
        await db.user(bob)<{ r: boolean }>(
          `select channel_task_done($1, 'done') as r`,
          [first.id],
        )
      )[0].r,
    ).toBe(false);
    expect(
      (
        await db.user(amy)<{ r: boolean }>(
          `select channel_task_done($1, 'done') as r`,
          [first.id],
        )
      )[0].r,
    ).toBe(true);
  });

  it("send a due text only with consent, inside the window, with STOP wording the first time", async () => {
    const leadId = await lead(A, { sms: true, phone: "+14155557020" });
    const thread = await sequence(A, leadId, 1);
    await tick();
    const claimed = await service<
      {
        status: string;
        body: string;
        run_id: string;
        sms_id: string;
        workspace_id: string;
      }[]
    >("channel_sms_claim(10)");
    const mine = claimed.find((c) => c.body.includes("Quick note"))!;
    expect(mine.body).toBe(
      "Agency A: Quick note from Sam. Reply STOP to opt out.",
    );
    await service("sms_sent($1, $2, $3, null)", [mine.sms_id, A, smsSid()]);
    await service("channel_sms_finished($1, $2, true)", [mine.run_id, A]);
    expect((await runs(thread))[1]).toMatchObject({ status: "done" });
    // Without an approved A2P campaign, US local numbers don't text.
    const other = await lead(A, { sms: true, phone: "+14155557021" });
    const t2 = await sequence(A, other, 1);
    await tick();
    await db.user(alice)(`select phone_settings_save($1, $2::jsonb)`, [
      A,
      settings({ a2p_campaign_status: "submitted" }),
    ]);
    await service("channel_sms_claim(10)");
    expect((await runs(t2))[1]).toMatchObject({
      status: "skipped",
      skip_reason: "A2P 10DLC registration isn't approved yet",
    });
    await db.user(alice)(`select phone_settings_save($1, $2::jsonb)`, [
      A,
      settings(),
    ]);
  });

  it("stop when the lead replies on any channel, and end the email sequence too", async () => {
    const leadId = await lead(A, { sms: true, phone: "+14155557030" });
    const thread = await sequence(A, leadId);
    await tick();
    await service(
      "sms_inbound('+14155550121', '+14155557030', 'Sounds good, call me', $1)",
      [smsSid()],
    );
    await tick();
    // The LinkedIn task already handed out is withdrawn too.
    expect((await runs(thread)).map((r) => r.status)).toEqual([
      "stopped",
      "stopped",
    ]);
    expect(
      await db.admin(
        `select status, stop_reason from mail_threads where id = $1`,
        [thread],
      ),
    ).toEqual([{ status: "replied", stop_reason: "Replied by text" }]);
  });

  it("end the sequence when a person reports a LinkedIn reply", async () => {
    const leadId = await lead(A, { sms: true });
    const thread = await sequence(A, leadId);
    await tick();
    const [linkedin] = await runs(thread);
    await db.user(amy)(`select channel_task_done($1, 'replied')`, [
      linkedin.id,
    ]);
    expect((await runs(thread)).map((r) => r.status)).toEqual([
      "done",
      "stopped",
    ]);
    expect(
      await db.admin(`select status from mail_threads where id = $1`, [thread]),
    ).toEqual([{ status: "replied" }]);
  });

  it("hand out at most the daily number of LinkedIn tasks", async () => {
    const before = (
      await db.admin<{ n: number }>(
        `select count(*)::int as n from sequence_channel_runs where workspace_id = $1 and channel = 'linkedin' and promoted_at is not null`,
        [A],
      )
    )[0].n;
    for (let i = 0; i < 4; i++) await sequence(A, await lead(A));
    await service("channel_tick($1)", [before + 2]);
    const after = (
      await db.admin<{ n: number }>(
        `select count(*)::int as n from sequence_channel_runs where workspace_id = $1 and channel = 'linkedin' and promoted_at is not null`,
        [A],
      )
    )[0].n;
    expect(after).toBe(before + 2);
  });
});
