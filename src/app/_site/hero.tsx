import Image from "next/image";
import { ArrowRight, Mic } from "lucide-react";
import { CloudShader } from "@/components/ui/cloud-shader";
import { Mark } from "@/components/brand/logo";
import { PLANS } from "@/lib/site";
import { cn } from "@/lib/utils";
import painting from "../../../public/images/art/kensett-rocky-coast.jpg";
import { Dashboard } from "./dashboard";
import { startHref } from "./links";
import { HeroLift, Rise, Words } from "./motion";
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

      <div className="mx-auto max-w-[980px] px-5 text-center">
        <Rise>
          <a
            href="#what"
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/60 py-1 pr-3 pl-1 text-[13px] text-[#0B0B0C]/85 backdrop-blur-md transition-colors hover:bg-white/80"
          >
            <span className="rounded-full bg-[#1F3BFF] px-2 py-0.5 text-[11.5px] font-medium text-white">
              Early access
            </span>
            Inbound, outbound and closing
            <ArrowRight aria-hidden className="size-3.5" />
          </a>
        </Rise>
        <Words
          as="h1"
          text="Inbound and outbound sales, run by AI agents."
          delay={0.1}
          className={`${serif} mt-7 text-[44px] leading-[1] sm:text-[76px]`}
        />
        <Rise delay={0.6}>
          <p className="mx-auto mt-6 max-w-[680px] text-[17px] leading-[1.55] text-[#0B0B0C]/70 sm:text-[18px]">
            Dialvo answers every lead within a minute and goes out to find new
            ones. Its agents call, email, message and follow up on every
            channel, book the meetings, close the simple sales and hand your
            team the big ones.
          </p>
        </Rise>
        <Rise delay={0.8} className="mt-9">
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <CtaButton
              href={startHref()}
              label="Join the waitlist"
              icon={<Mark className="size-[18px]" />}
              primary
            />
            <CtaButton
              href="#voice-demo"
              label="Talk to the agent"
              icon={<Mic aria-hidden className="size-[17px]" />}
            />
          </div>
          <p className="mt-5 text-[14.5px] text-[#0B0B0C]/75">
            Free until it books your first meeting.
          </p>
          <a
            href="/pricing"
            className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] text-[#0B0B0C]/55 transition-colors hover:text-[#0B0B0C]"
          >
            Plans from ${PLANS.starter.price} a month
            <ArrowRight aria-hidden className="size-3.5 shrink-0" />
          </a>
        </Rise>
      </div>

      {/* The workspace, on a painting. */}
      <Rise delay={0.9} className="mx-auto mt-16 max-w-[1220px] px-3 sm:px-5">
        <HeroLift>
          <div className="relative isolate overflow-hidden rounded-[28px] border border-black/[0.08] p-2.5 sm:rounded-[36px] sm:p-8 lg:p-10">
            <Image
              src={painting}
              alt=""
              priority
              sizes="(min-width: 1220px) 1220px, 100vw"
              className="absolute inset-0 -z-20 h-full w-full object-cover"
            />
            <div
              aria-hidden
              className="absolute inset-0 -z-10"
              style={{
                background: `${GRAIN}, linear-gradient(180deg, rgba(247,245,241,0.18), rgba(247,245,241,0.05))`,
              }}
            />
            <Dashboard />
          </div>
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
        "group relative inline-flex h-14 w-full max-w-[300px] items-center gap-3 rounded-full py-2 pr-6 pl-2 text-[15.5px] font-medium tracking-[-0.01em] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none sm:w-[264px]",
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
