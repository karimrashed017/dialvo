import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { startHref } from "./links";
import { Rise } from "./motion";
import type { Plan } from "./plans";
import { card, muted, serif } from "./theme";

// The plan cards. Each button opens the early access email with the plan
// already picked.

export function PricingCards({ plans }: { plans: Plan[] }) {
  return (
    <div className="mx-auto mt-14 grid max-w-[900px] gap-3 sm:grid-cols-2">
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
              <span className="rounded-full bg-[#1F3BFF] px-2.5 py-1 text-[12px] font-medium text-white">
                Every channel
              </span>
            )}
          </div>
          <p
            className={`mt-2 text-[14.5px] leading-[1.5] sm:min-h-[66px] ${muted}`}
          >
            {p.lead}
          </p>
          <p className="mt-6 flex items-baseline gap-2">
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
                <li key={f} className="flex gap-3 text-[14.5px] leading-[1.45]">
                  <Check
                    aria-hidden
                    className="mt-[3px] size-4 shrink-0 text-[#0B0B0C]/70"
                  />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-auto pt-7 text-[13px] text-[#0B0B0C]/45">{p.note}</p>
        </Rise>
      ))}
    </div>
  );
}
