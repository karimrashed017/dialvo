import type { ModelClient } from "../agent";
import type { PhoneStore } from "../store";
import type { Twilio } from "../twilio";
import type { CallContext } from "../types";

// Pretend versions of the database, the model and Twilio for the unit
// tests. Nothing here talks to anything real, and no real number is used.

export const SID = "CA" + "1".repeat(32);

type Over = {
  call?: Partial<CallContext["call"]>;
  workspace?: Partial<CallContext["workspace"]>;
  phone?: Partial<CallContext["phone"]>;
  agent?: Partial<CallContext["agent"]>;
  lead?: Partial<CallContext["lead"]>;
  booking_url?: string | null;
};

export function context(over: Over = {}): CallContext {
  return {
    call: {
      id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      lead_id: "33333333-3333-4333-8333-333333333333",
      conversation_id: "44444444-4444-4444-8444-444444444444",
      direction: "inbound",
      status: "in_progress",
      provider_sid: SID,
      from_number: "+15005550006",
      to_number: "+15005550001",
      started_at: new Date().toISOString(),
      turns: 1,
      outcome: null,
      transcript: [{ t: 0, speaker: "agent", text: "Hello" }],
      purpose: "",
      ...over.call,
    },
    workspace: {
      name: "Northwind",
      website: "northwind.example",
      timezone: "UTC",
      ...over.workspace,
    },
    phone: {
      agent_on: true,
      greeting: "",
      voice: "Polly.Joanna-Neural",
      language: "en-US",
      transfer_number: null,
      recording_on: false,
      max_call_minutes: 10,
      sms_ready: false,
      ...over.phone,
    },
    agent: { instructions: "", qualifying_questions: "", ...over.agent },
    booking_url: over.booking_url ?? null,
    lead: {
      name: "",
      company: null,
      phone: "+15005550006",
      sms_opted_out: false,
      ...over.lead,
    },
    knowledge: [
      {
        title: "Pricing",
        content: "Plans start at 40 dollars.",
        source_url: null,
      },
    ],
  };
}

export function fakeStore(
  c: CallContext | null,
  o: {
    alertTo?: string[];
    begin?: Awaited<ReturnType<PhoneStore["inboundBegin"]>>;
  } = {},
) {
  const log: { fn: string; args: unknown[] }[] = [];
  const rec =
    <T>(fn: string, value: T) =>
    async (...args: unknown[]) => {
      log.push({ fn, args });
      return value;
    };
  const store: PhoneStore = {
    inboundBegin: rec(
      "inboundBegin",
      o.begin === undefined
        ? { call_id: c?.call.id ?? "", over_cap: false, repeat: false }
        : o.begin,
    ),
    context: rec("context", c),
    answered: rec("answered", true),
    commitTurn: rec("commitTurn", { status: "ok", alert_to: o.alertTo ?? [] }),
    transferResult: rec("transferResult", undefined),
    status: rec("status", undefined),
    smsInbound: rec("smsInbound", { kind: "message" }),
    smsBookingLink: rec("smsBookingLink", {
      status: "ok",
      sms_id: "sms-1",
      to: "+15005550006",
      from: "+15005550001",
      messaging_service_sid: null,
    }),
    smsSent: rec("smsSent", undefined),
    smsStatus: rec("smsStatus", undefined),
    claimSms: rec("claimSms", []),
    smsFinished: rec("smsFinished", undefined),
    tick: rec("tick", {}),
    cronTokenOk: rec("cronTokenOk", true),
    reserveNumber: rec("reserveNumber", { status: "ok", id: "num-1" }),
    numberBought: rec("numberBought", undefined),
    numberReleased: rec("numberReleased", true),
  };
  return { store, log, calls: (fn: string) => log.filter((l) => l.fn === fn) };
}

export function fakeModel(answer: Record<string, unknown> | Error) {
  const requests: unknown[] = [];
  const client = {
    messages: {
      create: async (body: unknown) => {
        requests.push(body);
        if (answer instanceof Error) throw answer;
        return {
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
          content: [{ type: "text", text: JSON.stringify(answer) }],
        };
      },
    },
  } as unknown as ModelClient;
  return { client, requests };
}

export const turn = (over: Record<string, unknown> = {}) => ({
  say: "Plans start at forty dollars a month.",
  outcome: "none",
  summary: "",
  handoff: false,
  stop_calls: false,
  stop_contact: false,
  end_call: false,
  send_booking_link: false,
  caller_name: "",
  caller_email: "",
  ...over,
});

export function fakeTwilio(over: Partial<Twilio> = {}) {
  const log: { fn: string; args: unknown[] }[] = [];
  const rec =
    <T>(fn: string, value: T) =>
    async (...args: unknown[]) => {
      log.push({ fn, args });
      return value;
    };
  const twilio: Twilio = {
    searchNumbers: rec("searchNumbers", []),
    localNumberPrice: rec("localNumberPrice", {
      monthly: 1.15,
      currency: "USD",
    }),
    buyNumber: rec("buyNumber", { sid: "PN" + "2".repeat(32) }),
    releaseNumber: rec("releaseNumber", undefined),
    startRecording: rec("startRecording", undefined),
    sendSms: rec("sendSms", { sid: "SM" + "4".repeat(32) }),
    recordingAudio: rec("recordingAudio", new Response("")),
    ...over,
  };
  return { twilio, log, calls: (fn: string) => log.filter((l) => l.fn === fn) };
}
