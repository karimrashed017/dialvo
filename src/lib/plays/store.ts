import "server-only";
import {
  DAILY_CONTACT_CREDIT_CAP,
  DAILY_DRAFT_CAP,
  DAILY_RUN_CAP,
  DAILY_SPEND_CAP_MICROS,
  MAX_DRAFT_ATTEMPTS,
  STEP_LEASE_SECONDS,
} from "@/lib/prospects/config";
import { createServiceClient } from "@/lib/supabase/service";
import {
  API_EVENTS_PER_MINUTE,
  CAMPAIGN_COMPANIES_PER_RUN,
  CAMPAIGN_MAX_ATTEMPTS,
  CAMPAIGN_TARGETS_PER_STEP,
  CREDITS_PER_SIGNAL,
  EVENT_LIST_MAX_ROWS,
  PLAY_MAX_LEADS_PER_START,
  PLAY_REPEAT_DAYS,
  SIGNAL_LEASE_SECONDS,
  SIGNAL_MONITORS_MAX,
  SIGNAL_MONITORS_PER_STEP,
  SIGNAL_PULL_EVERY_HOURS,
  SIGNALS_PER_DAY,
  SPEED_TO_LEAD_PER_STEP,
  TARGET_ACCOUNTS_MAX,
} from "./config";
import type { PlayContext, PlayEvent, PlayLead } from "./prompt";

// The plays' database calls, made with the secret key. Each one is a
// function in the database that takes the workspace's id and touches that
// workspace only (and, where a person started it, checks that the person is
// a member). The caps from config.ts are passed in here and nowhere else.

export type LeadPlay =
  | "reactivation"
  | "closed_lost"
  | "plg"
  | "expansion"
  | "nurture"
  | "onboarding";

export type PlayDraftClaim = {
  capped: boolean;
  remaining: number;
  context: PlayContext;
  drafts: {
    draft_id: string;
    play: string;
    lead: PlayLead;
    event: PlayEvent | null;
  }[];
};

export type CampaignClaim =
  | { status: "not_campaign" | "busy" }
  | { status: "stopped"; stop_reason: string }
  | {
      status: "seeds";
      campaign: CampaignInfo;
      have: number;
    }
  | {
      status: "targets";
      campaign: CampaignInfo;
      work: {
        id: string;
        input: string;
        domain: string | null;
        company_name: string;
      }[];
    };

export type CampaignInfo = {
  id: string;
  kind: "accounts" | "lookalike";
  settings: {
    titles?: string[];
    seeds?: string[];
    same_country?: boolean;
    same_size?: boolean;
  };
};

export type TargetResult =
  | {
      status: "found";
      contact_name: string;
      contact_role: string;
      email: string;
      linkedin_url: string | null;
      company_name: string;
    }
  | {
      status: "no_contact" | "not_found" | "skipped" | "failed";
      reason: string;
    }
  | { status: "retry" };

export type SignalRow = {
  external_id: string;
  signal_type: string;
  detected_at: string | null;
  summary: string;
  snippet: string;
  matched_keyword: string;
  relevance_score: number | null;
  contact_name: string;
  contact_title: string;
  contact_linkedin_url: string | null;
  company_name: string;
  company_domain: string | null;
  company_industry: string;
  company_size: string;
  company_country: string;
};

export type PullClaim = {
  monitor_id: string;
  workspace_id: string;
  external_id: number;
  since: string;
  room: number;
}[];

export interface PlayStore {
  preview(
    workspaceId: string,
    userId: string,
    kind: LeadPlay,
    days: number,
  ): Promise<{ count: number } | null>;
  start(
    workspaceId: string,
    userId: string,
    kind: LeadPlay,
    name: string,
    days: number,
  ): Promise<{ status: string; campaign_id?: string; selected?: number }>;
  stop(
    workspaceId: string,
    campaignId: string,
    userId: string,
  ): Promise<boolean>;
  claimDrafts(
    workspaceId: string,
    userId: string,
    limit: number,
  ): Promise<PlayDraftClaim | null>;
  saveDraft(
    workspaceId: string,
    draftId: string,
    draft: { subject: string; body: string; model: string } | null,
    costMicros: number,
  ): Promise<void>;
  eventImport(
    workspaceId: string,
    userId: string,
    input: {
      event: string;
      link: string;
      date: string;
      audience: "registered" | "attended" | "no_show";
      rows: {
        name: string;
        email: string;
        company: string;
        attended: boolean | null;
      }[];
    },
  ): Promise<{
    status: string;
    campaign_id?: string;
    selected?: number;
    new_leads?: number;
    skipped?: number;
  }>;
  speedWorklist(): Promise<{ workspace_id: string; user_id: string }[]>;
  speedSweep(workspaceId: string): Promise<number>;
  autoApprove(workspaceId: string): Promise<number>;
  recordEvent(
    keyHash: string,
    input: {
      email: string;
      event: string;
      occurredAt: string | null;
      properties: Record<string, unknown>;
    },
  ): Promise<{ status: string; lead_id?: string }>;
  createCompanyCampaign(
    workspaceId: string,
    userId: string,
    kind: "accounts" | "lookalike",
    name: string,
    settings: Record<string, unknown>,
    targets: { input: string; domain: string | null; company_name: string }[],
  ): Promise<{ status: string; campaign_id?: string; targets?: number }>;
  startCampaignRun(
    workspaceId: string,
    campaignId: string,
    userId: string,
    minCredits: number,
  ): Promise<{ status: string; run_id?: string }>;
  claimCampaign(runId: string, workspaceId: string): Promise<CampaignClaim>;
  credits(
    runId: string,
    workspaceId: string,
    targetId: string | null,
    credits: number,
  ): Promise<boolean>;
  addLookalikes(
    runId: string,
    workspaceId: string,
    rows: {
      domain: string;
      company_name: string;
      size_range: string;
      country: string;
    }[],
  ): Promise<number>;
  resolveTarget(
    runId: string,
    workspaceId: string,
    targetId: string,
    domain: string | null,
    companyName: string,
  ): Promise<"ok" | "skipped" | "ignored">;
  saveTarget(
    runId: string,
    workspaceId: string,
    targetId: string,
    result: TargetResult,
  ): Promise<string>;
  releaseCampaign(runId: string, workspaceId: string): Promise<void>;
  /** No more lookups this run: read what was found, or stop. */
  wrapCampaign(
    runId: string,
    workspaceId: string,
    reason: string,
  ): Promise<string | null>;
  reserveCredits(workspaceId: string, credits: number): Promise<boolean>;
  addFact(
    workspaceId: string,
    prospectId: string,
    fact: { fact: string; quote: string; source_url: string; kind: string },
  ): Promise<boolean>;
  monitorBegin(
    workspaceId: string,
    userId: string,
    input: {
      name: string;
      type: string;
      keywords: string[];
      filters: Record<string, unknown>;
      targetCompanies: string[];
      maxMatches: number;
    },
  ): Promise<{ status: string; id?: string }>;
  monitorMade(
    workspaceId: string,
    monitorId: string,
    externalId: number | null,
    error: string | null,
  ): Promise<void>;
  monitorRemove(
    workspaceId: string,
    userId: string,
    monitorId: string,
  ): Promise<{ id: string; external_id: number | null } | null>;
  monitorRemoved(workspaceId: string, monitorId: string): Promise<void>;
  pullClaim(): Promise<PullClaim>;
  ingest(
    workspaceId: string,
    monitorId: string,
    rows: SignalRow[],
    done: boolean,
  ): Promise<{ added: number; skipped: number; over: number } | null>;
  pullRelease(workspaceId: string, monitorId: string): Promise<void>;
  keepBegin(
    workspaceId: string,
    userId: string,
    signalId: string,
  ): Promise<{
    status: string;
    contact_name?: string;
    domain?: string;
    reason?: string;
  }>;
  keepFinish(
    workspaceId: string,
    signalId: string,
    email: string | null,
    charged: boolean,
  ): Promise<string>;
}

/** Null when the server has no secret key. */
export function createPlayStore(): PlayStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const rpc = async <T>(name: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  };
  return {
    preview: (workspaceId, userId, kind, days) =>
      rpc("play_preview", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_kind: kind,
        p_days: days,
        p_repeat_days: PLAY_REPEAT_DAYS[kind],
        p_limit: PLAY_MAX_LEADS_PER_START,
      }),
    start: (workspaceId, userId, kind, name, days) =>
      rpc("play_start", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_kind: kind,
        p_name: name,
        p_days: days,
        p_repeat_days: PLAY_REPEAT_DAYS[kind],
        p_limit: PLAY_MAX_LEADS_PER_START,
      }),
    stop: (workspaceId, campaignId, userId) =>
      rpc("campaign_stop", {
        p_workspace_id: workspaceId,
        p_campaign_id: campaignId,
        p_user_id: userId,
      }),
    claimDrafts: (workspaceId, userId, limit) =>
      rpc("campaign_draft_claim", {
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
    eventImport: (workspaceId, userId, input) =>
      rpc("event_import", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_event: input.event,
        p_link: input.link,
        p_date: input.date,
        p_audience: input.audience,
        p_rows: input.rows,
        p_max: EVENT_LIST_MAX_ROWS,
      }),
    speedWorklist: () => rpc("speed_to_lead_worklist", {}),
    speedSweep: (workspaceId) =>
      rpc("speed_to_lead_sweep", {
        p_workspace_id: workspaceId,
        p_max: SPEED_TO_LEAD_PER_STEP,
      }),
    autoApprove: (workspaceId) =>
      rpc("play_auto_approve", { p_workspace_id: workspaceId }),
    recordEvent: (keyHash, input) =>
      rpc("api_event_record", {
        p_key_hash: keyHash,
        p_email: input.email,
        p_event: input.event,
        p_occurred_at: input.occurredAt,
        p_properties: input.properties,
        p_max_per_minute: API_EVENTS_PER_MINUTE,
      }),
    createCompanyCampaign: (
      workspaceId,
      userId,
      kind,
      name,
      settings,
      targets,
    ) =>
      rpc("campaign_create_company", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_kind: kind,
        p_name: name,
        p_settings: settings,
        p_targets: targets,
        p_max_targets: TARGET_ACCOUNTS_MAX,
      }),
    startCampaignRun: (workspaceId, campaignId, userId, minCredits) =>
      rpc("campaign_run_start", {
        p_workspace_id: workspaceId,
        p_campaign_id: campaignId,
        p_user_id: userId,
        p_max_runs_per_day: DAILY_RUN_CAP,
        p_max_cost_micros_per_day: DAILY_SPEND_CAP_MICROS,
        p_max_credits_per_day: DAILY_CONTACT_CREDIT_CAP,
        p_min_credits: minCredits,
      }),
    claimCampaign: (runId, workspaceId) =>
      rpc("campaign_run_claim", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_lease_seconds: STEP_LEASE_SECONDS,
        p_batch: CAMPAIGN_TARGETS_PER_STEP,
        p_max_attempts: CAMPAIGN_MAX_ATTEMPTS,
        p_max_per_run: CAMPAIGN_COMPANIES_PER_RUN,
      }),
    credits: (runId, workspaceId, targetId, credits) =>
      targetId
        ? rpc("campaign_credits", {
            p_run_id: runId,
            p_workspace_id: workspaceId,
            p_target_id: targetId,
            p_credits: credits,
            p_max_per_day: DAILY_CONTACT_CREDIT_CAP,
          })
        : rpc("campaign_run_credits", {
            p_run_id: runId,
            p_workspace_id: workspaceId,
            p_credits: credits,
            p_max_per_day: DAILY_CONTACT_CREDIT_CAP,
          }),
    addLookalikes: (runId, workspaceId, rows) =>
      rpc("campaign_add_lookalikes", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_rows: rows,
        p_max: CAMPAIGN_COMPANIES_PER_RUN,
      }),
    resolveTarget: (runId, workspaceId, targetId, domain, companyName) =>
      rpc("campaign_target_resolve", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_target_id: targetId,
        p_domain: domain,
        p_company_name: companyName,
      }),
    saveTarget: (runId, workspaceId, targetId, result) =>
      rpc("campaign_target_save", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_target_id: targetId,
        p_result: result,
      }),
    async releaseCampaign(runId, workspaceId) {
      await rpc("campaign_step_release", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
      });
    },
    wrapCampaign: (runId, workspaceId, reason) =>
      rpc("campaign_run_wrap", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_reason: reason,
      }),
    reserveCredits: (workspaceId, credits) =>
      rpc("contact_credits_reserve", {
        p_workspace_id: workspaceId,
        p_credits: credits,
        p_max_per_day: DAILY_CONTACT_CREDIT_CAP,
      }),
    addFact: (workspaceId, prospectId, fact) =>
      rpc("prospect_add_fact", {
        p_workspace_id: workspaceId,
        p_prospect_id: prospectId,
        p_fact: fact,
      }),
    monitorBegin: (workspaceId, userId, input) =>
      rpc("signal_monitor_begin", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_name: input.name,
        p_type: input.type,
        p_keywords: input.keywords,
        p_filters: input.filters,
        p_target_companies: input.targetCompanies,
        p_max_matches: input.maxMatches,
        p_max_monitors: SIGNAL_MONITORS_MAX,
      }),
    async monitorMade(workspaceId, monitorId, externalId, error) {
      await rpc("signal_monitor_made", {
        p_workspace_id: workspaceId,
        p_monitor_id: monitorId,
        p_external_id: externalId,
        p_error: error,
      });
    },
    monitorRemove: (workspaceId, userId, monitorId) =>
      rpc("signal_monitor_remove", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_monitor_id: monitorId,
      }),
    async monitorRemoved(workspaceId, monitorId) {
      await rpc("signal_monitor_removed", {
        p_workspace_id: workspaceId,
        p_monitor_id: monitorId,
      });
    },
    pullClaim: () =>
      rpc("signal_pull_claim", {
        p_limit: SIGNAL_MONITORS_PER_STEP,
        p_lease_seconds: SIGNAL_LEASE_SECONDS,
        p_every_hours: SIGNAL_PULL_EVERY_HOURS,
        p_max_per_day: SIGNALS_PER_DAY,
      }),
    ingest: (workspaceId, monitorId, rows, done) =>
      rpc("signal_ingest", {
        p_workspace_id: workspaceId,
        p_monitor_id: monitorId,
        p_rows: rows,
        p_max_per_day: SIGNALS_PER_DAY,
        p_credits_per_signal: CREDITS_PER_SIGNAL,
        p_done: done,
      }),
    async pullRelease(workspaceId, monitorId) {
      await rpc("signal_pull_release", {
        p_workspace_id: workspaceId,
        p_monitor_id: monitorId,
      });
    },
    keepBegin: (workspaceId, userId, signalId) =>
      rpc("signal_keep_begin", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_signal_id: signalId,
        p_max_credits_per_day: DAILY_CONTACT_CREDIT_CAP,
      }),
    keepFinish: (workspaceId, signalId, email, charged) =>
      rpc("signal_keep_finish", {
        p_workspace_id: workspaceId,
        p_signal_id: signalId,
        p_email: email,
        p_charged: charged,
      }),
  };
}
