import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type {
  ChatAgentStore,
  ChatContext,
  CommitStatus,
  TestChatStore,
} from "./types";

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

/**
 * "Try your agent": the same two steps for a teammate's test chat. The
 * caller has already checked the session and the workspace; the functions
 * check membership again. Null when the server has no secret key.
 */
export function createTestChatStore(): TestChatStore | null {
  const supabase = createServiceClient();
  if (!supabase) return null;
  return {
    async begin({ workspaceId, userId, sessionId, body }) {
      const { data, error } = await supabase.rpc("agent_test_begin", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_session_id: sessionId,
        p_body: body,
      });
      if (error?.code === "DV429") return "limited";
      if (error) throw new Error(`agent_test_begin: ${error.message}`);
      return (data as ChatContext | null) ?? null;
    },
    async commit({ workspaceId, userId, sessionId, inReplyTo, result }) {
      const { data, error } = await supabase.rpc("agent_test_commit", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_session_id: sessionId,
        p_in_reply_to: inReplyTo,
        p_result: result,
      });
      if (error) throw new Error(`agent_test_commit: ${error.message}`);
      return (data as { status: "sent" | "silent" | "stale" } | null) ?? null;
    },
  };
}
