"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { AUDIENCES_MAX } from "@/lib/audiences/config";
import { cleanText, isUuid } from "@/lib/leads/fields";

// Ad audiences: saving and deleting (any member; row-level security keeps
// them in the workspace).

const STATUSES = [
  "new",
  "engaged",
  "qualified",
  "meeting_booked",
  "won",
  "lost",
];
const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((x) => x.slice(0, 80));

export async function saveAudience(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, user, workspace }) => {
    const name = cleanText(form.get("name"), 80);
    if (!name) throw new ActionProblem("Give the audience a name.", "name");
    const kind = String(form.get("kind"));
    if (!["contacts", "companies", "suppression"].includes(kind))
      throw new ActionProblem("Choose what the audience holds.");
    const filters: Record<string, unknown> = {};
    if (kind === "suppression")
      filters.preset =
        form.get("preset") === "customers" ? "customers" : "do_not_contact";
    else {
      const statuses = form
        .getAll("statuses")
        .map(String)
        .filter((s) => STATUSES.includes(s));
      if (statuses.length) filters.statuses = statuses;
      const sources = list(form.get("sources"));
      if (sources.length) filters.sources = sources;
      const countries = list(form.get("countries"));
      if (countries.length) filters.countries = countries;
      const days = Number(form.get("added_within_days"));
      if (Number.isInteger(days) && days > 0 && days <= 3650)
        filters.added_within_days = days;
      const owner = form.get("owner_id");
      if (isUuid(owner)) filters.owner_id = owner;
      const play = form.get("campaign_id");
      if (isUuid(play)) filters.campaign_id = play;
      if (form.get("include_customers") === "on")
        filters.include_customers = true;
    }
    const { count } = await supabase
      .from("ad_audiences")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id);
    if ((count ?? 0) >= AUDIENCES_MAX)
      throw new ActionProblem(
        `A workspace can save ${AUDIENCES_MAX} audiences. Delete one first.`,
      );
    const { error } = await supabase.from("ad_audiences").insert({
      workspace_id: workspace.id,
      name,
      kind,
      filters,
      created_by: user.id,
    });
    mustSucceed({ error }, "save audience");
    refresh();
    return {
      ok: true,
      message: "Saved. Download it below in the format your ad platform takes.",
    };
  });
}

export async function deleteAudience(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("audience");
    if (!isUuid(id)) throw new ActionProblem("That audience doesn't exist.");
    const { error } = await supabase
      .from("ad_audiences")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("id", id);
    mustSucceed({ error }, "delete audience");
    refresh();
    return { ok: true };
  });
}
