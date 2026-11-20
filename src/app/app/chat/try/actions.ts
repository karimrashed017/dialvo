"use server";

import { redactCardNumbers } from "@/lib/agents/guard";
import { runTestChat } from "@/lib/agents/test-chat";
import type { Outcome } from "@/lib/agents/types";
import {
  ActionProblem,
  inWorkspace,
  type ActionResult,
} from "@/lib/app/action";
import { MAX_CHAT_MESSAGE } from "@/lib/chat/http";
import { cleanLongText, isUuid } from "@/lib/leads/fields";
import { createLimiter } from "@/lib/leads/rate-limit";

// "Try your agent": one message from a signed-in teammate to their own
// inbound agent. It goes through inWorkspace like every other action (the
// session and the membership are checked), then through the same model call
// as a visitor's chat. See src/lib/agents/test-chat.ts.

/** Test messages: 10 a minute per person here; the database holds its own. */
const tryLimit = createLimiter({ windowMs: 60_000, max: 10 });

export type TestReply = {
  body: string;
  outcome: Outcome;
  summary: string;
  handoff: boolean;
  stop_contact: boolean;
};

export type TestChatResult = ActionResult & {
  /** What was sent, after cleaning (card numbers are taken out). */
  sent?: string;
  reply?: TestReply;
  /** The agent would hand over without saying anything. */
  silent?: boolean;
};

const WHY: Record<string, string> = {
  not_configured:
    "The agent isn't switched on yet on Dialvo's side, so it can't answer here yet.",
  unavailable:
    "This workspace has no agent for the website chat, so there is nothing to try yet.",
  limited: "That's a lot of test messages. Wait a minute and try again.",
  capped:
    "Your agent has reached today's limit of replies. It starts again tomorrow.",
  trial_ended:
    "Your free trial has ended, so your agent has stopped replying. Pick a plan to switch it back on.",
  failed: "The agent couldn't answer that just now. Try again in a moment.",
};

export async function sendTestMessage(form: FormData): Promise<TestChatResult> {
  let extra: Partial<TestChatResult> = {};
  const result = await inWorkspace(async ({ workspace, user }) => {
    const sessionId = form.get("session");
    if (!isUuid(sessionId))
      throw new ActionProblem("Start the test chat again.");
    const raw = form.get("message");
    if (typeof raw === "string" && raw.length > MAX_CHAT_MESSAGE * 2)
      throw new ActionProblem("That message is too long.");
    // The same cleaning a visitor's message gets.
    const message = redactCardNumbers(cleanLongText(raw, MAX_CHAT_MESSAGE + 1));
    if (!message) throw new ActionProblem("Write a message first.");
    if (message.length > MAX_CHAT_MESSAGE)
      throw new ActionProblem("That message is too long.");
    if (tryLimit.take(user.id) > 0) throw new ActionProblem(WHY.limited);

    const turn = await runTestChat({
      workspaceId: workspace.id,
      userId: user.id,
      sessionId,
      message,
    });
    extra = { sent: message };
    if (turn.status === "replied") {
      extra.reply = {
        body: turn.result.reply,
        outcome: turn.result.outcome,
        summary: turn.result.summary,
        handoff: turn.result.handoff,
        stop_contact: turn.result.stop_contact,
      };
      return { ok: true };
    }
    if (turn.status === "silent") {
      extra.silent = true;
      return { ok: true };
    }
    // The teammate typed again before this answer was ready: nothing to show.
    if (turn.status === "stale") return { ok: true };
    return { ok: false, message: WHY[turn.status] ?? WHY.failed };
  });
  return { ...result, ...extra };
}
