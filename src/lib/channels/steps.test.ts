import { describe, expect, it } from "vitest";
import { fakeStore, fakeTwilio } from "@/lib/phone/testing/fakes";
import { TwilioError } from "@/lib/phone/twilio";
import { channelStep } from "./steps";

describe("the channel scheduler's step", () => {
  it("places the calls the database handed out and records each sid or error", async () => {
    const { store, calls } = fakeStore(null);
    store.claimCalls = async () => [
      {
        call_id: "c1",
        workspace_id: "w",
        from: "+15005550001",
        to: "+15005550006",
        max_minutes: 10,
        recording_on: true,
      },
      {
        call_id: "c2",
        workspace_id: "w",
        from: "+15005550001",
        to: "+15005550007",
        max_minutes: 10,
        recording_on: false,
      },
    ];
    let n = 0;
    const t = fakeTwilio({
      createCall: async () => {
        n += 1;
        if (n === 2) throw new TwilioError("Invalid To", 400, 21211);
        return { sid: "CA" + "3".repeat(32) };
      },
    });
    const r = await channelStep({
      store,
      twilio: t.twilio,
      base: "https://app.example",
    });
    expect(r).toMatchObject({ calls: 1, callFailures: 1 });
    expect(calls("placed").map((p) => p.args)).toEqual([
      ["c1", "w", "CA" + "3".repeat(32), null],
      ["c2", "w", null, "Invalid To (21211)"],
    ]);
  });

  it("sends the texts that are due and closes each step", async () => {
    const { store, calls } = fakeStore(null);
    store.claimSms = async () => [
      {
        status: "ok",
        run_id: "r1",
        workspace_id: "w",
        body: "Hi",
        sms_id: "s1",
        to: "+15005550006",
        from: "+15005550001",
        messaging_service_sid: null,
      },
    ];
    const t = fakeTwilio();
    const r = await channelStep({
      store,
      twilio: t.twilio,
      base: "https://app.example",
    });
    expect(r.texts).toBe(1);
    expect(
      (t.calls("sendSms")[0].args[0] as { statusUrl: string }).statusUrl,
    ).toBe("https://app.example/api/phone/sms/status");
    expect(calls("smsFinished")[0].args).toEqual(["r1", "w", true]);
  });
});
