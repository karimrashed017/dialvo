import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  DAILY_DRAFT_CAP,
  DAILY_RUN_CAP,
  DAILY_SPEND_CAP_MICROS,
  DAILY_SUGGESTION_CAP,
  MAX_COMPANIES_PER_RUN,
  MAX_DRAFT_ATTEMPTS,
  MAX_DRY_ROUNDS,
  MAX_RESEARCH_ATTEMPTS,
  MAX_SEARCH_ROUNDS,
  MAX_STEPS_PER_RUN,
  RESEARCH_PER_STEP,
  STEP_LEASE_SECONDS,
} from "./config";
import type { DraftContext, DraftProspect } from "./prompt";
import type {
  Brief,
  Candidate,
  ResearchResult,
  RunStatus,
  Spend,
  Usage,
} from "./types";

// The lead finder's database calls, made with the secret key. Each one is a
// function in the database that takes the workspace's id and touches that
// workspace only (and, where a person started it, checks that the person is
// a member). The caps from config.ts are passed in here and nowhere else.

export type StartResult =
  | { status: "started" | "busy"; run_id: string }
  | { status: "capped" | "not_found" };

export type Claim =
  | { status: "busy" }
  | { status: "done" | "stopped" | "failed"; stop_reason?: string | null }
  | {
      status: "searching" | "researching";
      run: {
        id: string;
        search_id: string;
        brief: Brief;
        target_count: number;
        search_rounds: number;
        searches_used: number;
        cost_micros: number;
        found: number;
      };
      usage: Usage;
      work: {
        id: string;
        domain: string;
        website: string;
        company_name: string;
      }[];
      known: string[];
    };

export type DraftClaim = {
  capped: boolean;
  remaining: number;
  context: DraftContext;
  drafts: { draft_id: string; prospect: DraftProspect }[];
};

/** The database, as the finder needs it. Faked in the unit tests. */
export interface ProspectStore {
  takeSuggestion(workspaceId: string, userId: string): Promise<boolean>;
  recordSpend(workspaceId: string, costMicros: number): Promise<void>;
  startRun(
    workspaceId: string,
    searchId: string,
    userId: string,
  ): Promise<StartResult>;
  claim(runId: string, workspaceId: string): Promise<Claim | null>;
  addCandidates(
    runId: string,
    workspaceId: string,
    candidates: Candidate[],
    spend: Spend,
  ): Promise<{ status: RunStatus; added: number } | null>;
  saveResearch(
    runId: string,
    workspaceId: string,
    prospectId: string,
    result: ResearchResult,
    spend: Spend,
  ): Promise<string | null>;
  release(
    runId: string,
    workspaceId: string,
    end?: { status: "stopped" | "failed"; reason: string },
  ): Promise<void>;
  claimDrafts(
    workspaceId: string,
    userId: string,
    limit: number,
  ): Promise<DraftClaim | null>;
  saveDraft(
    workspaceId: string,
    draftId: string,
    draft: { subject: string; body: string; model: string } | null,
    costMicros: number,
  ): Promise<void>;
}

/** Null when the server has no secret key. */
export function createProspectStore(): ProspectStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const rpc = async <T>(name: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  };
  return {
    takeSuggestion: (workspaceId, userId) =>
      rpc<boolean>("outbound_take_suggestion", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_max: DAILY_SUGGESTION_CAP,
      }),
    async recordSpend(workspaceId, costMicros) {
      await rpc("outbound_record_spend", {
        p_workspace_id: workspaceId,
        p_cost_micros: costMicros,
      });
    },
    startRun: (workspaceId, searchId, userId) =>
      rpc<StartResult>("prospect_run_start", {
        p_workspace_id: workspaceId,
        p_search_id: searchId,
        p_user_id: userId,
        p_target: MAX_COMPANIES_PER_RUN,
        p_max_runs_per_day: DAILY_RUN_CAP,
        p_max_cost_micros_per_day: DAILY_SPEND_CAP_MICROS,
      }),
    claim: (runId, workspaceId) =>
      rpc<Claim | null>("prospect_run_claim", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_lease_seconds: STEP_LEASE_SECONDS,
        p_batch: RESEARCH_PER_STEP,
        p_max_attempts: MAX_RESEARCH_ATTEMPTS,
        p_max_steps: MAX_STEPS_PER_RUN,
      }),
    addCandidates: (runId, workspaceId, candidates, spend) =>
      rpc("prospect_run_add_candidates", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_candidates: candidates,
        p_searches: spend.searches,
        p_input_tokens: spend.input_tokens,
        p_output_tokens: spend.output_tokens,
        p_cost_micros: spend.cost_micros,
        p_max_rounds: MAX_SEARCH_ROUNDS,
        p_max_dry_rounds: MAX_DRY_ROUNDS,
      }),
    saveResearch: (runId, workspaceId, prospectId, result, spend) =>
      rpc<string | null>("prospect_save_research", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_prospect_id: prospectId,
        p_result: result,
        p_input_tokens: spend.input_tokens,
        p_output_tokens: spend.output_tokens,
        p_cost_micros: spend.cost_micros,
      }),
    async release(runId, workspaceId, end) {
      await rpc("prospect_run_release", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_status: end?.status ?? null,
        p_reason: end?.reason ?? null,
      });
    },
    claimDrafts: (workspaceId, userId, limit) =>
      rpc<DraftClaim | null>("outbound_draft_claim", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_limit: limit,
        p_max_drafts_per_day: DAILY_DRAFT_CAP,
        p_max_cost_micros_per_day: DAILY_SPEND_CAP_MICROS,
        p_max_attempts: MAX_DRAFT_ATTEMPTS,
      }),
    async saveDraft(workspaceId, draftId, draft, costMicros) {
      await rpc("outbound_draft_save", {
        p_workspace_id: workspaceId,
        p_draft_id: draftId,
        p_ok: draft !== null,
        p_subject: draft?.subject ?? null,
        p_body: draft?.body ?? null,
        p_model: draft?.model ?? null,
        p_cost_micros: costMicros,
      });
    },
  };
}
