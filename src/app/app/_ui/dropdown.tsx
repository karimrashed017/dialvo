"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** A button that opens a small panel; closes on Escape or a click outside. */
export function Dropdown({
  label,
  trigger,
  children,
  align = "left",
  className,
  panelClassName,
}: {
  /** For screen readers. */
  label: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center rounded-xl text-left focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
      >
        {trigger}
      </button>
      {/* Kept in the page while closed (hidden), so a form inside it can
          still submit after the click that closes it. */}
      <div
        hidden={!open}
        // A click on a link or a button inside closes it.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a,button")) setOpen(false);
        }}
        className={cn(
          "absolute top-full z-40 mt-1.5 min-w-[220px] rounded-2xl border border-black/[0.09] bg-white p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_16px_40px_-16px_rgba(40,30,20,0.35)]",
          align === "right" ? "right-0" : "left-0",
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export const menuItem =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-[#0B0B0C]/80 hover:bg-black/[0.05] hover:text-[#0B0B0C] focus-visible:bg-black/[0.05] focus-visible:outline-none";
