import { handleIncoming } from "@/lib/phone/voice";
import { twimlResponse } from "@/lib/phone/twiml";
import { callFailed, verifyTwilio } from "@/lib/phone/webhook";

// Twilio calls this when someone rings one of a workspace's numbers (the
// number's Voice URL). Signed by Twilio; see src/lib/phone/webhook.ts.
// Dialvo never makes outbound calls, so there is no answered-call branch.

export const maxDuration = 30;

export async function POST(request: Request) {
  const v = await verifyTwilio(request);
  if (!v.ok) return v.response;
  try {
    return twimlResponse(await handleIncoming(v.deps, v.params));
  } catch (error) {
    console.error("[phone] voice webhook failed:", (error as Error).message);
    return callFailed();
  }
}
