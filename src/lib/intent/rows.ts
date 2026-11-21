import { parseCsv } from "@/lib/leads/csv";

// Review-site intent rows: the one shape every source is turned into before
// the database stores it (intent_ingest), and the readers for an uploaded
// CSV and a webhook body. Pure.

export type IntentRow = {
  provider: string;
  company_name: string;
  company_domain: string;
  company_country: string;
  company_size: string;
  company_industry: string;
  signal_type: string;
  topic: string;
  activity: number | null;
  seen_on: string | null;
};

const str = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, max)
    : typeof v === "number"
      ? String(v).slice(0, max)
      : "";

const DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** YYYY-MM-DD from a date or timestamp, or null. */
export function readDay(v: unknown): string | null {
  const s = str(v, 40);
  const m = DATE.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/** One row from any object with our field names (or close to them). */
export function readIntentRow(o: Record<string, unknown>): IntentRow | null {
  const domain = str(
    o.company_domain ?? o.domain ?? o.website ?? o.company_website,
    300,
  );
  if (!domain) return null;
  const activity = Number(o.activity ?? o.total_activity ?? o.page_views);
  return {
    provider: str(o.provider ?? o.source ?? o.site, 40) || "other",
    company_name: str(o.company_name ?? o.company ?? o.name, 200),
    company_domain: domain,
    company_country: str(o.company_country ?? o.country, 60),
    company_size: str(
      o.company_size ??
        o.company_employees ??
        o.employees ??
        o.org_employees_range,
      40,
    ),
    company_industry: str(o.company_industry ?? o.industry, 120),
    signal_type: str(
      o.signal_type ?? o.visit_type ?? o.activity_type ?? o.type,
      60,
    ),
    topic: str(
      o.topic ??
        o.product_name ??
        o.left_product_name ??
        o.category_name ??
        o.category ??
        o.product,
      200,
    ),
    activity:
      Number.isFinite(activity) && activity >= 0
        ? Math.min(Math.round(activity), 1_000_000)
        : null,
    seen_on: readDay(
      o.seen_on ?? o.day ?? o.visit_date ?? o.date ?? o.last_seen,
    ),
  };
}

const header = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export type IntentCsv =
  | { ok: true; rows: IntentRow[]; skipped: number }
  | { ok: false; error: string };

/**
 * An exported CSV: a header row and one row per signal. The columns are
 * matched by name (company_domain or domain or website, company_name,
 * signal_type or visit_type, topic or product_name or category_name,
 * seen_on or day or visit_date, activity, country, industry, provider);
 * the order doesn't matter.
 */
export function readIntentCsv(text: string, maxRows: number): IntentCsv {
  const table = parseCsv(text.replace(/^﻿/, ""));
  if (table.length < 2)
    return {
      ok: false,
      error: "The file needs a header row and at least one row.",
    };
  const heads = table[0].map(header);
  if (
    !heads.some((h) =>
      ["company_domain", "domain", "website", "company_website"].includes(h),
    )
  )
    return {
      ok: false,
      error:
        "The file needs a column with each company's website (company_domain, domain or website).",
    };
  const body = table.slice(1).filter((r) => r.some((c) => c.trim()));
  if (body.length > maxRows)
    return { ok: false, error: `At most ${maxRows} rows in one file.` };
  const rows: IntentRow[] = [];
  let skipped = 0;
  for (const r of body) {
    const o: Record<string, unknown> = {};
    heads.forEach((h, i) => {
      if (h && o[h] === undefined) o[h] = r[i] ?? "";
    });
    const row = readIntentRow(o);
    if (row) rows.push(row);
    else skipped++;
  }
  return { ok: true, rows, skipped };
}

/** A webhook body: { "signals": [ ... ] } or a bare array. */
export function readIntentBody(
  body: unknown,
  maxRows: number,
):
  | { ok: true; rows: IntentRow[]; skipped: number }
  | { ok: false; error: string } {
  const list = Array.isArray(body)
    ? body
    : body &&
        typeof body === "object" &&
        Array.isArray((body as { signals?: unknown }).signals)
      ? (body as { signals: unknown[] }).signals
      : null;
  if (!list) return { ok: false, error: 'Send { "signals": [ ... ] }.' };
  if (list.length > maxRows)
    return { ok: false, error: `At most ${maxRows} signals in one request.` };
  const rows: IntentRow[] = [];
  let skipped = 0;
  for (const item of list) {
    const row =
      item && typeof item === "object" && !Array.isArray(item)
        ? readIntentRow(item as Record<string, unknown>)
        : null;
    if (row) rows.push(row);
    else skipped++;
  }
  return { ok: true, rows, skipped };
}
