import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { trialState } from "@/lib/billing/trial";
import {
  agentRuntimeStatus,
  DAILY_REPLY_CAP,
  MODEL_TIMEOUT_MS,
} from "./config";
import { generateReply, type ReplyFailure } from "./reply";
import { createTestChatStore } from "./store";
import type { AgentResult, TestChatStore } from "./types";

// "Try your agent": one turn of a teammate talking to their own inbound
// agent inside the app. It is the real thing: the same prompt, the same
// knowledge, the same model call and the same checks on the answer as a
// visitor's chat (reply.ts). What differs is where it is stored: test chats
// are never leads or conversations, the agent doesn't have to be switched
// on, and the answer is shown at once whatever the approval mode. Replies
// here count against the workspace's daily cap like any other.

export type TestTurn =
  | { status: "replied"; result: AgentResult }
  /** The agent would hand over without saying anything. */
  | { status: "silent"; result: AgentResult }
  /** A key is missing on this server. */
  | { status: "not_configured" }
  /** Not a member, or the workspace has no inbound chat agent. */
  | { status: "unavailable" }
  /** Too many test messages (per person a minute, per workspace a day). */
  | { status: "limited" }
  /** The workspace's daily cap on agent replies is used up. */
  | { status: "capped" }
  /** The trial is over and billing is enforced. */
  | { status: "trial_ended" }
  /** The teammate typed again before this answer was ready. */
  | { status: "stale" }
  | { status: "failed"; reason: ReplyFailure | "error" };

export type TestDeps = {
  store: TestChatStore | null;
  client: Pick<Anthropic, "messages"> | null;
};

export function defaultTestDeps(): TestDeps {
  if (!agentRuntimeStatus().on) return { store: null, client: null };
  return {
    store: createTestChatStore(),
    client: new Anthropic({ timeout: MODEL_TIMEOUT_MS, maxRetries: 1 }),
  };
}

export async function runTestChat(
  input: {
    workspaceId: string;
    userId: string;
    sessionId: string;
    message: string;
  },
  deps: TestDeps = defaultTestDeps(),
): Promise<TestTurn> {
  const { store, client } = deps;
  if (!store || !client) return { status: "not_configured" };
  const { workspaceId, userId, sessionId } = input;
  try {
    const context = await store.begin({
      workspaceId,
      userId,
      sessionId,
      body: input.message,
    });
    if (context === "limited") return { status: "limited" };
    if (!context || !context.agent) return { status: "unavailable" };
    if (trialState(context.workspace).locked) return { status: "trial_ended" };
    if (context.replies_today >= DAILY_REPLY_CAP) return { status: "capped" };
    const inReplyTo = context.latest_visitor_message_id;
    if (!inReplyTo) return { status: "stale" };

    const generated = await generateReply(client, context);
    if (!generated.ok) return { status: "failed", reason: generated.reason };

    const stored = await store.commit({
      workspaceId,
      userId,
      sessionId,
      inReplyTo,
      result: { ...generated.result, model: generated.model },
    });
    if (!stored) return { status: "unavailable" };
    if (stored.status === "stale") return { status: "stale" };
    return {
      status: stored.status === "silent" ? "silent" : "replied",
      result: generated.result,
    };
  } catch (error) {
    console.error("[agent] test chat failed:", (error as Error).message);
    return { status: "failed", reason: "error" };
  }
}
