import "server-only";
import { SMS_CLAIM_LIMIT, WEBHOOK_PATHS } from "@/lib/phone/config";
import type { PhoneStore } from "@/lib/phone/store";
import { TwilioError, type Twilio } from "@/lib/phone/twilio";

// One step of the channel scheduler, run when the database says there is
// work (POST /api/channels/step): send the texts that are due. Every rule
// was checked by the database when it handed each one out
// (channel_sms_claim); this only talks to Twilio and records what it said.
// A text is claimed once, so a step that dies part-way never repeats one.
// Dialvo never places outbound calls.

export type StepDeps = { store: PhoneStore; twilio: Twilio; base: string };

export async function channelStep(deps: StepDeps) {
  const { store, twilio, base } = deps;
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
  return { texts, textFailures };
}
