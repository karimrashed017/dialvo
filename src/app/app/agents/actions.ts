"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { CHANNELS, type Channel } from "@/lib/app/types";
import { cleanLongText, cleanText, isUuid } from "@/lib/leads/fields";

// Agent settings. Owners and admins only (the database says the same). The
// inbound agent on the chat channel acts on them (src/lib/agents); the other
// agents' settings are stored for later, and the page says so.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function agentId(form: FormData): string {
  const id = form.get("agent");
  if (!isUuid(id)) throw new ActionProblem("That agent doesn't exist.");
  return id;
}

export async function setAgentEnabled(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = agentId(form);
      mustSucceed(
        await supabase
          .from("agents")
          .update({ enabled: form.get("enabled") === "true" })
          .eq("workspace_id", workspace.id)
          .eq("id", id),
        "toggle agent",
      );
      refresh();
      return { ok: true };
    },
    { admin: true },
  );
}

export async function updateAgent(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = agentId(form);
      const name = cleanText(form.get("name"), 80);
      if (!name) throw new ActionProblem("Give the agent a name.", "name");
      const channel = form.get("channel") as Channel;
      if (!CHANNELS.includes(channel))
        throw new ActionProblem("Choose a channel.", "channel");
      const start = String(form.get("start") ?? "");
      const end = String(form.get("end") ?? "");
      if (!TIME.test(start) || !TIME.test(end))
        throw new ActionProblem("Set the hours as 09:00 to 17:00.", "start");
      if (start >= end)
        throw new ActionProblem(
          "The send window has to end after it starts.",
          "end",
        );
      const days = [
        ...new Set(
          form
            .getAll("days")
            .map(Number)
            .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
        ),
      ].sort();
      if (days.length === 0)
        throw new ActionProblem("Choose at least one day.", "days");

      mustSucceed(
        await supabase
          .from("agents")
          .update({
            name,
            channel,
            instructions: cleanLongText(form.get("instructions"), 20000),
            qualifying_questions: cleanLongText(
              form.get("qualifying_questions"),
              4000,
            ),
            voice: cleanText(form.get("voice"), 80) || null,
            approval_mode:
              form.get("approval_mode") === "auto" ? "auto" : "approve_first",
            send_window: { days, start, end },
          })
          .eq("workspace_id", workspace.id)
          .eq("id", id),
        "update agent",
      );
      refresh();
      return { ok: true, message: "Saved." };
    },
    { admin: true },
  );
}
