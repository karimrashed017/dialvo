import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  DRAFT_MAX_TOKENS,
  MODEL_TIMEOUT_MS,
  PRICE_CACHE_READ_MICROS_PER_TOKEN,
  PRICE_CACHE_WRITE_MICROS_PER_TOKEN,
  PRICE_INPUT_MICROS_PER_TOKEN,
  PRICE_OUTPUT_MICROS_PER_TOKEN,
  PRICE_SEARCH_MICROS,
  PROSPECT_MODEL,
  RESEARCH_MAX_TOKENS,
  SEARCH_MAX_TOKENS,
  SEARCH_TIMEOUT_MS,
  SEARCHES_PER_ROUND,
  SUGGEST_MAX_TOKENS,
  WEB_SEARCH_TOOL,
} from "./config";
import { SOCIAL_NETWORKS } from "./domains";
import {
  readCandidates,
  readDraft,
  readResearch,
  readSuggestion,
  type DraftProblem,
} from "./parse";
import {
  draftSystem,
  draftUser,
  researchPrompt,
  searchPrompt,
  suggestPrompt,
  type DraftContext,
  type DraftProspect,
  type KnowledgeEntry,
} from "./prompt";
import {
  NO_SPEND,
  type Brief,
  type Candidate,
  type ResearchResult,
  type SitePage,
  type Spend,
} from "./types";

// The lead finder's four model calls. Each returns what was read out of the
// model's answer (already checked, see parse.ts) and what the call used, or
// a plain reason it failed. None of them throws for an API error.

export type ModelClient = Pick<Anthropic, "messages">;

export type ModelFailure =
  | "rate_limited"
  | "not_authorised"
  | "unavailable"
  | "refused"
  | "cut_off"
  | "unreadable";

type Failed = { ok: false; reason: ModelFailure; spend: Spend };

/** What a response used, and roughly what that cost. An estimate. */
export function spendOf(usage: Anthropic.Usage | undefined | null): Spend {
  if (!usage) return NO_SPEND;
  const input = usage.input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return {
    input_tokens: input + cacheWrite + cacheRead,
    output_tokens: output,
    searches,
    cost_micros: Math.ceil(
      input * PRICE_INPUT_MICROS_PER_TOKEN +
        cacheWrite * PRICE_CACHE_WRITE_MICROS_PER_TOKEN +
        cacheRead * PRICE_CACHE_READ_MICROS_PER_TOKEN +
        output * PRICE_OUTPUT_MICROS_PER_TOKEN +
        searches * PRICE_SEARCH_MICROS,
    ),
  };
}

async function call(
  client: ModelClient,
  params: Anthropic.MessageCreateParamsNonStreaming,
  timeout: number,
): Promise<{ ok: true; message: Anthropic.Message } | Failed> {
  const failed = (reason: ModelFailure): Failed => ({
    ok: false,
    reason,
    spend: NO_SPEND,
  });
  try {
    // No retries: a step has a fixed time to finish in, and the run comes
    // back to anything that didn't get done.
    const message = await client.messages.create(params, {
      timeout,
      maxRetries: 0,
    });
    if (message.stop_reason === "refusal")
      return { ok: false, reason: "refused", spend: spendOf(message.usage) };
    return { ok: true, message };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError)
      return failed("rate_limited");
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      console.error("[prospects] the Anthropic key was refused");
      return failed("not_authorised");
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[prospects] model call failed:", error.status, error.name);
      return failed("unavailable");
    }
    throw error;
  }
}

const textOf = (message: Anthropic.Message) =>
  message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

const json = (schema: Record<string, unknown>) => ({
  format: { type: "json_schema" as const, schema },
});

const text = { type: "string" };

// --- Suggest ------------------------------------------------------------------

const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    name: text,
    description: text,
    location: text,
    company_size: text,
    exclusions: text,
    sells_to_enterprises: { type: "boolean" },
  },
  required: [
    "name",
    "description",
    "location",
    "company_size",
    "exclusions",
    "sells_to_enterprises",
  ],
  additionalProperties: false,
};

export async function suggestIdealCustomer(
  client: ModelClient,
  input: {
    workspace: { name: string; website: string | null };
    knowledge: KnowledgeEntry[];
  },
): Promise<
  { ok: true; suggestion: Brief & { name: string }; spend: Spend } | Failed
> {
  const prompt = suggestPrompt(input);
  const result = await call(
    client,
    {
      model: PROSPECT_MODEL,
      max_tokens: SUGGEST_MAX_TOKENS,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      output_config: json(SUGGEST_SCHEMA),
    },
    MODEL_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  const spend = spendOf(result.message.usage);
  const suggestion =
    result.message.stop_reason === "max_tokens"
      ? null
      : readSuggestion(textOf(result.message));
  if (!suggestion) return { ok: false, reason: "unreadable", spend };
  return { ok: true, suggestion, spend };
}

// --- Search ---------------------------------------------------------------------

/**
 * One search round: the model runs up to `searches` web searches and lists
 * the companies it found. Social networks are blocked in the search tool
 * itself, and again when the answer is read.
 *
 * The answer is read from text rather than a fixed JSON shape because web
 * search answers carry citations, and citations and a fixed output shape
 * can't be asked for together.
 */
export async function findCompanies(
  client: ModelClient,
  input: {
    brief: Brief;
    sells?: string;
    known: string[];
    wanted: number;
    searches?: number;
  },
): Promise<{ ok: true; candidates: Candidate[]; spend: Spend } | Failed> {
  const prompt = searchPrompt(input);
  const result = await call(
    client,
    {
      model: PROSPECT_MODEL,
      max_tokens: SEARCH_MAX_TOKENS,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      tools: [
        {
          type: WEB_SEARCH_TOOL,
          name: "web_search",
          max_uses: Math.max(
            1,
            Math.min(input.searches ?? SEARCHES_PER_ROUND, SEARCHES_PER_ROUND),
          ),
          blocked_domains: [...SOCIAL_NETWORKS],
        },
      ],
    },
    SEARCH_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  const spend = spendOf(result.message.usage);
  // A paused or cut-off turn may still hold a finished list; if it doesn't,
  // this round simply found nobody and the run decides what to do next.
  return {
    ok: true,
    candidates: readCandidates(
      textOf(result.message),
      input.known,
      input.wanted,
    ),
    spend,
  };
}

// --- Read one company ---------------------------------------------------------------

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["business", "individual", "not_a_company", "unclear"],
    },
    fit: {
      type: "string",
      enum: ["good", "sells_similar", "too_large", "not_a_fit"],
    },
    fit_reason: text,
    matches: { type: "boolean" },
    company_name: text,
    summary: text,
    location: text,
    contact_name: text,
    contact_role: text,
    contact_source_url: text,
    email: text,
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: { fact: text, quote: text, source_url: text },
        required: ["fact", "quote", "source_url"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "kind",
    "fit",
    "fit_reason",
    "matches",
    "company_name",
    "summary",
    "location",
    "contact_name",
    "contact_role",
    "contact_source_url",
    "email",
    "facts",
  ],
  additionalProperties: false,
};

export async function researchCompany(
  client: ModelClient,
  input: {
    brief: Brief;
    sells?: string;
    pages: SitePage[];
    fallbackName: string;
  },
): Promise<{ ok: true; result: ResearchResult; spend: Spend } | Failed> {
  const prompt = researchPrompt(input);
  const response = await call(
    client,
    {
      model: PROSPECT_MODEL,
      max_tokens: RESEARCH_MAX_TOKENS,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      output_config: json(RESEARCH_SCHEMA),
    },
    MODEL_TIMEOUT_MS,
  );
  if (!response.ok) return response;
  const spend = spendOf(response.message.usage);
  if (response.message.stop_reason === "max_tokens")
    return { ok: false, reason: "cut_off", spend };
  const result = readResearch(
    textOf(response.message),
    input.pages,
    input.fallbackName,
  );
  if (!result) return { ok: false, reason: "unreadable", spend };
  return { ok: true, result, spend };
}

// --- Write one first email -----------------------------------------------------------

const DRAFT_SCHEMA = {
  type: "object",
  properties: { subject: text, body: text },
  required: ["subject", "body"],
  additionalProperties: false,
};

export async function draftFirstEmail(
  client: ModelClient,
  input: { context: DraftContext; prospect: DraftProspect },
): Promise<
  | { ok: true; subject: string; body: string; model: string; spend: Spend }
  | { ok: false; reason: ModelFailure | DraftProblem; spend: Spend }
> {
  const response = await call(
    client,
    {
      model: PROSPECT_MODEL,
      max_tokens: DRAFT_MAX_TOKENS,
      system: draftSystem(input.context),
      messages: [{ role: "user", content: draftUser(input.prospect) }],
      output_config: json(DRAFT_SCHEMA),
    },
    MODEL_TIMEOUT_MS,
  );
  if (!response.ok) return response;
  const spend = spendOf(response.message.usage);
  if (response.message.stop_reason === "max_tokens")
    return { ok: false, reason: "cut_off", spend };
  const draft = readDraft(textOf(response.message));
  if (!draft.ok) return { ok: false, reason: draft.problem, spend };
  return {
    ok: true,
    subject: draft.subject,
    body: draft.body,
    model: response.message.model,
    spend,
  };
}
