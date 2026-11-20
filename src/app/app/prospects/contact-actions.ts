"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { isUuid } from "@/lib/leads/fields";
import { createLimiter } from "@/lib/leads/rate-limit";
import { contactDatabaseStatus } from "@/lib/prospects/config";
import {
  briefKey,
  cleanQuery,
  cleanTitles,
  MAX_TIERS,
} from "@/lib/prospects/contact-query";
import { rewriteContactQuery } from "@/lib/prospects/contact-search";
import { createProspectStore } from "@/lib/prospects/store";

// "Search details": the contact database's query and job titles for a saved
// search, which the team can correct before a run. Saved as the signed-in
// person, under row-level security.

function searchId(form: FormData): string {
  const id = form.get("search");
  if (!isUuid(id)) throw new ActionProblem("Save who you sell to first.");
  return id;
}

/** Saves the query and titles as the person wrote them. */
export async function saveSearchDetails(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = searchId(form);
    const query = cleanQuery(form.get("contact_query"));
    if (query.length < 10)
      throw new ActionProblem(
        "Describe the companies to look for in a sentence.",
        "contact_query",
      );
    // One line per tier, titles separated by commas.
    const titles = cleanTitles(
      Array.from({ length: MAX_TIERS }, (_, i) =>
        String(form.get(`tier_${i + 1}`) ?? "")
          .split(",")
          .map((t) => t.trim()),
      ),
    );
    if (titles.length === 0)
      throw new ActionProblem(
        "Give at least one job title to look for.",
        "tier_1",
      );
    const { data: search, error: readError } = await supabase
      .from("prospect_searches")
      .select("description, location, company_size, exclusions")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .maybeSingle();
    mustSucceed({ error: readError }, "read search");
    if (!search) throw new ActionProblem("That search doesn't exist.");
    const { error } = await supabase
      .from("prospect_searches")
      .update({
        contact_query: query,
        contact_titles: titles,
        contact_query_for: briefKey(
          search as {
            description: string;
            location: string;
            company_size: string;
            exclusions: string;
          },
        ),
        contact_query_edited: true,
      })
      .eq("workspace_id", workspace.id)
      .eq("id", id);
    mustSucceed({ error }, "save search details");
    refresh();
    return { ok: true, message: "Saved. The next run uses these." };
  });
}

/** A couple a minute per person: each one is a model call. */
const rewriteLimit = createLimiter({ windowMs: 60_000, max: 2 });

/** Writes the query and titles again from the search's description. */
export async function rewriteSearchDetails(
  form: FormData,
): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = searchId(form);
    if (!contactDatabaseStatus().on)
      throw new ActionProblem("The contact database isn't switched on yet.");
    if (rewriteLimit.take(user.id) > 0)
      throw new ActionProblem("Give it a moment, then try again.");
    // Counted with the suggestions, against the same daily cap.
    const store = createProspectStore();
    if (store && !(await store.takeSuggestion(workspace.id, user.id)))
      throw new ActionProblem(
        "That's today's limit for writing these. You can still edit them yourself.",
      );
    const written = await rewriteContactQuery(supabase, workspace.id, id);
    if (!written) throw new ActionProblem("That search doesn't exist.");
    refresh();
    return { ok: true, message: "Written again from your description." };
  });
}
