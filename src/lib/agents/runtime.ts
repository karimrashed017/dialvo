import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  agentRuntimeStatus,
  DAILY_REPLY_CAP,
  MODEL_TIMEOUT_MS,
} from "./config";
import { asksToStop } from "./guard";
import { generateReply, type ReplyFailure } from "./reply";
import { createChatAgentStore } from "./store";
import type { ChatAgentStore, CommitStatus } from "./types";

// One turn of the inbound chat agent: read the conversation, decide whether
// the agent may speak at all, ask the model for a reply, store it (sent, or
// as a draft when the agent is on "ask me first").
//
// Whenever it does not answer, for any reason, nothing is lost: the
// visitor's message is already saved and the conversation is waiting for
// the team in the Inbox.

export type TurnStatus =
  | CommitStatus
  /** A key is missing on this server. */
  | "not_configured"
  | "no_conversation"
  /** The workspace's daily cap on agent replies is used up. */
  | "capped"
  | "failed";

export type TurnResult = {
  status: TurnStatus;
  reason?: ReplyFailure | "error";
};

export type AgentDeps = {
  store: ChatAgentStore | null;
  client: Pick<Anthropic, "messages"> | null;
};

/** The real database and model, or nulls when their keys aren't set. */
export function defaultDeps(): AgentDeps {
  if (!agentRuntimeStatus().on) return { store: null, client: null };
  return {
    store: createChatAgentStore(),
    // Reads ANTHROPIC_API_KEY from the environment. A short timeout and one
    // retry: a visitor is waiting, and a person can always take over.
    client: new Anthropic({ timeout: MODEL_TIMEOUT_MS, maxRetries: 1 }),
  };
}

export async function runChatAgent(
  input: { token: string; conversationId: string },
  deps: AgentDeps = defaultDeps(),
): Promise<TurnResult> {
  const { store, client } = deps;
  if (!store || !client) return { status: "not_configured" };
  const { token, conversationId } = input;
  try {
    const context = await store.context(token, conversationId);
    if (!context) return { status: "no_conversation" };
    if (!context.agent) return { status: "off" };
    if (context.paused) return { status: "paused" };
    if (context.replies_today >= DAILY_REPLY_CAP) {
      console.warn("[agent] daily reply cap reached for a workspace");
      return { status: "capped" };
    }
    const latest = context.messages.at(-1);
    if (
      !latest ||
      latest.author !== "lead" ||
      latest.id !== context.latest_visitor_message_id
    )
      return { status: "stale" };

    const generated = await generateReply(client, context);
    if (!generated.ok) return { status: "failed", reason: generated.reason };

    const result = { ...generated.result, model: generated.model };
    // An opt-out is honoured even if the model missed it.
    if (asksToStop(latest.body)) result.stop_contact = true;
    const stored = await store.commit(token, conversationId, latest.id, result);
    return { status: stored?.status ?? "no_conversation" };
  } catch (error) {
    console.error("[agent] turn failed:", (error as Error).message);
    return { status: "failed", reason: "error" };
  }
}
