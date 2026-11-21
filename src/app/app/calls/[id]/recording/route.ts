import { getCurrentUser } from "@/lib/auth/user";
import { isUuid } from "@/lib/leads/fields";
import { createTwilio, twilioCredentials } from "@/lib/phone/twilio";
import { createClient } from "@/lib/supabase/server";

// A call's recording, for a signed-in member of its workspace only. The
// audio stays at Twilio, which wants Dialvo's credentials for it; this
// reads the call as the person (row-level security decides) and passes the
// audio through. It is never cached.

export async function GET(
  _request: Request,
  { params }: RouteContext<"/app/calls/[id]/recording">,
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase
    .from("calls")
    .select("recording_sid")
    .eq("id", id)
    .maybeSingle();
  const sid = (data as { recording_sid: string | null } | null)?.recording_sid;
  const credentials = twilioCredentials();
  if (!sid || !credentials) return new Response(null, { status: 404 });
  const audio = await createTwilio(credentials).recordingAudio(sid);
  if (!audio.ok || !audio.body) return new Response(null, { status: 502 });
  return new Response(audio.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
    },
  });
}
