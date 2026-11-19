"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Pause, Play } from "lucide-react";
import { MarkAvatar } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import script from "../../../public/audio/demo-call.json";

// "Listen to every call": a sample inbound call with its transcript,
// highlighted line by line as it plays. A lead filled in a form on a made-up
// agency's site, and the agent calls back within a minute. It plays /audio/demo-call.mp3 when that file
// exists; until then it runs through the transcript on a timer, so the demo
// works either way. The script is in public/audio/demo-call.json
// ([{ t: seconds, speaker, text }]); record the mp3 to the same timings.

type Line = { t: number; speaker: "Dialvo" | "Lead"; text: string };
const LINES = script as Line[];
const SRC = "/audio/demo-call.mp3";
/** Without audio: the last line's start, plus time to say it. */
const TIMER_LENGTH = LINES[LINES.length - 1].t + 3.5;

// What the call gets done, and when, so the checklist fills in as it plays.
const MOMENTS = [
  { at: 0, label: "Says it's recorded" },
  { at: 13.5, label: "Qualifies the lead" },
  { at: 39.5, label: "Doesn't guess a price" },
  { at: 54.5, label: "Books Thu 2pm" },
  { at: 66.5, label: "Texts the confirmation" },
];

// A fixed waveform, rounded so the server and the browser draw the same.
const BARS = Array.from({ length: 64 }, (_, i) =>
  Math.round(8 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.55)) * 34),
);

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function CallPlayer() {
  const [hasAudio, setHasAudio] = useState(false);
  const [length, setLength] = useState(TIMER_LENGTH);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  // Where the timer started from, when there's no audio.
  const timer = useRef({ start: 0, from: 0 });
  const list = useRef<HTMLOListElement>(null);

  // Use the recording only if it's really there.
  useEffect(() => {
    let gone = false;
    fetch(SRC, { method: "HEAD" })
      .then((r) => {
        const type = r.headers.get("content-type") ?? "";
        if (gone || !r.ok || !type.startsWith("audio")) return;
        const a = new Audio(SRC);
        a.preload = "metadata";
        a.addEventListener("loadedmetadata", () => {
          if (Number.isFinite(a.duration)) setLength(a.duration);
        });
        a.addEventListener("ended", () => setPlaying(false));
        audio.current = a;
        setHasAudio(true);
      })
      .catch(() => {});
    return () => {
      gone = true;
      audio.current?.pause();
    };
  }, []);

  // While playing, follow the audio (or the timer) every frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audio.current;
      let now =
        hasAudio && a
          ? a.currentTime
          : timer.current.from +
            (performance.now() - timer.current.start) / 1000;
      if (now >= length) {
        now = length;
        setPlaying(false);
      }
      setTime(now);
      if (now < length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, hasAudio, length]);

  const seek = useCallback(
    (to: number) => {
      const s = Math.max(0, Math.min(to, length));
      setTime(s);
      timer.current = { start: performance.now(), from: s };
      if (audio.current) audio.current.currentTime = s;
    },
    [length],
  );

  const play = (at = time) => {
    const from = at >= length - 0.05 ? 0 : at;
    seek(from);
    const a = audio.current;
    if (hasAudio && a) {
      a.play().catch(() => {
        // The browser refused to play: carry on with the transcript alone.
        setHasAudio(false);
        timer.current = { start: performance.now(), from };
      });
    }
    setPlaying(true);
  };

  const pause = () => {
    audio.current?.pause();
    setPlaying(false);
  };

  const started = playing || time > 0;
  const current = started
    ? LINES.reduce((at, l, i) => (l.t <= time ? i : at), -1)
    : -1;

  // Keep the line being spoken in view inside the transcript, without
  // scrolling the page.
  useEffect(() => {
    const box = list.current;
    const el = box?.children[current] as HTMLElement | undefined;
    if (!box || !el) return;
    box.scrollTo({
      top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2,
      behavior: "smooth",
    });
  }, [current]);

  const progress = time / length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.15fr] lg:gap-6">
      {/* The player */}
      <div className="flex min-w-0 flex-col rounded-[26px] border border-black/[0.06] bg-white/85 p-4 shadow-[0_24px_60px_-28px_rgba(60,45,30,0.35)] backdrop-blur-xl sm:p-6">
        <div className="flex items-center gap-3 border-b border-black/[0.06] pb-3.5">
          <MarkAvatar className="size-10" />
          <span className="min-w-0">
            <span className="block truncate text-[14.5px] font-medium">
              Northwind Agency → Bright Smile Dental
            </span>
            <span className="block text-[12.5px] text-[#0B0B0C]/50">
              Inbound speed to lead · form filled 1 min ago
            </span>
          </span>
          <span className="ml-auto shrink-0 rounded-full border border-black/15 px-2.5 py-0.5 text-[11.5px] font-medium tracking-wide text-[#0B0B0C]/60 uppercase">
            Example
          </span>
        </div>

        <div className="flex items-center gap-4 pt-6">
          <button
            type="button"
            onClick={playing ? pause : () => play()}
            aria-label={
              playing ? "Pause the sample call" : "Play the sample call"
            }
            className="grid size-16 shrink-0 place-items-center rounded-full bg-[#0B0B0C] text-white shadow-[0_12px_30px_-12px_rgba(0,0,0,0.45)] transition-transform duration-300 hover:scale-105 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {playing ? (
              <Pause aria-hidden className="size-6 fill-current" />
            ) : (
              <Play aria-hidden className="ml-1 size-6 fill-current" />
            )}
          </button>
          <div className="min-w-0">
            <p className="text-[15px] font-medium">
              {playing ? "Playing" : started ? "Paused" : "Press play"}
            </p>
            <p className="text-[13px] text-[#0B0B0C]/50 tabular-nums">
              {clock(time)} / {clock(length)}
            </p>
          </div>
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-label="Position in the call"
          aria-valuemin={0}
          aria-valuemax={Math.round(length)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} of ${clock(length)}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * length);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") seek(time + 5);
            if (e.key === "ArrowLeft") seek(time - 5);
          }}
          className="mt-6 flex h-16 cursor-pointer items-center gap-[2px] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-black/30"
        >
          {BARS.map((h, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "min-w-0 flex-1 rounded-full transition-colors duration-200",
                i / BARS.length < progress ? "bg-[#0B0B0C]" : "bg-black/[0.16]",
                playing && "dv-wave",
              )}
              style={{
                height: h,
                animationDelay: `${(i % 9) * -0.13}s`,
              }}
            />
          ))}
        </div>

        <ul className="mt-6 flex flex-wrap gap-2">
          {MOMENTS.map((m) => {
            const done = started && time >= m.at;
            return (
              <li
                key={m.label}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors duration-500",
                  done
                    ? "border-[#0B0B0C] bg-[#0B0B0C] text-white"
                    : "border-dashed border-black/20 text-[#0B0B0C]/50",
                )}
              >
                <Check aria-hidden className="size-3.5" />
                {m.label}
              </li>
            );
          })}
        </ul>

        <p className="mt-auto pt-6 text-[12.5px] leading-[1.5] text-[#0B0B0C]/50">
          {hasAudio
            ? "A sample script, voiced for this example."
            : "Audio for this sample is on its way: for now the transcript plays on its own."}
        </p>
      </div>

      {/* The transcript */}
      <div className="min-w-0 rounded-[26px] border border-black/[0.06] bg-white/85 p-4 shadow-[0_24px_60px_-28px_rgba(60,45,30,0.35)] backdrop-blur-xl sm:p-6">
        <div className="flex items-baseline justify-between border-b border-black/[0.06] pb-3.5">
          <p className="text-[14.5px] font-medium">Transcript</p>
          <p className="text-[12.5px] text-[#0B0B0C]/50">
            Tap a line to jump there
          </p>
        </div>
        <ol
          ref={list}
          className="relative mt-3 h-[380px] [scrollbar-width:thin] space-y-1 overflow-y-auto pr-1 sm:h-[420px]"
        >
          {LINES.map((l, i) => (
            <li key={l.t}>
              <button
                type="button"
                onClick={() => (playing ? seek(l.t) : play(l.t))}
                aria-current={i === current}
                className={cn(
                  "w-full rounded-2xl px-3.5 py-2.5 text-left transition-all duration-500",
                  i === current
                    ? "bg-black/[0.06] text-[#0B0B0C]"
                    : current >= 0 && i > current
                      ? "text-[#0B0B0C]/35 hover:text-[#0B0B0C]/60"
                      : "text-[#0B0B0C]/70 hover:text-[#0B0B0C]",
                )}
              >
                <span className="flex items-center gap-2 text-[11.5px] font-medium tracking-wide uppercase">
                  <span
                    className={cn(
                      l.speaker === "Dialvo"
                        ? "text-[#0B0B0C]"
                        : "text-[#0B0B0C]/50",
                    )}
                  >
                    {l.speaker === "Dialvo" ? "Dialvo (AI)" : "Lead"}
                  </span>
                  <span className="text-[#0B0B0C]/35 tabular-nums">
                    {clock(l.t)}
                  </span>
                </span>
                <span className="mt-1 block text-[14.5px] leading-[1.5]">
                  {l.text}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
