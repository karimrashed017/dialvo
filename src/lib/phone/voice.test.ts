import { describe, expect, it } from "vitest";
import {
  fakeModel,
  fakeStore,
  fakeTwilio,
  context,
  SID,
  turn,
} from "./testing/fakes";
import {
  handleAnswer,
  handleIncoming,
  handleStatus,
  handleTransfer,
  handleTurn,
  type VoiceDeps,
} from "./voice";

// A call, webhook by webhook, with the database, the model and Twilio faked.

const BASE = "https://app.example";
const deps = (o: Partial<VoiceDeps> & Pick<VoiceDeps, "store">): VoiceDeps => ({
  twilio: null,
  model: null,
  base: BASE,
  ...o,
});

describe("an incoming call", () => {
  it("starts with the transcription notice, then the greeting, and listens", async () => {
    const c = context();
    const { store, calls } = fakeStore(c);
    const xml = await handleIncoming(
      deps({ store, model: fakeModel(turn()).client }),
      {
        To: "+15005550001",
        From: "+15005550006",
        CallSid: SID,
      },
    );
    expect(xml).toMatch(
      /<Gather input="speech" action="https:\/\/app\.example\/api\/phone\/voice\/turn\?call=11111111-/,
    );
    expect(xml).toContain(
      "This call is transcribed for Northwind&apos;s team. Thanks for calling Northwind. I&apos;m the AI assistant for the team.",
    );
    expect(calls("commitTurn")[0].args[2]).toMatch(/^This call is transcribed/);
  });

  it("says it is recorded and starts the recording when recording is on", async () => {
    const c = context({ phone: { recording_on: true } });
    const { store } = fakeStore(c);
    const t = fakeTwilio();
    const xml = await handleIncoming(
      deps({ store, twilio: t.twilio, model: fakeModel(turn()).client }),
      { CallSid: SID },
    );
    expect(xml).toContain("This call is recorded and transcribed");
    expect(t.calls("startRecording")[0].args[0]).toBe(SID);
  });

  it("goes straight to the transfer number when the agent is off, saying nothing about transcripts", async () => {
    const c = context({
      phone: { agent_on: false, transfer_number: "+15005550009" },
    });
    const { store } = fakeStore(c);
    const xml = await handleIncoming(
      deps({ store, model: fakeModel(turn()).client }),
      { CallSid: SID },
    );
    expect(xml).toContain("<Number>+15005550009</Number>");
    expect(xml).not.toContain("transcribed");
  });

  it("promises a call back and alerts the team when nobody can answer", async () => {
    const c = context({ phone: { agent_on: false } });
    const { store } = fakeStore(c, { alertTo: ["team@northwind.example"] });
    const sent: string[][] = [];
    const xml = await handleIncoming(
      deps({ store, sendAlert: async (to) => void sent.push(to) }),
      { CallSid: SID },
    );
    expect(xml).toContain("will call you back");
    expect(xml).toContain("<Hangup/>");
    expect(sent).toEqual([["team@northwind.example"]]);
  });

  it("refuses a number that belongs to nobody", async () => {
    const { store } = fakeStore(null, { begin: null });
    expect(await handleIncoming(deps({ store }), { CallSid: SID })).toContain(
      "not in service",
    );
  });
});

describe("a turn", () => {
  it("answers from the model and keeps listening", async () => {
    const c = context();
    const { store, calls } = fakeStore(c);
    const model = fakeModel(
      turn({ outcome: "qualified", summary: "Wants pricing." }),
    );
    const xml = await handleTurn(
      deps({ store, model: model.client }),
      c.call.id,
      0,
      {
        CallSid: SID,
        SpeechResult: "How much is it?",
      },
    );
    expect(xml).toContain("Plans start at forty dollars a month.");
    expect(xml).toContain("<Gather");
    const [, heard, said, result] = calls("commitTurn")[0].args as [
      string,
      string,
      string,
      { outcome: string },
    ];
    expect([heard, said, result.outcome]).toEqual([
      "How much is it?",
      "Plans start at forty dollars a month.",
      "qualified",
    ]);
  });

  it("ignores a webhook for another call", async () => {
    const c = context();
    const { store, calls } = fakeStore(c);
    const xml = await handleTurn(
      deps({ store, model: fakeModel(turn()).client }),
      c.call.id,
      0,
      {
        CallSid: "CA" + "9".repeat(32),
        SpeechResult: "hi",
      },
    );
    expect(xml).toContain("<Hangup/>");
    expect(calls("commitTurn")).toEqual([]);
  });

  it("asks again after a silence, then says goodbye", async () => {
    const c = context();
    const { store } = fakeStore(c);
    const d = deps({ store, model: fakeModel(turn()).client });
    expect(await handleTurn(d, c.call.id, 0, { CallSid: SID })).toMatch(
      /s=1[\s\S]*didn&apos;t catch that/,
    );
    expect(await handleTurn(d, c.call.id, 2, { CallSid: SID })).toMatch(
      /Goodbye\.<\/Say><Hangup\/>/,
    );
  });

  it("transfers to a person when the caller wants one", async () => {
    const c = context({ phone: { transfer_number: "+15005550009" } });
    const { store } = fakeStore(c, { alertTo: ["a@northwind.example"] });
    const sent: string[] = [];
    const xml = await handleTurn(
      deps({
        store,
        model: fakeModel(
          turn({ handoff: true, say: "Putting you through now." }),
        ).client,
        sendAlert: async (_to, subject) => void sent.push(subject),
      }),
      c.call.id,
      0,
      { CallSid: SID, SpeechResult: "Can I talk to someone?" },
    );
    expect(xml).toContain(
      'Putting you through now.</Say><Dial callerId="+15005550001"',
    );
    expect(xml).toContain("/api/phone/voice/transfer?call=");
    expect(sent[0]).toMatch(/^A call needs a person/);
  });

  it("hands over with an apology when the model fails", async () => {
    const c = context();
    const { store, calls } = fakeStore(c);
    const xml = await handleTurn(
      deps({ store, model: fakeModel(new Error("down")).client }),
      c.call.id,
      0,
      {
        CallSid: SID,
        SpeechResult: "Hello?",
      },
    );
    expect(xml).toContain("having trouble");
    expect(xml).toContain("<Hangup/>");
    expect(
      (calls("commitTurn")[0].args[3] as { handoff: boolean }).handoff,
    ).toBe(true);
  });

  it("honours 'don't call me again' even when the model misses it, and ends the call", async () => {
    const c = context();
    const { store, calls } = fakeStore(c);
    const xml = await handleTurn(
      deps({ store, model: fakeModel(turn({ say: "Okay." })).client }),
      c.call.id,
      0,
      { CallSid: SID, SpeechResult: "Please don't call me again" },
    );
    expect(xml).toContain("<Hangup/>");
    expect(
      (calls("commitTurn")[0].args[3] as { stop_calls: boolean }).stop_calls,
    ).toBe(true);
  });

  it("texts the booking link only when asked, and records what Twilio said", async () => {
    const c = context({
      booking_url: "https://cal.example/northwind",
      phone: { sms_ready: true },
    });
    const { store, calls } = fakeStore(c);
    const t = fakeTwilio();
    await handleTurn(
      deps({
        store,
        twilio: t.twilio,
        model: fakeModel(turn({ send_booking_link: true, say: "Sent." }))
          .client,
      }),
      c.call.id,
      0,
      { CallSid: SID, SpeechResult: "Yes please text it" },
    );
    expect((t.calls("sendSms")[0].args[0] as { body: string }).body).toBe(
      "Northwind: here's the link to book a time: https://cal.example/northwind",
    );
    expect(calls("smsSent")[0].args.slice(0, 3)).toEqual([
      "sms-1",
      c.call.workspace_id,
      "SM" + "4".repeat(32),
    ]);
  });

  it("wraps up when the call reaches its time limit", async () => {
    const c = context({
      call: { started_at: new Date(Date.now() - 11 * 60_000).toISOString() },
    });
    const { store } = fakeStore(c);
    const model = fakeModel(turn());
    const xml = await handleTurn(
      deps({ store, model: model.client }),
      c.call.id,
      0,
      {
        CallSid: SID,
        SpeechResult: "And another thing",
      },
    );
    expect(xml).toContain("I need to wrap up now");
    expect(model.requests).toEqual([]);
  });
});

describe("an outbound call", () => {
  it("opens by saying who is calling, why, and that it is transcribed", async () => {
    const c = context({
      call: { direction: "outbound", provider_sid: null },
      lead: { name: "Pat Lee" },
    });
    const { store } = fakeStore(c);
    const xml = await handleAnswer(
      deps({ store, model: fakeModel(turn()).client }),
      c.call.id,
      { CallSid: SID, AnsweredBy: "human" },
    );
    expect(xml).toContain(
      "Hi, this is the AI assistant for Northwind, calling for Pat, because you asked to hear from us by phone. This call is transcribed",
    );
  });

  it("hangs up on an answering machine without leaving a message", async () => {
    const c = context({ call: { direction: "outbound" } });
    const { store, calls } = fakeStore(c);
    const xml = await handleAnswer(
      deps({ store, model: fakeModel(turn()).client }),
      c.call.id,
      { CallSid: SID, AnsweredBy: "machine_start" },
    );
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
    );
    expect(calls("answered")[0].args[2]).toBe(true);
  });
});

describe("the end of a transfer and of a call", () => {
  it("records whether anyone picked up", async () => {
    const c = context();
    const { store, calls } = fakeStore(c);
    expect(
      await handleTransfer(deps({ store }), c.call.id, {
        CallSid: SID,
        DialCallStatus: "no-answer",
      }),
    ).toContain("Nobody could pick up");
    expect(calls("transferResult")[0].args).toEqual([c.call.id, false]);
  });

  it("passes the status and the recording on, and ignores a malformed sid", async () => {
    const { store, calls } = fakeStore(context());
    await handleStatus(deps({ store }), {
      CallSid: SID,
      CallStatus: "completed",
      CallDuration: "61",
    });
    await handleStatus(deps({ store }), {
      CallSid: SID,
      RecordingSid: "RE" + "5".repeat(32),
    });
    await handleStatus(deps({ store }), {
      CallSid: "nope",
      CallStatus: "completed",
    });
    expect(calls("status").map((s) => s.args)).toEqual([
      [SID, "completed", 61, null, null],
      [SID, null, null, "RE" + "5".repeat(32), null],
    ]);
  });
});
