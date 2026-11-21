import "server-only";
import type { Supabase } from "@/lib/supabase/server";

// What the app's pages read about Slack, webhooks, website visitors and
// review-site intent, as the signed-in person (row-level security applies;
// each query also names the workspace).

export type SlackConnection = {
  status: "active" | "error" | "disconnected";
  status_reason: string | null;
  channel_label: string;
  events: string[];
  digest_hour: number;
  last_posted_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  connected_at: string;
};

export type Endpoint = {
  id: string;
  url: string;
  description: string;
  events: string[];
  status: "active" | "paused" | "disabled";
  status_reason: string | null;
  secret_prefix: string;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type Delivery = {
  id: string;
  target: "slack" | "webhook";
  endpoint_id: string | null;
  event: string;
  status: string;
  attempts: number;
  response_status: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  next_attempt_at: string;
};

export type Tracking = {
  enabled: boolean;
  consent_mode: "wait" | "notice";
  pricing_paths: string[];
  tag_email_links: boolean;
};

export const DEFAULT_TRACKING: Tracking = {
  enabled: false,
  consent_mode: "wait",
  pricing_paths: ["/pricing"],
  tag_email_links: false,
};

export type SiteCompany = {
  id: string;
  domain: string;
  name: string;
  country: string;
  source: string;
  visitors: number;
  page_views: number;
  pricing_views: number;
  first_seen_at: string;
  last_seen_at: string;
  status: "new" | "retargeted" | "dismissed";
  campaign_id: string | null;
};

export type KnownVisitor = {
  id: string;
  identified_by: string | null;
  page_views: number;
  pricing_views: number;
  last_seen_at: string;
  lead: {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
    status: string;
  } | null;
  company: { domain: string; name: string } | null;
};

export type PageView = {
  id: string;
  path: string;
  title: string;
  referrer_host: string | null;
  is_pricing: boolean;
  viewed_at: string;
  visitor: {
    lead: { id: string; name: string; email: string | null } | null;
    company: { domain: string; name: string } | null;
  } | null;
};

export type IntentSource = {
  id: string;
  kind: "webhook" | "g2";
  status: "active" | "error" | "disconnected";
  status_reason: string | null;
  token_prefix: string | null;
  last_import_at: string | null;
  last_import_count: number;
  last_error: string | null;
  next_pull_at: string | null;
};

export type IntentSignal = {
  id: string;
  source: string;
  provider: string;
  company_name: string;
  company_domain: string;
  company_country: string;
  company_size: string;
  company_industry: string;
  signal_type: string;
  topic: string;
  activity: number | null;
  seen_on: string;
  status: "new" | "queued" | "dismissed" | "skipped";
  reason: string | null;
  campaign_id: string | null;
};

export function integrationReads(supabase: Supabase, workspaceId: string) {
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  return {
    async slack(): Promise<SlackConnection | null> {
      const { data, error } = await supabase
        .from("slack_connections")
        .select(
          "status, status_reason, channel_label, events, digest_hour, last_posted_at, last_error, last_error_at, connected_at",
        )
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      fail("slack", error);
      return (data as SlackConnection | null) ?? null;
    },
    async endpoints(): Promise<Endpoint[]> {
      const { data, error } = await supabase
        .from("webhook_endpoints")
        .select(
          "id, url, description, events, status, status_reason, secret_prefix, consecutive_failures, last_success_at, last_failure_at, last_error, created_at",
        )
        .eq("workspace_id", workspaceId)
        .order("created_at");
      fail("endpoints", error);
      return (data ?? []) as Endpoint[];
    },
    async deliveries(
      target: "slack" | "webhook",
      limit = 20,
    ): Promise<Delivery[]> {
      const { data, error } = await supabase
        .from("integration_deliveries")
        .select(
          "id, target, endpoint_id, event, status, attempts, response_status, last_error, created_at, delivered_at, next_attempt_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("target", target)
        .order("created_at", { ascending: false })
        .limit(limit);
      fail("deliveries", error);
      return (data ?? []) as Delivery[];
    },
    async tracking(): Promise<Tracking> {
      const { data, error } = await supabase
        .from("site_tracking")
        .select("enabled, consent_mode, pricing_paths, tag_email_links")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      fail("tracking", error);
      return (data as Tracking | null) ?? DEFAULT_TRACKING;
    },
    async companies(): Promise<SiteCompany[]> {
      const { data, error } = await supabase
        .from("site_companies")
        .select(
          "id, domain, name, country, source, visitors, page_views, pricing_views, first_seen_at, last_seen_at, status, campaign_id",
        )
        .eq("workspace_id", workspaceId)
        .order("last_seen_at", { ascending: false })
        .limit(200);
      fail("companies", error);
      return (data ?? []) as SiteCompany[];
    },
    async knownVisitors(): Promise<KnownVisitor[]> {
      const { data, error } = await supabase
        .from("site_visitors")
        .select(
          "id, identified_by, page_views, pricing_views, last_seen_at, lead:leads(id, name, email, company, status), company:site_companies(domain, name)",
        )
        .eq("workspace_id", workspaceId)
        .not("lead_id", "is", null)
        .order("last_seen_at", { ascending: false })
        .limit(100);
      fail("known visitors", error);
      return (data ?? []) as unknown as KnownVisitor[];
    },
    async recentViews(limit = 40): Promise<PageView[]> {
      const { data, error } = await supabase
        .from("site_page_views")
        .select(
          "id, path, title, referrer_host, is_pricing, viewed_at, visitor:site_visitors(lead:leads(id, name, email), company:site_companies(domain, name))",
        )
        .eq("workspace_id", workspaceId)
        .order("viewed_at", { ascending: false })
        .limit(limit);
      fail("page views", error);
      return (data ?? []) as unknown as PageView[];
    },
    async viewsInLastDays(days: number): Promise<number> {
      const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
      const { count, error } = await supabase
        .from("site_page_views")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("viewed_at", sinceIso);
      fail("views", error);
      return count ?? 0;
    },
    async intentSources(): Promise<IntentSource[]> {
      const { data, error } = await supabase
        .from("intent_sources")
        .select(
          "id, kind, status, status_reason, token_prefix, last_import_at, last_import_count, last_error, next_pull_at",
        )
        .eq("workspace_id", workspaceId);
      fail("intent sources", error);
      return (data ?? []) as IntentSource[];
    },
    async intentSignals(): Promise<IntentSignal[]> {
      const { data, error } = await supabase
        .from("intent_signals")
        .select(
          "id, source, provider, company_name, company_domain, company_country, company_size, company_industry, signal_type, topic, activity, seen_on, status, reason, campaign_id",
        )
        .eq("workspace_id", workspaceId)
        .order("seen_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      fail("intent signals", error);
      return (data ?? []) as IntentSignal[];
    },
  };
}
