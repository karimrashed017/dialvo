"use client";

import { useEffect, useState } from "react";
import { PLANS } from "@/lib/site";
import { cn } from "@/lib/utils";
import { startHref } from "./links";

// The phone's signup bar. Dialvo is in early access: its button opens the
// waitlist form.

/**
 * On phones, an early access bar along the bottom once the hero is behind
 * them. It steps aside while the plan cards are on screen, since those have
 * their own buttons.
 */
export function StickyBuy() {
  const [past, setPast] = useState(false);
  const [plansInView, setPlansInView] = useState(false);

  useEffect(() => {
    const on = () => setPast(window.scrollY > 700);
    on();
    window.addEventListener("scroll", on, { passive: true });
    const plans = document.getElementById("pricing");
    const seen = plans
      ? new IntersectionObserver(([e]) => setPlansInView(e.isIntersecting), {
          threshold: 0.05,
        })
      : null;
    if (plans) seen?.observe(plans);
    return () => {
      window.removeEventListener("scroll", on);
      seen?.disconnect();
    };
  }, []);

  const show = past && !plansInView;
  return (
    <div
      aria-hidden={!show}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))] transition-all duration-300 sm:hidden",
        show
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/[0.1] bg-white/90 py-2 pr-2 pl-4 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.18)] backdrop-blur-xl">
        <div className="min-w-0">
          <p className="text-[14px] font-medium">
            Dialvo · from ${PLANS.starter.price} a month
          </p>
          <p className="truncate text-[12.5px] text-[#0B0B0C]/55">
            Free until your first booked meeting
          </p>
        </div>
        <a
          href={startHref()}
          tabIndex={show ? 0 : -1}
          className="inline-flex h-10 shrink-0 items-center rounded-full bg-[#0B0B0C] px-4 text-[14px] font-medium text-white"
        >
          Early access
        </a>
      </div>
    </div>
  );
}
