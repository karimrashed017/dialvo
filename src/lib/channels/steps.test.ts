import { describe, expect, it } from "vitest";
import { fakeStore, fakeTwilio } from "@/lib/phone/testing/fakes";
import { channelStep } from "./steps";

describe("the channel scheduler's step", () => {
  it("never places a call: it only sends texts", async () => {
    const { store, log } = fakeStore(null);
    const t = fakeTwilio();
    const r = await channelStep({
      store,
      twilio: t.twilio,
      base: "https://app.example",
    });
    expect(r).toEqual({ texts: 0, textFailures: 0 });
    expect(log.map((l) => l.fn)).toEqual(["claimSms"]);
    expect("createCall" in t.twilio).toBe(false);
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
