import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  INTENT_ROWS_PER_CALL,
  INTENT_ROWS_PER_DAY,
} from "@/lib/integrations/config";
import type { IntentRow } from "./rows";

// Review-site intent's database calls with the secret key.

export type IngestResult =
  | {
      status: "ok";
      added: number;
      duplicates: number;
      skipped: number;
      invalid: number;
    }
  | { status: "capped" | "too_many" | "not_found" };

export interface IntentStore {
  ingest(
    workspaceId: string,
    source: "csv" | "webhook" | "g2",
    sourceId: string | null,
    rows: IntentRow[],
  ): Promise<IngestResult>;
  webhookSource(
    tokenHash: string,
  ): Promise<{ workspace_id: string; source_id: string } | null>;
  webhookSet(
    workspaceId: string,
    userId: string,
    hash: string,
    prefix: string,
  ): Promise<boolean>;
  g2Connect(
    workspaceId: string,
    userId: string,
    token: string,
  ): Promise<string>;
  pullClaim(): Promise<{
    source_id: string;
    workspace_id: string;
    token: string;
    since: string;
  } | null>;
  pullFinish(
    sourceId: string,
    workspaceId: string,
    outcome: "ok" | "retry" | "revoked",
    error: string | null,
  ): Promise<void>;
  keep(
    workspaceId: string,
    userId: string,
    ids: string[],
    name: string,
    titles: string[],
    max: number,
  ): Promise<{ status: string; campaign_id?: string }>;
}

export function createIntentStore(): IntentStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  async function rpc<T>(name: string, args: Record<string, unknown>) {
    const { data, error } = await supabase!.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  }
  return {
    ingest: (workspaceId, source, sourceId, rows) =>
      rpc<IngestResult>("intent_ingest", {
        p_workspace_id: workspaceId,
        p_source: source,
        p_source_id: sourceId,
        p_rows: rows,
        p_max_per_call: INTENT_ROWS_PER_CALL,
        p_max_per_day: INTENT_ROWS_PER_DAY,
      }),
    webhookSource: (hash) =>
      rpc("intent_webhook_source", { p_token_hash: hash }),
    webhookSet: (workspaceId, userId, hash, prefix) =>
      rpc<boolean>("intent_webhook_set", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_token_hash: hash,
        p_prefix: prefix,
      }),
    g2Connect: async (workspaceId, userId, token) =>
      (
        await rpc<{ status: string }>("intent_g2_connect", {
          p_workspace_id: workspaceId,
          p_user_id: userId,
          p_token: token,
        })
      ).status,
    pullClaim: () => rpc("intent_pull_claim", { p_lease_seconds: 120 }),
    pullFinish: async (sourceId, workspaceId, outcome, error) => {
      await rpc("intent_pull_finish", {
        p_source_id: sourceId,
        p_workspace_id: workspaceId,
        p_outcome: outcome,
        p_error: error,
      });
    },
    keep: (workspaceId, userId, ids, name, titles, max) =>
      rpc("intent_signals_keep", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_signal_ids: ids,
        p_name: name,
        p_titles: titles,
        p_max: max,
      }),
  };
}
