import { normalizeEmail } from "@/lib/leads/fields";
import { parseCsv } from "@/lib/leads/csv";
import { siteDomain } from "@/lib/prospects/domains";
import { EVENT_LIST_MAX_ROWS, TARGET_ACCOUNTS_MAX } from "./config";

// The lists a team pastes or uploads for a play: event registrants or
// attendees, and target accounts. Untrusted text: read, checked and capped
// here, then checked again in the database. Pure functions.

const clean = (value: string | undefined, max: number) =>
  (value ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export type EventRow = {
  name: string;
  email: string;
  company: string;
  attended: boolean | null;
};

const YES = /^(y|yes|true|1|attended|present|showed|joined|x)$/i;
const NO =
  /^(n|no|false|0|absent|no[- ]?show|did not attend|didn't attend|missed)$/i;

/** "yes", "no", or not given. */
export function readAttended(value: string | undefined): boolean | null {
  const v = clean(value, 40);
  if (YES.test(v)) return true;
  if (NO.test(v)) return false;
  return null;
}

const column = (headers: string[], ...names: RegExp[]) =>
  headers.findIndex((h) => names.some((n) => n.test(h.trim())));

/**
 * A registrant or attendee list as CSV, with a header row. Columns are found
 * by name: email (required), name (or first and last name), company, and
 * attended (yes or no). Rows with no valid email are counted, not kept;
 * repeated emails are kept once.
 */
export function readEventList(
  text: string,
):
  | { ok: true; rows: EventRow[]; skipped: number; hasAttended: boolean }
  | { ok: false; error: string } {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (table.length < 2)
    return {
      ok: false,
      error: "The file needs a header row and at least one person.",
    };
  const headers = table[0].map((h) => h.toLowerCase());
  const email = column(headers, /e-?mail/);
  if (email < 0)
    return {
      ok: false,
      error: "No email column was found. Name one column “email”.",
    };
  const name = column(headers, /^(full )?name$/, /^attendee$/, /^registrant$/);
  const first = column(headers, /^first/);
  const last = column(headers, /^(last|sur)/);
  const company = column(headers, /compan/, /organi[sz]ation/, /^org$/);
  const attended = column(headers, /attend/, /^present$/, /show/);
  const body = table.slice(1);
  if (body.length > EVENT_LIST_MAX_ROWS)
    return {
      ok: false,
      error: `That list has ${body.length.toLocaleString("en")} people. The most at once is ${EVENT_LIST_MAX_ROWS.toLocaleString("en")}.`,
    };
  const seen = new Set<string>();
  const rows: EventRow[] = [];
  let skipped = 0;
  for (const r of body) {
    const address = normalizeEmail(r[email] ?? "");
    if (!address || seen.has(address)) {
      skipped += 1;
      continue;
    }
    seen.add(address);
    const full =
      name >= 0
        ? r[name]
        : [first >= 0 ? r[first] : "", last >= 0 ? r[last] : ""].join(" ");
    rows.push({
      name: clean(full, 200),
      email: address,
      company: company >= 0 ? clean(r[company], 200) : "",
      attended: attended >= 0 ? readAttended(r[attended]) : null,
    });
  }
  if (rows.length === 0)
    return {
      ok: false,
      error: "No row in that file has a valid email address.",
    };
  return { ok: true, rows, skipped, hasAttended: attended >= 0 };
}

export type AccountRow = {
  input: string;
  domain: string | null;
  company_name: string;
};

/**
 * Target accounts, one per line (or a CSV's first column, or a "website" /
 * "domain" / "company" column): a website, or a company's name. Repeats are
 * kept once.
 */
export function readAccounts(
  text: string,
):
  | { ok: true; rows: AccountRow[]; skipped: number }
  | { ok: false; error: string } {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (table.length === 0)
    return {
      ok: false,
      error: "Paste at least one company: a website or a name.",
    };
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const site = column(headers, /^(website|domain|url|site)$/);
  const nameCol = column(headers, /^(company|company name|name|account)$/);
  const hasHeader = site >= 0 || nameCol >= 0;
  const body = hasHeader ? table.slice(1) : table;
  const seen = new Set<string>();
  const rows: AccountRow[] = [];
  let skipped = 0;
  for (const r of body) {
    const siteText = clean(hasHeader ? (site >= 0 ? r[site] : "") : r[0], 300);
    const nameText = clean(
      hasHeader ? (nameCol >= 0 ? r[nameCol] : "") : r[1],
      200,
    );
    const domain = siteDomain(siteText) ?? (nameText ? null : null);
    const input = domain ? siteText : siteText || nameText;
    const key = domain ?? input.toLowerCase();
    if (!input || seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    rows.push({
      input,
      domain,
      company_name: domain ? nameText : nameText || input,
    });
  }
  if (rows.length === 0)
    return { ok: false, error: "No company was found in that list." };
  if (rows.length > TARGET_ACCOUNTS_MAX)
    return {
      ok: false,
      error: `That list has ${rows.length} companies. The most at once is ${TARGET_ACCOUNTS_MAX}.`,
    };
  return { ok: true, rows, skipped };
}

/** Seed companies for a lookalike search: websites only, at most `max`. */
export function readSeeds(text: string, max: number): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const d = siteDomain(part);
    if (d && !out.includes(d)) out.push(d);
    if (out.length >= max) break;
  }
  return out;
}
