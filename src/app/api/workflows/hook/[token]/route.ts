import "server-only";
import { createHash } from "node:crypto";
import { createLimiter } from "@/lib/leads/rate-limit";
import {
  HOOK_BODY_MAX_BYTES,
  HOOK_CALLS_PER_MINUTE,
} from "@/lib/workflows/config";
import { createWorkflowStore } from "@/lib/workflows/store";

// POST /api/workflows/hook/<token>: starts a workflow whose trigger is
// "your system calls a webhook". The secret address is the credential: it
// is made in the app, shown once, and only its SHA-256 is kept.
//
//   { "email": "dana@customer.com", "summary": "Signed up for the webinar", ... }
//
// Any JSON object up to 8 KB. With "email", the run is about that lead (when
// the workspace has one). An Idempotency-Key header (or the same body
// within a minute) is run once.
//
//   202 { status: "queued" }   200 { status: "duplicate" }   401 unknown address
//   409 the workflow is off    413 too large   422 not JSON   429 too many

const perAddress = createLimiter({
  windowMs: 60_000,
  max: HOOK_CALLS_PER_MINUTE,
});
const TOKEN = /^dvw_[A-Za-z0-9_-]{30,60}$/;

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
  const text = await request.text().catch(() => "");
  if (text.length > HOOK_BODY_MAX_BYTES)
    return json({ error: "too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text || "{}");
  } catch {
    return json({ error: "invalid", message: "The body must be JSON." }, 422);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return json(
      { error: "invalid", message: "The body must be a JSON object." },
      422,
    );
  const store = createWorkflowStore();
  if (!store) return json({ error: "unavailable" }, 503);
  const given = (request.headers.get("idempotency-key") ?? "")
    .trim()
    .slice(0, 120);
  const key =
    given ||
    createHash("sha256")
      .update(`${Math.floor(Date.now() / 60_000)}:${text}`)
      .digest("hex")
      .slice(0, 40);
  const event = body as Record<string, unknown>;
  try {
    const status = await store.hookReceive(
      createHash("sha256").update(token).digest("hex"),
      {
        ...event,
        summary:
          typeof event.summary === "string" && event.summary.trim()
            ? event.summary.trim().slice(0, 600)
            : "Your webhook was called.",
      },
      key,
    );
    switch (status) {
      case "queued":
        return json({ status }, 202);
      case "duplicate":
        return json({ status }, 200);
      case "off":
        return json(
          { error: "off", message: "This workflow is switched off." },
          409,
        );
      case "capped":
        return json(
          { error: "capped", message: "Today's workflow runs are used up." },
          429,
        );
      default:
        return json({ error: "unauthorised" }, 401);
    }
  } catch (error) {
    console.error("[workflows] hook failed:", (error as Error).message);
    return json({ error: "unavailable" }, 503);
  }
}
