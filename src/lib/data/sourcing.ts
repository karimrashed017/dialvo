import "server-only";
import type { StepResult } from "@/lib/prospects/run";
import type { StartResult } from "@/lib/prospects/store";
import {
  SOURCING_RETRY_MINUTES,
  SOURCING_RUNS_PER_MONTH,
  SOURCING_STEP_BUDGET_MS,
  SOURCING_STEPS_PER_CALL,
} from "./config";
import type { ClaimedSchedule, DataStore } from "./store";

// Always-on market sourcing (POST /api/data/step?job=source). A schedule is
// a saved Find leads search that runs on its own: when it is due, a normal
// Find leads run starts as the person who set it up (with every cap a run
// has, plus SOURCING_RUNS_PER_MONTH), the step moves it on a few steps each
// minute, and when it ends, the companies it found go into the schedule's
// list. A run already leaves out companies in the leads, the CRM and the
// never-contact list, and the list leaves out the ones it has. With a
// recipe, it is then answered for the new rows (within the day's caps).

export type SourcingDeps = {
  store: DataStore;
  startRun: (
    workspaceId: string,
    searchId: string,
    userId: string,
  ) => Promise<StartResult>;
  advance: (runId: string, workspaceId: string) => Promise<StepResult>;
  /** The list's column for the recipe, if it has one. */
  recipeColumn: (listId: string, recipeId: string) => Promise<string | null>;
  now?: () => number;
};

const ENDED = new Set(["done", "stopped", "failed"]);

export async function sourceOne(
  s: ClaimedSchedule,
  deps: SourcingDeps,
): Promise<"started" | "waiting" | "finished" | "running"> {
  const now = deps.now ?? Date.now;
  const begun = now();
  let runId = s.run_id;
  if (s.status === "idle" || !runId) {
    if (s.month_runs >= SOURCING_RUNS_PER_MONTH) {
      await deps.store.scheduleEvent(s, "waiting", {
        retryMinutes: 24 * 60,
        note: `This month's ${SOURCING_RUNS_PER_MONTH} scheduled runs are used. It runs again next month.`,
      });
      return "waiting";
    }
    const started = await deps.startRun(s.workspace_id, s.search_id, s.user_id);
    if (started.status !== "started") {
      await deps.store.scheduleEvent(s, "waiting", {
        retryMinutes:
          started.status === "capped"
            ? 6 * 60
            : started.status === "not_found"
              ? 24 * 60
              : SOURCING_RETRY_MINUTES,
        note:
          started.status === "busy"
            ? "Another Find leads run was going. Trying again in an hour."
            : started.status === "capped"
              ? "Find leads' daily limit was reached. Trying again later."
              : "The search or the person who set this up is gone.",
      });
      return "waiting";
    }
    runId = started.run_id;
    await deps.store.scheduleEvent(s, "started", {
      runId,
      note: "Looking for new companies.",
    });
  }

  let last: StepResult = { status: "searching" };
  for (let i = 0; i < SOURCING_STEPS_PER_CALL; i++) {
    if (now() - begun > SOURCING_STEP_BUDGET_MS) break;
    last = await deps.advance(runId, s.workspace_id);
    if (ENDED.has(last.status) || last.status === "not_found") break;
    if (last.status === "not_configured") {
      await deps.store.scheduleEvent(s, "waiting", {
        note: "Find leads isn't switched on yet on Dialvo's side.",
      });
      return "waiting";
    }
    if (last.status === "busy") break;
  }
  if (!ENDED.has(last.status) && last.status !== "not_found") {
    await deps.store.scheduleEvent(s, "waiting", {
      note: "Looking for new companies.",
    });
    return "running";
  }
  const done = await deps.store.scheduleEvent(s, "finished", {
    note:
      last.status === "done"
        ? "Finished."
        : `Ended early${last.stop_reason ? ` (${last.stop_reason.replace(/_/g, " ")})` : ""}.`,
  });
  if (s.recipe_id && (done.added ?? 0) > 0) {
    const column = await deps.recipeColumn(s.list_id, s.recipe_id);
    if (column)
      await deps.store.queue({
        workspaceId: s.workspace_id,
        userId: s.user_id,
        listId: s.list_id,
        columnIds: [column],
        rowIds: null,
        rerun: false,
        dryRun: false,
      });
  }
  return "finished";
}

export async function sourcingStep(
  deps: SourcingDeps,
  limit = 2,
): Promise<{ schedules: number; finished: number }> {
  const claimed = await deps.store.claimSchedules(limit);
  let finished = 0;
  for (const s of claimed) {
    try {
      if ((await sourceOne(s, deps)) === "finished") finished++;
    } catch (error) {
      console.error("[data] sourcing failed:", (error as Error).message);
      await deps.store
        .scheduleEvent(s, "waiting", {
          note: "Something went wrong; trying again soon.",
        })
        .catch(() => undefined);
    }
  }
  return { schedules: claimed.length, finished };
}
