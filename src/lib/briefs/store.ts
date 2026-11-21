import "server-only";
import { DAILY_SPEND_CAP_MICROS } from "@/lib/prospects/config";
import { createServiceClient } from "@/lib/supabase/service";
import {
  BRIEF_LEASE_SECONDS,
  BRIEF_MAX_ATTEMPTS,
  BRIEFS_PER_DAY,
  CALENDAR_EVERY_MINUTES,
  CALENDAR_LEASE_SECONDS,
  CALENDAR_MEETINGS_PER_READ,
} from "./config";
import type { BriefContext, Source } from "./types";
import type { CalendarEvent } from "./ics";

// The briefs' and calendar feeds' database calls with the secret key. Each
// is a function in the account_briefs migration that names the workspace
// it touches; the caps from config.ts are passed here.

export type BriefRequest =
  | { status: "queued" | "waiting"; id: string }
  | { status: "capped" | "not_found" };

export type ClaimedFeed = {
  id: string;
  workspace_id: string;
  user_id: string;
  url: string | null;
  own_emails: string[];
};

export interface BriefStore {
  request(
    workspaceId: string,
    userId: string | null,
    leadId: string,
    kind: "brief" | "closed_lost",
    reason: "manual" | "workflow" | "mcp",
  ): Promise<BriefRequest>;
  claim(limit: number): Promise<{ id: string; workspace_id: string }[]>;
  context(workspaceId: string, briefId: string): Promise<BriefContext | null>;
  finish(input: {
    workspaceId: string;
    briefId: string;
    ok: boolean;
    content?: unknown;
    summary?: string;
    sources?: Source[];
    error?: string;
    costMicros: number;
  }): Promise<{ status: string; email: { to: string; name: string } | null }>;
  markEmailed(workspaceId: string, briefId: string): Promise<void>;
  feedSave(
    workspaceId: string,
    userId: string,
    url: string,
    host: string,
  ): Promise<string>;
  feedClaim(limit: number): Promise<ClaimedFeed[]>;
  feedIngest(
    feedId: string,
    workspaceId: string,
    events: CalendarEvent[],
  ): Promise<{ seen: number; matched: number; added: number; updated: number }>;
  feedFail(
    feedId: string,
    workspaceId: string,
    error: string,
    gone: boolean,
  ): Promise<void>;
}

export function createBriefStore(): BriefStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  async function rpc<T>(name: string, args: Record<string, unknown>) {
    const { data, error } = await supabase!.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  }
  return {
    request: (workspaceId, userId, leadId, kind, reason) =>
      rpc("brief_request", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_lead_id: leadId,
        p_kind: kind,
        p_reason: reason,
        p_max_per_day: BRIEFS_PER_DAY,
      }),
    claim: async (limit) =>
      (await rpc<{ id: string; workspace_id: string }[] | null>("brief_claim", {
        p_limit: limit,
        p_lease_seconds: BRIEF_LEASE_SECONDS,
        p_max_cost_micros: DAILY_SPEND_CAP_MICROS,
        p_max_attempts: BRIEF_MAX_ATTEMPTS,
      })) ?? [],
    context: (workspaceId, briefId) =>
      rpc("brief_context", {
        p_workspace_id: workspaceId,
        p_brief_id: briefId,
      }),
    finish: (i) =>
      rpc("brief_finish", {
        p_workspace_id: i.workspaceId,
        p_brief_id: i.briefId,
        p_ok: i.ok,
        p_content: i.content ?? null,
        p_summary: i.summary ?? null,
        p_sources: i.sources ?? [],
        p_error: i.error ?? null,
        p_cost_micros: Math.max(0, Math.round(i.costMicros)),
        p_max_attempts: BRIEF_MAX_ATTEMPTS,
      }),
    markEmailed: async (workspaceId, briefId) => {
      await rpc("brief_mark_emailed", {
        p_workspace_id: workspaceId,
        p_brief_id: briefId,
      });
    },
    feedSave: async (workspaceId, userId, url, host) =>
      (
        await rpc<{ status: string }>("calendar_feed_save", {
          p_workspace_id: workspaceId,
          p_user_id: userId,
          p_url: url,
          p_host: host,
        })
      ).status,
    feedClaim: async (limit) =>
      (await rpc<ClaimedFeed[] | null>("calendar_claim", {
        p_limit: limit,
        p_lease_seconds: CALENDAR_LEASE_SECONDS,
      })) ?? [],
    feedIngest: (feedId, workspaceId, events) =>
      rpc("calendar_ingest", {
        p_feed_id: feedId,
        p_workspace_id: workspaceId,
        p_events: events,
        p_max_meetings: CALENDAR_MEETINGS_PER_READ,
        p_next_minutes: CALENDAR_EVERY_MINUTES,
      }),
    feedFail: async (feedId, workspaceId, error, gone) => {
      await rpc("calendar_fail", {
        p_feed_id: feedId,
        p_workspace_id: workspaceId,
        p_error: error,
        p_gone: gone,
        p_next_minutes: CALENDAR_EVERY_MINUTES,
      });
    },
  };
}
