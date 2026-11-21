import { handleStatus } from "@/lib/phone/voice";
import { verifyTwilio } from "@/lib/phone/webhook";

// Twilio's status callbacks: a call ended, or its recording is ready.
// Signed by Twilio.

export async function POST(request: Request) {
  const v = await verifyTwilio(request);
  if (!v.ok) return v.response;
  try {
    await handleStatus(v.deps, v.params);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[phone] status failed:", (error as Error).message);
    // Twilio retries on a 5xx; the database ignores a repeat.
    return new Response(null, { status: 500 });
  }
}
