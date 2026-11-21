import { describe, expect, it } from "vitest";
import { buyNumber, releaseNumber } from "./numbers";
import { fakeStore, fakeTwilio } from "./testing/fakes";
import { TwilioError } from "./twilio";

const order = {
  workspaceId: "ws",
  workspaceName: "Northwind",
  userId: "owner",
  e164: "+14155550123",
  country: "US",
  quotedMonthly: 1.15,
};

describe("buying a number", () => {
  it("buys at the quoted price and points its webhooks at the app", async () => {
    const { store, calls } = fakeStore(null);
    const t = fakeTwilio();
    const r = await buyNumber(
      { store, twilio: t.twilio, base: "https://app.example" },
      order,
    );
    expect(r).toEqual({
      ok: true,
      message: expect.stringContaining("$1.15 a month"),
    });
    expect(t.calls("buyNumber")[0].args[1]).toEqual({
      voiceUrl: "https://app.example/api/phone/voice",
      statusUrl: "https://app.example/api/phone/voice/status",
      smsUrl: "https://app.example/api/phone/sms",
    });
    expect(calls("numberBought")[0].args).toEqual([
      "ws",
      "num-1",
      "PN" + "2".repeat(32),
    ]);
  });

  it("buys nothing when the price went up, is over the cap, or the country isn't allowed", async () => {
    for (const [price, quoted, country] of [
      [1.5, 1.15, "US"],
      [6, 6, "US"],
      [1.15, 1.15, "GB"],
    ] as const) {
      const { store } = fakeStore(null);
      const t = fakeTwilio({
        localNumberPrice: async () => ({ monthly: price, currency: "USD" }),
      });
      const r = await buyNumber(
        { store, twilio: t.twilio, base: "" },
        { ...order, quotedMonthly: quoted, country },
      );
      expect(r.ok).toBe(false);
      expect(t.calls("buyNumber")).toEqual([]);
    }
  });

  it("gives the hold back when Twilio refuses", async () => {
    const { store, calls } = fakeStore(null);
    const t = fakeTwilio({
      buyNumber: async () => {
        throw new TwilioError("Number unavailable", 400, 21422);
      },
    });
    const r = await buyNumber({ store, twilio: t.twilio, base: "" }, order);
    expect(r.message).toContain("Twilio error 21422");
    expect(calls("numberBought")[0].args).toEqual(["ws", "num-1", null]);
  });

  it("is for owners only, checked again by the database", async () => {
    const { store } = fakeStore(null);
    store.reserveNumber = async () => ({ status: "not_owner" });
    const t = fakeTwilio();
    expect(
      (await buyNumber({ store, twilio: t.twilio, base: "" }, order)).message,
    ).toContain("owner");
    expect(t.calls("buyNumber")).toEqual([]);
  });
});

describe("releasing a number", () => {
  it("releases at Twilio first, and also when Twilio already let it go", async () => {
    const { store } = fakeStore(null);
    const t = fakeTwilio({
      releaseNumber: async () => {
        throw new TwilioError("not found", 404, 20404);
      },
    });
    const r = await releaseNumber(
      { store, twilio: t.twilio },
      { workspaceId: "ws", userId: "owner", numberId: "n", sid: "PNx" },
    );
    expect(r.ok).toBe(true);
  });
});
