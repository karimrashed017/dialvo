"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import {
  CalendarProblem,
  fetchCalendar,
  readFeedUrl,
} from "@/lib/briefs/calendar";
import { BRIEFS_PER_DAY } from "@/lib/briefs/config";
import { createBriefStore } from "@/lib/briefs/store";
import { isUuid } from "@/lib/leads/fields";
import { prospectRuntimeStatus } from "@/lib/prospects/config";

// Briefs: asking for one, the workspace's settings, and each person's own
// calendar address. The address goes from the form to the calendar (one
// test read) and to Vault, and nowhere else: never logged, never sent back.

const NOT_ON =
  "Briefs aren't switched on yet on Dialvo's side. Nothing was saved.";

function store() {
  const s = createBriefStore();
  if (!s) throw new ActionProblem(NOT_ON);
  return s;
}

export async function requestBrief(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    const lead = form.get("lead");
    if (!isUuid(lead)) throw new ActionProblem("That lead doesn't exist.");
    const kind = form.get("kind") === "closed_lost" ? "closed_lost" : "brief";
    const r = await store().request(
      workspace.id,
      user.id,
      lead,
      kind,
      "manual",
    );
    refresh();
    if (r.status === "capped")
      return {
        ok: false,
        message: `Today's ${BRIEFS_PER_DAY} briefs are used up. Ask again tomorrow.`,
      };
    if (r.status === "not_found")
      return { ok: false, message: "That lead doesn't exist." };
    if (!prospectRuntimeStatus().on)
      return {
        ok: true,
        message:
          "Asked for. It will be written once the research model is switched on on Dialvo's side.",
      };
    return {
      ok: true,
      message:
        r.status === "waiting"
          ? "One is already being written. It usually takes a minute or two."
          : "Asked for. It usually takes a minute or two; this page shows it when it's ready.",
    };
  });
}

export async function saveBriefSettings(form: FormData): Promise<ActionResult> {
  return inWorkspace(
    async ({ supabase, workspace }) => {
      const mode = String(form.get("mode"));
      const { data, error } = await supabase.rpc("brief_settings_save", {
        p_workspace_id: workspace.id,
        p_mode: ["before", "digest", "off"].includes(mode) ? mode : "before",
        p_minutes_before: Number(form.get("minutes_before")) || 120,
        p_digest_hour: Number(form.get("digest_hour")) || 7,
        p_email_owner: form.get("email_owner") === "on",
        p_post_slack: form.get("post_slack") === "on",
        p_closed_lost: form.get("closed_lost") === "on",
      });
      mustSucceed({ error }, "brief settings");
      if (!data)
        throw new ActionProblem(
          "Only the workspace's owner or an admin can change this.",
        );
      refresh();
      return { ok: true, message: "Saved." };
    },
    { admin: true },
  );
}

export async function saveCalendar(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    const s = store();
    const url = readFeedUrl(form.get("url"));
    if (!url)
      throw new ActionProblem(
        "Paste the calendar's secret address. It starts with https:// (or webcal://).",
        "url",
      );
    try {
      await fetchCalendar(url.toString());
    } catch (error) {
      throw new ActionProblem(
        error instanceof CalendarProblem
          ? error.message
          : "The calendar couldn't be read. Check the address.",
        "url",
      );
    }
    const status = await s.feedSave(
      workspace.id,
      user.id,
      url.toString(),
      url.hostname.toLowerCase(),
    );
    if (status !== "saved") throw new ActionProblem("That couldn't be saved.");
    refresh();
    return {
      ok: true,
      message:
        "Connected. Meetings with your leads appear within a few minutes, then every 30 minutes.",
    };
  });
}

export async function removeCalendar(): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const { data, error } = await supabase.rpc("calendar_feed_remove", {
      p_workspace_id: workspace.id,
    });
    mustSucceed({ error }, "remove calendar");
    if (!data) throw new ActionProblem("You haven't connected a calendar.");
    refresh();
    return {
      ok: true,
      message:
        "Removed. The address has been deleted; meetings already imported stay.",
    };
  });
}
