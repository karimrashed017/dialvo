import "server-only";
import {
  CHAT_TOKEN,
  chatJson,
  chatOptions,
  chatSeenLimit,
  clientIp,
  pageOrigin,
} from "@/lib/chat/http";
import { createCaptureClient } from "@/lib/supabase/capture";
import { APP_CONFIGURED } from "@/lib/supabase/env";

// The install check. The widget calls this once when it loads on a page, so
// the team can see "Seen on example.com, 2 minutes ago" instead of wondering
// whether the code they pasted works.
//
// What is kept is the origin of the page (https://example.com) and the
// time, on the widget's own row. No cookie is set or read, and nothing
// about the visitor is stored: not their address, not the page they were
// on. The origin is the browser's own Origin header, not something the page
// can pass in. Loads from Dialvo's own pages (the preview in Settings) are
// not counted: they say nothing about the customer's site.

export const OPTIONS = chatOptions;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!APP_CONFIGURED)
    return chatJson({ ok: false, reason: "not_configured" }, 503);
  if (!CHAT_TOKEN.test(token))
    return chatJson({ ok: false, reason: "unknown_widget" }, 404);
  const origin = pageOrigin(request);
  // Always the same answer: this endpoint tells a caller nothing.
  if (!origin) return chatJson({ ok: true });
  if (
    chatSeenLimit.take(clientIp(request)) > 0 ||
    chatSeenLimit.take(token) > 0
  )
    return chatJson({ ok: false, reason: "limited" }, 429, {
      "Retry-After": "60",
    });
  const { error } = await createCaptureClient().rpc("chat_widget_seen", {
    p_token: token,
    p_origin: origin,
  });
  if (error) console.error("[chat] could not record a sighting:", error.code);
  return chatJson({ ok: true });
}
