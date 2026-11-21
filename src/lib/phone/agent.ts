import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { asksToStop, redactCardNumbers } from "@/lib/agents/guard";
import {
  MAX_OUTPUT_TOKENS,
  MAX_SPOKEN_CHARS,
  MODEL_TIMEOUT_MS,
  PHONE_MODEL,
} from "./config";
import { phoneMessages, phoneSystem } from "./prompt";
import { CALL_OUTCOMES, type CallContext, type TurnResult } from "./types";

// One turn of the phone agent: what the caller said in, what to say and
// what the agent made of the call out. Never throws for an API error: a
// failed turn is { ok: false } and the call is handed to the team.

export type ModelClient = Pick<Anthropic, "messages">;

const SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string" },
    outcome: { type: "string", enum: [...CALL_OUTCOMES] },
    summary: { type: "string" },
    handoff: { type: "boolean" },
    stop_calls: { type: "boolean" },
    stop_contact: { type: "boolean" },
    end_call: { type: "boolean" },
    send_booking_link: { type: "boolean" },
    caller_name: { type: "string" },
    caller_email: { type: "string" },
  },
  required: [
    "say",
    "outcome",
    "summary",
    "handoff",
    "stop_calls",
    "stop_contact",
    "end_call",
    "send_booking_link",
    "caller_name",
    "caller_email",
  ],
  additionalProperties: false,
};

/** Spoken text only: no markup, no card numbers, no links, not too long. */
export function spoken(text: string): string {
  const clean = redactCardNumbers(text)
    .replace(/https?:\/\/\S+/gi, "the link")
    .replace(/[*_#`>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= MAX_SPOKEN_CHARS) return clean;
  const cut = clean.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return end > 80 ? cut.slice(0, end + 1) : cut;
}

export async function phoneTurn(
  client: ModelClient,
  context: CallContext,
  heard: string,
): Promise<{ ok: true; result: TurnResult } | { ok: false; reason: string }> {
  const caller = redactCardNumbers(heard).slice(0, 2000);
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(
      {
        model: PHONE_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: phoneSystem(context),
        messages: phoneMessages(context, caller),
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      },
      { timeout: MODEL_TIMEOUT_MS, maxRetries: 0 },
    );
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error("[phone] model call failed:", error.status, error.name);
      return { ok: false, reason: "unavailable" };
    }
    console.error("[phone] model call failed:", (error as Error).name);
    return { ok: false, reason: "unavailable" };
  }
  if (message.stop_reason === "refusal")
    return { ok: false, reason: "refused" };
  if (message.stop_reason === "max_tokens")
    return { ok: false, reason: "cut_off" };
  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const say = spoken(typeof data.say === "string" ? data.say : "");
  if (!say) return { ok: false, reason: "empty" };
  const bool = (k: string) => data[k] === true;
  const str = (k: string, max: number) =>
    typeof data[k] === "string" ? (data[k] as string).trim().slice(0, max) : "";
  const outcome = CALL_OUTCOMES.includes(data.outcome as TurnResult["outcome"])
    ? (data.outcome as TurnResult["outcome"])
    : "none";
  // The backstop: a plain "don't call me" is honoured even if the model missed it.
  const stopCalls =
    bool("stop_calls") || bool("stop_contact") || asksToStop(caller);
  return {
    ok: true,
    result: {
      say,
      outcome,
      summary: str("summary", 1000),
      handoff: bool("handoff"),
      stop_calls: stopCalls,
      stop_contact: bool("stop_contact"),
      end_call: bool("end_call") || stopCalls,
      send_booking_link: bool("send_booking_link"),
      caller_name: str("caller_name", 200),
      caller_email: str("caller_email", 254),
    },
  };
}
