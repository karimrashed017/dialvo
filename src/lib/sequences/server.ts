import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Supabase } from "@/lib/supabase/server";
import { PURPOSE_SEQUENCES, type Purpose, type Step } from "./steps";

// Sequences as the app reads and uses them. Reading goes through the
// signed-in person's client (row-level security: their workspace only).
// What only the server may do (a play's ready-made sequence, which sequence
// a play run uses) goes through the secret key and names the workspace.

export type Sequence = {
  id: string;
  name: string;
  language: string;
  approval_mode: "approve_first" | "auto";
  steps: Step[];
  is_default: boolean;
  purpose: Purpose | null;
  archived_at: string | null;
  updated_at: string;
};

const COLUMNS =
  "id, name, language, approval_mode, steps, is_default, purpose, archived_at, updated_at";

/** The workspace's sequences, not archived, the default first. */
export async function listSequences(
  supabase: Supabase,
  workspaceId: string,
): Promise<Sequence[]> {
  const { data, error } = await supabase
    .from("sequences")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("is_default", { ascending: false })
    .order("created_at")
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as Sequence[];
}

/** A play's ready-made sequence (made the first time), by its purpose. */
export async function purposeSequence(
  workspaceId: string,
  purpose: Purpose,
): Promise<string | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const template = PURPOSE_SEQUENCES[purpose];
  const { data, error } = await supabase.rpc("sequence_for_purpose", {
    p_workspace_id: workspaceId,
    p_purpose: purpose,
    p_name: template.name,
    p_steps: template.steps,
  });
  if (error) throw new Error(`sequence_for_purpose: ${error.message}`);
  return (data as string | null) ?? null;
}

/**
 * Which sequence and language a play run (a campaign) uses. Set before its
 * first draft is written; the database copies both onto each draft. The
 * foreign key keeps the sequence inside the workspace.
 */
export async function setCampaignSequence(
  workspaceId: string,
  campaignId: string,
  sequenceId: string | null,
  language: string | null,
): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;
  const { error } = await supabase
    .from("outbound_campaigns")
    .update({ sequence_id: sequenceId, language })
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId);
  if (error) throw new Error(`set campaign sequence: ${error.message}`);
}
