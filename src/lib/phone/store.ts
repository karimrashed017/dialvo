import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { CallContext, TurnResult } from "./types";

// The phone's database calls, made with the secret key. Each is a function
// in the database that scopes itself (20261121004616_phone_and_sms and
// 20261121004956_sequence_channel_steps). Faked in the unit tests.

export type PreparedSms = {
  status: "ok" | "later" | "skipped" | "off";
  reason?: string;
  sms_id?: string;
  from?: string;
  to?: string;
  messaging_service_sid?: string | null;
};

export type ClaimedSms = PreparedSms & {
  run_id: string;
  workspace_id: string;
  body: string;
};

export interface PhoneStore {
  inboundBegin(
    to: string,
    from: string,
    sid: string,
    dailyCap: number,
  ): Promise<{ call_id: string; over_cap: boolean; repeat: boolean } | null>;
  context(callId: string): Promise<CallContext | null>;
  answered(callId: string, sid: string, machine: boolean): Promise<boolean>;
  commitTurn(
    callId: string,
    heard: string,
    said: string,
    result: Partial<TurnResult>,
  ): Promise<{ status: string; alert_to: string[] }>;
  transferResult(callId: string, connected: boolean): Promise<void>;
  status(
    sid: string,
    status: string | null,
    duration: number | null,
    recordingSid: string | null,
    error: string | null,
  ): Promise<void>;
  smsInbound(
    to: string,
    from: string,
    body: string,
    sid: string,
  ): Promise<{ kind: string } | null>;
  smsBookingLink(callId: string, body: string): Promise<PreparedSms>;
  smsSent(
    smsId: string,
    workspaceId: string,
    sid: string | null,
    code: number | null,
  ): Promise<void>;
  smsStatus(sid: string, status: string, code: number | null): Promise<void>;
  claimSms(limit: number): Promise<ClaimedSms[]>;
  smsFinished(runId: string, workspaceId: string, sent: boolean): Promise<void>;
  tick(linkedinDaily: number): Promise<unknown>;
  cronTokenOk(token: string): Promise<boolean>;
  reserveNumber(o: {
    workspaceId: string;
    userId: string;
    e164: string;
    country: string;
    priceMicros: number;
    currency: string;
    maxNumbers: number;
  }): Promise<{ status: string; id?: string }>;
  numberBought(
    workspaceId: string,
    numberId: string,
    sid: string | null,
  ): Promise<void>;
  numberReleased(
    workspaceId: string,
    userId: string,
    numberId: string,
  ): Promise<boolean>;
}

/** Null when the server has no secret key. */
export function createPhoneStore(): PhoneStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const rpc = async <T>(name: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.code ?? ""} ${error.message}`);
    return data as T;
  };
  return {
    inboundBegin: (to, from, sid, dailyCap) =>
      rpc("call_inbound_begin", {
        p_to: to,
        p_from: from,
        p_sid: sid,
        p_daily_cap: dailyCap,
      }),
    context: (callId) => rpc("call_context", { p_call_id: callId }),
    answered: (callId, sid, machine) =>
      rpc("call_answered", {
        p_call_id: callId,
        p_sid: sid,
        p_machine: machine,
      }),
    commitTurn: (callId, heard, said, result) =>
      rpc("call_turn_commit", {
        p_call_id: callId,
        p_heard: heard,
        p_said: said,
        p_result: result,
      }),
    transferResult: (callId, connected) =>
      rpc("call_transfer_result", {
        p_call_id: callId,
        p_connected: connected,
      }),
    status: (sid, status, duration, recordingSid, error) =>
      rpc("call_status", {
        p_sid: sid,
        p_status: status,
        p_duration: duration,
        p_recording_sid: recordingSid,
        p_error: error,
      }),
    smsInbound: (to, from, body, sid) =>
      rpc("sms_inbound", { p_to: to, p_from: from, p_body: body, p_sid: sid }),
    smsBookingLink: (callId, body) =>
      rpc("sms_booking_link", { p_call_id: callId, p_body: body }),
    smsSent: (smsId, workspaceId, sid, code) =>
      rpc("sms_sent", {
        p_sms_id: smsId,
        p_workspace_id: workspaceId,
        p_sid: sid,
        p_error_code: code,
      }),
    smsStatus: (sid, status, code) =>
      rpc("sms_status", { p_sid: sid, p_status: status, p_error_code: code }),
    claimSms: async (limit) =>
      (await rpc<ClaimedSms[] | null>("channel_sms_claim", {
        p_limit: limit,
      })) ?? [],
    smsFinished: (runId, workspaceId, sent) =>
      rpc("channel_sms_finished", {
        p_run_id: runId,
        p_workspace_id: workspaceId,
        p_sent: sent,
      }),
    tick: (linkedinDaily) =>
      rpc("channel_tick", { p_linkedin_daily: linkedinDaily }),
    cronTokenOk: async (token) =>
      Boolean(await rpc<boolean>("crm_cron_token_ok", { p_token: token })),
    reserveNumber: (o) =>
      rpc("phone_number_reserve", {
        p_workspace_id: o.workspaceId,
        p_user_id: o.userId,
        p_e164: o.e164,
        p_country: o.country,
        p_type: "local",
        p_price_micros: o.priceMicros,
        p_currency: o.currency,
        p_max_numbers: o.maxNumbers,
      }),
    numberBought: (workspaceId, numberId, sid) =>
      rpc("phone_number_bought", {
        p_workspace_id: workspaceId,
        p_number_id: numberId,
        p_sid: sid,
      }),
    numberReleased: (workspaceId, userId, numberId) =>
      rpc("phone_number_released", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_number_id: numberId,
      }),
  };
}
