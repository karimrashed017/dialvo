import { ArrowRight, FileInput, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { startHref } from "./links";
import { Rise, Words } from "./motion";
import { card, muted, serif } from "./theme";

// Speed to lead: a new form lead gets a call within 60 seconds, day or
// night. The picture is drawn here: the form coming in, the call going out
// and the first lines of it. The names are made up.

const STEPS = [
  {
    title: "A form comes in",
    body: "Someone asks for a quote or a demo on your website, at 2pm or 2am.",
  },
  {
    title: "Dialvo calls within 60 seconds",
    body: "While they still remember why they asked. They asked to hear from you, so it can call their mobile.",
  },
  {
    title: "It books them, or puts them through",
    body: "It answers their questions, asks yours, books the meeting on your calendar, or transfers the call to you live.",
  },
];

const BARS = [8, 14, 22, 30, 18, 26, 34, 20, 12, 24, 30, 16, 10, 20, 14, 8];

function LeadCall() {
  return (
    <div
      aria-hidden
      className={cn(card, "relative overflow-hidden p-6 sm:p-10")}
    >
      <div className="relative mx-auto flex max-w-[420px] gap-5">
        {/* The timeline: the form, then the call, 41 seconds later. */}
        <div className="relative w-4 shrink-0 rounded-full bg-black/[0.06]">
          <span className="absolute top-6 -left-1 size-6 rounded-full border-4 border-[#F7F5F1] bg-black/25" />
          <span className="absolute top-[120px] -left-1 size-6 rounded-full border-4 border-[#F7F5F1] bg-[#0B0B0C] shadow-[0_0_24px_6px_rgba(255,255,255,0.35)]" />
        </div>
        <div className="flex-1 space-y-4 py-4">
          <div className="flex items-center gap-3 rounded-[18px] border border-black/[0.08] bg-black/[0.03] px-4 py-3">
            <FileInput className="size-4 shrink-0 text-[#0B0B0C]/60" />
            <div className="min-w-0">
              <p className="text-[14px] font-medium">New quote request</p>
              <p className="truncate text-[12.5px] text-[#0B0B0C]/50">
                Ana Ruiz · website form · 9:52:07 pm
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-[#0B0B0C] text-white">
              <Phone className="size-4" />
            </span>
            <div className="flex h-9 flex-1 items-center gap-[3px]">
              {BARS.map((h, i) => (
                <span
                  key={i}
                  className="dv-wave w-[3px] rounded-full bg-black/70"
                  style={{ height: h, animationDelay: `${(i % 5) * -0.2}s` }}
                />
              ))}
            </div>
            <span className="text-[12.5px] text-[#0B0B0C]/55 tabular-nums">
              +0:41
            </span>
          </div>
          <p className="max-w-[88%] rounded-[18px] rounded-tl-[6px] bg-[#0B0B0C] px-4 py-3 text-[15px] leading-[1.45] text-white">
            Hi Ana, it&apos;s Sam, an AI assistant for Oak &amp; Iron Gym. You
            just asked about memberships. This call is recorded. Is now a good
            time?
          </p>
          <p className="ml-auto max-w-[88%] rounded-[18px] rounded-tr-[6px] bg-black/[0.07] px-4 py-3 text-[15px] leading-[1.45] text-[#0B0B0C]/85">
            Wow, that was quick. Yes, go ahead.
          </p>
          <p className={`text-[13px] ${muted}`}>
            Called 41 seconds after the form. Recorded and transcribed.
          </p>
        </div>
      </div>
    </div>
  );
}

export function SpeedToLeadSection() {
  return (
    <section id="speed" className="scroll-mt-20 px-5 py-28 sm:py-36">
      <div className="mx-auto grid max-w-[1180px] items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <Rise>
            <p className="inline-flex items-center gap-2 rounded-full border border-black/15 px-3 py-1 text-[13px] text-[#0B0B0C]/75">
              <span className="size-1.5 rounded-full bg-[#0B0B0C]" />
              Speed to lead
            </p>
          </Rise>
          <Words
            text="New leads, called in a minute."
            className={`${serif} mt-6 text-[52px] leading-[0.98] sm:text-[84px]`}
          />
          <Rise delay={0.2}>
            <p
              className={`mt-6 max-w-[520px] text-[18px] leading-[1.55] ${muted}`}
            >
              Leads go cold while they wait. Dialvo calls new form leads within
              60 seconds, 24 hours a day, so the first business to call them
              back is yours.
            </p>
          </Rise>
          <ol className="mt-10 space-y-6">
            {STEPS.map((s, i) => (
              <Rise key={s.title} delay={0.1 * i}>
                <li className="flex gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-black/20 text-[14px]">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[16px] font-medium">{s.title}</p>
                    <p className={`mt-1 text-[14.5px] leading-[1.55] ${muted}`}>
                      {s.body}
                    </p>
                  </div>
                </li>
              </Rise>
            ))}
          </ol>
          <Rise delay={0.3}>
            <div className="mt-10 flex flex-wrap items-center gap-5">
              <a
                href={startHref()}
                className="inline-flex h-11 items-center rounded-full bg-[#0B0B0C] px-6 text-[15px] font-medium text-white transition-colors hover:bg-black/85"
              >
                Get early access
              </a>
              <a
                href="/pricing"
                className="inline-flex items-center gap-1 text-[14px] text-[#0B0B0C]/60 transition-colors hover:text-[#0B0B0C]"
              >
                All plans
                <ArrowRight aria-hidden className="size-3.5" />
              </a>
            </div>
            <p className={`mt-4 text-[13.5px] ${muted}`}>
              Works with the form you already have: point it at Dialvo when you
              set up.
            </p>
          </Rise>
        </div>
        <Rise delay={0.15}>
          <LeadCall />
        </Rise>
      </div>
    </section>
  );
}
