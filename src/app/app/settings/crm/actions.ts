"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { connectCrm } from "@/lib/crm/connect";
import { realHttpDeps } from "@/lib/crm/http";
import { crmRuntimeStatus } from "@/lib/crm/runtime";
import { pushStep } from "@/lib/crm/steps";
import { createCrmStore } from "@/lib/crm/store";
import { isUuid } from "@/lib/leads/fields";

// CRM sync's settings. All of it is for owners and admins; the database's
// functions and policies check the same again. The token goes from the form
// to the CRM (to check it) and to Vault, and nowhere else: it is not
// logged, not put in a message and never sent back to the browser.

const admin = { admin: true } as const;
const NOT_ON =
  "CRM sync isn't switched on yet on Dialvo's side. Nothing was saved.";

export async function connectAction(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    const store = crmRuntimeStatus().on ? createCrmStore() : null;
    if (!store) throw new ActionProblem(NOT_ON);
    const result = await connectCrm(
      {
        workspaceId: workspace.id,
        userId: user.id,
        provider: form.get("provider"),
        token: form.get("token"),
        domain: form.get("domain"),
      },
      { store, http: realHttpDeps() },
    );
    if (!result.ok) throw new ActionProblem(result.message, result.field);
    refresh();
    return {
      ok: true,
      message: `Connected to ${result.label}. Dialvo is importing your contacts now; new leads and conversations will appear in your CRM within a few minutes.`,
    };
  }, admin);
}

export async function disconnectAction(): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const { data, error } = await supabase.rpc("crm_disconnect", {
      p_workspace_id: workspace.id,
    });
    mustSucceed({ error }, "crm disconnect");
    if (!data) throw new ActionProblem("You don't have permission to do that.");
    refresh();
    return { ok: true, message: "Disconnected. The token has been deleted." };
  }, admin);
}

export async function retryAction(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const jobId = form.get("job_id");
    const { data, error } = await supabase.rpc("crm_retry_jobs", {
      p_workspace_id: workspace.id,
      p_job_id: isUuid(jobId) ? jobId : null,
    });
    mustSucceed({ error }, "crm retry");
    refresh();
    const n = Number(data ?? 0);
    return {
      ok: true,
      message:
        n === 0
          ? "Nothing to retry."
          : `${n} ${n === 1 ? "item goes" : "items go"} back in the queue.`,
    };
  }, admin);
}

export async function pullNowAction(): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const { data, error } = await supabase.rpc("crm_pull_now", {
      p_workspace_id: workspace.id,
    });
    mustSucceed({ error }, "crm pull now");
    refresh();
    return {
      ok: true,
      message: data
        ? "Your CRM's contacts will be imported again in the next few minutes."
        : "An import is already waiting or under way.",
    };
  }, admin);
}

/** Writes what is waiting now, for this workspace only. */
export async function syncNowAction(): Promise<ActionResult> {
  return inWorkspace(async ({ workspace }) => {
    const store = crmRuntimeStatus().on ? createCrmStore() : null;
    if (!store) throw new ActionProblem(NOT_ON);
    const r = await pushStep(
      { store, http: realHttpDeps() },
      { workspaceId: workspace.id },
    );
    refresh();
    if (r.claimed === 0) return { ok: true, message: "Nothing is waiting." };
    return {
      ok: true,
      message: `${r.done} written to your CRM${r.retried ? `, ${r.retried} will be tried again` : ""}${r.failed ? `, ${r.failed} failed` : ""}${r.skipped ? `, ${r.skipped} skipped` : ""}.`,
    };
  }, admin);
}

const SKIP_RULES = ["any_contact", "customers_and_open_deals"];
const DEAL_TRIGGERS = ["off", "qualified", "meeting_booked"];
const CRM_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function saveSettingsAction(
  form: FormData,
): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const skipRule = String(form.get("skip_rule") ?? "");
    const dealTrigger = String(form.get("deal_trigger") ?? "off");
    if (!SKIP_RULES.includes(skipRule) || !DEAL_TRIGGERS.includes(dealTrigger))
      throw new ActionProblem("Choose one of the options.");
    const update: Record<string, string | null> = {
      skip_rule: skipRule,
      deal_trigger: dealTrigger,
    };
    const stage = String(form.get("deal_stage") ?? "");
    if (stage) {
      const [pipelineId, stageId] = stage.split("::");
      if (!CRM_ID.test(pipelineId ?? "") || (stageId && !CRM_ID.test(stageId)))
        throw new ActionProblem("Choose a pipeline and stage from the list.");
      update.deal_pipeline_id = pipelineId;
      update.deal_stage_id = stageId || null;
    } else if (dealTrigger !== "off")
      throw new ActionProblem(
        "Choose the pipeline and stage new deals go in.",
        "deal_stage",
      );
    const { data, error } = await supabase
      .from("crm_connections")
      .update(update)
      .eq("workspace_id", workspace.id)
      .select("id");
    mustSucceed({ error }, "crm settings");
    if (!data?.length)
      throw new ActionProblem("You don't have permission to do that.");
    refresh();
    return { ok: true, message: "Saved." };
  }, admin);
}
