import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationFiles, TestDb } from "./harness";
import { MAIL_SECRET_TABLES, MAIL_TABLES } from "./mail-tables";
import { OUTBOUND_TABLES } from "./outbound-tables";

// The isolation rules, proved against the real migrations:
//   * a member of workspace A cannot read or write any row of workspace B,
//     in every table;
//   * someone in no workspace sees nothing;
//   * nobody can make themselves owner (or change their own role at all);
//   * the anon role can do one thing: submit a lead through a form's token.

const DENIED = /row-level security|permission denied/;

let db: TestDb;
let alice: string; // owner of A
let amy: string; // member of A
let bob: string; // owner of B
let carol: string; // signed in, in no workspace
let A: string;
let B: string;
/** One row id per table in workspace B, and its parents. */
const b: Record<string, string> = {};
const a: Record<string, string> = {};

async function seed(ws: string, owner: string, ids: Record<string, string>) {
  const one = async (sql: string, params: unknown[]) =>
    (await db.admin<{ id: string }>(sql, params))[0].id;
  ids.lead = await one(
    `insert into leads (workspace_id, name, email, owner_id) values ($1, 'Lead', $2, $3) returning id`,
    [ws, `lead-${ws}@example.com`, owner],
  );
  ids.conversation = await one(
    `insert into conversations (workspace_id, lead_id, channel, last_message_at) values ($1, $2, 'email', now()) returning id`,
    [ws, ids.lead],
  );
  ids.message = await one(
    `insert into messages (workspace_id, conversation_id, direction, author, body, delivery_status) values ($1, $2, 'in', 'lead', 'Hello', 'received') returning id`,
    [ws, ids.conversation],
  );
  ids.agent = await one(
    `select id from agents where workspace_id = $1 and role = 'inbound'`,
    [ws],
  );
  ids.knowledge = await one(
    `insert into knowledge_items (workspace_id, title, kind, content) values ($1, 'Pricing', 'text', 'Secret price list') returning id`,
    [ws],
  );
  ids.meeting = await one(
    `insert into meetings (workspace_id, lead_id, starts_at, ends_at) values ($1, $2, now() + interval '1 day', now() + interval '25 hours') returning id`,
    [ws, ids.lead],
  );
  ids.call = await one(
    `insert into calls (workspace_id, lead_id, conversation_id, direction) values ($1, $2, $3, 'inbound') returning id`,
    [ws, ids.lead, ids.conversation],
  );
  ids.event = await one(
    `insert into activity_events (workspace_id, lead_id, kind, summary) values ($1, $2, 'note', 'A private note') returning id`,
    [ws, ids.lead],
  );
  ids.form = await one(`select id from lead_forms where workspace_id = $1`, [
    ws,
  ]);
  ids.widget = await one(
    `insert into chat_widgets (workspace_id, name, created_by) values ($1, 'Website chat', $2) returning id`,
    [ws, owner],
  );
  ids.draft = await one(
    `insert into message_drafts (workspace_id, conversation_id, agent_id, body) values ($1, $2, $3, 'A draft reply') returning id`,
    [ws, ids.conversation, ids.agent],
  );
  ids.testMessage = await one(
    `insert into agent_test_messages (workspace_id, user_id, session_id, author, body) values ($1, $2, gen_random_uuid(), 'user', 'A private test question') returning id`,
    [ws, owner],
  );
  ids.alert = await one(
    `insert into team_alerts (workspace_id, conversation_id, kind, summary) values ($1, $2, 'needs_human', 'A private summary') returning id`,
    [ws, ids.conversation],
  );
  ids.invitation = await one(
    `insert into invitations (workspace_id, email, invited_by) values ($1, $2, $3) returning id`,
    [ws, `invitee-${ws}@example.com`, owner],
  );
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
  await seed(A, alice, a);
  await seed(B, bob, b);
});

afterAll(async () => {
  await db.close();
});

/**
 * Every workspace table: the row of B to aim at, an insert into B that would
 * be valid if the policies allowed it (parents are B's own, so only the
 * policies and grants can refuse), and a harmless column to update.
 */
const TABLES: {
  table: string;
  id: () => string;
  insert: () => [string, unknown[]];
  touch: string;
}[] = [
  {
    table: "leads",
    id: () => b.lead,
    insert: () => [
      `insert into leads (workspace_id, name, email) values ($1, 'Planted', 'planted@example.com')`,
      [B],
    ],
    touch: "name = 'Changed'",
  },
  {
    table: "conversations",
    id: () => b.conversation,
    insert: () => [
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'chat')`,
      [B, b.lead],
    ],
    touch: "status = 'closed'",
  },
  {
    table: "messages",
    id: () => b.message,
    insert: () => [
      `insert into messages (workspace_id, conversation_id, direction, author, author_user_id, body) values ($1, $2, 'out', 'user', $3, 'Planted')`,
      [B, b.conversation, alice],
    ],
    touch: "body = 'Changed'",
  },
  {
    table: "agents",
    id: () => b.agent,
    insert: () => [
      `insert into agents (workspace_id, name, role, channel) values ($1, 'Planted', 'inbound', 'chat')`,
      [B],
    ],
    touch: "enabled = true",
  },
  {
    table: "knowledge_items",
    id: () => b.knowledge,
    insert: () => [
      `insert into knowledge_items (workspace_id, title, kind, content) values ($1, 'Planted', 'text', 'x')`,
      [B],
    ],
    touch: "content = 'Changed'",
  },
  {
    table: "meetings",
    id: () => b.meeting,
    insert: () => [
      `insert into meetings (workspace_id, lead_id, starts_at, ends_at) values ($1, $2, now(), now() + interval '1 hour')`,
      [B, b.lead],
    ],
    touch: "status = 'cancelled'",
  },
  {
    table: "calls",
    id: () => b.call,
    insert: () => [
      `insert into calls (workspace_id, lead_id, direction) values ($1, $2, 'outbound')`,
      [B, b.lead],
    ],
    touch: "summary = 'Changed'",
  },
  {
    table: "activity_events",
    id: () => b.event,
    insert: () => [
      `insert into activity_events (workspace_id, lead_id, actor_id, kind, summary) values ($1, $2, $3, 'note', 'Planted')`,
      [B, b.lead, alice],
    ],
    touch: "summary = 'Changed'",
  },
  {
    table: "lead_forms",
    id: () => b.form,
    insert: () => [
      `insert into lead_forms (workspace_id, name, created_by) values ($1, 'Planted', $2)`,
      [B, alice],
    ],
    touch: "enabled = false",
  },
  {
    table: "chat_widgets",
    id: () => b.widget,
    insert: () => [
      `insert into chat_widgets (workspace_id, name, created_by) values ($1, 'Planted', $2)`,
      [B, alice],
    ],
    touch: "enabled = false",
  },
  {
    table: "message_drafts",
    id: () => b.draft,
    insert: () => [
      `insert into message_drafts (workspace_id, conversation_id, body, status) values ($1, $2, 'Planted', 'discarded')`,
      [B, b.conversation],
    ],
    touch: "status = 'approved'",
  },
  {
    // One row per workspace, made with it: "inserting" means taking it over.
    table: "workspace_setup",
    id: () => "",
    insert: () => [
      `insert into workspace_setup (workspace_id) values ($1) on conflict (workspace_id) do update set dismissed_at = now()`,
      [B],
    ],
    touch: "dismissed_at = now()",
  },
  {
    table: "agent_test_messages",
    id: () => b.testMessage,
    insert: () => [
      `insert into agent_test_messages (workspace_id, user_id, session_id, author, body) values ($1, $2, gen_random_uuid(), 'agent', 'Planted')`,
      [B, bob],
    ],
    touch: "body = 'changed'",
  },
  {
    table: "team_alerts",
    id: () => b.alert,
    insert: () => [
      `insert into team_alerts (workspace_id, conversation_id, kind) values ($1, $2, 'qualified')`,
      [B, b.conversation],
    ],
    touch: "status = 'sent'",
  },
  {
    table: "invitations",
    id: () => b.invitation,
    insert: () => [
      `insert into invitations (workspace_id, email, invited_by) values ($1, 'alice@a.example', $2)`,
      [B, alice],
    ],
    touch: "status = 'revoked'",
  },
  {
    table: "workspace_members",
    id: () => "",
    insert: () => [
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`,
      [B, alice],
    ],
    touch: "role = 'member'",
  },
];

const ALL_TABLES = [
  ...TABLES.map((t) => t.table),
  "workspaces",
  "profiles",
  ...OUTBOUND_TABLES,
  ...MAIL_TABLES,
];

/** A write that must change nothing: refused outright, or zero rows. */
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

describe("the migrations", () => {
  it("are timestamped and apply in order on a fresh database", async () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it("switch row-level security on for every table in public", async () => {
    const rows = await db.admin<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.map((r) => r.relname).sort()).toEqual(
      [...ALL_TABLES, ...MAIL_SECRET_TABLES].sort(),
    );
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });

  it("put every helper in private with a fixed, empty search_path", async () => {
    const rows = await db.admin<{
      proname: string;
      nspname: string;
      proconfig: string[] | null;
    }>(
      `select p.proname, n.nspname, p.proconfig from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('private', 'public')`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const r of rows)
      expect(r.proconfig ?? [], r.proname).toContain('search_path=""');
  });

  it("index every foreign key", async () => {
    const missing = await db.admin<{ conname: string }>(
      `select c.conname from pg_constraint c
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace
         and not exists (
           select 1 from pg_index i
           where i.indrelid = c.conrelid
             and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
         )`,
    );
    expect(missing.map((m) => m.conname)).toEqual([]);
  });
});

describe("signing up and creating a workspace", () => {
  it("gives every new user a profile", async () => {
    const rows = await db.admin(`select name from profiles where id = $1`, [
      alice,
    ]);
    expect(rows).toEqual([{ name: "Alice" }]);
  });

  it("copies the login address onto the profile, and nobody can edit it", async () => {
    const eve = await db.createUser("Eve@Mixed.Example", "Eve");
    const email = async () =>
      (await db.admin(`select email from profiles where id = $1`, [eve]))[0]
        .email;
    expect(await email()).toBe("eve@mixed.example");
    await db.admin(`update auth.users set email = $2 where id = $1`, [
      eve,
      "eve@new.example",
    ]);
    expect(await email()).toBe("eve@new.example");
    await expect(
      db.user(eve)(
        `update profiles set email = 'boss@a.example' where id = $1`,
        [eve],
      ),
    ).rejects.toThrow(DENIED);
    await db.admin(`delete from auth.users where id = $1`, [eve]);
    expect(
      await db.admin(`select 1 from profiles where id = $1`, [eve]),
    ).toEqual([]);
  });

  it("makes the creator the owner and sets the workspace up", async () => {
    expect(
      await db.admin(
        `select role from workspace_members where workspace_id = $1 and user_id = $2`,
        [A, alice],
      ),
    ).toEqual([{ role: "owner" }]);
    const [ws] = await db.admin(
      `select name, plan, timezone, website, slug from workspaces where id = $1`,
      [A],
    );
    expect(ws).toMatchObject({
      name: "Agency A",
      plan: "starter",
      timezone: "Europe/London",
      website: "a.example",
    });
    expect(ws.slug).toMatch(/^agency-a-[0-9a-f]{8}$/);
    // Four agents, all off and asking first; "what you sell" is the first
    // knowledge item; one lead form.
    const agents = await db.admin(
      `select role, enabled, approval_mode from agents where workspace_id = $1 order by role`,
      [A],
    );
    expect(agents.map((x) => x.role)).toEqual([
      "closing",
      "expansion",
      "inbound",
      "outbound",
    ]);
    for (const x of agents)
      expect(x).toMatchObject({
        enabled: false,
        approval_mode: "approve_first",
      });
    expect(
      await db.admin(
        `select title, content from knowledge_items where workspace_id = $1 and title = 'What we sell'`,
        [A],
      ),
    ).toEqual([{ title: "What we sell", content: "We sell A" }]);
  });

  it("allows one workspace, or five on Scale", async () => {
    await expect(
      db.user(alice)(`select create_workspace('Second')`),
    ).rejects.toThrow(/workspace limit/);
    const dana = await db.createUser("dana@scale.example");
    const [{ id: first }] = await db.user(dana)<{ id: string }>(
      `select create_workspace('Scale 1') as id`,
    );
    // Dana can't upgrade herself: the plan column isn't hers to write.
    await expect(
      db.user(dana)(`update workspaces set plan = 'scale' where id = $1`, [
        first,
      ]),
    ).rejects.toThrow(DENIED);
    await db.admin(`update workspaces set plan = 'scale' where id = $1`, [
      first,
    ]);
    for (const n of [2, 3, 4, 5])
      await db.user(dana)(`select create_workspace($1)`, [`Scale ${n}`]);
    await expect(
      db.user(dana)(`select create_workspace('Scale 6')`),
    ).rejects.toThrow(/workspace limit/);
  });

  it("refuses anyone who isn't signed in", async () => {
    await expect(
      db.as({ role: "anon" }, `select create_workspace('Nope')`),
    ).rejects.toThrow(DENIED);
  });
});

describe("a member of workspace A", () => {
  it("sees A's rows in every table", async () => {
    for (const t of TABLES) {
      const rows = await db.user(amy)(
        `select 1 from ${t.table} where workspace_id = $1`,
        [A],
      );
      // Invitations are for admins; everything else a member can read.
      if (t.table === "invitations") expect(rows.length).toBe(0);
      else expect(rows.length, t.table).toBeGreaterThan(0);
    }
    expect((await db.user(alice)(`select 1 from invitations`)).length).toBe(1);
    expect(await db.user(amy)(`select name from workspaces`)).toEqual([
      { name: "Agency A" },
    ]);
  });

  for (const t of TABLES) {
    describe(t.table, () => {
      it("cannot read workspace B's rows", async () => {
        for (const who of [alice, amy]) {
          expect(
            await db.user(who)(
              `select 1 from ${t.table} where workspace_id = $1`,
              [B],
            ),
          ).toEqual([]);
          // And an unfiltered read returns A's rows only.
          const all = await db.user(who)<{ workspace_id: string }>(
            `select workspace_id from ${t.table}`,
          );
          expect(all.every((r) => r.workspace_id === A)).toBe(true);
        }
      });

      it("cannot insert into workspace B", async () => {
        const [sql, params] = t.insert();
        // The same statement works for the database owner, so it is the
        // policies and grants that refuse it, not a typo.
        await db.pg.transaction(async (tx) => {
          await tx.query(sql, params);
          await tx.rollback();
        });
        for (const who of [alice, amy])
          await expect(db.user(who)(sql, params)).rejects.toThrow(DENIED);
      });

      it("cannot update or delete workspace B's rows", async () => {
        const before = await db.admin(
          `select * from ${t.table} where workspace_id = $1 order by 1, 2`,
          [B],
        );
        for (const who of [alice, amy]) {
          await expectNoEffect(() =>
            db.user(who)(
              `update ${t.table} set ${t.touch} where workspace_id = $1`,
              [B],
            ),
          );
          await expectNoEffect(() =>
            db.user(who)(`delete from ${t.table} where workspace_id = $1`, [B]),
          );
          // Moving one of A's rows into B is refused too.
          if (t.table !== "workspace_members")
            await expectNoEffect(() =>
              db.user(who)(
                `update ${t.table} set workspace_id = $1 where workspace_id = $2`,
                [B, A],
              ),
            );
        }
        expect(
          await db.admin(
            `select * from ${t.table} where workspace_id = $1 order by 1, 2`,
            [B],
          ),
        ).toEqual(before);
      });
    });
  }

  it("cannot read, rename or delete workspace B itself", async () => {
    expect(
      await db.user(alice)(`select 1 from workspaces where id = $1`, [B]),
    ).toEqual([]);
    await expectNoEffect(() =>
      db.user(alice)(`update workspaces set name = 'Taken' where id = $1`, [B]),
    );
    await expectNoEffect(() =>
      db.user(alice)(`delete from workspaces where id = $1`, [B]),
    );
    await expect(
      db.user(alice)(
        `insert into workspaces (name, slug, created_by) values ('X', 'x-123', $1)`,
        [alice],
      ),
    ).rejects.toThrow(DENIED);
    expect(
      await db.admin(`select name from workspaces where id = $1`, [B]),
    ).toEqual([{ name: "Agency B" }]);
  });

  it("sees teammates' profiles but not strangers', and edits only their own", async () => {
    const names = await db.user(alice)<{ name: string }>(
      `select name from profiles order by name`,
    );
    expect(names.map((n) => n.name)).toEqual(["Alice", "Amy"]);
    await expectNoEffect(() =>
      db.user(alice)(`update profiles set name = 'Hacked' where id = $1`, [
        bob,
      ]),
    );
    await expectNoEffect(() =>
      db.user(alice)(`update profiles set name = 'Hacked' where id = $1`, [
        amy,
      ]),
    );
    const mine = await db.user(amy)(
      `update profiles set name = 'Amy B' where id = $1`,
      [amy],
    );
    expect(mine.affected).toBe(1);
    await db.admin(`update profiles set name = 'Amy' where id = $1`, [amy]);
  });

  it("cannot write as the lead or an agent, or as a teammate", async () => {
    const insert = (cols: string, vals: string, params: unknown[]) =>
      db.user(amy)(
        `insert into messages (workspace_id, conversation_id, ${cols}) values ($1, $2, ${vals})`,
        [A, a.conversation, ...params],
      );
    await expect(
      insert("direction, author, body", "'in', 'lead', 'Fake'", []),
    ).rejects.toThrow(DENIED);
    await expect(
      insert("direction, author, body", "'out', 'agent', 'Fake'", []),
    ).rejects.toThrow(DENIED);
    await expect(
      insert(
        "direction, author, author_user_id, body",
        "'out', 'user', $3, 'Fake'",
        [alice],
      ),
    ).rejects.toThrow(DENIED);
    // A reply can't claim it was delivered.
    await expect(
      insert(
        "direction, author, author_user_id, body, delivery_status",
        "'out', 'user', $3, 'Fake', 'delivered'",
        [amy],
      ),
    ).rejects.toThrow(DENIED);
    const ok = await insert(
      "direction, author, author_user_id, body",
      "'out', 'user', $3, 'A real reply'",
      [amy],
    );
    expect(ok.affected).toBe(1);
  });
});

describe("composite foreign keys", () => {
  // As the database owner, so it is the keys that refuse, not the policies.
  const cases: [string, string, () => unknown[]][] = [
    [
      "a conversation on another workspace's lead",
      `insert into conversations (workspace_id, lead_id, channel) values ($1, $2, 'chat')`,
      () => [A, b.lead],
    ],
    [
      "a message in another workspace's conversation",
      `insert into messages (workspace_id, conversation_id, direction, author, body) values ($1, $2, 'in', 'lead', 'x')`,
      () => [A, b.conversation],
    ],
    [
      "a meeting with another workspace's lead",
      `insert into meetings (workspace_id, lead_id, starts_at, ends_at) values ($1, $2, now(), now() + interval '1 hour')`,
      () => [A, b.lead],
    ],
    [
      "a call on another workspace's conversation",
      `insert into calls (workspace_id, lead_id, conversation_id, direction) values ($1, $2, $3, 'inbound')`,
      () => [A, a.lead, b.conversation],
    ],
    [
      "an event about another workspace's agent",
      `insert into activity_events (workspace_id, agent_id, kind, summary) values ($1, $2, 'note', 'x')`,
      () => [A, b.agent],
    ],
    [
      "a lead owned by someone outside the workspace",
      `insert into leads (workspace_id, name, owner_id) values ($1, 'x', $2)`,
      () => [A, bob],
    ],
    [
      "a conversation assigned to someone outside the workspace",
      `insert into conversations (workspace_id, lead_id, channel, assigned_to) values ($1, $2, 'chat', $3)`,
      () => [A, a.lead, bob],
    ],
  ];
  for (const [name, sql, params] of cases)
    it(`refuse ${name}`, async () => {
      await expect(db.admin(sql, params())).rejects.toThrow(/foreign key/);
    });

  it("unassign a member's work when they leave, without deleting it", async () => {
    await db.admin(`update leads set owner_id = $1 where id = $2`, [
      amy,
      a.lead,
    ]);
    await db.admin(`update conversations set assigned_to = $1 where id = $2`, [
      amy,
      a.conversation,
    ]);
    await db.pg.transaction(async (tx) => {
      await tx.query(
        `delete from workspace_members where workspace_id = $1 and user_id = $2`,
        [A, amy],
      );
      const lead = await tx.query(
        `select owner_id, workspace_id from leads where id = $1`,
        [a.lead],
      );
      expect(lead.rows).toEqual([{ owner_id: null, workspace_id: A }]);
      const conv = await tx.query(
        `select assigned_to from conversations where id = $1`,
        [a.conversation],
      );
      expect(conv.rows).toEqual([{ assigned_to: null }]);
      await tx.rollback();
    });
  });
});

describe("someone in no workspace", () => {
  it("sees nothing in any table but their own profile", async () => {
    for (const table of ALL_TABLES) {
      const rows = await db.user(carol)<{ id?: string }>(
        `select * from ${table}`,
      );
      if (table === "profiles") expect(rows.map((r) => r.id)).toEqual([carol]);
      else expect(rows, table).toEqual([]);
    }
  });

  it("cannot write anywhere", async () => {
    for (const t of TABLES) {
      const [sql, params] = t.insert();
      await expect(db.user(carol)(sql, params), t.table).rejects.toThrow(
        DENIED,
      );
      await expectNoEffect(() =>
        db.user(carol)(`update ${t.table} set ${t.touch}`),
      );
      await expectNoEffect(() => db.user(carol)(`delete from ${t.table}`));
    }
  });

  it("cannot add themselves to a workspace", async () => {
    await expect(
      db.user(carol)(
        `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
        [A, carol],
      ),
    ).rejects.toThrow(DENIED);
  });
});

describe("roles", () => {
  const roleOf = async (ws: string, user: string) =>
    (
      await db.admin<{ role: string }>(
        `select role from workspace_members where workspace_id = $1 and user_id = $2`,
        [ws, user],
      )
    )[0]?.role;

  it("a member cannot make themselves owner or admin", async () => {
    for (const role of ["owner", "admin"]) {
      await expectNoEffect(() =>
        db.user(amy)(
          `update workspace_members set role = $3 where workspace_id = $1 and user_id = $2`,
          [A, amy, role],
        ),
      );
    }
    expect(await roleOf(A, amy)).toBe("member");
  });

  it("a member cannot change anyone else's role or remove them", async () => {
    await expectNoEffect(() =>
      db.user(amy)(
        `update workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`,
        [A, alice],
      ),
    );
    await expectNoEffect(() =>
      db.user(amy)(
        `delete from workspace_members where workspace_id = $1 and user_id = $2`,
        [A, alice],
      ),
    );
    expect(await roleOf(A, alice)).toBe("owner");
  });

  it("an admin cannot make themselves or anyone else owner, or touch the owner", async () => {
    await db.admin(
      `update workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`,
      [A, amy],
    );
    const ed = await db.createUser("ed@a.example", "Ed");
    await db.admin(
      `insert into workspace_members (workspace_id, user_id) values ($1, $2)`,
      [A, ed],
    );
    const set = (target: string, role: string) =>
      db.user(amy)(
        `update workspace_members set role = $3 where workspace_id = $1 and user_id = $2`,
        [A, target, role],
      );
    await expectNoEffect(() => set(amy, "owner"));
    await expect(set(ed, "owner")).rejects.toThrow(DENIED);
    await expectNoEffect(() => set(alice, "member"));
    // What an admin can do: move a teammate between member and admin.
    expect((await set(ed, "admin")).affected).toBe(1);
    expect((await set(ed, "member")).affected).toBe(1);
    expect(await roleOf(A, amy)).toBe("admin");
    expect(await roleOf(A, alice)).toBe("owner");
    // Nobody can rewrite who a membership belongs to.
    await expect(
      db.user(amy)(
        `update workspace_members set user_id = $2 where workspace_id = $1 and user_id = $3`,
        [A, amy, alice],
      ),
    ).rejects.toThrow(DENIED);
    await db.admin(
      `update workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`,
      [A, amy],
    );
    await db.admin(
      `delete from workspace_members where workspace_id = $1 and user_id = $2`,
      [A, ed],
    );
  });

  it("the owner cannot be removed and cannot leave", async () => {
    await expectNoEffect(() =>
      db.user(alice)(
        `delete from workspace_members where workspace_id = $1 and user_id = $2`,
        [A, alice],
      ),
    );
    expect(await roleOf(A, alice)).toBe("owner");
  });

  it("members can't change agents, forms or workspace settings; admins can", async () => {
    await expectNoEffect(() =>
      db.user(amy)(`update agents set enabled = true where id = $1`, [a.agent]),
    );
    await expectNoEffect(() =>
      db.user(amy)(`update workspaces set name = 'Mine' where id = $1`, [A]),
    );
    await expectNoEffect(() =>
      db.user(amy)(`update lead_forms set enabled = false where id = $1`, [
        a.form,
      ]),
    );
    const ok = await db.user(alice)(
      `update agents set instructions = 'Be brief.' where id = $1`,
      [a.agent],
    );
    expect(ok.affected).toBe(1);
    // Not even an owner can rewrite a form's token or a workspace's plan.
    await expect(
      db.user(alice)(`update lead_forms set token = 'x' where id = $1`, [
        a.form,
      ]),
    ).rejects.toThrow(DENIED);
    await expect(
      db.user(alice)(`update workspaces set plan = 'scale' where id = $1`, [A]),
    ).rejects.toThrow(DENIED);
  });
});

describe("invitations", () => {
  it("only the invited, confirmed address can see and accept one", async () => {
    const ivy = await db.createUser("ivy@new.example", "Ivy");
    await db.user(alice)(
      `insert into invitations (workspace_id, email, role, invited_by) values ($1, 'ivy@new.example', 'admin', $2)`,
      [A, alice],
    );
    const mine = await db.user(ivy)<{ id: string; workspace_name: string }>(
      `select * from my_invitations()`,
    );
    expect(mine.map((m) => m.workspace_name)).toEqual(["Agency A"]);
    expect(await db.user(carol)(`select * from my_invitations()`)).toEqual([]);
    await expect(
      db.user(carol)(`select accept_invitation($1)`, [mine[0].id]),
    ).rejects.toThrow(/invitation not found/);

    // An unconfirmed address proves nothing yet.
    await db.admin(
      `update auth.users set email_confirmed_at = null where id = $1`,
      [ivy],
    );
    expect(await db.user(ivy)(`select * from my_invitations()`)).toEqual([]);
    await expect(
      db.user(ivy)(`select accept_invitation($1)`, [mine[0].id]),
    ).rejects.toThrow(/invitation not found/);
    await db.admin(
      `update auth.users set email_confirmed_at = now() where id = $1`,
      [ivy],
    );

    await db.user(ivy)(`select accept_invitation($1)`, [mine[0].id]);
    expect(
      await db.admin(
        `select role from workspace_members where workspace_id = $1 and user_id = $2`,
        [A, ivy],
      ),
    ).toEqual([{ role: "admin" }]);
    // Used once.
    await expect(
      db.user(ivy)(`select accept_invitation($1)`, [mine[0].id]),
    ).rejects.toThrow(/invitation not found/);
    await db.admin(
      `delete from workspace_members where workspace_id = $1 and user_id = $2`,
      [A, ivy],
    );
  });

  it("can't be used to hand out the owner role, and members can't invite", async () => {
    await expect(
      db.user(alice)(
        `insert into invitations (workspace_id, email, role, invited_by) values ($1, 'x@example.com', 'owner', $2)`,
        [A, alice],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.user(amy)(
        `insert into invitations (workspace_id, email, invited_by) values ($1, 'friend@example.com', $2)`,
        [A, amy],
      ),
    ).rejects.toThrow(DENIED);
  });
});

describe("the anon role", () => {
  it("cannot read or write any table", async () => {
    for (const table of ALL_TABLES) {
      await expect(
        db.as({ role: "anon" }, `select * from ${table}`),
        table,
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.as({ role: "anon" }, `delete from ${table}`),
        table,
      ).rejects.toThrow(/permission denied/);
    }
    for (const t of TABLES) {
      const [sql, params] = t.insert();
      await expect(db.as({ role: "anon" }, sql, params)).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("cannot call anything but capture_lead and the visitor's side of the chat", async () => {
    for (const call of [
      `select create_workspace('x')`,
      `select * from my_invitations()`,
      `select accept_invitation(gen_random_uuid())`,
      `select private.is_workspace_member(gen_random_uuid())`,
      `select private.chat_key_hash('x')`,
      `select send_chat_reply(gen_random_uuid(), 'x')`,
      `select approve_chat_draft(gen_random_uuid())`,
      `select discard_chat_draft(gen_random_uuid())`,
      `select chat_agent_context('x', gen_random_uuid())`,
      `select chat_agent_commit('x', gen_random_uuid(), gen_random_uuid(), '{}'::jsonb)`,
    ])
      await expect(db.as({ role: "anon" }, call), call).rejects.toThrow(
        /permission denied/,
      );
  });
});

describe("capture_lead (the public form)", () => {
  const capture = (token: string, lead: unknown, role = "anon" as const) =>
    db.as<{ r: { ok: boolean; redirect_url: string | null } | null }>(
      { role },
      `select capture_lead($1, $2::jsonb) as r`,
      [token, JSON.stringify(lead)],
    );
  let tokenA: string;
  let formA: string;

  beforeAll(async () => {
    // A form of its own, so the scene's counts above stay put.
    [{ id: formA, token: tokenA }] = await db.admin<{
      id: string;
      token: string;
    }>(
      `insert into lead_forms (workspace_id, name) values ($1, 'Contact page') returning id, token`,
      [A],
    );
  });

  it("writes a lead, a waiting conversation, the message and a feed event, in the form's workspace only", async () => {
    const countB = async () =>
      (
        await db.admin(
          `select (select count(*) from leads where workspace_id = $1) l,
                  (select count(*) from conversations where workspace_id = $1) c,
                  (select count(*) from activity_events where workspace_id = $1) e`,
          [B],
        )
      )[0];
    const before = await countB();
    const [{ r }] = await capture(tokenA, {
      name: "Nora Field",
      email: "Nora@Field.example",
      phone: "+441632960123",
      company: "Field & Co",
      message: "Can you call me about pricing?",
      consent: { call: true, email: true },
    });
    expect(r).toEqual({ ok: true, redirect_url: null });
    expect(await countB()).toEqual(before);

    const [lead] = await db.admin(
      `select * from leads where workspace_id = $1 and email = 'nora@field.example'`,
      [A],
    );
    expect(lead).toMatchObject({
      name: "Nora Field",
      phone: "+441632960123",
      company: "Field & Co",
      source: "form: Contact page",
      status: "new",
      consent_call: true,
      consent_call_source: "form: Contact page",
      consent_email: true,
      // Not in the payload, so not recorded.
      consent_sms: false,
      consent_sms_at: null,
      consent_sms_source: null,
      consent_whatsapp: false,
      consent_whatsapp_at: null,
    });
    expect(lead.consent_call_at).toBeInstanceOf(Date);
    const [conv] = await db.admin(
      `select id, channel, status from conversations where lead_id = $1`,
      [lead.id],
    );
    expect(conv).toMatchObject({ channel: "email", status: "waiting_for_you" });
    expect(
      await db.admin(
        `select direction, author, body, delivery_status from messages where conversation_id = $1`,
        [conv.id],
      ),
    ).toEqual([
      {
        direction: "in",
        author: "lead",
        body: "Can you call me about pricing?",
        delivery_status: "received",
      },
    ]);
    expect(
      await db.admin(
        `select kind, summary, channel from activity_events where lead_id = $1`,
        [lead.id],
      ),
    ).toEqual([
      {
        kind: "lead_captured",
        summary: 'New lead from the form "Contact page"',
        channel: "email",
      },
    ]);
  });

  it("records no consent when the payload has none, and never switches consent off", async () => {
    await capture(tokenA, { email: "quiet@example.com" });
    const [quiet] = await db.admin(
      `select consent_call, consent_sms, consent_whatsapp, consent_email, consent_email_at from leads where email = 'quiet@example.com'`,
    );
    expect(quiet).toEqual({
      consent_call: false,
      consent_sms: false,
      consent_whatsapp: false,
      consent_email: false,
      consent_email_at: null,
    });
    await capture(tokenA, {
      email: "nora@field.example",
      consent: { call: false, sms: true },
    });
    const [nora] = await db.admin(
      `select consent_call, consent_sms, consent_email from leads where email = 'nora@field.example'`,
    );
    expect(nora).toEqual({
      consent_call: true,
      consent_sms: true,
      consent_email: true,
    });
  });

  it("matches a known lead instead of duplicating, filling gaps without overwriting", async () => {
    await capture(tokenA, {
      name: "Someone Else",
      email: "nora@field.example",
      website: "field.example",
    });
    const rows = await db.admin(
      `select name, website from leads where workspace_id = $1 and email = 'nora@field.example'`,
      [A],
    );
    expect(rows).toEqual([{ name: "Nora Field", website: "field.example" }]);
    // Same address in another workspace is a different lead.
    const [{ token: tokenB }] = await db.admin<{ token: string }>(
      `select token from lead_forms where workspace_id = $1`,
      [B],
    );
    await capture(tokenB, { email: "nora@field.example" });
    expect(
      (
        await db.admin(
          `select workspace_id from leads where email = 'nora@field.example'`,
        )
      ).length,
    ).toBe(2);
  });

  it("refuses bad input, unknown tokens and switched-off forms", async () => {
    expect((await capture("nope", { email: "a@b.example" }))[0].r).toBeNull();
    await expect(capture(tokenA, { name: "No contact" })).rejects.toThrow(
      /email or a phone/,
    );
    await expect(capture(tokenA, { email: "not-an-email" })).rejects.toThrow(
      /not valid/,
    );
    await expect(capture(tokenA, { phone: "call me maybe" })).rejects.toThrow(
      /not valid/,
    );
    await expect(
      capture(tokenA, { email: "a@b.example", consent: { call: "yes" } }),
    ).rejects.toThrow(/consent/);
    await expect(
      capture(tokenA, { email: "a@b.example", consent: { fax: true } }),
    ).rejects.toThrow(/consent/);
    await db.admin(`update lead_forms set enabled = false where id = $1`, [
      formA,
    ]);
    expect((await capture(tokenA, { email: "a@b.example" }))[0].r).toBeNull();
    await db.admin(`update lead_forms set enabled = true where id = $1`, [
      formA,
    ]);
    expect(
      await db.admin(`select 1 from leads where email = 'a@b.example'`),
    ).toEqual([]);
  });

  it("works with the secret key too, and not for signed-in users", async () => {
    const [{ r }] = await capture(
      tokenA,
      { phone: "+441632960999" },
      "service_role" as never,
    );
    expect(r?.ok).toBe(true);
    expect(
      await db.admin(
        `select c.channel from conversations c join leads l on l.id = c.lead_id where l.phone = '+441632960999'`,
      ),
    ).toEqual([{ channel: "sms" }]);
    await expect(
      db.user(carol)(`select capture_lead($1, '{"email":"x@y.example"}')`, [
        tokenA,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("stops a flood: 30 a minute per form", async () => {
    const [{ id, token }] = await db.admin<{ id: string; token: string }>(
      `insert into lead_forms (workspace_id, name) values ($1, 'Flooded') returning id, token`,
      [B],
    );
    for (let i = 0; i < 30; i++)
      await capture(token, { email: `flood${i}@example.com` });
    await expect(
      capture(token, { email: "flood30@example.com" }),
    ).rejects.toThrow(/too many submissions/);
    // Other forms are unaffected.
    expect(
      (await capture(tokenA, { email: "calm@example.com" }))[0].r?.ok,
    ).toBe(true);
    await db.admin(`delete from lead_forms where id = $1`, [id]);
  });
});
