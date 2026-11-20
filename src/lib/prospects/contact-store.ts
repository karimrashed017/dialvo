import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  CONTACT_COMPANIES_PER_RUN,
  CONTACT_CREDITS_PER_COMPANY,
  CONTACT_EXCLUSIONS_PER_SYNC,
  CONTACT_MAX_POLLS,
  DAILY_CONTACT_CREDIT_CAP,
  DAILY_RUN_CAP,
  DAILY_SPEND_CAP_MICROS,
  STEP_LEASE_SECONDS,
} from "./config";
import type { ContactRow } from "./findymail-parse";
import type { StartResult } from "./store";

// The contact database's side of a run, in the database (see the migration
// 20261120164840_contact_database.sql). Like store.ts: secret key only, each
// function names the workspace, and the caps are passed in from config.ts.

export type ContactClaim =
  | { status: "not_contact" }
  | { status: "busy" }
  | { status: "waiting" }
  | { status: "stopped"; stop_reason: string }
  | {
      status: "searching";
      phase: "start" | "wait" | "read";
      hash: string | null;
      page: number;
      limit: number | null;
      query: string;
      titles: string[][];
      target_count: number;
      credits_today: number;
      exclusion_list_id: number | null;
      exclusions_synced_at: string | null;
    };

export type Exclusions = {
  list_id: number | null;
  read_at: string;
  domains: string[];
};

export interface ContactStore {
  startRun(
    workspaceId: string,
    searchId: string,
    userId: string,
    query: { query: string; titles: string[][] },
  ): Promise<StartResult | { status: "invalid" }>;
  claim(runId: string, workspaceId: string): Promise<ContactClaim | null>;
  /** Companies the day's credit cap allows this run to ask for. */
  reserve(runId: string, workspaceId: string, wanted: number): Promise<number>;
  step(
    runId: string,
    workspaceId: string,
    next: {
      phase?: "start" | "wait" | "read";
      hash?: string;
      page?: number;
      waitSeconds?: number;
      refundCredits?: number;
    },
  ): Promise<void>;
  add(
    runId: string,
    workspaceId: string,
    rows: ContactRow[],
    returned: number,
    last: boolean,
  ): Promise<{ status: string; added: number } | null>;
  exclusions(workspaceId: string): Promise<Exclusions>;
  setList(workspaceId: string, listId: number): Promise<void>;
  synced(workspaceId: string, at: string): Promise<void>;
}

/** Null when the server has no secret key. */
export function createContactStore(): ContactStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const rpc = async <T>(name: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  };
  return {
    startRun: (workspaceId, searchId, userId, q) =>
      rpc("prospect_contact_run_start", {
        p_workspace_id: workspaceId,
        p_search_id: searchId,
        p_user_id: userId,
        p_target: CONTACT_COMPANIES_PER_RUN,
        p_max_runs_per_day: DAILY_RUN_CAP,
        p_max_cost_micros_per_day: DAILY_SPEND_CAP_MICROS,
        p_query: q.query,
        p_titles: q.titles,
        p_max_credits_per_day: DAILY_CONTACT_CREDIT_CAP,
        p_credits_per_company: CONTACT_CREDITS_PER_COMPANY,
      }),
    claim: (runId, workspaceId) =>
      rpc("prospect_contact_claim", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_lease_seconds: STEP_LEASE_SECONDS,
        p_max_polls: CONTACT_MAX_POLLS,
      }),
    reserve: (runId, workspaceId, wanted) =>
      rpc<number>("prospect_contact_reserve", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_wanted: wanted,
        p_credits_per_company: CONTACT_CREDITS_PER_COMPANY,
        p_max_credits_per_day: DAILY_CONTACT_CREDIT_CAP,
      }),
    async step(runId, workspaceId, next) {
      await rpc("prospect_contact_step", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_phase: next.phase ?? null,
        p_hash: next.hash ?? null,
        p_page: next.page ?? null,
        p_wait_seconds: next.waitSeconds ?? null,
        p_refund_credits: next.refundCredits ?? 0,
      });
    },
    add: (runId, workspaceId, rows, returned, last) =>
      rpc("prospect_contact_add", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_rows: rows,
        p_returned: returned,
        p_last: last,
        p_credits_per_company: CONTACT_CREDITS_PER_COMPANY,
      }),
    exclusions: (workspaceId) =>
      rpc("prospect_contact_exclusions", {
        p_workspace_id: workspaceId,
        p_limit: CONTACT_EXCLUSIONS_PER_SYNC,
      }),
    async setList(workspaceId, listId) {
      await rpc("prospect_contact_set_list", {
        p_workspace_id: workspaceId,
        p_list_id: listId,
      });
    },
    async synced(workspaceId, at) {
      await rpc("prospect_contact_synced", {
        p_workspace_id: workspaceId,
        p_at: at,
      });
    },
  };
}
