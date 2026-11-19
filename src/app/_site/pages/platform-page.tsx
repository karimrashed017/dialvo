import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { GROUPS, itemInfo, PLATFORM_PAGE } from "@/lib/content";
import { Rise, Words } from "../motion";
import { muted, serif } from "../theme";
import {
  Band,
  Breadcrumbs,
  Eyebrow,
  FaqList,
  HeroButtons,
  PointGrid,
  Split,
} from "./parts";
import { PageShell } from "./shell";

/** /platform: the six groups and every feature in them. */
export function PlatformPage() {
  const page = PLATFORM_PAGE;
  return (
    <PageShell>
      <section className="px-5 pt-28 pb-6 sm:pt-36">
        <div className="mx-auto max-w-[1180px]">
          <Breadcrumbs
            trail={[
              { name: "Home", href: "/" },
              { name: "Platform", href: "/platform" },
            ]}
          />
          <div className="mt-8 max-w-[860px]">
            <Rise>
              <Eyebrow label="Platform · six groups, 23 features" />
            </Rise>
            <Words
              as="h1"
              text={page.headline}
              delay={0.05}
              className={`${serif} mt-6 text-[44px] leading-[1] sm:text-[72px]`}
            />
            <Rise delay={0.3}>
              <p
                className={`mt-6 max-w-[680px] text-[17px] leading-[1.55] sm:text-[18px] ${muted}`}
              >
                {page.intro}
              </p>
            </Rise>
            <Rise delay={0.4} className="mt-8">
              <HeroButtons />
            </Rise>
          </div>
          {/* Jump links to the six groups. */}
          <Rise delay={0.45}>
            <ul className="mt-12 flex flex-wrap gap-2">
              {GROUPS.map((g) => (
                <li key={g.id}>
                  <a
                    href={`#${g.id}`}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-black/[0.1] bg-white/70 px-4 text-[14px] text-[#0B0B0C]/80 transition-colors hover:bg-white hover:text-[#0B0B0C]"
                  >
                    <g.icon aria-hidden className="size-[15px]" />
                    {g.title}
                  </a>
                </li>
              ))}
            </ul>
          </Rise>
        </div>
      </section>

      <section className="px-5 py-12 sm:py-16">
        <div className="mx-auto max-w-[1180px] space-y-14">
          {GROUPS.map((g) => (
            <div
              key={g.id}
              id={g.id}
              className="grid scroll-mt-28 gap-5 lg:grid-cols-[260px_1fr] lg:gap-10"
            >
              <Rise>
                <span className="grid size-10 place-items-center rounded-xl border border-black/12 bg-black/[0.05]">
                  <g.icon aria-hidden className="size-[18px]" />
                </span>
                <h2 className={`${serif} mt-4 text-[30px] leading-[1.05]`}>
                  {g.title}
                </h2>
                <p className={`mt-2 text-[15px] leading-[1.5] ${muted}`}>
                  {g.blurb}
                </p>
              </Rise>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.items.map((item, i) => {
                  const it = itemInfo(item);
                  return (
                    <Rise as="li" key={it.key} delay={(i % 3) * 0.06}>
                      <Link
                        href={it.href}
                        className="group flex h-full flex-col rounded-[20px] border border-black/[0.07] bg-white/75 p-5 transition-colors duration-300 hover:bg-white"
                      >
                        <it.icon aria-hidden className="size-[19px]" />
                        <span className="mt-4 block text-[15.5px] font-medium">
                          {it.title}
                        </span>
                        <span
                          className={`mt-1.5 block text-[14px] leading-[1.55] ${muted}`}
                        >
                          {it.blurb}
                        </span>
                        <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[13px] text-[#0B0B0C]/50 transition-colors group-hover:text-[#0B0B0C]">
                          {item.type === "play" ? "See the play" : "Learn more"}
                          <ArrowRight
                            aria-hidden
                            className="size-3.5 transition-transform group-hover:translate-x-0.5"
                          />
                        </span>
                      </Link>
                    </Rise>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <Band id="context" title={page.context.title} lead={page.context.lead}>
        <PointGrid items={page.context.items} cols={3} />
      </Band>

      <Band
        id="governance"
        title={page.governance.title}
        lead={page.governance.lead}
      >
        <PointGrid items={page.governance.items} cols={3} />
      </Band>

      <Split id="faq" title="Platform questions">
        <FaqList faqs={page.faqs} />
      </Split>
    </PageShell>
  );
}
