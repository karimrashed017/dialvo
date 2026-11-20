import "server-only";
import type { Supabase } from "@/lib/supabase/server";

// What the plays, sequences, signals and analytics pages read, as the
// signed-in person: row-level security applies to every query, and each one
// names the workspace too.

function rows<T>(result: {
  data: unknown;
  error: { message: string } | null;
}): T[] {
  if (result.error)
    throw new Error(`Database read failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

export type Counts = {
  targeted: number;
  drafted: number;
  waiting: number;
  approved: number;
  sent: number;
  replied: number;
  meetings: number;
};

export const NO_COUNTS: Counts = {
  targeted: 0,
  drafted: 0,
  waiting: 0,
  approved: 0,
  sent: 0,
  replied: 0,
  meetings: 0,
};

export type Campaign = {
  id: string;
  kind: string;
  name: string;
  status: "active" | "done" | "stopped";
  settings: Record<string, unknown>;
  search_id: string | null;
  seeds_done: boolean;
  created_at: string;
};

export type Target = {
  id: string;
  campaign_id: string;
  input: string;
  domain: string | null;
  company_name: string;
  status: string;
  reason: string | null;
  prospect_id: string | null;
  lead_id: string | null;
  why_now: { fact?: string };
};

export type Monitor = {
  id: string;
  name: string;
  signal_type: string;
  keywords: string[];
  filters: { countries?: string[]; employee_count_ranges?: string[] };
  max_matches: number;
  status: string;
  error: string | null;
  last_pulled_at: string | null;
  created_at: string;
};

export type Signal = {
  id: string;
  monitor_id: string;
  signal_type: string;
  detected_at: string | null;
  summary: string;
  snippet: string;
  relevance_score: number | null;
  contact_name: string;
  contact_title: string;
  contact_linkedin_url: string | null;
  company_name: string;
  company_domain: string | null;
  company_size: string;
  company_country: string;
  status: string;
  reason: string | null;
  prospect_id: string | null;
  created_at: string;
};

export type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type Analytics = {
  since: string;
  totals: {
    leads_found: number;
    emails_sent: number;
    first_emails_sent: number;
    replies: number;
    positive_replies: number;
    meetings_booked: number;
    chats: number;
    chats_answered: number;
    qualified_leads: number;
  };
  daily: { day: string; sent: number; replies: number }[];
  by_source: {
    play: string | null;
    search_id: string | null;
    search_name: string | null;
    sent: number;
    replied: number;
    positive: number;
    meetings: number;
  }[];
  by_mailbox: {
    mailbox_id: string;
    email: string;
    status: string;
    sent: number;
    replies: number;
    bounces: number;
    unsubscribes: number;
  }[];
};

export function playReads(supabase: Supabase, workspaceId: string) {
  const from = (table: string) => supabase.from(table);
  return {
    /** Each play's counts, keyed by its draft kind (outbound_drafts.play). */
    async counts(): Promise<Record<string, Counts>> {
      const { data, error } = await supabase.rpc("play_counts", {
        p_workspace_id: workspaceId,
      });
      if (error) throw new Error(`Database read failed: ${error.message}`);
      return (data ?? {}) as Record<string, Counts>;
    },
    async campaigns(kinds: string[]) {
      return rows<Campaign>(
        await from("outbound_campaigns")
          .select(
            "id, kind, name, status, settings, search_id, seeds_done, created_at",
          )
          .eq("workspace_id", workspaceId)
          .in("kind", kinds)
          .order("created_at", { ascending: false })
          .limit(50),
      );
    },
    async targets(campaignIds: string[]) {
      if (campaignIds.length === 0) return [];
      return rows<Target>(
        await from("outbound_campaign_targets")
          .select(
            "id, campaign_id, input, domain, company_name, status, reason, prospect_id, lead_id, why_now",
          )
          .eq("workspace_id", workspaceId)
          .in("campaign_id", campaignIds)
          .order("position")
          .limit(1000),
      );
    },
    /** Play targets still waiting for their first email to be written. */
    async toWrite(): Promise<number> {
      const active = rows<{ id: string }>(
        await from("outbound_campaigns")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("status", "active")
          .limit(200),
      ).map((c) => c.id);
      if (active.length === 0) return 0;
      const [targets, drafts] = await Promise.all([
        from("outbound_campaign_targets")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("status", "selected")
          .in("campaign_id", active)
          .limit(2000),
        from("outbound_drafts")
          .select("target_id, status")
          .eq("workspace_id", workspaceId)
          .not("target_id", "is", null)
          .limit(5000),
      ]);
      const done = new Set(
        rows<{ target_id: string; status: string }>(drafts)
          .filter((d) => d.status !== "failed")
          .map((d) => d.target_id),
      );
      return rows<{ id: string }>(targets).filter((t) => !done.has(t.id))
        .length;
    },
    async speedSettings() {
      const [row] = rows<{
        enabled: boolean;
        auto_send: boolean;
        enabled_at: string | null;
      }>(
        await from("play_settings")
          .select("enabled, auto_send, enabled_at")
          .eq("workspace_id", workspaceId)
          .eq("play", "speed_to_lead"),
      );
      return row ?? { enabled: false, auto_send: false, enabled_at: null };
    },
    async apiKeys() {
      return rows<ApiKey>(
        await from("workspace_api_keys")
          .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(20),
      );
    },
    async productEvents() {
      return rows<{
        id: string;
        event: string;
        occurred_at: string;
        lead: { id: string; name: string; email: string | null } | null;
      }>(
        await from("lead_product_events")
          .select("id, event, occurred_at, lead:leads(id, name, email)")
          .eq("workspace_id", workspaceId)
          .order("occurred_at", { ascending: false })
          .limit(20),
      );
    },
    async monitors() {
      return rows<Monitor>(
        await from("signal_monitors")
          .select(
            "id, name, signal_type, keywords, filters, max_matches, status, error, last_pulled_at, created_at",
          )
          .eq("workspace_id", workspaceId)
          .neq("status", "removed")
          .order("created_at", { ascending: false }),
      );
    },
    async signals() {
      return rows<Signal>(
        await from("signals")
          .select(
            "id, monitor_id, signal_type, detected_at, summary, snippet, relevance_score, contact_name, contact_title, contact_linkedin_url, company_name, company_domain, company_size, company_country, status, reason, prospect_id, created_at",
          )
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(200),
      );
    },
    async takeoutSearches() {
      return rows<{
        id: string;
        name: string;
        competitor: string | null;
        created_at: string;
      }>(
        await from("prospect_searches")
          .select("id, name, competitor, created_at")
          .eq("workspace_id", workspaceId)
          .eq("play", "takeout")
          .order("created_at", { ascending: false })
          .limit(20),
      );
    },
    async analytics(days: number): Promise<Analytics> {
      const { data, error } = await supabase.rpc("analytics_summary", {
        p_workspace_id: workspaceId,
        p_days: days,
      });
      if (error) throw new Error(`Database read failed: ${error.message}`);
      return data as Analytics;
    },
  };
}
