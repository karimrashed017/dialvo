import "server-only";
import { createLimiter } from "@/lib/leads/rate-limit";
import { hashApiKey, keyFromHeader } from "@/lib/plays/api-key";
import { API_EVENT_MAX_BYTES } from "@/lib/plays/config";
import { readEventBody } from "@/lib/plays/events";
import { createPlayStore } from "@/lib/plays/store";

// POST /api/v1/events: a workspace's own app records a product event on one
// of its leads, by email, for the trial-users play (PLG conversion).
//
//   Authorization: Bearer dv_live_...   the workspace's API key
//   { "email": "dana@customer.com", "event": "limit_reached",
//     "occurred_at": "2026-11-20T10:00:00Z", "properties": { "limit": "projects" } }
//
// No cookies and no session: the key is the only credential, and only its
// hash is compared, in the database. The database also counts each key's
// events per minute (the cap in src/lib/plays/config.ts) across every server
// instance; a small in-memory brake per address sits in front of it so a
// flood of bad keys never reaches the database.
//
//   202 recorded   401 no such key   404 no lead with that email
//   413 too large  422 not valid     429 too many this minute

const perAddress = createLimiter({ windowMs: 60_000, max: 120 });

const json = (
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });

export async function POST(request: Request) {
  const address =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const wait = perAddress.take(address);
  if (wait > 0)
    return json({ error: "rate_limited" }, 429, {
      "Retry-After": String(wait),
    });

  const key = keyFromHeader(request.headers.get("authorization"));
  if (!key) return json({ error: "unauthorised" }, 401);
  const store = createPlayStore();
  if (!store) return json({ error: "unavailable" }, 503);

  const text = await request.text().catch(() => "");
  if (text.length > API_EVENT_MAX_BYTES)
    return json({ error: "too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid", message: "The body must be JSON." }, 422);
  }
  const read = readEventBody(body);
  if (!read.ok) return json({ error: "invalid", message: read.error }, 422);

  try {
    const result = await store.recordEvent(hashApiKey(key), {
      email: read.value.email,
      event: read.value.event,
      occurredAt: read.value.occurred_at,
      properties: read.value.properties,
    });
    switch (result.status) {
      case "recorded":
        return json({ status: "recorded" }, 202);
      case "unauthorised":
        return json({ error: "unauthorised" }, 401);
      case "rate_limited":
        return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
      case "no_lead":
        return json(
          {
            error: "no_lead",
            message: "No lead in this workspace has that email.",
          },
          404,
        );
      default:
        return json({ error: "invalid" }, 422);
    }
  } catch (error) {
    console.error("[events] record failed:", (error as Error).message);
    return json({ error: "unavailable" }, 503);
  }
}
