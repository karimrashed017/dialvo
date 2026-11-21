import "server-only";
import { sendEmail } from "@/lib/alerts/email";
import { SITE_URL } from "@/lib/site";
import { phoneTurn, type ModelClient } from "./agent";
import {
  INBOUND_DAILY_CAP,
  MAX_SILENCES,
  MAX_TURNS,
  WEBHOOK_PATHS,
} from "./config";
import { inboundOpening, outboundOpening, unavailableLine } from "./prompt";
import type { PhoneStore } from "./store";
import type { Twilio } from "./twilio";
import { twiml, type Verb } from "./twiml";
import type { CallContext } from "./types";

// What happens on a call, one webhook at a time. Twilio does the speech
// recognition (<Gather input="speech">) and the voice (<Say>); every turn
// is a signed POST here, answered with TwiML. The call's whole state is in
// the database (call_context), so any server can take the next turn.
//
// Why this and not a streaming connection: the app runs on serverless
// functions, which can't hold the WebSocket that Twilio's Media Streams or
// ConversationRelay need. <Gather> works with plain HTTP requests, at the
// cost of a pause of a second or two while each answer is written.

export type VoiceDeps = {
  store: PhoneStore;
  twilio: Twilio | null;
  /** Null when the model isn't available: calls go to the team. */
  model: ModelClient | null;
  base: string;
  now?: () => number;
  sendAlert?: (to: string[], subject: string, text: string) => Promise<void>;
};

type Params = Record<string, string>;

const hangup = () => twiml([{ hangup: true }]);

function url(base: string, path: string, query: Record<string, string>) {
  return `${base}${path}?${new URLSearchParams(query)}`;
}

function gather(
  deps: VoiceDeps,
  c: CallContext,
  text: string,
  silences = 0,
): Verb {
  return {
    gather: {
      action: url(deps.base, WEBHOOK_PATHS.turn, {
        call: c.call.id,
        ...(silences ? { s: String(silences) } : {}),
      }),
      language: c.phone.language,
      say: { text, voice: c.phone.voice },
    },
  };
}

const say = (c: CallContext, text: string): Verb => ({
  say: text,
  voice: c.phone.voice,
  language: c.phone.language,
});

/** Our number on this call: the caller ID for a transfer. */
const ourNumber = (c: CallContext) =>
  (c.call.direction === "inbound" ? c.call.to_number : c.call.from_number) ??
  "";

function transfer(deps: VoiceDeps, c: CallContext): Verb | null {
  if (!c.phone.transfer_number || !ourNumber(c)) return null;
  return {
    dial: {
      number: c.phone.transfer_number,
      callerId: ourNumber(c),
      action: url(deps.base, WEBHOOK_PATHS.transfer, { call: c.call.id }),
    },
  };
}

async function alertTeam(
  deps: VoiceDeps,
  c: CallContext,
  to: string[],
  summary: string,
) {
  if (!to.length) return;
  const who =
    c.lead.name || c.call.from_number || c.call.to_number || "a caller";
  const subject = `A call needs a person: ${who} (${c.workspace.name})`.slice(
    0,
    200,
  );
  const text = [
    `A call with ${who} needs someone from the team.`,
    summary,
    `Open the conversation: ${SITE_URL}/app/inbox?c=${encodeURIComponent(c.call.conversation_id)}`,
    `You get these because email alerts are on for you in ${c.workspace.name} on Dialvo. Turn them off in Settings: ${SITE_URL}/app/settings#alerts`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const send =
    deps.sendAlert ??
    (async (recipients: string[], s: string, t: string) => {
      await sendEmail({
        to: recipients,
        subject: s,
        text: t,
        html: t
          .split("\n\n")
          .map(
            (line) =>
              `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`,
          )
          .join(""),
        idempotencyKey: `call-handoff-${c.call.id}`,
      });
    });
  try {
    await send(to, subject, text);
  } catch (error) {
    console.error("[phone] alert failed:", (error as Error).name);
  }
}

/** Someone called one of the workspace's numbers. */
export async function handleIncoming(
  deps: VoiceDeps,
  p: Params,
): Promise<string> {
  const begun = await deps.store.inboundBegin(
    p.To ?? "",
    p.From ?? "",
    p.CallSid ?? "",
    INBOUND_DAILY_CAP,
  );
  if (!begun)
    return twiml([
      {
        say: "This number is not in service.",
        voice: "Polly.Joanna-Neural",
        language: "en-US",
      },
      { hangup: true },
    ]);
  const c = await deps.store.context(begun.call_id);
  if (!c) return hangup();
  const forward = transfer(deps, c);
  if (!c.phone.agent_on || !deps.model || begun.over_cap) {
    // No agent on this call: straight to a person, or a promise to call back.
    // Nothing is transcribed, so there is nothing to disclose.
    if (forward) {
      await deps.store.commitTurn(c.call.id, "", "", {
        outcome: "needs_human",
        handoff: false,
      });
      return twiml([say(c, unavailableLine(c.workspace.name, true)), forward]);
    }
    const saved = await deps.store.commitTurn(c.call.id, "", "", {
      outcome: "needs_human",
      handoff: true,
      summary: "Missed call: nobody could answer.",
    });
    await alertTeam(
      deps,
      c,
      saved.alert_to,
      "Nobody could answer this call. Call them back.",
    );
    return twiml([
      say(c, unavailableLine(c.workspace.name, false)),
      { hangup: true },
    ]);
  }
  if (c.phone.recording_on && deps.twilio && !begun.repeat && p.CallSid) {
    try {
      await deps.twilio.startRecording(
        p.CallSid,
        `${deps.base}${WEBHOOK_PATHS.status}`,
      );
    } catch (error) {
      console.error(
        "[phone] recording didn't start:",
        (error as Error).message,
      );
    }
  }
  const opening = inboundOpening(c);
  await deps.store.answered(c.call.id, p.CallSid ?? "", false);
  await deps.store.commitTurn(c.call.id, "", opening, { outcome: "none" });
  return twiml([gather(deps, c, opening)]);
}

/** One of our outbound calls was answered. */
export async function handleAnswer(
  deps: VoiceDeps,
  callId: string,
  p: Params,
): Promise<string> {
  const c = await deps.store.context(callId);
  if (!c || c.call.direction !== "outbound") return hangup();
  if (c.call.provider_sid && c.call.provider_sid !== p.CallSid) return hangup();
  const answeredBy = p.AnsweredBy ?? "";
  const machine = /^(machine|fax)/.test(answeredBy);
  await deps.store.answered(c.call.id, p.CallSid ?? "", machine);
  // An answering machine is not left a message.
  if (machine) return hangup();
  if (!deps.model) {
    await deps.store.commitTurn(c.call.id, "", "", { outcome: "needs_human" });
    return hangup();
  }
  const opening = outboundOpening(c);
  await deps.store.commitTurn(c.call.id, "", opening, { outcome: "none" });
  return twiml([gather(deps, c, opening)]);
}

/** What the caller said (or didn't), and the agent's answer. */
export async function handleTurn(
  deps: VoiceDeps,
  callId: string,
  silences: number,
  p: Params,
): Promise<string> {
  const c = await deps.store.context(callId);
  if (!c || !c.call.provider_sid || c.call.provider_sid !== p.CallSid)
    return hangup();
  const heard = (p.SpeechResult ?? "").trim();
  const now = deps.now?.() ?? Date.now();
  const elapsed = c.call.started_at
    ? (now - Date.parse(c.call.started_at)) / 1000
    : 0;

  if (!heard) {
    if (silences >= MAX_SILENCES) {
      const bye =
        "I can't hear anything, so I'll let you go. The team can call you back. Goodbye.";
      await deps.store.commitTurn(c.call.id, "", bye, { outcome: "none" });
      return twiml([say(c, bye), { hangup: true }]);
    }
    return twiml([
      gather(
        deps,
        c,
        "Sorry, I didn't catch that. Are you still there?",
        silences + 1,
      ),
    ]);
  }

  if (c.call.turns >= MAX_TURNS || elapsed > c.phone.max_call_minutes * 60) {
    const wrap =
      "I need to wrap up now. The team has everything you've told me and will follow up. Thanks, goodbye.";
    await deps.store.commitTurn(c.call.id, heard, wrap, { outcome: "none" });
    return twiml([say(c, wrap), { hangup: true }]);
  }

  const forward = transfer(deps, c);
  const answer = deps.model ? await phoneTurn(deps.model, c, heard) : null;
  if (!answer?.ok) {
    const line = forward
      ? "Sorry, I'm having trouble on my end. Let me put you through to the team."
      : "Sorry, I'm having trouble on my end. Someone from the team will call you back. Goodbye.";
    const saved = await deps.store.commitTurn(c.call.id, heard, line, {
      outcome: "needs_human",
      handoff: true,
      summary: "The agent couldn't answer on this call.",
    });
    await alertTeam(
      deps,
      c,
      saved.alert_to,
      "The agent couldn't answer on this call.",
    );
    return twiml(
      forward ? [say(c, line), forward] : [say(c, line), { hangup: true }],
    );
  }
  const r = answer.result;
  const saved = await deps.store.commitTurn(c.call.id, heard, r.say, r);
  if (saved.alert_to.length)
    await alertTeam(deps, c, saved.alert_to, r.summary);

  if (r.send_booking_link && c.booking_url && deps.twilio) {
    const body = `${c.workspace.name}: here's the link to book a time: ${c.booking_url}`;
    try {
      const prepared = await deps.store.smsBookingLink(c.call.id, body);
      if (
        prepared.status === "ok" &&
        prepared.sms_id &&
        prepared.to &&
        prepared.from
      ) {
        try {
          const sent = await deps.twilio.sendSms({
            to: prepared.to,
            from: prepared.from,
            messagingServiceSid: prepared.messaging_service_sid ?? null,
            body,
            statusUrl: `${deps.base}${WEBHOOK_PATHS.smsStatus}`,
          });
          await deps.store.smsSent(
            prepared.sms_id,
            c.call.workspace_id,
            sent.sid,
            null,
          );
        } catch (error) {
          const code = (error as { code?: number | null }).code ?? null;
          await deps.store.smsSent(
            prepared.sms_id,
            c.call.workspace_id,
            null,
            code,
          );
        }
      }
    } catch (error) {
      console.error(
        "[phone] booking link text failed:",
        (error as Error).message,
      );
    }
  }

  if (r.handoff && forward) return twiml([say(c, r.say), forward]);
  if (r.end_call || r.handoff) return twiml([say(c, r.say), { hangup: true }]);
  return twiml([gather(deps, c, r.say)]);
}

/** The live transfer finished: picked up, or not. */
export async function handleTransfer(
  deps: VoiceDeps,
  callId: string,
  p: Params,
): Promise<string> {
  const c = await deps.store.context(callId);
  if (!c || c.call.provider_sid !== p.CallSid) return hangup();
  const connected =
    p.DialCallStatus === "completed" || p.DialCallStatus === "answered";
  await deps.store.transferResult(c.call.id, connected);
  if (connected) return hangup();
  return twiml([
    say(
      c,
      "Nobody could pick up just now. The team has your number and will call you back. Goodbye.",
    ),
    { hangup: true },
  ]);
}

/** Twilio's word that a call ended, or that its recording is ready. */
export async function handleStatus(deps: VoiceDeps, p: Params): Promise<void> {
  if (!/^CA[0-9a-f]{32}$/.test(p.CallSid ?? "")) return;
  const recording = /^RE[0-9a-f]{32}$/.test(p.RecordingSid ?? "")
    ? p.RecordingSid
    : null;
  const duration = Number(p.CallDuration ?? p.Duration);
  await deps.store.status(
    p.CallSid,
    p.CallStatus || null,
    Number.isFinite(duration) ? Math.round(duration) : null,
    recording,
    p.ErrorMessage ? p.ErrorMessage.slice(0, 200) : null,
  );
}
