import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ChevronRight, Plus } from "lucide-react";
import {
  CHANNELS,
  FEATURES,
  featureHref,
  PLAYS,
  playHref,
  motionById,
  type ChannelId,
  type Faq,
  type FeatureSlug,
  type PlaySlug,
  type Point,
} from "@/lib/content";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";
import meadow from "../../../../public/images/art/meadow.jpg";
import { startHref } from "../links";
import { Rise, Words } from "../motion";
import { card, GRAIN, muted, serif } from "../theme";

// The pieces the play, platform and motion pages are built from, so every
// page of a kind has the same structure and finish.

export type Crumb = { name: string; href: string };

/** The trail above a page's headline, and the same trail as JSON-LD. */
export function Breadcrumbs({
  trail,
  className,
}: {
  trail: Crumb[];
  className?: string;
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.href === "/" ? "" : c.href}`,
    })),
  };
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
      />
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-[#0B0B0C]/50">
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={c.href} className="flex items-center gap-1.5">
              {last ? (
                <span aria-current="page" className="text-[#0B0B0C]/75">
                  {c.name}
                </span>
              ) : (
                <>
                  <Link
                    href={c.href}
                    className="transition-colors hover:text-[#0B0B0C]"
                  >
                    {c.name}
                  </Link>
                  <ChevronRight aria-hidden className="size-3.5 opacity-60" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The small "Now open" badge with the page's kind beside it. */
export function Eyebrow({ label, href }: { label: string; href?: string }) {
  const inner = (
    <>
      <span className="shrink-0 rounded-full bg-[#1F3BFF] px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap text-white">
        Now open
      </span>
      {label}
    </>
  );
  const cls =
    "inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/70 py-1 pr-3 pl-1 text-[13px] text-[#0B0B0C]/85";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:bg-white")}>
      {inner}
    </Link>
  ) : (
    <p className={cls}>{inner}</p>
  );
}

/** The two buttons under a page's headline. */
export function HeroButtons({
  play,
  center,
}: {
  play?: string;
  center?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center",
        center && "items-center sm:justify-center",
      )}
    >
      <a
        href={startHref({ play })}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#0B0B0C] px-6 text-[15.5px] font-medium text-white transition-colors hover:bg-black/85"
      >
        Start free
        <ArrowRight aria-hidden className="size-4" />
      </a>
      <Link
        href="/pricing"
        className="inline-flex h-12 items-center justify-center rounded-full border border-black/10 bg-white/70 px-6 text-[15.5px] text-[#0B0B0C] transition-colors hover:bg-white"
      >
        See pricing
      </Link>
    </div>
  );
}

/** A sample panel set on the meadow (or a painting), like the channel tabs. */
export function Backdrop({
  children,
  image = meadow,
  className,
  sizes = "(min-width: 1024px) 620px, 100vw",
  priority,
}: {
  children: React.ReactNode;
  image?: StaticImageData;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-[28px] border border-black/[0.08] p-3 sm:p-7",
        className,
      )}
    >
      <Image
        src={image}
        alt=""
        sizes={sizes}
        priority={priority}
        className="absolute inset-0 -z-20 h-full w-full object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background: `${GRAIN}, linear-gradient(180deg, rgba(247,245,241,0.25), rgba(247,245,241,0.1))`,
        }}
      />
      {children}
    </div>
  );
}

/** A section with a serif heading on the left and its content on the right. */
export function Split({
  id,
  label,
  title,
  lead,
  children,
  className,
}: {
  id?: string;
  /** A small line above the heading. */
  label?: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-24 px-5 py-16 sm:py-24", className)}
    >
      <div className="mx-auto grid max-w-[1180px] gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          {label && (
            <p className="mb-4 text-[13px] text-[#0B0B0C]/50">{label}</p>
          )}
          <Words
            text={title}
            className={`${serif} text-[34px] leading-[1.05] sm:text-[46px]`}
          />
          {lead && (
            <Rise delay={0.15}>
              <p
                className={`mt-5 max-w-[420px] text-[16.5px] leading-[1.55] ${muted}`}
              >
                {lead}
              </p>
            </Rise>
          )}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

/** Numbered steps. */
export function Steps({ items }: { items: Point[] }) {
  return (
    <ol className="divide-y divide-black/[0.08] border-y border-black/[0.08]">
      {items.map((s, i) => (
        <Rise as="li" key={s.title} className="flex gap-5 py-6">
          <span
            aria-hidden
            className={`${serif} w-9 shrink-0 text-[30px] leading-none text-[#0B0B0C]/35 tabular-nums`}
          >
            {i + 1}
          </span>
          <div>
            <h3 className="text-[17px] font-medium">{s.title}</h3>
            <p className={`mt-1.5 text-[15px] leading-[1.6] ${muted}`}>
              {s.body}
            </p>
          </div>
        </Rise>
      ))}
    </ol>
  );
}

/** Titled points in a grid of soft cards. */
export function PointGrid({
  items,
  cols = 2,
}: {
  items: Point[];
  cols?: 2 | 3;
}) {
  return (
    <ul
      className={cn(
        "grid gap-3 sm:grid-cols-2",
        cols === 3 && "lg:grid-cols-3",
      )}
    >
      {items.map((p, i) => (
        <Rise
          as="li"
          key={p.title}
          delay={(i % cols) * 0.06}
          className="rounded-[20px] border border-black/[0.07] bg-white/75 p-5"
        >
          <h3 className="text-[15.5px] font-medium">{p.title}</h3>
          <p className={`mt-1.5 text-[14.5px] leading-[1.55] ${muted}`}>
            {p.body}
          </p>
        </Rise>
      ))}
    </ul>
  );
}

/** A ticked list. */
export function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="divide-y divide-black/[0.07] border-y border-black/[0.07]">
      {items.map((t) => (
        <li key={t} className="flex gap-3 py-3.5 text-[15px] leading-[1.5]">
          <Check
            aria-hidden
            className="mt-[4px] size-4 shrink-0 text-[#0B0B0C]/60"
          />
          {t}
        </li>
      ))}
    </ul>
  );
}

/** The channels a page uses, each linking to the channel tabs on the home page. */
export function ChannelChips({ ids }: { ids: ChannelId[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {ids.map((id) => {
        const c = CHANNELS[id];
        return (
          <li key={id}>
            <Link
              href="/#channels"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-black/[0.1] bg-white/70 px-4 text-[14px] text-[#0B0B0C]/80 transition-colors hover:bg-white hover:text-[#0B0B0C]"
            >
              <c.icon aria-hidden className="size-[15px]" />
              {c.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Platform features as a list of links with their one-liners. */
export function FeatureLinks({ slugs }: { slugs: FeatureSlug[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {slugs.map((slug) => {
        const f = FEATURES[slug];
        return (
          <li key={slug}>
            <Link
              href={featureHref(slug)}
              className="group flex h-full items-start gap-3 rounded-2xl border border-black/[0.07] bg-white/75 p-4 transition-colors hover:bg-white"
            >
              <f.icon aria-hidden className="mt-0.5 size-[18px] shrink-0" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[14.5px] font-medium">
                  {f.title}
                  <ArrowRight
                    aria-hidden
                    className="size-3.5 shrink-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-60"
                  />
                </span>
                <span
                  className={`mt-1 block text-[13.5px] leading-[1.5] ${muted}`}
                >
                  {f.blurb}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** A play as a card that links to its page. */
export function PlayCard({ slug, delay }: { slug: PlaySlug; delay?: number }) {
  const p = PLAYS[slug];
  return (
    <Rise delay={delay} className="h-full">
      <Link
        href={playHref(slug)}
        className={cn(
          card,
          "group flex h-full flex-col p-6 transition-shadow hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_18px_40px_-18px_rgba(60,45,30,0.28)]",
        )}
      >
        <span className="flex items-center justify-between">
          <span className="grid size-10 place-items-center rounded-xl border border-black/12 bg-black/[0.05] transition-transform duration-300 group-hover:scale-105">
            <p.icon aria-hidden className="size-[18px]" />
          </span>
          <span className="rounded-full border border-black/[0.1] px-2.5 py-0.5 text-[12px] text-[#0B0B0C]/55">
            {motionById(p.motion).name}
          </span>
        </span>
        <span className="mt-6 block text-[17px] font-medium">{p.title}</span>
        <span className={`mt-2 block text-[14.5px] leading-[1.55] ${muted}`}>
          {p.blurb}
        </span>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-[13.5px] text-[#0B0B0C]/55 transition-colors group-hover:text-[#0B0B0C]">
          See the play
          <ArrowRight
            aria-hidden
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </Rise>
  );
}

export function PlayCards({ slugs }: { slugs: PlaySlug[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {slugs.map((slug, i) => (
        <li key={slug}>
          <PlayCard slug={slug} delay={(i % 3) * 0.07} />
        </li>
      ))}
    </ul>
  );
}

/** A full-width section with a centred or left heading and anything below. */
export function Band({
  id,
  title,
  lead,
  children,
}: {
  id?: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 px-5 py-16 sm:py-24">
      <div className="mx-auto max-w-[1180px]">
        <Words
          text={title}
          className={`${serif} max-w-[760px] text-[34px] leading-[1.05] sm:text-[46px]`}
        />
        {lead && (
          <Rise delay={0.15}>
            <p
              className={`mt-5 max-w-[560px] text-[16.5px] leading-[1.55] ${muted}`}
            >
              {lead}
            </p>
          </Rise>
        )}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/** Questions that open in place, and the same questions as JSON-LD. */
export function FaqList({ faqs }: { faqs: Faq[] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
      />
      <ul className="divide-y divide-black/[0.08] border-y border-black/[0.08]">
        {faqs.map((f) => (
          <li key={f.q}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-[16.5px] focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                {f.q}
                <Plus
                  aria-hidden
                  className="size-5 shrink-0 text-[#0B0B0C]/60 transition-transform duration-300 group-open:rotate-45"
                />
              </summary>
              <p className={`pr-10 pb-6 text-[15px] leading-[1.6] ${muted}`}>
                {f.a}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
