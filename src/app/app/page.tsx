import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  Activity,
  ArrowRight,
  CalendarCheck,
  Check,
  FileUp,
  NotebookPen,
  PenLine,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago, dateTime } from "@/lib/app/time";
import {
  CHANNEL_LABEL,
  STATUS_LABEL,
  type FeedEvent,
  type LeadStatus,
  type TodayData,
} from "@/lib/app/types";
import { cn } from "@/lib/utils";
import {
  btn,
  ChannelTile,
  Empty,
  Initial,
  leadLabel,
  PageSkeleton,
  panel,
  panelHead,
} from "./_ui/kit";

export const metadata: Metadata = { title: "Today" };

const EVENT_ICON: Record<string, LucideIcon> = {
  note: NotebookPen,
  lead_created: UserPlus,
  lead_imported: FileUp,
  lead_status_changed: Check,
  meeting_booked: CalendarCheck,
  consent_changed: PenLine,
};

function Tiles({ today }: { today: TodayData }) {
  const tiles = [
    {
      label: "Conversations",
      value: today.conversationsToday,
      note:
        today.conversationsToday === 0
          ? "none active today"
          : `across ${today.channelsToday} ${today.channelsToday === 1 ? "channel" : "channels"} today`,
      href: "/app/inbox?queue=all",
    },
    {
      label: "Leads qualified",
      value: today.qualifiedToday,
      note: "moved to Qualified today",
      href: "/app/leads?status=qualified",
    },
    {
      label: "Meetings booked",
      value: today.meetingsBookedToday,
      note: "booked today",
      href: "/app/leads?status=meeting_booked",
    },
    {
      label: "Waiting for you",
      value: today.waitingForYou,
      note: "conversations to answer",
      href: "/app/inbox",
      alert: today.waitingForYou > 0,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
      {tiles.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          className="rounded-2xl border border-black/[0.07] bg-white px-4 py-3 transition-colors hover:border-black/20 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
        >
          <dt className="flex items-center gap-1.5 text-[11.5px] text-[#0B0B0C]/55">
            {t.label}
            {t.alert && <span className="size-1.5 rounded-full bg-[#1F3BFF]" />}
          </dt>
          <dd className="mt-1 text-[26px] leading-none font-medium tracking-[-0.02em] tabular-nums">
            {t.value}
          </dd>
          <dd className="mt-1.5 truncate text-[11px] text-[#0B0B0C]/40">
            {t.note}
          </dd>
        </Link>
      ))}
    </dl>
  );
}

function Feed({ events }: { events: FeedEvent[] }) {
  return (
    <section className={cn(panel, "lg:min-h-[300px]")}>
      <h2 className={panelHead}>Activity</h2>
      {events.length === 0 ? (
        <Empty icon={Activity} title="Nothing has happened yet">
          New leads, replies, status changes and notes show up here as they
          happen.
        </Empty>
      ) : (
        <ul className="px-2 py-1.5">
          {events.map((e) => {
            const body = (
              <>
                <ChannelTile channel={e.channel} icon={EVENT_ICON[e.kind]} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[12.5px] leading-[1.35] font-medium">
                    {e.summary}
                  </span>
                  <span className="block truncate text-[11.5px] text-[#0B0B0C]/50">
                    {[
                      e.channel && CHANNEL_LABEL[e.channel],
                      e.lead && leadLabel(e.lead),
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Workspace"}
                  </span>
                </span>
                <span className="shrink-0 pt-0.5 text-[11px] text-[#0B0B0C]/40 tabular-nums">
                  {ago(e.created_at)}
                </span>
              </>
            );
            const row = "flex items-start gap-3 rounded-xl px-2 py-[9px]";
            return (
              <li key={e.id}>
                {e.lead ? (
                  <Link
                    href={`/app/leads/${e.lead.id}`}
                    className={cn(row, "hover:bg-black/[0.035]")}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className={row}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const STAGES: LeadStatus[] = ["new", "engaged", "qualified", "meeting_booked"];

function Pipeline({ today, timezone }: { today: TodayData; timezone: string }) {
  const max = Math.max(1, ...STAGES.map((s) => today.pipeline[s]));
  return (
    <section className={panel}>
      <h2 className={panelHead}>
        Pipeline
        <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
          All leads
        </span>
      </h2>
      <ul className="space-y-2.5 px-4 pt-4">
        {STAGES.map((s, i) => (
          <li key={s}>
            <Link href={`/app/leads?status=${s}`} className="group block">
              <span className="flex justify-between text-[12px]">
                <span className="text-[#0B0B0C]/65 group-hover:text-[#0B0B0C]">
                  {STATUS_LABEL[s]}
                </span>
                <span className="tabular-nums">{today.pipeline[s]}</span>
              </span>
              <span className="mt-1 block h-1.5 rounded-full bg-black/[0.06]">
                <span
                  className="block h-full rounded-full bg-[#0B0B0C]"
                  style={{
                    width: `${(today.pipeline[s] / max) * 100}%`,
                    opacity: 0.35 + i * 0.2,
                  }}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="px-4 pt-3 text-[11.5px] text-[#0B0B0C]/45">
        {today.pipeline.won} won · {today.pipeline.lost} lost ·{" "}
        {today.pipeline.unsubscribed} unsubscribed
      </p>
      <p className="px-4 pt-5 text-[11px] tracking-wide text-[#0B0B0C]/45 uppercase">
        Upcoming meetings
      </p>
      {today.upcoming.length === 0 ? (
        <p className="px-4 pt-2 pb-4 text-[12.5px] leading-[1.5] text-[#0B0B0C]/50">
          None booked. Meetings your agents and your team book will be listed
          here.
        </p>
      ) : (
        <ul className="space-y-1.5 px-3 pt-2 pb-3">
          {today.upcoming.map((m) => (
            <li key={m.id}>
              <Link
                href={`/app/leads/${m.lead_id}`}
                className="flex items-center gap-2.5 rounded-xl bg-black/[0.035] px-2.5 py-2 hover:bg-black/[0.06]"
              >
                <Initial
                  name={m.lead ? leadLabel(m.lead) : "?"}
                  className="size-6 text-[10.5px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">
                    {m.lead ? leadLabel(m.lead) : m.title || "Meeting"}
                  </span>
                  <span className="block truncate text-[11px] text-[#0B0B0C]/50">
                    {dateTime(m.starts_at, timezone)}
                    {m.channel && ` · booked by ${CHANNEL_LABEL[m.channel]}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Shown until the workspace has its first lead: what to do, in order. */
function GetStarted() {
  const steps = [
    {
      title: "Add your leads",
      text: "Type one in, or import a CSV from your CRM or a spreadsheet.",
      href: "/app/leads",
      action: "Go to leads",
    },
    {
      title: "Put the form on your site",
      text: "Copy the snippet and every enquiry lands in your inbox.",
      href: "/app/settings#forms",
      action: "Get the snippet",
    },
    {
      title: "Teach your agents",
      text: "Add pricing, FAQs and how you qualify to the knowledge base.",
      href: "/app/knowledge",
      action: "Open knowledge",
    },
    {
      title: "Write their instructions",
      text: "Set each agent's rules, approval mode and sending hours.",
      href: "/app/agents",
      action: "Set up agents",
    },
  ];
  return (
    <section className={cn(panel, "p-4 sm:p-5")}>
      <h2 className="text-[15px] font-medium">Get your workspace ready</h2>
      <p className="mt-1 max-w-[560px] text-[13px] leading-[1.5] text-[#0B0B0C]/55">
        Nothing here yet, so the numbers above are zero. These four steps put
        real leads and conversations on this page.
      </p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="flex flex-col rounded-xl border border-black/[0.07] p-3.5"
          >
            <span className="text-[11px] text-[#0B0B0C]/40 tabular-nums">
              {i + 1}
            </span>
            <span className="mt-1 text-[13.5px] font-medium">{s.title}</span>
            <span className="mt-1 flex-1 text-[12.5px] leading-[1.45] text-[#0B0B0C]/55">
              {s.text}
            </span>
            <Link
              href={s.href}
              className={cn(btn.secondary, btn.small, "mt-3 self-start")}
            >
              {s.action}
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

async function Today() {
  const { workspace, repo, user } = await getAppContext();
  const [today, waiting] = await Promise.all([
    repo.today(),
    repo.conversations("waiting"),
  ]);
  const leads = Object.values(today.pipeline).reduce((a, b) => a + b, 0);
  const date = new Date().toLocaleDateString("en-US", {
    timeZone: workspace.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h1 className="text-[19px] font-medium tracking-[-0.01em]">
          Today
          {user.name && (
            <span className="font-normal text-[#0B0B0C]/45">
              {" "}
              · {user.name.split(" ")[0]}
            </span>
          )}
        </h1>
        <p className="text-[12px] text-[#0B0B0C]/45">
          {date} · {workspace.timezone.replace(/_/g, " ")}
        </p>
      </div>
      <Tiles today={today} />
      {leads === 0 && today.feed.length === 0 && <GetStarted />}
      <div className="grid items-start gap-3 lg:grid-cols-[1.2fr_1fr_0.85fr]">
        <Feed events={today.feed} />
        <section className={cn(panel, "lg:min-h-[300px]")}>
          <h2 className={panelHead}>
            Waiting for you
            <Link
              href="/app/inbox"
              className="text-[11.5px] font-normal text-[#0B0B0C]/50 hover:text-[#0B0B0C]"
            >
              Open inbox
            </Link>
          </h2>
          {waiting.length === 0 ? (
            <Empty icon={Check} title="You're all caught up">
              Conversations that need a person, like a new form enquiry or a
              handoff from an agent, queue up here.
            </Empty>
          ) : (
            <ul className="px-2 py-1.5">
              {waiting.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/app/inbox?c=${c.id}`}
                    className="flex items-start gap-3 rounded-xl px-2 py-[9px] hover:bg-black/[0.035]"
                  >
                    <ChannelTile channel={c.channel} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] leading-[1.35] font-medium">
                        {leadLabel(c.lead)}
                      </span>
                      <span className="block truncate text-[11.5px] text-[#0B0B0C]/50">
                        {c.preview ?? `New ${CHANNEL_LABEL[c.channel]} enquiry`}
                      </span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-[11px] text-[#0B0B0C]/40 tabular-nums">
                      {ago(c.last_message_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <Pipeline today={today} timezone={workspace.timezone} />
      </div>
    </div>
  );
}

export default function TodayPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Today />
    </Suspense>
  );
}
