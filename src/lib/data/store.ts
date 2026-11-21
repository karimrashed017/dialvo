import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { AnswerType, AnswerValue, DataField } from "./answers";
import {
  CELL_LEASE_SECONDS,
  CELL_MAX_ATTEMPTS,
  DAILY_DATA_CREDITS,
  DAILY_RESEARCH_CELLS,
  DAILY_RESEARCH_SPEND_MICROS,
  DATA_CELL_CREDITS,
  ENRICH_LEASE_SECONDS,
  ENRICH_MAX_ATTEMPTS,
  ENRICH_RESERVE_PER_LEAD,
  LIST_ROWS_MAX,
  RESEARCH_EST_MICROS_PER_CELL,
  RUN_MAX_CELLS,
  SOURCING_LEASE_SECONDS,
} from "./config";

// The database calls of lists, enrichment and sourcing that run with the
// secret key (the scheduler's steps, and the few server actions that check
// the person first and then act for them). Each is a function in the
// database that touches one workspace only. The caps from config.ts are
// passed in here and nowhere else.

export type QueueResult = {
  status: "queued" | "estimate" | "capped" | "empty" | "not_found";
  cells?: number;
  research?: number;
  credits?: number;
  micros?: number;
  left_cells?: number;
  left_micros?: number;
  left_credits?: number;
  max_cells?: number;
};

export type ClaimedCell = {
  workspace_id: string;
  list_id: string;
  row_id: string;
  column_id: string;
  attempts: number;
  est_micros: number;
  est_credits: number;
  list_kind: "companies" | "people";
  workspace: { name: string; website: string | null };
  row: {
    name: string;
    title: string;
    company: string;
    domain: string | null;
    email: string | null;
    linkedin_url: string | null;
    country: string;
    size_range: string;
    fields: Record<string, unknown>;
  };
  column: {
    name: string;
    kind: "research" | "data";
    question: string | null;
    answer_type: AnswerType | null;
    options: string[];
    data_field: DataField | null;
  };
};

export type CellFinish = {
  status: "done" | "failed" | "skipped" | "retry";
  value?: AnswerValue;
  text?: string;
  sourceUrl?: string | null;
  reason?: string;
  costMicros?: number;
  credits?: number;
  rowPatch?: {
    fields?: Record<string, unknown>;
    email?: string | null;
    title?: string;
    size_range?: string;
  } | null;
};

export type ClaimedLead = {
  workspace_id: string;
  lead_id: string;
  reserved: number;
  lead: {
    name: string;
    email: string | null;
    company: string | null;
    website: string | null;
    title: string;
    company_size: string;
    industry: string;
    domain: string | null;
  };
  state: {
    email_status: "valid" | "invalid" | "unknown" | null;
    work_email: string | null;
    profile_title: string;
    profile_company: string;
    profile_domain: string | null;
    linkedin_url: string | null;
    last_checked_at: string | null;
  };
  bounced: boolean;
  settings: {
    fill_emails: boolean;
    fill_titles: boolean;
    fill_company: boolean;
    job_changes: boolean;
    personal_emails: boolean;
  };
};

export type EnrichEvent = {
  kind: "filled" | "job_change" | "email_invalid" | "work_email";
  summary: string;
  changes?: Record<string, { from: string; to: string }>;
};

export type EnrichFinish = {
  outcome: "done" | "failed" | "retry";
  fill?: Record<string, string>;
  state?: Partial<ClaimedLead["state"]>;
  events?: EnrichEvent[];
  credits: number;
  error?: string;
};

export type ClaimedSchedule = {
  id: string;
  workspace_id: string;
  search_id: string;
  list_id: string;
  recipe_id: string | null;
  every_days: number;
  status: "idle" | "running";
  run_id: string | null;
  run_status: string | null;
  user_id: string;
  month_runs: number;
};

export interface DataStore {
  queue(input: {
    workspaceId: string;
    userId: string;
    listId: string;
    columnIds: string[];
    rowIds: string[] | null;
    rerun: boolean;
    dryRun: boolean;
  }): Promise<QueueResult>;
  claimCells(limit: number): Promise<ClaimedCell[]>;
  finishCell(cell: ClaimedCell, finish: CellFinish): Promise<string>;
  claimLeads(limit: number): Promise<ClaimedLead[]>;
  finishLead(lead: ClaimedLead, finish: EnrichFinish): Promise<string>;
  claimSchedules(limit: number): Promise<ClaimedSchedule[]>;
  scheduleEvent(
    s: ClaimedSchedule,
    event: "started" | "waiting" | "finished",
    extra: { runId?: string; retryMinutes?: number; note: string },
  ): Promise<{ added?: number }>;
  takeCredits(
    workspaceId: string,
    userId: string,
    credits: number,
  ): Promise<boolean>;
  giveBackCredits(workspaceId: string, credits: number): Promise<void>;
  addCommittee(input: {
    workspaceId: string;
    userId: string;
    accountId: string;
    titles: string[];
    people: {
      name: string;
      title: string;
      email: string | null;
      linkedin_url: string | null;
    }[];
  }): Promise<{ added: number; existing: number } | null>;
  startPlaybookFor(input: {
    workspaceId: string;
    userId: string;
    playbookId: string;
    leadIds: string[];
    limit: number;
    label: string;
  }): Promise<{
    status: "created" | "empty" | "not_found";
    campaign_id?: string;
    selected?: number;
    left_out?: number;
  }>;
}

/** Null when the server has no secret key. */
export function createDataStore(): DataStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const rpc = async <T>(name: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  };
  return {
    queue: (i) =>
      rpc<QueueResult>("data_cells_queue", {
        p_workspace_id: i.workspaceId,
        p_user_id: i.userId,
        p_list_id: i.listId,
        p_column_ids: i.columnIds,
        p_row_ids: i.rowIds,
        p_rerun: i.rerun,
        p_dry_run: i.dryRun,
        p_max_cells: RUN_MAX_CELLS,
        p_day_cells: DAILY_RESEARCH_CELLS,
        p_day_micros: DAILY_RESEARCH_SPEND_MICROS,
        p_day_credits: DAILY_DATA_CREDITS,
        p_est_micros: RESEARCH_EST_MICROS_PER_CELL,
        p_est_credits: DATA_CELL_CREDITS,
      }),
    claimCells: (limit) =>
      rpc<ClaimedCell[]>("data_cells_claim", {
        p_limit: limit,
        p_lease_seconds: CELL_LEASE_SECONDS,
        p_max_attempts: CELL_MAX_ATTEMPTS,
      }),
    finishCell: (cell, f) =>
      rpc<string>("data_cell_finish", {
        p_workspace_id: cell.workspace_id,
        p_row_id: cell.row_id,
        p_column_id: cell.column_id,
        p_status: f.status,
        p_value: f.value ?? null,
        p_text: f.text ?? "",
        p_source_url: f.sourceUrl ?? null,
        p_reason: f.reason ?? "",
        p_cost_micros: Math.max(0, Math.round(f.costMicros ?? 0)),
        p_credits: Math.max(0, Math.round(f.credits ?? 0)),
        p_row_patch: f.rowPatch ?? null,
      }),
    claimLeads: (limit) =>
      rpc<ClaimedLead[]>("enrichment_claim", {
        p_limit: limit,
        p_lease_seconds: ENRICH_LEASE_SECONDS,
        p_max_attempts: ENRICH_MAX_ATTEMPTS,
        p_reserve: ENRICH_RESERVE_PER_LEAD,
      }),
    finishLead: (lead, f) =>
      rpc<string>("enrichment_finish", {
        p_workspace_id: lead.workspace_id,
        p_lead_id: lead.lead_id,
        p_outcome: f.outcome,
        p_fill: f.fill ?? {},
        p_state: f.state ?? {},
        p_events: f.events ?? [],
        p_credits: f.credits,
        p_reserved: lead.reserved,
        p_refresh_days: null,
        p_error: f.error ?? null,
      }),
    claimSchedules: (limit) =>
      rpc<ClaimedSchedule[]>("sourcing_claim", {
        p_limit: limit,
        p_lease_seconds: SOURCING_LEASE_SECONDS,
      }),
    scheduleEvent: async (s, event, extra) =>
      (await rpc<{ added?: number }>("sourcing_step_done", {
        p_workspace_id: s.workspace_id,
        p_id: s.id,
        p_event: event,
        p_run_id: extra.runId ?? null,
        p_retry_minutes: extra.retryMinutes ?? null,
        p_note: extra.note,
        p_max_rows: LIST_ROWS_MAX,
      })) ?? {},
    takeCredits: (workspaceId, userId, credits) =>
      rpc<boolean>("data_credits_take", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_credits: credits,
        p_day_cap: DAILY_DATA_CREDITS,
      }),
    async giveBackCredits(workspaceId, credits) {
      if (credits > 0)
        await rpc("data_credits_give_back", {
          p_workspace_id: workspaceId,
          p_credits: credits,
        });
    },
    addCommittee: (i) =>
      rpc("account_committee_add", {
        p_workspace_id: i.workspaceId,
        p_user_id: i.userId,
        p_account_id: i.accountId,
        p_titles: i.titles,
        p_people: i.people,
      }),
    startPlaybookFor: (i) =>
      rpc("playbook_start_for", {
        p_workspace_id: i.workspaceId,
        p_user_id: i.userId,
        p_playbook_id: i.playbookId,
        p_lead_ids: i.leadIds,
        p_limit: i.limit,
        p_label: i.label,
      }),
  };
}
