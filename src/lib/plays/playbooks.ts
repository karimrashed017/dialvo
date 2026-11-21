import type { LeadFilters } from "@/lib/data/filters";
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Supabase } from "@/lib/supabase/server";
import { PLAY_MAX_LEADS_PER_START } from "./config";

// Playbooks: plays a workspace writes itself (the playbooks migration). Who
// they pick is decided in the database (private.playbook_candidates), with
// every rule a built-in play keeps; this file reads them for the pages and
// starts them through the secret key, naming the workspace and the person.

export const LEAD_STATUSES = [
  "new",
  "engaged",
  "qualified",
  "meeting_booked",
  "won",
  "lost",
] as const;
export type PlaybookStatus = (typeof LEAD_STATUSES)[number];

export type PlaybookFilters = {
  statuses?: PlaybookStatus[];
  sources?: string[];
  inactive_days?: number | null;
  added_within_days?: number | null;
} & Pick<
  LeadFilters,
  "tiers" | "min_fit" | "min_engagement" | "list_id" | "audience_id" | "recipe"
>;

export type Playbook = {
  id: string;
  name: string;
  filters: PlaybookFilters;
  goal: string;
  sequence_id: string | null;
  language: string;
  approval_mode: "approve_first" | "auto";
  repeat_days: number;
  updated_at: string;
};

const COLUMNS =
  "id, name, filters, goal, sequence_id, language, approval_mode, repeat_days, updated_at";

export async function listPlaybooks(
  supabase: Supabase,
  workspaceId: string,
): Promise<Playbook[]> {
  const { data, error } = await supabase
    .from("playbooks")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("created_at")
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as Playbook[];
}

export async function getPlaybook(
  supabase: Supabase,
  workspaceId: string,
  id: string,
): Promise<Playbook | null> {
  const { data, error } = await supabase
    .from("playbooks")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Playbook | null) ?? null;
}

/** Where the workspace's leads came from, for the source filter's hints. */
export async function leadSources(
  supabase: Supabase,
  workspaceId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("leads")
    .select("source")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1000);
  return [
    ...new Set(
      ((data ?? []) as { source: string }[])
        .map((r) => r.source)
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

/** One sentence on who a playbook picks. */
export function describeFilters(f: PlaybookFilters): string {
  const parts: string[] = [];
  const statuses = f.statuses ?? [];
  parts.push(
    statuses.length
      ? `Leads that are ${statuses.map((s) => s.replace("_", " ")).join(" or ")}`
      : "Any lead",
  );
  if (f.sources?.length) parts.push(`from ${f.sources.join(" or ")}`);
  if (f.inactive_days)
    parts.push(`with nothing happening for ${f.inactive_days} days`);
  if (f.added_within_days)
    parts.push(`added in the last ${f.added_within_days} days`);
  if (f.tiers?.length) parts.push(`in tier ${f.tiers.join(" or ")}`);
  if (f.min_fit != null) parts.push(`with a fit score of ${f.min_fit}+`);
  if (f.min_engagement != null)
    parts.push(`with an engagement score of ${f.min_engagement}+`);
  if (f.audience_id) parts.push("in a saved audience");
  if (f.list_id) parts.push("on a list");
  if (f.recipe) parts.push(`whose recipe answer is ${f.recipe.answer}`);
  return `${parts.join(", ")}.`;
}

type Started = { status: string; campaign_id?: string; selected?: number };

/** The secret-key calls. Null when the server has no secret key. */
export function createPlaybookStore() {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const rpc = async <T>(name: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data as T;
  };
  return {
    preview: (workspaceId: string, userId: string, id: string) =>
      rpc<{ count: number } | null>("playbook_preview", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_playbook_id: id,
        p_limit: PLAY_MAX_LEADS_PER_START,
      }),
    start: (workspaceId: string, userId: string, id: string) =>
      rpc<Started>("playbook_start", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_playbook_id: id,
        p_limit: PLAY_MAX_LEADS_PER_START,
      }),
  };
}
