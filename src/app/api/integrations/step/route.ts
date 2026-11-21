import "server-only";
import { createIntegrationStore } from "@/lib/integrations/store";
import { deliverStep } from "@/lib/integrations/steps";
import { pullIntentStep } from "@/lib/intent/pull";
import { createIntentStore } from "@/lib/intent/store";

// The scheduler's door for Slack posts, webhook deliveries and the daily G2
// intent pull. The database calls it (pg_cron + pg_net, see the
// integrations and review_intent migrations) only when there is work:
//
//   POST /api/integrations/step?job=deliver   send what is due
//   POST /api/integrations/step?job=intent    pull one G2 connection
//
// No session: the call carries the scheduler's random token from Supabase
// Vault, checked by the database (crm_cron_token_ok). A call without it
// learns nothing.

export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const store = createIntegrationStore();
  let allowed = false;
  if (store && token.length >= 32 && token.length <= 200)
    try {
      allowed = await store.cronTokenOk(token);
    } catch (error) {
      console.error(
        "[integrations] token check failed:",
        (error as Error).message,
      );
    }
  if (!store || !allowed) return json({ ok: false }, 401);

  const job = new URL(request.url).searchParams.get("job") ?? "";
  try {
    if (job === "deliver")
      return json({ ok: true, job, ...(await deliverStep({ store })) });
    if (job === "intent") {
      const intent = createIntentStore();
      const r = intent
        ? await pullIntentStep({ store: intent, fetch: (...a) => fetch(...a) })
        : null;
      return json({ ok: true, job, ...(r ?? { pulled: 0, added: 0 }) });
    }
    return json({ ok: false, error: "job" }, 400);
  } catch (error) {
    console.error(`[integrations] ${job} failed:`, (error as Error).message);
    return json({ ok: false, job }, 500);
  }
}
