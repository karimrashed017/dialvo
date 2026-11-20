import "server-only";
import { createPlaysFindymail } from "@/lib/plays/findymail";
import { pullSignals } from "@/lib/plays/signals";
import { createPlayStore } from "@/lib/plays/store";
import { createServiceClient } from "@/lib/supabase/service";

// The scheduler's door for buying signals. Every 15 minutes, only when a
// monitor is due (not pulled for 23 hours), the database calls this (pg_cron
// + pg_net, see 20261121000300_signals.sql). No session and no person: the
// call carries the scheduler's random token from Supabase Vault, checked by
// asking the database (mail_cron_token_ok), which only the secret key may do.
// A call without the right token learns nothing. Each call claims a few due
// monitors under a lease, so a call that dies, repeats or overlaps is safe.

export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const supabase = createServiceClient();
  let allowed = false;
  if (supabase && token.length >= 32 && token.length <= 200) {
    const { data, error } = await supabase.rpc("mail_cron_token_ok", {
      p_token: token,
    });
    if (error) console.error("[signals] token check failed:", error.code);
    allowed = data === true;
  }
  if (!allowed) return json({ ok: false }, 401);
  const store = createPlayStore();
  const findymail = createPlaysFindymail();
  if (!store || !findymail) return json({ ok: true, status: "not_configured" });
  try {
    return json({ ok: true, ...(await pullSignals({ store, findymail })) });
  } catch (error) {
    console.error("[signals] step failed:", (error as Error).message);
    return json({ ok: false }, 500);
  }
}
