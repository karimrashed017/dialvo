import { handleTransfer } from "@/lib/phone/voice";
import { twimlResponse } from "@/lib/phone/twiml";
import { callFailed, UUID, verifyTwilio } from "@/lib/phone/webhook";

// The end of a live transfer to the team (<Dial action>). Signed by Twilio.

export async function POST(request: Request) {
  const v = await verifyTwilio(request);
  if (!v.ok) return v.response;
  const call = v.query.get("call") ?? "";
  if (!UUID.test(call)) return callFailed();
  try {
    return twimlResponse(await handleTransfer(v.deps, call, v.params));
  } catch (error) {
    console.error("[phone] transfer result failed:", (error as Error).message);
    return callFailed();
  }
}
