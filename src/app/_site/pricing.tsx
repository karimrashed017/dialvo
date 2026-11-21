import { PLANS, TRIAL } from "@/lib/site";
import { Rise, Words } from "./motion";
import { PricingCards } from "./pricing-cards";
import { PLAN_CARDS } from "./plans";
import { muted, serif } from "./theme";

/** The pricing section: on the home page's last stretch, and /pricing. */
export function PricingSection({
  as = "h2",
  title = "Free for 7 days.",
}: {
  as?: "h1" | "h2";
  title?: string;
}) {
  return (
    <section id="pricing" className="scroll-mt-24 px-5 py-28 sm:py-36">
      <div className="mx-auto max-w-[800px] text-center">
        <Rise>
          <p className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[13px] text-[#0B0B0C]/75">
            <span className="size-1.5 rounded-full bg-[#1F3BFF]" />
            Now open
          </p>
        </Rise>
        <Words
          as={as}
          text={title}
          className={`${serif} mt-6 text-[44px] leading-[1.02] sm:text-[64px]`}
        />
        <Rise delay={0.2}>
          <p className={`mt-5 text-[17px] leading-[1.55] ${muted}`}>
            Try Dialvo free for {TRIAL.days} days. Then ${PLANS.starter.price},
            ${PLANS.pro.price} or ${PLANS.scale.price} a month. No contract,
            cancel anytime.
          </p>
        </Rise>
      </div>
      <PricingCards plans={PLAN_CARDS} />
      <Rise className="mx-auto mt-14 max-w-[640px] text-center">
        <p className={`${serif} text-[24px] leading-[1.25] sm:text-[28px]`}>
          The maths is yours to do. If one extra customer a month comes from
          answering faster, has Dialvo paid for itself?
        </p>
      </Rise>
      <Rise className="mx-auto mt-10 max-w-[900px] rounded-2xl border border-dashed border-black/20 px-5 py-4 text-center text-[14px] text-[#0B0B0C]/65">
        <span className="font-medium text-[#0B0B0C]">Add-ons</span> on any plan:
        extra answered calls, lead credits and sending inboxes.
      </Rise>
    </section>
  );
}
