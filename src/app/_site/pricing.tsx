import { PLANS, TRIAL } from "@/lib/site";
import { Rise, Words } from "./motion";
import { PricingCards } from "./pricing-cards";
import { PLAN_CARDS } from "./plans";
import { muted, serif } from "./theme";

/** The pricing section: on the home page's last stretch, and /pricing. */
export function PricingSection({
  as = "h2",
  title = "Free until your first booked meeting. Then two simple plans.",
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
            Early access
          </p>
        </Rise>
        <Words
          as={as}
          text={title}
          className={`${serif} mt-6 text-[44px] leading-[1.02] sm:text-[64px]`}
        />
        <Rise delay={0.2}>
          <p className={`mt-5 text-[17px] leading-[1.55] ${muted}`}>
            You pay nothing until an agent books your first meeting (the trial
            covers up to {TRIAL.calls} AI calls, with a card to start). Then $
            {PLANS.starter.price} or ${PLANS.pro.price} a month. No contract,
            cancel anytime.
          </p>
        </Rise>
      </div>
      <PricingCards plans={PLAN_CARDS} />
      <Rise className="mx-auto mt-6 max-w-[900px] rounded-2xl border border-dashed border-black/20 px-5 py-4 text-center text-[14px] text-[#0B0B0C]/65">
        <span className="font-medium text-[#0B0B0C]">Add-ons</span> on any plan:
        extra AI calls, lead credits, sending inboxes and dialer seats.
      </Rise>
    </section>
  );
}
