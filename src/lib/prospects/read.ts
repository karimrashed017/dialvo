import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import type {
  OutboundDraft,
  Prospect,
  ProspectRun,
  ProspectSearch,
  Suppression,
  Usage,
} from "./types";

// What the "Find leads" pages read, as the signed-in person: row-level
// security applies to every query, and each one names the workspace too.

function rows<T>(result: {
  data: unknown;
  error: { message: string } | null;
}): T[] {
  if (result.error)
    throw new Error(`Database read failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

const PROSPECT_COLUMNS =
  "id, run_id, search_id, domain, company_name, website, research_status, skip_reason, summary, location, contact_name, contact_role, contact_source_url, email, email_source_url, email_kind, phone, phone_source_url, facts, pages, decision, lead_id, created_at, source, size_range, industries, country, match_score, contact_linkedin_url, email_verified";
const DRAFT_COLUMNS =
  "id, prospect_id, to_email, subject, body, status, discard_reason, edited, created_at, decided_at";

export type DraftWithProspect = OutboundDraft & {
  prospect: Pick<
    Prospect,
    "id" | "company_name" | "website" | "contact_name" | "search_id"
  > | null;
};

export function prospectReads(supabase: Supabase, workspaceId: string) {
  const from = (table: string) => supabase.from(table);
  return {
    async searches() {
      return rows<ProspectSearch>(
        await from("prospect_searches")
          .select(
            "id, name, description, location, company_size, exclusions, created_at, updated_at, contact_query, contact_titles, contact_query_for, contact_query_edited",
          )
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(50),
      );
    },
    /** The workspace's most recent runs, newest first. */
    async runs() {
      return rows<ProspectRun>(
        await from("prospect_runs")
          .select(
            "id, search_id, status, stop_reason, target_count, search_rounds, searches_used, cost_micros, created_at, finished_at, source, contact_phase",
          )
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(10),
      );
    },
    async prospects(searchId: string) {
      return rows<Prospect>(
        await from("prospects")
          .select(PROSPECT_COLUMNS)
          .eq("workspace_id", workspaceId)
          .eq("search_id", searchId)
          .order("created_at", { ascending: false })
          .limit(300),
      );
    },
    /** Kept prospects with an email, for counting what still needs a draft. */
    async keptWithEmail() {
      return rows<{ id: string }>(
        await from("prospects")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("decision", "kept")
          .eq("research_status", "found")
          .not("email", "is", null)
          .limit(1000),
      );
    },
    async drafts() {
      return rows<DraftWithProspect>(
        await from("outbound_drafts")
          .select(
            `${DRAFT_COLUMNS}, prospect:prospects(id, company_name, website, contact_name, search_id)`,
          )
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(500),
      );
    },
    async suppressions() {
      return rows<Suppression>(
        await from("outbound_suppressions")
          .select("id, kind, value, note, created_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(1000),
      );
    },
    async usageToday(): Promise<Usage> {
      const day = new Date().toISOString().slice(0, 10);
      const [row] = rows<Usage>(
        await from("outbound_usage")
          .select("runs, searches, suggestions, drafts, cost_micros")
          .eq("workspace_id", workspaceId)
          .eq("day", day),
      );
      return (
        row ?? {
          runs: 0,
          searches: 0,
          suggestions: 0,
          drafts: 0,
          cost_micros: 0,
        }
      );
    },
  };
}
