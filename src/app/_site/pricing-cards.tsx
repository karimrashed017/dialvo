import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { startHref } from "./links";
import { Rise } from "./motion";
import type { Plan } from "./plans";
import { card, muted, serif } from "./theme";

// The plan cards. Each button opens the early access form with the plan
// already picked.

export function PricingCards({ plans }: { plans: Plan[] }) {
  return (
    <div className="mx-auto mt-14 grid max-w-[860px] gap-3 sm:grid-cols-2">
      {plans.map((p, i) => (
        <Rise
          key={p.id}
          delay={i * 0.08}
          className={cn(
            card,
            "flex flex-col p-7",
            p.featured &&
              "border-black/30 bg-white shadow-[0_40px_80px_-40px_rgba(0,0,0,0.3)]",
          )}
        >
          <div className="flex items-center justify-between">
            <p className={`${serif} text-[30px]`}>{p.name}</p>
            {p.featured && (
              <span className="rounded-full bg-[#0B0B0C] px-2.5 py-1 text-[12px] font-medium text-white">
                For agencies
              </span>
            )}
          </div>
          <p className={`mt-2 text-[14.5px] leading-[1.5] ${muted}`}>
            {p.lead}
          </p>
          <p className="mt-7 flex items-baseline gap-2">
            <span className={`${serif} text-[56px] leading-none`}>
              ${p.price}
            </span>
            <span className={`text-[14px] ${muted}`}>a month</span>
          </p>
          <p className="mt-2 h-5 text-[13px] text-[#0B0B0C]/50">
            After your free trial · billed monthly
          </p>
          <a
            href={startHref({ plan: p.id })}
            className={cn(
              "mt-6 flex h-11 items-center justify-center rounded-full text-[15px] font-medium transition-colors",
              p.featured
                ? "bg-[#0B0B0C] text-white hover:bg-black/85"
                : "border border-black/15 text-[#0B0B0C] hover:bg-black/[0.06]",
            )}
          >
            {p.cta}
          </a>
          <div className="mt-7 border-t border-black/[0.08] pt-6">
            <p className="text-[13px] text-[#0B0B0C]/45">{p.intro}</p>
            <ul className="mt-4 space-y-3">
              {p.features.map((f) => (
                <li key={f} className="flex gap-3 text-[14.5px]">
                  <Check
                    aria-hidden
                    className="mt-[3px] size-4 shrink-0 text-[#0B0B0C]/70"
                  />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          {/* Not built yet: set apart in a dashed box, greyed, with a clock
              instead of a tick, so nobody buys it thinking it's there. */}
          {p.soon.length > 0 && (
            <div className="mt-6 rounded-2xl border border-dashed border-black/20 px-4 py-4">
              <span className="inline-flex rounded-full border border-black/20 px-2.5 py-0.5 text-[11.5px] font-medium tracking-wide text-[#0B0B0C]/60 uppercase">
                Coming soon
              </span>
              <ul className="mt-3 space-y-2.5">
                {p.soon.map((f) => (
                  <li
                    key={f}
                    className="flex gap-3 text-[13.5px] text-[#0B0B0C]/50"
                  >
                    <Clock
                      aria-hidden
                      className="mt-[3px] size-3.5 shrink-0 text-[#0B0B0C]/35"
                    />
                    <span>
                      <span className="sr-only">Coming soon: </span>
                      {f}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-auto pt-7 text-[13px] text-[#0B0B0C]/45">{p.note}</p>
        </Rise>
      ))}
    </div>
  );
}
