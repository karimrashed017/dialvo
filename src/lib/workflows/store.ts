import "server-only";
import { BRIEFS_PER_DAY } from "@/lib/briefs/config";
import { createServiceClient } from "@/lib/supabase/service";
import {
  SCHEDULE_LEADS_LOOKED_AT,
  SCHEDULE_REPEAT_DAYS,
  WORKFLOW_ACTIONS_PER_DAY,
  WORKFLOW_LEASE_SECONDS,
} from "./config";
import type { ClaimedRun, LeadFacts, WorkflowStore } from "./engine";

// The workflows' database calls with the secret key (the workflows
// migration). Every function names the workspace it touches.

export function createWorkflowStore():
  | (WorkflowStore & {
      hookReceive(
        hash: string,
        event: Record<string, unknown>,
        key: string,
      ): Promise<string>;
    })
  | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  async function rpc<T>(name: string, args: Record<string, unknown>) {
    const { data, error } = await supabase!.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  }
  return {
    claim: async (limit) =>
      (await rpc<ClaimedRun[] | null>("workflow_claim", {
        p_limit: limit,
        p_lease_seconds: WORKFLOW_LEASE_SECONDS,
      })) ?? [],
    act: (workspaceId, runId, index, step, text) =>
      rpc("workflow_act", {
        p_workspace_id: workspaceId,
        p_run_id: runId,
        p_index: index,
        p_step: step,
        p_text: text,
        p_max_actions: WORKFLOW_ACTIONS_PER_DAY,
        p_max_briefs: BRIEFS_PER_DAY,
      }),
    finish: (workspaceId, runId, status, log) =>
      rpc("workflow_finish", {
        p_workspace_id: workspaceId,
        p_run_id: runId,
        p_status: status,
        p_log: log,
      }),
    scheduleLeads: async (workspaceId, workflowId) =>
      (await rpc<LeadFacts[] | null>("workflow_schedule_leads", {
        p_workspace_id: workspaceId,
        p_workflow_id: workflowId,
        p_limit: SCHEDULE_LEADS_LOOKED_AT,
        p_repeat_days: SCHEDULE_REPEAT_DAYS,
      })) ?? [],
    spawn: (workspaceId, workflowId, leadIds, key) =>
      rpc("workflow_spawn", {
        p_workspace_id: workspaceId,
        p_workflow_id: workflowId,
        p_lead_ids: leadIds,
        p_key: key,
      }),
    hookReceive: async (hash, event, key) =>
      (
        await rpc<{ status: string }>("workflow_hook_receive", {
          p_hash: hash,
          p_event: event,
          p_key: key,
        })
      ).status,
  };
}
