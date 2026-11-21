"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { isUuid } from "@/lib/leads/fields";
import { NEWS_KEEP_MAX, NEWS_KINDS } from "@/lib/news/config";
import { createNewsStore } from "@/lib/news/store";
import { DEFAULT_TITLES } from "@/lib/plays/campaign-run";
import { createPlayStore } from "@/lib/plays/store";
import { contactDatabaseStatus } from "@/lib/prospects/config";

// Company news on Signals: the settings (owners and admins), dismissing, and
// keeping (onto the lead, or into a target-accounts campaign that finds a
// contact and drafts an email for approval).

export async function saveNewsSettings(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const kinds = form
        .getAll("kinds")
        .map(String)
        .filter((k) => (NEWS_KINDS as readonly string[]).includes(k));
      if (kinds.length === 0)
        throw new ActionProblem("Tick at least one kind of news.");
      const { data, error } = await supabase.rpc("news_settings_save", {
        p_workspace_id: workspace.id,
        p_enabled: form.get("enabled") === "on",
        p_track_accounts: form.get("track_accounts") === "on",
        p_track_leads: form.get("track_leads") === "on",
        p_lead_statuses: form.getAll("statuses").map(String),
        p_kinds: kinds,
      });
      mustSucceed({ error }, "news settings");
      if (!data) throw new ActionProblem("That couldn't be saved.");
      refresh();
      return {
        ok: true,
        message:
          "Saved. Companies are checked within the hour, then once a week each.",
      };
    },
    { admin: true },
  );
}

export async function dismissNews(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase }) => {
    const id = form.get("news");
    if (!isUuid(id)) throw new ActionProblem("That item doesn't exist.");
    const { error } = await supabase.rpc("news_dismiss", { p_id: id });
    mustSucceed({ error }, "dismiss news");
    refresh();
    return { ok: true };
  });
}

export async function keepNews(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    const ids = form
      .getAll("news")
      .map(String)
      .filter(isUuid)
      .slice(0, NEWS_KEEP_MAX);
    if (ids.length === 0) throw new ActionProblem("Tick at least one item.");
    const store = createNewsStore();
    if (!store)
      throw new ActionProblem(
        "Company news isn't switched on yet on Dialvo's side.",
      );
    const date = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    const r = await store.keep(
      workspace.id,
      user.id,
      ids,
      `Company news, ${date}`,
      DEFAULT_TITLES,
    );
    if (r.status !== "kept")
      throw new ActionProblem(
        "Those couldn't be kept: the companies are already yours or on your never-contact list.",
      );
    refresh();
    if (r.campaign_id) {
      const plays = createPlayStore();
      if (plays && contactDatabaseStatus().on) {
        const started = await plays.startCampaignRun(
          workspace.id,
          r.campaign_id,
          user.id,
          2,
        );
        if (started.status === "capped")
          return {
            ok: true,
            message:
              "Kept. Today's contact lookups are used up: open Target accounts tomorrow to continue.",
          };
        redirect(`/app/prospects/accounts?campaign=${r.campaign_id}`);
      }
      return {
        ok: true,
        message:
          "Kept as a target-accounts campaign. Finding a contact needs the contact database, which isn't switched on yet.",
      };
    }
    return {
      ok: true,
      message: `Kept on ${r.leads === 1 ? "the lead" : `${r.leads} leads`}: a note on the timeline and a fresh brief.`,
    };
  });
}
