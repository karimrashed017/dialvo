import "server-only";
import { inWorkspace } from "@/lib/app/action";
import { createLimiter } from "@/lib/leads/rate-limit";
import { advanceDrafts, type DraftStepResult } from "@/lib/prospects/run";

// Writes the next few first emails for the signed-in person's workspace
// (kept prospects with an email address that have no draft yet). The page
// calls it until nothing is left. Each draft is reserved in the database
// before it is written, so two calls never write the same one.

export const maxDuration = 60;

const stepLimit = createLimiter({ windowMs: 60_000, max: 60 });

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST() {
  let step: DraftStepResult | "limited" | null = null;
  const result = await inWorkspace(async ({ workspace, user }) => {
    if (stepLimit.take(user.id) > 0) {
      step = "limited";
      return;
    }
    step = await advanceDrafts({ workspaceId: workspace.id, userId: user.id });
  });
  if (step === "limited") return json({ ok: false, status: "limited" }, 429);
  const done = step as DraftStepResult | null;
  if (!result.ok || !done)
    return /logged out|workspace/.test(result.message ?? "")
      ? json({ ok: false, status: "not_allowed" }, 401)
      : json({ ok: false, status: "error" }, 500);
  return json({ ok: true, ...done });
}
