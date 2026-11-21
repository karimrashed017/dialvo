import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

// What a first-email draft carries beyond the lead or prospect: the language
// its sequence or play is set to, and (for a playbook) the team's goal for
// it. The database copies both onto the draft when it is made
// (private.outbound_draft_sequence), so the writer reads them here.

export type DraftExtras = { language: string; guidance: string };

export type ReadExtras = (
  workspaceId: string,
  draftIds: string[],
) => Promise<Map<string, DraftExtras>>;

export const readDraftExtras: ReadExtras = async (workspaceId, draftIds) => {
  const out = new Map<string, DraftExtras>();
  const supabase = createServiceClient();
  if (!supabase || draftIds.length === 0) return out;
  // The secret key skips row-level security: the query names the workspace.
  const { data, error } = await supabase
    .from("outbound_drafts")
    .select("id, language, guidance")
    .eq("workspace_id", workspaceId)
    .in("id", draftIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as {
    id: string;
    language: string | null;
    guidance: string | null;
  }[])
    out.set(row.id, {
      language: row.language ?? "auto",
      guidance: row.guidance ?? "",
    });
  return out;
};
