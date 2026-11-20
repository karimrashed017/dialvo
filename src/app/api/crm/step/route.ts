import "server-only";
import { realHttpDeps } from "@/lib/crm/http";
import { crmRuntimeStatus } from "@/lib/crm/runtime";
import { pullStep, pushStep } from "@/lib/crm/steps";
import { createCrmStore } from "@/lib/crm/store";

// The scheduler's door for CRM sync. Once a minute, when there is work, the
// database calls this (pg_cron + pg_net, see 20261120230100_crm_scheduler):
//
//   POST /api/crm/step?job=push   write queued leads, notes and meetings
//   POST /api/crm/step?job=pull   import the next pages of a CRM's contacts
//
// No session and no person: the call carries the scheduler's random token,
// kept in Supabase Vault and checked by asking the database
// (crm_cron_token_ok), which only the secret key may do. A call without the
// right token learns nothing, not even whether this server is configured.

export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const store = crmRuntimeStatus().on ? createCrmStore() : null;
  let allowed = false;
  if (store && token.length >= 32 && token.length <= 200)
    try {
      allowed = await store.cronTokenOk(token);
    } catch (error) {
      console.error("[crm] token check failed:", (error as Error).message);
    }
  if (!store || !allowed) return json({ ok: false }, 401);

  const job = new URL(request.url).searchParams.get("job") ?? "";
  try {
    if (job === "push")
      return json({
        ok: true,
        job,
        ...(await pushStep({ store, http: realHttpDeps() })),
      });
    if (job === "pull")
      return json({
        ok: true,
        job,
        ...(await pullStep({ store, http: realHttpDeps() })),
      });
    return json({ ok: false, error: "job" }, 400);
  } catch (error) {
    console.error(`[crm] ${job} failed:`, (error as Error).message);
    return json({ ok: false, job }, 500);
  }
}
