"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanLongText, cleanText, isUuid } from "@/lib/leads/fields";

// Agent settings. Owners and admins only (the database says the same). The
// inbound agent on the chat channel acts on them (src/lib/agents), and the
// outbound agent's instructions shape the first emails (src/lib/prospects).
// Each action changes only the fields its own form shows, so the rest of an
// agent's row (channel, send window, voice) is left exactly as it was.

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

/** Website chat: how the inbound agent answers. */
export async function updateChatAgent(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = agentId(form);
      const name = cleanText(form.get("name"), 80);
      if (!name) throw new ActionProblem("Give the agent a name.", "name");
      mustSucceed(
        await supabase
          .from("agents")
          .update({
            name,
            instructions: cleanLongText(form.get("instructions"), 20000),
            qualifying_questions: cleanLongText(
              form.get("qualifying_questions"),
              4000,
            ),
            approval_mode:
              form.get("approval_mode") === "auto" ? "auto" : "approve_first",
          })
          .eq("workspace_id", workspace.id)
          .eq("id", id)
          .eq("role", "inbound"),
        "update agent",
      );
      refresh();
      return { ok: true, message: "Saved." };
    },
    { admin: true },
  );
}

/** Find leads: what the outbound agent is told when it writes a first email. */
export async function updateEmailInstructions(
  form: FormData,
): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const id = agentId(form);
      mustSucceed(
        await supabase
          .from("agents")
          .update({
            instructions: cleanLongText(form.get("instructions"), 20000),
          })
          .eq("workspace_id", workspace.id)
          .eq("id", id)
          .eq("role", "outbound"),
        "update agent",
      );
      refresh();
      return {
        ok: true,
        message: "Saved. Emails written from now on follow these.",
      };
    },
    { admin: true },
  );
}
