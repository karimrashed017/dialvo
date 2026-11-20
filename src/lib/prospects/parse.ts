import { EMAIL_MAX_WORDS, SUBJECT_MAX_CHARS } from "./config";
import { isCompanySite, siteDomain } from "./domains";
import { emailRole, isUnsuitableEmail } from "./extract";
import type { Brief, Candidate, Fact, ResearchResult, SitePage } from "./types";

// What the model returns is a claim, not a fact. Everything it says is
// checked here against something we hold ourselves (the pages we fetched,
// the addresses we read off them) before it is stored. Pure functions.

const oneLine = (value: unknown, max: number) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** For comparing a quote with a page: case, spacing and quote marks aside. */
const loose = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

// --- The search's answer -----------------------------------------------------

/**
 * The companies in a search answer: real-looking domains of companies' own
 * sites, each once, none we already have, at most `max`. Anything else in
 * the answer (a social profile, a directory, a bare name) is dropped.
 */
export function readCandidates(
  text: string,
  known: Iterable<string>,
  max: number,
): Candidate[] {
  const block = /<companies>([\s\S]*?)<\/companies>/i.exec(text)?.[1] ?? text;
  const start = block.indexOf("[");
  const end = block.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let list: unknown;
  try {
    list = JSON.parse(block.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>(known);
  const out: Candidate[] = [];
  for (const item of list) {
    if (out.length >= max) break;
    if (!item || typeof item !== "object") continue;
    const { name, website } = item as Record<string, unknown>;
    const domain = siteDomain(website);
    if (!domain || !isCompanySite(domain) || seen.has(domain)) continue;
    seen.add(domain);
    out.push({
      domain,
      website: `https://${domain}/`,
      company_name: oneLine(name, 200),
    });
  }
  return out;
}

// --- The reading of one company ------------------------------------------------

const KINDS = ["business", "individual", "not_a_company", "unclear"] as const;

/**
 * Turns the model's report on one company into what is stored, keeping only
 * what the pages back up:
 *   * the email must be one of the addresses we read off the pages
 *     ourselves, and is stored with the page it is on. The model can pick
 *     among them; it cannot introduce one. The named contact's own address
 *     wins when the site prints it, then the model's pick, then the best
 *     general address from the pages, or none. A mailbox for something else
 *     (hr@, support@, press@, billing@) is never chosen: a company with
 *     only those has no email address as far as we are concerned;
 *   * a contact's name must appear on the pages;
 *   * every fact needs a quote that appears on the page it names, and that
 *     page must be one we read;
 *   * a site that isn't a business, or doesn't match, is skipped, and so
 *     is a company that sells what the workspace sells (a competitor) or is
 *     far larger than the description asks for.
 */
export function readResearch(
  raw: string,
  pages: SitePage[],
  fallbackName: string,
): ResearchResult | null {
  const data = parseObject(raw);
  if (!data) return null;
  const kind = KINDS.find((k) => k === data.kind);
  if (!kind) return null;
  const company_name = oneLine(data.company_name, 200) || fallbackName;
  if (kind !== "business")
    return { status: "skipped", reason: "not_a_business", company_name };
  // The fit check. A rival or a giant is left out whatever else was said.
  if (data.fit === "sells_similar")
    return { status: "skipped", reason: "competitor", company_name };
  if (data.fit === "too_large")
    return { status: "skipped", reason: "too_large", company_name };
  if (data.matches !== true || data.fit === "not_a_fit")
    return { status: "skipped", reason: "not_a_match", company_name };

  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const pageText = new Map(pages.map((p) => [p.url, loose(p.text)]));
  const allText = [...pageText.values()].join("\n");

  // Phone: only from the pages' tel: links.
  const phonePage = pages.find((p) => p.phones.length > 0);

  // Contact: the name has to be printed on the site.
  let contact_name = oneLine(data.contact_name, 200);
  let contact_role = oneLine(data.contact_role, 120);
  let contact_source_url = "";
  if (contact_name) {
    const needle = loose(contact_name);
    const claimed = oneLine(data.contact_source_url, 2000);
    const on =
      (byUrl.has(claimed) && pageText.get(claimed)!.includes(needle)
        ? claimed
        : undefined) ??
      pages.find((p) => pageText.get(p.url)!.includes(needle))?.url;
    if (on && needle.length >= 3) contact_source_url = on;
    else contact_name = "";
  }
  if (!contact_name) contact_role = "";

  // Email: only from our own list, and never a mailbox for something else.
  const published = pages
    .flatMap((p) => p.emails.map((e) => ({ ...e, url: p.url })))
    .filter((e) => !isUnsuitableEmail(e.email));
  const wanted = oneLine(data.email, 254).toLowerCase();
  const email =
    // The named contact's own address beats a shared inbox.
    (contact_name
      ? published.find((e) => emailRole(e.email, contact_name) === "person")
      : undefined) ??
    published.find((e) => e.email === wanted) ??
    published[0] ??
    null;

  const facts: Fact[] = [];
  if (Array.isArray(data.facts))
    for (const item of data.facts) {
      if (facts.length >= 3) break;
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      const fact = oneLine(f.fact, 300);
      const quote = oneLine(f.quote, 400);
      const source_url = oneLine(f.source_url, 2000);
      const text = pageText.get(source_url);
      // A quote too short to mean anything proves nothing.
      if (!fact || quote.length < 15 || !text) continue;
      if (!text.includes(loose(quote))) continue;
      facts.push({ fact, quote, source_url });
    }

  // A "location" the pages never mention is the model's guess.
  let location = oneLine(data.location, 200);
  if (location) {
    const first = loose(location.split(/[,(]/)[0]);
    if (first.length < 2 || !allText.includes(first)) location = "";
  }

  return {
    status: "found",
    company_name,
    website: pages[0]?.url ?? "",
    summary: oneLine(data.summary, 240),
    location,
    contact_name,
    contact_role,
    contact_source_url,
    email: email?.email ?? "",
    email_source_url: email?.url ?? "",
    email_kind: email?.kind ?? "",
    phone: phonePage?.phones[0] ?? "",
    phone_source_url: phonePage?.url ?? "",
    facts,
    pages: pages.map((p) => p.url),
  };
}

// --- The first email --------------------------------------------------------------

export type DraftProblem =
  | "unreadable"
  | "empty"
  | "too_long"
  | "not_plain_text"
  | "placeholder"
  | "result_claim";

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

// Backstops for rules the writer is also given. Each catches the plain cases;
// a person still reads every draft.
const MARKUP = /<\/?[a-z][^>]*>|\!\[[^\]]*\]\(|\[[^\]]+\]\(https?:/i;
const PLACEHOLDER = /\[[A-Za-z][^\]\n]{0,40}\]|\{\{[^}]*\}\}|\{[a-z_ ]{2,30}\}/;
const RESULT_CLAIM =
  /\d\s?%|\b\d+(\.\d+)?x\b|\bguarantee[ds]?\b|\b(double|triple|tripled|doubled)\b[^.]{0,40}\b(revenue|sales|leads|pipeline|bookings|conversions?)\b/i;

/** The model's subject and body, or why the draft can't be shown. */
export function readDraft(
  raw: string,
):
  | { ok: true; subject: string; body: string }
  | { ok: false; problem: DraftProblem } {
  const data = parseObject(raw);
  if (!data) return { ok: false, problem: "unreadable" };
  const subject = oneLine(data.subject, SUBJECT_MAX_CHARS + 30);
  const body =
    typeof data.body === "string"
      ? data.body
          .replace(/\r\n?/g, "\n")
          .replace(/[^\S\n]+/g, " ")
          .replace(/ ?\n ?/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
      : "";
  if (!subject || !body) return { ok: false, problem: "empty" };
  if (words(body) > EMAIL_MAX_WORDS || subject.length > SUBJECT_MAX_CHARS + 30)
    return { ok: false, problem: "too_long" };
  const all = `${subject}\n${body}`;
  if (MARKUP.test(all)) return { ok: false, problem: "not_plain_text" };
  if (PLACEHOLDER.test(all)) return { ok: false, problem: "placeholder" };
  if (RESULT_CLAIM.test(all)) return { ok: false, problem: "result_claim" };
  return { ok: true, subject, body };
}

// --- The suggestion -----------------------------------------------------------------

/** What a search leaves out unless the team says otherwise. */
export const DEFAULT_EXCLUSIONS = {
  competitors: "companies that sell the same kind of product as us",
  giants: "very large enterprises",
};

/**
 * The suggested description, with the two exclusions every search starts
 * with: the workspace's own competitors always, and very large enterprises
 * unless the model read that the workspace sells to them.
 */
export function readSuggestion(raw: string): (Brief & { name: string }) | null {
  const data = parseObject(raw);
  if (!data) return null;
  const description = oneLine(data.description, 2000);
  if (!description) return null;
  const exclusions = oneLine(data.exclusions, 900)
    .split(/\s*[;\n]\s*|\s*,\s*(?=[a-z])/i)
    .map((part) => part.replace(/[.\s]+$/, "").trim())
    .filter(Boolean);
  const has = (pattern: RegExp) => exclusions.some((e) => pattern.test(e));
  if (!has(/same (kind|type|sort) of (product|service|thing)|competitor/i))
    exclusions.push(DEFAULT_EXCLUSIONS.competitors);
  if (
    data.sells_to_enterprises !== true &&
    !has(/enterprise|very large|household|multinational|global compan/i)
  )
    exclusions.push(DEFAULT_EXCLUSIONS.giants);
  return {
    name: oneLine(data.name, 120),
    description,
    location: oneLine(data.location, 200),
    company_size: oneLine(data.company_size, 200),
    exclusions: exclusions.join(", ").slice(0, 1000),
  };
}
