"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanText, isUuid } from "@/lib/leads/fields";
import {
  RETARGET_COMPANIES_MAX,
  RETARGET_LEAD_DAYS,
  RETARGET_LEADS_MAX,
  RETARGET_REPEAT_DAYS,
} from "@/lib/integrations/config";
import { DEFAULT_TITLES } from "@/lib/plays/campaign-run";
import { createPlayStore } from "@/lib/plays/store";
import {
  contactDatabaseStatus,
  prospectRuntimeStatus,
} from "@/lib/prospects/config";
import { createServiceClient } from "@/lib/supabase/service";

// Website visitors and the "Retargeting website visitors" play. Settings are
// for owners and admins; any member may start the play (like every other
// play), and every email it writes waits for a person's approval.

const NOT_ON =
  "This isn't switched on yet on Dialvo's side. Nothing was started.";

export async function saveTracking(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const paths = String(form.get("pricing_paths") ?? "")
        .split(/[\s,]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => (p.startsWith("/") ? p : `/${p}`))
        .slice(0, 10);
      if (paths.length === 0 || paths.some((p) => !/^\/[^\s?#]{0,99}$/.test(p)))
        throw new ActionProblem(
          "Give your pricing page's path, such as /pricing (up to 10, separated by commas).",
          "pricing_paths",
        );
      const consent = form.get("consent_mode") === "notice" ? "notice" : "wait";
      const { data, error } = await supabase.rpc("site_tracking_save", {
        p_workspace_id: workspace.id,
        p_enabled: form.get("enabled") === "on",
        p_consent_mode: consent,
        p_pricing_paths: paths,
        p_tag_links: form.get("tag_email_links") === "on",
      });
      mustSucceed({ error }, "save tracking");
      if (!data)
        throw new ActionProblem("You don't have permission to do that.");
      refresh();
      return { ok: true, message: "Saved." };
    },
    { admin: true },
  );
}

export async function dismissCompany(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const id = form.get("company");
    if (!isUuid(id)) throw new ActionProblem("That company doesn't exist.");
    const { error } = await supabase.rpc("site_company_dismiss", {
      p_company_id: id,
    });
    mustSucceed({ error }, "dismiss company");
    refresh();
    return { ok: true };
  });
}

export async function forgetVisitor(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase }) => {
      const id = form.get("visitor");
      if (!isUuid(id)) throw new ActionProblem("That visitor doesn't exist.");
      const { data, error } = await supabase.rpc("site_visitor_forget", {
        p_visitor_id: id,
      });
      mustSucceed({ error }, "forget visitor");
      if (!data) throw new ActionProblem("That visitor doesn't exist.");
      refresh();
      return { ok: true, message: "Deleted, with every page they read." };
    },
    { admin: true },
  );
}

/** Identified companies: find a named contact at each and draft a first email. */
export async function retargetCompanies(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    if (!prospectRuntimeStatus().on) throw new ActionProblem(NOT_ON);
    if (!contactDatabaseStatus().on)
      throw new ActionProblem(
        "Finding a contact needs the contact database, which isn't switched on yet on Dialvo's side.",
      );
    const ids = form.getAll("company").map(String).filter(isUuid);
    if (ids.length === 0) throw new ActionProblem("Tick at least one company.");
    if (ids.length > RETARGET_COMPANIES_MAX)
      throw new ActionProblem(
        `Up to ${RETARGET_COMPANIES_MAX} companies at a time.`,
      );
    const service = createServiceClient();
    const plays = createPlayStore();
    if (!service || !plays) throw new ActionProblem(NOT_ON);
    const titles = String(form.get("titles") ?? "")
      .split(/[,\n]/)
      .map((t) => cleanText(t, 60))
      .filter(Boolean)
      .slice(0, 10);
    const date = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    const { data, error } = await service.rpc("site_retarget_companies", {
      p_workspace_id: workspace.id,
      p_user_id: user.id,
      p_company_ids: ids,
      p_name: `Website visitors, ${date}`,
      p_titles: titles.length ? titles : DEFAULT_TITLES,
      p_source: "retargeting",
      p_max: RETARGET_COMPANIES_MAX,
    });
    mustSucceed({ error }, "retarget companies");
    const made = data as { status: string; campaign_id?: string };
    if (made.status !== "created" || !made.campaign_id)
      throw new ActionProblem(
        "Those companies couldn't be started. They may already be in a play.",
      );
    const started = await plays.startCampaignRun(
      workspace.id,
      made.campaign_id,
      user.id,
      2,
    );
    if (started.status === "capped")
      throw new ActionProblem(
        "Saved, but today's allowance for finding leads or contact lookups is used up. It resets at midnight UTC; open Target accounts tomorrow to continue.",
      );
    redirect(`/app/prospects/accounts?campaign=${made.campaign_id}`);
  });
}

/** Known leads who read the pricing page: a short check-in each. */
export async function retargetLeads(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ workspace, user }) => {
    if (!prospectRuntimeStatus().on) throw new ActionProblem(NOT_ON);
    const service = createServiceClient();
    if (!service) throw new ActionProblem(NOT_ON);
    const ids = form.getAll("lead").map(String).filter(isUuid);
    const { data, error } = await service.rpc("site_retarget_leads", {
      p_workspace_id: workspace.id,
      p_user_id: user.id,
      p_lead_ids: ids.length ? ids : null,
      p_days: RETARGET_LEAD_DAYS,
      p_repeat_days: RETARGET_REPEAT_DAYS,
      p_limit: RETARGET_LEADS_MAX,
    });
    mustSucceed({ error }, "retarget leads");
    const r = data as { status: string; selected?: number };
    refresh();
    if (r.status === "empty")
      return {
        ok: false,
        message: `No known lead read your pricing page in the last ${RETARGET_LEAD_DAYS} days who hasn't had this check-in in the last ${RETARGET_REPEAT_DAYS} days.`,
      };
    if (r.status !== "created")
      throw new ActionProblem("That couldn't be started.");
    return {
      ok: true,
      message: `Started for ${r.selected} ${r.selected === 1 ? "lead" : "leads"}. Write their emails on the play's page; each waits for your approval.`,
    };
  });
}
