"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// The live top halves of the home page's three product cards. Each plays a
// short loop while it's on screen: Dialvo researching a business, calling
// it and booking the meeting, and working through a day's list. People who
// ask for less motion see the finished state, still. The businesses are
// made up for the picture.

const TICK = 600;

/** A frame counter that loops 0..frames-1 while the element is on screen. */
function useLoop<T extends Element>(frames: number, still: number) {
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
        timer = setInterval(() => setT((n) => (n + 1) % frames), TICK);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      clearInterval(timer);
    };
  }, [frames, still]);
  return [ref, t] as const;
}

const fade = "transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]";

// --- Researches every lead -------------------------------------------------------

const FACTS = [
  "Owner: Dr. Lena Ortiz",
  "Business line listed",
  "Opened a second clinic",
  "No online booking",
  "Hiring a receptionist",
  "Site last updated 2019",
];

// Which fact Dialvo turns into a reason to talk.
const USES = [
  { chip: 2, text: "Opener: “Congrats on the second clinic…”" },
  { chip: 3, text: "Pitch: online booking for both clinics" },
  { chip: 0, text: "Asks for Dr. Ortiz by name" },
];

export function ResearchPanel() {
  // Frames 0-5: the facts arrive one by one. Then each use shows for 4.
  const learn = FACTS.length;
  const [ref, t] = useLoop<HTMLDivElement>(learn + USES.length * 4, learn + 1);
  const use = t >= learn ? USES[Math.floor((t - learn) / 4)] : null;
  return (
    <div
      ref={ref}
      className="relative h-[300px] border-b border-black/[0.06] p-6"
    >
      <p className="text-[12.5px] text-[#0B0B0C]/45">
        Researching · Bright Smile Dental
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {FACTS.map((m, i) => (
          <span
            key={m}
            className={cn(
              fade,
              "rounded-full border px-3 py-1.5 text-[13.5px]",
              use?.chip === i
                ? "border-[#0B0B0C] bg-[#0B0B0C] text-white"
                : "border-black/12 bg-black/[0.04]",
              i <= t ? "scale-100 opacity-100" : "scale-90 opacity-0",
            )}
          >
            {m}
          </span>
        ))}
      </div>
      <p
        key={use?.text ?? "idle"}
        className="absolute right-6 bottom-6 left-6 animate-in text-[13px] text-[#0B0B0C]/45 duration-500 fade-in slide-in-from-bottom-1"
      >
        {use ? (
          <span className="text-[#0B0B0C]/75">{use.text}</span>
        ) : (
          "Every call starts with a reason to talk."
        )}
      </p>
    </div>
  );
}

// --- Calls and books -------------------------------------------------------------

const STEPS = [
  "Checked the Do Not Call list",
  "Said it's an AI, and that it's recorded",
  "Answered “we already have someone”",
  "Offered Thursday or Friday",
];

export function CallPanel() {
  // Two frames a step, four waiting for a time, then the booking.
  const waitAt = STEPS.length * 2;
  const yesAt = waitAt + 4;
  const [ref, t] = useLoop<HTMLDivElement>(yesAt + 5, yesAt + 1);
  return (
    <div
      ref={ref}
      className="relative h-[300px] border-b border-black/[0.06] p-6"
    >
      <p className="text-[12.5px] text-[#0B0B0C]/45">
        Calling Bright Smile Dental · business line
      </p>
      <ul className="mt-5 space-y-3">
        {STEPS.map((s, i) => {
          const state = t >= i * 2 + 2 ? "done" : t >= i * 2 ? "doing" : "todo";
          return (
            <li
              key={s}
              className={cn(
                fade,
                "flex items-center gap-3 text-[14px]",
                state === "todo" && "translate-y-1 opacity-0",
                state === "doing" && "text-[#0B0B0C]/60",
              )}
            >
              {state === "done" ? (
                <span className="grid size-5 animate-in place-items-center rounded-full bg-[#0B0B0C] text-white duration-300 zoom-in-50">
                  <Check aria-hidden className="size-3" strokeWidth={3} />
                </span>
              ) : (
                <Loader2
                  aria-hidden
                  className="size-5 animate-spin text-[#0B0B0C]/60"
                />
              )}
              {s}
            </li>
          );
        })}
        <li
          className={cn(
            fade,
            "flex items-center gap-3 text-[14px]",
            t < waitAt && "translate-y-1 opacity-0",
            t < yesAt && "text-[#0B0B0C]/60",
          )}
        >
          {t >= yesAt ? (
            <span className="grid size-5 animate-in place-items-center rounded-full bg-[#0B0B0C] text-white duration-300 zoom-in-50">
              <Check aria-hidden className="size-3" strokeWidth={3} />
            </span>
          ) : (
            <span className="size-5 animate-pulse rounded-full border border-black/40" />
          )}
          {t >= yesAt ? "Meeting booked · Thu 2pm" : "Waiting for a time"}
        </li>
      </ul>
      {/* The prospect's answer, as it lands in the transcript. */}
      <span
        className={cn(
          fade,
          "absolute right-6 bottom-6 rounded-[18px] rounded-br-[6px] bg-[#0B0B0C] px-3.5 py-1.5 text-[14px] text-white",
          t >= yesAt - 1
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0",
        )}
      >
        “Thursday at 2 works”
      </span>
    </div>
  );
}

// --- Hands you the hot ones ------------------------------------------------------

const TODAY: { text: string; state: "done" | "you" }[] = [
  { text: "New form lead called back in under a minute", state: "done" },
  { text: "Meeting booked · Bright Smile Dental", state: "done" },
  { text: "Harbor Realty wants to talk now", state: "you" },
  { text: "Follow-up text sent · Oak & Iron Gym", state: "done" },
  { text: "Opt-out honoured · removed from the list", state: "done" },
];

export function TodayPanel() {
  // Each task arrives working, then settles a frame later; then a pause.
  const end = TODAY.length * 2;
  const [ref, t] = useLoop<HTMLDivElement>(end + 6, end);
  const done = TODAY.filter(
    (x, i) => x.state === "done" && t >= i * 2 + 1,
  ).length;
  return (
    <div ref={ref} className="h-[300px] border-b border-black/[0.06] p-6">
      <div className="flex items-baseline justify-between">
        <p className="text-[12.5px] text-[#0B0B0C]/45">Today</p>
        <p className="text-[12.5px] text-[#0B0B0C]/45">
          <span className="text-[#0B0B0C] tabular-nums">{done}</span> done on
          its own
        </p>
      </div>
      <ul className="mt-4 space-y-2">
        {TODAY.map((x, i) => {
          const shown = t >= i * 2;
          const settled = t >= i * 2 + 1;
          const you = x.state === "you" && settled;
          return (
            <li
              key={x.text}
              className={cn(
                fade,
                "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-[13.5px]",
                you
                  ? "border-black/20 bg-black/[0.07]"
                  : "border-transparent bg-black/[0.025]",
                shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
              )}
            >
              <span className="truncate">{x.text}</span>
              {!settled ? (
                <Loader2
                  aria-hidden
                  className="size-3.5 shrink-0 animate-spin text-[#0B0B0C]/45"
                />
              ) : you ? (
                <span className="shrink-0 animate-in rounded-full bg-[#0B0B0C] px-2 py-0.5 text-[11.5px] font-medium text-white duration-300 zoom-in-75">
                  Transfer
                </span>
              ) : (
                <span className="shrink-0 animate-in text-[12px] text-[#0B0B0C]/45 duration-300 fade-in">
                  Done
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
