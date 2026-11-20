import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Supabase } from "@/lib/supabase/server";
import { prospectRuntimeStatus } from "./config";
import {
  briefKey,
  cleanTitles,
  sellsFromKnowledge,
  writeContactQuery,
  type ContactQuery,
} from "./contact-query";
import { createContactStore } from "./contact-store";
import { spendOf } from "./model";
import { createProspectStore, type StartResult } from "./store";
import type { Brief } from "./types";

// The "Search details" of a saved search: the contact database's query and
// job titles, written from the search and kept on it, so the team sees
// (and can change) exactly what a run will ask for. Read and written as the
// signed-in person, under row-level security.

type SearchRow = Brief & {
  id: string;
  contact_query: string;
  contact_titles: unknown;
  contact_query_for: string;
  contact_query_edited: boolean;
};

const COLUMNS =
  "id, description, location, company_size, exclusions, contact_query, contact_titles, contact_query_for, contact_query_edited";

async function readSearch(
  supabase: Supabase,
  workspaceId: string,
  searchId: string,
): Promise<SearchRow | null> {
  const { data, error } = await supabase
    .from("prospect_searches")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", searchId)
    .maybeSingle();
  if (error) throw new Error(`read search: ${error.message}`);
  return (data as SearchRow | null) ?? null;
}

/** What the workspace sells, in a line, from its own Knowledge. */
async function sells(supabase: Supabase, workspaceId: string): Promise<string> {
  const { data, error } = await supabase
    .from("knowledge_items")
    .select("title, content, source_url, kind")
    .eq("workspace_id", workspaceId)
    .eq("status", "ready")
    .order("created_at")
    .limit(20);
  if (error) return "";
  return sellsFromKnowledge(
    (
      (data ?? []) as {
        title: string;
        content: string;
        source_url: string | null;
        kind: string;
      }[]
    ).filter((k) => k.kind === "text" || k.source_url),
  );
}

/**
 * Writes the query and titles for a search and saves them on it. One model
 * call (its estimated cost goes on the day's spend), or the plain version
 * when the model isn't available.
 */
export async function rewriteContactQuery(
  supabase: Supabase,
  workspaceId: string,
  searchId: string,
): Promise<ContactQuery | null> {
  const search = await readSearch(supabase, workspaceId, searchId);
  if (!search) return null;
  const on = prospectRuntimeStatus().on;
  const written = await writeContactQuery(
    on ? new Anthropic() : null,
    { brief: search, sells: await sells(supabase, workspaceId) },
    spendOf,
  );
  if (written.spend.cost_micros > 0)
    await createProspectStore()
      ?.recordSpend(workspaceId, written.spend.cost_micros)
      .catch(() => {});
  const { error } = await supabase
    .from("prospect_searches")
    .update({
      contact_query: written.query,
      contact_titles: written.titles,
      contact_query_for: briefKey(search),
      contact_query_edited: false,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", searchId);
  if (error) throw new Error(`save contact query: ${error.message}`);
  return { query: written.query, titles: written.titles };
}

/**
 * The query and titles a run will use: the saved ones when they are still
 * for this version of the search (or a person wrote them), otherwise
 * written again first.
 */
export async function contactQueryFor(
  supabase: Supabase,
  workspaceId: string,
  searchId: string,
): Promise<ContactQuery | null> {
  const search = await readSearch(supabase, workspaceId, searchId);
  if (!search) return null;
  const titles = cleanTitles(search.contact_titles);
  if (
    search.contact_query &&
    (search.contact_query_edited ||
      search.contact_query_for === briefKey(search))
  )
    return { query: search.contact_query, titles };
  return rewriteContactQuery(supabase, workspaceId, searchId);
}

/** True when the saved query was written for an earlier version of the search. */
export function contactQueryStale(
  search: Brief & {
    contact_query: string;
    contact_query_for: string;
  },
): boolean {
  return (
    Boolean(search.contact_query) &&
    search.contact_query_for !== briefKey(search)
  );
}

/**
 * Starts a run that uses the contact database, with the search's query and
 * titles (written first if they are missing or out of date).
 */
export async function startContactRun(
  supabase: Supabase,
  workspaceId: string,
  searchId: string,
  userId: string,
): Promise<StartResult | { status: "invalid" } | null> {
  const contacts = createContactStore();
  if (!contacts) return null;
  const query = await contactQueryFor(supabase, workspaceId, searchId);
  if (!query) return { status: "not_found" };
  return contacts.startRun(workspaceId, searchId, userId, query);
}
