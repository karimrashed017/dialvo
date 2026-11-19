import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MOTIONS, PLAY_SLUGS } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { Rise, Words } from "../_site/motion";
import { Breadcrumbs, PlayCards } from "../_site/pages/parts";
import { PageShell } from "../_site/pages/shell";
import { muted, serif, siteViewport } from "../_site/theme";

export const viewport = siteViewport;

export const metadata: Metadata = pageMetadata({
  title: "Plays · Dialvo",
  description:
    "Every Dialvo play in one place: speed to lead, meeting scheduling, outbound lead generation, lead reactivation, closed-lost win-back, customer expansion and more. Each has its own page.",
  path: "/plays",
});

// Every play as a card. This grid used to be on the home page; it lives here
// so the home page can stay on the problem and the four jobs.
export default function Page() {
  return (
    <PageShell>
      <section className="px-5 pt-28 pb-16 sm:pt-36 sm:pb-24">
        <div className="mx-auto max-w-[1180px]">
          <Breadcrumbs
            trail={[
              { name: "Home", href: "/" },
              { name: "Plays", href: "/plays" },
            ]}
          />
          <Words
            as="h1"
            text="Pick a play and switch it on"
            className={`${serif} mt-8 max-w-[800px] text-[44px] leading-[1] sm:text-[72px]`}
          />
          <Rise delay={0.2}>
            <p
              className={`mt-6 max-w-[560px] text-[17px] leading-[1.55] ${muted}`}
            >
              Each play comes with its own audience, research and follow-up, and
              its own page explaining how it runs. Start with one, or run
              several side by side.
            </p>
          </Rise>
          <Rise delay={0.3} className="mt-8 flex flex-wrap gap-2">
            {MOTIONS.map((m) => (
              <Link
                key={m.id}
                href={m.href}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-black/[0.1] bg-white/70 px-4 text-[14px] text-[#0B0B0C]/80 transition-colors hover:bg-white hover:text-[#0B0B0C]"
              >
                <m.icon aria-hidden className="size-[15px]" />
                {m.name}
                <ArrowRight aria-hidden className="size-3.5 opacity-50" />
              </Link>
            ))}
          </Rise>
          <div className="mt-10">
            <PlayCards slugs={PLAY_SLUGS} />
          </div>
        </div>
      </section>
    </PageShell>
  );
}
