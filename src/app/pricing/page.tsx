import type { Metadata } from "next";
import { Check, Clock, Minus } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { fmt, PLANS, TRIAL } from "@/lib/site";
import { StickyBuy } from "../_site/buy";
import { FaqSection } from "../_site/faq";
import { FAQS } from "../_site/faqs";
import { SiteFooter } from "../_site/footer";
import { startHref } from "../_site/links";
import { Rise, Words } from "../_site/motion";
import { SiteNav } from "../_site/nav";
import { PricingSection } from "../_site/pricing";
import { FinalCall } from "../_site/sections";
import { serif, SiteFrame, siteViewport } from "../_site/theme";

export const viewport = siteViewport;

export const metadata: Metadata = pageMetadata({
  title: "Pricing · Dialvo, the AI sales team",
  description: `Dialvo is free until your first interested prospect (up to ${TRIAL.dials} dials). Then Starter at $${PLANS.starter.price} a month or Pro at $${PLANS.pro.price} a month for AI sales calls, follow-up and booked meetings. Cancel anytime.`,
  path: "/pricing",
});

// true: included. false: not on this plan. "soon": on this plan once built.
type Cell = boolean | "soon" | string;
const { starter, pro } = PLANS;
const ROWS: { group: string; rows: [string, Cell, Cell][] }[] = [
  {
    group: "Calling",
    rows: [
      ["Dials a month", fmt(starter.dials), fmt(pro.dials)],
      ["AI voice", "Standard", "Premium, ultra-realistic"],
      ["Calls new form leads within 60 seconds, 24/7", true, true],
      ["Every call recorded and transcribed", true, true],
      ["Live transfer to you", true, true],
      ["Meetings booked on Google Calendar", true, true],
      ["Change the voice and personality", true, true],
      ["Compliance checks on every call", true, true],
    ],
  },
  {
    group: "Follow-up",
    rows: [
      ["Text (SMS) follow-up, to people who opted in", true, true],
      ["WhatsApp follow-up, to people who opted in", false, true],
      ["AI email from your own inbox", "soon", "soon"],
      ["Email campaigns", false, "soon"],
      ["Chat agent for your website", false, "soon"],
    ],
  },
  {
    group: "Finding leads",
    rows: [
      [
        "Lead credits a month (prospect finder)",
        `${fmt(starter.leadCredits)} · soon`,
        `${fmt(pro.leadCredits)} · soon`,
      ],
      ["Research on every lead", "soon", "soon"],
      ["Knowledge base: your docs, site and pitch", "soon", "soon"],
    ],
  },
  {
    group: "Your team",
    rows: [
      ["One dashboard of calls, conversations and meetings", "soon", "soon"],
      ["CRM sync with HubSpot and Pipedrive", false, "soon"],
      ["Team seats", false, true],
    ],
  },
];

function Value({ v }: { v: Cell }) {
  if (v === true) return <Check aria-label="Included" className="size-4" />;
  if (v === false)
    return (
      <Minus aria-label="Not included" className="size-4 text-[#0B0B0C]/30" />
    );
  if (v === "soon")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-[#0B0B0C]/50">
        <Clock aria-hidden className="size-3.5" />
        Coming soon
      </span>
    );
  return <span>{v}</span>;
}

export default function Pricing() {
  const cols = [
    { id: "starter" as const, name: starter.name, price: starter.price },
    { id: "pro" as const, name: pro.name, price: pro.price },
  ];
  return (
    <SiteFrame>
      <SiteNav />
      <main className="flex-1 pt-20">
        <PricingSection
          as="h1"
          title="Free until your first interested prospect"
        />

        <section className="px-5 pb-12">
          <div className="mx-auto max-w-[1180px]">
            <Words
              text="Compare plans"
              className={`${serif} text-[40px] leading-none sm:text-[52px]`}
            />
            <Rise className="mt-10 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-[14.5px]">
                <thead>
                  <tr className="border-b border-black/[0.1]">
                    <th className="w-[46%] py-5 font-normal text-[#0B0B0C]/45">
                      Plans
                    </th>
                    {cols.map((c) => (
                      <th key={c.name} className="py-5 font-normal">
                        <p className={`${serif} text-[26px]`}>{c.name}</p>
                        <p className="text-[#0B0B0C]/55">
                          ${c.price} a month after the trial
                        </p>
                        <a
                          href={startHref({ plan: c.id })}
                          className="mt-3 inline-flex h-8 items-center rounded-full border border-black/15 px-3.5 text-[13px] hover:bg-black/[0.06]"
                        >
                          Start free
                        </a>
                      </th>
                    ))}
                  </tr>
                </thead>
                {ROWS.map((g) => (
                  <tbody key={g.group}>
                    <tr>
                      <td
                        colSpan={3}
                        className="pt-10 pb-3 text-[13px] text-[#0B0B0C]/45"
                      >
                        {g.group}
                      </td>
                    </tr>
                    {g.rows.map(([label, ...vals]) => (
                      <tr key={label} className="border-t border-black/[0.06]">
                        <td className="py-4 pr-4 text-[#0B0B0C]/80">{label}</td>
                        {vals.map((v, i) => (
                          <td key={i} className="py-4 pr-4">
                            <Value v={v} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </Rise>
            <p className="mt-6 text-[13.5px] text-[#0B0B0C]/55">
              Add-ons on any plan: extra dials, extra lead credits and extra
              sending inboxes. “Coming soon” features are being built now; they
              aren&apos;t part of a plan until they launch.
            </p>
          </div>
        </section>

        <FaqSection groups={FAQS} />
        <FinalCall />
      </main>
      <SiteFooter />
      <StickyBuy />
    </SiteFrame>
  );
}
