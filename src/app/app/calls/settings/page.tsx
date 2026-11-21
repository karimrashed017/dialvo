import type { Metadata } from "next";
import { Suspense } from "react";
import { getAppContext } from "@/lib/app/context";
import { dateOnly } from "@/lib/app/time";
import { VOICES } from "@/lib/phone/config";
import { defaultGreeting, disclosure } from "@/lib/phone/prompt";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  Badge,
  Empty,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { addDoNotCall, removeDoNotCall, savePhoneSettings } from "../actions";
import { CallsTabs, SetupNotice } from "../ui";

export const metadata: Metadata = { title: "Call settings" };

type Settings = {
  agent_on: boolean;
  greeting: string;
  voice: string;
  transfer_number: string | null;
  recording_on: boolean;
  outbound_on: boolean;
  call_window: { days: number[]; start: string; end: string };
  daily_call_cap: number;
  max_call_minutes: number;
  sms_on: boolean;
  sms_daily_cap: number;
  a2p_brand_status: string;
  a2p_campaign_status: string;
  messaging_service_sid: string | null;
};

const DEFAULTS: Settings = {
  agent_on: false,
  greeting: "",
  voice: "Polly.Joanna-Neural",
  transfer_number: null,
  recording_on: false,
  outbound_on: false,
  call_window: { days: [1, 2, 3, 4, 5], start: "09:00", end: "20:00" },
  daily_call_cap: 50,
  max_call_minutes: 10,
  sms_on: false,
  sms_daily_cap: 100,
  a2p_brand_status: "not_started",
  a2p_campaign_status: "not_started",
  messaging_service_sid: null,
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const REG: Record<string, string> = {
  not_started: "Not started",
  submitted: "Submitted, waiting",
  approved: "Approved",
  rejected: "Rejected",
};
const SOURCE: Record<string, string> = {
  person: "Added by your team",
  call: "Asked on a call",
  sms_stop: "Texted STOP",
  carrier: "The carrier says they opted out",
};

function Check({
  name,
  on,
  label,
  note,
}: {
  name: string;
  on: boolean;
  label: string;
  note?: string;
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        name={name}
        defaultChecked={on}
        className="mt-0.5 size-4 accent-[#0B0B0C]"
      />
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        {note && <span className={hint}>{note}</span>}
      </span>
    </label>
  );
}

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Calls"
      note="How the phone agent answers, when outbound calls and texts may reach people, and who must never be called."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <CallsTabs current="settings" />
        <section className={panel}>
          <Empty title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const [row, optOuts] = await Promise.all([
    supabase
      .from("workspace_phone")
      .select("*")
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    supabase
      .from("phone_opt_outs")
      .select("phone, channel, source, note, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  const s: Settings = {
    ...DEFAULTS,
    ...((row.data as Partial<Settings> | null) ?? {}),
  };
  const list = (optOuts.data ?? []) as {
    phone: string;
    channel: string;
    source: string;
    note: string;
    created_at: string;
  }[];
  const sample = { phone: s, workspace: { name: workspace.name } };

  return (
    <>
      {head}
      <CallsTabs current="settings" />
      <SetupNotice />
      <ActionForm action={savePhoneSettings} className="space-y-3">
        <fieldset disabled={!admin} className="space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>
              The phone agent
              <Badge tone={s.agent_on ? "ink" : "outline"}>
                {s.agent_on ? "Answering" : "Off"}
              </Badge>
            </h2>
            <div className="space-y-4 p-4">
              <Check
                name="agent_on"
                on={s.agent_on}
                label="Answer calls to our numbers"
                note="The agent answers from your Knowledge, asks the qualifying questions from Website chat, offers your booking link and hands over to a person when asked. Off: calls ring your transfer number, or the caller hears that the team will call back."
              />
              <label className="block">
                <span className={labelCls}>Greeting (optional)</span>
                <input
                  name="greeting"
                  defaultValue={s.greeting}
                  maxLength={300}
                  className={cn(input, "mt-1")}
                  placeholder={defaultGreeting(workspace.name)}
                />
                <span className={hint}>
                  Every call first says: &ldquo;{disclosure(sample)}&rdquo; That
                  line can&apos;t be changed. The greeting may not say or
                  suggest the agent is a person.
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={labelCls}>Voice</span>
                  <select
                    name="voice"
                    defaultValue={s.voice}
                    className={cn(input, "mt-1")}
                  >
                    {VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelCls}>
                    Transfer to (a person&apos;s phone)
                  </span>
                  <input
                    name="transfer_number"
                    defaultValue={s.transfer_number ?? ""}
                    placeholder="+14155550100"
                    className={cn(input, "mt-1")}
                  />
                </label>
              </div>
              <Check
                name="recording_on"
                on={s.recording_on}
                label="Record the audio too"
                note="Calls are always transcribed and the caller is told so first. With this on the audio is kept at Twilio as well, and the opening line says the call is recorded."
              />
            </div>
          </section>

          <section className={panel}>
            <h2 className={panelHead}>
              Outbound calls and texts
              <Badge tone={s.outbound_on ? "ink" : "outline"}>
                {s.outbound_on ? "On" : "Off"}
              </Badge>
            </h2>
            <div className="space-y-4 p-4">
              <Check
                name="outbound_on"
                on={s.outbound_on}
                label="Allow approved call batches to dial"
                note="Only leads with recorded consent to be called, never anyone marked do not contact or on the list below, and only after an owner or admin approves the batch."
              />
              <div>
                <span className={labelCls}>
                  Call window, in each lead&apos;s own time zone
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => (
                    <label
                      key={d}
                      className="flex items-center gap-1 rounded-full border border-black/15 px-2.5 py-1 text-[12.5px]"
                    >
                      <input
                        type="checkbox"
                        name="day"
                        value={i + 1}
                        defaultChecked={s.call_window.days.includes(i + 1)}
                        className="accent-[#0B0B0C]"
                      />
                      {d}
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2 text-[13px]">
                  <input
                    type="time"
                    name="start"
                    min="08:00"
                    max="21:00"
                    defaultValue={s.call_window.start}
                    className={cn(input, "w-32")}
                    aria-label="From"
                  />
                  to
                  <input
                    type="time"
                    name="end"
                    min="08:00"
                    max="21:00"
                    defaultValue={s.call_window.end}
                    className={cn(input, "w-32")}
                    aria-label="Until"
                  />
                </div>
                <p className={cn(hint, "mt-1")}>
                  Never before 8 in the morning or after 9 at night. A lead with
                  no time zone is called only when the window is open in every
                  zone their number could be in (for a US number, from New York
                  to Los Angeles). Set a lead&apos;s zone on the lead&apos;s
                  page.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className={labelCls}>Calls a day, whole workspace</span>
                  <input
                    type="number"
                    name="daily_call_cap"
                    min={1}
                    max={300}
                    defaultValue={s.daily_call_cap}
                    className={cn(input, "mt-1")}
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>Longest call, minutes</span>
                  <input
                    type="number"
                    name="max_call_minutes"
                    min={1}
                    max={30}
                    defaultValue={s.max_call_minutes}
                    className={cn(input, "mt-1")}
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>Texts a day</span>
                  <input
                    type="number"
                    name="sms_daily_cap"
                    min={1}
                    max={500}
                    defaultValue={s.sms_daily_cap}
                    className={cn(input, "mt-1")}
                  />
                </label>
              </div>
              <p className={hint}>
                Each number also has its own daily call cap, on Numbers.
              </p>
            </div>
          </section>

          <section className={panel} id="sms">
            <h2 className={panelHead}>
              Texts (SMS)
              <Badge
                tone={
                  s.sms_on && s.a2p_campaign_status === "approved"
                    ? "ink"
                    : "outline"
                }
              >
                {s.sms_on
                  ? s.a2p_campaign_status === "approved"
                    ? "On"
                    : "Waiting for registration"
                  : "Off"}
              </Badge>
            </h2>
            <div className="space-y-4 p-4">
              <Check
                name="sms_on"
                on={s.sms_on}
                label="Send text steps in sequences"
                note="Only to leads with recorded consent to be texted, inside the call window. The first text says who it's from and ends with &ldquo;Reply STOP to opt out.&rdquo; STOP, UNSUBSCRIBE, CANCEL, END, QUIT and the like stop all texts at once; START allows them again."
              />
              <div className="rounded-xl border border-black/[0.07] p-3 text-[13px] leading-[1.5]">
                <p className="font-medium">
                  A2P 10DLC registration (US numbers)
                </p>
                <p className="mt-1 text-[#0B0B0C]/65">
                  US carriers block texts from local numbers that aren&apos;t
                  registered. In Twilio&apos;s console, under Messaging,
                  Regulatory compliance: register your business as a brand, then
                  a campaign (use case &ldquo;Marketing&rdquo; or
                  &ldquo;Mixed&rdquo;, with sample messages and how people opt
                  in), and add your numbers to the campaign&apos;s Messaging
                  Service. Approval usually takes days to a few weeks. Until the
                  campaign is approved, Dialvo sends no texts from US numbers.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className={labelCls}>Brand</span>
                    <select
                      name="a2p_brand_status"
                      defaultValue={s.a2p_brand_status}
                      className={cn(input, "mt-1")}
                    >
                      {Object.entries(REG).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelCls}>Campaign</span>
                    <select
                      name="a2p_campaign_status"
                      defaultValue={s.a2p_campaign_status}
                      className={cn(input, "mt-1")}
                    >
                      {Object.entries(REG).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelCls}>Messaging Service id</span>
                    <input
                      name="messaging_service_sid"
                      defaultValue={s.messaging_service_sid ?? ""}
                      placeholder="MG..."
                      className={cn(input, "mt-1")}
                    />
                  </label>
                </div>
                <p className={cn(hint, "mt-2")}>
                  Record what Twilio&apos;s console says. With a Messaging
                  Service id, texts go through it.
                </p>
              </div>
            </div>
          </section>
        </fieldset>
        {admin ? (
          <div className="flex justify-end">
            <SubmitButton>Save call settings</SubmitButton>
          </div>
        ) : (
          <p className={hint}>Only an owner or admin can change these.</p>
        )}
      </ActionForm>

      <section className={cn(panel, "mt-3")} id="do-not-call">
        <h2 className={panelHead}>Do not call or text</h2>
        <div className="space-y-3 p-4">
          <p className={hint}>
            Checked before every call and text. People who ask on a call or text
            STOP are added on their own. Only an owner or admin can take a
            number off, and a STOP can only be undone by the person texting
            START.
          </p>
          <ActionForm
            action={addDoNotCall}
            resetOnSuccess
            className="flex flex-wrap items-end gap-2"
          >
            <label className="min-w-40 flex-1">
              <span className={labelCls}>Number</span>
              <input
                name="phone"
                required
                placeholder="+14155550100"
                className={cn(input, "mt-1")}
              />
            </label>
            <label>
              <span className={labelCls}>For</span>
              <select name="channel" className={cn(input, "mt-1")}>
                <option value="call">Calls</option>
                <option value="sms">Texts</option>
              </select>
            </label>
            <label className="min-w-40 flex-1">
              <span className={labelCls}>Note (optional)</span>
              <input
                name="note"
                maxLength={200}
                className={cn(input, "mt-1")}
              />
            </label>
            <SubmitButton variant="secondary">Add</SubmitButton>
          </ActionForm>
          {list.length === 0 ? (
            <p className={hint}>Nobody on the list yet.</p>
          ) : (
            <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.07]">
              {list.map((o) => (
                <li
                  key={`${o.phone}-${o.channel}`}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]"
                >
                  <span className="font-medium tabular-nums">{o.phone}</span>
                  <Badge tone="outline">
                    {o.channel === "call" ? "Calls" : "Texts"}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[#0B0B0C]/55">
                    {SOURCE[o.source] ?? o.source}
                    {o.note ? ` · ${o.note}` : ""} ·{" "}
                    {dateOnly(o.created_at, workspace.timezone)}
                  </span>
                  {admin &&
                    o.source !== "sms_stop" &&
                    o.source !== "carrier" && (
                      <ActionForm
                        action={removeDoNotCall}
                        quiet
                        confirm="Take this number off the list?"
                      >
                        <input type="hidden" name="phone" value={o.phone} />
                        <input type="hidden" name="channel" value={o.channel} />
                        <SubmitButton variant="ghost" small>
                          Remove
                        </SubmitButton>
                      </ActionForm>
                    )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

export default function CallSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
