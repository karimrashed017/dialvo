import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AGENT_MODEL, MAX_OUTPUT_TOKENS, MAX_REPLY_CHARS } from "./config";
import { redactCardNumbers } from "./guard";
import { buildMessages, buildSystem } from "./prompt";
import { OUTCOMES, type AgentResult, type ChatContext } from "./types";

// One call to the model for one reply. The model returns JSON in a fixed
// shape (structured outputs), so the reply and what the agent concluded
// arrive together and nothing has to be parsed out of prose.

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "What to say to the visitor now, as plain chat text.",
    },
    outcome: { type: "string", enum: [...OUTCOMES] },
    summary: {
      type: "string",
      description:
        "One or two factual sentences for the team. Empty while the outcome is none.",
    },
    handoff: {
      type: "boolean",
      description: "True when a person on the team should take over.",
    },
    stop_contact: {
      type: "boolean",
      description: "True when the visitor asked not to be contacted again.",
    },
    offer_booking: {
      type: "boolean",
      description:
        "True when this reply offers the team's booking link. Always false when no booking link is given.",
    },
    visitor_name: {
      type: "string",
      description: "The visitor's name if they gave it, else empty.",
    },
    visitor_email: {
      type: "string",
      description: "The visitor's email address if they gave it, else empty.",
    },
  },
  required: [
    "reply",
    "outcome",
    "summary",
    "handoff",
    "stop_contact",
    "offer_booking",
    "visitor_name",
    "visitor_email",
  ],
  additionalProperties: false,
};

export type ReplyFailure =
  | "nothing_to_answer"
  | "rate_limited"
  | "not_authorised"
  | "unavailable"
  | "refused"
  | "cut_off"
  | "unreadable";

export type GeneratedReply =
  | { ok: true; result: AgentResult; model: string }
  | { ok: false; reason: ReplyFailure };

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Checks the model's JSON again ourselves: the shape is a promise, not proof. */
export function readResult(raw: string): AgentResult | null {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const outcome = OUTCOMES.find((o) => o === data.outcome);
  if (!outcome || typeof data.reply !== "string") return null;
  return {
    // The agent never repeats a card number back, whatever it was told.
    reply: redactCardNumbers(text(data.reply, MAX_REPLY_CHARS)),
    outcome,
    summary: redactCardNumbers(text(data.summary, 1000)),
    handoff: data.handoff === true,
    stop_contact: data.stop_contact === true,
    offer_booking: data.offer_booking === true,
    visitor_name: text(data.visitor_name, 200),
    visitor_email: text(data.visitor_email, 254).toLowerCase(),
  };
}

export async function generateReply(
  client: Pick<Anthropic, "messages">,
  context: ChatContext,
): Promise<GeneratedReply> {
  const messages = buildMessages(context);
  if (!messages) return { ok: false, reason: "nothing_to_answer" };
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: buildSystem(context),
      messages,
      output_config: { format: { type: "json_schema", schema: REPLY_SCHEMA } },
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError)
      return { ok: false, reason: "rate_limited" };
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      console.error("[agent] the Anthropic key was refused");
      return { ok: false, reason: "not_authorised" };
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[agent] model call failed:", error.status, error.name);
      return { ok: false, reason: "unavailable" };
    }
    throw error;
  }
  if (response.stop_reason === "refusal")
    return { ok: false, reason: "refused" };
  if (response.stop_reason === "max_tokens")
    return { ok: false, reason: "cut_off" };
  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  const result = readResult(raw);
  if (!result) return { ok: false, reason: "unreadable" };
  return { ok: true, result, model: response.model };
}
