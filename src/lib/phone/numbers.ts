import "server-only";
import {
  BUYABLE_COUNTRIES,
  MAX_MONTHLY_PRICE_USD,
  MAX_NUMBERS_PER_WORKSPACE,
  WEBHOOK_PATHS,
  type BuyableCountry,
} from "./config";
import type { PhoneStore } from "./store";
import { TwilioError, type Twilio } from "./twilio";

// Buying and releasing a workspace's numbers. Only an owner may (the
// action checks, and the database checks again); the monthly price is read
// from Twilio and shown before anything is bought, and the purchase is
// refused if Twilio's price has gone up since, is over the cap, or the
// workspace already holds its maximum of numbers.

export type Outcome = { ok: boolean; message: string };

export const isBuyableCountry = (c: unknown): c is BuyableCountry =>
  typeof c === "string" && (BUYABLE_COUNTRIES as readonly string[]).includes(c);

export const formatPrice = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount,
  );

export async function buyNumber(
  deps: { store: PhoneStore; twilio: Twilio; base: string },
  o: {
    workspaceId: string;
    workspaceName: string;
    userId: string;
    e164: string;
    country: string;
    quotedMonthly: number;
  },
): Promise<Outcome> {
  if (!isBuyableCountry(o.country))
    return {
      ok: false,
      message: "Numbers can be bought here in the US and Canada only.",
    };
  if (!/^\+1[2-9]\d{9}$/.test(o.e164))
    return { ok: false, message: "That isn't a number Dialvo can buy." };
  let price;
  try {
    price = await deps.twilio.localNumberPrice(o.country);
  } catch (error) {
    return {
      ok: false,
      message: twilioMessage(error, "Twilio's price couldn't be read"),
    };
  }
  if (!price || price.currency !== "USD")
    return {
      ok: false,
      message: "Twilio's price couldn't be read. Nothing was bought.",
    };
  if (price.monthly > MAX_MONTHLY_PRICE_USD)
    return {
      ok: false,
      message: `That number costs ${formatPrice(price.monthly, price.currency)} a month, over the ${formatPrice(MAX_MONTHLY_PRICE_USD, "USD")} limit. Nothing was bought.`,
    };
  if (price.monthly > o.quotedMonthly + 1e-9)
    return {
      ok: false,
      message: `Twilio's price changed to ${formatPrice(price.monthly, price.currency)} a month since you looked. Nothing was bought; search again to see the new price.`,
    };
  const hold = await deps.store.reserveNumber({
    workspaceId: o.workspaceId,
    userId: o.userId,
    e164: o.e164,
    country: o.country,
    priceMicros: Math.round(price.monthly * 1_000_000),
    currency: price.currency,
    maxNumbers: MAX_NUMBERS_PER_WORKSPACE,
  });
  if (hold.status === "not_owner")
    return {
      ok: false,
      message: "Only the workspace's owner can buy numbers.",
    };
  if (hold.status === "cap")
    return {
      ok: false,
      message: `A workspace can hold ${MAX_NUMBERS_PER_WORKSPACE} numbers. Release one first.`,
    };
  if (hold.status !== "ok" || !hold.id)
    return {
      ok: false,
      message: "That number is already taken. Pick another.",
    };
  try {
    const bought = await deps.twilio.buyNumber(
      o.e164,
      {
        voiceUrl: `${deps.base}${WEBHOOK_PATHS.voice}`,
        statusUrl: `${deps.base}${WEBHOOK_PATHS.status}`,
        smsUrl: `${deps.base}${WEBHOOK_PATHS.sms}`,
      },
      `Dialvo: ${o.workspaceName}`,
    );
    await deps.store.numberBought(o.workspaceId, hold.id, bought.sid);
  } catch (error) {
    await deps.store.numberBought(o.workspaceId, hold.id, null);
    return {
      ok: false,
      message: twilioMessage(error, "Twilio didn't sell the number"),
    };
  }
  return {
    ok: true,
    message: `Bought ${o.e164} for ${formatPrice(price.monthly, price.currency)} a month. Calls to it now reach your agent.`,
  };
}

export async function releaseNumber(
  deps: { store: PhoneStore; twilio: Twilio },
  o: {
    workspaceId: string;
    userId: string;
    numberId: string;
    sid: string | null;
  },
): Promise<Outcome> {
  if (o.sid) {
    try {
      await deps.twilio.releaseNumber(o.sid);
    } catch (error) {
      // Already gone at Twilio: release it here too.
      if (!(error instanceof TwilioError && error.status === 404))
        return {
          ok: false,
          message: twilioMessage(error, "Twilio didn't release the number"),
        };
    }
  }
  const done = await deps.store.numberReleased(
    o.workspaceId,
    o.userId,
    o.numberId,
  );
  return done
    ? {
        ok: true,
        message:
          "Released. The number no longer costs anything and can't be called.",
      }
    : { ok: false, message: "Only the workspace's owner can release numbers." };
}

function twilioMessage(error: unknown, what: string) {
  if (error instanceof TwilioError)
    return `${what}: ${error.message}${error.code ? ` (Twilio error ${error.code})` : ""}`;
  return `${what}. Please try again.`;
}
