import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Database,
  Lock,
  Mail,
  MailX,
  MessageCircle,
  MessageSquareText,
  Mic,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { StaticImageData } from "next/image";
import { Mark } from "@/components/brand/logo";
import { featureHref, playHref, type MotionId } from "@/lib/content/catalog";
import type { Visual } from "@/lib/content/types";
import { cn } from "@/lib/utils";
import labrador from "../../../public/images/art/bradford-coast-of-labrador.jpg";
import niagara from "../../../public/images/art/cole-niagara.jpg";
import heade from "../../../public/images/art/heade-york-harbor.jpg";
import kensett from "../../../public/images/art/kensett-rocky-coast.jpg";
import { STARTER_DEAL, startHref } from "./links";
import { Rise, Words } from "./motion";
import { Backdrop } from "./pages/parts";
import { VisualPanel } from "./pages/visual";
import { card, GRAIN, muted, serif } from "./theme";

// The home page's sections between the hero and pricing, apart from the two
// with moving parts (the live voice demo in voice-section.tsx and the channel
// tabs in channels.tsx) and "Nothing happens out of sight" (listen.tsx):
// the problem, the four jobs (inbound, outbound, closing, expansion), what
// Dialvo replaces, trust, and the last call to action.

export function Head({
  title,
  lead,
  center,
  className,
}: {
  title: string;
  lead?: string;
  center?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto max-w-[1180px]",
        center && "text-center",
        className,
      )}
    >
      <Words
        text={title}
        className={cn(
          `${serif} max-w-[800px] text-[42px] leading-[1.02] sm:text-[60px]`,
          center && "mx-auto",
        )}
      />
      {lead && (
        <Rise delay={0.2}>
          <p
            className={cn(
              `mt-5 max-w-[560px] text-[17px] leading-[1.55] ${muted}`,
              center && "mx-auto",
            )}
          >
            {lead}
          </p>
        </Rise>
      )}
    </div>
  );
}

// --- The problem -------------------------------------------------------------------

// The founder's paragraph, one sentence to a line; the last is the point.
const WASTE = [
  "Leads that wait hours for a reply.",
  "Follow-ups that never get sent.",
  "New accounts nobody has time to research.",
  "Buyers who were ready to say yes and got no answer.",
  "Customers who would buy more if someone asked.",
];

export function Problem() {
  return (
    <section id="problem" className="scroll-mt-20 px-5 pt-24 pb-10 sm:pt-32">
      <div className="mx-auto grid max-w-[1180px] gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
        <Words
          text="There's more selling to do than your team has hours for."
          className={`${serif} max-w-[560px] text-[40px] leading-[1.02] sm:text-[56px]`}
        />
        <Rise delay={0.15} className="lg:pt-3">
          <p className="divide-y divide-black/[0.08] border-y border-black/[0.08]">
            {WASTE.map((line) => (
              <span
                key={line}
                className={`${serif} block py-4 text-[22px] leading-[1.25] text-[#0B0B0C]/80 sm:text-[26px]`}
              >
                {line}{" "}
              </span>
            ))}
          </p>
          <p className="mt-6 text-[17px] leading-[1.55] font-medium">
            Every one of those is business you already paid to get.
          </p>
        </Rise>
      </div>
    </section>
  );
}

// --- Four jobs ---------------------------------------------------------------------

type Tag = { label: string; href?: string };

const JOBS: {
  id: MotionId;
  title: string;
  body: string;
  tags: Tag[];
  art: StaticImageData;
  visual: Visual;
}[] = [
  {
    id: "inbound",
    title: "Inbound: every lead answered in seconds.",
    body: "Forms, calls and chats get a reply straight away, day or night. The agent asks your qualifying questions, books the meeting or passes the call to you live, and keeps following up by email, text and WhatsApp until they answer.",
    tags: [
      { label: "Speed to lead", href: playHref("speed-to-lead") },
      {
        label: "Qualification",
        href: featureHref("inbound-lead-qualification"),
      },
      {
        label: "Meeting scheduling",
        href: playHref("automated-meeting-scheduling"),
      },
      { label: "No-show follow-up" },
    ],
    art: heade,
    visual: {
      kind: "timeline",
      title: "Lead timeline",
      note: "Lena Ortiz · Bright Smile Dental",
      steps: [
        {
          when: "21:14",
          channel: "Form",
          text: "Asked for a quote on the website",
          done: true,
        },
        {
          when: "21:14",
          channel: "Voice",
          text: "Called back and asked your qualifying questions",
          done: true,
        },
        {
          when: "21:19",
          channel: "Calendar",
          text: "Booked with Priya for Tuesday 10:30",
          done: true,
        },
        {
          when: "21:20",
          channel: "SMS",
          text: "Confirmation sent; a reminder goes out the day before",
        },
      ],
      foot: "Sample data. Every person and business here is made up.",
    },
  },
  {
    id: "outbound",
    title: "Outbound: new business, found and opened for you.",
    body: "Dialvo builds lists of companies that fit you, researches each one and writes to every person for a reason. Cold email goes from your own inboxes, LinkedIn messages from your reps' own profiles, and your reps get a call list with the research ready. Replies are handled and meetings booked.",
    tags: [
      { label: "Lead generation", href: playHref("outbound-lead-generation") },
      {
        label: "Cold email",
        href: featureHref("deliverability-and-mailbox-health"),
      },
      {
        label: "LinkedIn outreach",
        href: featureHref("multi-channel-sequences"),
      },
      { label: "Lead reactivation", href: playHref("lead-reactivation") },
      { label: "Closed-lost win-back", href: playHref("closed-lost") },
      { label: "Competitive takeout", href: playHref("competitive-takeout") },
    ],
    art: kensett,
    visual: {
      kind: "list",
      title: "Outbound · this week",
      note: "Northwind Agency",
      rows: [
        {
          name: "Marcus Hale · Harbor Fitness",
          detail: "Email, then LinkedIn · replied “Thursday works”",
          tag: "Booked Thu 11:00",
          strong: true,
        },
        {
          name: "Dana Whitlock · Fernhill Logistics",
          detail: "Asked about integrations · answered",
          tag: "Reply handled",
        },
        {
          name: "Jonas Keller · Praxis Leipzig",
          detail: "LinkedIn note drafted from the research",
          tag: "Awaiting approval",
        },
        {
          name: "Maya Chen · Cedar Lane Fitness",
          detail: "Opened twice · brief and opening line ready",
          tag: "On Priya's call list",
        },
      ],
      foot: "Sample data. Every person and business here is made up.",
    },
  },
  {
    id: "closing",
    title: "Closing: simple sales, finished on the spot.",
    body: "When the answer is yes, the agent doesn't wait for a meeting. It confirms the offer, answers the last questions, and sends the payment link, booking or agreement right there on the call or chat. Bigger or more complex deals go to your team with everything already covered.",
    tags: [
      { label: "Paid bookings", href: "/closing#scope" },
      { label: "Fixed-price offers", href: "/closing#scope" },
      { label: "Plan upgrades", href: playHref("customer-expansion") },
      { label: "Renewals", href: "/expansion" },
    ],
    art: labrador,
    visual: {
      kind: "thread",
      title: "Website chat",
      note: "Northwind Agency · 21:07",
      messages: [
        { text: "That's all I needed. Let's go with the Care plan." },
        {
          agent: true,
          text: "Great. To confirm: Care is $150 a month, with hosting, security updates and one hour of changes. Shall I send the payment link?",
        },
        { text: "Yes please. Is there a contract?" },
        {
          agent: true,
          text: "No contract; you can cancel any month. Here's your secure link: pay.northwind.example/care",
        },
        { text: "Done." },
        {
          agent: true,
          text: "Payment received, thank you. Priya will be in touch tomorrow to get you set up.",
        },
      ],
      foot: "Sample conversation. The agent never asks for card details; payment happens on the secure page.",
    },
  },
  {
    id: "expansion",
    title: "Expansion: more from the customers you already have.",
    body: "Winning a customer is the expensive part. Dialvo checks in after they buy, helps them get set up, raises renewals before they lapse and offers the upgrade at the right moment, with every customer and not just your biggest ones. Old leads and lost deals get worked again when something changes.",
    tags: [
      {
        label: "Customer onboarding",
        href: playHref("customer-onboarding-operations"),
      },
      { label: "Renewals" },
      {
        label: "Upgrades and cross-sell",
        href: playHref("customer-expansion"),
      },
      { label: "PLG conversion", href: playHref("plg-conversion") },
      { label: "Lead reactivation", href: playHref("lead-reactivation") },
      { label: "Closed-lost win-back", href: playHref("closed-lost") },
    ],
    art: niagara,
    // Statuses only: no revenue or result numbers, even as samples.
    visual: {
      kind: "list",
      title: "Accounts · this month",
      note: "Northwind Agency",
      rows: [
        {
          name: "Harbor Fitness · Care plan",
          detail: "Renewal in 21 days · check-in sent",
          tag: "Renewal",
        },
        {
          name: "Fernhill Logistics · Team plan",
          detail: "Hit seat limit · upgrade offered",
          tag: "Upgrade",
          strong: true,
        },
        {
          name: "Bright Smile Dental · new this week",
          detail: "Onboarding call booked for Thursday 10:00",
          tag: "Onboarding",
        },
        {
          name: "Cedar Lane Fitness · Care plan",
          detail: "Went quiet · re-engaged by email",
          tag: "Re-engaged",
        },
      ],
      foot: "Sample data. Every person and business here is made up.",
    },
  },
];

export function Jobs() {
  return (
    <section id="what" className="scroll-mt-20 px-5 pt-12 pb-20 sm:pb-24">
      <div className="mx-auto max-w-[1180px] space-y-3">
        {JOBS.map((j, i) => (
          <Rise
            key={j.id}
            delay={0.05}
            className={cn(
              card,
              "grid items-stretch gap-7 p-5 sm:p-8 lg:grid-cols-2 lg:gap-12 lg:p-10",
            )}
          >
            <div
              id={j.id}
              className={cn(
                "flex min-w-0 scroll-mt-28 flex-col justify-center",
                i % 2 === 1 && "lg:order-last",
              )}
            >
              <p className="text-[13px] text-[#0B0B0C]/45 tabular-nums">
                0{i + 1}
              </p>
              <h2
                className={`${serif} mt-4 max-w-[500px] text-[32px] leading-[1.06] sm:text-[40px]`}
              >
                {j.title}
              </h2>
              <p
                className={`mt-4 max-w-[500px] text-[15.5px] leading-[1.6] ${muted}`}
              >
                {j.body}
              </p>
              <ul className="mt-6 flex max-w-[500px] flex-wrap gap-1.5">
                {j.tags.map((t) => {
                  const pill =
                    "inline-flex h-8 items-center rounded-full px-3 text-[13px]";
                  return (
                    <li key={t.label}>
                      {t.href ? (
                        <Link
                          href={t.href}
                          className={cn(
                            pill,
                            "border border-black/[0.1] bg-white text-[#0B0B0C]/80 transition-colors hover:border-black/25 hover:text-[#0B0B0C]",
                          )}
                        >
                          {t.label}
                        </Link>
                      ) : (
                        <span
                          className={cn(
                            pill,
                            "bg-black/[0.055] text-[#0B0B0C]/70",
                          )}
                        >
                          {t.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Link
                href={`/${j.id}`}
                className="group mt-8 inline-flex items-center gap-1.5 self-start text-[14.5px] font-medium underline decoration-black/25 underline-offset-4 transition-colors hover:decoration-black"
              >
                How {j.id} works
                <ArrowRight
                  aria-hidden
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </div>
            <Backdrop
              image={j.art}
              sizes="(min-width: 1024px) 540px, 100vw"
              className="flex min-w-0 items-center rounded-[22px] sm:p-6"
            >
              <VisualPanel visual={j.visual} className="w-full" />
            </Backdrop>
          </Rise>
        ))}
      </div>
      <Rise className="mx-auto mt-8 flex max-w-[1180px] flex-wrap items-center justify-center gap-x-7 gap-y-3 text-[14.5px]">
        {[
          { href: "/plays", label: "See all plays" },
          { href: "/platform", label: "See the platform" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="group inline-flex items-center gap-1.5 text-[#0B0B0C]/70 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#0B0B0C] hover:decoration-black"
          >
            {l.label}
            <ArrowRight
              aria-hidden
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        ))}
      </Rise>
    </section>
  );
}

// --- What it replaces ---------------------------------------------------------------

const PILE: { icon: LucideIcon; name: string }[] = [
  { icon: PhoneCall, name: "A dialer" },
  { icon: Mail, name: "An email sequencer" },
  { icon: MessageCircle, name: "A chat widget" },
  { icon: Database, name: "A lead database" },
  { icon: UserRound, name: "Someone to run them all" },
];

// The tools Dialvo connects to. Those with a logo file in public/apps show
// it; the rest show their name.
const TOOLS: { logo?: string; name: string }[] = [
  { name: "Salesforce" },
  { logo: "hubspot", name: "HubSpot" },
  { logo: "pipedrive", name: "Pipedrive" },
  { name: "Zoho" },
  { logo: "gmail", name: "Gmail" },
  { logo: "outlook", name: "Outlook" },
  { logo: "google-calendar", name: "Google Calendar" },
  { name: "Slack" },
  { logo: "whatsapp", name: "WhatsApp" },
  { name: "API" },
];

export function Replaces() {
  return (
    <section id="replaces" className="scroll-mt-20 px-5 py-24 sm:py-32">
      <Head
        title="One team instead of five tools and a hire."
        lead="A dialer, an email sequencer, a chat widget, a lead database and someone to run them all. Dialvo is one system with one inbox, at a price you can decide on today."
      />
      <div className="mx-auto mt-12 grid max-w-[1180px] items-stretch gap-3 lg:grid-cols-[1.25fr_auto_1fr]">
        <Rise className="flex items-center rounded-[28px] border border-dashed border-black/20 p-5 sm:p-7">
          <ul className="grid w-full gap-2 sm:grid-cols-2">
            {PILE.map((t) => (
              <li
                key={t.name}
                className="flex h-14 items-center gap-3 rounded-2xl border border-black/[0.07] bg-white/60 px-4 text-[15px] text-[#0B0B0C]/65 last:sm:col-span-2"
              >
                <t.icon aria-hidden className="size-[18px] shrink-0" />
                {t.name}
              </li>
            ))}
          </ul>
        </Rise>
        <div
          aria-hidden
          className="grid place-items-center py-1 text-[#0B0B0C]/35 lg:px-2"
        >
          <ArrowRight className="size-6 rotate-90 lg:rotate-0" />
        </div>
        <Rise
          delay={0.1}
          className={cn(card, "flex flex-col justify-center p-7 sm:p-9")}
        >
          <span className="grid size-12 place-items-center rounded-2xl bg-[#1F3BFF] text-white">
            <Mark white className="size-6" />
          </span>
          <p className={`${serif} mt-6 text-[34px] leading-[1.05]`}>Dialvo</p>
          <ul className="mt-4 space-y-2 text-[15.5px] text-[#0B0B0C]/75">
            {["One system", "One inbox", "A price you can decide on today"].map(
              (t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-[#1F3BFF]"
                  />
                  {t}
                </li>
              ),
            )}
          </ul>
        </Rise>
      </div>
      <Rise className="mx-auto mt-12 max-w-[1180px]">
        <p className={`text-center text-[15px] ${muted}`}>
          Works from your CRM, your inbox and your calendar
        </p>
        <ul className="mt-6 flex flex-wrap justify-center gap-2">
          {TOOLS.map((t) => (
            <li
              key={t.name}
              className="inline-flex h-11 items-center gap-2.5 rounded-full border border-black/[0.07] bg-white px-4 text-[14px] text-[#0B0B0C]/80 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
            >
              {t.logo && (
                // eslint-disable-next-line @next/next/no-img-element -- tiny local SVGs
                <img
                  src={`/apps/${t.logo}.svg`}
                  alt=""
                  className="size-[18px]"
                />
              )}
              {t.name}
            </li>
          ))}
        </ul>
      </Rise>
    </section>
  );
}

// --- Compliance ------------------------------------------------------------------

// What Dialvo does by default. Plain claims only: no certifications.
const RULES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: PhoneIncoming,
    title: "Voice agents call people who asked",
    body: "AI calls go to people who asked to hear from you or opted in: form leads, callers and your own customers.",
  },
  {
    icon: Mic,
    title: "Recorded, with notice",
    body: "Calls are recorded and transcribed, and the person on the line is told so at the start.",
  },
  {
    icon: PhoneOff,
    title: "Opt-outs and Do Not Call",
    body: "Anyone who says stop is removed straight away, and Do Not Call lists are checked before a number is dialled.",
  },
  {
    icon: MailX,
    title: "Unsubscribe on every email",
    body: "Every email carries a working unsubscribe link and your details, and unsubscribes are honoured at once.",
  },
  {
    icon: MessageSquareText,
    title: "Texts only with consent",
    body: "SMS and WhatsApp go to people who agreed to them, inside the send windows you set.",
  },
  {
    icon: Lock,
    title: "Payments by secure link",
    body: "When an agent closes a sale, payment goes through a secure link. Card numbers are never asked for or read out over a call.",
  },
];

// Pills set in pairs either side of the shield, mirrored.
const SEALS = [
  {
    text: "Secure payment links",
    className: "left-[4%] top-[26%] sm:left-[15%]",
  },
  {
    text: "Recorded with notice",
    className: "right-[4%] top-[26%] sm:right-[14%]",
  },
  {
    text: "Consent first",
    className: "left-[4%] bottom-[24%] sm:left-[16%]",
  },
  {
    text: "Opt-outs honoured",
    className: "right-[4%] bottom-[24%] sm:right-[17%]",
  },
];

/** The shield at the centre, inside slowly turning rings. */
function Shield() {
  return (
    <div aria-hidden className="relative mx-auto mt-14 h-[300px] max-w-[880px]">
      <div className="absolute inset-0 grid place-items-center">
        <span
          className="absolute size-[264px] rounded-full border border-dashed border-black/15 motion-safe:animate-spin"
          style={{ animationDuration: "60s" }}
        />
        <span
          className="absolute size-[192px] rounded-full motion-safe:animate-spin"
          style={{
            animationDuration: "14s",
            background:
              "conic-gradient(from 0deg, transparent 0 78%, rgba(255,255,255,0.5) 96%, transparent 100%)",
            mask: "radial-gradient(closest-side, transparent calc(100% - 1.5px), black calc(100% - 1px))",
            WebkitMask:
              "radial-gradient(closest-side, transparent calc(100% - 1.5px), black calc(100% - 1px))",
          }}
        />
        <span className="relative grid size-[104px] place-items-center rounded-full border border-black/20 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.16),rgba(255,255,255,0.03)_70%)] shadow-[0_0_80px_-10px_rgba(31,59,255,0.45),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-md">
          <ShieldCheck className="size-9 text-[#1F3BFF]" strokeWidth={1.4} />
        </span>
      </div>
      {SEALS.map((p) => (
        <span
          key={p.text}
          className={cn(
            "absolute hidden rounded-full border border-black/12 bg-white/85 px-3.5 py-1.5 text-[12.5px] text-[#0B0B0C]/75 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.18)] backdrop-blur-md sm:block",
            p.className,
          )}
        >
          {p.text}
        </span>
      ))}
    </div>
  );
}

export function Compliance() {
  return (
    <section
      id="compliance"
      className="relative isolate scroll-mt-20 overflow-hidden px-5 py-32 sm:py-44"
    >
      {/* The glow sits behind the shield and fades to nothing inside its own
          box, so it never meets an edge of the section. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[32%] left-1/2 -z-10 h-[900px] w-[1300px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,rgba(31,59,255,0.16),rgba(31,59,255,0.06)_45%,transparent)]"
      />
      <Head
        center
        title="Your name is on every call. We protect it."
        lead="Voice agents call only people who asked or agreed. Calls are recorded with notice. Opt-outs and Do Not Call lists are honoured automatically. Every email has an unsubscribe link. Payments go through a secure link, never read out over a call."
      />
      <Rise delay={0.15}>
        <Shield />
      </Rise>
      <div className="mx-auto mt-14 grid max-w-[1180px] gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {RULES.map((s, i) => (
          <Rise
            key={s.title}
            delay={(i % 4) * 0.08}
            className="group rounded-[22px] border border-black/[0.08] bg-white/80 p-6 shadow-[0_12px_32px_-18px_rgba(60,45,30,0.18)] backdrop-blur-md transition-colors duration-300 hover:border-black/15 hover:bg-white"
          >
            <span className="grid size-10 place-items-center rounded-xl border border-black/12 bg-black/[0.05] transition-transform duration-300 group-hover:scale-105">
              <s.icon aria-hidden className="size-[18px]" />
            </span>
            <h3 className="mt-6 text-[16px] font-medium">{s.title}</h3>
            <p className={`mt-2 text-[14px] leading-[1.55] ${muted}`}>
              {s.body}
            </p>
          </Rise>
        ))}
        {/* The last two cells: what Dialvo doesn't claim. */}
        <Rise
          delay={0.16}
          className="flex items-center rounded-[22px] border border-dashed border-black/20 p-6 sm:col-span-2"
        >
          <p className="text-[13.5px] leading-[1.55] text-[#0B0B0C]/60">
            Dialvo holds no certifications yet and doesn&apos;t claim any. The
            rules for calls, texts and email differ by country and state, and
            who you contact is up to you. If in doubt, check with a lawyer where
            you sell.
          </p>
        </Rise>
      </div>
    </section>
  );
}

// --- Last call -----------------------------------------------------------------

export function FinalCall() {
  return (
    <section className="px-5 pt-12 pb-24">
      <div className="relative isolate mx-auto max-w-[1180px] overflow-hidden rounded-[32px] border border-black/[0.08] px-6 py-24 text-center sm:py-32">
        <Image
          src={labrador}
          alt=""
          sizes="(min-width: 1180px) 1180px, 100vw"
          className="absolute inset-0 -z-20 h-full w-full object-cover object-[50%_45%]"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background: `${GRAIN}, linear-gradient(180deg, rgba(247,245,241,0.75), rgba(247,245,241,0.35) 60%, rgba(247,245,241,0.6))`,
          }}
        />
        <Rise>
          <p className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[13px] text-[#0B0B0C]/75 backdrop-blur-md">
            <span className="size-1.5 rounded-full bg-[#1F3BFF]" />
            Early access
          </p>
        </Rise>
        <Words
          text="Stop paying for leads nobody answers."
          className={`${serif} mx-auto mt-6 max-w-[820px] text-[44px] leading-[1.02] sm:text-[68px]`}
        />
        <Rise delay={0.3}>
          <p className="mx-auto mt-6 max-w-[520px] text-[17px] leading-[1.55] text-[#0B0B0C]/75 sm:text-[18px]">
            Join the waitlist. It costs nothing until Dialvo books your first
            meeting.
          </p>
        </Rise>
        <Rise
          delay={0.45}
          className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <a
            href={startHref()}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-[#0B0B0C] px-6 text-[15.5px] font-medium text-white hover:bg-black/85"
          >
            Join the waitlist
            <ArrowRight aria-hidden className="size-4" />
          </a>
          <Link
            href="/#voice-demo"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-black/10 bg-white/70 px-6 text-[15.5px] text-[#0B0B0C] backdrop-blur-md hover:bg-white/90"
          >
            <Mic aria-hidden className="size-4" />
            Talk to the agent
          </Link>
        </Rise>
        <Rise delay={0.55}>
          <p className="mt-5 text-[13.5px] text-[#0B0B0C]/60">
            Starter is {STARTER_DEAL} after the free trial.{" "}
            <a
              href="/pricing"
              className="underline decoration-black/25 underline-offset-4 hover:text-[#0B0B0C]"
            >
              Compare plans
            </a>
          </p>
        </Rise>
      </div>
    </section>
  );
}
