import { normalizeEmail } from "@/lib/leads/fields";
import { isCompanySite, siteDomain } from "@/lib/prospects/domains";
import {
  findymailCaller,
  type Failure,
  type Fetcher,
  type Result,
} from "@/lib/prospects/findymail";

// The Findymail endpoints the plays use (https://app.findymail.com/docs/,
// read 20 Nov 2026), and the checks on what they send back. Like
// src/lib/prospects/findymail.ts: the key is read from FINDYMAIL_API_KEY on
// the server and only sent to app.findymail.com; no call throws for an HTTP
// or network problem; every answer is untrusted data, checked and cut to
// length here before anything is stored or shown.
//
//   POST /api/lookalike/search      companies like a seed. 1 credit per 10
//                                   returned, rounded up.
//   POST /api/search/company        a company from its name. 1 when found.
//   POST /api/search/employees      people at a company by job title. 1 per
//                                   person returned. No email.
//   POST /api/search/name           a person's email from name + domain. 1
//                                   when found.
//   POST /api/technologies          a company's technologies, filtered to the
//                                   one named. 1 when any is returned.
//   POST /api/signals/monitors      make a monitor. Free; each signal it
//                                   delivers costs (see config.ts).
//   DELETE /api/signals/monitors/id remove it. Free.
//   GET /api/signals                what the monitors found. Free to read.

const oneLine = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

function personName(value: unknown): string {
  const name = oneLine(value, 120);
  if (!/\p{L}{2}/u.test(name)) return "";
  if (/[@/\\]|https?:|www\./i.test(name)) return "";
  return name;
}

export function linkedInUrl(value: unknown): string | null {
  const raw = oneLine(value, 300);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!/^([a-z]+\.)?linkedin\.com$/i.test(url.hostname)) return null;
    url.hash = "";
    url.search = "";
    return url.toString().slice(0, 300);
  } catch {
    return null;
  }
}

/** A company's domain, only if it looks like a company's own site. */
export function companyDomain(value: unknown): string | null {
  const domain = siteDomain(value);
  return domain && isCompanySite(domain) ? domain : null;
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

export type LookalikeCompany = {
  domain: string;
  company_name: string;
  size_range: string;
  country: string;
};

export function readLookalike(
  body: unknown,
  max: number,
): { companies: LookalikeCompany[]; credits: number } | null {
  const data = asObject(body);
  if (!data || !Array.isArray(data.companies)) return null;
  const seen = new Set<string>();
  const companies: LookalikeCompany[] = [];
  for (const item of data.companies) {
    const c = asObject(item);
    const domain = companyDomain(c?.domain);
    if (!c || !domain || seen.has(domain)) continue;
    seen.add(domain);
    companies.push({
      domain,
      company_name: oneLine(c.name, 200),
      size_range: oneLine(c.company_size, 40),
      country: oneLine(c.country, 60),
    });
    if (companies.length >= max) break;
  }
  const used = Number(data.credits_used);
  return {
    companies,
    credits:
      Number.isInteger(used) && used >= 0 && used < 10_000
        ? used
        : Math.ceil(data.companies.length / 10),
  };
}

export function readCompany(
  body: unknown,
): { domain: string; name: string } | null {
  const c = asObject(body);
  const domain = companyDomain(c?.domain);
  if (!c || !domain) return null;
  return { domain, name: oneLine(c.name, 200) };
}

export type Employee = { name: string; title: string; linkedin: string | null };

export function readEmployees(body: unknown): Employee[] | null {
  if (!Array.isArray(body)) return null;
  const out: Employee[] = [];
  for (const item of body) {
    const e = asObject(item);
    const name = personName(e?.name);
    if (!e || !name) continue;
    out.push({
      name,
      title: oneLine(e.jobTitle, 200),
      linkedin: linkedInUrl(e.linkedinUrl),
    });
  }
  return out;
}

/** The email the finder returned, only if it is at the company's domain. */
export function readFoundEmail(body: unknown, domain: string): string | null {
  const contact = asObject(asObject(body)?.contact);
  const email = normalizeEmail(
    typeof contact?.email === "string" ? contact.email : "",
  );
  if (!email) return null;
  const at = email.split("@")[1] ?? "";
  // A finder result at another domain isn't this company's person.
  if (at !== domain && !at.endsWith(`.${domain}`)) return null;
  if (
    /^(no-?reply|do-?not-?reply|info|hello|contact|sales|support|admin|office)@/.test(
      email,
    )
  )
    return null;
  return email;
}

/** Whether the named technology was detected, and when. */
export function readTechnology(
  body: unknown,
  name: string,
): { found: boolean; detected: string | null; label: string } | null {
  const data = asObject(body);
  if (!data || !Array.isArray(data.technologies)) return null;
  const wanted = name.trim().toLowerCase();
  for (const item of data.technologies) {
    const t = asObject(item);
    const label = oneLine(t?.name, 80);
    if (!label || label.toLowerCase() !== wanted) continue;
    const at = oneLine(t?.last_detected_at, 40);
    const date = at && !Number.isNaN(Date.parse(at)) ? at.slice(0, 10) : null;
    return { found: true, detected: date, label };
  }
  return { found: false, detected: null, label: name.trim() };
}

export type MonitorInput = {
  name: string;
  signal_type: "new_hire" | "job_change" | "keyword_mention";
  keywords: string[];
  countries: string[];
  employee_count_ranges: string[];
  target_companies: string[];
  max_matches: number;
};

export const EMPLOYEE_RANGES = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+",
] as const;

/** The request body for POST /api/signals/monitors. Pure, for tests. */
export function monitorBody(input: MonitorInput) {
  const icp: Record<string, string[]> = {};
  if (input.countries.length) icp.countries = input.countries;
  if (input.employee_count_ranges.length)
    icp.employee_count_ranges = input.employee_count_ranges;
  return {
    name: input.name,
    signal_type: input.signal_type,
    ...(input.signal_type === "keyword_mention"
      ? { keywords: input.keywords }
      : {}),
    ...(input.target_companies.length && input.signal_type !== "keyword_mention"
      ? { target_companies: input.target_companies }
      : {}),
    ...(Object.keys(icp).length ? { icp_filters: icp } : {}),
    // No enrichment here: an email is looked up only for a signal the team
    // keeps (1 credit then), never for every one delivered.
    max_matches: input.max_matches,
    is_shared: false,
  };
}

export function readMonitorId(body: unknown): number | null {
  const id = Number(asObject(body)?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const SIGNAL_TEXT: Record<string, string> = {
  new_hire: "joined",
  job_change: "started a new role at",
};

/** One signal from GET /api/signals, as it is stored. */
export function readSignal(item: unknown): {
  external_id: string;
  signal_type: string;
  detected_at: string | null;
  summary: string;
  snippet: string;
  matched_keyword: string;
  relevance_score: number | null;
  contact_name: string;
  contact_title: string;
  contact_linkedin_url: string | null;
  company_name: string;
  company_domain: string | null;
  company_industry: string;
  company_size: string;
  company_country: string;
} | null {
  const s = asObject(item);
  if (!s) return null;
  const id = String(s.id ?? "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
  const type = oneLine(s.type, 40);
  const contact = asObject(s.contact) ?? {};
  const company = asObject(s.company) ?? {};
  const payload = asObject(s.payload) ?? {};
  const monitors = Array.isArray(s.monitors) ? s.monitors : [];
  const score = Number(asObject(monitors[0])?.relevance_score);
  const name = personName(contact.name);
  const title = oneLine(contact.job_title, 200);
  const companyName = oneLine(company.name, 200);
  const keyword = oneLine(payload.matched_keyword, 80);
  const at = oneLine(s.detected_at, 40);
  const detected = at && !Number.isNaN(Date.parse(at)) ? at : null;
  const day = detected ? detected.slice(0, 10) : "";
  // One plain sentence, built only from Findymail's fields.
  const who = name || "Someone";
  const summary =
    type === "keyword_mention"
      ? `${who}${title ? ` (${title})` : ""}${companyName ? ` at ${companyName}` : ""} posted about "${keyword || "a keyword you track"}"${day ? ` on ${day}` : ""}`
      : `${who} ${SIGNAL_TEXT[type] ?? "had a change at"} ${companyName || "a company"}${title ? ` as ${title}` : ""}${day ? ` (${day})` : ""}`;
  return {
    external_id: id,
    signal_type: type || "signal",
    detected_at: detected,
    summary: summary.slice(0, 400),
    snippet: oneLine(payload.snippet, 600),
    matched_keyword: keyword,
    relevance_score:
      Number.isInteger(score) && score >= 0 && score <= 5 ? score : null,
    contact_name: name,
    contact_title: title,
    contact_linkedin_url: linkedInUrl(contact.linkedin_url),
    company_name: companyName,
    company_domain: companyDomain(company.domain),
    company_industry: oneLine(company.industry, 120),
    company_size: oneLine(company.employee_count_range, 40),
    company_country: oneLine(company.country, 60),
  };
}

export function readSignalPage(body: unknown): {
  rows: NonNullable<ReturnType<typeof readSignal>>[];
  last: boolean;
} | null {
  const data = asObject(body);
  if (!data || !Array.isArray(data.data)) return null;
  const meta = asObject(data.meta) ?? {};
  const page = Number(meta.current_page);
  const lastPage = Number(meta.last_page);
  return {
    rows: data.data
      .map(readSignal)
      .filter((r): r is NonNullable<typeof r> => r !== null),
    last: !(Number.isInteger(page) && Number.isInteger(lastPage))
      ? true
      : page >= lastPage,
  };
}

export interface PlaysFindymail {
  lookalike(
    seed: string,
    options: { sameCountry: boolean; sameSize: boolean; limit: number },
  ): Promise<Result<{ companies: LookalikeCompany[]; credits: number }>>;
  company(
    name: string,
  ): Promise<Result<{ domain: string; name: string } | null>>;
  employees(
    domain: string,
    titles: string[],
    count?: number,
  ): Promise<Result<Employee[]>>;
  email(name: string, domain: string): Promise<Result<string | null>>;
  technology(
    domain: string,
    name: string,
  ): Promise<
    Result<{ found: boolean; detected: string | null; label: string }>
  >;
  createMonitor(input: MonitorInput): Promise<Result<number>>;
  deleteMonitor(id: number): Promise<Result<true>>;
  signals(
    monitorId: number,
    since: string,
    page: number,
  ): Promise<
    Result<{
      rows: NonNullable<ReturnType<typeof readSignal>>[];
      last: boolean;
    }>
  >;
}

export function createPlaysFindymail(
  key: string | undefined = process.env.FINDYMAIL_API_KEY,
  fetcher: Fetcher = fetch,
): PlaysFindymail | null {
  if (!key) return null;
  const call = findymailCaller(key, fetcher);
  const then = <T>(
    result: Result<unknown>,
    read: (value: unknown) => T | null,
  ): Result<T> => {
    if (!result.ok) return result;
    const value = read(result.value);
    return value === null
      ? { ok: false, problem: "unreadable" }
      : { ok: true, value };
  };
  /** 404 means "not found" for the lookups: an answer, not a failure. */
  const orNone = <T>(result: Result<T>): Result<T | null> =>
    !result.ok && (result as Failure).problem === "not_found"
      ? { ok: true, value: null }
      : result;

  return {
    async lookalike(seed, options) {
      return then(
        await call("POST", "/api/lookalike/search", {
          seed,
          same_country: options.sameCountry,
          same_size: options.sameSize,
          limit: options.limit,
        }),
        (body) => readLookalike(body, options.limit),
      );
    },
    async company(name) {
      return orNone(
        then(await call("POST", "/api/search/company", { name }), readCompany),
      );
    },
    async employees(domain, titles, count = 1) {
      return then(
        await call("POST", "/api/search/employees", {
          website: domain,
          job_titles: titles.slice(0, 10),
          count: Math.min(Math.max(count, 1), 5),
        }),
        readEmployees,
      );
    },
    async email(name, domain) {
      const result = await call("POST", "/api/search/name", { name, domain });
      if (!result.ok)
        return result.problem === "not_found"
          ? { ok: true, value: null }
          : result;
      return { ok: true, value: readFoundEmail(result.value, domain) };
    },
    async technology(domain, name) {
      return then(
        await call("POST", "/api/technologies", {
          domain,
          technologies: [name],
        }),
        (body) => readTechnology(body, name),
      );
    },
    async createMonitor(input) {
      return then(
        await call("POST", "/api/signals/monitors", monitorBody(input)),
        readMonitorId,
      );
    },
    async deleteMonitor(id) {
      const result = await call("DELETE", `/api/signals/monitors/${id}`);
      if (result.ok || result.problem === "not_found")
        return { ok: true, value: true };
      // An empty 204 is read as "unreadable" by the shared caller.
      return result.problem === "unreadable"
        ? { ok: true, value: true }
        : result;
    },
    async signals(monitorId, since, page) {
      const from = since.slice(0, 10);
      return then(
        await call(
          "GET",
          `/api/signals?monitor_id=${monitorId}&date_from=${encodeURIComponent(from)}&page=${page}&per_page=100`,
        ),
        readSignalPage,
      );
    },
  };
}
