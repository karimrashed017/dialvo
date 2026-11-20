import "server-only";
import { mailRuntimeStatus } from "@/lib/mail/config";
import { pollStep, sendStep, writeStep } from "@/lib/mail/steps";
import { createMailStore } from "@/lib/mail/store";

// The scheduler's door. Once a minute the database calls this three times
// (pg_cron + pg_net, see the scheduler migration), once per job:
//
//   POST /api/mail/step?job=send    give waiting emails a slot, send what is due
//   POST /api/mail/step?job=poll    read connected mailboxes for replies
//   POST /api/mail/step?job=write   read replies, draft answers and follow-ups
//
// There is no session here and no person: the call carries a random token
// that was made in the database and is kept in Supabase Vault. It is checked
// by asking the database (mail_cron_token_ok), which only the secret key may
// do, so no environment variable holds it. A call without the right token
// learns nothing, not even whether this server is configured.
//
// Each job is one short pass and is safe to call twice, at once, or after a
// call that died: see src/lib/mail/steps.ts.

export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const JOBS = { send: sendStep, poll: pollStep, write: writeStep } as const;

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const store = mailRuntimeStatus().on ? createMailStore() : null;
  let allowed = false;
  if (store && token.length >= 32 && token.length <= 200)
    try {
      allowed = await store.cronTokenOk(token);
    } catch (error) {
      console.error("[mail] token check failed:", (error as Error).message);
    }
  if (!allowed) return json({ ok: false }, 401);

  const job = new URL(request.url).searchParams.get("job") ?? "";
  if (!Object.hasOwn(JOBS, job)) return json({ ok: false, error: "job" }, 400);
  try {
    const result = await JOBS[job as keyof typeof JOBS]();
    return json({ ok: true, job, ...result });
  } catch (error) {
    console.error(`[mail] ${job} failed:`, (error as Error).message);
    return json({ ok: false, job }, 500);
  }
}
