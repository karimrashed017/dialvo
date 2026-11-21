"use client";

import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarCheck,
  Check,
  Inbox,
  ListTree,
  Mail,
  MessageCircle,
  MessageSquareText,
  Phone,
  PhoneForwarded,
  Search,
  Share2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { MarkAvatar } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { useTicker } from "./motion";

// The hero's product shot: Dialvo's workspace, drawn in HTML so the text
// stays sharp at any size. Everything in it is sample data for a made-up
// business (Northwind Agency), and the frame says so: the counts are an
// example day, not results anyone achieved.

const NAV: { icon: LucideIcon; label: string; count?: number }[] = [
  { icon: Inbox, label: "Inbox", count: 2 },
  { icon: Bot, label: "Agents" },
  { icon: ListTree, label: "Sequences" },
  { icon: Users, label: "Leads" },
  { icon: Phone, label: "Calls" },
  { icon: BarChart3, label: "Analytics" },
  { icon: BookOpen, label: "Knowledge" },
];

const TILES = [
  { label: "Conversations", value: 48, note: "across 5 channels" },
  { label: "Leads qualified", value: 9, note: "against your criteria" },
  { label: "Meetings booked", value: 4, note: "on your reps' calendars" },
  { label: "Waiting for you", value: 2, note: "approvals and handoffs" },
];

type Event = { icon: LucideIcon; channel: string; what: string; who: string };

const EVENTS: Event[] = [
  {
    icon: Phone,
    channel: "Voice",
    what: "Answered a call from a new lead and qualified them",
    who: "Bright Smile Dental",
  },
  {
    icon: Mail,
    channel: "Email",
    what: "Answered a pricing question in a reply",
    who: "Harbor & Pine Marketing",
  },
  {
    icon: MessageCircle,
    channel: "Chat",
    what: "Booked a meeting from the website chat",
    who: "Cedar Lane Fitness",
  },
  {
    icon: MessageSquareText,
    channel: "WhatsApp",
    what: "Followed up after a missed call",
    who: "Maple Street Bakery",
  },
  {
    icon: Share2,
    channel: "Social",
    what: "Continued a conversation in direct messages",
    who: "Juniper Yoga Studio",
  },
  {
    icon: PhoneForwarded,
    channel: "Voice",
    what: "Handed a live call to Priya, with a summary",
    who: "Fernhill Vets",
  },
  {
    icon: Mail,
    channel: "Email",
    what: "Drafted a renewal note, waiting for approval",
    who: "Oakfield Dental Lab",
  },
  {
    icon: MessageSquareText,
    channel: "SMS",
    what: "Confirmed tomorrow's meeting by text",
    who: "Bright Smile Dental",
  },
];

const AGO = ["now", "2m", "6m", "11m", "17m"];

const CHAT: { who: "Visitor" | "Dialvo"; text: string }[] = [
  { who: "Visitor", text: "Do you redesign sites for gyms?" },
  {
    who: "Dialvo",
    text: "We do. How many locations do you run, and is the site on a builder today?",
  },
  { who: "Visitor", text: "Two locations. It's on an old template." },
  {
    who: "Dialvo",
    text: "That's a good fit. Priya has Thursday at 2:00 pm free. Shall I book it?",
  },
  { who: "Visitor", text: "Yes please." },
];

const STAGES = [
  { label: "New", n: 14 },
  { label: "Engaged", n: 9 },
  { label: "Qualified", n: 6 },
  { label: "Meeting booked", n: 4 },
];

const MEETINGS = [
  { when: "Today 3:30 pm", who: "Bright Smile Dental", rep: "P", by: "Voice" },
  { when: "Thu 2:00 pm", who: "Cedar Lane Fitness", rep: "P", by: "Chat" },
  { when: "Fri 11:00 am", who: "Harbor & Pine", rep: "J", by: "Email" },
];

const panel =
  "flex min-h-0 min-w-0 flex-col rounded-2xl border border-black/[0.07] bg-white";
const panelHead =
  "flex h-11 shrink-0 items-center justify-between border-b border-black/[0.06] px-4 text-[12.5px] font-medium";

function Feed() {
  const n = EVENTS.length;
  const [ref, t] = useTicker<HTMLDivElement>(n, 2600, 0);
  const shown = AGO.map((_, i) => (t - i + n * 2) % n);
  return (
    <div ref={ref} className={cn(panel, "h-[236px] sm:h-[348px] lg:h-full")}>
      <div className={panelHead}>
        Agent activity
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-normal text-[#0B0B0C]/50">
          <span className="relative flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#1F3BFF] opacity-50 motion-reduce:hidden" />
            <span className="relative size-1.5 rounded-full bg-[#1F3BFF]" />
          </span>
          Live
        </span>
      </div>
      <ul className="flex-1 overflow-hidden px-2 py-1.5">
        {shown.map((idx, i) => {
          const e = EVENTS[idx];
          return (
            <li
              key={idx}
              className={cn(
                "flex items-start gap-3 rounded-xl px-2 py-[9px]",
                i === 0 &&
                  "animate-in bg-black/[0.035] duration-700 fade-in slide-in-from-top-2",
              )}
            >
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-black/[0.08] bg-white">
                <e.icon aria-hidden className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] leading-[1.35] font-medium">
                  {e.what}
                </span>
                <span className="block truncate text-[11.5px] text-[#0B0B0C]/50">
                  {e.channel} · {e.who}
                </span>
              </span>
              <span className="shrink-0 pt-0.5 text-[11px] text-[#0B0B0C]/40 tabular-nums">
                {AGO[i]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LiveConversation() {
  const frames = CHAT.length + 4;
  const [ref, t] = useTicker<HTMLDivElement>(frames, 1700, frames - 1);
  const shown = Math.min(t + 1, CHAT.length);
  const booked = t >= CHAT.length;
  return (
    <div ref={ref} className={cn(panel, "hidden h-[348px] sm:flex lg:h-full")}>
      <div className={panelHead}>
        <span className="flex min-w-0 items-center gap-2">
          <MessageCircle aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">Website chat · Cedar Lane</span>
        </span>
        <span className="shrink-0 rounded-full bg-[#1F3BFF] px-2 py-0.5 text-[10.5px] text-white">
          Live
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1.5 overflow-hidden px-3 py-3">
        {CHAT.slice(0, shown).map((m) => (
          <p
            key={m.text}
            className={cn(
              "w-fit max-w-[86%] animate-in rounded-2xl px-3 py-1.5 text-[12.5px] leading-[1.4] duration-500 fade-in slide-in-from-bottom-1",
              m.who === "Dialvo"
                ? "ml-auto rounded-br-md bg-[#0B0B0C] text-white"
                : "rounded-bl-md bg-black/[0.055]",
            )}
          >
            {m.text}
          </p>
        ))}
        <p
          className={cn(
            "mt-1 flex items-center gap-2 rounded-xl border border-black/[0.08] px-3 py-2 text-[12px] transition-opacity duration-500",
            booked ? "opacity-100" : "opacity-0",
          )}
        >
          <CalendarCheck aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">Meeting booked · Thu 2:00 pm · Priya</span>
          <Check aria-hidden className="ml-auto size-3.5 shrink-0" />
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-black/[0.06] px-3 py-2.5">
        <span className="flex h-8 flex-1 items-center rounded-full bg-black/[0.045] px-3 text-[12px] text-[#0B0B0C]/40">
          Dialvo is replying…
        </span>
        <span className="flex h-8 items-center rounded-full border border-black/15 px-3 text-[12px] font-medium">
          Take over
        </span>
      </div>
    </div>
  );
}

function Pipeline() {
  const max = STAGES[0].n;
  return (
    <div className={cn(panel, "hidden sm:flex lg:h-full")}>
      <div className={panelHead}>
        Pipeline
        <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
          This week
        </span>
      </div>
      <ul className="space-y-2.5 px-4 pt-4">
        {STAGES.map((s, i) => (
          <li key={s.label}>
            <span className="flex justify-between text-[12px]">
              <span className="text-[#0B0B0C]/65">{s.label}</span>
              <span className="tabular-nums">{s.n}</span>
            </span>
            <span className="mt-1 block h-1.5 rounded-full bg-black/[0.06]">
              <span
                className="block h-full rounded-full bg-[#0B0B0C]"
                style={{
                  width: `${(s.n / max) * 100}%`,
                  opacity: 0.35 + i * 0.2,
                }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p className="px-4 pt-5 text-[11px] tracking-wide text-[#0B0B0C]/45 uppercase">
        Upcoming meetings
      </p>
      <ul className="space-y-1.5 px-3 pt-2 pb-3">
        {MEETINGS.map((m) => (
          <li
            key={m.who}
            className="flex items-center gap-2.5 rounded-xl bg-black/[0.035] px-2.5 py-2"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#0B0B0C] text-[10.5px] font-medium text-white">
              {m.rep}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">
                {m.who}
              </span>
              <span className="block truncate text-[11px] text-[#0B0B0C]/50">
                {m.when} · booked by {m.by}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Dashboard() {
  return (
    <figure
      aria-label="An example Dialvo workspace: today's activity across voice, email, chat, social, SMS and WhatsApp, the pipeline, and a live website chat. Sample data."
      className="overflow-hidden rounded-[22px] border border-black/[0.09] bg-[#FBFAF8] text-left shadow-[0_1px_2px_rgba(0,0,0,0.05),0_50px_100px_-40px_rgba(40,30,20,0.55)]"
    >
      {/* The window bar */}
      <div className="flex h-11 items-center gap-3 border-b border-black/[0.07] bg-white px-4">
        <span aria-hidden className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2.5 rounded-full bg-black/[0.12]" />
          ))}
        </span>
        <span className="hidden h-7 flex-1 items-center gap-2 rounded-lg bg-black/[0.04] px-3 text-[12px] text-[#0B0B0C]/40 sm:flex sm:max-w-[320px]">
          <Search aria-hidden className="size-3.5" />
          Search leads, calls and messages
        </span>
        <span className="ml-auto rounded-full border border-black/15 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-[#0B0B0C]/60 uppercase">
          Example workspace
        </span>
      </div>

      <div className="flex lg:h-[536px]">
        {/* The sidebar */}
        <aside className="hidden w-[204px] shrink-0 flex-col border-r border-black/[0.07] bg-white/70 p-3 lg:flex">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <MarkAvatar className="size-7" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">
                Northwind Agency
              </span>
              <span className="block text-[11px] text-[#0B0B0C]/45">
                Sample data
              </span>
            </span>
          </div>
          <ul className="mt-4 space-y-0.5">
            {NAV.map((n, i) => (
              <li
                key={n.label}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px]",
                  i === 0 ? "bg-[#0B0B0C] text-white" : "text-[#0B0B0C]/65",
                )}
              >
                <n.icon aria-hidden className="size-4" />
                {n.label}
                {n.count && (
                  <span className="ml-auto rounded-full bg-white/20 px-1.5 text-[11px] tabular-nums">
                    {n.count}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-auto rounded-xl border border-black/[0.07] bg-white p-3">
            <p className="text-[11px] text-[#0B0B0C]/45">Agents on</p>
            <p className="mt-1 text-[12.5px] leading-[1.4]">
              Inbound, outbound and expansion
            </p>
          </div>
        </aside>

        {/* The day */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
          <div className="flex items-baseline justify-between px-1">
            <p className="text-[15px] font-medium">Today</p>
            <p className="text-[11.5px] text-[#0B0B0C]/45">
              An example day, not real results
            </p>
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
            {TILES.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-black/[0.07] bg-white px-4 py-3"
              >
                <dt className="text-[11.5px] text-[#0B0B0C]/55">{s.label}</dt>
                <dd className="mt-1 text-[26px] leading-none font-medium tracking-[-0.02em] tabular-nums">
                  {s.value}
                </dd>
                <dd className="mt-1.5 truncate text-[11px] text-[#0B0B0C]/40">
                  {s.note}
                </dd>
              </div>
            ))}
          </dl>
          <div className="grid min-h-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_0.85fr]">
            <Feed />
            <LiveConversation />
            <div className="min-w-0 sm:col-span-2 lg:col-span-1 lg:h-full">
              <Pipeline />
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
