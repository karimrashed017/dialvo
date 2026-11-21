"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { ANSWER_TYPES, readOptions } from "@/lib/data/answers";
import { RECIPES_MAX } from "@/lib/data/config";
import { cleanLongText, cleanText, isUuid } from "@/lib/leads/fields";

// Saved recipes: a research question (or a 0-100 score) kept by name, to add
// to any list, a sourcing schedule, lead scoring, audiences and playbooks.

export async function saveRecipe(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("id");
    const name = cleanText(form.get("name"), 60);
    const question = cleanLongText(form.get("question"), 600);
    const type = String(form.get("answer_type") ?? "");
    if (!name) throw new ActionProblem("Give the recipe a name.", "name");
    if (question.length < 5)
      throw new ActionProblem("Write the question in a sentence.", "question");
    if (!(ANSWER_TYPES as readonly string[]).includes(type))
      throw new ActionProblem(
        "Choose what kind of answer you want.",
        "answer_type",
      );
    const options =
      type === "pick_one" ? readOptions(String(form.get("options") ?? "")) : [];
    if (type === "pick_one" && options.length < 2)
      throw new ActionProblem(
        "Give two to eight options, separated by commas.",
        "options",
      );
    const { error } = await supabase.rpc("data_recipe_save", {
      p_workspace_id: workspace.id,
      p_id: isUuid(id) ? id : null,
      p_name: name,
      p_applies_to:
        form.get("applies_to") === "people" ? "people" : "companies",
      p_question: question,
      p_answer_type: type,
      p_options: options,
      p_max: RECIPES_MAX,
    });
    if (error?.code === "P0001")
      throw new ActionProblem(
        `This workspace has ${RECIPES_MAX} recipes. Remove one first.`,
      );
    mustSucceed({ error }, "save recipe");
    refresh();
    return {
      ok: true,
      message: isUuid(id)
        ? "Saved. Columns made from it keep the question they were made with."
        : "Recipe saved.",
    };
  });
}

export async function archiveRecipe(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("id");
    if (!isUuid(id)) throw new ActionProblem("That recipe doesn't exist.");
    const { error } = await supabase.rpc("data_recipe_archive", {
      p_workspace_id: workspace.id,
      p_id: id,
    });
    mustSucceed({ error }, "archive recipe");
    refresh();
    return {
      ok: true,
      message: "Removed. Answers already given stay on their lists.",
    };
  });
}
