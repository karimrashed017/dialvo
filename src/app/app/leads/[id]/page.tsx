import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  ArrowLeft,
  CalendarCheck,
  Check,
  NotebookPen,
  Phone,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { dateOnly, dateTime } from "@/lib/app/time";
import {
  CHANNEL_LABEL,
  CONSENT_CHANNELS,
  CONSENT_LABEL,
  LEAD_STATUSES,
  STATUS_LABEL,
  type Channel,
  type LeadDetail,
} from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import { MarkMeetingBooked } from "../meeting";
import {
  Badge,
  btn,
  ChannelTile,
  Empty,
  hint,
  input,
  labelCls,
  leadLabel,
  PageSkeleton,
  panel,
  panelHead,
  StatusBadge,
} from "../../_ui/kit";
import {
  addNote,
  deleteLead,
  setConsent,
  setDoNotContact,
  setLeadStatus,
  updateLead,
} from "../actions";
import { LeadTimeZone } from "../../calls/lead-time-zone";

export const metadata: Metadata = { title: "Lead" };

type Entry = {
  id: string;
  at: string;
  icon?: LucideIcon;
  channel?: Channel | null;
  title: string;
  text?: string;
  tag?: string;
  href?: string;
};

/** Messages, calls, meetings and events as one list, newest first. */
function timeline(detail: LeadDetail, tz: string): Entry[] {
  const entries: Entry[] = [];
  for (const c of detail.conversations)
    for (const m of c.messages)
      entries.push({
        id: `m-${m.id}`,
        at: m.sent_at,
        channel: c.channel,
        title:
          m.author === "lead"
            ? `Message from the lead · ${CHANNEL_LABEL[c.channel]}`
            : m.author === "agent"
              ? `Agent replied · ${CHANNEL_LABEL[c.channel]}`
              : `Reply from your team · ${CHANNEL_LABEL[c.channel]}`,
        text: m.body,
        tag:
          m.direction === "out" && m.delivery_status === "not_delivered"
            ? "Saved, not delivered"
            : undefined,
        href: `/app/inbox?c=${c.id}`,
      });
  for (const call of detail.calls)
    entries.push({
      id: `c-${call.id}`,
      at: call.started_at ?? call.created_at,
      icon: Phone,
      title: `${call.direction === "inbound" ? "Inbound" : "Outbound"} call · ${call.status.replace(/_/g, " ")}${
        call.duration_seconds
          ? ` · ${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s`
          : ""
      }`,
      text: call.summary ?? undefined,
    });
  for (const m of detail.meetings)
    entries.push({
      id: `mt-${m.id}`,
      at: m.created_at,
      icon: CalendarCheck,
      title: `Meeting ${m.status === "scheduled" ? "booked" : m.status.replace(/_/g, " ")}${m.title ? `: ${m.title}` : ""}`,
      text: `Starts ${dateTime(m.starts_at, tz)}`,
    });
  for (const e of detail.events) {
    // Replies already appear as the message itself.
    if (e.kind === "reply_saved") continue;
    entries.push({
      id: `e-${e.id}`,
      at: e.created_at,
      icon:
        e.kind === "note"
          ? NotebookPen
          : e.kind === "consent_changed" || e.kind === "do_not_contact"
            ? ShieldCheck
            : e.channel
              ? undefined
              : Check,
      channel: e.channel,
      title: e.kind === "note" ? "Note" : e.summary,
      text: e.kind === "note" ? e.summary : undefined,
    });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo, workspace, preview } = await getAppContext();
  const [detail, members] = await Promise.all([repo.lead(id), repo.members()]);
  if (!detail) notFound();
  const { lead } = detail;
  const tz = workspace.timezone;
  const entries = timeline(detail, tz);

  return (
    <>
      <Link
        href="/app/leads"
        className="mb-3 inline-flex items-center gap-1.5 px-1 text-[12.5px] text-[#0B0B0C]/55 hover:text-[#0B0B0C]"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Leads
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <h1 className="text-[21px] font-medium tracking-[-0.01em]">
          {leadLabel(lead)}
        </h1>
        <StatusBadge status={lead.status} />
        {lead.do_not_contact && <Badge tone="warn">Do not contact</Badge>}
        <span className="text-[12px] text-[#0B0B0C]/45">
          Added {dateOnly(lead.created_at, tz)} · {lead.source}
        </span>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-3">
          <section className={panel}>
            <h2 className={panelHead}>Add a note</h2>
            <ActionForm action={addNote} resetOnSuccess className="p-4">
              <input type="hidden" name="lead" value={lead.id} />
              <label className="sr-only" htmlFor="note">
                Note
              </label>
              <textarea
                id="note"
                name="note"
                rows={2}
                maxLength={5000}
                required
                placeholder="What happened, what they said, what's next"
                className={input}
              />
              <div className="mt-2 flex justify-end">
                <SubmitButton small>Save note</SubmitButton>
              </div>
            </ActionForm>
          </section>

          <section className={panel}>
            <h2 className={panelHead}>
              Timeline
              <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
                Messages, calls, meetings and changes
              </span>
            </h2>
            {entries.length === 0 ? (
              <Empty title="Nothing yet">
                Messages, calls, meetings, notes and status changes for this
                lead will be listed here, newest first.
              </Empty>
            ) : (
              <ol className="px-3 py-2">
                {entries.map((e) => (
                  <li key={e.id} className="flex gap-3 px-1 py-2.5">
                    <ChannelTile channel={e.channel} icon={e.icon} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-medium">
                        {e.href ? (
                          <Link href={e.href} className="hover:underline">
                            {e.title}
                          </Link>
                        ) : (
                          e.title
                        )}
                        {e.tag && <Badge tone="outline">{e.tag}</Badge>}
                      </p>
                      {e.text && (
                        <p className="mt-0.5 text-[13px] leading-[1.5] whitespace-pre-wrap text-[#0B0B0C]/75">
                          {e.text}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11.5px] text-[#0B0B0C]/40">
                        {dateTime(e.at, tz)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <section className={panel}>
            <h2 className={panelHead}>Status</h2>
            <ActionForm action={setLeadStatus} quiet className="p-4">
              <input type="hidden" name="lead" value={lead.id} />
              <div className="flex gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Status</span>
                  <select
                    key={lead.status}
                    name="status"
                    defaultValue={lead.status}
                    className={input}
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton variant="secondary">Update</SubmitButton>
              </div>
            </ActionForm>
          </section>

          <MarkMeetingBooked leadId={lead.id} timezone={workspace.timezone} />

          <section className={panel}>
            <h2 className={panelHead}>
              Score
              <Link
                href="/app/leads/scoring"
                className="text-[12px] font-normal text-[#0B0B0C]/55 underline decoration-black/20 underline-offset-2"
              >
                How it works
              </Link>
            </h2>
            {lead.tier ? (
              <div className="space-y-2 p-4 text-[12.5px]">
                <p className="flex items-center gap-2">
                  <Badge tone={lead.tier === 1 ? "ink" : "outline"}>
                    Tier {lead.tier}
                  </Badge>
                  <span className="text-[#0B0B0C]/65 tabular-nums">
                    Fit {lead.fit_score ?? "not set"} · engagement{" "}
                    {lead.engagement_score ?? 0}
                  </span>
                </p>
                <ul className="space-y-0.5 text-[#0B0B0C]/65">
                  {(lead.score_detail?.fit ?? []).map((x) => (
                    <li key={x.label}>
                      {x.met ? "Yes" : "No"}: {x.label}
                    </li>
                  ))}
                  {(lead.score_detail?.engagement ?? []).map((x) => (
                    <li key={x.label}>
                      +{x.points}: {x.label}
                    </li>
                  ))}
                </ul>
                {lead.account_id && (
                  <Link
                    href={`/app/accounts/${lead.account_id}`}
                    className="block underline decoration-black/25 underline-offset-2"
                  >
                    Open the account
                  </Link>
                )}
              </div>
            ) : (
              <p className="p-4 text-[12.5px] text-[#0B0B0C]/55">
                Not scored yet. Scores refresh every ten minutes.
              </p>
            )}
          </section>

          <section className={panel}>
            <h2 className={panelHead}>Profile</h2>
            <ActionForm action={updateLead} className="space-y-3 p-4">
              <input type="hidden" name="lead" value={lead.id} />
              {(
                [
                  ["name", "Name", lead.name, "text", 200],
                  ["company", "Company", lead.company, "text", 200],
                  ["email", "Email", lead.email, "email", 254],
                  ["phone", "Phone", lead.phone, "tel", 40],
                  ["website", "Website", lead.website, "text", 300],
                ] as const
              ).map(([name, text, value, type, max]) => (
                <label key={name} className={labelCls}>
                  {text}
                  <input
                    name={name}
                    type={type}
                    maxLength={max}
                    defaultValue={value ?? ""}
                    className={`${input} mt-1`}
                  />
                </label>
              ))}
              <label className={labelCls}>
                Owner
                <select
                  name="owner"
                  defaultValue={lead.owner_id ?? ""}
                  className={`${input} mt-1`}
                >
                  <option value="">Nobody</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name || m.email}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end">
                <SubmitButton variant="secondary">Save profile</SubmitButton>
              </div>
            </ActionForm>
          </section>

          <section className={panel}>
            <h2 className={panelHead}>Consent</h2>
            <div className="p-4">
              <p className={hint}>
                What this person has agreed to, per channel, with when and
                where. Agents will only use a channel that says yes.
              </p>
              <ul className="mt-3 space-y-3">
                {CONSENT_CHANNELS.map((channel) => {
                  const on = lead[`consent_${channel}`];
                  const at = lead[`consent_${channel}_at`];
                  const source = lead[`consent_${channel}_source`];
                  return (
                    <li
                      key={channel}
                      className="rounded-xl border border-black/[0.07] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium">
                          {CONSENT_LABEL[channel]}
                        </span>
                        <Badge tone={on ? "ink" : "outline"}>
                          {on ? "Agreed" : "No consent"}
                        </Badge>
                      </div>
                      {on && (
                        <p className="mt-1 text-[12px] leading-[1.45] text-[#0B0B0C]/55">
                          {at && dateOnly(at, tz)}
                          {source && ` · ${source}`}
                        </p>
                      )}
                      <ActionForm
                        action={setConsent}
                        quiet
                        className="mt-2"
                        resetOnSuccess
                      >
                        <input type="hidden" name="lead" value={lead.id} />
                        <input type="hidden" name="channel" value={channel} />
                        <input
                          type="hidden"
                          name="on"
                          value={on ? "false" : "true"}
                        />
                        {on ? (
                          <SubmitButton variant="ghost" small>
                            Withdraw
                          </SubmitButton>
                        ) : (
                          <div className="flex gap-2">
                            <label className="min-w-0 flex-1">
                              <span className="sr-only">
                                How they agreed to {CONSENT_LABEL[channel]}
                              </span>
                              <input
                                name="source"
                                required
                                maxLength={100}
                                placeholder="How they agreed"
                                className={cn(input, "h-8 py-0 text-[12.5px]")}
                              />
                            </label>
                            <SubmitButton variant="secondary" small>
                              Record
                            </SubmitButton>
                          </div>
                        )}
                      </ActionForm>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {!preview && (
            <LeadTimeZone leadId={lead.id} workspaceId={workspace.id} />
          )}

          <section className={panel}>
            <h2 className={panelHead}>Do not contact</h2>
            <div className="p-4">
              <p className={hint}>
                {lead.do_not_contact
                  ? `On since ${dateOnly(lead.do_not_contact_at, tz)}. No agent will reach out to this person on any channel, whatever their consent says.`
                  : "Switch this on and no agent will reach out to this person on any channel, whatever their consent says."}
              </p>
              <ActionForm action={setDoNotContact} quiet className="mt-3">
                <input type="hidden" name="lead" value={lead.id} />
                <input
                  type="hidden"
                  name="on"
                  value={lead.do_not_contact ? "false" : "true"}
                />
                <SubmitButton
                  variant={lead.do_not_contact ? "secondary" : "danger"}
                >
                  {lead.do_not_contact
                    ? "Allow contact again"
                    : "Mark do not contact"}
                </SubmitButton>
              </ActionForm>
            </div>
          </section>

          <ActionForm
            action={deleteLead}
            confirm="Delete this lead and its conversations, calls and notes? This can't be undone."
            className="px-1"
          >
            <input type="hidden" name="lead" value={lead.id} />
            <SubmitButton
              variant="ghost"
              small
              pendingText="Deleting…"
              className={cn(btn.ghost, btn.small, "text-[#B42318]")}
            >
              Delete lead
            </SubmitButton>
          </ActionForm>
        </div>
      </div>
    </>
  );
}

export default function Page({ params }: PageProps<"/app/leads/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LeadPage params={params} />
    </Suspense>
  );
}
