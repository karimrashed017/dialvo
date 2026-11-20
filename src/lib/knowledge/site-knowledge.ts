import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import { readSite, siteTitle, type SiteDeps } from "./read-site";

// Reading a workspace's website into its Knowledge, and keeping the "Get
// started" checklist told about it (workspace_setup.site_status). It runs as
// the signed-in person, so row-level security applies to every write.

type Client = Pick<Supabase, "from">;

/** Marks the read as started. Call before the work is scheduled. */
export async function markSiteReading(
  supabase: Client,
  workspaceId: string,
  address: string,
) {
  const { error } = await supabase
    .from("workspace_setup")
    .update({
      site_status: "reading",
      site_url: address.slice(0, 300),
      site_started_at: new Date().toISOString(),
      site_finished_at: null,
    })
    .eq("workspace_id", workspaceId);
  if (error) console.error("[site] could not mark reading:", error.message);
}

/**
 * Reads the site and adds each page as a knowledge item (a page that is
 * already there is read again in place). Never throws: failures are quiet,
 * and the checklist offers to try again or paste text instead.
 */
export async function readSiteIntoKnowledge(
  supabase: Client,
  input: { workspaceId: string; userId: string; address: string },
  deps: Partial<SiteDeps> = {},
): Promise<{ ok: boolean; pages: number }> {
  const { workspaceId, userId, address } = input;
  const finish = async (ok: boolean, pages: number) => {
    const { error } = await supabase
      .from("workspace_setup")
      .update({
        site_status: ok ? "done" : "failed",
        site_pages: pages,
        site_finished_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId);
    if (error)
      console.error("[site] could not save the result:", error.message);
    return { ok, pages };
  };
  try {
    const site = await readSite(address, deps);
    if (!site.ok) return await finish(false, 0);

    const existing = await supabase
      .from("knowledge_items")
      .select("id, source_url")
      .eq("workspace_id", workspaceId)
      .not("source_url", "is", null)
      .limit(500);
    if (existing.error) throw new Error(existing.error.message);
    const known = new Map(
      ((existing.data ?? []) as { id: string; source_url: string }[]).map(
        (row) => [row.source_url, row.id],
      ),
    );

    let saved = 0;
    for (const page of site.pages) {
      const url = page.url.slice(0, 2000);
      const id = known.get(url);
      const { error } = id
        ? await supabase
            .from("knowledge_items")
            .update({ content: page.text, status: "ready" })
            .eq("workspace_id", workspaceId)
            .eq("id", id)
        : await supabase.from("knowledge_items").insert({
            workspace_id: workspaceId,
            title: siteTitle(page),
            kind: "url",
            content: page.text,
            status: "ready",
            source_url: url,
            created_by: userId,
          });
      if (error) console.error("[site] could not save a page:", error.message);
      else saved++;
    }
    return await finish(saved > 0, saved);
  } catch (error) {
    console.error("[site] reading failed:", (error as Error).message);
    return finish(false, 0);
  }
}
