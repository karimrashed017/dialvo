"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { cleanText, isUuid } from "@/lib/leads/fields";
import { instantAt } from "@/lib/mail/schedule";

/**
 * "Mark meeting booked": records a meeting on the lead, by hand. Dialvo
 * doesn't read anyone's calendar, so a teammate says when it is. The time
 * typed is in the workspace's time zone.
 */
export async function markMeetingBooked(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace, user }) => {
    const lead = form.get("lead");
    if (!isUuid(lead)) throw new ActionProblem("That lead doesn't exist.");
    const when = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(
      String(form.get("starts_at") ?? ""),
    );
    if (!when)
      throw new ActionProblem(
        "Add the day and time of the meeting.",
        "starts_at",
      );
    const [, y, m, d, hh, mm] = when.map(Number);
    const starts = instantAt(workspace.timezone, y, m, d, hh * 60 + mm);
    if (Number.isNaN(starts.getTime()))
      throw new ActionProblem("That date doesn't look right.", "starts_at");
    const minutes = Number(form.get("minutes") ?? 30);
    const length = [15, 30, 45, 60, 90].includes(minutes) ? minutes : 30;

    const current = await supabase
      .from("leads")
      .select("status")
      .eq("workspace_id", workspace.id)
      .eq("id", lead)
      .maybeSingle();
    mustSucceed(current, "read lead");
    if (!current.data) throw new ActionProblem("That lead doesn't exist.");

    mustSucceed(
      await supabase.from("meetings").insert({
        workspace_id: workspace.id,
        lead_id: lead,
        title: cleanText(form.get("title"), 200),
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + length * 60_000).toISOString(),
        booked_by: "user",
        host_id: user.id,
      }),
      "add meeting",
    );
    if (
      !["won", "lost", "unsubscribed"].includes(current.data.status as string)
    )
      mustSucceed(
        await supabase
          .from("leads")
          .update({ status: "meeting_booked" })
          .eq("workspace_id", workspace.id)
          .eq("id", lead),
        "set status",
      );
    mustSucceed(
      await supabase.from("activity_events").insert({
        workspace_id: workspace.id,
        lead_id: lead,
        actor_id: user.id,
        kind: "meeting_booked",
        summary: `Meeting booked for ${starts.toLocaleString("en-US", {
          timeZone: workspace.timezone,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}`,
        metadata: { starts_at: starts.toISOString() },
      }),
      "log meeting",
    );
    refresh();
    return { ok: true, message: "Meeting recorded." };
  });
}
