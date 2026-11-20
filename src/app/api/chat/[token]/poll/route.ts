import "server-only";
import {
  CHAT_TOKEN,
  chatJson,
  chatOptions,
  chatPollLimit,
  clientIp,
  readChatBody,
} from "@/lib/chat/http";
import { isUuid } from "@/lib/leads/fields";
import { createCaptureClient } from "@/lib/supabase/capture";
import { APP_CONFIGURED } from "@/lib/supabase/env";

// The widget asks here, every few seconds while it is open, for the chat so
// far: the visitor's own messages and the replies that were actually sent
// (never drafts), plus who has the conversation. It is a POST so the
// visitor's key travels in the body, not in an address that gets logged.

export const OPTIONS = chatOptions;

const KEY = /^[0-9a-f]{64}$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!APP_CONFIGURED)
    return chatJson({ ok: false, reason: "not_configured" }, 503);
  const body = await readChatBody(request);
  if (
    !CHAT_TOKEN.test(token) ||
    typeof body === "string" ||
    !isUuid(body.conversation) ||
    typeof body.key !== "string" ||
    !KEY.test(body.key)
  )
    return chatJson({ ok: false, reason: "unknown_chat" }, 404);
  const wait = chatPollLimit.take(clientIp(request));
  if (wait > 0)
    return chatJson({ ok: false, reason: "limited" }, 429, {
      "Retry-After": String(wait),
    });
  const { data, error } = await createCaptureClient().rpc("chat_poll", {
    p_token: token,
    p_conversation_id: body.conversation,
    p_visitor_key: body.key,
  });
  if (error) {
    console.error("[chat] could not read a chat:", error.code, error.message);
    return chatJson({ ok: false, reason: "unavailable" }, 502);
  }
  if (!data) return chatJson({ ok: false, reason: "unknown_chat" }, 404);
  const { state, messages } = data as { state: string; messages: unknown[] };
  return chatJson({ ok: true, state, messages });
}
