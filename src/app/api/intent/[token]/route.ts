import "server-only";
import { createHash } from "node:crypto";
import { INTENT_ROWS_PER_CALL } from "@/lib/integrations/config";
import { readIntentBody } from "@/lib/intent/rows";
import { createIntentStore } from "@/lib/intent/store";
import { createLimiter } from "@/lib/leads/rate-limit";

// POST /api/intent/<token>: review-site intent pushed by the customer's own
// tool or automation (an export job, Zapier, Make, their data warehouse).
//
//   { "signals": [ { "company_domain": "acme.com", "company_name": "Acme",
//       "provider": "g2", "signal_type": "pricing", "topic": "CRM software",
//       "seen_on": "2026-11-20", "activity": 4 } ] }
//
// The token in the address is the only credential: it is made in the app,
// shown once, and only its SHA-256 is kept. Up to 500 signals a request;
// the daily cap and the deduplication are the database's.
//
//   200 { added, duplicates, skipped, invalid }   401 unknown token
//   413 too large   422 not valid   429 too many

const perAddress = createLimiter({ windowMs: 60_000, max: 30 });
const TOKEN = /^dvi_[A-Za-z0-9_-]{30,60}$/;
const MAX_BYTES = 600_000;

const json = (
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const address =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const wait = perAddress.take(address);
  if (wait > 0)
    return json({ error: "rate_limited" }, 429, {
      "Retry-After": String(wait),
    });
  const { token } = await params;
  if (!TOKEN.test(token)) return json({ error: "unauthorised" }, 401);
  const store = createIntentStore();
  if (!store) return json({ error: "unavailable" }, 503);

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BYTES) return json({ error: "too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid", message: "The body must be JSON." }, 422);
  }
  try {
    const source = await store.webhookSource(
      createHash("sha256").update(token).digest("hex"),
    );
    if (!source) return json({ error: "unauthorised" }, 401);
    const read = readIntentBody(body, INTENT_ROWS_PER_CALL);
    if (!read.ok) return json({ error: "invalid", message: read.error }, 422);
    const r = await store.ingest(
      source.workspace_id,
      "webhook",
      source.source_id,
      read.rows,
    );
    if (r.status === "capped")
      return json(
        {
          error: "rate_limited",
          message: "Today's import allowance is used up.",
        },
        429,
        {
          "Retry-After": "3600",
        },
      );
    if (r.status !== "ok") return json({ error: "invalid" }, 422);
    return json(
      {
        added: r.added,
        duplicates: r.duplicates,
        skipped: r.skipped,
        invalid: r.invalid + read.skipped,
      },
      200,
    );
  } catch (error) {
    console.error("[intent] webhook failed:", (error as Error).message);
    return json({ error: "unavailable" }, 503);
  }
}
