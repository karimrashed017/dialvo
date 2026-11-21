import { createHash } from "node:crypto";
import {
  IP_LOOKUPS_PER_DAY,
  SITE_VIEWS_PER_DAY,
} from "@/lib/integrations/config";
import { lookupCompany, type Company } from "./identify";

// What the tracker endpoint does with one message from the script on a
// customer's site (public/widget.js). The database does the rest
// (site_track, site_identify, site_lookup_*). Deps are passed in, so this
// is tested without a database or a provider.
//
// Never stored: the IP address (only a SHA-256 of it with the widget's
// token, to remember a lookup), the page's query string or fragment, the
// full referrer (only its host), or the browser's own id (only its hash).

export type TrackDeps = {
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** The provider's key, or null: then no company lookups. */
  providerKey: string | null;
  fetch: typeof fetch;
  /** Runs after the answer has gone (Next's after()). */
  later(task: () => Promise<void>): void;
};

const VISITOR = /^[A-Za-z0-9_-]{16,64}$/;
const SESSION = /^[A-Za-z0-9_-]{8,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const clean = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** Just the path: no query string, no fragment, at most 500 characters. */
export function cleanPath(v: unknown): string | null {
  const s = clean(v, 2000);
  if (!s.startsWith("/")) return null;
  const path = s.split(/[?#]/)[0].slice(0, 500);
  return path || "/";
}

export function cleanHost(v: unknown): string | null {
  const s = clean(v, 253).toLowerCase();
  return /^[a-z0-9.-]+$/.test(s) && s.includes(".") ? s : null;
}

export const ipHash = (token: string, ip: string) =>
  sha(`dialvo-ip|${token}|${ip}`);

export type TrackAnswer = { ok: boolean; status: number; track?: boolean };

export async function handleTrack(
  input: { token: string; ip: string; body: Record<string, unknown> },
  deps: TrackDeps,
): Promise<TrackAnswer> {
  const { token, ip, body } = input;
  const visitorRaw = clean(body.v, 64);
  if (!VISITOR.test(visitorRaw)) return { ok: false, status: 422 };
  const visitor = sha(visitorRaw);

  if (body.t === "identify") {
    const email = clean(body.e, 254).toLowerCase();
    const r = (await deps.rpc("site_identify", {
      p_token: token,
      p_visitor_hash: visitor,
      p_email: email,
    })) as { status: string };
    return {
      ok: r.status === "linked" || r.status === "pending",
      status: 200,
      track: r.status !== "off",
    };
  }
  if (body.t !== "view") return { ok: false, status: 422 };

  const path = cleanPath(body.p);
  const session = clean(body.s, 40);
  if (!path || !SESSION.test(session)) return { ok: false, status: 422 };
  const conversation = clean(body.c, 36);
  const ipH = ip && ip !== "unknown" ? ipHash(token, ip) : null;
  const r = (await deps.rpc("site_track", {
    p_token: token,
    p_visitor_hash: visitor,
    p_session: session,
    p_path: path,
    p_title: clean(body.ti, 200),
    p_referrer_host: cleanHost(body.r),
    p_ip_hash: ipH,
    p_conversation_id: UUID.test(conversation) ? conversation : null,
    p_chat_key: clean(body.k, 128) || null,
    p_link_token: /^[A-Za-z0-9]{16}$/.test(clean(body.l, 16))
      ? clean(body.l, 16)
      : null,
    p_max_per_day: SITE_VIEWS_PER_DAY,
  })) as {
    status: string;
    visitor_id?: string;
    workspace_id?: string;
    lookup?: boolean;
  };
  if (r.status === "off") return { ok: false, status: 200, track: false };
  if (r.status !== "recorded")
    return { ok: false, status: r.status === "capped" ? 429 : 422 };

  const key = deps.providerKey;
  if (r.lookup && key && ipH && r.workspace_id && r.visitor_id) {
    const ws = r.workspace_id;
    const visitorId = r.visitor_id;
    deps.later(async () => {
      const reserved = (await deps.rpc("site_lookup_reserve", {
        p_workspace_id: ws,
        p_max_per_day: IP_LOOKUPS_PER_DAY,
      })) as boolean;
      if (!reserved) return;
      const found: Company | null | "failed" = await lookupCompany(
        ip,
        key,
        deps.fetch,
      );
      // A failed lookup isn't remembered: the next page view tries again.
      if (found === "failed") return;
      await deps.rpc("site_lookup_save", {
        p_workspace_id: ws,
        p_visitor_id: visitorId,
        p_ip_hash: ipH,
        p_company: found,
      });
    });
  }
  return { ok: true, status: 200, track: true };
}
