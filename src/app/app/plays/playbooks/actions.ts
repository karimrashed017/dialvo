"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanLongText, cleanText, isUuid } from "@/lib/leads/fields";
import { isLanguage } from "@/lib/mail/languages";
import {
  createPlaybookStore,
  LEAD_STATUSES,
  type PlaybookFilters,
} from "@/lib/plays/playbooks";
import { prospectRuntimeStatus } from "@/lib/prospects/config";
import { readFilters as readLeadFilters } from "@/lib/data/filters";

// Making, changing and running a playbook. Saving goes through
// playbook_save as the signed-in owner or admin (the database checks again);
// running goes through the secret key's playbook_start, which checks the
// person is a member and applies every play rule.

const NOT_ON =
  "This isn't switched on yet on Dialvo's side. Nothing was started.";

const days = (value: FormDataEntryValue | null, field: string) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 730)
    throw new ActionProblem("Choose a number of days from 1 to 730.", field);
  return n;
};

/** The filters from the form, in the shape the database checks. */
function readFilters(form: FormData): PlaybookFilters {
  const statuses = form
    .getAll("statuses")
    .map(String)
    .filter((s): s is (typeof LEAD_STATUSES)[number] =>
      (LEAD_STATUSES as readonly string[]).includes(s),
    );
  const sources = String(form.get("sources") ?? "")
    .split(/[,\n]/)
    .map((s) => cleanText(s, 80))
    .filter(Boolean)
    .slice(0, 10);
  // Tiers, scores, a saved audience, a list and a recipe's answer.
  const more = readLeadFilters(form);
  return {
    statuses,
    sources,
    inactive_days: days(form.get("inactive_days"), "inactive_days"),
    added_within_days: days(form.get("added_within_days"), "added_within_days"),
    ...(more.tiers ? { tiers: more.tiers } : {}),
    ...(more.min_fit != null ? { min_fit: more.min_fit } : {}),
    ...(more.min_engagement != null
      ? { min_engagement: more.min_engagement }
      : {}),
    ...(more.list_id ? { list_id: more.list_id } : {}),
    ...(more.audience_id ? { audience_id: more.audience_id } : {}),
    ...(more.recipe ? { recipe: more.recipe } : {}),
  };
}

export async function savePlaybook(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("id");
      const name = cleanText(form.get("name"), 80);
      if (!name) throw new ActionProblem("Give the playbook a name.", "name");
      const goal = cleanLongText(form.get("goal"), 1500);
      if (!goal)
        throw new ActionProblem(
          "Say what the first email is for, in a sentence or two.",
          "goal",
        );
      const filters = readFilters(form);
      const language = String(form.get("language") ?? "auto");
      if (!isLanguage(language))
        throw new ActionProblem("Choose a language.", "language");
      const sequence = form.get("sequence");
      const repeat = Number(form.get("repeat_days") ?? 90);
      if (!Number.isInteger(repeat) || repeat < 7 || repeat > 365)
        throw new ActionProblem(
          "Choose 7 to 365 days before someone can be picked again.",
          "repeat_days",
        );
      const { data, error } = await supabase.rpc("playbook_save", {
        p_workspace_id: workspace.id,
        p_id: isUuid(id) ? id : null,
        p_name: name,
        p_filters: filters,
        p_goal: goal,
        p_sequence_id: isUuid(sequence) ? sequence : null,
        p_language: language,
        p_approval: form.get("approval") === "auto" ? "auto" : "approve_first",
        p_repeat_days: repeat,
      });
      if (error?.code === "P0001")
        throw new ActionProblem(
          "This workspace has 20 playbooks. Archive one first.",
        );
      if (error?.code === "P0002")
        throw new ActionProblem("That playbook or sequence doesn't exist.");
      if (error?.code === "22023")
        throw new ActionProblem("Some of those settings are out of range.");
      mustSucceed({ error }, "save playbook");
      if (!isUuid(id)) redirect(`/app/plays/playbooks/${data as string}`);
      refresh();
      return { ok: true, message: "Saved." };
    },
    { admin: true },
  );
}

export async function archivePlaybook(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("id");
      if (!isUuid(id)) throw new ActionProblem("That playbook doesn't exist.");
      const { error } = await supabase.rpc("playbook_archive", {
        p_workspace_id: workspace.id,
        p_id: id,
      });
      mustSucceed({ error }, "archive playbook");
      redirect("/app/plays/playbooks");
    },
    { admin: true },
  );
}

export async function startPlaybook(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    const id = form.get("id");
    if (!isUuid(id)) throw new ActionProblem("That playbook doesn't exist.");
    const store = prospectRuntimeStatus().on ? createPlaybookStore() : null;
    if (!store) throw new ActionProblem(NOT_ON);
    const started = await store.start(workspace.id, user.id, id);
    refresh();
    if (started.status === "empty")
      return {
        ok: false,
        message:
          "No lead fits this playbook right now, so nothing was started. Loosen its filters or come back later.",
      };
    if (started.status !== "created")
      throw new ActionProblem("That playbook couldn't be started.");
    return {
      ok: true,
      message: `Started for ${started.selected} ${started.selected === 1 ? "lead" : "leads"}. Write their emails below.`,
    };
  });
}
