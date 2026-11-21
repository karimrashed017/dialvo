import { normalizeEmail } from "@/lib/leads/fields";
import {
  companyDomain,
  linkedInUrl,
  readEmployees,
  readFoundEmail,
  type Employee,
} from "@/lib/plays/findymail";
import { isFreeMail } from "@/lib/prospects/domains";
import {
  findymailCaller,
  type Fetcher,
  type Result,
} from "@/lib/prospects/findymail";

// The contact database (Findymail) lookups that lists, enrichment and
// buying committees use (https://app.findymail.com/docs/, read 21 Nov 2026).
// Like the other adapters: the key stays on the server, no call throws for
// an HTTP or network problem, and every answer is checked and cut to length
// here before it is stored. Each lookup says what it cost, from Findymail's
// published prices (see config.ts): nothing when nothing is found.
//
//   POST /api/verify                {email}                 1 per check
//   POST /api/search/reverse-email  {email, with_profile}   2 with a profile
//   POST /api/search/name           {name, domain}          1 when found
//   POST /api/search/company        {domain}                1 when found
//   POST /api/technologies          {domain}                1 when any
//   POST /api/search/employees      {website, job_titles}   1 per person

const oneLine = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

export type Priced<T> = { value: T; credits: number };

export type Profile = {
  name: string;
  title: string;
  company: string;
  domain: string | null;
  country: string;
  linkedin_url: string | null;
};

export type Company = {
  name: string;
  domain: string;
  size_range: string;
  industry: string;
  description: string;
};

export function readVerify(body: unknown): boolean | null {
  const v = asObject(body)?.verified;
  return typeof v === "boolean" ? v : null;
}

export function readProfile(body: unknown): Profile | null {
  const p = asObject(body);
  if (!p) return null;
  const name = oneLine(p.fullName, 120);
  const title = oneLine(p.jobTitle, 200) || oneLine(p.headline, 200);
  const company = oneLine(p.companyName, 200);
  const domain = companyDomain(p.companyWebsite);
  const linkedin =
    linkedInUrl(p.linkedin_url) ??
    (oneLine(p.username, 100).match(/^[A-Za-z0-9_-]{2,100}$/)
      ? `https://www.linkedin.com/in/${oneLine(p.username, 100)}`
      : null);
  if (!name && !title && !company) return null;
  return {
    name,
    title,
    company,
    domain: domain && !isFreeMail(domain) ? domain : null,
    country: oneLine(p.country, 80),
    linkedin_url: linkedin,
  };
}

export function readCompanyDetails(body: unknown): Company | null {
  const c = asObject(body);
  const domain = companyDomain(c?.domain);
  if (!c || !domain) return null;
  return {
    name: oneLine(c.name, 200),
    domain,
    size_range: oneLine(c.company_size, 40),
    industry: oneLine(c.industry, 120),
    description: oneLine(c.description, 400),
  };
}

export function readTechnologies(body: unknown): string[] | null {
  const data = asObject(body);
  if (!data || !Array.isArray(data.technologies)) return null;
  const names = new Set<string>();
  for (const t of data.technologies) {
    const name = oneLine(asObject(t)?.name, 60);
    if (name) names.add(name);
    if (names.size >= 30) break;
  }
  return [...names];
}

export interface DataFindymail {
  verify(email: string): Promise<Result<Priced<boolean | null>>>;
  profile(email: string): Promise<Result<Priced<Profile | null>>>;
  workEmail(
    name: string,
    domain: string,
  ): Promise<Result<Priced<string | null>>>;
  company(domain: string): Promise<Result<Priced<Company | null>>>;
  technologies(domain: string): Promise<Result<Priced<string[]>>>;
  employees(
    domain: string,
    titles: string[],
    count: number,
  ): Promise<Result<Priced<Employee[]>>>;
}

export function createDataFindymail(
  key: string | undefined = process.env.FINDYMAIL_API_KEY,
  fetcher: Fetcher = fetch,
): DataFindymail | null {
  if (!key) return null;
  const call = findymailCaller(key, fetcher);
  /** 404 is an answer ("nothing found"), free. */
  const none = <T>(value: T): Result<Priced<T>> => ({
    ok: true,
    value: { value, credits: 0 },
  });
  return {
    async verify(email) {
      const clean = normalizeEmail(email);
      if (!clean) return none(null);
      const r = await call("POST", "/api/verify", { email: clean });
      if (!r.ok) return r.problem === "not_found" ? none(null) : r;
      const v = readVerify(r.value);
      return { ok: true, value: { value: v, credits: 1 } };
    },
    async profile(email) {
      const clean = normalizeEmail(email);
      if (!clean) return none(null);
      const r = await call("POST", "/api/search/reverse-email", {
        email: clean,
        with_profile: true,
      });
      if (!r.ok) return r.problem === "not_found" ? none(null) : r;
      const p = readProfile(r.value);
      return { ok: true, value: { value: p, credits: p ? 2 : 0 } };
    },
    async workEmail(name, domain) {
      if (!name.trim() || !domain) return none(null);
      const r = await call("POST", "/api/search/name", { name, domain });
      if (!r.ok) return r.problem === "not_found" ? none(null) : r;
      const email = readFoundEmail(r.value, domain);
      return { ok: true, value: { value: email, credits: email ? 1 : 0 } };
    },
    async company(domain) {
      const r = await call("POST", "/api/search/company", { domain });
      if (!r.ok) return r.problem === "not_found" ? none(null) : r;
      const c = readCompanyDetails(r.value);
      return { ok: true, value: { value: c, credits: c ? 1 : 0 } };
    },
    async technologies(domain) {
      const r = await call("POST", "/api/technologies", { domain });
      if (!r.ok) return r.problem === "not_found" ? none([]) : r;
      const t = readTechnologies(r.value) ?? [];
      return { ok: true, value: { value: t, credits: t.length ? 1 : 0 } };
    },
    async employees(domain, titles, count) {
      const r = await call("POST", "/api/search/employees", {
        website: domain,
        job_titles: titles.slice(0, 10),
        count: Math.min(Math.max(count, 1), 3),
      });
      if (!r.ok) return r.problem === "not_found" ? none([]) : r;
      const people = readEmployees(r.value) ?? [];
      return { ok: true, value: { value: people, credits: people.length } };
    },
  };
}
