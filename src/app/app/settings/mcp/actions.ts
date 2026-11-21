"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanText, isUuid } from "@/lib/leads/fields";
import { makeApiKey } from "@/lib/plays/api-key";

// Keys for the MCP server (and the API): personal keys any member makes for
// themselves, workspace keys only owners and admins make; each read-only or
// with write access. The key is shown once and only its hash is stored.

export async function createScopedKey(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const personal = form.get("owner") !== "workspace";
    if (!personal && workspace.role === "member")
      throw new ActionProblem(
        "Only the workspace's owner or an admin can make a workspace key.",
      );
    const scope = form.get("scope") === "write" ? "write" : "read";
    const key = makeApiKey();
    const { error } = await supabase.rpc("api_key_create_scoped", {
      p_workspace_id: workspace.id,
      p_name:
        cleanText(form.get("name"), 80) ||
        (personal ? "My assistant" : "Team assistant"),
      p_prefix: key.prefix,
      p_hash: key.hash,
      p_scope: scope,
      p_personal: personal,
    });
    if (error?.code === "P0001")
      throw new ActionProblem(
        personal
          ? "You have three personal keys. Revoke one first."
          : "This workspace has three workspace keys. Revoke one first.",
      );
    mustSucceed({ error }, "create scoped key");
    refresh();
    return { ok: true, message: key.key, field: "key" };
  });
}

export async function revokeOwnKey(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("key");
    if (!isUuid(id)) throw new ActionProblem("That key doesn't exist.");
    // Admins may revoke any key; members their own.
    const { data, error } = await supabase.rpc(
      workspace.role === "member" ? "api_key_revoke_own" : "api_key_revoke",
      {
        p_key_id: id,
      },
    );
    mustSucceed({ error }, "revoke key");
    if (!data) throw new ActionProblem("That key can't be revoked by you.");
    refresh();
    return {
      ok: true,
      message: "Revoked. Requests with it are refused from now on.",
    };
  });
}
