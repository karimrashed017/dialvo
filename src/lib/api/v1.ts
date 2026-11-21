import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  API_BODY_MAX_BYTES,
  API_PAGE_DEFAULT,
  API_PAGE_MAX,
  API_REQUESTS_PER_MINUTE,
} from "@/lib/integrations/config";
import { createLimiter } from "@/lib/leads/rate-limit";
import { hashApiKey, keyFromHeader } from "@/lib/plays/api-key";
import { createServiceClient } from "@/lib/supabase/service";

// What every route of the public API (src/app/api/v1) shares: the key, the
// rate limit, JSON answers, bodies and pages.
//
// THE SECRET KEY BYPASSES ROW-LEVEL SECURITY. Every query a route makes goes
// through `ctx.from(table)`, which adds `workspace_id = <the key's
// workspace>` itself, and every write sets workspace_id from the key, never
// from the request. Ids from the request are only ever looked up together
// with that workspace, so another workspace's id answers 404 like a
// missing one.

function scoped(supabase: SupabaseClient, workspaceId: string) {
  return (table: string, columns: string) =>
    supabase.from(table).select(columns).eq("workspace_id", workspaceId);
}

export type ApiContext = {
  workspaceId: string;
  supabase: SupabaseClient;
  /** A select on one table, already scoped to the key's workspace. */
  from: ReturnType<typeof scoped>;
  remaining: number;
  /** "read" keys may look but not change anything. */
  scope: "read" | "write";
  /** A personal key's person, and their role in the workspace now. */
  userId: string | null;
  role: "owner" | "admin" | "member" | null;
};

const perAddress = createLimiter({ windowMs: 60_000, max: 300 });

export const apiJson = (
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });

export const apiError = (
  status: number,
  error: string,
  message?: string,
  extra: Record<string, string> = {},
) => apiJson(message ? { error, message } : { error }, status, extra);

/** The key's workspace, or the answer to send instead. */
export async function authorise(
  request: Request,
  options: { perMinute?: number; readOnPost?: boolean } = {},
): Promise<{ ok: true; ctx: ApiContext } | { ok: false; response: Response }> {
  const perMinute = options.perMinute ?? API_REQUESTS_PER_MINUTE;
  const address =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const wait = perAddress.take(address);
  if (wait > 0)
    return {
      ok: false,
      response: apiError(429, "rate_limited", undefined, {
        "Retry-After": String(wait),
      }),
    };
  const key = keyFromHeader(request.headers.get("authorization"));
  if (!key)
    return {
      ok: false,
      response: apiError(
        401,
        "unauthorised",
        "Send Authorization: Bearer <your API key>.",
      ),
    };
  const supabase = createServiceClient();
  if (!supabase) return { ok: false, response: apiError(503, "unavailable") };
  const { data, error } = await supabase.rpc("api_key_authorise", {
    p_key_hash: hashApiKey(key),
    p_max_per_minute: perMinute,
  });
  if (error) {
    console.error("[api] authorise failed:", error.message);
    return { ok: false, response: apiError(503, "unavailable") };
  }
  const r = data as {
    status: string;
    workspace_id?: string;
    remaining?: number;
    scope?: string;
    user_id?: string | null;
    role?: string | null;
  };
  if (r.status === "rate_limited")
    return {
      ok: false,
      response: apiError(
        429,
        "rate_limited",
        `At most ${perMinute} requests a minute per key.`,
        {
          "Retry-After": "60",
        },
      ),
    };
  if (r.status !== "ok" || !r.workspace_id)
    return { ok: false, response: apiError(401, "unauthorised") };
  const workspaceId = r.workspace_id;
  const scope = r.scope === "read" ? "read" : "write";
  // A read-only key can't change anything: every method but GET writes.
  if (
    scope === "read" &&
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    !options.readOnPost
  )
    return {
      ok: false,
      response: apiError(
        403,
        "read_only_key",
        "This key is read-only. Make a key with write access in Settings, API.",
      ),
    };
  return {
    ok: true,
    ctx: {
      workspaceId,
      supabase,
      from: scoped(supabase, workspaceId),
      remaining: r.remaining ?? 0,
      scope,
      userId: r.user_id ?? null,
      role:
        r.role === "owner" || r.role === "admin" || r.role === "member"
          ? r.role
          : null,
    },
  };
}

/** The JSON body, at most API_BODY_MAX_BYTES, or the answer to send. */
export async function readBody(
  request: Request,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const text = await request.text().catch(() => "");
  if (text.length > API_BODY_MAX_BYTES)
    return { ok: false, response: apiError(413, "too_large") };
  try {
    const body: unknown = JSON.parse(text || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body))
      return {
        ok: false,
        response: apiError(422, "invalid", "The body must be a JSON object."),
      };
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid", "The body must be JSON."),
    };
  }
}

// --- Pages: newest first, by (created_at, id) ------------------------------------------

export type Cursor = { c: string; i: string };

export function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ c: row.created_at, i: row.id })).toString(
    "base64url",
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v);

export function decodeCursor(raw: string | null): Cursor | null | "bad" {
  if (!raw) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof o?.c === "string" &&
      !Number.isNaN(Date.parse(o.c)) &&
      isId(o?.i)
    )
      return { c: new Date(o.c).toISOString(), i: o.i };
  } catch {
    // fall through
  }
  return "bad";
}

export function pageSize(raw: string | null): number | null {
  if (raw === null || raw === "") return API_PAGE_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= API_PAGE_MAX ? n : null;
}

/** Applies a page to a query on a table with created_at and id. */
export function paged<
  Q extends {
    or(filter: string): Q;
    order(column: string, o: { ascending: boolean }): Q;
    limit(n: number): Q;
  },
>(query: Q, cursor: Cursor | null, size: number): Q {
  let q = query;
  if (cursor)
    q = q.or(
      `created_at.lt.${cursor.c},and(created_at.eq.${cursor.c},id.lt.${cursor.i})`,
    );
  return q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(size + 1);
}

/** The page's rows and the cursor of the next one. */
export function pageOf<T extends { created_at: string; id: string }>(
  rows: T[],
  size: number,
): { data: T[]; next_cursor: string | null } {
  const data = rows.slice(0, size);
  return {
    data,
    next_cursor:
      rows.length > size ? encodeCursor(data[data.length - 1]) : null,
  };
}

/** Reads ?limit and ?cursor, or the answer to send. */
export function readPage(
  url: URL,
):
  | { ok: true; size: number; cursor: Cursor | null }
  | { ok: false; response: Response } {
  const size = pageSize(url.searchParams.get("limit"));
  if (size === null)
    return {
      ok: false,
      response: apiError(422, "invalid", `limit must be 1 to ${API_PAGE_MAX}.`),
    };
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (cursor === "bad")
    return {
      ok: false,
      response: apiError(422, "invalid", "That cursor isn't one of ours."),
    };
  return { ok: true, size, cursor };
}

export function failed(where: string, error: { message: string }) {
  console.error(`[api] ${where}:`, error.message);
  return apiError(503, "unavailable");
}
