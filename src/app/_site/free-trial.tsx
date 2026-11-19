import { CreditCard, PartyPopper, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt, PLANS, TRIAL } from "@/lib/site";
import { Rise, Words } from "./motion";
import { card, muted, serif } from "./theme";

// The free trial: free until the first interested prospect, capped at 300
// dials, card required (founder, 19 Nov 2026). The call log in the middle is
// a made-up example of how a trial ends.

const POINTS = [
  {
    icon: PartyPopper,
    title: "No result, no bill",
    body: `The trial runs until a prospect says they're interested, for up to ${TRIAL.calls} dials. If nobody does, you don't pay.`,
  },
  {
    icon: CreditCard,
    title: "A card to start, nothing charged",
    body: "We ask for a card so the free calls go to real businesses. It isn't charged during the trial.",
  },
  {
    icon: Undo2,
    title: "Cancel anytime",
    body: "Monthly plans, no contract and no prepaid credits. Stop whenever you like.",
  },
];

type Entry = { text: string; note: string; win?: boolean };

const LOG: Entry[] = [
  { text: "No answer", note: "follow-up text sent" },
  { text: "Not the right person", note: "got the owner's name" },
  { text: "Not interested", note: "removed from the list" },
  { text: "Call back next week", note: "reminder set" },
  { text: "Interested", note: "meeting booked, Thu 2pm", win: true },
];

export function FreeTrialSection() {
  return (
    <section id="free-trial" className="scroll-mt-20 px-5 py-24 sm:py-32">
      <div className="mx-auto max-w-[1180px] text-center">
        <Rise>
          <p className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[13px] text-[#0B0B0C]/75">
            <span className="size-1.5 rounded-full bg-[#0B0B0C]" />
            Free trial
          </p>
        </Rise>
        <Words
          text="Free until your first interested prospect."
          className={`${serif} mx-auto mt-6 max-w-[960px] text-[48px] leading-[0.98] sm:text-[80px]`}
        />
        <Rise delay={0.3}>
          <p
            className={`mx-auto mt-6 max-w-[620px] text-[18px] leading-[1.55] ${muted}`}
          >
            Dialvo calls and follows up for you, and you pay nothing until
            someone says they&apos;re interested. Then pick a plan, or walk
            away.
          </p>
        </Rise>
      </div>

      <Rise
        delay={0.1}
        className={cn(
          card,
          "mx-auto mt-16 grid max-w-[1180px] gap-6 p-5 sm:p-10 lg:grid-cols-[260px_1fr_260px] lg:items-center",
        )}
      >
        <Side
          who="Your trial"
          line="Starts with Dialvo's first call for you"
          rows={[
            ["Dials", `Up to ${TRIAL.calls}`],
            ["You pay", "$0"],
          ]}
          foot="Card needed, not charged"
        />
        <div>
          <p className="text-center text-[12.5px] tracking-wide text-[#0B0B0C]/45 uppercase">
            Call log · an example trial
          </p>
          <ol className="mt-4 space-y-2">
            {LOG.map((o, i) => (
              <Rise
                key={o.text}
                delay={0.3 + i * 0.25}
                className={cn(
                  "flex w-fit max-w-[85%] items-baseline gap-3 rounded-[18px] px-4 py-2 text-[14.5px]",
                  o.win
                    ? "ml-auto rounded-br-[6px] bg-[#0B0B0C] text-white"
                    : "rounded-bl-[6px] bg-black/[0.05]",
                )}
              >
                <span className="font-medium">{o.text}</span>
                <span
                  className={cn(
                    "text-[12.5px]",
                    o.win ? "text-white/60" : "text-[#0B0B0C]/50",
                  )}
                >
                  {o.note}
                </span>
              </Rise>
            ))}
          </ol>
          <Rise
            delay={1.8}
            className="mx-auto mt-5 w-fit rounded-full border border-black/10 px-4 py-1.5 text-center text-[13.5px]"
          >
            First interested prospect · your trial ends here
          </Rise>
        </div>
        <Side
          who="After that"
          line="Pick the plan that fits, or stop"
          rows={[
            [PLANS.starter.name, `$${PLANS.starter.price}/mo`],
            [PLANS.pro.name, `$${PLANS.pro.price}/mo`],
          ]}
          foot={`${fmt(PLANS.starter.calls)} or ${fmt(PLANS.pro.calls)} dials a month`}
        />
      </Rise>

      <div className="mx-auto mt-3 grid max-w-[1180px] gap-3 md:grid-cols-3">
        {POINTS.map((p, i) => (
          <Rise
            key={p.title}
            delay={i * 0.08}
            className={cn(card, "flex flex-col p-7")}
          >
            <span className="grid size-11 place-items-center rounded-2xl bg-[#0B0B0C] text-white">
              <p.icon aria-hidden className="size-5" />
            </span>
            <h3 className={`${serif} mt-8 text-[28px] leading-[1.08]`}>
              {p.title}
            </h3>
            <p className={`mt-3 text-[15px] leading-[1.6] ${muted}`}>
              {p.body}
            </p>
          </Rise>
        ))}
      </div>

      <Rise className="mx-auto mt-6 max-w-[1180px] px-2 text-center">
        <p className={`text-[14.5px] leading-[1.55] ${muted}`}>
          An interested prospect is someone who books a meeting with you or asks
          you to get in touch. You&apos;ll hear the call before you decide.
        </p>
      </Rise>
    </section>
  );
}

/** One side of the trial: what it costs, before and after. */
function Side({
  who,
  line,
  rows,
  foot,
}: {
  who: string;
  line: string;
  rows: [string, string][];
  foot: string;
}) {
  return (
    <div className="rounded-[22px] border border-black/[0.07] p-5">
      <p className="text-[14.5px] font-medium">{who}</p>
      <p className="mt-1 text-[13px] leading-[1.45] text-[#0B0B0C]/55">
        {line}
      </p>
      <dl className="mt-4 space-y-2.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-[13px] text-[#0B0B0C]/60">{label}</dt>
            <dd className="text-[15px] font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[12px] text-[#0B0B0C]/45">{foot}</p>
    </div>
  );
}
