import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { redactCardNumbers } from "@/lib/agents/guard";
import { spendOf } from "@/lib/prospects/model";
import { NO_SPEND, type Spend } from "@/lib/prospects/types";
import {
  FOLLOWUP_MAX_WORDS,
  MAIL_MODEL,
  MODEL_TIMEOUT_MS,
  REPLY_MAX_WORDS,
  WRITE_MAX_TOKENS,
} from "./config";
import {
  followupSystem,
  followupUser,
  replySystem,
  replyUser,
  type FollowupItem,
  type ReplyItem,
  type WriteContext,
} from "./prompt";
import { REPLY_CLASSES, type ReplyClass } from "./types";

// The two model calls of the mail agent. Each returns what was read out of
// the model's answer, checked again here, and what the call used. Neither
// throws for an API error.

export type ModelClient = Pick<Anthropic, "messages">;

export type WriteFailure =
  | "rate_limited"
  | "not_authorised"
  | "unavailable"
  | "refused"
  | "cut_off"
  | "unreadable"
  | "too_long"
  | "has_link";

type Failed = { ok: false; reason: WriteFailure; spend: Spend };

async function ask(
  client: ModelClient,
  system: Anthropic.TextBlockParam[],
  user: string,
  schema: Record<string, unknown>,
): Promise<
  | { ok: true; data: Record<string, unknown>; model: string; spend: Spend }
  | Failed
> {
  const failed = (reason: WriteFailure, spend: Spend = NO_SPEND): Failed => ({
    ok: false,
    reason,
    spend,
  });
  let message: Anthropic.Message;
  try {
    // No retries: a step has a fixed time to finish in, and comes back to
    // anything that didn't get done.
    message = await client.messages.create(
      {
        model: MAIL_MODEL,
        max_tokens: WRITE_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema } },
      },
      { timeout: MODEL_TIMEOUT_MS, maxRetries: 0 },
    );
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError)
      return failed("rate_limited");
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      console.error("[mail] the Anthropic key was refused");
      return failed("not_authorised");
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[mail] model call failed:", error.status, error.name);
      return failed("unavailable");
    }
    throw error;
  }
  const spend = spendOf(message.usage);
  if (message.stop_reason === "refusal") return failed("refused", spend);
  if (message.stop_reason === "max_tokens") return failed("cut_off", spend);
  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return failed("unreadable", spend);
    return {
      ok: true,
      data: parsed as Record<string, unknown>,
      model: message.model,
      spend,
    };
  } catch {
    return failed("unreadable", spend);
  }
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const LINK = /https?:\/\/[^\s<>()]+/gi;

/** Plain text only: what a model might add as formatting is taken out. */
const plain = (value: unknown) =>
  typeof value === "string"
    ? redactCardNumbers(value)
        .replace(/\r\n/g, "\n")
        .replace(/^[ \t]*[#>*-][ \t]+/gm, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : "";

// --- Follow-up ----------------------------------------------------------------------

const FOLLOWUP_SCHEMA = {
  type: "object",
  properties: { body: { type: "string" } },
  required: ["body"],
  additionalProperties: false,
};

export async function writeFollowup(
  client: ModelClient,
  context: WriteContext,
  item: FollowupItem,
): Promise<{ ok: true; body: string; model: string; spend: Spend } | Failed> {
  const answer = await ask(
    client,
    followupSystem(context),
    followupUser(item),
    FOLLOWUP_SCHEMA,
  );
  if (!answer.ok) return answer;
  const body = plain(answer.data.body);
  const { spend } = answer;
  if (!body) return { ok: false, reason: "unreadable", spend };
  if (words(body) > (FOLLOWUP_MAX_WORDS[item.step - 1] ?? 70))
    return { ok: false, reason: "too_long", spend };
  // A follow-up carries no links at all.
  if (/https?:\/\//i.test(body))
    return { ok: false, reason: "has_link", spend };
  return { ok: true, body, model: answer.model, spend };
}

// --- Reply --------------------------------------------------------------------------

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    class: { type: "string", enum: [...REPLY_CLASSES] },
    summary: { type: "string" },
    reply: { type: "string" },
  },
  required: ["class", "summary", "reply"],
  additionalProperties: false,
};

export type ReadReply = {
  class: ReplyClass;
  summary: string;
  /** Empty when no answer should be drafted. */
  reply: string;
  model: string;
};

export async function readReply(
  client: ModelClient,
  context: WriteContext,
  item: ReplyItem,
): Promise<{ ok: true; result: ReadReply; spend: Spend } | Failed> {
  const answer = await ask(
    client,
    replySystem(context),
    replyUser(item),
    REPLY_SCHEMA,
  );
  if (!answer.ok) return answer;
  const { data, spend } = answer;
  const cls = REPLY_CLASSES.find((c) => c === data.class);
  if (!cls) return { ok: false, reason: "unreadable", spend };
  let reply =
    cls === "interested" || cls === "question" ? plain(data.reply) : "";
  // An answer that is too long, or that carries a link other than the
  // workspace's own booking link, isn't used: the reply still gets its
  // class, and a person writes the answer.
  const links = reply.match(LINK) ?? [];
  const allowed = context.booking_url?.replace(/[.,;]+$/, "");
  if (
    words(reply) > REPLY_MAX_WORDS ||
    links.some((l) => l.replace(/[.,;]+$/, "") !== allowed)
  )
    reply = "";
  return {
    ok: true,
    result: {
      class: cls,
      summary: plain(data.summary).replace(/\s+/g, " ").slice(0, 600),
      reply,
      model: answer.model,
    },
    spend,
  };
}
