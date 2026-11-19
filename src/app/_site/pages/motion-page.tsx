import type { StaticImageData } from "next/image";
import {
  CHANNELS,
  MOTION_PAGES,
  motionById,
  playsIn,
  type MotionId,
} from "@/lib/content";
import { LayoutDashboard } from "lucide-react";
import heade from "../../../../public/images/art/heade-york-harbor.jpg";
import kensett from "../../../../public/images/art/kensett-rocky-coast.jpg";
import meadow from "../../../../public/images/art/meadow.jpg";
import { Rise, Words } from "../motion";
import { muted, serif } from "../theme";
import {
  Backdrop,
  Band,
  Breadcrumbs,
  Eyebrow,
  FaqList,
  FeatureLinks,
  HeroButtons,
  PlayCards,
  PointGrid,
  Split,
  Steps,
} from "./parts";
import { PageShell } from "./shell";
import { Bars, panel, PanelBar, Rows, Tiles } from "./visual";

// What sits behind each motion's board: two of the site's public-domain
// paintings and the meadow. (The Bradford is behind the last call below.)
const ART: Record<MotionId, StaticImageData> = {
  inbound: heade,
  outbound: kensett,
  expansion: meadow,
};

const BOARD_SIDE: Record<MotionId, string> = {
  inbound: "Today's funnel",
  outbound: "Sending health",
  expansion: "Signals this month",
};

/** /inbound, /outbound and /expansion, from MOTION_PAGES. */
export function MotionPage({ id }: { id: MotionId }) {
  const page = MOTION_PAGES[id];
  const motion = motionById(id);
  const plays = playsIn(id);
  return (
    <PageShell>
      <section className="px-5 pt-28 sm:pt-36">
        <div className="mx-auto max-w-[1180px]">
          <Breadcrumbs
            trail={[
              { name: "Home", href: "/" },
              { name: motion.name, href: motion.href },
            ]}
            className="flex justify-center"
          />
          <div className="mx-auto mt-8 max-w-[880px] text-center">
            <Rise>
              <Eyebrow label={`${motion.name} · one of three motions`} />
            </Rise>
            <Words
              as="h1"
              text={page.headline}
              delay={0.05}
              className={`${serif} mt-6 text-[44px] leading-[1] sm:text-[72px]`}
            />
            <Rise delay={0.3}>
              <p
                className={`mx-auto mt-6 max-w-[680px] text-[17px] leading-[1.55] sm:text-[18px] ${muted}`}
              >
                {page.intro}
              </p>
            </Rise>
            <Rise delay={0.4} className="mt-8">
              <HeroButtons center />
            </Rise>
          </div>

          {/* The motion's board, on a painting. */}
          <Rise delay={0.3} className="mt-14">
            <Backdrop
              image={ART[id]}
              priority
              sizes="(min-width: 1180px) 1180px, 100vw"
              className="sm:p-8 lg:p-10"
            >
              <figure
                aria-label={`An example ${motion.name.toLowerCase()} board. Sample data.`}
                className={panel}
              >
                <PanelBar
                  icon={LayoutDashboard}
                  title={page.board.title}
                  note="Northwind Agency · sample data, not results"
                />
                <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[1.5fr_1fr]">
                  <div className="min-w-0 space-y-3">
                    <Tiles
                      tiles={page.board.tiles}
                      className="grid-cols-2 sm:grid-cols-4"
                    />
                    <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
                      <Rows rows={page.board.feed} />
                    </div>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-black/[0.07] bg-white p-4">
                    <p className="mb-4 text-[13px] font-medium">
                      {BOARD_SIDE[id]}
                    </p>
                    <Bars bars={page.board.stages} />
                    <p className="mt-5 text-[11.5px] leading-[1.45] text-[#0B0B0C]/45">
                      Invented figures to show the layout. Every person and
                      business here is made up.
                    </p>
                  </div>
                </div>
              </figure>
            </Backdrop>
          </Rise>
        </div>
      </section>

      <Band id="problem" title={page.problem.title} lead={page.problem.lead}>
        <PointGrid items={page.problem.points} cols={3} />
      </Band>

      <Split id="how" title={page.steps.title} lead={page.steps.lead}>
        <Steps items={page.steps.items} />
      </Split>

      <Band id="plays" title={`${motion.name} plays`} lead={page.playsLead}>
        <PlayCards slugs={plays} />
      </Band>

      <Band id="channels" title="Channels used" lead={page.channels.lead}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {page.channels.items.map((c, i) => {
            const ch = CHANNELS[c.id];
            return (
              <Rise
                as="li"
                key={c.id}
                delay={i * 0.06}
                className="rounded-[20px] border border-black/[0.07] bg-white/75 p-5"
              >
                <span className="grid size-10 place-items-center rounded-xl border border-black/12 bg-black/[0.05]">
                  <ch.icon aria-hidden className="size-[18px]" />
                </span>
                <h3 className="mt-5 text-[15.5px] font-medium">{ch.label}</h3>
                <p className={`mt-1.5 text-[14.5px] leading-[1.55] ${muted}`}>
                  {c.body}
                </p>
              </Rise>
            );
          })}
        </ul>
      </Band>

      <Band id="control" title={page.controls.title} lead={page.controls.lead}>
        <PointGrid items={page.controls.items} cols={3} />
      </Band>

      <Split
        id="platform"
        title="The platform behind it"
        lead="Each of these has its own page."
      >
        <FeatureLinks slugs={page.features} />
      </Split>

      <Split id="faq" title={`${motion.name} questions`}>
        <FaqList faqs={page.faqs} />
      </Split>
    </PageShell>
  );
}
