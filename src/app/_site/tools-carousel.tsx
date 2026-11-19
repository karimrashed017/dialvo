"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BookOpen,
  CalendarDays,
  Check,
  FileText,
  Globe,
  LayoutDashboard,
  Mail,
  MessageSquareText,
  Phone,
  PhoneForwarded,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { card, muted } from "./theme";

// "Everything a sales team does" as a row of cards you scroll sideways, each
// with a small picture of the feature at work. Features not built yet carry
// a "Coming soon" pill.
// It scrolls by touch, trackpad, mouse drag or the arrows, and snaps to a
// card. The row starts in line with the page and runs off its right edge.

/** The framed screen in a card's top half; it runs off the card's right edge. */
function Screen({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "absolute top-6 right-0 left-6 rounded-l-2xl border border-r-0 border-black/[0.09] bg-white shadow-[0_24px_60px_-24px_rgba(0,0,0,0.18)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

const you =
  "ml-auto w-fit max-w-[85%] rounded-[18px] rounded-br-[6px] bg-[#0B0B0C] px-3.5 py-2 text-[13px] leading-snug text-white";
const them =
  "w-fit max-w-[85%] rounded-[18px] rounded-bl-[6px] bg-black/[0.08] px-3.5 py-2 text-[13px] leading-snug";

// Fixed bar heights, so the server and the browser draw the same waveform.
const WAVE = [
  6, 10, 16, 9, 20, 26, 14, 22, 30, 18, 12, 24, 28, 16, 10, 20, 14, 8, 12, 18,
  22, 12, 8, 6,
];

function CallShot() {
  return (
    <Screen className="space-y-3 p-4">
      <div className="flex items-center gap-2.5 rounded-xl bg-[#0B0B0C] px-3 py-2.5 text-white">
        <span className="grid size-7 place-items-center rounded-full bg-white text-[#0B0B0C]">
          <Phone aria-hidden className="size-3.5" />
        </span>
        <span className="flex h-8 flex-1 items-center gap-[2px]">
          {WAVE.map((h, i) => (
            <span
              key={i}
              className="dv-wave w-[2.5px] rounded-full bg-white"
              style={{ height: h, animationDelay: `${(i % 6) * -0.18}s` }}
            />
          ))}
        </span>
        <span className="text-[11.5px] tabular-nums">1:12</span>
      </div>
      <p className={them}>
        “Hi, I&apos;m an AI assistant calling for Northwind. This call is
        recorded.”
      </p>
      <div className="flex flex-wrap gap-1.5 text-[11.5px]">
        {["Recorded", "Transcribed", "Summary ready"].map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded-full border border-black/12 px-2 py-0.5 text-[#0B0B0C]/65"
          >
            <Check aria-hidden className="size-3" />
            {t}
          </span>
        ))}
      </div>
    </Screen>
  );
}

function FollowUpShot() {
  return (
    <Screen className="space-y-2.5 p-4">
      <p className="flex items-center gap-1.5 text-[11.5px] text-[#0B0B0C]/45">
        <MessageSquareText aria-hidden className="size-3.5" />
        WhatsApp · to Lena, who asked for details
      </p>
      <p className={them}>
        Here are the two options we talked about, and the link to book a time.
      </p>
      <p className={you}>Thanks! Booking Thursday now</p>
      <p className="text-[11.5px] text-[#0B0B0C]/40">
        Next nudge cancelled: she replied
      </p>
    </Screen>
  );
}

function CalendarShot() {
  const rows = [
    { time: "13:00", text: "Lunch", kind: "event" },
    { time: "14:00", text: "Intro · Harbor & Pine", kind: "added" },
    { time: "15:00", text: "Free · 3–5 pm", kind: "free" },
  ] as const;
  return (
    <Screen className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium">Thursday 21 Nov</p>
        <CalendarDays aria-hidden className="size-4 text-[#0B0B0C]/45" />
      </div>
      <ul className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <li key={r.time} className="flex items-center gap-3 text-[12.5px]">
            <span className="w-10 text-[#0B0B0C]/40 tabular-nums">
              {r.time}
            </span>
            <span
              className={cn(
                "flex flex-1 items-center justify-between rounded-lg px-2.5 py-1.5",
                r.kind === "event" && "bg-black/[0.06]",
                r.kind === "free" &&
                  "border border-dashed border-black/20 text-[#0B0B0C]/55",
                r.kind === "added" && "bg-[#0B0B0C] font-medium text-white",
              )}
            >
              {r.text}
              {r.kind === "added" && (
                <span className="text-[10.5px] font-normal opacity-60">
                  by Dialvo
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-black/[0.08] bg-black/[0.03] p-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVG */}
        <img src="/apps/google-calendar.svg" alt="" className="size-4" />
        <p className="min-w-0 flex-1 truncate text-[12px] text-[#0B0B0C]/70">
          Invite sent to marcus@harborpine.co
        </p>
      </div>
    </Screen>
  );
}

function TransferShot() {
  return (
    <Screen className="p-4">
      <p className="text-[12px] text-[#0B0B0C]/45">Live call · Harbor Realty</p>
      <p className={cn(them, "mt-3")}>
        “Can I talk to someone about pricing right now?”
      </p>
      <div className="mt-4 flex items-center gap-3 rounded-xl border border-black/[0.08] bg-black/[0.04] p-3">
        <span className="grid size-8 place-items-center rounded-lg bg-[#0B0B0C] text-white">
          <PhoneForwarded aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">Putting them through</p>
          <p className="text-[12px] text-[#0B0B0C]/50">
            To your phone, with notes
          </p>
        </div>
        <span className="rounded-full bg-[#0B0B0C] px-2.5 py-0.5 text-[11px] font-medium text-white">
          Answer
        </span>
      </div>
    </Screen>
  );
}

function VoiceShot() {
  const voices = [
    { name: "Warm and easy-going", on: false },
    { name: "Calm and direct", on: true },
    { name: "Upbeat and quick", on: false },
  ];
  return (
    <Screen className="p-4">
      <p className="text-[13px] font-medium">Voice and personality</p>
      <ul className="mt-3 space-y-1.5">
        {voices.map((v) => (
          <li
            key={v.name}
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 text-[12.5px]",
              v.on ? "bg-[#0B0B0C] text-white" : "bg-black/[0.05]",
            )}
          >
            {v.name}
            {v.on && <Check aria-hidden className="size-3.5" />}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11.5px] text-[#0B0B0C]/45">
        Premium, ultra-realistic voices on Pro
      </p>
    </Screen>
  );
}

function FinderShot() {
  const rows = ["Harbor & Pine Marketing", "Lakeview Creative", "Signal North"];
  return (
    <Screen className="p-4">
      <div className="flex items-center gap-2 rounded-xl border border-black/[0.1] px-3 py-2 text-[12.5px]">
        <Search aria-hidden className="size-3.5 text-[#0B0B0C]/45" />
        Marketing agencies in Chicago, 5–20 staff
      </div>
      <ul className="mt-3 divide-y divide-black/[0.06] rounded-xl border border-black/[0.08] bg-black/[0.03]">
        {rows.map((r) => (
          <li
            key={r}
            className="flex items-center justify-between px-3 py-2 text-[12.5px]"
          >
            {r}
            <span className="text-[11px] text-[#0B0B0C]/45">Researched</span>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

function EmailShot() {
  return (
    <Screen className="p-4">
      <div className="flex items-center gap-2 text-[12px] text-[#0B0B0C]/50">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVG */}
        <img src="/apps/gmail.svg" alt="" className="size-3.5" />
        From you@northwind.agency
      </div>
      <p className="mt-3 text-[13px] font-medium">
        Your second clinic&apos;s booking page
      </p>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[#0B0B0C]/65">
        Hi Lena, congrats on opening in Round Rock. Patients there can&apos;t
        book online yet. Worth a 15-minute call?
      </p>
      <p className="mt-3 text-[11.5px] text-[#0B0B0C]/40">
        Written for this lead · sent from your own inbox
      </p>
    </Screen>
  );
}

function KnowledgeShot() {
  const items = [
    { icon: FileText, name: "Pitch deck.pdf" },
    { icon: FileText, name: "Pricing 2026.pdf" },
    { icon: Globe, name: "northwind.agency" },
  ];
  return (
    <Screen className="p-4">
      <p className="text-[13px] font-medium">What Dialvo knows</p>
      <ul className="mt-3 divide-y divide-black/[0.06] rounded-xl border border-black/[0.08] bg-black/[0.03]">
        {items.map((it) => (
          <li
            key={it.name}
            className="flex items-center gap-3 px-3 py-2 text-[12.5px]"
          >
            <it.icon aria-hidden className="size-4 text-[#0B0B0C]/60" />
            <span className="flex-1">{it.name}</span>
            <Check aria-hidden className="size-3.5 text-[#0B0B0C]/45" />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11.5px] text-[#0B0B0C]/45">
        Answers objections from what you upload
      </p>
    </Screen>
  );
}

function DashboardShot() {
  const rows = ["Calls", "Conversations", "Meetings booked"];
  return (
    <Screen className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium">This week</p>
        <span className="flex items-center gap-1.5 text-[11px] text-[#0B0B0C]/50">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVG */}
          <img src="/apps/hubspot.svg" alt="" className="size-3" />
          Synced
        </span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r, i) => (
          <li key={r} className="text-[12px]">
            <span className="text-[#0B0B0C]/60">{r}</span>
            <span className="mt-1 block h-1.5 rounded-full bg-black/[0.06]">
              <span
                className="block h-full rounded-full bg-[#0B0B0C]"
                style={{ width: `${90 - i * 30}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

const TOOLS = [
  {
    icon: Phone,
    title: "AI voice calls",
    body: "A natural voice that says it's an AI. Every call recorded and transcribed.",
    Shot: CallShot,
  },
  {
    icon: MessageSquareText,
    title: "Text and WhatsApp follow-up",
    body: "Keeps the conversation going with people who opted in, until they say yes or no.",
    Shot: FollowUpShot,
  },
  {
    icon: CalendarDays,
    title: "Meetings on your calendar",
    body: "Books the time on Google Calendar and sends the invite while they're still on the line.",
    Shot: CalendarShot,
  },
  {
    icon: PhoneForwarded,
    title: "Live transfer to you",
    body: "When someone wants a person, the call comes straight to your phone.",
    Shot: TransferShot,
  },
  {
    icon: AudioLines,
    title: "Your voice, your style",
    body: "Pick the voice and personality, and the pitch it follows.",
    Shot: VoiceShot,
  },
  {
    icon: Search,
    title: "Prospect finder",
    body: "Describe your ideal customer. Dialvo finds the businesses and researches each one.",
    Shot: FinderShot,
    soon: true,
  },
  {
    icon: Mail,
    title: "AI email from your inbox",
    body: "A personal email for each lead, sent from your own Gmail or Outlook. Replies answered.",
    Shot: EmailShot,
    soon: true,
  },
  {
    icon: BookOpen,
    title: "Knowledge base",
    body: "Upload your docs, site and pitch, so it answers questions and objections like you would.",
    Shot: KnowledgeShot,
    soon: true,
  },
  {
    icon: LayoutDashboard,
    title: "Dashboard and CRM sync",
    body: "Calls, conversations and meetings in one place, synced to HubSpot or Pipedrive.",
    Shot: DashboardShot,
    soon: true,
  },
];

export function ToolsCarousel() {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // One step is a card's width plus the gap.
  const step = useCallback(() => {
    const el = track.current;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !first) return 1;
    return (
      first.offsetWidth + parseFloat(getComputedStyle(el).columnGap || "0")
    );
  }, []);

  // Where a glide started by the arrows or dots is heading, so a second
  // click mid-glide moves on from there instead of repeating the same card.
  const heading = useRef<number | null>(null);

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    // Arrived (Safari has no scrollend event).
    if (
      heading.current !== null &&
      Math.abs(el.scrollLeft - heading.current) < 2
    )
      heading.current = null;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(end);
    setIndex(end ? TOOLS.length - 1 : Math.round(el.scrollLeft / step()));
  }, [step]);

  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const done = () => (heading.current = null);
    el.addEventListener("scrollend", done);
    return () => el.removeEventListener("scrollend", done);
  }, []);

  const go = (to: number) => {
    const el = track.current;
    if (!el) return;
    const i = Math.max(0, Math.min(TOOLS.length - 1, to));
    const left = Math.min(i * step(), el.scrollWidth - el.clientWidth);
    heading.current = left;
    el.scrollTo({ left, behavior: "smooth" });
  };

  // The arrows step from where the row really is, not from the highlighted
  // dot: at the far end the last dot is lit, but the row can only scroll to
  // an earlier card, so stepping back from the dot would go nowhere.
  const nudge = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const at = (heading.current ?? el.scrollLeft) / step();
    go(dir > 0 ? Math.floor(at + 0.01) + 1 : Math.ceil(at - 0.01) - 1);
  };

  // Drag to scroll with a mouse; touch and trackpads scroll natively.
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !track.current) return;
    heading.current = null;
    drag.current = {
      x: e.clientX,
      left: track.current.scrollLeft,
      moved: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = track.current;
    const d = drag.current;
    if (!el || !d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
      el.style.scrollSnapType = "none";
      el.style.cursor = "grabbing";
    }
    if (d.moved) el.scrollLeft = d.left - dx;
  };
  const onPointerUp = () => {
    const el = track.current;
    const d = drag.current;
    drag.current = null;
    if (!el || !d?.moved) return;
    el.style.cursor = "";
    const i = Math.round(el.scrollLeft / step());
    el.scrollTo({ left: i * step(), behavior: "smooth" });
    // Snap back on once the glide has settled.
    setTimeout(() => (el.style.scrollSnapType = ""), 450);
  };

  return (
    <div className="mt-16">
      <div
        ref={track}
        onScroll={update}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="region"
        aria-label="What Dialvo does for your sales"
        tabIndex={0}
        className="flex cursor-grab snap-x snap-mandatory scroll-px-[max(1.25rem,calc((100vw-1180px)/2))] [scrollbar-width:none] gap-3 overflow-x-auto px-[max(1.25rem,calc((100vw-1180px)/2))] pb-2 outline-none select-none [&::-webkit-scrollbar]:hidden"
      >
        {TOOLS.map((t) => (
          <article
            key={t.title}
            className={cn(
              card,
              "flex w-[min(84vw,380px)] shrink-0 snap-start flex-col overflow-hidden",
            )}
          >
            <div className="relative h-[268px] overflow-hidden">
              <t.Shot />
              {/* The screen fades into the card above the words. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-white" />
            </div>
            <div className="px-7 pt-2 pb-7">
              <p className="flex items-center gap-2.5 text-[17px] font-medium">
                <t.icon aria-hidden className="size-[18px] text-[#0B0B0C]/70" />
                {t.title}
                {"soon" in t && t.soon && (
                  <span className="rounded-full border border-dashed border-black/25 px-2 py-0.5 text-[11px] font-medium text-[#0B0B0C]/55">
                    Coming soon
                  </span>
                )}
              </p>
              <p className={`mt-2 text-[14.5px] leading-[1.55] ${muted}`}>
                {t.body}
              </p>
            </div>
          </article>
        ))}
      </div>

      <div className="mx-auto mt-8 flex max-w-[1180px] items-center justify-between px-5 xl:px-0">
        <div className="flex items-center gap-2">
          {TOOLS.map((t, i) => (
            <button
              key={t.title}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show ${t.title}`}
              aria-current={i === index}
              className="group py-2"
            >
              <span
                className={cn(
                  "block h-[2px] rounded-full transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  i === index
                    ? "w-10 bg-[#0B0B0C] sm:w-16"
                    : "w-5 bg-black/20 group-hover:bg-black/40 sm:w-8",
                )}
              />
            </button>
          ))}
        </div>
        {/* Phones swipe; the arrows are for mouse and keyboard. */}
        <div className="hidden gap-2 sm:flex">
          <button
            type="button"
            onClick={() => nudge(-1)}
            disabled={atStart}
            aria-label="Previous"
            className="grid size-12 place-items-center rounded-full border border-black/15 transition-colors hover:bg-black/[0.08] disabled:pointer-events-none disabled:opacity-35"
          >
            <ArrowLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => nudge(1)}
            disabled={atEnd}
            aria-label="Next"
            className="grid size-12 place-items-center rounded-full border border-black/15 transition-colors hover:bg-black/[0.08] disabled:pointer-events-none disabled:opacity-35"
          >
            <ArrowRight aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
