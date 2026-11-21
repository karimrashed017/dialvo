"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanText } from "@/lib/leads/fields";
import { postJson } from "@/lib/integrations/post";
import {
  readSlackUrl,
  SLACK_EVENTS,
  slackMessage,
  slackRevoked,
} from "@/lib/integrations/slack";
import { deliverStep } from "@/lib/integrations/steps";
import { createIntegrationStore } from "@/lib/integrations/store";

// Settings, Slack. All of it is for owners and admins; the database checks
// the same again. The webhook URL goes from the form to Slack (a test post)
// and to Vault, and nowhere else: never logged, never sent back.

const admin = { admin: true } as const;
const NOT_ON =
  "Slack isn't switched on yet on Dialvo's side. Nothing was saved.";

function store() {
  const s = createIntegrationStore();
  if (!s) throw new ActionProblem(NOT_ON);
  return s;
}

async function testPost(url: string, workspace: string) {
  const text = slackMessage("test", {}, workspace)!;
  const r = await postJson(url, JSON.stringify({ text }), {});
  if (r.ok) return;
  if (slackRevoked(r.status, r.error))
    throw new ActionProblem(
      "Slack says that webhook doesn't exist any more (it was removed, or its channel archived). Make a new one and paste it here.",
      "url",
    );
  throw new ActionProblem(
    `Slack didn't take the test message (${r.error}). Check the address and try again.`,
    "url",
  );
}

export async function connectSlack(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    const s = store();
    const url = readSlackUrl(form.get("url"));
    if (!url)
      throw new ActionProblem(
        "Paste the whole webhook URL from Slack. It starts with https://hooks.slack.com/services/.",
        "url",
      );
    await testPost(url, workspace.name);
    const status = await s.slackConnect(
      workspace.id,
      user.id,
      url,
      cleanText(form.get("label"), 80),
    );
    if (status !== "connected")
      throw new ActionProblem("That couldn't be saved.");
    refresh();
    return {
      ok: true,
      message:
        "Connected. A test message is in your channel; alerts will follow there.",
    };
  }, admin);
}

export async function testSlack(): Promise<ActionResult> {
  return inWorkspace(async ({ workspace }) => {
    const url = await store().slackUrl(workspace.id);
    if (!url) throw new ActionProblem("Slack isn't connected.");
    await testPost(url, workspace.name);
    return { ok: true, message: "Sent. Look in your Slack channel." };
  }, admin);
}

export async function saveSlackSettings(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const events = form
      .getAll("events")
      .map(String)
      .filter((e) => (SLACK_EVENTS as readonly string[]).includes(e));
    const hour = Number(form.get("digest_hour"));
    const { data, error } = await supabase.rpc("slack_settings_save", {
      p_workspace_id: workspace.id,
      p_events: events,
      p_digest_hour:
        Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8,
    });
    mustSucceed({ error }, "slack settings");
    if (!data) throw new ActionProblem("Slack isn't connected.");
    refresh();
    return { ok: true, message: "Saved." };
  }, admin);
}

export async function disconnectSlack(): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const { data, error } = await supabase.rpc("slack_disconnect", {
      p_workspace_id: workspace.id,
    });
    mustSucceed({ error }, "slack disconnect");
    if (!data) throw new ActionProblem("You don't have permission to do that.");
    refresh();
    return {
      ok: true,
      message:
        "Disconnected. The webhook URL has been deleted from Dialvo; you can also remove it in Slack.",
    };
  }, admin);
}

/** Posts what is waiting now, for this workspace only. */
export async function sendSlackNow(): Promise<ActionResult> {
  return inWorkspace(async ({ workspace }) => {
    const r = await deliverStep(
      { store: store() },
      { workspaceId: workspace.id },
    );
    refresh();
    return {
      ok: true,
      message:
        r.claimed === 0
          ? "Nothing is waiting."
          : `${r.delivered} sent${r.retried ? `, ${r.retried} will be tried again` : ""}${r.failed ? `, ${r.failed} failed` : ""}.`,
    };
  }, admin);
}
