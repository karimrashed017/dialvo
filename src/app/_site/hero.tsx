import { cn } from "@/lib/utils";
import { ArrowDown, ArrowRight, Play } from "lucide-react";
import { CloudShader } from "@/components/ui/cloud-shader";
import { Mark } from "@/components/brand/logo";
import { PLANS } from "@/lib/site";
import { HeroPhones } from "./hero-phones";
import { HeroLift, Rise, Words } from "./motion";
import { startHref } from "./links";
import { GRAIN, serif } from "./theme";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-32 text-[#0B0B0C] sm:pt-40">
      {/* A live sky of drifting clouds. The CSS gradient is the same sky,
          shown until WebGL draws (or if it can't). */}
      <CloudShader
        className="absolute inset-x-0 top-0 -z-20 h-[118vh] min-h-[900px] bg-[linear-gradient(180deg,#8DB8E2,#E4EEF6)]"
        speed={0.8}
        skyTopColor="#8DB8E2"
        skyBottomColor="#E4EEF6"
        cloudColor="#FBF8F2"
      />
      {/* A paper veil keeps the headline crisp on the sky, the clouds show
          through the middle, and the bottom melts into the page. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-[118vh] min-h-[900px]"
        style={{
          background: `${GRAIN}, linear-gradient(180deg, rgba(247,245,241,0.55) 0%, rgba(247,245,241,0.3) 30%, rgba(247,245,241,0) 55%, rgba(247,245,241,0.6) 76%, #F7F5F1 92%)`,
        }}
      />

      <div className="mx-auto max-w-[920px] px-5 text-center">
        <Rise>
          <a
            href="#listen"
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/60 py-1 pr-3 pl-1 text-[13px] text-[#0B0B0C]/85 backdrop-blur-md transition-colors hover:bg-white/80"
          >
            <span className="rounded-full bg-[#0B0B0C] px-2 py-0.5 text-[11.5px] font-medium text-white">
              Early access
            </span>
            Hear a sample call, start to finish
            <ArrowRight aria-hidden className="size-3.5" />
          </a>
        </Rise>
        <Words
          as="h1"
          text="Your AI sales team."
          delay={0.1}
          className={`${serif} mt-7 text-[50px] leading-[0.98] sm:text-[84px]`}
        />
        <Rise delay={0.55}>
          <p
            className={`mx-auto mt-6 max-w-[580px] text-[17px] leading-[1.55] text-[#0B0B0C]/70 sm:text-[18px]`}
          >
            It calls, follows up and books meetings, so you can close. Cold
            email is getting ignored; real conversations get answers. Dialvo
            finds the right businesses, calls them and keeps following up until
            they say yes or no.
          </p>
        </Rise>
        <Rise delay={0.7} className="mt-10">
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <CtaButton
              href={startHref()}
              label="Get early access"
              icon={<Mark className="size-[18px]" />}
              primary
            />
            <CtaButton
              href="#listen"
              label="Listen to a sample call"
              icon={<Play aria-hidden className="size-[15px] fill-current" />}
            />
          </div>
          <a
            href="/pricing"
            className="mt-5 inline-flex items-center gap-1.5 text-[14px] text-[#0B0B0C]/75 underline decoration-black/25 underline-offset-4 transition-colors hover:text-[#0B0B0C] hover:decoration-black"
          >
            Plans from ${PLANS.starter.price} a month, free until it works
            <ArrowRight aria-hidden className="size-3.5" />
          </a>
          <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13.5px] text-[#0B0B0C]/55">
            Cancel anytime
            <span aria-hidden>·</span>
            Says it&apos;s an AI on every call
            <span aria-hidden>·</span>
            <a
              href="#how"
              className="inline-flex items-center gap-1 text-[#0B0B0C]/70 transition-colors hover:text-[#0B0B0C]"
            >
              See how it works
              <ArrowDown aria-hidden className="size-3.5" />
            </a>
          </p>
        </Rise>
      </div>

      <Rise
        delay={0.85}
        className="relative mx-auto mt-16 max-w-[1180px] [mask-image:linear-gradient(to_bottom,#000_72%,transparent)] px-5"
      >
        <HeroLift>
          <HeroPhones />
        </HeroLift>
      </Rise>
    </section>
  );
}

/**
 * One of the two hero buttons: an icon chip, a label and an arrow that
 * nudges forward on hover. The main one is solid ink; the other is frosted
 * white beside it, the same size, so the pair reads as one choice.
 */
function CtaButton({
  href,
  label,
  icon,
  primary,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      className={cn(
        "group relative inline-flex h-14 w-full max-w-[300px] items-center gap-3 rounded-full py-2 pr-6 pl-2 text-[15.5px] font-medium tracking-[-0.01em] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none sm:w-[288px]",
        primary
          ? "bg-[#0B0B0C] text-white shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_12px_30px_-12px_rgba(0,0,0,0.45)] hover:shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_18px_40px_-12px_rgba(0,0,0,0.5)]"
          : "border border-black/[0.08] bg-white/70 text-[#0B0B0C] shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_10px_30px_-14px_rgba(0,0,0,0.25)] backdrop-blur-md hover:bg-white/90",
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full transition-transform duration-300 group-hover:scale-105",
          primary ? "bg-white text-[#0B0B0C]" : "bg-[#0B0B0C] text-white",
        )}
      >
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      <ArrowRight
        aria-hidden
        className="size-4 opacity-60 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100"
      />
    </a>
  );
}
