import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
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
  title: "Pricing · Dialvo, inbound and outbound sales run by AI agents",
  description: `Dialvo is free for ${TRIAL.days} days. Then Starter at $${PLANS.starter.price} a month (voice, email and SMS agents for inbound leads), Pro at $${PLANS.pro.price} a month (inbound, outbound, closing and expansion on every channel, with human dialer seats and CRM sync) or Scale at $${PLANS.scale.price} a month (several workspaces and much higher limits). Cancel anytime.`,
  path: "/pricing",
});

// true: included. false: not on this plan. A string: the allowance.
type Cell = boolean | string;
const { starter, pro, scale } = PLANS;
const ROWS: { group: string; rows: [string, Cell, Cell, Cell][] }[] = [
  {
    group: "Channels",
    rows: [
      ["Voice agent for inbound leads and callers", true, true, true],
      ["Email agent, from your own inbox", true, true, true],
      ["SMS follow-up, with people who opted in", true, true, true],
      ["Website chat agent", false, true, true],
      ["Social agent", false, true, true],
      ["WhatsApp follow-up, with people who opted in", false, true, true],
      [
        "Human dialer for your reps",
        false,
        `${pro.dialerSeats} seats`,
        `${scale.dialerSeats} seats`,
      ],
    ],
  },
  {
    group: "Allowances",
    rows: [
      [
        "AI calls a month",
        fmt(starter.calls),
        fmt(pro.calls),
        fmt(scale.calls),
      ],
      [
        "Lead credits a month",
        fmt(starter.leadCredits),
        fmt(pro.leadCredits),
        fmt(scale.leadCredits),
      ],
      [
        "Sending inboxes",
        String(starter.inboxes),
        String(pro.inboxes),
        String(scale.inboxes),
      ],
      ["Voices", "Standard", "Standard and premium", "Standard and premium"],
      [
        "Workspaces for separate clients or brands",
        "1",
        "1",
        String(scale.workspaces),
      ],
    ],
  },
  {
    group: "Motions and plays",
    rows: [
      ["Inbound: speed to lead, qualification, scheduling", true, true, true],
      ["Outbound: research and personalised email", true, true, true],
      ["Multi-channel sequences (email, social, rep calls)", false, true, true],
      [
        "AI closer for simple sales: payment links, bookings and agreements",
        false,
        true,
        true,
      ],
      ["Expansion: upsell, renewals and onboarding", false, true, true],
    ],
  },
  {
    group: "Platform",
    rows: [
      ["Knowledge base and smart replies", true, true, true],
      ["Google Calendar booking and live transfer", true, true, true],
      ["Gmail and Outlook", true, true, true],
      ["Recordings, transcripts and one inbox", true, true, true],
      ["Approve before send", true, true, true],
      ["CRM sync: Salesforce, HubSpot, Pipedrive, Zoho", false, true, true],
      ["Lead routing rules", false, true, true],
      ["Slack alerts and the API", false, true, true],
      [
        "Approval thresholds, escalation rules, send windows",
        false,
        true,
        true,
      ],
      ["Custom playbooks for each workspace", false, false, true],
      ["Priority support and hands-on setup", false, false, true],
    ],
  },
];

function Value({ v }: { v: Cell }) {
  if (v === true) return <Check aria-label="Included" className="size-4" />;
  if (v === false)
    return (
      <Minus aria-label="Not included" className="size-4 text-[#0B0B0C]/30" />
    );
  return <span>{v}</span>;
}

export default function Pricing() {
  const cols = [
    { id: "starter" as const, name: starter.name, price: starter.price },
    { id: "pro" as const, name: pro.name, price: pro.price },
    { id: "scale" as const, name: scale.name, price: scale.price },
  ];
  return (
    <SiteFrame>
      <SiteNav />
      <main className="flex-1 pt-20">
        <PricingSection as="h1" />

        <section className="px-5 pb-12">
          <div className="mx-auto max-w-[1180px]">
            <Words
              text="Compare plans"
              className={`${serif} text-[40px] leading-none sm:text-[52px]`}
            />
            <Rise className="mt-10 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-[14.5px]">
                <thead>
                  <tr className="border-b border-black/[0.1]">
                    <th className="w-[37%] py-5 font-normal text-[#0B0B0C]/45">
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
                        colSpan={4}
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
            <p className="mt-6 max-w-[760px] text-[13.5px] leading-[1.55] text-[#0B0B0C]/55">
              The free trial lasts {TRIAL.days} days. Add-ons on any plan: extra
              AI calls, lead credits, sending inboxes and dialer seats. Need
              more than Scale? Email us and we&apos;ll put a plan together.
              Channels are switched on in stages: ask us what&apos;s ready for
              your use case.
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
