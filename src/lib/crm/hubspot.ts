import { HUBSPOT_PAGE_SIZE, MIN_GAP_MS, SEARCH_GAP_MS } from "./config";
import { cleanDomain, cleanEmail, splitName } from "./content";
import { createHttp, type Http, type HttpDeps } from "./http";
import {
  CrmError,
  type CrmClient,
  type KnownEntry,
  type MeetingInput,
  type Pipeline,
  type PullCursor,
} from "./types";

// HubSpot, through its CRM API (read 20 Nov 2026):
//   contacts   GET  /crm/v3/objects/contacts/{email}?idProperty=email
//              POST /crm/v3/objects/contacts
//              GET  /crm/v3/objects/contacts?limit=100&after=   (the import)
//   companies  POST /crm/v3/objects/companies/search  (domain EQ)
//              POST /crm/v3/objects/companies
//   link       PUT  /crm/v4/objects/contacts/{id}/associations/default/companies/{id}
//   notes      POST /crm/v3/objects/notes, POST /crm/v3/objects/notes/search
//   meetings   POST /crm/v3/objects/meetings, PATCH /crm/v3/objects/meetings/{id}
//   deals      POST /crm/v3/objects/deals, GET /crm/v3/pipelines/deals
//   opt-out    POST /communication-preferences/v4/statuses/{email}/unsubscribe-all?channel=EMAIL
// Association type ids (HUBSPOT_DEFINED): note to contact 202, note to
// company 190, meeting to contact 200, meeting to company 188, deal to
// contact 3, deal to company 341.
// HubSpot also offers the same objects under date-versioned paths
// (/crm/objects/2026-03/...). The paths here are the long-standing ones;
// HubSpot ends support for its v4 paths (the association call) on
// 30 Mar 2027, so that call must move before then.

export const HUBSPOT_API = "https://api.hubapi.com";

/** The scopes the key needs, and what each is for. */
export const HUBSPOT_SCOPES: { scope: string; why: string; needed: boolean }[] =
  [
    {
      scope: "crm.objects.contacts.read",
      why: "find people and import your contact list",
      needed: true,
    },
    {
      scope: "crm.objects.contacts.write",
      why: "add people, notes and meetings",
      needed: true,
    },
    {
      scope: "crm.objects.companies.read",
      why: "find companies by domain and import them",
      needed: true,
    },
    {
      scope: "crm.objects.companies.write",
      why: "add companies",
      needed: true,
    },
    {
      scope: "crm.objects.deals.read",
      why: "list your pipelines (only for creating deals)",
      needed: false,
    },
    {
      scope: "crm.objects.deals.write",
      why: "create deals (only if you switch that on)",
      needed: false,
    },
    {
      scope: "communication_preferences.read_write",
      why: "unsubscribe people who ask Dialvo to stop",
      needed: false,
    },
  ];

const TYPE = {
  noteContact: 202,
  noteCompany: 190,
  meetingContact: 200,
  meetingCompany: 188,
  dealContact: 3,
  dealCompany: 341,
} as const;

const to = (id: string, typeId: number) => ({
  to: { id },
  types: [
    { associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId },
  ],
});

type Obj = { id: string; properties?: Record<string, string | null> };
type Page = { results?: Obj[]; paging?: { next?: { after?: string } } };

const idOf = (o: unknown): string => {
  const id = (o as Obj | null)?.id;
  if (typeof id !== "string" && typeof id !== "number")
    throw new CrmError("bad_request", "HubSpot answered without an id.");
  return String(id);
};

/** Customers and people or companies with a deal under way. */
const FLAGGED_STAGES = new Set(["customer", "opportunity", "evangelist"]);

const OUTCOME: Record<MeetingInput["status"], string> = {
  scheduled: "SCHEDULED",
  completed: "COMPLETED",
  cancelled: "CANCELED",
  no_show: "NO_SHOW",
};

export function hubspotHttp(token: string, deps: HttpDeps): Http {
  return createHttp({
    provider: "hubspot",
    baseUrl: HUBSPOT_API,
    token,
    headers: { Authorization: `Bearer ${token}` },
    gapMs: MIN_GAP_MS.hubspot,
    searchGapMs: SEARCH_GAP_MS.hubspot,
    deps,
  });
}

export function createHubspotClient(token: string, deps: HttpDeps): CrmClient {
  const http = hubspotHttp(token, deps);
  const searchOne = async (
    object: string,
    property: string,
    operator: string,
    value: string,
  ) => {
    const page = await http<Page>(`/crm/v3/objects/${object}/search`, {
      method: "POST",
      search: true,
      body: {
        filterGroups: [
          { filters: [{ propertyName: property, operator, value }] },
        ],
        properties: [property],
        limit: 1,
      },
    });
    const first = page?.results?.[0];
    return first ? idOf(first) : null;
  };

  return {
    provider: "hubspot",

    async findContact(email) {
      try {
        const o = await http<Obj>(
          `/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email&properties=email`,
        );
        return { id: idOf(o) };
      } catch (error) {
        if (error instanceof CrmError && error.kind === "not_found")
          return null;
        throw error;
      }
    },

    async createContact(lead, companyId) {
      const [firstname, lastname] = splitName(lead.name);
      const properties: Record<string, string> = { email: lead.email ?? "" };
      if (firstname) properties.firstname = firstname;
      if (lastname) properties.lastname = lastname;
      if (lead.phone) properties.phone = lead.phone;
      if (lead.company) properties.company = lead.company.slice(0, 200);
      if (lead.website) properties.website = lead.website.slice(0, 300);
      properties.lifecyclestage = "lead";
      const o = await http<Obj>("/crm/v3/objects/contacts", {
        method: "POST",
        body: {
          properties,
          associations: companyId ? [to(companyId, 279)] : [],
        },
      });
      return { id: idOf(o) };
    },

    async findCompany(domain) {
      const id = await searchOne("companies", "domain", "EQ", domain);
      return id ? { id } : null;
    },

    async createCompany(domain, name) {
      const o = await http<Obj>("/crm/v3/objects/companies", {
        method: "POST",
        body: { properties: { domain, name } },
      });
      return { id: idOf(o) };
    },

    async linkContactToCompany(contactId, companyId) {
      await http(
        `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/default/companies/${encodeURIComponent(companyId)}`,
        { method: "PUT" },
      );
    },

    findNote: (_contactId, ref) =>
      searchOne("notes", "hs_note_body", "CONTAINS_TOKEN", ref),

    async createNote(contactId, companyId, html, at) {
      const assoc = [to(contactId, TYPE.noteContact)];
      if (companyId) assoc.push(to(companyId, TYPE.noteCompany));
      const o = await http<Obj>("/crm/v3/objects/notes", {
        method: "POST",
        body: {
          properties: { hs_timestamp: at, hs_note_body: html },
          associations: assoc,
        },
      });
      return idOf(o);
    },

    findMeeting: (_contactId, ref) =>
      searchOne("meetings", "hs_meeting_body", "CONTAINS_TOKEN", ref),

    async saveMeeting(existingId, contactId, companyId, m) {
      const properties = {
        hs_timestamp: m.startsAt,
        hs_meeting_title: m.title.slice(0, 200),
        hs_meeting_body: m.body,
        hs_meeting_start_time: m.startsAt,
        hs_meeting_end_time: m.endsAt,
        hs_meeting_outcome: OUTCOME[m.status],
      };
      if (existingId) {
        try {
          await http(
            `/crm/v3/objects/meetings/${encodeURIComponent(existingId)}`,
            {
              method: "PATCH",
              body: { properties },
            },
          );
          return existingId;
        } catch (error) {
          // Deleted in HubSpot: write it again.
          if (!(error instanceof CrmError && error.kind === "not_found"))
            throw error;
        }
      }
      const assoc = [to(contactId, TYPE.meetingContact)];
      if (companyId) assoc.push(to(companyId, TYPE.meetingCompany));
      const o = await http<Obj>("/crm/v3/objects/meetings", {
        method: "POST",
        body: { properties, associations: assoc },
      });
      return idOf(o);
    },

    findDeal: (_contactId, title) =>
      searchOne("deals", "dealname", "EQ", title),

    async createDeal(contactId, companyId, input) {
      const properties: Record<string, string> = {
        dealname: input.title,
        pipeline: input.pipelineId,
      };
      if (input.stageId) properties.dealstage = input.stageId;
      const assoc = [to(contactId, TYPE.dealContact)];
      if (companyId) assoc.push(to(companyId, TYPE.dealCompany));
      const o = await http<Obj>("/crm/v3/objects/deals", {
        method: "POST",
        body: { properties, associations: assoc },
      });
      return idOf(o);
    },

    async optOut(email) {
      try {
        await http(
          `/communication-preferences/v4/statuses/${encodeURIComponent(email)}/unsubscribe-all?channel=EMAIL`,
          { method: "POST" },
        );
        return true;
      } catch (error) {
        // No permission for subscriptions, or no such subscriber: a note
        // says it instead.
        if (
          error instanceof CrmError &&
          ["forbidden", "bad_request", "not_found"].includes(error.kind)
        )
          return false;
        throw error;
      }
    },

    async pipelines() {
      const page = await http<{
        results?: {
          id: string;
          label: string;
          displayOrder?: number;
          stages?: { id: string; label: string; displayOrder?: number }[];
        }[];
      }>("/crm/v3/pipelines/deals");
      return (page?.results ?? []).slice(0, 50).map((p): Pipeline => ({
        id: String(p.id).slice(0, 64),
        name: String(p.label ?? "").slice(0, 120),
        stages: [...(p.stages ?? [])]
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
          .slice(0, 50)
          .map((s) => ({
            id: String(s.id).slice(0, 64),
            name: String(s.label ?? "").slice(0, 120),
          })),
      }));
    },

    async pullPage(cursor: PullCursor, pages: number) {
      const entries: KnownEntry[] = [];
      let seen = 0;
      let phase = cursor.phase === "companies" ? "companies" : "contacts";
      let after = cursor.after;
      for (let i = 0; i < pages; i++) {
        const props =
          phase === "contacts"
            ? "email,lifecyclestage"
            : "domain,lifecyclestage";
        const q = new URLSearchParams({
          limit: String(HUBSPOT_PAGE_SIZE),
          properties: props,
          archived: "false",
        });
        if (after) q.set("after", after);
        const page = await http<Page>(`/crm/v3/objects/${phase}?${q}`);
        const results = (page?.results ?? []).slice(0, HUBSPOT_PAGE_SIZE);
        seen += results.length;
        for (const r of results) {
          const p = r.properties ?? {};
          const f = FLAGGED_STAGES.has(
            String(p.lifecyclestage ?? "").toLowerCase(),
          );
          if (phase === "contacts") {
            const email = cleanEmail(p.email);
            if (email) entries.push({ k: "email", v: email, f });
          } else {
            const domain = cleanDomain(p.domain);
            if (domain) entries.push({ k: "domain", v: domain, f });
          }
        }
        const next = page?.paging?.next?.after;
        if (typeof next === "string" && next && next.length <= 200) {
          after = next;
          continue;
        }
        if (phase === "contacts") {
          phase = "companies";
          after = undefined;
          continue;
        }
        return { entries, seen, next: null };
      }
      return { entries, seen, next: { phase, ...(after ? { after } : {}) } };
    },
  };
}

/** What a connect needs to know about a token, checked against HubSpot. */
export async function verifyHubspot(
  token: string,
  deps: HttpDeps,
): Promise<
  | { ok: true; label: string; canOptOut: boolean; canDeals: boolean }
  | { ok: false; message: string }
> {
  const http = hubspotHttp(token, deps);
  // The token's own details, when HubSpot gives them: the account and the
  // scopes. Service keys may not be covered; the reads below decide then.
  let hubId = "";
  let scopes: string[] | null = null;
  try {
    const info = await http<{ hubId?: number; scopes?: unknown }>(
      "/oauth/v2/private-apps/get/access-token-info",
      { method: "POST", body: { tokenKey: token } },
    );
    if (info?.hubId) hubId = String(info.hubId).replace(/\D/g, "").slice(0, 20);
    if (Array.isArray(info?.scopes))
      scopes = info.scopes.filter((s): s is string => typeof s === "string");
  } catch (error) {
    if (error instanceof CrmError && error.kind === "network")
      return { ok: false, message: error.message };
  }
  if (scopes) {
    const missing = HUBSPOT_SCOPES.filter(
      (s) => s.needed && !scopes!.includes(s.scope),
    );
    if (missing.length)
      return {
        ok: false,
        message: `The key is missing ${missing.length === 1 ? "this permission" : "these permissions"}: ${missing.map((m) => m.scope).join(", ")}. Add ${missing.length === 1 ? "it" : "them"} to the key in HubSpot, then connect again.`,
      };
  }
  try {
    await http("/crm/v3/objects/contacts?limit=1&properties=email");
    await http("/crm/v3/objects/companies?limit=1&properties=domain");
  } catch (error) {
    if (error instanceof CrmError) {
      if (error.kind === "auth")
        return {
          ok: false,
          message:
            "HubSpot didn't accept this key. Copy it again from HubSpot (the whole key, starting with pat-) and paste it here.",
        };
      if (error.kind === "forbidden")
        return {
          ok: false,
          message: `HubSpot accepted the key but won't let it read contacts and companies. ${error.message}`,
        };
      return { ok: false, message: error.message };
    }
    throw error;
  }
  let canDeals = scopes
    ? scopes.includes("crm.objects.deals.read") &&
      scopes.includes("crm.objects.deals.write")
    : false;
  if (!scopes)
    try {
      await http("/crm/v3/pipelines/deals");
      canDeals = true;
    } catch {
      canDeals = false;
    }
  const canOptOut = scopes
    ? scopes.some(
        (s) => s.startsWith("communication_preferences.") && /write/.test(s),
      )
    : true; // unknown: tried on the first opt-out, with a note if refused
  return {
    ok: true,
    label: hubId ? `HubSpot account ${hubId}` : "HubSpot",
    canOptOut,
    canDeals,
  };
}
