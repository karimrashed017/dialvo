import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth/user";
import { isUuid } from "@/lib/leads/fields";
import { createClient, type Supabase } from "@/lib/supabase/server";
import { FIXTURES_ON } from "./fixture-flag";
import { createRepo, type Repo } from "./repo";
import type { Workspace } from "./types";

/** Remembers which workspace someone was last in. A preference, not a grant. */
export const WORKSPACE_COOKIE = "dv_ws";

export type AppContext = {
  user: { id: string; email: string; name: string };
  workspace: Workspace;
  workspaces: Workspace[];
  repo: Repo;
  /** True only in the development design preview. */
  preview: boolean;
};

type MembershipRow = {
  role: Workspace["role"];
  workspace: Omit<Workspace, "role"> | null;
};

/** The workspaces this person belongs to, oldest first. */
export async function listWorkspaces(
  supabase: Supabase,
  userId: string,
): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      "role, created_at, workspace:workspaces(id, name, slug, plan, timezone, website, trial_ends_at, billing_status)",
    )
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw new Error(`Database read failed: ${error.message}`);
  return ((data ?? []) as unknown as MembershipRow[])
    .filter((m) => m.workspace)
    .map((m) => ({ ...m.workspace!, role: m.role }));
}

/** The one the cookie names if they still belong to it, else their first. */
export function pickWorkspace(
  workspaces: Workspace[],
  preferred: string | undefined,
): Workspace | undefined {
  return (
    (isUuid(preferred) && workspaces.find((w) => w.id === preferred)) ||
    workspaces[0]
  );
}

/**
 * Who is asking and which workspace they are in, for every page under /app.
 * Redirects to /login without a session and to /onboarding without a
 * workspace. Read once per request.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  // The NODE_ENV test is repeated here, inline, so the compiler removes this
  // branch (and with it the preview data) from production builds.
  if (process.env.NODE_ENV !== "production" && FIXTURES_ON) {
    await connection();
    const { fixtureContext } = await import("./fixtures");
    return fixtureContext();
  }
  const user = await requireUser();
  const supabase = await createClient();
  const [workspaces, profile, store] = await Promise.all([
    listWorkspaces(supabase, user.id),
    supabase.from("profiles").select("name").eq("id", user.id).maybeSingle(),
    cookies(),
  ]);
  const workspace = pickWorkspace(
    workspaces,
    store.get(WORKSPACE_COOKIE)?.value,
  );
  if (!workspace) redirect("/onboarding");
  return {
    user: { ...user, name: (profile.data?.name as string | undefined) ?? "" },
    workspace,
    workspaces,
    repo: createRepo(supabase, workspace, user.id),
    preview: false,
  };
});
