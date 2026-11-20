import { APP_PLAYS, statusLine } from "@/lib/plays/catalog";
import { motionById, PLAY_PAGES, PLAYS, type PlaySlug } from "@/lib/content";
import { Rise, Words } from "../motion";
import { muted, serif } from "../theme";
import {
  Backdrop,
  Band,
  Breadcrumbs,
  ChannelChips,
  Checklist,
  Eyebrow,
  FaqList,
  FeatureLinks,
  HeroButtons,
  PlayCards,
  Split,
  Steps,
} from "./parts";
import { PageShell } from "./shell";
import { VisualPanel } from "./visual";

/** One play's page, from its entry in src/lib/content. */
export function PlayPage({ slug }: { slug: PlaySlug }) {
  const entry = PLAYS[slug];
  const page = PLAY_PAGES[slug];
  const motion = motionById(entry.motion);
  return (
    <PageShell>
      <section className="px-5 pt-28 pb-10 sm:pt-36 sm:pb-16">
        <div className="mx-auto max-w-[1180px]">
          <Breadcrumbs
            trail={[
              { name: "Home", href: "/" },
              { name: motion.name, href: motion.href },
              { name: entry.title, href: `/plays/${slug}` },
            ]}
          />
          <div className="mt-8 grid items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-14">
            <div className="min-w-0">
              <Rise>
                <Eyebrow label={`${motion.name} play`} href={motion.href} />
              </Rise>
              <Words
                as="h1"
                text={page.promise}
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
                <HeroButtons play={entry.title} />
                {/* Whether the app does this today: the same status as in the app. */}
                <p
                  data-app-status={APP_PLAYS[slug].status}
                  className={`mt-4 text-[13px] ${muted}`}
                >
                  {statusLine(APP_PLAYS[slug].status)}
                </p>
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

      <Split id="situation" label="The situation" title={page.situation.title}>
        <div className="space-y-5">
          {page.situation.body.map((p) => (
            <Rise key={p}>
              <p className="text-[17px] leading-[1.6] text-[#0B0B0C]/80">{p}</p>
            </Rise>
          ))}
        </div>
      </Split>

      <Split
        id="how"
        title="How Dialvo runs it"
        lead={`${page.steps.length} steps, start to finish. You can watch each one happen.`}
      >
        <Steps items={page.steps} />
      </Split>

      <Split
        id="uses"
        title="What this play uses"
        lead="The channels it works on and the parts of the platform behind it."
      >
        <h3 className="text-[13px] text-[#0B0B0C]/50">Channels</h3>
        <div className="mt-3">
          <ChannelChips ids={page.channels} />
        </div>
        <h3 className="mt-9 text-[13px] text-[#0B0B0C]/50">Platform</h3>
        <div className="mt-3">
          <FeatureLinks slugs={page.features} />
        </div>
      </Split>

      <Split
        id="setup"
        title="What you set up"
        lead="A short list, done once. The agents take it from there."
      >
        <Checklist items={page.setup} />
      </Split>

      <Split id="faq" title="Questions about this play">
        <FaqList faqs={page.faqs} />
      </Split>

      <Band title="Related plays">
        <PlayCards slugs={page.related} />
      </Band>
    </PageShell>
  );
}
