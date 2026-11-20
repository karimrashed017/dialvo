import "server-only";
import { after } from "next/server";
import { agentRuntimeStatus } from "@/lib/agents/config";
import { redactCardNumbers } from "@/lib/agents/guard";
import { runChatAgent } from "@/lib/agents/runtime";
import {
  CHAT_TOKEN,
  chatJson,
  chatOptions,
  chatPostLimit,
  chatStartLimit,
  clientIp,
  MAX_CHAT_MESSAGE,
  readChatBody,
} from "@/lib/chat/http";
import { cleanLongText, isUuid } from "@/lib/leads/fields";
import { createCaptureClient } from "@/lib/supabase/capture";
import { APP_CONFIGURED } from "@/lib/supabase/env";

// A visitor's message from the chat widget. The first one starts the chat
// (chat_start: a lead, a conversation in the Inbox, and a key for this
// visitor's browser); later ones carry the conversation's id and that key
// (chat_post). Both database functions scope everything to the workspace
// behind the widget's token and have their own limits.
//
// The message is saved first, always. Then, if this server can run the agent
// (see agentRuntimeStatus), it writes a reply after the response has gone;
// the widget picks it up from the poll endpoint. If it can't, or the agent
// is off or fails, the message simply waits for the team in the Inbox.

export const OPTIONS = chatOptions;

const KEY = /^[0-9a-f]{64}$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const fail = (
    status: number,
    reason: string,
    message: string,
    headers: HeadersInit = {},
  ) => chatJson({ ok: false, reason, message }, status, headers);

  if (!APP_CONFIGURED)
    return fail(503, "not_configured", "This chat isn't switched on yet.");
  if (!CHAT_TOKEN.test(token))
    return fail(404, "unknown_widget", "This chat doesn't exist.");

  const body = await readChatBody(request);
  if (body === "too_large")
    return fail(413, "too_large", "That's too much to send in one go.");
  if (body === "unreadable")
    return fail(400, "invalid", "Send the message as JSON.");

  // Card numbers never reach the database or the model: payments only
  // happen through a link the team sends.
  const raw = typeof body.message === "string" ? body.message : "";
  if (raw.length > MAX_CHAT_MESSAGE * 2)
    return fail(400, "too_long", "That message is too long.");
  const message = redactCardNumbers(cleanLongText(raw, MAX_CHAT_MESSAGE + 1));
  if (!message) return fail(400, "invalid", "Write a message first.");
  if (message.length > MAX_CHAT_MESSAGE)
    return fail(400, "too_long", "That message is too long.");

  const continuing = body.conversation !== undefined || body.key !== undefined;
  if (
    continuing &&
    (!isUuid(body.conversation) ||
      typeof body.key !== "string" ||
      !KEY.test(body.key))
  )
    return fail(404, "unknown_chat", "This chat doesn't exist any more.");

  const wait = (continuing ? chatPostLimit : chatStartLimit).take(
    clientIp(request),
  );
  if (wait > 0)
    return fail(429, "limited", "You're sending messages very quickly.", {
      "Retry-After": String(wait),
    });

  const supabase = createCaptureClient();
  const { data, error } = continuing
    ? await supabase.rpc("chat_post", {
        p_token: token,
        p_conversation_id: body.conversation,
        p_visitor_key: body.key,
        p_body: message,
      })
    : await supabase.rpc("chat_start", { p_token: token, p_body: message });
  if (error) {
    if (error.code === "DV429")
      return fail(
        429,
        "limited",
        "This chat is very busy. Try again shortly.",
        {
          "Retry-After": "60",
        },
      );
    if (error.code === "DV413")
      return fail(
        413,
        "chat_full",
        "This chat has reached its limit. The team will follow up.",
      );
    if (error.code === "22023")
      return fail(400, "invalid", "That message couldn't be sent.");
    console.error(
      "[chat] could not save a message:",
      error.code,
      error.message,
    );
    return fail(502, "unavailable", "That didn't send. Please try again.");
  }
  if (!data)
    return continuing
      ? fail(404, "unknown_chat", "This chat doesn't exist any more.")
      : fail(404, "unknown_widget", "This chat doesn't exist.");

  const saved = data as {
    conversation_id?: string;
    visitor_key?: string;
    message_id: string;
  };
  const conversationId = continuing
    ? (body.conversation as string)
    : saved.conversation_id!;

  // "replying": this server will try to answer. "saved": nobody answers
  // automatically here; the widget tells the visitor the team will reply.
  const agent = agentRuntimeStatus().on;
  if (agent)
    after(async () => {
      const turn = await runChatAgent({ token, conversationId });
      if (turn.status === "failed")
        console.error("[chat] the agent didn't answer:", turn.reason);
    });

  return chatJson({
    ok: true,
    conversation: conversationId,
    ...(continuing ? {} : { key: saved.visitor_key }),
    message: { id: saved.message_id, body: message },
    agent: agent ? "replying" : "saved",
  });
}
