import "server-only";
import { BRIEFS_PER_DAY } from "@/lib/briefs/config";
import { DAILY_SPEND_CAP_MICROS } from "@/lib/prospects/config";
import { createServiceClient } from "@/lib/supabase/service";
import type { ClaimedCompany, NewsStore } from "./check";
import { NEWS_KEEP_MAX, NEWS_LEASE_SECONDS } from "./config";

// Company news' database calls with the secret key (the company_news
// migration). Every function names the workspace it touches.

export function createNewsStore():
  | (NewsStore & {
      keep(
        workspaceId: string,
        userId: string,
        ids: string[],
        name: string,
        titles: unknown,
      ): Promise<{
        status: string;
        leads?: number;
        campaign_id?: string | null;
      }>;
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
      (await rpc<ClaimedCompany[] | null>("news_claim", {
        p_limit: limit,
        p_lease_seconds: NEWS_LEASE_SECONDS,
        p_max_cost_micros: DAILY_SPEND_CAP_MICROS,
      })) ?? [],
    ingest: (workspaceId, companyId, items, cost) =>
      rpc("news_ingest", {
        p_workspace_id: workspaceId,
        p_company_id: companyId,
        p_items: items,
        p_cost_micros: Math.max(0, Math.round(cost)),
      }),
    fail: async (workspaceId, companyId, error, cost) => {
      await rpc("news_fail", {
        p_workspace_id: workspaceId,
        p_company_id: companyId,
        p_error: error,
        p_cost_micros: Math.max(0, Math.round(cost)),
      });
    },
    keep: (workspaceId, userId, ids, name, titles) =>
      rpc("news_keep", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_ids: ids,
        p_name: name,
        p_titles: titles,
        p_max: NEWS_KEEP_MAX,
        p_max_briefs: BRIEFS_PER_DAY,
      }),
  };
}
