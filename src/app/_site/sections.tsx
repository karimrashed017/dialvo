import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarCheck,
  Check,
  ClipboardList,
  MessageSquareText,
  PhoneCall,
  PhoneOff,
  Search,
  ShieldCheck,
  Target,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt, PLANS } from "@/lib/site";
import coast from "../../../public/images/art/kensett-rocky-coast.jpg";
import labrador from "../../../public/images/art/bradford-coast-of-labrador.jpg";
import { CountUp, Rise, Words } from "./motion";
import { BuyStrip } from "./buy";
import { STARTER_DEAL, startHref } from "./links";
import { CallPanel, ResearchPanel, TodayPanel } from "./product-cards";
import { ToolsCarousel } from "./tools-carousel";
import { card, GRAIN, muted, serif } from "./theme";

// The home page's sections, in order: tools it works with, three product
// cards, how it works, a grid of everything it does, one month in numbers,
// compliance, example briefs, pricing, questions and a last call to action.
// The listen, free trial and speed-to-lead sections have their own files.

// Only tools Dialvo really connects to. Gmail and Outlook come with email
// outreach (month 2), HubSpot and Pipedrive with CRM sync (month 3).
const LOGOS: { logo?: string; name: string; soon?: boolean }[] = [
  { logo: "google-calendar", name: "Google Calendar" },
  { logo: "whatsapp", name: "WhatsApp" },
  { name: "Text messages" },
  { logo: "gmail", name: "Gmail", soon: true },
  { logo: "outlook", name: "Outlook", soon: true },
  { logo: "hubspot", name: "HubSpot", soon: true },
  { logo: "pipedrive", name: "Pipedrive", soon: true },
];

function Head({
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
          `${serif} max-w-[760px] text-[42px] leading-[1.02] sm:text-[60px]`,
          center && "mx-auto",
        )}
      />
      {lead && (
        <Rise delay={0.2}>
          <p
            className={cn(
              `mt-5 max-w-[520px] text-[17px] leading-[1.55] ${muted}`,
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

export function Logos() {
  return (
    <section className="px-5 pt-8 pb-24">
      <Rise className="mx-auto max-w-[1180px]">
        <p className={`text-center text-[15px] ${muted}`}>
          Works with the tools you already use
        </p>
        <div
          className={cn(
            card,
            "mt-8 grid grid-cols-2 overflow-hidden sm:grid-cols-4",
          )}
        >
          {LOGOS.map((l) => (
            <div
              key={l.name}
              className="flex h-28 items-center justify-center gap-3 border-black/[0.08] [&:not(:nth-child(2n))]:border-r sm:[&:not(:nth-child(4n))]:border-r sm:[&:nth-child(-n+4)]:border-b [&:nth-child(-n+6)]:border-b sm:[&:nth-child(n+5)]:border-b-0"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_12px_-6px_rgba(0,0,0,0.12)]">
                {l.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- tiny local SVGs
                  <img
                    src={`/apps/${l.logo}.svg`}
                    alt=""
                    className="size-[22px]"
                  />
                ) : (
                  <MessageSquareText aria-hidden className="size-[20px]" />
                )}
              </span>
              <span>
                <span className="block text-[15px] text-[#0B0B0C]/80">
                  {l.name}
                </span>
                {l.soon && (
                  <span className="block text-[12px] text-[#0B0B0C]/45">
                    Coming soon
                  </span>
                )}
              </span>
            </div>
          ))}
          <div className="flex h-28 flex-col items-center justify-center px-3 text-center">
            <span className={`${serif} text-[40px] leading-none`}>$0</span>
            <span className="mt-1 text-[13px] text-[#0B0B0C]/55">
              until your first interested prospect
            </span>
          </div>
        </div>
      </Rise>
    </section>
  );
}

// --- Three product cards ------------------------------------------------------

export function Product() {
  return (
    <section id="product" className="scroll-mt-20 px-5 py-28 sm:py-36">
      <Head
        title="Cold email gets ignored. Conversations get answers."
        lead="Inboxes are full and cold email replies keep getting rarer. Dialvo picks up the phone: it researches each business, calls it, and keeps the conversation going until there's a meeting on your calendar."
      />
      <div className="mx-auto mt-16 grid max-w-[1180px] gap-3 lg:grid-cols-3">
        <Rise className={cn(card, "flex flex-col overflow-hidden")}>
          <ResearchPanel />
          <CardText
            title="Researches every lead"
            body="Before it dials, Dialvo reads up on the business, so every call opens with a reason to talk."
          />
        </Rise>

        <Rise
          delay={0.08}
          className={cn(card, "flex flex-col overflow-hidden")}
        >
          <CallPanel />
          <CardText
            title="Calls and books"
            body="A natural AI voice that says it's an AI, handles objections and books the meeting on your calendar."
          />
        </Rise>

        <Rise
          delay={0.16}
          className={cn(card, "flex flex-col overflow-hidden")}
        >
          <TodayPanel />
          <CardText
            title="Hands you the hot ones"
            body="Routine follow-ups just get done. When a prospect wants a person, the call comes straight to you."
          />
        </Rise>
      </div>
      <BuyStrip
        line={`Starter includes ${fmt(PLANS.starter.dials)} dials a month. Free until your first interested prospect.`}
      />
    </section>
  );
}

function CardText({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-6">
      <p className="text-[16px] font-medium">{title}</p>
      <p className={`mt-2 text-[14.5px] leading-[1.55] ${muted}`}>{body}</p>
    </div>
  );
}

// --- How it works -------------------------------------------------------------

const HOW = [
  {
    icon: Target,
    title: "Describe who you sell to",
    body: "One sentence is enough: the kind of business, where, how big, and what you offer them.",
  },
  {
    icon: Search,
    title: "Dialvo finds and researches them",
    body: "It finds businesses that fit and reads up on each one, so every call has a reason. Prospect finder coming soon.",
  },
  {
    icon: PhoneCall,
    title: "It calls, and books the meeting",
    body: "Its AI voice calls them, and your new form leads within 60 seconds. It handles objections and books a time.",
  },
  {
    icon: CalendarCheck,
    title: "It follows up until yes or no",
    body: "By text, WhatsApp and email, to people who opted in. Meetings land on your calendar.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 px-5 py-28 sm:py-36">
      <Head
        title="From one sentence to a booked meeting"
        lead="Tell Dialvo who you sell to. It does the finding, the calling and the chasing, and you show up to the meetings."
      />
      <div className="mx-auto mt-14 grid max-w-[1180px] gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {HOW.map((s, i) => (
          <Rise key={s.title} delay={i * 0.08} className={cn(card, "p-6")}>
            <div className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-xl border border-black/12 bg-black/[0.05]">
                <s.icon aria-hidden className="size-[18px]" />
              </span>
              <span className="text-[13px] text-[#0B0B0C]/40 tabular-nums">
                0{i + 1}
              </span>
            </div>
            <p className="mt-6 text-[16px] font-medium">{s.title}</p>
            <p className={`mt-2 text-[14px] leading-[1.55] ${muted}`}>
              {s.body}
            </p>
          </Rise>
        ))}
      </div>
      <BuyStrip line="Set up in minutes: your pitch, your calendar and who to call." />
    </section>
  );
}

// --- Everything it does ---------------------------------------------------------

export function Everything() {
  return (
    <section className="overflow-hidden py-28 sm:py-36">
      <Head
        title="Everything a sales team does"
        lead="Calls, follow-ups, meetings and the notes in between. What's still being built is marked, so you know what you get today."
        className="px-5"
      />
      <Rise delay={0.1}>
        <ToolsCarousel />
      </Rise>
      <BuyStrip line="The premium voice, WhatsApp follow-up and team seats come with Pro." />
    </section>
  );
}

// --- One month, in numbers -------------------------------------------------------

export function Numbers() {
  return (
    <section className="px-5 py-12">
      <Rise className="relative isolate mx-auto max-w-[1180px] overflow-hidden rounded-[28px] border border-black/[0.07]">
        <Image
          src={coast}
          alt=""
          sizes="(min-width: 1180px) 1180px, 100vw"
          className="absolute inset-0 -z-20 h-full w-full object-cover object-[50%_75%]"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background: `${GRAIN}, linear-gradient(90deg, rgba(247,245,241,0.88), rgba(247,245,241,0.35))`,
          }}
        />
        <div className="grid gap-10 p-8 sm:p-14 lg:grid-cols-[1fr_1.4fr] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[12.5px] backdrop-blur-md">
              <span className="size-1.5 rounded-full bg-[#0B0B0C]" />
              On the {PLANS.starter.name} plan
            </p>
            <Words
              text="What one month includes"
              className={`${serif} mt-6 text-[44px] leading-[1.02] sm:text-[56px]`}
            />
          </div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-black/[0.07] bg-black/[0.07] shadow-[0_24px_60px_-30px_rgba(60,45,30,0.35)]">
            {[
              { n: PLANS.starter.dials, label: "dials a month, by AI voice" },
              {
                n: 60,
                suf: " sec",
                label: "to call a new form lead back, day or night",
              },
              {
                n: PLANS.starter.leadCredits,
                label: "lead credits to find new prospects (coming soon)",
              },
              { n: 0, pre: "$", label: "until your first interested prospect" },
            ].map((s) => (
              <div key={s.label} className="bg-white/85 p-6 backdrop-blur-md">
                <dt className={`${serif} text-[46px] leading-none`}>
                  <CountUp to={s.n} prefix={s.pre} suffix={s.suf} />
                </dt>
                <dd className="mt-3 text-[13.5px] leading-[1.45] text-[#0B0B0C]/60">
                  {s.label}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Rise>
    </section>
  );
}

// --- Compliance ------------------------------------------------------------------

// What Dialvo does on every call. Plain claims only: no certifications.
const RULES = [
  {
    icon: Bot,
    title: "Says it's an AI",
    body: "Every call opens by saying it's an AI assistant calling for you, and that the call is recorded.",
  },
  {
    icon: Building2,
    title: "Calls the right numbers",
    body: "Business lines, and people who asked to hear from you. Mobile numbers only with consent.",
  },
  {
    icon: PhoneOff,
    title: "Do Not Call lists checked",
    body: "Every number is checked before it's dialled, and calls go out only in business hours.",
  },
  {
    icon: ClipboardList,
    title: "Opt-outs honoured, all logged",
    body: "Anyone who says stop is removed straight away, and every call and message is logged.",
  },
];

// Pills set in pairs either side of the shield, mirrored.
const SEALS = [
  { text: "Says it's an AI", className: "left-[4%] top-[26%] sm:left-[17%]" },
  {
    text: "Do Not Call checked",
    className: "right-[4%] top-[26%] sm:right-[14%]",
  },
  {
    text: "Business hours only",
    className: "left-[4%] bottom-[24%] sm:left-[14%]",
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
        {[300, 228, 156].map((d, i) => (
          <span
            key={d}
            className="absolute rounded-full border"
            style={{
              width: d,
              height: d,
              borderColor: `rgba(255,255,255,${0.05 + i * 0.03})`,
            }}
          />
        ))}
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
        <span className="relative grid size-[104px] place-items-center rounded-full border border-black/20 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.16),rgba(255,255,255,0.03)_70%)] shadow-[0_0_80px_-10px_rgba(214,110,60,0.55),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-md">
          <ShieldCheck className="size-9" strokeWidth={1.4} />
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
        className="pointer-events-none absolute top-[38%] left-1/2 -z-10 h-[900px] w-[1300px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,rgba(196,84,40,0.26),rgba(196,84,40,0.1)_45%,transparent)]"
      />
      <Head
        center
        title="Compliance built in"
        lead="Calling people has rules. Dialvo follows them on every call, automatically, so you don't have to remember them."
      />
      <Rise delay={0.15}>
        <Shield />
      </Rise>
      <div className="mx-auto mt-14 grid max-w-[1180px] gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {RULES.map((s, i) => (
          <Rise
            key={s.title}
            delay={i * 0.08}
            className="group rounded-[22px] border border-black/[0.08] bg-white/80 p-6 shadow-[0_12px_32px_-18px_rgba(60,45,30,0.18)] backdrop-blur-md transition-colors duration-300 hover:border-black/15 hover:bg-white"
          >
            <span className="grid size-10 place-items-center rounded-xl border border-black/12 bg-black/[0.05] transition-transform duration-300 group-hover:scale-105">
              <s.icon aria-hidden className="size-[18px]" />
            </span>
            <p className="mt-6 text-[16px] font-medium">{s.title}</p>
            <p className={`mt-2 text-[14px] leading-[1.55] ${muted}`}>
              {s.body}
            </p>
          </Rise>
        ))}
      </div>
      <Rise className="mx-auto mt-8 max-w-[640px] text-center">
        <p className="text-[13.5px] leading-[1.55] text-[#0B0B0C]/55">
          Dialvo helps you follow calling rules, but the rules differ by country
          and state, and how you use it is up to you. If in doubt, check with a
          lawyer where you sell.
        </p>
      </Rise>
    </section>
  );
}

// --- Example briefs -------------------------------------------------------------

// Briefs worth handing over: who to call, why, and what counts as a win.
const ASKS = [
  "Call marketing agencies in Chicago with 5 to 20 staff and book intro calls with me about website redesigns",
  "Call every new demo request within a minute and book them on Priya's calendar",
  "Text everyone who downloaded our pricing guide and didn't book a call, and offer them a time this week",
  "Call dental clinics in Austin on their business lines and offer a free review of their booking page",
  "Call back last quarter's leads who went quiet and ask if the timing's better now",
  "When someone says they're interested, put them straight through to my phone",
];

export function Asks() {
  return (
    <section className="px-5 py-28 sm:py-36">
      <Head
        title="Tell it who you sell to"
        lead="A sentence is enough to start. Dialvo turns it into a list, a pitch and a plan for following up."
      />
      <div className="mx-auto mt-14 grid max-w-[1180px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ASKS.map((a, i) => (
          <Rise
            key={a}
            delay={(i % 3) * 0.08}
            className={cn(card, "flex flex-col justify-between gap-10 p-7")}
          >
            <p className={`${serif} text-[23px] leading-[1.22]`}>“{a}”</p>
            <a
              href={startHref({ brief: a })}
              className="inline-flex items-center gap-1.5 text-[14px] text-[#0B0B0C]/60 transition-colors hover:text-[#0B0B0C]"
            >
              Start with this brief
              <ArrowRight aria-hidden className="size-3.5" />
            </a>
          </Rise>
        ))}
      </div>
      <Rise className="mt-10 text-center">
        <a
          href={startHref()}
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-black/15 bg-white/70 px-5 text-[14.5px] font-medium text-[#0B0B0C] transition-colors hover:bg-white"
        >
          Write your own brief
          <ArrowRight aria-hidden className="size-3.5" />
        </a>
      </Rise>
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
        <Words
          text="It books the meetings. You close the deals."
          className={`${serif} mx-auto max-w-[760px] text-[44px] leading-[1.02] sm:text-[68px]`}
        />
        <Rise delay={0.3}>
          <ul className="mx-auto mt-8 flex max-w-[640px] flex-wrap justify-center gap-x-6 gap-y-2 text-[14.5px] text-[#0B0B0C]/75">
            {[
              "Free until your first interested prospect",
              "Says it's an AI on every call",
              "Cancel anytime",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check aria-hidden className="size-4" />
                {t}
              </li>
            ))}
          </ul>
        </Rise>
        <Rise
          delay={0.45}
          className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <a
            href={startHref()}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-[#0B0B0C] px-6 text-[15.5px] font-medium text-white hover:bg-black/85"
          >
            Get early access
            <ArrowRight aria-hidden className="size-4" />
          </a>
          <Link
            href="/#listen"
            className="inline-flex h-12 items-center rounded-full border border-black/10 bg-white/70 px-6 text-[15.5px] text-[#0B0B0C] backdrop-blur-md hover:bg-white/90"
          >
            Hear a sample call
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
