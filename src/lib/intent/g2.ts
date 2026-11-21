import { readIntentRow, type IntentRow } from "./rows";

// G2's Buyer Intent API (docs read 21 Nov 2026: https://data.g2.com/api/v2/docs,
// operation getGlobalBuyerIntentInteractions). The customer's own G2 API
// token, made in my.G2 under Integrations, API Tokens; it reads Buyer Intent
// only when their G2 plan includes it (buyer_intent.read). One daily pull
// asks for yesterday's and today's activity, one row per company, signal,
// product or category and day, 250 rows a page.
//
//   GET https://data.g2.com/api/v2/buyer_intent
//       ?dimensions=company_name,company_domain,...,signal_type,day
//       &measures=total_activity&dimension_filters[day_gteq]=YYYY-MM-DD
//       &page[size]=250[&page[after]=cursor]
//   Authorization: Bearer <token>
//   Accept: application/vnd.api+json
//
// Pure but for the fetch, which is passed in.

export const G2_BASE = "https://data.g2.com";

const DIMENSIONS = [
  "company_name",
  "company_domain",
  "company_country",
  "company_employees",
  "company_industry",
  "signal_type",
  "left_product_name",
  "category_name",
  "provider",
  "day",
];

export function g2Url(since: string, after: string | null, size = 250): string {
  const q = new URLSearchParams();
  q.set("dimensions", DIMENSIONS.join(","));
  q.set("measures", "total_activity");
  q.set("dimension_filters[day_gteq]", since);
  q.set("page[size]", String(size));
  if (after) q.set("page[after]", after);
  return `${G2_BASE}/api/v2/buyer_intent?${q.toString()}`;
}

type G2Page = {
  data?: { attributes?: Record<string, unknown> }[];
  links?: { next?: string | null };
};

/** The rows of one page, and the cursor of the next one (only on G2's own host). */
export function readG2Page(json: unknown): {
  rows: IntentRow[];
  next: string | null;
} {
  const page = (json ?? {}) as G2Page;
  const rows: IntentRow[] = [];
  for (const item of Array.isArray(page.data) ? page.data : []) {
    const a = item?.attributes ?? {};
    const row = readIntentRow({
      ...a,
      provider: a.provider || "g2",
      topic: a.left_product_name || a.category_name || "",
      seen_on: a.day,
    });
    if (row) rows.push(row);
  }
  let next: string | null = null;
  if (typeof page.links?.next === "string" && page.links.next) {
    try {
      const u = new URL(page.links.next);
      if (u.origin === G2_BASE) next = u.searchParams.get("page[after]");
    } catch {
      next = null;
    }
  }
  return { rows, next };
}

export type G2Error = "revoked" | "not_included" | "unavailable";

export class G2Problem extends Error {
  constructor(
    readonly kind: G2Error,
    message: string,
  ) {
    super(message);
  }
}

export async function g2Get(
  token: string,
  url: string,
  fetcher: typeof fetch,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetcher(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.api+json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new G2Problem("unavailable", "G2 didn't answer.");
  }
  if (res.status === 401)
    throw new G2Problem("revoked", "G2 refused the token (401).");
  if (res.status === 403)
    throw new G2Problem(
      "not_included",
      "G2 accepted the token but it can't read Buyer Intent (403). Buyer Intent needs a G2 plan that includes it.",
    );
  if (!res.ok) throw new G2Problem("unavailable", `G2 answered ${res.status}.`);
  return res.json();
}

/** Checks a token before it is saved: one row of the last week. */
export async function checkG2Token(
  token: string,
  fetcher: typeof fetch,
  today = new Date(),
): Promise<void> {
  const since = new Date(today.getTime() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await g2Get(token, g2Url(since, null, 1), fetcher);
}

/** Reads up to `maxPages` pages since a day. */
export async function pullG2(
  token: string,
  since: string,
  maxPages: number,
  fetcher: typeof fetch,
): Promise<IntentRow[]> {
  const rows: IntentRow[] = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = readG2Page(await g2Get(token, g2Url(since, after), fetcher));
    rows.push(...page.rows);
    if (!page.next) break;
    after = page.next;
  }
  return rows;
}
