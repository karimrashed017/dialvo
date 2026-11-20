import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { CREDITS_TECHNOLOGY_CHECK, TAKEOUT_CHECKS_PER_CLICK } from "./config";
import type { PlaysFindymail } from "./findymail";
import type { PlayStore } from "./store";

// Competitive takeout. A takeout search is a Find leads search
// (prospect_searches.play = 'takeout') for companies that use a named
// competitor's product. Its Intellimatch query says so, but the database's
// answer is a match, not a proof, so each kept company can be checked:
// POST /api/technologies with only that product (1 credit when it is
// detected, 0 when not). A detection becomes a sourced fact on the prospect
// ("Uses X, detected on ..."); only then does its first email mention the
// product (src/lib/plays/prompt.ts, takeoutLines).

export type TakeoutInfo = { competitor: string; confirmed: boolean };

const FACT_PREFIX = "Uses ";

/** The fact a detection becomes. */
export const technologyFact = (label: string, detected: string | null) =>
  `${FACT_PREFIX}${label}${detected ? ` (detected ${detected})` : ""}`;

type Fact = { fact?: string; kind?: string };

/** For each draft id that is a takeout draft: the product, and whether confirmed. */
export async function readTakeout(
  workspaceId: string,
  draftIds: string[],
): Promise<Map<string, TakeoutInfo>> {
  const out = new Map<string, TakeoutInfo>();
  const supabase = createServiceClient();
  if (!supabase || draftIds.length === 0) return out;
  // The secret key skips row-level security: the query names the workspace.
  const { data, error } = await supabase
    .from("outbound_drafts")
    .select(
      "id, play, prospect:prospects(facts, search:prospect_searches(competitor))",
    )
    .eq("workspace_id", workspaceId)
    .eq("play", "takeout")
    .in("id", draftIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as unknown as {
    id: string;
    prospect: {
      facts: Fact[] | null;
      search: { competitor: string | null } | null;
    } | null;
  }[]) {
    const competitor = row.prospect?.search?.competitor?.trim();
    if (!competitor) continue;
    const confirmed = (row.prospect?.facts ?? []).some(
      (f) =>
        f.kind === "technology" &&
        typeof f.fact === "string" &&
        f.fact
          .toLowerCase()
          .startsWith(`${FACT_PREFIX}${competitor}`.toLowerCase()),
    );
    out.set(row.id, { competitor, confirmed });
  }
  return out;
}

export type CheckResult = {
  checked: number;
  confirmed: number;
  notFound: number;
  capped: boolean;
  failed: number;
};

/**
 * Checks the kept companies of one takeout search for the product, at most
 * TAKEOUT_CHECKS_PER_CLICK, skipping ones already confirmed. Each check's
 * credit is reserved from the day's cap first and given back when nothing
 * was detected or the call failed.
 */
export async function checkTechnology(
  input: {
    workspaceId: string;
    competitor: string;
    prospects: { id: string; domain: string; facts: Fact[] | null }[];
  },
  deps: { store: PlayStore; findymail: PlaysFindymail },
): Promise<CheckResult> {
  const result: CheckResult = {
    checked: 0,
    confirmed: 0,
    notFound: 0,
    capped: false,
    failed: 0,
  };
  const name = input.competitor.trim();
  const todo = input.prospects
    .filter((p) => !(p.facts ?? []).some((f) => f.kind === "technology"))
    .slice(0, TAKEOUT_CHECKS_PER_CLICK);
  for (const p of todo) {
    if (
      !(await deps.store.reserveCredits(
        input.workspaceId,
        CREDITS_TECHNOLOGY_CHECK,
      ))
    ) {
      result.capped = true;
      break;
    }
    const found = await deps.findymail.technology(p.domain, name);
    result.checked += 1;
    if (!found.ok) {
      await deps.store.reserveCredits(
        input.workspaceId,
        -CREDITS_TECHNOLOGY_CHECK,
      );
      result.failed += 1;
      if (
        found.problem === "unauthenticated" ||
        found.problem === "no_credits" ||
        found.problem === "paused"
      )
        break;
      continue;
    }
    if (!found.value.found) {
      await deps.store.reserveCredits(
        input.workspaceId,
        -CREDITS_TECHNOLOGY_CHECK,
      );
      // Nothing detected costs nothing, so nothing is stored: a fact
      // here would reach the writer as something true about the company.
      result.notFound += 1;
      continue;
    }
    result.confirmed += 1;
    await deps.store.addFact(input.workspaceId, p.id, {
      fact: technologyFact(found.value.label, found.value.detected),
      quote: `${found.value.label} is among this company's technologies in Findymail's technology data.`,
      source_url: "",
      kind: "technology",
    });
  }
  return result;
}
