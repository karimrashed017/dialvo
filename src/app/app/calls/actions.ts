"use server";

import { refresh } from "next/cache";
import {
  ActionProblem,
  inWorkspace,
  mustSucceed,
  type ActionResult,
} from "@/lib/app/action";
import { isUuid } from "@/lib/leads/fields";
import { phoneRuntime, VOICES, webhookBase } from "@/lib/phone/config";
import { buyNumber, releaseNumber } from "@/lib/phone/numbers";
import { createPhoneStore } from "@/lib/phone/store";
import { createTwilio, twilioCredentials } from "@/lib/phone/twilio";

// The Calls pages' actions. Settings and number details are for owners and
// admins; buying and releasing numbers for the owner alone. The database's
// functions check the same again. There is no outbound calling.

const admin = { admin: true } as const;
const NOT_ON =
  "Calls aren't switched on yet on Dialvo's side (Twilio isn't connected). Nothing was changed.";
const E164 = /^\+[1-9]\d{6,14}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const REG = ["not_started", "submitted", "approved", "rejected"];

const phone = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .replace(/[\s().-]/g, "")
    .replace(/^00/, "+");

const int = (
  value: FormDataEntryValue | null,
  min: number,
  max: number,
  field: string,
) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ActionProblem(`Use a whole number from ${min} to ${max}.`, field);
  return n;
};

export async function savePhoneSettings(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const transfer = phone(form.get("transfer_number"));
    if (transfer && !E164.test(transfer))
      throw new ActionProblem(
        "Write the transfer number in international form, like +14155550100.",
        "transfer_number",
      );
    const voice = String(form.get("voice") ?? "");
    const v = VOICES.find((x) => x.id === voice);
    if (!v) throw new ActionProblem("Choose a voice.", "voice");
    const days = form
      .getAll("day")
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    const start = String(form.get("start") ?? "");
    const end = String(form.get("end") ?? "");
    if (!days.length)
      throw new ActionProblem("Choose at least one day.", "day");
    if (
      !TIME.test(start) ||
      !TIME.test(end) ||
      start >= end ||
      start < "08:00" ||
      end > "21:00"
    )
      throw new ActionProblem(
        "The texting window must be inside 08:00 to 21:00 and end after it starts.",
        "start",
      );
    const brand = String(form.get("a2p_brand_status") ?? "not_started");
    const campaign = String(form.get("a2p_campaign_status") ?? "not_started");
    if (!REG.includes(brand) || !REG.includes(campaign))
      throw new ActionProblem("Choose a registration status.");
    const mss = String(form.get("messaging_service_sid") ?? "").trim();
    if (mss && !/^MG[0-9a-f]{32}$/.test(mss))
      throw new ActionProblem(
        "A Messaging Service id starts with MG followed by 32 letters and digits.",
        "messaging_service_sid",
      );
    const greeting = String(form.get("greeting") ?? "").trim();
    if (greeting.length > 300)
      throw new ActionProblem(
        "Keep the greeting under 300 characters.",
        "greeting",
      );
    const settings = {
      agent_on: form.get("agent_on") === "on",
      greeting,
      voice: v.id,
      language: v.language,
      transfer_number: transfer,
      recording_on: form.get("recording_on") === "on",
      // The database's texting switch: texts need it on. It no longer
      // allows any call (Dialvo makes no outbound calls).
      outbound_on: form.get("sms_on") === "on",
      call_window: { days: [...new Set(days)].sort(), start, end },
      max_call_minutes: int(
        form.get("max_call_minutes"),
        1,
        30,
        "max_call_minutes",
      ),
      sms_on: form.get("sms_on") === "on",
      sms_daily_cap: int(form.get("sms_daily_cap"), 1, 500, "sms_daily_cap"),
      a2p_brand_status: brand,
      a2p_campaign_status: campaign,
      messaging_service_sid: mss,
    };
    mustSucceed(
      await supabase.rpc("phone_settings_save", {
        p_workspace_id: workspace.id,
        p_settings: settings,
      }),
      "phone settings",
    );
    refresh();
    return { ok: true, message: "Saved." };
  }, admin);
}

export async function buyNumberAction(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ user, workspace }) => {
    if (workspace.role !== "owner")
      throw new ActionProblem("Only the workspace's owner can buy numbers.");
    const credentials = twilioCredentials();
    const store = phoneRuntime().on ? createPhoneStore() : null;
    if (!credentials || !store) throw new ActionProblem(NOT_ON);
    const quoted = Number(form.get("quoted"));
    if (!Number.isFinite(quoted) || quoted <= 0)
      throw new ActionProblem("Search again to see the price first.");
    if (form.get("confirm") !== "on")
      throw new ActionProblem("Tick the box to agree to the monthly price.");
    const result = await buyNumber(
      { store, twilio: createTwilio(credentials), base: webhookBase() },
      {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        userId: user.id,
        e164: phone(form.get("e164")),
        country: String(form.get("country") ?? ""),
        quotedMonthly: quoted,
      },
    );
    if (!result.ok) throw new ActionProblem(result.message);
    refresh();
    return result;
  });
}

export async function releaseNumberAction(
  form: FormData,
): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, user, workspace }) => {
    if (workspace.role !== "owner")
      throw new ActionProblem(
        "Only the workspace's owner can release numbers.",
      );
    const credentials = twilioCredentials();
    const store = phoneRuntime().on ? createPhoneStore() : null;
    if (!credentials || !store) throw new ActionProblem(NOT_ON);
    const id = form.get("number");
    if (!isUuid(id)) throw new ActionProblem("That number doesn't exist.");
    const { data, error } = await supabase
      .from("phone_numbers")
      .select("id, provider_sid")
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .eq("status", "active")
      .maybeSingle();
    mustSucceed({ error }, "read number");
    if (!data) throw new ActionProblem("That number doesn't exist.");
    const result = await releaseNumber(
      { store, twilio: createTwilio(credentials) },
      {
        workspaceId: workspace.id,
        userId: user.id,
        numberId: data.id,
        sid: data.provider_sid,
      },
    );
    if (!result.ok) throw new ActionProblem(result.message);
    refresh();
    return result;
  });
}

export async function addDoNotCall(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, user, workspace }) => {
    const number = phone(form.get("phone"));
    if (!E164.test(number))
      throw new ActionProblem(
        "Write the number in international form, like +14155550100.",
        "phone",
      );
    const channel = form.get("channel") === "sms" ? "sms" : "call";
    const note = String(form.get("note") ?? "")
      .trim()
      .slice(0, 200);
    const { error } = await supabase.from("phone_opt_outs").insert({
      workspace_id: workspace.id,
      phone: number,
      channel,
      source: "person",
      note,
      added_by: user.id,
    });
    if (error?.code === "23505")
      return { ok: true, message: "That number is already on the list." };
    mustSucceed({ error }, "add opt-out");
    refresh();
    return { ok: true, message: "Added. That number won't be contacted." };
  });
}

export async function removeDoNotCall(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const number = phone(form.get("phone"));
    const channel = form.get("channel") === "sms" ? "sms" : "call";
    const { data, error } = await supabase
      .from("phone_opt_outs")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("phone", number)
      .eq("channel", channel)
      .select("phone");
    mustSucceed({ error }, "remove opt-out");
    if (!data?.length)
      throw new ActionProblem(
        "Only an owner or admin can take a number off, and never one that texted STOP.",
      );
    refresh();
    return { ok: true };
  }, admin);
}

export async function setLeadTimeZone(form: FormData): Promise<ActionResult> {
  return inWorkspace(async ({ supabase, workspace }) => {
    const id = form.get("lead");
    if (!isUuid(id)) throw new ActionProblem("That lead doesn't exist.");
    const zone = String(form.get("time_zone") ?? "");
    if (zone && !Intl.supportedValuesOf("timeZone").includes(zone))
      throw new ActionProblem("Choose a time zone from the list.");
    const { data, error } = await supabase
      .from("leads")
      .update({ time_zone: zone || null })
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .select("id");
    mustSucceed({ error }, "set time zone");
    if (!data?.length) throw new ActionProblem("That lead doesn't exist.");
    refresh();
    return { ok: true, message: "Saved." };
  });
}
