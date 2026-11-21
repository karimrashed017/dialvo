import { twiml, twimlResponse } from "@/lib/phone/twiml";
import { verifyTwilio } from "@/lib/phone/webhook";

// A text to one of a workspace's numbers (the number's SMS URL). STOP,
// START and HELP are also answered by Twilio's own opt-out handling, which
// blocks further texts to someone who sent STOP; Dialvo records the same
// (sms_inbound) so its own checks agree. Nothing is sent back from here.
// Signed by Twilio.

export async function POST(request: Request) {
  const v = await verifyTwilio(request);
  if (!v.ok) return v.response;
  const p = v.params;
  if (!/^(SM|MM)[0-9a-f]{32}$/.test(p.MessageSid ?? ""))
    return new Response(null, { status: 400 });
  try {
    await v.deps.store.smsInbound(
      p.To ?? "",
      p.From ?? "",
      p.Body ?? "",
      p.MessageSid,
    );
    return twimlResponse(twiml([]));
  } catch (error) {
    console.error("[phone] incoming text failed:", (error as Error).message);
    return new Response(null, { status: 500 });
  }
}
