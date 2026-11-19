import { PLANS, TRIAL } from "@/lib/site";
import { Rise, Words } from "./motion";
import { PricingCards } from "./pricing-cards";
import { PLAN_CARDS } from "./plans";
import { muted, serif } from "./theme";

/** The pricing section: on the home page's last stretch, and /pricing. */
export function PricingSection({
  as = "h2",
  title = "Free until it works. Then two simple plans.",
}: {
  as?: "h1" | "h2";
  title?: string;
}) {
  return (
    <section id="pricing" className="scroll-mt-24 px-5 py-28 sm:py-36">
      <div className="mx-auto max-w-[760px] text-center">
        <Words
          as={as}
          text={title}
          className={`${serif} text-[44px] leading-[1.02] sm:text-[64px]`}
        />
        <Rise delay={0.2}>
          <p className={`mt-5 text-[17px] leading-[1.55] ${muted}`}>
            Free until your first interested prospect, for up to {TRIAL.dials}{" "}
            dials, with a card to start. Then ${PLANS.starter.price} or $
            {PLANS.pro.price} a month. No contract, cancel anytime.
          </p>
        </Rise>
      </div>
      <PricingCards plans={PLAN_CARDS} />
      <Rise className="mx-auto mt-6 max-w-[860px] rounded-2xl border border-dashed border-black/20 px-5 py-4 text-center text-[14px] text-[#0B0B0C]/65">
        <span className="font-medium text-[#0B0B0C]">Add-ons</span> on any plan:
        extra dials, extra lead credits and extra sending inboxes.
      </Rise>
    </section>
  );
}
