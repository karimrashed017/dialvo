import { MIN_GAP_MS, PIPEDRIVE_PAGE_SIZE, SEARCH_GAP_MS } from "./config";
import { cleanDomain, cleanEmail } from "./content";
import { createHttp, type Http, type HttpDeps } from "./http";
import {
  CrmError,
  type CrmClient,
  type KnownEntry,
  type MeetingInput,
  type Pipeline,
  type PullCursor,
} from "./types";

// Pipedrive, through its API with a personal API token sent in the
// x-api-token header, at https://{company}.pipedrive.com (read 20 Nov 2026):
//   who        GET  /api/v1/users/me
//   persons    GET  /api/v2/persons/search?term=&fields=email&exact_match=true
//              POST /api/v2/persons, PATCH /api/v2/persons/{id}
//              GET  /api/v2/persons?limit=500&cursor=&include_fields=...
//   orgs       GET  /api/v2/organizations/search?term=&fields=name&exact_match=true
//              POST /api/v2/organizations
//              GET  /api/v2/organizations?limit=500&cursor=&include_fields=...
//   notes      POST /api/v1/notes, GET /api/v1/notes?person_id=
//   meetings   POST /api/v2/activities (type "meeting"), PATCH /api/v2/activities/{id}
//              GET  /api/v1/persons/{id}/activities
//   deals      POST /api/v2/deals, GET /api/v2/deals?person_id=
//              GET  /api/v2/pipelines, GET /api/v2/stages?pipeline_id=
// Pipedrive has no company domain field: an organisation is matched on its
// exact name, and created with its website. Its opt-out
// (marketing_status) only exists with its Campaigns add-on.

export const PIPEDRIVE_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** "https://Acme.pipedrive.com/..." or "acme" -> "acme". */
export function pipedriveDomain(value: string): string | null {
  const v = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/\.pipedrive\.com$/, "");
  return PIPEDRIVE_DOMAIN.test(v) ? v : null;
}

export function pipedriveHttp(
  token: string,
  domain: string,
  deps: HttpDeps,
): Http {
  return createHttp({
    provider: "pipedrive",
    baseUrl: `https://${domain}.pipedrive.com`,
    token,
    headers: { "x-api-token": token },
    gapMs: MIN_GAP_MS.pipedrive,
    searchGapMs: SEARCH_GAP_MS.pipedrive,
    deps,
  });
}

type One<T> = { success?: boolean; data?: T | null };
type List<T> = {
  success?: boolean;
  data?: T[] | null;
  additional_data?: { next_cursor?: string | null };
};
type SearchResult = {
  data?: {
    items?: { item?: { id?: number; organization?: { id?: number } | null } }[];
  };
};

const idOf = (o: { id?: unknown } | null | undefined): string => {
  const id = o?.id;
  if (typeof id !== "number" && typeof id !== "string")
    throw new CrmError("bad_request", "Pipedrive answered without an id.");
  return String(id);
};
const num = (id: string) => {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new CrmError("bad_request", "That isn't a Pipedrive id.");
  return n;
};

/** "2026-11-20T15:04:05.000Z" -> { date: "2026-11-20", time: "15:04" } (UTC). */
function utcParts(iso: string) {
  const d = new Date(iso);
  const s = (Number.isNaN(d.getTime()) ? new Date() : d).toISOString();
  return {
    date: s.slice(0, 10),
    time: s.slice(11, 16),
    both: `${s.slice(0, 10)} ${s.slice(11, 19)}`,
  };
}

function duration(startsAt: string, endsAt: string) {
  const mins = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60000);
  const m = Number.isFinite(mins)
    ? Math.min(Math.max(mins, 1), 24 * 60 - 1)
    : 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const MEETING_SUBJECT: Record<MeetingInput["status"], string> = {
  scheduled: "",
  completed: "",
  cancelled: " (cancelled)",
  no_show: " (no-show)",
};

export function createPipedriveClient(
  token: string,
  domain: string,
  deps: HttpDeps,
): CrmClient {
  const http = pipedriveHttp(token, domain, deps);

  return {
    provider: "pipedrive",

    async findContact(email) {
      const q = new URLSearchParams({
        term: email,
        fields: "email",
        exact_match: "true",
        limit: "1",
      });
      const res = await http<SearchResult>(`/api/v2/persons/search?${q}`, {
        search: true,
      });
      const item = res?.data?.items?.[0]?.item;
      if (!item?.id) return null;
      return {
        id: String(item.id),
        ...(item.organization?.id
          ? { companyId: String(item.organization.id) }
          : {}),
      };
    },

    async createContact(lead, companyId) {
      const body: Record<string, unknown> = {
        name: (lead.name.trim() || lead.email || "New lead").slice(0, 200),
        emails: [{ value: lead.email, primary: true, label: "work" }],
      };
      if (lead.phone)
        body.phones = [{ value: lead.phone, primary: true, label: "work" }];
      if (companyId) body.org_id = num(companyId);
      const res = await http<One<{ id: number }>>("/api/v2/persons", {
        method: "POST",
        body,
      });
      return { id: idOf(res?.data) };
    },

    async findCompany(_domain, name) {
      if (name.length < 2) return null;
      const q = new URLSearchParams({
        term: name,
        fields: "name",
        exact_match: "true",
        limit: "1",
      });
      const res = await http<SearchResult>(
        `/api/v2/organizations/search?${q}`,
        { search: true },
      );
      const item = res?.data?.items?.[0]?.item;
      return item?.id ? { id: String(item.id) } : null;
    },

    async createCompany(domain, name) {
      const res = await http<One<{ id: number }>>("/api/v2/organizations", {
        method: "POST",
        body: { name: name.slice(0, 200), website: `https://${domain}` },
      });
      return { id: idOf(res?.data) };
    },

    async linkContactToCompany(contactId, companyId) {
      await http(`/api/v2/persons/${num(contactId)}`, {
        method: "PATCH",
        body: { org_id: num(companyId) },
      });
    },

    async findNote(contactId, ref) {
      const q = new URLSearchParams({
        person_id: String(num(contactId)),
        limit: "100",
        sort: "add_time DESC",
      });
      const res = await http<List<{ id: number; content?: string }>>(
        `/api/v1/notes?${q}`,
      );
      const hit = (res?.data ?? []).find(
        (n) => typeof n.content === "string" && n.content.includes(ref),
      );
      return hit ? String(hit.id) : null;
    },

    async createNote(contactId, companyId, html, at) {
      const body: Record<string, unknown> = {
        content: html,
        person_id: num(contactId),
        add_time: utcParts(at).both,
      };
      if (companyId) body.org_id = num(companyId);
      const res = await http<One<{ id: number }>>("/api/v1/notes", {
        method: "POST",
        body,
      });
      return idOf(res?.data);
    },

    async findMeeting(contactId, ref) {
      const res = await http<List<{ id: number; note?: string | null }>>(
        `/api/v1/persons/${num(contactId)}/activities?limit=100`,
      );
      const hit = (res?.data ?? []).find(
        (a) => typeof a.note === "string" && a.note.includes(ref),
      );
      return hit ? String(hit.id) : null;
    },

    async saveMeeting(existingId, contactId, companyId, m) {
      const at = utcParts(m.startsAt);
      const body: Record<string, unknown> = {
        subject: (m.title + MEETING_SUBJECT[m.status]).slice(0, 250),
        type: "meeting",
        due_date: at.date,
        due_time: at.time,
        duration: duration(m.startsAt, m.endsAt),
        done: m.status !== "scheduled",
        note: m.body,
        participants: [{ person_id: num(contactId), primary: true }],
      };
      if (companyId) body.org_id = num(companyId);
      if (existingId) {
        try {
          await http(`/api/v2/activities/${num(existingId)}`, {
            method: "PATCH",
            body,
          });
          return existingId;
        } catch (error) {
          if (!(error instanceof CrmError && error.kind === "not_found"))
            throw error;
        }
      }
      const res = await http<One<{ id: number }>>("/api/v2/activities", {
        method: "POST",
        body,
      });
      return idOf(res?.data);
    },

    async findDeal(contactId, title) {
      const q = new URLSearchParams({
        person_id: String(num(contactId)),
        limit: "100",
      });
      const res = await http<List<{ id: number; title?: string }>>(
        `/api/v2/deals?${q}`,
      );
      const hit = (res?.data ?? []).find((d) => d.title === title);
      return hit ? String(hit.id) : null;
    },

    async createDeal(contactId, companyId, input) {
      const body: Record<string, unknown> = {
        title: input.title,
        person_id: num(contactId),
        pipeline_id: num(input.pipelineId),
      };
      if (input.stageId) body.stage_id = num(input.stageId);
      if (companyId) body.org_id = num(companyId);
      const res = await http<One<{ id: number }>>("/api/v2/deals", {
        method: "POST",
        body,
      });
      return idOf(res?.data);
    },

    async optOut(_email, contactId) {
      try {
        const res = await http<One<{ marketing_status?: string }>>(
          `/api/v2/persons/${num(contactId)}`,
          { method: "PATCH", body: { marketing_status: "unsubscribed" } },
        );
        return res?.data?.marketing_status === "unsubscribed";
      } catch (error) {
        if (
          error instanceof CrmError &&
          ["bad_request", "forbidden"].includes(error.kind)
        )
          return false;
        throw error;
      }
    },

    async pipelines() {
      const [p, s] = await Promise.all([
        http<List<{ id: number; name: string }>>("/api/v2/pipelines?limit=100"),
        http<
          List<{
            id: number;
            name: string;
            pipeline_id: number;
            order_nr?: number;
          }>
        >("/api/v2/stages?limit=500"),
      ]);
      const stages = [...(s?.data ?? [])].sort(
        (a, b) => (a.order_nr ?? 0) - (b.order_nr ?? 0),
      );
      return (p?.data ?? []).slice(0, 50).map((pl): Pipeline => ({
        id: String(pl.id),
        name: String(pl.name ?? "").slice(0, 120),
        stages: stages
          .filter((st) => st.pipeline_id === pl.id)
          .slice(0, 50)
          .map((st) => ({
            id: String(st.id),
            name: String(st.name ?? "").slice(0, 120),
          })),
      }));
    },

    async pullPage(cursor: PullCursor, pages: number) {
      const entries: KnownEntry[] = [];
      let seen = 0;
      let phase =
        cursor.phase === "organizations" ? "organizations" : "persons";
      let after = cursor.after;
      for (let i = 0; i < pages; i++) {
        const q = new URLSearchParams({
          limit: String(PIPEDRIVE_PAGE_SIZE),
          include_fields: "open_deals_count,won_deals_count",
        });
        if (after) q.set("cursor", after);
        const res = await http<
          List<{
            emails?: { value?: string }[];
            website?: string | null;
            open_deals_count?: number;
            won_deals_count?: number;
          }>
        >(`/api/v2/${phase}?${q}`);
        const rows = (res?.data ?? []).slice(0, PIPEDRIVE_PAGE_SIZE);
        seen += rows.length;
        for (const r of rows) {
          const f =
            (r.open_deals_count ?? 0) > 0 || (r.won_deals_count ?? 0) > 0;
          if (phase === "persons") {
            for (const e of (r.emails ?? []).slice(0, 5)) {
              const email = cleanEmail(e?.value);
              if (!email) continue;
              entries.push({ k: "email", v: email, f });
              // Pipedrive has no company domains: a work address names one.
              const domain = cleanDomain(email.split("@")[1]);
              if (domain) entries.push({ k: "domain", v: domain, f });
            }
          } else {
            const domain = cleanDomain(r.website);
            if (domain) entries.push({ k: "domain", v: domain, f });
          }
        }
        const next = res?.additional_data?.next_cursor;
        if (typeof next === "string" && next && next.length <= 500) {
          after = next;
          continue;
        }
        if (phase === "persons") {
          phase = "organizations";
          after = undefined;
          continue;
        }
        return { entries, seen, next: null };
      }
      return { entries, seen, next: { phase, ...(after ? { after } : {}) } };
    },
  };
}

/**
 * Checks a token and finds the company's address. With no company domain
 * given, Pipedrive's shared address answers with it.
 */
export async function verifyPipedrive(
  token: string,
  domain: string | null,
  deps: HttpDeps,
): Promise<
  | {
      ok: true;
      label: string;
      apiDomain: string;
      canOptOut: boolean;
      canDeals: boolean;
    }
  | { ok: false; message: string; field?: string }
> {
  type Me = One<{ company_domain?: string; company_name?: string }>;
  const ask = async (base: string) =>
    createHttp({
      provider: "pipedrive",
      baseUrl: base,
      token,
      headers: { "x-api-token": token },
      gapMs: MIN_GAP_MS.pipedrive,
      searchGapMs: SEARCH_GAP_MS.pipedrive,
      deps,
    })<Me>("/api/v1/users/me");
  try {
    let me = await ask(
      domain ? `https://${domain}.pipedrive.com` : "https://api.pipedrive.com",
    );
    const found = pipedriveDomain(String(me?.data?.company_domain ?? ""));
    const apiDomain = domain ?? found;
    if (!apiDomain)
      return {
        ok: false,
        field: "domain",
        message:
          "Pipedrive didn't say which company this token belongs to. Type your company domain (the part before .pipedrive.com).",
      };
    if (!domain) me = await ask(`https://${apiDomain}.pipedrive.com`);
    const name = String(me?.data?.company_name ?? "")
      .replace(/[\u0000-\u001f<>]/g, "")
      .trim()
      .slice(0, 150);
    return {
      ok: true,
      label: name ? `${name} on Pipedrive` : `${apiDomain}.pipedrive.com`,
      apiDomain,
      canOptOut: false,
      canDeals: true,
    };
  } catch (error) {
    if (error instanceof CrmError) {
      if (error.kind === "auth")
        return {
          ok: false,
          message:
            "Pipedrive didn't accept this token. Copy it again from Pipedrive (Personal preferences, API) and paste it here.",
        };
      if (error.kind === "network" && domain)
        return {
          ok: false,
          field: "domain",
          message: `Couldn't reach ${domain}.pipedrive.com. Check the company domain.`,
        };
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
