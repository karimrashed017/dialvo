import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  JOB_LEASE_SECONDS,
  MAX_JOB_ATTEMPTS,
  PULL_CONTACT_CAP,
  PULL_LEASE_SECONDS,
} from "./config";
import type {
  Credentials,
  Job,
  KnownEntry,
  LinkUpdate,
  Provider,
  PullCursor,
} from "./types";

// CRM sync's database calls, made with the secret key. Each is a function
// in the database that scopes itself to one workspace (see the migration
// 20261120230000_crm_sync.sql). The limits from config.ts are passed in
// here and nowhere else.

export type JobOutcome = "done" | "retry" | "failed" | "skipped" | "auth";

export type PullClaim = {
  workspace_id: string;
  provider: Provider;
  generation: number;
  cursor: PullCursor;
  seen: number;
};

/** The database, as CRM sync needs it. Faked in the unit tests. */
export interface CrmStore {
  connect(input: {
    workspaceId: string;
    userId: string;
    provider: Provider;
    token: string;
    label: string;
    apiDomain: string | null;
    canOptOut: boolean;
    canDeals: boolean;
  }): Promise<{ status: string; provider?: Provider }>;
  credentials(workspaceId: string): Promise<Credentials | null>;
  claimJobs(limit: number, workspaceId?: string): Promise<Job[]>;
  finishJob(
    job: Pick<Job, "id" | "workspace_id">,
    outcome: JobOutcome,
    o?: {
      delaySeconds?: number;
      error?: string;
      externalId?: string;
      link?: LinkUpdate;
    },
  ): Promise<string>;
  claimPull(): Promise<PullClaim | null>;
  savePull(
    claim: PullClaim,
    page: {
      entries: KnownEntry[];
      cursor: PullCursor;
      seen: number;
      done: boolean;
      error?: string;
    },
  ): Promise<string | null>;
  isKnown(
    workspaceId: string,
    email: string | null,
    domain: string | null,
  ): Promise<boolean>;
  cronTokenOk(token: string): Promise<boolean>;
}

/** Null when the server has no secret key. */
export function createCrmStore(): CrmStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const rpc = async <T>(name: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(name, args);
    // The message is the database's, never a token: no call below returns
    // one in an error.
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  };
  return {
    connect: (i) =>
      rpc("crm_connect", {
        p_workspace_id: i.workspaceId,
        p_user_id: i.userId,
        p_provider: i.provider,
        p_token: i.token,
        p_account_label: i.label,
        p_api_domain: i.apiDomain,
        p_can_opt_out: i.canOptOut,
        p_can_deals: i.canDeals,
      }),
    credentials: (workspaceId) =>
      rpc<Credentials | null>("crm_credentials", {
        p_workspace_id: workspaceId,
      }),
    claimJobs: async (limit, workspaceId) =>
      (await rpc<Job[] | null>("crm_jobs_claim", {
        p_limit: limit,
        p_lease_seconds: JOB_LEASE_SECONDS,
        p_max_attempts: MAX_JOB_ATTEMPTS,
        p_workspace_id: workspaceId ?? null,
      })) ?? [],
    finishJob: (job, outcome, o = {}) =>
      rpc<string>("crm_job_finish", {
        p_job_id: job.id,
        p_workspace_id: job.workspace_id,
        p_outcome: outcome,
        p_delay_seconds: o.delaySeconds ?? null,
        p_error: o.error ?? null,
        p_external_id: o.externalId ?? null,
        p_link: o.link ?? null,
        p_max_attempts: MAX_JOB_ATTEMPTS,
      }),
    claimPull: () =>
      rpc<PullClaim | null>("crm_pull_claim", {
        p_lease_seconds: PULL_LEASE_SECONDS,
      }),
    savePull: (claim, page) =>
      rpc<string | null>("crm_pull_save", {
        p_workspace_id: claim.workspace_id,
        p_generation: claim.generation,
        p_entries: page.entries,
        p_cursor: page.cursor,
        p_seen: page.seen,
        p_done: page.done,
        p_cap: PULL_CONTACT_CAP,
        p_error: page.error ?? null,
      }),
    isKnown: (workspaceId, email, domain) =>
      rpc<boolean>("crm_is_known", {
        p_workspace_id: workspaceId,
        p_email: email,
        p_domain: domain,
      }),
    cronTokenOk: (token) =>
      rpc<boolean>("crm_cron_token_ok", { p_token: token }),
  };
}
