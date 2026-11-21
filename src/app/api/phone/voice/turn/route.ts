import { handleTurn } from "@/lib/phone/voice";
import { twimlResponse } from "@/lib/phone/twiml";
import { callFailed, UUID, verifyTwilio } from "@/lib/phone/webhook";

// One turn of a call: Twilio sends what the caller said (<Gather> speech),
// the agent answers. Signed by Twilio.

export const maxDuration = 30;

export async function POST(request: Request) {
  const v = await verifyTwilio(request);
  if (!v.ok) return v.response;
  const call = v.query.get("call") ?? "";
  if (!UUID.test(call)) return callFailed();
  const silences = Math.min(5, Math.max(0, Number(v.query.get("s") ?? 0) || 0));
  try {
    return twimlResponse(await handleTurn(v.deps, call, silences, v.params));
  } catch (error) {
    console.error("[phone] turn failed:", (error as Error).message);
    return callFailed();
  }
}
