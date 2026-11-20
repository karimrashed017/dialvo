"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { safeTimeZone } from "@/lib/app/time";
import { cleanText, isUuid, normalizeEmail } from "@/lib/leads/fields";

// Workspace settings. Everything here but the profile is for owners and
// admins; the database's policies say the same.

const admin = { admin: true } as const;

export async function updateWorkspace(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const name = cleanText(form.get("name"), 120);
    if (!name) throw new ActionProblem("Give the workspace a name.", "name");
    const { data, error } = await supabase
      .from("workspaces")
      .update({
        name,
        website: cleanText(form.get("website"), 300) || null,
        timezone: safeTimeZone(cleanText(form.get("timezone"), 64)),
      })
      .eq("id", workspace.id)
      .select("id");
    mustSucceed({ error }, "update workspace");
    if (!data?.length)
      throw new ActionProblem("You don't have permission to do that.");
    refresh();
    return { ok: true, message: "Saved." };
  }, admin);
}

export async function updateProfile(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, user }) => {
    const name = cleanText(form.get("name"), 120);
    if (!name) throw new ActionProblem("Add your name.", "name");
    mustSucceed(
      await supabase.from("profiles").update({ name }).eq("id", user.id),
      "update profile",
    );
    refresh();
    return { ok: true, message: "Saved." };
  });
}

/** Each person's own switch for the team's email alerts. */
export async function updateAlertEmails(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, user }) => {
    const on = form.get("alert_emails") === "true";
    mustSucceed(
      await supabase
        .from("profiles")
        .update({ alert_emails: on })
        .eq("id", user.id),
      "update alert emails",
    );
    refresh();
    return {
      ok: true,
      message: on ? "Email alerts are on." : "Email alerts are off.",
    };
  });
}

export async function invite(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const email = normalizeEmail(form.get("email"));
    if (!email)
      throw new ActionProblem("That email doesn't look right.", "email");
    const role = form.get("role") === "admin" ? "admin" : "member";

    const members = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspace.id);
    mustSucceed(members, "read members");
    const ids = (members.data ?? []).map((m) => m.user_id as string);
    const already = await supabase
      .from("profiles")
      .select("id")
      .in("id", ids)
      .eq("email", email);
    mustSucceed(already, "read profiles");
    if (already.data?.length)
      throw new ActionProblem("They're already in this workspace.", "email");

    const { error } = await supabase.from("invitations").insert({
      workspace_id: workspace.id,
      email,
      role,
      invited_by: user.id,
    });
    if (error?.code === "23505")
      throw new ActionProblem("They already have an open invitation.", "email");
    mustSucceed({ error }, "invite");
    refresh();
    return {
      ok: true,
      // No email is sent in this slice: say exactly what happens instead.
      message: `Invitation saved. We don't send invitation emails yet: ask ${email} to sign up at trydialvo.com/signup with that address, and they'll be offered this workspace.`,
    };
  }, admin);
}

export async function revokeInvitation(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("invitation");
    if (!isUuid(id)) throw new ActionProblem("That invitation doesn't exist.");
    mustSucceed(
      await supabase
        .from("invitations")
        .update({ status: "revoked" })
        .eq("workspace_id", workspace.id)
        .eq("id", id)
        .eq("status", "pending"),
      "revoke invitation",
    );
    refresh();
    return { ok: true };
  }, admin);
}

export async function changeRole(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const member = form.get("member");
    if (!isUuid(member)) throw new ActionProblem("Choose a member.");
    if (member === user.id)
      throw new ActionProblem("You can't change your own role.");
    const role = form.get("role") === "admin" ? "admin" : "member";
    const { data, error } = await supabase
      .from("workspace_members")
      .update({ role })
      .eq("workspace_id", workspace.id)
      .eq("user_id", member)
      .select("user_id");
    mustSucceed({ error }, "change role");
    if (!data?.length)
      throw new ActionProblem("The owner's role can't be changed.");
    refresh();
    return { ok: true };
  }, admin);
}

export async function removeMember(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const member = form.get("member");
    if (!isUuid(member)) throw new ActionProblem("Choose a member.");
    if (member === user.id)
      throw new ActionProblem("You can't remove yourself here.");
    const { data, error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("user_id", member)
      .select("user_id");
    mustSucceed({ error }, "remove member");
    if (!data?.length) throw new ActionProblem("The owner can't be removed.");
    refresh();
    return { ok: true };
  }, admin);
}

function redirectAddress(form: FormData): string | null {
  const raw = cleanText(form.get("redirect_url"), 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || url.protocol === "http:")
      return url.toString();
  } catch {}
  throw new ActionProblem(
    "The thank-you address has to start with https://",
    "redirect_url",
  );
}

export async function createLeadForm(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const name = cleanText(form.get("name"), 120);
    if (!name) throw new ActionProblem("Give the form a name.", "name");
    mustSucceed(
      await supabase.from("lead_forms").insert({
        workspace_id: workspace.id,
        name,
        redirect_url: redirectAddress(form),
        created_by: user.id,
      }),
      "create lead form",
    );
    refresh();
    return { ok: true };
  }, admin);
}

export async function updateLeadForm(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("form");
    if (!isUuid(id)) throw new ActionProblem("That form doesn't exist.");
    const changes: Record<string, unknown> = {};
    if (form.has("enabled")) changes.enabled = form.get("enabled") === "true";
    if (form.has("name")) {
      const name = cleanText(form.get("name"), 120);
      if (!name) throw new ActionProblem("Give the form a name.", "name");
      changes.name = name;
      changes.redirect_url = redirectAddress(form);
    }
    mustSucceed(
      await supabase
        .from("lead_forms")
        .update(changes)
        .eq("workspace_id", workspace.id)
        .eq("id", id),
      "update lead form",
    );
    refresh();
    return { ok: true, message: form.has("name") ? "Saved." : undefined };
  }, admin);
}

export async function deleteLeadForm(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("form");
    if (!isUuid(id)) throw new ActionProblem("That form doesn't exist.");
    mustSucceed(
      await supabase
        .from("lead_forms")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("id", id),
      "delete lead form",
    );
    refresh();
    return { ok: true };
  }, admin);
}

// ---------------------------------------------------------------------------
// Website chat widgets
// ---------------------------------------------------------------------------

function widgetFields(form: FormData) {
  const name = cleanText(form.get("name"), 120);
  if (!name) throw new ActionProblem("Give the chat a name.", "name");
  const title = cleanText(form.get("title"), 60);
  if (!title)
    throw new ActionProblem("Add the title visitors will see.", "title");
  return { name, title, welcome: cleanText(form.get("welcome"), 300) };
}

export async function createChatWidget(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const name = cleanText(form.get("name"), 120) || "Website chat";
    mustSucceed(
      await supabase.from("chat_widgets").insert({
        workspace_id: workspace.id,
        name,
        created_by: user.id,
      }),
      "create chat widget",
    );
    refresh();
    return { ok: true };
  }, admin);
}

export async function updateChatWidget(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("widget");
    if (!isUuid(id)) throw new ActionProblem("That chat doesn't exist.");
    const changes = form.has("enabled")
      ? { enabled: form.get("enabled") === "true" }
      : widgetFields(form);
    mustSucceed(
      await supabase
        .from("chat_widgets")
        .update(changes)
        .eq("workspace_id", workspace.id)
        .eq("id", id),
      "update chat widget",
    );
    refresh();
    return { ok: true, message: form.has("enabled") ? undefined : "Saved." };
  }, admin);
}

export async function deleteChatWidget(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("widget");
    if (!isUuid(id)) throw new ActionProblem("That chat doesn't exist.");
    mustSucceed(
      await supabase
        .from("chat_widgets")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("id", id),
      "delete chat widget",
    );
    refresh();
    return { ok: true };
  }, admin);
}
