import "server-only";
import type { ModelClient } from "@/lib/prospects/model";
import { SPEED_TO_LEAD_PER_STEP } from "./config";
import { advancePlayDrafts } from "./drafts";
import type { PlayStore } from "./store";

// Speed to lead, run by the mail scheduler's "write" job once a minute (see
// src/lib/mail/steps.ts). For each workspace that switched it on:
//   1. new form and chat leads with an email become the play's targets
//      (speed_to_lead_sweep: only leads that arrived after it was switched
//      on, never anyone already emailed, do not contact or on the
//      never-contact list);
//   2. their reply emails are written, under the usual daily draft caps;
//   3. only if an owner chose "send without waiting", they are approved
//      (play_auto_approve, the same checks as a person's approval).
// The sending engine then gives each approved email a slot like any other:
// inside the send window, the mailbox's daily limit and the workspace's cap.

export type SpeedResult = {
  workspaces: number;
  added: number;
  written: number;
  approved: number;
};

export async function speedToLeadStep(deps: {
  store: PlayStore | null;
  client: ModelClient | null;
  /** Stop starting new workspaces once this returns false. */
  inTime?: () => boolean;
}): Promise<SpeedResult> {
  const result: SpeedResult = {
    workspaces: 0,
    added: 0,
    written: 0,
    approved: 0,
  };
  const { store, client } = deps;
  if (!store || !client) return result;
  for (const { workspace_id, user_id } of await store.speedWorklist()) {
    if (deps.inTime && !deps.inTime()) break;
    try {
      result.workspaces += 1;
      result.added += await store.speedSweep(workspace_id);
      const drafts = await advancePlayDrafts(
        {
          workspaceId: workspace_id,
          userId: user_id,
          limit: SPEED_TO_LEAD_PER_STEP,
        },
        { store, client },
      );
      result.written += drafts.written;
      result.approved += await store.autoApprove(workspace_id);
    } catch (error) {
      console.error("[plays] speed to lead failed:", (error as Error).message);
    }
  }
  return result;
}
