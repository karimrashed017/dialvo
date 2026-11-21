"use server";

import { createHash, randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { requestOrigin } from "@/lib/auth/origin";
import { isUuid, normalizeEmail } from "@/lib/leads/fields";
import { WORKFLOWS_MAX } from "@/lib/workflows/config";
import { checkWorkflow } from "@/lib/workflows/types";

// Workflows: saving (owners and admins; the database checks the same again),
// switching on and off, the inbound webhook address, "Run now", and tasks.

const admin = { admin: true } as const;

export async function saveWorkflow(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(String(form.get("workflow") ?? "{}"));
    } catch {
      throw new ActionProblem(
        "That couldn't be read. Reload the page and try again.",
      );
    }
    const checked = checkWorkflow({
      name: raw.name,
      trigger: raw.trigger,
      trigger_config: raw.trigger_config,
      conditions: raw.conditions,
      steps: raw.steps,
    });
    if (!checked.ok) throw new ActionProblem(checked.error);
    const id = isUuid(form.get("id")) ? String(form.get("id")) : null;
    const { data, error } = await supabase.rpc("workflow_save", {
      p_workspace_id: workspace.id,
      p_id: id,
      p_name: checked.workflow.name,
      p_trigger: checked.workflow.trigger,
      p_trigger_config: checked.workflow.trigger_config,
      p_conditions: checked.workflow.conditions,
      p_steps: checked.workflow.steps,
      p_enabled: form.get("enabled") === "on",
      p_max: WORKFLOWS_MAX,
    });
    mustSucceed({ error }, "save workflow");
    const r = data as { status: string; id?: string };
    if (r.status === "capped")
      throw new ActionProblem(
        `A workspace can have ${WORKFLOWS_MAX} workflows. Delete one first.`,
      );
    if (r.status !== "saved" || !r.id)
      throw new ActionProblem("That couldn't be saved.");
    refresh();
    if (!id) redirect(`/app/workflows/${r.id}`);
    return { ok: true, message: "Saved." };
  }, admin);
}

export async function setWorkflowEnabled(
  form: FormData,
): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("id");
    if (!isUuid(id)) throw new ActionProblem("That workflow doesn't exist.");
    const { data, error } = await supabase.rpc("workflow_set_enabled", {
      p_workspace_id: workspace.id,
      p_id: id,
      p_enabled: form.get("enabled") === "true",
    });
    mustSucceed({ error }, "enable workflow");
    if (!data) throw new ActionProblem("That workflow doesn't exist.");
    refresh();
    return { ok: true };
  }, admin);
}

export async function deleteWorkflow(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("id");
    if (!isUuid(id)) throw new ActionProblem("That workflow doesn't exist.");
    const { error } = await supabase.rpc("workflow_delete", {
      p_workspace_id: workspace.id,
      p_id: id,
    });
    mustSucceed({ error }, "delete workflow");
    redirect("/app/workflows");
  }, admin);
}

export async function makeWorkflowHook(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("id");
    if (!isUuid(id)) throw new ActionProblem("That workflow doesn't exist.");
    const token = `dvw_${randomBytes(30).toString("base64url")}`;
    const { data, error } = await supabase.rpc("workflow_hook_set", {
      p_workspace_id: workspace.id,
      p_id: id,
      p_hash: createHash("sha256").update(token).digest("hex"),
      p_prefix: token.slice(0, 12),
    });
    mustSucceed({ error }, "workflow hook");
    if (!data)
      throw new ActionProblem(
        "Save the workflow with the webhook trigger first.",
      );
    refresh();
    // Shown once, here: only its hash is kept.
    return {
      ok: true,
      message: `${await requestOrigin()}/api/workflows/hook/${token}`,
      field: "key",
    };
  }, admin);
}

export async function runWorkflowNow(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("id");
    if (!isUuid(id)) throw new ActionProblem("That workflow doesn't exist.");
    let lead: string | null = null;
    const email = String(form.get("email") ?? "").trim();
    if (email) {
      const e = normalizeEmail(email);
      if (!e) throw new ActionProblem("That isn't an email address.", "email");
      const { data } = await supabase
        .from("leads")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("email", e)
        .maybeSingle();
      if (!data) throw new ActionProblem("No lead has that email.", "email");
      lead = (data as { id: string }).id;
    }
    const { data, error } = await supabase.rpc("workflow_run_now", {
      p_workspace_id: workspace.id,
      p_id: id,
      p_lead_id: lead,
    });
    mustSucceed({ error }, "run workflow");
    const r = data as { status: string };
    if (r.status === "off")
      throw new ActionProblem("Switch the workflow on first.");
    if (r.status === "capped")
      throw new ActionProblem("Today's workflow runs are used up.");
    if (r.status !== "queued")
      throw new ActionProblem("That workflow doesn't exist.");
    refresh();
    return {
      ok: true,
      message:
        "Queued. It runs within a minute; the log below shows what happened.",
    };
  }, admin);
}

export async function setTaskDone(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const id = form.get("task");
    if (!isUuid(id)) throw new ActionProblem("That task doesn't exist.");
    const { error } = await supabase.rpc("workflow_task_set", {
      p_task_id: id,
      p_done: form.get("done") === "true",
    });
    mustSucceed({ error }, "task");
    refresh();
    return { ok: true };
  });
}
