import { normalizeEmail } from "@/lib/leads/fields";
import { isCompanySite, siteDomain } from "./domains";

// What Findymail sends back is untrusted data, like a web page: every field is
// checked, cut to length and given its expected type here before anything is
// stored, and nothing in it is ever followed or acted on. Pure functions.

/** One company of an Intellimatch export, as it is stored. */
export type ContactRow = {
  external_id: string;
  domain: string;
  company_name: string;
  description: string;
  size_range: string;
  industries: string[];
  country: string;
  match_score: number | null;
  contact_name: string;
  contact_role: string;
  email: string | null;
  linkedin_url: string | null;
};

const oneLine = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        // Control characters and markup have no place in any of these.
        .replace(/[\u0000-\u001f\u007f<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

// Mailboxes that are never a person: the database shouldn't return them, and
// if it does they are dropped rather than written to.
const NOT_A_PERSON =
  /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|webmaster|hostmaster|privacy|unsubscribe|bounces?)$/i;

/** A person's name: letters, no address or link hiding in it. */
function personName(value: unknown): string {
  const name = oneLine(value, 120);
  if (!/\p{L}{2}/u.test(name)) return "";
  if (/[@/\\]|https?:|www\./i.test(name)) return "";
  return name;
}

function linkedInUrl(value: unknown): string | null {
  const raw = oneLine(value, 300);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!/^([a-z]+\.)?linkedin\.com$/i.test(url.hostname)) return null;
    url.hash = "";
    url.search = "";
    const clean = url.toString();
    return clean.length <= 300 ? clean : null;
  } catch {
    return null;
  }
}

/** A row from GET /api/intellimatch/data, or null if it can't be used. */
export function readContactRow(item: unknown): ContactRow | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const r = item as Record<string, unknown>;
  const domain = siteDomain(r.domain);
  if (!domain || domain.length > 253 || !isCompanySite(domain)) return null;

  let email = normalizeEmail(
    typeof r.contact_email === "string" ? r.contact_email.trim() : null,
  );
  if (email && (email.length > 254 || NOT_A_PERSON.test(email.split("@")[0])))
    email = null;
  const contact_name = personName(r.contact_name);

  const score =
    typeof r.match_score === "number" && Number.isFinite(r.match_score)
      ? Math.round(Math.min(Math.max(r.match_score, 0), 100))
      : null;
  const industries = Array.isArray(r.industries)
    ? [
        ...new Set(
          r.industries.map((i) => oneLine(i, 60)).filter((i) => i.length > 0),
        ),
      ].slice(0, 5)
    : [];
  const id =
    typeof r.id === "number" && Number.isSafeInteger(r.id)
      ? String(r.id)
      : oneLine(r.id, 40).replace(/[^A-Za-z0-9_-]/g, "");
  const size = oneLine(r.employee_count_range, 40);

  return {
    external_id: id,
    domain,
    company_name: oneLine(r.name, 200),
    description: oneLine(r.description, 400),
    size_range: /^[0-9][0-9,.+\- –kK]*$/.test(size) ? size : "",
    industries,
    country: oneLine(r.country, 60),
    match_score: score,
    contact_name,
    contact_role: contact_name ? oneLine(r.contact_job_title, 120) : "",
    email,
    linkedin_url: contact_name ? linkedInUrl(r.contact_linkedin_url) : null,
  };
}

export type ContactPage = {
  rows: ContactRow[];
  /** How many rows the page held, usable or not: each one was charged. */
  returned: number;
  last: boolean;
};

/** A page of the export. Null if the answer isn't the shape we expect. */
export function readContactPage(
  body: unknown,
  page: number,
): ContactPage | null {
  if (!body || typeof body !== "object") return null;
  const { data, meta } = body as { data?: unknown; meta?: unknown };
  if (!Array.isArray(data)) return null;
  const m = (meta && typeof meta === "object" ? meta : {}) as Record<
    string,
    unknown
  >;
  const lastPage =
    typeof m.last_page === "number" && Number.isFinite(m.last_page)
      ? m.last_page
      : null;
  const rows: ContactRow[] = [];
  const seen = new Set<string>();
  for (const item of data.slice(0, 500)) {
    const row = readContactRow(item);
    if (!row || seen.has(row.domain)) continue;
    seen.add(row.domain);
    rows.push(row);
  }
  return {
    rows,
    returned: Math.min(data.length, 500),
    // No page count: stop when a page comes back empty or short.
    last: lastPage !== null ? page >= lastPage : data.length === 0,
  };
}

export type ExportStatus =
  "success" | "processing" | "pending" | "failed" | "not_found";

export function readExportStatus(body: unknown): ExportStatus | null {
  const status =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).status
      : null;
  return (
    (["success", "processing", "pending", "failed", "not_found"] as const).find(
      (s) => s === status,
    ) ?? null
  );
}

/** The export's hash: a short token, nothing else. */
export function readHash(body: unknown): string | null {
  const hash =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).hash
      : null;
  return typeof hash === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(hash)
    ? hash
    : null;
}

export type Credits = {
  /** Finder credits left. Null when the plan isn't credit-based. */
  credits: number | null;
  /** Usage-based plans only: whether the team can still run requests. */
  hasCapacity: boolean | null;
};

/** GET /api/credits. The account's email address in it is never kept. */
export function readCredits(body: unknown): Credits | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const credits =
    typeof b.credits === "number" && Number.isFinite(b.credits)
      ? Math.max(0, Math.floor(b.credits))
      : null;
  const hasCapacity =
    typeof b.has_capacity === "boolean" ? b.has_capacity : null;
  if (credits === null && hasCapacity === null) return null;
  return { credits, hasCapacity };
}

/** Whether there is room for at least `needed` credits of work. */
export function enoughCredits(c: Credits, needed: number): boolean {
  if (c.hasCapacity === false) return false;
  if (c.hasCapacity === true) return true;
  return (c.credits ?? 0) >= needed;
}

/** How many companies the account's balance pays for, or null for no limit. */
export function companiesAffordable(
  c: Credits,
  perCompany: number,
): number | null {
  if (c.hasCapacity !== null) return c.hasCapacity ? null : 0;
  return Math.floor((c.credits ?? 0) / Math.max(perCompany, 1));
}

/** Seconds to wait from a 429, within reason. */
export function readRetryAfter(body: unknown, header: string | null): number {
  const fromBody =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).retry_after
      : null;
  const raw =
    typeof fromBody === "number"
      ? fromBody
      : header && /^\d+$/.test(header.trim())
        ? Number(header.trim())
        : NaN;
  if (!Number.isFinite(raw)) return 30;
  return Math.min(Math.max(Math.ceil(raw), 1), 3600);
}

/** A list id from the exclusion-list endpoints. */
export function readListId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

/** The id of the list with this exact name, from GET exclusion-lists. */
export function findList(body: unknown, name: string): number | null {
  const lists =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).lists
      : null;
  if (!Array.isArray(lists)) return null;
  for (const list of lists) {
    if (!list || typeof list !== "object") continue;
    const l = list as Record<string, unknown>;
    if (l.name === name && l.is_owner !== false) return readListId(l.id);
  }
  return null;
}
