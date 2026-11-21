"use server";

import Anthropic from "@anthropic-ai/sdk";
import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { RESCORE_NOW } from "@/lib/data/config";
import { suggestRules, type FitRules } from "@/lib/data/scoring";
import { prospectRuntimeStatus } from "@/lib/prospects/config";
import { createProspectStore } from "@/lib/prospects/store";
import { cleanText, isUuid } from "@/lib/leads/fields";
import type { Supabase } from "@/lib/supabase/server";

// Lead scoring settings, saved by an owner or admin through scoring_save
// (the database checks again and rescores the leads).

const list = (value: FormDataEntryValue | null, max: number) =>
  String(value ?? "")
    .split(/[,\n]/)
    .map((v) => cleanText(v, 80))
    .filter(Boolean)
    .slice(0, max);

const int = (
  value: FormDataEntryValue | null,
  min: number,
  max: number,
  field: string,
  what: string,
) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ActionProblem(
      `${what} must be a whole number from ${min} to ${max}.`,
      field,
    );
  return n;
};

async function save(
  supabase: Supabase,
  workspaceId: string,
  fit: FitRules,
  form: FormData,
) {
  const tier1 = int(form.get("tier1_min"), 1, 100, "tier1_min", "Tier 1") ?? 70;
  const tier2 = int(form.get("tier2_min"), 0, 99, "tier2_min", "Tier 2") ?? 40;
  if (tier2 >= tier1)
    throw new ActionProblem("Tier 2 must start below tier 1.", "tier2_min");
  const weight =
    int(
      form.get("engagement_weight"),
      0,
      100,
      "engagement_weight",
      "Engagement's share",
    ) ?? 40;
  const recipe = form.get("recipe_id");
  const recipeWeight =
    int(
      form.get("recipe_weight"),
      1,
      3,
      "recipe_weight",
      "The recipe's weight",
    ) ?? 1;
  const { data, error } = await supabase.rpc("scoring_save", {
    p_workspace_id: workspaceId,
    p_fit: fit,
    p_recipe_id: isUuid(recipe) ? recipe : null,
    p_recipe_weight: recipeWeight,
    p_tier1_min: tier1,
    p_tier2_min: tier2,
    p_engagement_weight: weight,
    p_rescore: RESCORE_NOW,
  });
  if (error?.code === "22023")
    throw new ActionProblem("Some of those settings are out of range.");
  if (error?.code === "P0002")
    throw new ActionProblem("That recipe doesn't exist.");
  mustSucceed({ error }, "save scoring");
  return data as number;
}

export async function saveScoring(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const fit: FitRules = {
        countries: list(form.get("countries"), 30),
        size_min: int(
          form.get("size_min"),
          1,
          10_000_000,
          "size_min",
          "The smallest size",
        ),
        size_max: int(
          form.get("size_max"),
          1,
          10_000_000,
          "size_max",
          "The largest size",
        ),
        titles: list(form.get("titles"), 30),
        keywords: list(form.get("keywords"), 30),
        sources: list(form.get("sources"), 30),
      };
      if (fit.size_min && fit.size_max && fit.size_min > fit.size_max)
        throw new ActionProblem(
          "The smallest size has to be under the largest.",
          "size_min",
        );
      const n = await save(supabase, workspace.id, fit, form);
      refresh();
      return {
        ok: true,
        message: `Saved. ${n} ${n === 1 ? "lead was" : "leads were"} rescored now; the rest within ten minutes.`,
      };
    },
    { admin: true },
  );
}

export async function suggestScoring(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace, user }) => {
      const search = form.get("search_id");
      if (!isUuid(search))
        throw new ActionProblem("Choose a Find leads search.", "search_id");
      const { data } = await supabase
        .from("prospect_searches")
        .select("description, location, company_size")
        .eq("workspace_id", workspace.id)
        .eq("id", search)
        .maybeSingle();
      if (!data) throw new ActionProblem("That search doesn't exist.");
      const store = createProspectStore();
      if (!store || !prospectRuntimeStatus().on)
        throw new ActionProblem("This isn't switched on yet on Dialvo's side.");
      // Counted with Find leads' own suggestions (10 a day).
      if (!(await store.takeSuggestion(workspace.id, user.id)))
        throw new ActionProblem(
          "That's today's suggestions used. Try again tomorrow, or write the rules yourself.",
        );
      const s = data as {
        description: string;
        location: string;
        company_size: string;
      };
      const result = await suggestRules(
        new Anthropic(),
        [
          s.description,
          s.location && `Where: ${s.location}`,
          s.company_size && `Company size: ${s.company_size}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      if (result.spend)
        await store.recordSpend(workspace.id, result.spend.cost_micros);
      if (!result.ok)
        throw new ActionProblem(
          "No rules could be written just now. Try again in a moment.",
        );
      const n = await save(supabase, workspace.id, result.rules, form);
      refresh();
      return {
        ok: true,
        message: `Rules written from that description and saved; ${n} leads rescored. Check them below and change anything that's off.`,
      };
    },
    { admin: true },
  );
}
