import "server-only";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/user";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { createClient, type Supabase } from "@/lib/supabase/server";
import { listWorkspaces, pickWorkspace, WORKSPACE_COOKIE } from "./context";
import { FIXTURES_ON } from "./fixture-flag";
import type { Workspace } from "./types";

/** What every Server Action answers with. */
export type ActionResult = {
  ok: boolean;
  message?: string;
  /** The form field the message is about, when there is one. */
  field?: string;
};

export const idle: ActionResult = { ok: false };

export type ActionContext = {
  supabase: Supabase;
  user: CurrentUser;
  workspace: Workspace;
};

/** A problem to show the person, as opposed to a bug. */
export class ActionProblem extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/**
 * Runs a mutation for the signed-in person in their current workspace. Every
 * Server Action goes through here: it checks the session, checks that the
 * person really is a member of the workspace (asked fresh from the database,
 * never taken from the form), and with `admin` that they are an owner or
 * admin. Row-level security enforces the same rules again underneath.
 */
export async function inWorkspace(
  run: (context: ActionContext) => Promise<ActionResult | void>,
  options: { admin?: boolean } = {},
): Promise<ActionResult> {
  if (FIXTURES_ON)
    return {
      ok: false,
      message: "This is the design preview: nothing is saved.",
    };
  if (!APP_CONFIGURED)
    return { ok: false, message: "Dialvo's app is still being set up." };
  try {
    const user = await getCurrentUser();
    if (!user)
      return { ok: false, message: "You've been logged out. Log in again." };
    const supabase = await createClient();
    const workspaces = await listWorkspaces(supabase, user.id);
    const workspace = pickWorkspace(
      workspaces,
      (await cookies()).get(WORKSPACE_COOKIE)?.value,
    );
    if (!workspace)
      return { ok: false, message: "You're not in a workspace yet." };
    if (options.admin && workspace.role === "member")
      return {
        ok: false,
        message: "Only the workspace's owner or an admin can do that.",
      };
    return (await run({ supabase, user, workspace })) ?? { ok: true };
  } catch (error) {
    // redirect() and notFound() work by throwing: let them through.
    unstable_rethrow(error);
    if (error instanceof ActionProblem)
      return { ok: false, message: error.message, field: error.field };
    console.error("[action]", error);
    return {
      ok: false,
      message: "That didn't save. Please try again in a moment.",
    };
  }
}

/** Throws a generic problem if a write failed; logs the real reason. */
export function mustSucceed(
  result: { error: { message: string; code?: string } | null },
  what: string,
) {
  if (!result.error) return;
  console.error(`[action] ${what}:`, result.error.code, result.error.message);
  throw new ActionProblem(
    result.error.code === "42501"
      ? "You don't have permission to do that."
      : "That didn't save. Please try again in a moment.",
  );
}
