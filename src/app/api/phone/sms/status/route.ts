import { verifyTwilio } from "@/lib/phone/webhook";

// What the carrier said about a text we sent. Signed by Twilio.

export async function POST(request: Request) {
  const v = await verifyTwilio(request);
  if (!v.ok) return v.response;
  const p = v.params;
  if (!/^(SM|MM)[0-9a-f]{32}$/.test(p.MessageSid ?? ""))
    return new Response(null, { status: 400 });
  const code = Number(p.ErrorCode);
  try {
    await v.deps.store.smsStatus(
      p.MessageSid,
      p.MessageStatus ?? "",
      Number.isFinite(code) && p.ErrorCode ? code : null,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[phone] text status failed:", (error as Error).message);
    return new Response(null, { status: 500 });
  }
}
