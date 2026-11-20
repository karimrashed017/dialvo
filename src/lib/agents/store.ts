import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { ChatAgentStore, ChatContext, CommitStatus } from "./types";

/**
 * The agent's two database calls, made with the secret key. Both functions
 * take the widget's public token and only ever touch the workspace behind
 * it. Null when the server has no secret key.
 */
export function createChatAgentStore(): ChatAgentStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  return {
    async context(token, conversationId) {
      const { data, error } = await supabase.rpc("chat_agent_context", {
        p_token: token,
        p_conversation_id: conversationId,
      });
      if (error) throw new Error(`chat_agent_context: ${error.message}`);
      return (data as ChatContext | null) ?? null;
    },
    async commit(token, conversationId, inReplyTo, result) {
      const { data, error } = await supabase.rpc("chat_agent_commit", {
        p_token: token,
        p_conversation_id: conversationId,
        p_in_reply_to: inReplyTo,
        p_result: result,
      });
      if (error) throw new Error(`chat_agent_commit: ${error.message}`);
      return (
        (data as { status: CommitStatus; handoff?: boolean } | null) ?? null
      );
    },
  };
}
