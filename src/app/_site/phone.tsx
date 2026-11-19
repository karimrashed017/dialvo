import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// An iPhone drawn in HTML for the hero, so the screens' text stays sharp.
// The screens inside are Dialvo's own (hero-phones.tsx), in black and white
// like the rest of the site.

// San Francisco on Apple devices; elsewhere Inter, the closest open font.
const SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", var(--font-inter), "Helvetica Neue", Arial, sans-serif';

/** The Dialvo mark in a black circle, as the caller's picture. */
export function MarkAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-[#0B0B0C]",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local SVG, swapped with the logo files */}
      <img src="/brand/mark-white.svg" alt="" className="h-[52%] w-[52%]" />
    </span>
  );
}

export function StatusBar({ time = "9:41" }: { time?: string }) {
  const c = "#000";
  return (
    <div className="relative flex h-[46px] shrink-0 items-end justify-between px-7 pb-[7px] text-[14px] font-semibold tracking-[-0.01em]">
      <span style={{ color: c }}>{time}</span>
      <span className="absolute top-[11px] left-1/2 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
      <span className="flex items-center gap-[5px]" aria-hidden>
        <svg width="17" height="11" viewBox="0 0 17 11" fill={c}>
          <rect x="0" y="7" width="3" height="4" rx="1" />
          <rect x="4.5" y="5" width="3" height="6" rx="1" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
          <rect x="13.5" y="0" width="3" height="11" rx="1" />
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11" fill={c}>
          <path d="M7.5 2.2c2 0 3.9.8 5.3 2.1l1.1-1.1A9 9 0 0 0 7.5.6 9 9 0 0 0 1.1 3.2l1.1 1.1a7.5 7.5 0 0 1 5.3-2.1Zm0 3.2c1.1 0 2.2.4 3 1.2l1.1-1.1a5.9 5.9 0 0 0-8.2 0l1.1 1.1c.8-.8 1.9-1.2 3-1.2Zm0 3.1-1.6 1.6L7.5 11l1.6-1.5-1.6-1Z" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect
            x=".5"
            y=".5"
            width="21"
            height="11"
            rx="3.5"
            stroke={c}
            opacity=".4"
          />
          <rect x="2" y="2" width="18" height="8" rx="2" fill={c} />
          <path
            d="M23 4v4c.8-.3 1.3-1.1 1.3-2S23.8 4.3 23 4Z"
            fill={c}
            opacity=".5"
          />
        </svg>
      </span>
    </div>
  );
}

/** An iPhone, drawn at a fixed size; scale it with CSS transforms. */
export function Phone({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <figure
      aria-label={label}
      className={cn(
        "relative w-[300px] shrink-0 rounded-[50px] bg-[#0B0B0C] p-[10px] shadow-[0_0_0_1.5px_#4a4a4d,0_0_0_3px_#1a1a1c,0_50px_100px_-30px_rgba(0,0,0,0.55),inset_0_0_0_1px_#2c2c2e]",
        className,
      )}
      style={{ fontFamily: SYSTEM_FONT }}
    >
      <div className="relative flex h-[620px] flex-col overflow-hidden rounded-[40px] bg-white antialiased">
        {children}
      </div>
      <span
        aria-hidden
        className="absolute top-[120px] -left-[3px] h-8 w-[3px] rounded-l bg-[#1c1c1e]"
      />
      <span
        aria-hidden
        className="absolute top-[170px] -left-[3px] h-14 w-[3px] rounded-l bg-[#1c1c1e]"
      />
      <span
        aria-hidden
        className="absolute top-[150px] -right-[3px] h-20 w-[3px] rounded-r bg-[#1c1c1e]"
      />
    </figure>
  );
}
