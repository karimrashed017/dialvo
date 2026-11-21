import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { calendarStep } from "@/lib/briefs/calendar";
import { briefStep } from "@/lib/briefs/step";
import { createBriefStore } from "@/lib/briefs/store";
import { createIntegrationStore } from "@/lib/integrations/store";
import { newsStep } from "@/lib/news/check";
import { createNewsStore } from "@/lib/news/store";
import { prospectRuntimeStatus } from "@/lib/prospects/config";
import { workflowStep } from "@/lib/workflows/engine";
import { createWorkflowStore } from "@/lib/workflows/store";

// The scheduler's door for account briefs, calendar feeds, workflows and
// company news. The database calls it (pg_cron + pg_net, see the
// account_briefs, workflows and company_news migrations) only when there is
// work:
//
//   POST /api/activation/step?job=briefs      write the briefs that wait
//   POST /api/activation/step?job=calendar    read the feeds that are due
//   POST /api/activation/step?job=workflows   run the workflow runs that wait
//   POST /api/activation/step?job=news        check the companies that are due
//
// No session: the call carries the scheduler's random token from Supabase
// Vault, checked by the database (crm_cron_token_ok).

export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const gate = createIntegrationStore();
  let allowed = false;
  if (gate && token.length >= 32 && token.length <= 200)
    try {
      allowed = await gate.cronTokenOk(token);
    } catch (error) {
      console.error(
        "[activation] token check failed:",
        (error as Error).message,
      );
    }
  if (!allowed) return json({ ok: false }, 401);

  const job = new URL(request.url).searchParams.get("job") ?? "";
  const modelOn = prospectRuntimeStatus().on;
  try {
    if (job === "workflows") {
      const store = createWorkflowStore();
      return json({
        ok: true,
        job,
        ...(store ? await workflowStep(store) : {}),
      });
    }
    if (job === "calendar") {
      const store = createBriefStore();
      return json({
        ok: true,
        job,
        ...(store ? await calendarStep({ store }) : {}),
      });
    }
    if (job === "briefs") {
      const store = createBriefStore();
      // Without the model key, briefs wait (the page says the model isn't on).
      if (!store || !modelOn) return json({ ok: true, job, claimed: 0 });
      return json({
        ok: true,
        job,
        ...(await briefStep({ store, client: new Anthropic() })),
      });
    }
    if (job === "news") {
      const store = createNewsStore();
      if (!store || !modelOn) return json({ ok: true, job, checked: 0 });
      return json({
        ok: true,
        job,
        ...(await newsStep({ store, client: new Anthropic() })),
      });
    }
    return json({ ok: false, error: "job" }, 400);
  } catch (error) {
    console.error(`[activation] ${job} failed:`, (error as Error).message);
    return json({ ok: false, job }, 500);
  }
}
