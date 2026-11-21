import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock, FileText } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { agoWords, dateTime } from "@/lib/app/time";
import { BRIEFS_PER_DAY, CALENDAR_AHEAD_DAYS } from "@/lib/briefs/config";
import { prospectRuntimeStatus } from "@/lib/prospects/config";
import { alertEmailStatus } from "@/lib/alerts/email";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
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
} from "../_ui/kit";
import {
  removeCalendar,
  requestBrief,
  saveBriefSettings,
  saveCalendar,
} from "./actions";
import { BRIEF_REASON, BRIEF_STATUS } from "./brief-view";

export const metadata: Metadata = { title: "Briefs" };

type MeetingRow = {
  id: string;
  title: string;
  starts_at: string;
  status: string;
  source: string;
  lead: {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
  } | null;
};
type BriefListRow = {
  id: string;
  kind: string;
  status: string;
  reason: string;
  summary: string;
  created_at: string;
  meeting_id: string | null;
  lead: {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
  } | null;
};

const who = (
  l: { name: string; email: string | null; company: string | null } | null,
) =>
  l
    ? `${l.name || l.email || "A lead"}${l.company ? ` (${l.company})` : ""}`
    : "A lead";

async function Content() {
  const { workspace, user, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Briefs"
      note="A short brief on each account before you talk to them: what the company does, the people, what was said before, open questions and talking points, with sources. Made before each meeting, or whenever you ask."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={FileText} title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const now = new Date();
  const ahead = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [meetings, briefs, settings, feed] = await Promise.all([
    supabase
      .from("meetings")
      .select(
        "id, title, starts_at, status, source, lead:leads(id, name, email, company)",
      )
      .eq("workspace_id", workspace.id)
      .eq("status", "scheduled")
      .gte("starts_at", now.toISOString())
      .lt("starts_at", ahead)
      .order("starts_at")
      .limit(30),
    supabase
      .from("account_briefs")
      .select(
        "id, kind, status, reason, summary, created_at, meeting_id, lead:leads(id, name, email, company)",
      )
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("brief_settings")
      .select("*")
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    supabase
      .from("calendar_feeds")
      .select(
        "id, host, status, last_synced_at, last_error, events_seen, meetings_matched",
      )
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const meetingRows = (meetings.data ?? []) as unknown as MeetingRow[];
  const briefRows = (briefs.data ?? []) as unknown as BriefListRow[];
  const byMeeting = new Map(
    briefRows.filter((b) => b.meeting_id).map((b) => [b.meeting_id!, b]),
  );
  const s = (settings.data ?? {
    mode: "before",
    minutes_before: 120,
    digest_hour: 7,
    email_owner: true,
    post_slack: true,
    closed_lost: true,
  }) as {
    mode: string;
    minutes_before: number;
    digest_hour: number;
    email_owner: boolean;
    post_slack: boolean;
    closed_lost: boolean;
  };
  const f = feed.data as {
    host: string;
    status: string;
    last_synced_at: string | null;
    last_error: string | null;
    events_seen: number;
    meetings_matched: number;
  } | null;
  const on = Boolean(createServiceClient());
  const model = prospectRuntimeStatus().on;
  const mail = alertEmailStatus().on;

  return (
    <>
      {head}
      {(!on || !model) && (
        <p
          role="status"
          className="mb-3 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-[13px] leading-[1.5]"
        >
          {!on
            ? "Briefs aren't switched on yet on Dialvo's side (the server needs its database key)."
            : "The research model isn't switched on yet on Dialvo's side: briefs you ask for wait until it is."}
        </p>
      )}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Meetings in the next 7 days
              <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
                {meetingRows.length}
              </span>
            </h2>
            {meetingRows.length === 0 ? (
              <Empty icon={CalendarClock} title="No meetings coming up">
                Meetings booked through Dialvo, marked on a lead, or found in
                your calendar (connect it on the right) appear here with their
                brief.
              </Empty>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {meetingRows.map((m) => {
                  const b = byMeeting.get(m.id);
                  return (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[13px]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {m.lead ? (
                            <Link
                              href={`/app/leads/${m.lead.id}#brief`}
                              className="hover:underline"
                            >
                              {who(m.lead)}
                            </Link>
                          ) : (
                            who(m.lead)
                          )}
                        </span>
                        <span className="block text-[12px] text-[#0B0B0C]/55">
                          {dateTime(m.starts_at, workspace.timezone)}
                          {m.title && ` · ${m.title}`}
                          {m.source === "calendar" && " · from a calendar"}
                        </span>
                      </span>
                      {b ? (
                        <Link href={`/app/briefs/${b.id}`}>
                          <Badge
                            tone={b.status === "ready" ? "ink" : "outline"}
                          >
                            {BRIEF_STATUS[b.status] ?? b.status}
                          </Badge>
                        </Link>
                      ) : m.lead ? (
                        <ActionForm action={requestBrief}>
                          <input type="hidden" name="lead" value={m.lead.id} />
                          <SubmitButton
                            small
                            variant="secondary"
                            pendingText="Asking…"
                          >
                            Make now
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={panel}>
            <h2 className={panelHead}>Latest briefs</h2>
            {briefRows.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-[#0B0B0C]/50">
                None yet. Open a lead and choose Make a brief, or wait for your
                next meeting.
              </p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {briefRows.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/app/briefs/${b.id}`}
                      className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] hover:bg-black/[0.02]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {b.kind === "closed_lost" ? "Why it was lost: " : ""}
                          {who(b.lead)}
                        </span>
                        {b.summary && (
                          <span className="line-clamp-2 block text-[12.5px] text-[#0B0B0C]/60">
                            {b.summary}
                          </span>
                        )}
                        <span className="block text-[11.5px] text-[#0B0B0C]/40">
                          {BRIEF_REASON[b.reason] ?? b.reason} ·{" "}
                          {agoWords(b.created_at)}
                        </span>
                      </span>
                      <Badge
                        tone={
                          b.status === "ready"
                            ? "plain"
                            : b.status === "failed"
                              ? "warn"
                              : "outline"
                        }
                      >
                        {BRIEF_STATUS[b.status] ?? b.status}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Your calendar
              {f && (
                <Badge tone={f.status === "active" ? "ink" : "warn"}>
                  {f.status === "active" ? "Connected" : "Not reading"}
                </Badge>
              )}
            </h2>
            <div className="space-y-3 p-4 text-[13px] leading-[1.5]">
              {f && (
                <div className="space-y-1">
                  <p>
                    Reading your calendar at{" "}
                    <span className="font-medium">{f.host}</span>
                    {f.last_synced_at
                      ? `, last ${agoWords(f.last_synced_at)}: ${f.events_seen} events with other people, ${f.meetings_matched} with your leads.`
                      : ". The first read is within a few minutes."}
                  </p>
                  {f.last_error && (
                    <p role="alert" className="text-[#B42318]">
                      {f.last_error}
                    </p>
                  )}
                </div>
              )}
              <ActionForm
                action={saveCalendar}
                resetOnSuccess
                className="space-y-2"
              >
                <label className={labelCls}>
                  Secret address in iCal format
                  <input
                    name="url"
                    type="password"
                    autoComplete="off"
                    required
                    maxLength={1000}
                    placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                    disabled={!on}
                    className={cn(input, "mt-1")}
                  />
                </label>
                <SubmitButton small disabled={!on} pendingText="Reading it…">
                  {f ? "Replace" : "Connect"}
                </SubmitButton>
              </ActionForm>
              {f && (
                <ActionForm
                  action={removeCalendar}
                  confirm="Remove your calendar? Dialvo deletes the address and stops reading it."
                >
                  <SubmitButton small variant="ghost" pendingText="Removing…">
                    Remove
                  </SubmitButton>
                </ActionForm>
              )}
              <details className={hint}>
                <summary className="cursor-pointer">
                  Where to find the address
                </summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  <li>
                    Google Calendar: Settings, your calendar, Integrate
                    calendar, &quot;Secret address in iCal format&quot;.
                  </li>
                  <li>
                    Outlook on the web: Settings, Calendar, Shared calendars,
                    Publish a calendar, ICS link.
                  </li>
                  <li>
                    Apple iCloud: share the calendar as a public calendar and
                    copy the webcal link.
                  </li>
                </ul>
              </details>
              <p className={hint}>
                Only you can see and remove your address; it is kept encrypted
                and never shown again. Dialvo reads it every 30 minutes,{" "}
                {CALENDAR_AHEAD_DAYS} days ahead, and adds a meeting to a lead
                only when one of your leads is invited. Other events are not
                stored. Monthly and yearly repeats count once.
              </p>
            </div>
          </section>

          <section className={panel}>
            <h2 className={panelHead}>When briefs are made</h2>
            <ActionForm
              action={saveBriefSettings}
              className="space-y-3 p-4 text-[13px]"
            >
              <fieldset className="space-y-1.5" disabled={!admin}>
                {(
                  [
                    ["before", "Before each meeting"],
                    ["digest", "Each morning, for the day's meetings"],
                    ["off", "Only when someone asks"],
                  ] as const
                ).map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="mode"
                      value={v}
                      defaultChecked={s.mode === v}
                      className="accent-[#0B0B0C]"
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="grid grid-cols-2 gap-2">
                <label className={labelCls}>
                  How long before
                  <select
                    name="minutes_before"
                    defaultValue={String(s.minutes_before)}
                    disabled={!admin}
                    className={cn(input, "mt-1")}
                  >
                    {[30, 60, 120, 240, 1440].map((m) => (
                      <option key={m} value={m}>
                        {m < 60
                          ? `${m} minutes`
                          : m === 1440
                            ? "1 day"
                            : `${m / 60} hours`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  Morning digest at
                  <select
                    name="digest_hour"
                    defaultValue={String(s.digest_hour)}
                    disabled={!admin}
                    className={cn(input, "mt-1")}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <fieldset className="space-y-1.5" disabled={!admin}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="email_owner"
                    defaultChecked={s.email_owner}
                    className="accent-[#0B0B0C]"
                  />
                  Email each brief to the meeting&apos;s owner
                  {!mail && " (email isn't switched on yet)"}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="post_slack"
                    defaultChecked={s.post_slack}
                    className="accent-[#0B0B0C]"
                  />
                  Post each brief to Slack, when connected
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="closed_lost"
                    defaultChecked={s.closed_lost}
                    className="accent-[#0B0B0C]"
                  />
                  When a lead is marked lost, write why it was likely lost
                </label>
              </fieldset>
              {admin ? (
                <SubmitButton small>Save</SubmitButton>
              ) : (
                <p className={hint}>Only an owner or admin can change these.</p>
              )}
              <p className={hint}>
                The digest hour is in the workspace&apos;s time zone (
                {workspace.timezone}). At most {BRIEFS_PER_DAY} briefs and
                closed-lost notes a day; each one counts against the day&apos;s
                research spending limit.
              </p>
            </ActionForm>
          </section>
        </div>
      </div>
    </>
  );
}

export default function BriefsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
