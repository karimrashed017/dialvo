import { handleAnswer, handleIncoming } from "@/lib/phone/voice";
import { twimlResponse } from "@/lib/phone/twiml";
import { callFailed, UUID, verifyTwilio } from "@/lib/phone/webhook";

// Twilio calls this when someone rings one of a workspace's numbers (the
// number's Voice URL), and with ?call=<id> when one of our outbound calls
// is answered. Signed by Twilio; see src/lib/phone/webhook.ts.

export const maxDuration = 30;

export async function POST(request: Request) {
  const v = await verifyTwilio(request);
  if (!v.ok) return v.response;
  try {
    const call = v.query.get("call");
    if (call) {
      if (!UUID.test(call)) return callFailed();
      return twimlResponse(await handleAnswer(v.deps, call, v.params));
    }
    return twimlResponse(await handleIncoming(v.deps, v.params));
  } catch (error) {
    console.error("[phone] voice webhook failed:", (error as Error).message);
    return callFailed();
  }
}
