import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { phoneRuntime, webhookBase } from "./config";
import { validTwilioSignature } from "./signature";
import { createPhoneStore } from "./store";
import { createTwilio, twilioCredentials } from "./twilio";
import { twiml, twimlResponse } from "./twiml";
import type { VoiceDeps } from "./voice";

// The door every Twilio webhook comes through: the request must carry
// Twilio's signature for the exact public address it was sent to, made
// with Dialvo's auth token. Anything else is refused before a byte of it
// is used. Twilio's parameters are returned as plain strings.

export type Verified =
  | {
      ok: true;
      params: Record<string, string>;
      query: URLSearchParams;
      deps: VoiceDeps;
    }
  | { ok: false; response: Response };

export async function verifyTwilio(request: Request): Promise<Verified> {
  const runtime = phoneRuntime();
  const credentials = twilioCredentials();
  const store = runtime.on ? createPhoneStore() : null;
  if (!credentials || !store)
    return {
      ok: false,
      response: twimlResponse(twiml([{ hangup: true }]), 503),
    };
  let params: Record<string, string> = {};
  try {
    const form = await request.formData();
    params = Object.fromEntries(
      [...form.entries()].filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
  } catch {
    return { ok: false, response: new Response(null, { status: 400 }) };
  }
  const incoming = new URL(request.url);
  const base = webhookBase();
  const url = `${base}${incoming.pathname}${incoming.search}`;
  if (
    !validTwilioSignature(
      credentials.authToken,
      url,
      params,
      request.headers.get("x-twilio-signature"),
    ) ||
    params.AccountSid !== credentials.accountSid
  )
    return { ok: false, response: new Response(null, { status: 403 }) };
  return {
    ok: true,
    params,
    query: incoming.searchParams,
    deps: {
      store,
      twilio: createTwilio(credentials),
      model: runtime.agent ? new Anthropic() : null,
      base,
    },
  };
}

/** When a handler fails: an apology the caller hears, not silence. */
export const callFailed = () =>
  twimlResponse(
    twiml([
      {
        say: "Sorry, something went wrong on our side. Please call back in a few minutes.",
        voice: "Polly.Joanna-Neural",
        language: "en-US",
      },
      { hangup: true },
    ]),
  );

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
