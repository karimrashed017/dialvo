import Anthropic from "@anthropic-ai/sdk";
import { PROSPECT_MODEL, WEB_SEARCH_TOOL } from "@/lib/prospects/config";
import { SOCIAL_NETWORKS } from "@/lib/prospects/domains";
import { spendOf, type ModelClient } from "@/lib/prospects/model";
import { NO_SPEND, type Spend } from "@/lib/prospects/types";
import {
  BRIEF_MAX_TOKENS,
  BRIEF_SEARCHES,
  BRIEF_TIMEOUT_MS,
  CLOSED_LOST_MAX_TOKENS,
} from "./config";
import {
  readBrief,
  readClosedLost,
  searchedLinks,
  type ReadBrief,
  type ReadClosedLost,
} from "./parse";
import { briefPrompt, closedLostPrompt, type BriefPage } from "./prompt";
import type { BriefContext } from "./types";

// The two model calls: a brief (with web search) and a closed-lost note
// (from the conversation alone). Neither throws for an API problem: each
// returns what it used and a plain reason.

export type BriefFailure = { ok: false; reason: string; spend: Spend };

async function call(
  client: ModelClient,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<{ ok: true; message: Anthropic.Message } | BriefFailure> {
  try {
    const message = await client.messages.create(params, {
      timeout: BRIEF_TIMEOUT_MS,
      maxRetries: 0,
    });
    if (message.stop_reason === "refusal")
      return {
        ok: false,
        reason: "The model declined to write it.",
        spend: spendOf(message.usage),
      };
    return { ok: true, message };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError)
      return {
        ok: false,
        reason: "The model is busy; trying again soon.",
        spend: NO_SPEND,
      };
    if (error instanceof Anthropic.APIError) {
      console.error("[briefs] model call failed:", error.status, error.name);
      return { ok: false, reason: "The model didn't answer.", spend: NO_SPEND };
    }
    throw error;
  }
}

const textOf = (m: Anthropic.Message) =>
  m.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

export async function writeBrief(
  client: ModelClient,
  ctx: BriefContext,
  pages: BriefPage[],
): Promise<({ ok: true; spend: Spend } & ReadBrief) | BriefFailure> {
  const prompt = briefPrompt(ctx, pages, BRIEF_SEARCHES);
  const result = await call(client, {
    model: PROSPECT_MODEL,
    max_tokens: BRIEF_MAX_TOKENS,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
    tools: [
      {
        type: WEB_SEARCH_TOOL,
        name: "web_search",
        max_uses: BRIEF_SEARCHES,
        blocked_domains: [...SOCIAL_NETWORKS],
      },
    ],
  });
  if (!result.ok) return result;
  const spend = spendOf(result.message.usage);
  const read = readBrief(
    textOf(result.message),
    prompt.provided,
    searchedLinks(result.message.content as unknown[]),
  );
  if (!read)
    return { ok: false, reason: "The answer couldn't be read.", spend };
  return { ok: true, spend, ...read };
}

const CLOSED_LOST_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    reasons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
        },
        required: ["text", "sources"],
        additionalProperties: false,
      },
    },
    what_might_change: { type: "array", items: { type: "string" } },
    next_step: { type: "string" },
  },
  required: ["summary", "reasons", "what_might_change", "next_step"],
  additionalProperties: false,
};

export async function writeClosedLost(
  client: ModelClient,
  ctx: BriefContext,
): Promise<({ ok: true; spend: Spend } & ReadClosedLost) | BriefFailure> {
  const prompt = closedLostPrompt(ctx);
  const result = await call(client, {
    model: PROSPECT_MODEL,
    max_tokens: CLOSED_LOST_MAX_TOKENS,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
    output_config: {
      format: { type: "json_schema", schema: CLOSED_LOST_SCHEMA },
    },
  });
  if (!result.ok) return result;
  const spend = spendOf(result.message.usage);
  const read = readClosedLost(textOf(result.message), prompt.provided);
  if (!read)
    return { ok: false, reason: "The answer couldn't be read.", spend };
  return { ok: true, spend, ...read };
}
