"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import {
  AUDIENCE_MAX_LEADS,
  AUDIENCES_MAX,
  SEND_TO_PLAY_MAX,
} from "@/lib/data/config";
import { readFilters } from "@/lib/data/filters";
import { createDataStore } from "@/lib/data/store";
import { cleanText, isUuid } from "@/lib/leads/fields";

// Saved audiences: filters over the leads, evaluated whenever they are used,
// so an audience is always up to date. Any member may save one.

export async function saveAudience(form: FormData): Promise<ActionResult> {
  let made: string | null = null;
  const result = await inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("id");
    const name = cleanText(form.get("name"), 80);
    if (!name) throw new ActionProblem("Give the audience a name.", "name");
    const filters = readFilters(form);
    delete filters.audience_id;
    if (
      filters.size_min &&
      filters.size_max &&
      filters.size_min > filters.size_max
    )
      throw new ActionProblem(
        "The smallest size has to be under the largest.",
        "size_min",
      );
    const { data, error } = await supabase.rpc("audience_save", {
      p_workspace_id: workspace.id,
      p_id: isUuid(id) ? id : null,
      p_name: name,
      p_filters: filters,
      p_max: AUDIENCES_MAX,
    });
    if (error?.code === "P0001")
      throw new ActionProblem(
        `This workspace has ${AUDIENCES_MAX} audiences. Remove one first.`,
      );
    if (error?.code === "22023")
      throw new ActionProblem("Some of those filters are out of range.");
    mustSucceed({ error }, "save audience");
    if (!isUuid(id)) made = data as string;
    refresh();
    return { ok: true, message: "Saved." };
  });
  if (made) redirect(`/app/leads/audiences/${made}`);
  return result;
}

export async function archiveAudience(form: FormData): Promise<ActionResult> {
  const result = await inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("id");
    if (!isUuid(id)) throw new ActionProblem("That audience doesn't exist.");
    const { error } = await supabase.rpc("audience_archive", {
      p_workspace_id: workspace.id,
      p_id: id,
    });
    mustSucceed({ error }, "archive audience");
  });
  if (result.ok) redirect("/app/leads/audiences");
  return result;
}

export async function audienceToPlaybook(
  form: FormData,
): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const id = form.get("id");
    const playbook = form.get("playbook");
    if (!isUuid(id)) throw new ActionProblem("That audience doesn't exist.");
    if (!isUuid(playbook))
      throw new ActionProblem("Choose a playbook.", "playbook");
    const { data, error } = await supabase.rpc("audience_lead_ids", {
      p_workspace_id: workspace.id,
      p_audience_id: id,
      p_filters: null,
      p_limit: AUDIENCE_MAX_LEADS,
    });
    mustSucceed({ error }, "audience leads");
    const ids = (data as string[] | null) ?? [];
    if (ids.length === 0)
      throw new ActionProblem("Nobody is in this audience right now.");
    const store = createDataStore();
    if (!store)
      throw new ActionProblem("This isn't switched on yet on Dialvo's side.");
    const started = await store.startPlaybookFor({
      workspaceId: workspace.id,
      userId: user.id,
      playbookId: playbook,
      leadIds: ids,
      limit: SEND_TO_PLAY_MAX,
      label: cleanText(form.get("name"), 40) || "an audience",
    });
    refresh();
    if (started.status === "not_found")
      throw new ActionProblem("That playbook doesn't exist.");
    if (started.status === "empty")
      return {
        ok: false,
        message:
          "The playbook's rules leave out everyone in this audience right now (no email, already in a sequence, on your never-contact list, or outside its own filters).",
      };
    return {
      ok: true,
      message: `Started with ${started.selected} ${started.selected === 1 ? "lead" : "leads"} (at most ${SEND_TO_PLAY_MAX} at a time). Their first emails are written under Plays, Your playbooks.`,
    };
  });
}
