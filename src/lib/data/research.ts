import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { spendOf, type ModelClient } from "@/lib/prospects/model";
import { PROSPECT_MODEL, WEB_SEARCH_TOOL } from "@/lib/prospects/config";
import { SOCIAL_NETWORKS } from "@/lib/prospects/domains";
import { NO_SPEND, type Spend } from "@/lib/prospects/types";
import {
  checkAnswer,
  normalise,
  type AnswerType,
  type CheckedAnswer,
} from "./answers";
import {
  RESEARCH_MAX_TOKENS,
  RESEARCH_SEARCHES_PER_CELL,
  RESEARCH_TIMEOUT_MS,
} from "./config";
import { researchPrompt, type ResearchRow } from "./prompt";

// One research cell: the column's question about one row, answered by the
// model with a couple of web searches, as a typed value with the page it
// came from and a short reason. Never throws for an API error.

export type ResearchOutcome =
  | { ok: true; answer: CheckedAnswer; spend: Spend }
  | {
      ok: false;
      reason: "rate_limited" | "unavailable" | "not_authorised" | "unreadable";
      spend: Spend;
    };

/** The links the web search returned, to check the cited one against. */
export function seenUrls(message: Anthropic.Message): Set<string> {
  const seen = new Set<string>();
  for (const block of message.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content))
      for (const r of block.content)
        if (r.type === "web_search_result") seen.add(normalise(r.url));
    if (block.type === "text")
      for (const c of block.citations ?? [])
        if (c.type === "web_search_result_location") seen.add(normalise(c.url));
  }
  return seen;
}

/** The last {...} in the reply, parsed. */
export function lastJsonObject(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].pop();
  const candidates = fenced ? [fenced[1]] : [];
  const end = text.lastIndexOf("}");
  if (end >= 0) {
    // Walk back to the "{" that balances the last "}".
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (text[i] === "}") depth++;
      else if (text[i] === "{" && --depth === 0) {
        candidates.push(text.slice(i, end + 1));
        break;
      }
    }
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      // try the next
    }
  }
  return null;
}

export async function researchCell(
  client: ModelClient,
  input: {
    question: string;
    type: AnswerType;
    options: string[];
    row: ResearchRow;
    kind: "companies" | "people";
  },
): Promise<ResearchOutcome> {
  const prompt = researchPrompt(input);
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(
      {
        model: PROSPECT_MODEL,
        max_tokens: RESEARCH_MAX_TOKENS,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        tools: [
          {
            type: WEB_SEARCH_TOOL,
            name: "web_search",
            max_uses: RESEARCH_SEARCHES_PER_CELL,
            blocked_domains: [...SOCIAL_NETWORKS],
          },
        ],
      },
      { timeout: RESEARCH_TIMEOUT_MS, maxRetries: 0 },
    );
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError)
      return { ok: false, reason: "rate_limited", spend: NO_SPEND };
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      console.error("[data] the Anthropic key was refused");
      return { ok: false, reason: "not_authorised", spend: NO_SPEND };
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[data] model call failed:", error.status, error.name);
      return { ok: false, reason: "unavailable", spend: NO_SPEND };
    }
    throw error;
  }
  const spend = spendOf(message.usage);
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const answer = checkAnswer(
    lastJsonObject(text),
    input.type,
    input.options,
    seenUrls(message),
  );
  if (!answer) return { ok: false, reason: "unreadable", spend };
  return { ok: true, answer, spend };
}
