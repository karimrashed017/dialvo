"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import type { ActionResult } from "@/lib/app/action";
import { rememberWorkspace } from "@/lib/app/workspace-cookie";
import { safeTimeZone } from "@/lib/app/time";
import { getCurrentUser } from "@/lib/auth/user";
import {
  markSiteReading,
  readSiteIntoKnowledge,
} from "@/lib/knowledge/site-knowledge";
import { cleanLongText, cleanText, isUuid } from "@/lib/leads/fields";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const LOGGED_OUT: ActionResult = {
  ok: false,
  message: "You've been logged out. Log in again.",
};

/** Onboarding: creates the workspace and everything it starts with. */
export async function createWorkspace(form: FormData): Promise<ActionResult> {
  if (!APP_CONFIGURED)
    return { ok: false, message: "Dialvo's app is still being set up." };
  const user = await getCurrentUser();
  if (!user) return LOGGED_OUT;

  const name = cleanText(form.get("name"), 120);
  if (!name)
    return { ok: false, field: "name", message: "Give your workspace a name." };
  const timezone = safeTimeZone(cleanText(form.get("timezone"), 64));
  const website = cleanText(form.get("website"), 300);
  const sells = cleanLongText(form.get("sells"), 5000);
  if (!sells)
    return {
      ok: false,
      field: "sells",
      message:
        "Tell us what you sell: it's the first thing your agents will learn.",
    };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_workspace", {
    p_name: name,
    p_timezone: timezone,
    p_website: website || null,
    p_what_you_sell: sells,
  });
  if (error || !isUuid(data)) {
    if (error?.message.includes("workspace limit"))
      return {
        ok: false,
        message:
          "Your plan includes one workspace. Scale includes five: one per client or brand.",
      };
    console.error(
      "[onboarding] create workspace:",
      error?.code,
      error?.message,
    );
    return {
      ok: false,
      message: "We couldn't create the workspace. Please try again.",
    };
  }
  await rememberWorkspace(data);
  if (website) {
    // Read their website into Knowledge, so the agent knows the business
    // from the first minute. It happens after this response has gone (the
    // person is already on Today, where the checklist shows the progress),
    // and it fails quietly: the checklist then offers to try again.
    await markSiteReading(supabase, data, website);
    after(() =>
      readSiteIntoKnowledge(supabase, {
        workspaceId: data,
        userId: user.id,
        address: website,
      }),
    );
  }
  redirect("/app");
}

/** Joins a workspace the signed-in person was invited to. */
export async function acceptInvitation(form: FormData): Promise<ActionResult> {
  if (!APP_CONFIGURED)
    return { ok: false, message: "Dialvo's app is still being set up." };
  const user = await getCurrentUser();
  if (!user) return LOGGED_OUT;
  const id = form.get("invitation");
  if (!isUuid(id))
    return { ok: false, message: "That invitation isn't valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_invitation_id: id,
  });
  if (error || !isUuid(data))
    return {
      ok: false,
      message:
        "That invitation has expired or was withdrawn. Ask for a new one.",
    };
  await rememberWorkspace(data);
  redirect("/app");
}
