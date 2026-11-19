"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarCheck,
  Check,
  Headphones,
  PhoneForwarded,
  PhoneOff,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkAvatar, Phone, StatusBar } from "./phone";

// The hero's three phones: a live call in the middle, the meeting it booked
// on the left, and the follow-up text the prospect gets on the right. The
// names are made up for the picture (Northwind Agency is the Dialvo user).

/** Counts 0..frames-1 every `ms` while the element is on screen. */
export function useTicker<T extends Element>(
  frames: number,
  ms: number,
  still = 0,
) {
  const ref = useRef<T>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setT(still));
      return () => cancelAnimationFrame(id);
    }
    let timer: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(timer);
      timer = undefined;
      if (e.isIntersecting)
        timer = setInterval(() => setT((n) => (n + 1) % frames), ms);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      clearInterval(timer);
    };
  }, [frames, ms, still]);
  return [ref, t] as const;
}

// --- The live call -------------------------------------------------------------

const LIVE: { who: "Dialvo" | "Prospect"; text: string }[] = [
  {
    who: "Dialvo",
    text: "Hi, this is Sam, an AI assistant calling for Northwind Agency. This call is recorded.",
  },
  { who: "Prospect", text: "Oh, okay. What's it about?" },
  {
    who: "Dialvo",
    text: "We build websites for dental clinics. Could I book you 20 minutes with Priya this week?",
  },
  { who: "Prospect", text: "Thursday afternoon could work." },
  {
    who: "Dialvo",
    text: "Thursday at 2pm it is. I'll text you the link now.",
  },
];

// Fixed bar heights, so the server and the browser draw the same waveform.
const WAVE = [
  8, 14, 20, 12, 26, 32, 18, 24, 34, 22, 14, 28, 36, 20, 12, 24, 30, 16, 10, 20,
  26, 14, 8, 12,
];

function LiveCallScreen() {
  // One more line every two ticks, then a pause before it starts again.
  const frames = LIVE.length * 2 + 4;
  const [ref, t] = useTicker<HTMLDivElement>(frames, 1300, frames - 1);
  const shown = Math.min(Math.floor(t / 2) + 1, LIVE.length);
  const seconds = 74 + t;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div ref={ref} className="flex h-full flex-col bg-white">
      <StatusBar />
      <div className="flex flex-col items-center px-5 pt-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-medium text-[#0B0B0C]/75">
          <span className="relative flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#0B0B0C] opacity-60 motion-reduce:hidden" />
            <span className="relative size-1.5 rounded-full bg-[#0B0B0C]" />
          </span>
          Live call · <span className="tabular-nums">{clock}</span>
        </span>
        <MarkAvatar className="mt-4 size-[58px]" />
        <p className="mt-3 text-[17px] font-semibold tracking-[-0.01em]">
          Dialvo for Northwind Agency
        </p>
        <p className="mt-0.5 text-[12.5px] text-[#8E8E93]">
          Calling Bright Smile Dental · business line
        </p>
        <div
          aria-hidden
          className="mt-4 flex h-10 items-center justify-center gap-[3px]"
        >
          {WAVE.map((h, i) => (
            <span
              key={i}
              className="dv-wave w-[3px] rounded-full bg-[#0B0B0C]"
              style={{ height: h, animationDelay: `${(i % 7) * -0.16}s` }}
            />
          ))}
        </div>
      </div>
      <div className="mx-3 mt-3 flex flex-1 flex-col justify-end gap-2 overflow-hidden rounded-[22px] bg-black/[0.035] p-3">
        <p className="text-[10.5px] font-medium tracking-wide text-[#8E8E93] uppercase">
          Live transcript
        </p>
        {LIVE.slice(0, shown)
          .slice(-4)
          .map((l) => (
            <p
              key={l.text}
              className="animate-in text-[12.5px] leading-[1.35] duration-500 fade-in slide-in-from-bottom-1"
            >
              <span
                className={cn(
                  "mr-1 text-[10.5px] font-semibold",
                  l.who === "Dialvo" ? "text-[#0B0B0C]" : "text-[#8E8E93]",
                )}
              >
                {l.who}
              </span>
              <span
                className={
                  l.who === "Dialvo" ? "text-[#0B0B0C]" : "text-[#0B0B0C]/60"
                }
              >
                {l.text}
              </span>
            </p>
          ))}
      </div>
      <div className="flex justify-around px-6 pt-4 pb-7">
        {[
          { icon: Headphones, label: "Listen" },
          { icon: PhoneForwarded, label: "Take over", on: true },
          { icon: PhoneOff, label: "End" },
        ].map((b) => (
          <span key={b.label} className="flex flex-col items-center gap-1.5">
            <span
              className={cn(
                "grid size-12 place-items-center rounded-full",
                b.on ? "bg-[#0B0B0C] text-white" : "bg-black/[0.07]",
              )}
            >
              <b.icon aria-hidden className="size-5" />
            </span>
            <span className="text-[10.5px] text-[#0B0B0C]/60">{b.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// --- The meeting it booked -----------------------------------------------------

function MeetingScreen() {
  const hours = [
    { time: "1 pm", text: "Lunch", kind: "busy" },
    { time: "2 pm", text: "Intro call · Bright Smile", kind: "new" },
    { time: "3 pm", text: "", kind: "free" },
    { time: "4 pm", text: "Client review", kind: "busy" },
  ] as const;
  return (
    <div className="flex h-full flex-col bg-[#F6F6F6]">
      <StatusBar />
      <div className="flex items-center gap-2 px-5 pt-2">
        <MarkAvatar className="size-7" />
        <span className="text-[15px] font-semibold">Dialvo</span>
        <span className="ml-auto text-[12px] text-[#8E8E93]">Meetings</span>
      </div>
      <div className="mx-3 mt-4 rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-[#0B0B0C] text-white">
            <Check aria-hidden className="size-3.5" strokeWidth={3} />
          </span>
          <span className="text-[15px] font-semibold">Meeting booked</span>
        </div>
        <p className="mt-3 text-[14px] font-medium">Bright Smile Dental</p>
        <p className="text-[12.5px] text-[#8E8E93]">Dr. Lena Ortiz · Owner</p>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-black/[0.04] px-3 py-2 text-[13px]">
          <CalendarCheck aria-hidden className="size-4" />
          Thu 21 Nov · 2:00 – 2:30 pm
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11.5px] text-[#8E8E93]">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVG */}
          <img src="/apps/google-calendar.svg" alt="" className="size-3.5" />
          Added to Google Calendar with Priya
        </div>
      </div>
      <p className="mx-5 mt-5 text-[11px] font-medium tracking-wide text-[#8E8E93] uppercase">
        Thursday
      </p>
      <ul className="mx-3 mt-2 space-y-1.5 rounded-[20px] bg-white p-3">
        {hours.map((h) => (
          <li key={h.time} className="flex items-center gap-2.5 text-[12px]">
            <span className="w-9 text-[#8E8E93] tabular-nums">{h.time}</span>
            <span
              className={cn(
                "flex h-8 flex-1 items-center justify-between gap-2 rounded-lg px-2.5",
                h.kind === "busy" && "bg-black/[0.05]",
                h.kind === "free" && "border border-dashed border-black/15",
                h.kind === "new" && "bg-[#0B0B0C] font-medium text-white",
              )}
            >
              <span className="truncate">{h.text}</span>
              {h.kind === "new" && (
                <span className="shrink-0 text-[10px] font-normal opacity-60">
                  by Dialvo
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="mx-3 mt-3 flex items-center gap-3 rounded-[20px] bg-white p-3">
        <span className="grid size-8 place-items-center rounded-full bg-[#0B0B0C] text-white">
          <Play aria-hidden className="size-3.5 fill-current" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium">
            Call recording · 1:24
          </span>
          <span className="block truncate text-[11px] text-[#8E8E93]">
            Booked on the call · confirmation text sent
          </span>
        </span>
      </div>
    </div>
  );
}

// --- The follow-up text ----------------------------------------------------------

function FollowUpScreen() {
  const bubble =
    "w-fit max-w-[82%] rounded-[18px] px-3.5 py-2 text-[14px] leading-[1.35]";
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="bg-[#F6F6F6]/90 shadow-[0_0.5px_0_rgba(0,0,0,0.16)]">
        <StatusBar />
        <div className="flex flex-col items-center pt-0.5 pb-2">
          <span className="grid size-[40px] place-items-center rounded-full bg-[#C7C7CC] text-[16px] font-medium text-white">
            N
          </span>
          <span className="mt-1 text-[11px] text-black">Northwind Agency</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1.5 overflow-hidden px-3 pb-2">
        <p className="mb-2 text-center text-[10.5px] leading-[13px] text-[#8E8E93]">
          Text Message
          <br />
          <span className="font-semibold">Today</span> 10:42
        </p>
        <p className={cn(bubble, "rounded-bl-[6px] bg-[#E9E9EB]")}>
          Hi Lena, it&apos;s Sam, the AI assistant from Northwind Agency. Thanks
          for the chat just now!
        </p>
        <p className={cn(bubble, "rounded-bl-[6px] bg-[#E9E9EB]")}>
          Here&apos;s the link to book Thursday at 2pm:{" "}
          <span className="underline">northwind.agency/book</span>
        </p>
        <p className="pl-1 text-[10.5px] text-[#8E8E93]">
          Reply STOP to opt out
        </p>
        <p
          className={cn(
            bubble,
            "mt-2 ml-auto rounded-br-[6px] bg-[#0B0B0C] text-white",
          )}
        >
          Booked. See you Thursday!
        </p>
        <p className={cn(bubble, "mt-2 rounded-bl-[6px] bg-[#E9E9EB]")}>
          Great, it&apos;s in the calendar. Priya will call you at 2pm.
        </p>
      </div>
      <div className="flex items-center gap-2 px-3 pt-1.5 pb-7">
        <span className="flex h-[32px] flex-1 items-center rounded-full border border-[#D1D1D6] px-3 text-[14px] text-[#C7C7CC]">
          Text Message
        </span>
      </div>
    </div>
  );
}

export function HeroPhones() {
  return (
    <div className="relative flex h-[560px] justify-center sm:h-[660px]">
      <div className="absolute top-12 left-1/2 hidden origin-top -translate-x-[132%] scale-[0.9] -rotate-[4deg] opacity-95 lg:block">
        <Phone label="A meeting Dialvo booked on a call, on your calendar">
          <MeetingScreen />
        </Phone>
      </div>
      <div className="absolute top-12 left-1/2 hidden origin-top translate-x-[32%] scale-[0.9] rotate-[4deg] opacity-95 lg:block">
        <Phone label="The follow-up text with the booking link">
          <FollowUpScreen />
        </Phone>
      </div>
      <div className="relative z-10 origin-top scale-[0.88] sm:scale-100">
        <Phone label="Dialvo on a live call, with the transcript as it happens">
          <LiveCallScreen />
        </Phone>
      </div>
    </div>
  );
}
