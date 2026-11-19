"use client";

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Pieces the channel panels and the live voice demo share: the bar across
// the top of a panel, the voice orb and the call transcript.

/** The bar across the top of each panel: what it is, and whether it's a sample. */
export function PanelBar({
  icon: Icon,
  title,
  note,
  badge = "Example",
  live,
}: {
  icon: LucideIcon;
  title: string;
  note?: string;
  badge?: string;
  /** A real, working demo rather than a sample: the badge turns blue. */
  live?: boolean;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-black/[0.07] px-4">
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 truncate text-[13.5px] font-medium">
        {title}
      </span>
      {note && (
        <span className="hidden truncate text-[12px] text-[#0B0B0C]/45 sm:block">
          {note}
        </span>
      )}
      <span
        className={cn(
          "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium tracking-wide uppercase",
          live
            ? "border-[#1F3BFF]/30 text-[#1F3BFF]"
            : "border-black/15 text-[#0B0B0C]/55",
        )}
      >
        {live && (
          <span aria-hidden className="size-1.5 rounded-full bg-[#1F3BFF]" />
        )}
        {badge}
      </span>
    </div>
  );
}

const ORB_BARS = [10, 18, 28, 20, 34, 24, 14, 26, 18, 10];

/**
 * The voice orb. Idle, its bars breathe at the picked voice's pace. On a
 * call, `sample` returns the sound's frequency levels (0 to 255) and the
 * bars follow the real audio, frame by frame, without re-rendering.
 */
export function Orb({
  size = 132,
  pace = 1.1,
  rings = true,
  still,
  sample,
}: {
  size?: number;
  pace?: number;
  rings?: boolean;
  /** Hold the bars still (connecting, muted, ended). */
  still?: boolean;
  sample?: () => Uint8Array | null;
}) {
  const bars = useRef<HTMLSpanElement>(null);
  const sampleRef = useRef(sample);
  useEffect(() => {
    sampleRef.current = sample;
  });
  const driven = Boolean(sample);

  useEffect(() => {
    if (!driven) return;
    const els = Array.from(bars.current?.children ?? []) as HTMLElement[];
    let frame = 0;
    const tick = () => {
      const data = sampleRef.current?.() ?? null;
      els.forEach((el, i) => {
        let level = 0;
        if (data && data.length) {
          // Spread the bars over the lower two thirds of the spectrum,
          // where a voice has its energy.
          const at = Math.floor((i / els.length) * data.length * 0.66);
          level = data[at] / 255;
        }
        el.style.transform = `scaleY(${(0.22 + level * 0.9).toFixed(3)})`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      els.forEach((el) => (el.style.transform = ""));
    };
  }, [driven]);

  const scale = size / 132;
  return (
    <span
      aria-hidden
      className="relative grid shrink-0 place-items-center"
      style={{ width: size * 1.5, height: size * 1.5 }}
    >
      {rings &&
        [0, 1, 2].map((i) => (
          <span
            key={i}
            className="dv-ring absolute rounded-full border border-black/40"
            style={{
              width: size,
              height: size,
              animationDelay: `${i * 1.1}s`,
            }}
          />
        ))}
      <span
        className="relative grid place-items-center rounded-full bg-[radial-gradient(circle_at_34%_28%,#55555b,#0B0B0C_68%)] shadow-[0_24px_50px_-18px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.25)]"
        style={{ width: size, height: size }}
      >
        <span
          ref={bars}
          className={cn(
            "flex h-10 items-center gap-[4px]",
            still && "dv-wave-paused",
          )}
          style={{ transform: `scale(${scale})` }}
        >
          {ORB_BARS.map((h, i) => (
            <span
              key={i}
              className={cn(
                "w-[3px] rounded-full bg-white",
                !driven && "dv-wave",
                driven && "transition-transform duration-75",
              )}
              style={{
                height: h,
                animationDuration: `${pace}s`,
                animationDelay: `${(i % 5) * -0.17}s`,
              }}
            />
          ))}
        </span>
      </span>
    </span>
  );
}

export type Line = { id: string; who: "agent" | "you"; text: string };

/** Both sides of the call, newest at the bottom and kept in view. */
export function Transcript({
  lines,
  empty,
}: {
  lines: Line[];
  empty?: string;
}) {
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <ol
      ref={box}
      aria-label="Call transcript"
      aria-live="polite"
      className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-4 py-3 text-left"
    >
      {lines.length === 0 && empty && (
        <li className="m-auto text-[12.5px] text-[#0B0B0C]/45">{empty}</li>
      )}
      {lines.map((l) => (
        <li
          key={l.id}
          className={cn(
            "flex max-w-[86%] animate-in flex-col duration-300 fade-in slide-in-from-bottom-1",
            l.who === "agent" ? "items-start" : "ml-auto items-end",
          )}
        >
          <span className="mb-0.5 px-1 text-[10.5px] tracking-wide text-[#0B0B0C]/45 uppercase">
            {l.who === "agent" ? "Dialvo agent" : "You"}
          </span>
          <span
            className={cn(
              "rounded-[18px] px-3.5 py-2 text-[13.5px] leading-[1.42]",
              l.who === "agent"
                ? "rounded-bl-md bg-[#0B0B0C] text-white"
                : "rounded-br-md bg-black/[0.06]",
            )}
          >
            {l.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** "1:05" */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
