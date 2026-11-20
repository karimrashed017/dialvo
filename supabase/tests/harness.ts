import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

// A real Postgres in memory (PGlite) with every migration applied in order,
// and just enough of Supabase around it for the migrations and the policies
// to mean what they mean in production:
//   * the roles anon, authenticated and service_role (service_role skips RLS);
//   * the auth schema with auth.users and auth.uid(), which reads the signed-in
//     user from a session setting exactly as Supabase's does;
//   * Supabase's default grants: every new table and function in `public` is
//     handed to all three roles. The migrations have to take that back
//     themselves, so the tests prove they do.

const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));

const SUPABASE_SETUP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- Supabase Vault, as far as the migrations use it: a secrets table, the
  -- two functions that write to it and the view that reads it back. Nothing
  -- is encrypted here; what the tests prove is who can reach it.
  create schema vault;
  create table vault.secrets (
    id uuid primary key default gen_random_uuid(),
    name text unique,
    description text not null default '',
    secret text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create view vault.decrypted_secrets as
    select id, name, description, secret, secret as decrypted_secret, created_at, updated_at
    from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
  returns uuid language sql as $$
    insert into vault.secrets (secret, name, description)
    values (new_secret, new_name, new_description) returning id
  $$;
  create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
  returns void language sql as $$
    update vault.secrets
    set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
        description = coalesce(new_description, description), updated_at = now()
    where id = secret_id
  $$;
  revoke all on schema vault from public;
  revoke all on all tables in schema vault from public;
  revoke all on all functions in schema vault from public;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on sequences to anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export type Role = "anon" | "authenticated" | "service_role";

export class TestDb {
  private constructor(readonly pg: PGlite) {}

  /**
   * Every migration applied, or with `before`, only the ones that sort
   * before that file name: for setting a scene as it was, then applying the
   * rest with migrate() to prove what a migration does to existing rows.
   */
  static async create(options: { before?: string } = {}): Promise<TestDb> {
    const pg = new PGlite();
    await pg.exec(SUPABASE_SETUP);
    const db = new TestDb(pg);
    for (const file of migrationFiles())
      if (!options.before || file < options.before) await db.migrate(file);
    return db;
  }

  async migrate(file: string) {
    try {
      await this.pg.exec(readFileSync(MIGRATIONS + file, "utf8"));
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`);
    }
  }

  /** As the database owner: no RLS. For setting a scene and checking it. */
  async admin<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return (await this.pg.query<T>(sql, params)).rows;
  }

  /**
   * As a Supabase role, the way PostgREST runs a request: in a transaction,
   * with the role set and the user's id in the session setting. Returns the
   * rows; `affected` on the array is the row count for writes.
   */
  async as<T = Record<string, unknown>>(
    who: { role: Role; userId?: string },
    sql: string,
    params: unknown[] = [],
  ): Promise<T[] & { affected: number }> {
    return this.pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
        who.userId ?? "",
      ]);
      await tx.exec(`set local role ${who.role}`);
      const result = await tx.query<T>(sql, params);
      // Not enumerable, so the rows still compare equal to a plain array.
      return Object.defineProperty(result.rows, "affected", {
        value: result.affectedRows ?? 0,
      }) as T[] & { affected: number };
    });
  }

  user(userId: string) {
    return <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      this.as<T>({ role: "authenticated", userId }, sql, params);
  }

  /** An auth user with a confirmed email, as after a real sign-up. */
  async createUser(email: string, name = ""): Promise<string> {
    const [row] = await this.admin<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       values ($1, now(), jsonb_build_object('name', $2::text)) returning id`,
      [email, name],
    );
    return row.id;
  }

  async close() {
    await this.pg.close();
  }
}
