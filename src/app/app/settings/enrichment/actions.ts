"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import {
  ENRICH_CHECK_NOW_MAX,
  ENRICH_MONTHLY_CAP_MAX,
} from "@/lib/data/config";
import { enrichStep } from "@/lib/data/enrich";
import { createDataFindymail } from "@/lib/data/findymail";
import { createDataStore } from "@/lib/data/store";

// Enrichment settings, saved by an owner or admin through enrichment_save
// (the database checks again, and caps the monthly credits).

const on = (form: FormData, name: string) => form.get(name) === "on";

export async function saveEnrichment(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const days = Number(form.get("refresh_days"));
      const cap = Number(form.get("monthly_cap"));
      if (!Number.isInteger(days) || days < 7 || days > 365)
        throw new ActionProblem(
          "Check again every 7 to 365 days.",
          "refresh_days",
        );
      if (!Number.isInteger(cap) || cap < 0 || cap > ENRICH_MONTHLY_CAP_MAX)
        throw new ActionProblem(
          `The monthly cap can be 0 to ${ENRICH_MONTHLY_CAP_MAX} credits.`,
          "monthly_cap",
        );
      const { error } = await supabase.rpc("enrichment_save", {
        p_workspace_id: workspace.id,
        p_enabled: on(form, "enabled"),
        p_fill_emails: on(form, "fill_emails"),
        p_fill_titles: on(form, "fill_titles"),
        p_fill_company: on(form, "fill_company"),
        p_job_changes: on(form, "job_changes"),
        p_personal_emails: on(form, "personal_emails"),
        p_write_back: on(form, "write_back"),
        p_refresh_days: days,
        p_monthly_cap: cap,
        p_max_cap: ENRICH_MONTHLY_CAP_MAX,
      });
      if (error?.code === "22023")
        throw new ActionProblem("Some of those settings are out of range.");
      mustSucceed({ error }, "save enrichment");
      refresh();
      return {
        ok: true,
        message: on(form, "enabled")
          ? "Saved. Leads are checked in the background, a few a minute, within the monthly cap."
          : "Saved. Enrichment is off.",
      };
    },
    { admin: true },
  );
}

export async function checkNow(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const { data, error } = await supabase.rpc("enrichment_check_now", {
        p_workspace_id: workspace.id,
        p_all: form.get("all") === "on",
        p_limit: ENRICH_CHECK_NOW_MAX,
      });
      mustSucceed({ error }, "check now");
      const n = data as number;
      after(async () => {
        const store = createDataStore();
        if (store)
          await enrichStep({ store, findymail: createDataFindymail() }).catch(
            () => undefined,
          );
      });
      refresh();
      return {
        ok: true,
        message: n
          ? `${n} ${n === 1 ? "lead" : "leads"} queued. They are checked a few a minute, within the monthly cap.`
          : "Nothing to check right now (switch enrichment on first, or every lead is up to date).",
      };
    },
    { admin: true },
  );
}
