import "server-only";
import { channelStep } from "@/lib/channels/steps";
import { phoneRuntime, webhookBase } from "@/lib/phone/config";
import { createPhoneStore } from "@/lib/phone/store";
import { createTwilio, twilioCredentials } from "@/lib/phone/twilio";

// The scheduler's door for calls and texts. Once a minute, when there is
// work, the database calls this (pg_cron + pg_net, see
// 20261121004956_sequence_channel_steps) with the scheduler's random token
// from Supabase Vault, checked by asking the database. A call without the
// right token learns nothing, not even whether this server is configured.

export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const store = phoneRuntime().on ? createPhoneStore() : null;
  const credentials = twilioCredentials();
  let allowed = false;
  if (store && credentials && token.length >= 32 && token.length <= 200)
    try {
      allowed = await store.cronTokenOk(token);
    } catch (error) {
      console.error("[channels] token check failed:", (error as Error).message);
    }
  if (!store || !credentials || !allowed) return json({ ok: false }, 401);
  try {
    return json({
      ok: true,
      ...(await channelStep({
        store,
        twilio: createTwilio(credentials),
        base: webhookBase(),
      })),
    });
  } catch (error) {
    console.error("[channels] step failed:", (error as Error).message);
    return json({ ok: false }, 500);
  }
}
