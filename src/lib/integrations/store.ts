import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  DELIVERY_LEASE_SECONDS,
  DELIVERY_MAX_ATTEMPTS,
  ENDPOINT_DISABLE_AFTER,
} from "./config";

// The integrations' database calls with the secret key. Each is a function
// in the database that touches one workspace (the one passed in, or the one
// a claimed delivery belongs to); the caps from config.ts are passed here.

export type ClaimedDelivery = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  target: "slack" | "webhook";
  event: string;
  payload: Record<string, unknown>;
  attempt: number;
  created_at: string;
  url: string | null;
  secret: string | null;
};

export type DeliveryOutcome = "delivered" | "retry" | "failed" | "revoked";

export interface IntegrationStore {
  cronTokenOk(token: string): Promise<boolean>;
  claim(limit: number, workspaceId?: string | null): Promise<ClaimedDelivery[]>;
  finish(
    id: string,
    outcome: DeliveryOutcome,
    status: number | null,
    error: string | null,
    retryAfterSeconds: number,
  ): Promise<string | null>;
  slackConnect(
    workspaceId: string,
    userId: string,
    url: string,
    label: string,
  ): Promise<string>;
  slackUrl(workspaceId: string): Promise<string | null>;
  webhookCreate(input: {
    workspaceId: string;
    userId: string | null;
    url: string;
    events: string[];
    description: string;
    secret: string;
    max: number;
  }): Promise<{ status: string; id?: string }>;
  webhookRoll(
    workspaceId: string,
    userId: string | null,
    endpointId: string,
    secret: string,
  ): Promise<boolean>;
  webhookCredentials(
    workspaceId: string,
    endpointId: string,
  ): Promise<{ url: string; secret: string } | null>;
  webhookUpdate(
    workspaceId: string,
    userId: string | null,
    endpointId: string,
    events: string[] | null,
    active: boolean | null,
  ): Promise<boolean>;
  webhookDelete(
    workspaceId: string,
    userId: string | null,
    endpointId: string,
  ): Promise<boolean>;
}

export function createIntegrationStore(): IntegrationStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  async function rpc<T>(name: string, args: Record<string, unknown>) {
    const { data, error } = await supabase!.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  }
  return {
    cronTokenOk: (token) =>
      rpc<boolean>("crm_cron_token_ok", { p_token: token }),
    claim: async (limit, workspaceId = null) =>
      (await rpc<ClaimedDelivery[] | null>("integration_claim", {
        p_limit: limit,
        p_lease_seconds: DELIVERY_LEASE_SECONDS,
        p_workspace_id: workspaceId,
      })) ?? [],
    finish: (id, outcome, status, error, retryAfterSeconds) =>
      rpc<string | null>("integration_finish", {
        p_delivery_id: id,
        p_outcome: outcome,
        p_status: status,
        p_error: error,
        p_retry_after: retryAfterSeconds,
        p_max_attempts: DELIVERY_MAX_ATTEMPTS,
        p_disable_after: ENDPOINT_DISABLE_AFTER,
      }),
    slackConnect: async (workspaceId, userId, url, label) =>
      (
        await rpc<{ status: string }>("slack_connect", {
          p_workspace_id: workspaceId,
          p_user_id: userId,
          p_url: url,
          p_label: label,
        })
      ).status,
    slackUrl: (workspaceId) =>
      rpc<string | null>("slack_credentials", { p_workspace_id: workspaceId }),
    webhookCreate: (i) =>
      rpc<{ status: string; id?: string }>("webhook_endpoint_create", {
        p_workspace_id: i.workspaceId,
        p_user_id: i.userId,
        p_url: i.url,
        p_events: i.events,
        p_description: i.description,
        p_secret: i.secret,
        p_max: i.max,
      }),
    webhookRoll: (workspaceId, userId, endpointId, secret) =>
      rpc<boolean>("webhook_endpoint_roll", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_endpoint_id: endpointId,
        p_secret: secret,
      }),
    webhookCredentials: (workspaceId, endpointId) =>
      rpc<{ url: string; secret: string } | null>(
        "webhook_endpoint_credentials",
        { p_workspace_id: workspaceId, p_endpoint_id: endpointId },
      ),
    webhookUpdate: (workspaceId, userId, endpointId, events, active) =>
      rpc<boolean>("webhook_endpoint_update", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_endpoint_id: endpointId,
        p_events: events,
        p_active: active,
      }),
    webhookDelete: (workspaceId, userId, endpointId) =>
      rpc<boolean>("webhook_endpoint_delete", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_endpoint_id: endpointId,
      }),
  };
}
