import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import type { AnswerType } from "./answers";

// What several pages offer in their pickers: the workspace's lists,
// audiences, recipes and playbooks. Read as the signed-in person (RLS).

export type ListRef = {
  id: string;
  name: string;
  kind: "companies" | "people";
};
export type AudienceRef = { id: string; name: string };
export type RecipeRef = {
  id: string;
  name: string;
  kind: "research" | "score";
  applies_to: "companies" | "people";
  question: string;
  answer_type: AnswerType;
  options: string[];
};
export type PlaybookRef = { id: string; name: string };

export async function dataOptions(
  supabase: Supabase,
  workspaceId: string,
): Promise<{
  lists: ListRef[];
  audiences: AudienceRef[];
  recipes: RecipeRef[];
  playbooks: PlaybookRef[];
}> {
  const [lists, audiences, recipes, playbooks] = await Promise.all([
    supabase
      .from("data_lists")
      .select("id, name, kind")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("audiences")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .order("created_at")
      .limit(100),
    supabase
      .from("data_recipes")
      .select("id, name, kind, applies_to, question, answer_type, options")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .order("created_at")
      .limit(100),
    supabase
      .from("playbooks")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .order("created_at")
      .limit(50),
  ]);
  return {
    lists: (lists.data ?? []) as ListRef[],
    audiences: (audiences.data ?? []) as AudienceRef[],
    recipes: (recipes.data ?? []) as RecipeRef[],
    playbooks: (playbooks.data ?? []) as PlaybookRef[],
  };
}

/** The usage of today (UTC) against the day's caps. */
export async function todayUsage(supabase: Supabase, workspaceId: string) {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("data_usage")
    .select("research_cells, model_micros, credits")
    .eq("workspace_id", workspaceId)
    .eq("day", day)
    .maybeSingle();
  const u = (data ?? {}) as {
    research_cells?: number;
    model_micros?: number;
    credits?: number;
  };
  return {
    cells: u.research_cells ?? 0,
    micros: Number(u.model_micros ?? 0),
    credits: u.credits ?? 0,
  };
}

export const dollars = (micros: number) =>
  `$${(micros / 1_000_000).toFixed(micros < 100_000 ? 3 : 2)}`;
