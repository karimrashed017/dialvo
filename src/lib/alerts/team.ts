import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ALERT_KINDS,
  alertEmailStatus,
  buildAlertEmail,
  sendEmail,
  type AlertKind,
  type SendDeps,
} from "./email";

// Emails the team when a website chat is qualified, needs a person, or has
// a draft waiting. The database queues an alert for each of those events
// (the trigger on activity_events); this claims the ones waiting for one
// conversation, sends one email per event to the members who have alerts
// on, and records what happened. The hourly cap per workspace is enforced
// in claim_team_alerts. Leads and visitors are never emailed from here.

export type ClaimedAlerts = {
  workspace: string;
  conversation_id: string;
  lead: string;
  recipients: string[];
  alerts: { id: string; kind: string; summary: string }[];
};

/** The database, as alerts need it. Faked in the unit tests. */
export interface AlertStore {
  claim(token: string, conversationId: string): Promise<ClaimedAlerts | null>;
  finish(alertId: string, sent: boolean, recipients: number): Promise<void>;
}

export function createAlertStore(): AlertStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  return {
    async claim(token, conversationId) {
      const { data, error } = await supabase.rpc("claim_team_alerts", {
        p_token: token,
        p_conversation_id: conversationId,
      });
      if (error) throw new Error(`claim_team_alerts: ${error.message}`);
      return (data as ClaimedAlerts | null) ?? null;
    },
    async finish(alertId, sent, recipients) {
      const { error } = await supabase.rpc("finish_team_alert", {
        p_alert_id: alertId,
        p_sent: sent,
        p_recipients: recipients,
      });
      if (error) throw new Error(`finish_team_alert: ${error.message}`);
    },
  };
}

export type AlertDeps = {
  store: AlertStore | null;
  send: Partial<SendDeps>;
};

export function defaultAlertDeps(): AlertDeps {
  if (!alertEmailStatus().on) return { store: null, send: {} };
  return { store: createAlertStore(), send: {} };
}

export type AlertsResult = {
  status: "not_configured" | "none" | "sent" | "failed";
  /** How many emails went out. */
  sent: number;
};

const isKind = (kind: string): kind is AlertKind =>
  (ALERT_KINDS as readonly string[]).includes(kind);

/** Never throws: an alert that can't be sent must not disturb the chat. */
export async function sendTeamAlerts(
  input: { token: string; conversationId: string },
  deps: AlertDeps = defaultAlertDeps(),
): Promise<AlertsResult> {
  const { store } = deps;
  if (!store) return { status: "not_configured", sent: 0 };
  try {
    const claimed = await store.claim(input.token, input.conversationId);
    if (!claimed || claimed.alerts.length === 0)
      return { status: "none", sent: 0 };
    let sent = 0;
    for (const alert of claimed.alerts) {
      const ok =
        isKind(alert.kind) &&
        (await sendEmail(
          {
            ...buildAlertEmail({
              kind: alert.kind,
              workspace: claimed.workspace,
              lead: claimed.lead,
              summary: alert.summary,
              conversationId: claimed.conversation_id,
            }),
            to: claimed.recipients,
            idempotencyKey: `team-alert-${alert.id}`,
          },
          deps.send,
        ));
      if (ok) sent++;
      await store.finish(alert.id, ok, ok ? claimed.recipients.length : 0);
    }
    return { status: sent > 0 ? "sent" : "failed", sent };
  } catch (error) {
    console.error("[alerts] failed:", (error as Error).message);
    return { status: "failed", sent: 0 };
  }
}
