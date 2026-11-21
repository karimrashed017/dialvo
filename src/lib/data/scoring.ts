import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL_TIMEOUT_MS, PROSPECT_MODEL } from "@/lib/prospects/config";
import { spendOf, type ModelClient } from "@/lib/prospects/model";
import type { Spend } from "@/lib/prospects/types";
import { SCORING_SUGGEST_MAX_TOKENS } from "./config";
import { SUGGEST_RULES_SCHEMA, SUGGEST_RULES_SYSTEM } from "./prompt";

// Fit rules from the team's own description of who they sell to (a Find
// leads search): one small model call. The rules are then the team's to
// change; scoring itself happens in the database (private.score_lead).

export type FitRules = {
  countries?: string[];
  size_min?: number | null;
  size_max?: number | null;
  titles?: string[];
  keywords?: string[];
  sources?: string[];
};

const words = (v: unknown, max: number) =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .filter((x): x is string => typeof x === "string")
            .map((x) =>
              x
                .replace(/[\u0000-\u001f<>]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80),
            )
            .filter((x) => x.length >= 2),
        ),
      ].slice(0, max)
    : [];

const size = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 10_000_000
    ? Math.round(v)
    : null;

/** The model's answer, checked. Pure. */
export function readRules(raw: string): FitRules | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  let lo = size(d.size_min);
  let hi = size(d.size_max);
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
  return {
    countries: words(d.countries, 10),
    size_min: lo,
    size_max: hi,
    titles: words(d.titles, 8),
    keywords: words(d.keywords, 8),
  };
}

export async function suggestRules(
  client: ModelClient,
  description: string,
): Promise<
  { ok: true; rules: FitRules; spend: Spend } | { ok: false; spend?: Spend }
> {
  try {
    const message = await client.messages.create(
      {
        model: PROSPECT_MODEL,
        max_tokens: SCORING_SUGGEST_MAX_TOKENS,
        system: [{ type: "text", text: SUGGEST_RULES_SYSTEM }],
        messages: [
          {
            role: "user",
            content: `<description>\n${description.replace(/<\/?description>/gi, "").slice(0, 3000)}\n</description>`,
          },
        ],
        output_config: {
          format: { type: "json_schema", schema: SUGGEST_RULES_SCHEMA },
        },
      },
      { timeout: MODEL_TIMEOUT_MS, maxRetries: 0 },
    );
    const spend = spendOf(message.usage);
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const rules = message.stop_reason === "max_tokens" ? null : readRules(text);
    return rules ? { ok: true, rules, spend } : { ok: false, spend };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(
        "[data] scoring suggestion failed:",
        error.status,
        error.name,
      );
      return { ok: false };
    }
    throw error;
  }
}
