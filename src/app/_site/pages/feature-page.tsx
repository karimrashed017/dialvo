import { appFeature, statusLine } from "@/lib/plays/catalog";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  FEATURE_DETAILS,
  FEATURE_PAGES,
  FEATURES,
  groupById,
  PLAYS,
  playHref,
  type FeatureSlug,
} from "@/lib/content";
import { Rise, Words } from "../motion";
import { muted, serif } from "../theme";
import {
  Backdrop,
  Band,
  Breadcrumbs,
  Checklist,
  Eyebrow,
  FaqList,
  FeatureLinks,
  HeroButtons,
  PointGrid,
  Split,
  Steps,
} from "./parts";
import { PageShell } from "./shell";
import { VisualPanel } from "./visual";

/** One platform feature's page, from its entry in src/lib/content. */
export function FeaturePage({ slug }: { slug: FeatureSlug }) {
  const entry = FEATURES[slug];
  const page = FEATURE_PAGES[slug];
  const details = FEATURE_DETAILS[slug];
  // The app's entry, once it has one. A feature written ahead of the merge
  // that adds it to the app shows no status line rather than failing.
  const app = appFeature(slug);
  const group = groupById(entry.group);
  return (
    <PageShell>
      <section className="px-5 pt-28 pb-10 sm:pt-36 sm:pb-16">
        <div className="mx-auto max-w-[1180px]">
          <Breadcrumbs
            trail={[
              { name: "Home", href: "/" },
              { name: "Platform", href: "/platform" },
              { name: entry.title, href: `/platform/${slug}` },
            ]}
          />
          <div className="mt-8 grid items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-14">
            <div className="min-w-0">
              <Rise>
                <Eyebrow label={group.title} href={`/platform#${group.id}`} />
              </Rise>
              <Words
                as="h1"
                text={page.tagline}
                delay={0.05}
                className={`${serif} mt-6 text-[40px] leading-[1.02] sm:text-[58px]`}
              />
              <Rise delay={0.3}>
                <p
                  className={`mt-6 max-w-[540px] text-[17px] leading-[1.55] ${muted}`}
                >
                  {page.intro}
                </p>
              </Rise>
              <Rise delay={0.4} className="mt-8">
                <HeroButtons />
                {/* Whether the app does this today: the same status as in the app. */}
                {app && (
                  <p
                    data-app-status={app.status}
                    className={`mt-4 text-[13px] ${muted}`}
                  >
                    {statusLine(app.status)}
                  </p>
                )}
              </Rise>
            </div>
            <Rise delay={0.2} className="min-w-0">
              <Backdrop priority>
                <VisualPanel visual={page.visual} />
              </Backdrop>
            </Rise>
          </div>
        </div>
      </section>

      <Band
        id="what"
        title="What it does"
        lead={`${entry.title}, in ${page.capabilities.length} specifics.`}
      >
        <PointGrid items={page.capabilities} cols={3} />
      </Band>

      <Split
        id="how"
        title="How it works"
        lead={`${details.steps.length} steps, from setting it up to seeing the result.`}
      >
        <Steps items={details.steps} />
      </Split>

      <Split id="fit" title="How it fits with the agents">
        <div className="space-y-5">
          {page.fit.map((p) => (
            <Rise key={p}>
              <p className="text-[17px] leading-[1.6] text-[#0B0B0C]/80">{p}</p>
            </Rise>
          ))}
        </div>
        <h3 className="mt-10 text-[13px] text-[#0B0B0C]/50">
          Plays that rely on it
        </h3>
        <ul className="mt-3 flex flex-wrap gap-2">
          {page.plays.map((s) => {
            const p = PLAYS[s];
            return (
              <li key={s}>
                <Link
                  href={playHref(s)}
                  className="group inline-flex h-10 items-center gap-2 rounded-full border border-black/[0.1] bg-white/70 px-4 text-[14px] text-[#0B0B0C]/80 transition-colors hover:bg-white hover:text-[#0B0B0C]"
                >
                  <p.icon aria-hidden className="size-[15px]" />
                  {p.title}
                  <ArrowRight
                    aria-hidden
                    className="size-3.5 opacity-50 transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </Split>

      <Split
        id="needs"
        title="What it needs"
        lead="What has to be in place before it runs."
      >
        <Checklist items={details.needs} />
      </Split>

      <Split
        id="controls"
        title="Controls and limits"
        lead="What you decide, and what this feature won't do."
      >
        <dl className="divide-y divide-black/[0.08] border-y border-black/[0.08]">
          {page.controls.map((c) => (
            <Rise key={c.title} className="py-5">
              <dt className="text-[16px] font-medium">{c.title}</dt>
              <dd className={`mt-1.5 text-[15px] leading-[1.6] ${muted}`}>
                {c.body}
              </dd>
            </Rise>
          ))}
        </dl>
      </Split>

      <Split id="faq" title="Questions">
        <FaqList faqs={details.faqs} />
      </Split>

      <Band
        title="Related features"
        lead={`More from ${group.title.toLowerCase()} and the features next to it.`}
      >
        <FeatureLinks slugs={page.related} />
        <Link
          href="/platform"
          className="mt-6 inline-flex items-center gap-1.5 text-[14px] text-[#0B0B0C]/60 transition-colors hover:text-[#0B0B0C]"
        >
          The whole platform
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </Band>
    </PageShell>
  );
}
