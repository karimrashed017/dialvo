import "server-only";
import {
  CALL_CLAIM_LIMIT,
  REST_MIN_CALLS,
  REST_MIN_RATE,
  SMS_CLAIM_LIMIT,
  WEBHOOK_PATHS,
} from "@/lib/phone/config";
import type { PhoneStore } from "@/lib/phone/store";
import { TwilioError, type Twilio } from "@/lib/phone/twilio";

// One step of the channel scheduler, run when the database says there is
// work (POST /api/channels/step): place the approved calls that are due and
// send the texts that are due. Every rule was checked by the database when
// it handed each one out (call_claim, channel_sms_claim); this only talks
// to Twilio and records what it said. A call or text is claimed once, so a
// step that dies part-way never repeats one.

export type StepDeps = { store: PhoneStore; twilio: Twilio; base: string };

export async function channelStep(deps: StepDeps) {
  const { store, twilio, base } = deps;
  let calls = 0;
  let callFailures = 0;
  for (const call of await store.claimCalls(
    CALL_CLAIM_LIMIT,
    REST_MIN_CALLS,
    REST_MIN_RATE,
  )) {
    try {
      const placed = await twilio.createCall({
        to: call.to,
        from: call.from,
        url: `${base}${WEBHOOK_PATHS.voice}?call=${call.call_id}`,
        statusUrl: `${base}${WEBHOOK_PATHS.status}`,
        record: call.recording_on,
        timeLimitSeconds: Math.max(60, call.max_minutes * 60),
      });
      await store.placed(call.call_id, call.workspace_id, placed.sid, null);
      calls += 1;
    } catch (error) {
      const message =
        error instanceof TwilioError
          ? `${error.message}${error.code ? ` (${error.code})` : ""}`
          : "Twilio couldn't be reached";
      await store.placed(call.call_id, call.workspace_id, null, message);
      callFailures += 1;
    }
  }
  let texts = 0;
  let textFailures = 0;
  for (const sms of await store.claimSms(SMS_CLAIM_LIMIT)) {
    if (sms.status !== "ok" || !sms.sms_id || !sms.to || !sms.from) continue;
    try {
      const sent = await twilio.sendSms({
        to: sms.to,
        from: sms.from,
        messagingServiceSid: sms.messaging_service_sid ?? null,
        body: sms.body,
        statusUrl: `${base}${WEBHOOK_PATHS.smsStatus}`,
      });
      await store.smsSent(sms.sms_id, sms.workspace_id, sent.sid, null);
      await store.smsFinished(sms.run_id, sms.workspace_id, true);
      texts += 1;
    } catch (error) {
      const code = error instanceof TwilioError ? error.code : null;
      await store.smsSent(sms.sms_id, sms.workspace_id, null, code);
      await store.smsFinished(sms.run_id, sms.workspace_id, false);
      textFailures += 1;
    }
  }
  return { calls, callFailures, texts, textFailures };
}
