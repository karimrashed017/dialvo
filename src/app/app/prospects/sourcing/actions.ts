"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { LIST_COLUMNS_MAX, LISTS_MAX, SOURCING_MAX } from "@/lib/data/config";
import { cleanText, isUuid } from "@/lib/leads/fields";

// Always-on sourcing: a saved Find leads search on a schedule, filling a
// list. Saved by an owner or admin (it runs as them and spends Find leads'
// daily allowance).

export async function saveSchedule(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("id");
      const search = form.get("search_id");
      if (!isUuid(search))
        throw new ActionProblem("Choose a saved search.", "search_id");
      let list = form.get("list_id");
      if (!isUuid(list)) {
        const name = cleanText(form.get("new_list"), 80) || "New companies";
        const { data, error } = await supabase.rpc("data_list_save", {
          p_workspace_id: workspace.id,
          p_id: null,
          p_name: name,
          p_kind: "companies",
          p_source: "sourcing",
          p_target: false,
          p_max: LISTS_MAX,
        });
        if (error?.code === "P0001")
          throw new ActionProblem(`This workspace has ${LISTS_MAX} lists.`);
        mustSucceed({ error }, "sourcing list");
        list = data as string;
      }
      const recipe = form.get("recipe_id");
      const every = Number(form.get("every_days") ?? 7);
      if (!Number.isInteger(every) || every < 1 || every > 90)
        throw new ActionProblem("Run it every 1 to 90 days.", "every_days");
      const { error } = await supabase.rpc("sourcing_save", {
        p_workspace_id: workspace.id,
        p_id: isUuid(id) ? id : null,
        p_search_id: search,
        p_list_id: list,
        p_recipe_id: isUuid(recipe) ? recipe : null,
        p_every_days: every,
        p_enabled: form.get("enabled") === "on",
        p_max: SOURCING_MAX,
      });
      if (error?.code === "P0001")
        throw new ActionProblem(
          `A workspace can have ${SOURCING_MAX} schedules.`,
        );
      if (error?.code === "P0002")
        throw new ActionProblem(
          "That search, list or recipe doesn't exist (the list must be of companies).",
        );
      mustSucceed({ error }, "save schedule");
      // The recipe is answered in its own column on the list.
      if (isUuid(recipe)) {
        const { data: has } = await supabase
          .from("data_list_columns")
          .select("id")
          .eq("workspace_id", workspace.id)
          .eq("list_id", list)
          .eq("recipe_id", recipe)
          .limit(1);
        if (!has?.length) {
          const { error: colError } = await supabase.rpc("data_column_save", {
            p_workspace_id: workspace.id,
            p_list_id: list,
            p_id: null,
            p_name: "",
            p_kind: "research",
            p_question: null,
            p_answer_type: null,
            p_options: [],
            p_data_field: null,
            p_recipe_id: recipe,
            p_max: LIST_COLUMNS_MAX,
          });
          mustSucceed({ error: colError }, "recipe column");
        }
      }
      refresh();
      return { ok: true, message: "Saved. It runs on its own from now on." };
    },
    { admin: true },
  );
}

export async function deleteSchedule(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("id");
      if (!isUuid(id)) throw new ActionProblem("That schedule doesn't exist.");
      const { error } = await supabase.rpc("sourcing_delete", {
        p_workspace_id: workspace.id,
        p_id: id,
      });
      mustSucceed({ error }, "delete schedule");
      refresh();
      return { ok: true, message: "Removed. The list keeps what it found." };
    },
    { admin: true },
  );
}
