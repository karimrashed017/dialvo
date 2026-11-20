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
  markSiteReading,
  readSiteIntoKnowledge,
} from "@/lib/knowledge/site-knowledge";
import { cleanText } from "@/lib/leads/fields";
import { createLimiter } from "@/lib/leads/rate-limit";

// The setup steps' own actions (Home, and Knowledge's first-time state). Creating the chat and
// switching the agent on reuse the Settings and Agents actions.

/** Reading a whole site: 3 a minute per person. */
const siteLimit = createLimiter({ windowMs: 60_000, max: 3 });

/**
 * Reads the workspace's website into Knowledge (again). Answers at once;
 * the reading happens after the response and the checklist shows it.
 */
export async function readWebsite(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const address =
      cleanText(form.get("url"), 300) || (workspace.website ?? "");
    if (!address || /\s/.test(address) || !address.includes("."))
      throw new ActionProblem("Add your website's address first.", "url");
    if (siteLimit.take(user.id) > 0)
      throw new ActionProblem(
        "We're still on it. Try again in a minute.",
        "url",
      );
    await markSiteReading(supabase, workspace.id, address);
    after(() =>
      readSiteIntoKnowledge(supabase, {
        workspaceId: workspace.id,
        userId: user.id,
        address,
      }),
    );
    refresh();
    return {
      ok: true,
      message:
        "Reading your website. Its pages appear in Knowledge within half a minute.",
    };
  });
}

/** Hides the checklist for everyone in the workspace. */
export async function dismissChecklist(): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    mustSucceed(
      await supabase
        .from("workspace_setup")
        .update({ dismissed_at: new Date().toISOString() })
        .eq("workspace_id", workspace.id),
      "dismiss checklist",
    );
    refresh();
    return { ok: true };
  });
}
