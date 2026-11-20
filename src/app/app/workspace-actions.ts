"use server";

import { redirect } from "next/navigation";
import { listWorkspaces } from "@/lib/app/context";
import { FIXTURES_ON } from "@/lib/app/fixture-flag";
import { rememberWorkspace } from "@/lib/app/workspace-cookie";
import { getCurrentUser } from "@/lib/auth/user";
import { isUuid } from "@/lib/leads/fields";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** The workspace switcher. Only switches to a workspace you belong to. */
export async function switchWorkspace(form: FormData): Promise<void> {
  if (!APP_CONFIGURED || FIXTURES_ON) return;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const id = form.get("workspace");
  if (!isUuid(id)) return;
  const workspaces = await listWorkspaces(await createClient(), user.id);
  if (!workspaces.some((w) => w.id === id)) return;
  await rememberWorkspace(id);
  redirect("/app");
}
