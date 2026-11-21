"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanText, isUuid } from "@/lib/leads/fields";
import { isLanguage } from "@/lib/mail/languages";
import { readSteps } from "@/lib/sequences/steps";

/** The sequence editor: follow-ups, the gaps between them, and approval. */
export async function saveSequence(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const count = Number(form.get("count"));
      const first = Number(form.get("first_days"));
      const second = Number(form.get("second_days"));
      if (![0, 1, 2].includes(count))
        throw new ActionProblem("Choose none, one or two follow-ups.", "count");
      if (!Number.isInteger(first) || first < 1 || first > 30)
        throw new ActionProblem(
          "The first follow-up goes 1 to 30 days after the first email.",
          "first_days",
        );
      if (!Number.isInteger(second) || second <= first || second > 60)
        throw new ActionProblem(
          "The second follow-up has to come after the first, at most 60 days after the first email.",
          "second_days",
        );
      const approval =
        form.get("approval") === "auto" ? "auto" : "approve_first";
      const { error } = await supabase.rpc("sequence_settings_save", {
        p_workspace_id: workspace.id,
        p_count: count,
        p_first_days: first,
        p_second_days: second,
        p_approval: approval,
      });
      mustSucceed({ error }, "save sequence");
      refresh();
      return {
        ok: true,
        message:
          "Saved. New follow-ups follow these settings; ones already written keep their date.",
      };
    },
    { admin: true },
  );
}

// --- Sequences the team builds ------------------------------------------------------

const SEQUENCE_ERRORS: Record<string, string> = {
  P0001:
    "This workspace has as many sequences as it may keep. Archive one first.",
  P0002: "That sequence doesn't exist any more.",
  "22023": "Some of those settings are out of range.",
};

/** Saves a sequence: its name, language, approval and steps. */
export async function saveSequenceSteps(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("id");
      const name = cleanText(form.get("name"), 80);
      if (!name) throw new ActionProblem("Give the sequence a name.", "name");
      const language = String(form.get("language") ?? "auto");
      if (!isLanguage(language))
        throw new ActionProblem("Choose a language.", "language");
      const approval =
        form.get("approval") === "auto" ? "auto" : "approve_first";
      const read = readSteps(form.get("steps"));
      if (!read.ok) throw new ActionProblem(read.error, "steps");
      const { error } = await supabase.rpc("sequence_save", {
        p_workspace_id: workspace.id,
        p_id: isUuid(id) ? id : null,
        p_name: name,
        p_language: language,
        p_approval: approval,
        p_steps: read.steps,
        p_default: form.get("is_default") === "on",
      });
      if (error?.code && SEQUENCE_ERRORS[error.code])
        throw new ActionProblem(SEQUENCE_ERRORS[error.code]);
      mustSucceed({ error }, "save sequence steps");
      refresh();
      return {
        ok: true,
        message: isUuid(id)
          ? "Saved. Follow-ups not written yet follow these steps."
          : "Sequence added. Choose it for a play, a playbook or a Find leads search.",
      };
    },
    { admin: true },
  );
}

export async function archiveSequence(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = form.get("id");
      if (!isUuid(id)) throw new ActionProblem("That sequence doesn't exist.");
      const { error } = await supabase.rpc("sequence_archive", {
        p_workspace_id: workspace.id,
        p_id: id,
      });
      if (error?.code === "P0002")
        throw new ActionProblem(SEQUENCE_ERRORS.P0002);
      mustSucceed({ error }, "archive sequence");
      refresh();
      return {
        ok: true,
        message:
          "Archived. Threads already on it finish their steps; nothing new starts it.",
      };
    },
    { admin: true },
  );
}

/** Which sequence a Find leads search's first emails start. */
export async function setSearchSequence(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const search = form.get("search");
    const sequence = form.get("sequence");
    if (!isUuid(search)) throw new ActionProblem("That search doesn't exist.");
    const { error, count } = await supabase
      .from("prospect_searches")
      .update(
        { sequence_id: isUuid(sequence) ? sequence : null },
        {
          count: "exact",
        },
      )
      .eq("workspace_id", workspace.id)
      .eq("id", search);
    mustSucceed({ error }, "set search sequence");
    if (!count) throw new ActionProblem("That search doesn't exist.");
    refresh();
    return {
      ok: true,
      message: "First emails written from now on start this sequence.",
    };
  });
}
