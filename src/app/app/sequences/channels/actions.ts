"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import {
  LINKEDIN_MAX_CHARS,
  MAX_DAY_OFFSET,
  MAX_STEPS,
  SMS_MAX_CHARS,
  STEP_CHANNELS,
  type StepChannel,
} from "@/lib/channels/config";
import { isUuid } from "@/lib/leads/fields";

// Steps on other channels in every sequence: owners and admins add and
// remove them; anyone on the team finishes a task.

export async function saveStep(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const channel = String(form.get("channel") ?? "") as StepChannel;
      if (!STEP_CHANNELS.includes(channel))
        throw new ActionProblem("Choose a channel.", "channel");
      const appliesTo =
        form.get("applies_to") === "nurture" ? "nurture" : "sequences";
      const day = Number(form.get("day_offset"));
      if (!Number.isInteger(day) || day < 0 || day > MAX_DAY_OFFSET)
        throw new ActionProblem(
          `Use a day from 0 to ${MAX_DAY_OFFSET}.`,
          "day_offset",
        );
      const message = String(form.get("message") ?? "").trim();
      const note = String(form.get("note") ?? "")
        .trim()
        .slice(0, 500);
      if (channel === "sms" && (!message || message.length > SMS_MAX_CHARS))
        throw new ActionProblem(
          `Write the text, up to ${SMS_MAX_CHARS} characters.`,
          "message",
        );
      if (
        channel === "linkedin" &&
        (!message || message.length > LINKEDIN_MAX_CHARS)
      )
        throw new ActionProblem(
          `Write the message, up to ${LINKEDIN_MAX_CHARS} characters.`,
          "message",
        );
      if (channel === "call_task" && !note)
        throw new ActionProblem("Say what the call is about.", "note");
      if (/https?:\/\//i.test(message) && channel === "sms")
        throw new ActionProblem(
          "Leave links out of texts: carriers filter them, and STOP wording is added for you.",
          "message",
        );
      const { error } = await supabase.rpc("channel_step_save", {
        p_workspace_id: workspace.id,
        p_step_id: isUuid(form.get("step")) ? form.get("step") : null,
        p_applies_to: appliesTo,
        p_channel: channel,
        p_day_offset: day,
        p_message: channel === "call_task" ? "" : message,
        p_note: note,
        p_max_steps: MAX_STEPS,
      });
      if (error?.code === "DV429")
        throw new ActionProblem(
          `A workspace can have ${MAX_STEPS} extra steps.`,
        );
      mustSucceed({ error }, "save step");
      refresh();
      return {
        ok: true,
        message: "Saved. It applies to sequences that start from now on.",
      };
    },
    { admin: true },
  );
}

export async function removeStep(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase }) => {
      const id = form.get("step");
      if (!isUuid(id)) throw new ActionProblem("That step doesn't exist.");
      const { data, error } = await supabase.rpc("channel_step_remove", {
        p_step_id: id,
      });
      mustSucceed({ error }, "remove step");
      if (!data) throw new ActionProblem("That step doesn't exist.");
      refresh();
      return { ok: true };
    },
    { admin: true },
  );
}

export async function finishTask(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const id = form.get("run");
    const outcome = String(form.get("outcome") ?? "");
    if (!isUuid(id) || !["done", "replied", "skipped"].includes(outcome))
      throw new ActionProblem("That task doesn't exist.");
    const { data, error } = await supabase.rpc("channel_task_done", {
      p_run_id: id,
      p_outcome: outcome,
    });
    mustSucceed({ error }, "finish task");
    if (!data) throw new ActionProblem("That task is already done.");
    refresh();
    return { ok: true };
  });
}
