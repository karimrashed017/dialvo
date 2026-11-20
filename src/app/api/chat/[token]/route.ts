import "server-only";
import {
  CHAT_TOKEN,
  chatJson,
  chatOptions,
  chatPollLimit,
  clientIp,
} from "@/lib/chat/http";
import { createCaptureClient } from "@/lib/supabase/capture";
import { APP_CONFIGURED } from "@/lib/supabase/env";

// What the chat widget shows before anyone has typed: its title and first
// line. Public, for any origin; says nothing else about the workspace.

export const OPTIONS = chatOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!APP_CONFIGURED)
    return chatJson({ ok: false, reason: "not_configured" }, 503);
  if (!CHAT_TOKEN.test(token))
    return chatJson({ ok: false, reason: "unknown_widget" }, 404);
  const wait = chatPollLimit.take(clientIp(request));
  if (wait > 0)
    return chatJson({ ok: false, reason: "limited" }, 429, {
      "Retry-After": String(wait),
    });
  const { data, error } = await createCaptureClient().rpc("chat_widget_info", {
    p_token: token,
  });
  if (error) {
    console.error("[chat] could not read a widget:", error.code, error.message);
    return chatJson({ ok: false, reason: "unavailable" }, 502);
  }
  if (!data) return chatJson({ ok: false, reason: "unknown_widget" }, 404);
  const { title, welcome } = data as { title: string; welcome: string };
  return chatJson({ ok: true, title, welcome });
}
