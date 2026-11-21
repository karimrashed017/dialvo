import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { cellsStep } from "@/lib/data/cells";
import { enrichStep } from "@/lib/data/enrich";
import { createDataFindymail } from "@/lib/data/findymail";
import { sourcingStep } from "@/lib/data/sourcing";
import { createDataStore } from "@/lib/data/store";
import { prospectRuntimeStatus } from "@/lib/prospects/config";
import { advanceRun } from "@/lib/prospects/run";
import { createProspectStore } from "@/lib/prospects/store";
import { createServiceClient } from "@/lib/supabase/service";

// The scheduler's door for lists, enrichment and sourcing. Once a minute,
// only when there is work, the database calls this (pg_cron + pg_net, see
// 20261121100200_enrichment_and_sourcing):
//
//   POST /api/data/step?job=cells    answer queued list cells
//   POST /api/data/step?job=enrich   check leads that are due
//   POST /api/data/step?job=source   move scheduled Find leads runs on
//
// No session and no person: the call carries the scheduler's random token
// from Supabase Vault, checked by asking the database (mail_cron_token_ok),
// which only the secret key may do. A call without the right token learns
// nothing. Every piece of work is leased in the database, so a call that
// dies, repeats or overlaps is safe.

export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const supabase = createServiceClient();
  let allowed = false;
  if (supabase && token.length >= 32 && token.length <= 200) {
    const { data, error } = await supabase.rpc("mail_cron_token_ok", {
      p_token: token,
    });
    if (error) console.error("[data] token check failed:", error.code);
    allowed = data === true;
  }
  if (!supabase || !allowed) return json({ ok: false }, 401);
  const store = createDataStore();
  if (!store) return json({ ok: true, status: "not_configured" });
  const job = new URL(request.url).searchParams.get("job") ?? "";
  const modelOn = prospectRuntimeStatus().on;
  try {
    if (job === "cells")
      return json({
        ok: true,
        job,
        ...(await cellsStep({
          store,
          // Reads ANTHROPIC_API_KEY from the environment.
          client: modelOn ? new Anthropic() : null,
          findymail: createDataFindymail(),
        })),
      });
    if (job === "enrich")
      return json({
        ok: true,
        job,
        ...(await enrichStep({ store, findymail: createDataFindymail() })),
      });
    if (job === "source") {
      const prospects = createProspectStore();
      if (!prospects || !modelOn)
        return json({ ok: true, job, status: "not_configured" });
      return json({
        ok: true,
        job,
        ...(await sourcingStep({
          store,
          startRun: (ws, search, user) => prospects.startRun(ws, search, user),
          advance: (runId, workspaceId) => advanceRun({ runId, workspaceId }),
          recipeColumn: async (listId, recipeId) => {
            const { data } = await supabase
              .from("data_list_columns")
              .select("id")
              .eq("list_id", listId)
              .eq("recipe_id", recipeId)
              .limit(1)
              .maybeSingle();
            return (data as { id: string } | null)?.id ?? null;
          },
        })),
      });
    }
    return json({ ok: false, error: "job" }, 400);
  } catch (error) {
    console.error(`[data] ${job} failed:`, (error as Error).message);
    return json({ ok: false, job }, 500);
  }
}
