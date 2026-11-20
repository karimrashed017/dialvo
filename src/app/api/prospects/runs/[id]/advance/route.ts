import "server-only";
import { inWorkspace } from "@/lib/app/action";
import { isUuid } from "@/lib/leads/fields";
import { createLimiter } from "@/lib/leads/rate-limit";
import { advanceRun, type StepResult } from "@/lib/prospects/run";

// One step of a "Find leads" run (see src/lib/prospects/run.ts for the whole
// design). The open page calls this every couple of seconds while a run is
// active. The caller must be signed in and able to see the run; the step
// itself is leased in the database, so calling this too often, or from two
// tabs, does no harm.

/** Vercel may give a step this long. Its own time limits add up to less. */
export const maxDuration = 60;

/** Per person: enough for two open tabs, not for a loop gone wrong. */
const stepLimit = createLimiter({ windowMs: 60_000, max: 90 });

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isUuid(id)) return json({ ok: false, status: "not_found" }, 404);
  let step: StepResult | "limited" | null = null;
  const result = await inWorkspace(async ({ supabase, workspace, user }) => {
    // As the person, under row-level security: is this run theirs to see?
    const { data, error } = await supabase
      .from("prospect_runs")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;
    if (stepLimit.take(user.id) > 0) {
      step = "limited";
      return;
    }
    step = await advanceRun({ runId: id, workspaceId: workspace.id });
  });
  if (step === "limited") return json({ ok: false, status: "limited" }, 429);
  if (!result.ok && !step)
    return /logged out|workspace/.test(result.message ?? "")
      ? json({ ok: false, status: "not_allowed" }, 401)
      : json({ ok: false, status: "error" }, 500);
  const done = step as StepResult | null;
  if (!done || done.status === "not_found")
    return json({ ok: false, status: "not_found" }, 404);
  return json({ ok: true, ...done });
}
