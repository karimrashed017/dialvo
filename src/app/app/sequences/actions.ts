"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";

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
