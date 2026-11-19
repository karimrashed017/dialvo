import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Check,
  MailX,
  MessageSquareText,
  Mic,
  PhoneIncoming,
  PhoneOff,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  GROUPS,
  itemInfo,
  MOTIONS as MOTION_LINKS,
  PLAY_SLUGS,
  type MotionId,
} from "@/lib/content/catalog";
import { cn } from "@/lib/utils";
import labrador from "../../../public/images/art/bradford-coast-of-labrador.jpg";
import { BuyStrip } from "./buy";
import { STARTER_DEAL, startHref } from "./links";
import { Rise, Words } from "./motion";
import { PlayCards } from "./pages/parts";
import { card, GRAIN, muted, serif } from "./theme";

// The home page's sections after the hero and the channel tabs: the tools
// Dialvo connects to, the three motions, the plays, the platform, compliance
// and a last call to action. "You stay in control" (listen.tsx), pricing and
// the FAQ have their own files.

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

// --- Works with -----------------------------------------------------------------

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

export function Tools() {
  return (
    <section className="px-5 pt-14 pb-10">
      <Rise className="mx-auto max-w-[1180px]">
        <p className={`text-center text-[15px] ${muted}`}>
          Works from your CRM, your inbox and your calendar
        </p>
        <ul className="mt-7 flex flex-wrap justify-center gap-2">
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

// --- Three motions ---------------------------------------------------------------

const MOTIONS: {
  id: MotionId;
  name: string;
  title: string;
  body: string;
  flow: string[];
  points: string[];
}[] = [
  {
    id: "inbound",
    name: "Inbound",
    title: "Answer every lead while they're still interested",
    body: "A form is filled in, a visitor opens the chat, someone rings your number. An agent replies in seconds, at any hour, and does the first conversation properly.",
    flow: ["Lead arrives", "Agent replies", "Qualified", "Meeting booked"],
    points: [
      "Speed to lead: a call back or a chat reply within seconds, day or night",
      "Qualification with your questions, scored against your ideal customer",
      "Routing to the right rep by territory, account owner or round robin",
      "Scheduling on the rep's calendar, or a live transfer with a summary",
      "Follow-up by text, WhatsApp and email when nobody picks up",
    ],
  },
  {
    id: "outbound",
    name: "Outbound",
    title: "Start conversations with the accounts worth having",
    body: "Agents build the list, read up on every company, and write to each person for a reason. Email and social carry the outreach; your reps make the calls, with the research in front of them.",
    flow: ["Signal spotted", "Researched", "Sequence sent", "Reply handled"],
    points: [
      "Prospect data: a database of companies and contacts, or your own lists",
      "Live signals: funding, hiring, job changes, new tools, visits to your site",
      "Deep research on every account, with sources",
      "Personalised sequences across email, social and rep calls",
      "Replies sorted and answered, meetings booked, unsubscribes honoured",
      "A human dialer that lines up the next call for your reps",
    ],
  },
  {
    id: "expansion",
    name: "Expansion",
    title: "Give every customer the attention your top ten get",
    body: "Agents check in with the customers your team never has time for, find who is ready for more, and bring a person in when there's a real opportunity.",
    flow: ["Renewal or usage", "Agent checks in", "Need found", "Rep steps in"],
    points: [
      "Upsell and cross-sell: more seats, a bigger plan, a second product",
      "Renewal check-ins well before the date, and win-backs for quiet accounts",
      "Onboarding calls and messages that get new customers to first value",
      "Calls only to customers who opted in; everything logged to the CRM",
    ],
  },
];

export function Motions() {
  return (
    <section id="motions" className="scroll-mt-20 px-5 py-28 sm:py-36">
      <Head
        title="Three motions, one team"
        lead="New leads, new accounts and existing customers each need a different kind of conversation. Dialvo's agents run all three from the same context, so nothing is asked twice."
      />
      <div className="mx-auto mt-16 max-w-[1180px] space-y-3">
        {MOTIONS.map((m, i) => (
          <Rise
            key={m.id}
            delay={0.05}
            className={cn(
              card,
              "grid gap-8 p-7 sm:p-10 lg:grid-cols-[1fr_1.05fr] lg:gap-14",
            )}
          >
            <div id={m.id} className="flex scroll-mt-28 flex-col">
              <p className="flex items-center gap-3 text-[13px] text-[#0B0B0C]/50">
                <span className="tabular-nums">0{i + 1}</span>
                <span className="rounded-full bg-[#0B0B0C] px-2.5 py-0.5 text-[12px] font-medium text-white">
                  {m.name}
                </span>
              </p>
              <h3
                className={`${serif} mt-5 max-w-[460px] text-[32px] leading-[1.06] sm:text-[40px]`}
              >
                <Link href={`/${m.id}`} className="hover:opacity-80">
                  {m.title}
                </Link>
              </h3>
              <p
                className={`mt-4 max-w-[460px] text-[15.5px] leading-[1.6] ${muted}`}
              >
                {m.body}
              </p>
              <Link
                href={`/${m.id}`}
                className="group mt-6 inline-flex items-center gap-1.5 self-start text-[14.5px] font-medium underline decoration-black/25 underline-offset-4 transition-colors hover:decoration-black"
              >
                How {m.name.toLowerCase()} works
                <ArrowRight
                  aria-hidden
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              {/* The motion as four steps. */}
              <ol className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-2 pt-8">
                {m.flow.map((f, j) => (
                  <li key={f} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[12.5px]",
                        j === m.flow.length - 1
                          ? "bg-[#0B0B0C] text-white"
                          : "bg-black/[0.055] text-[#0B0B0C]/75",
                      )}
                    >
                      {f}
                    </span>
                    {j < m.flow.length - 1 && (
                      <ArrowRight
                        aria-hidden
                        className="size-3.5 text-[#0B0B0C]/30"
                      />
                    )}
                  </li>
                ))}
              </ol>
            </div>
            <ul className="divide-y divide-black/[0.07] self-start border-y border-black/[0.07]">
              {m.points.map((p) => (
                <li
                  key={p}
                  className="flex gap-3 py-3.5 text-[15px] leading-[1.5]"
                >
                  <Check
                    aria-hidden
                    className="mt-[4px] size-4 shrink-0 text-[#0B0B0C]/60"
                  />
                  {p}
                </li>
              ))}
            </ul>
          </Rise>
        ))}
      </div>
      <BuyStrip line="Start with one motion and add the others when you're ready." />
    </section>
  );
}

// --- Plays -------------------------------------------------------------------------

export function Plays() {
  return (
    <section id="plays" className="scroll-mt-20 px-5 py-28 sm:py-36">
      <Head
        title="Pick a play and switch it on"
        lead="Each play comes with its own audience, research and follow-up, and its own page explaining how it runs. Start with one, or run several side by side."
      />
      <div className="mx-auto mt-8 flex max-w-[1180px] flex-wrap gap-2">
        {MOTION_LINKS.map((m) => (
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
      </div>
      <div className="mx-auto mt-8 max-w-[1180px]">
        <PlayCards slugs={PLAY_SLUGS} />
      </div>
    </section>
  );
}

// --- Platform ----------------------------------------------------------------------

type Feature = { icon: LucideIcon; title: string; body: string };

export function Platform() {
  return (
    <section id="platform" className="scroll-mt-20 px-5 py-28 sm:py-36">
      <Head
        title="The platform under every agent"
        lead="The same data, research, rules and reporting sit behind every channel, so each agent knows who it's talking to and what happened last time."
      />
      <div className="mx-auto mt-14 grid max-w-[1180px] gap-3 md:grid-cols-2 lg:grid-cols-3">
        {GROUPS.map((g, i) => (
          <Rise
            key={g.id}
            delay={(i % 3) * 0.06}
            className={cn(card, "flex flex-col p-6")}
          >
            <span className="grid size-10 place-items-center rounded-xl border border-black/12 bg-black/[0.05]">
              <g.icon aria-hidden className="size-[18px]" />
            </span>
            <h3 className={`${serif} mt-5 text-[26px] leading-[1.1]`}>
              <Link href={`/platform#${g.id}`} className="hover:opacity-80">
                {g.title}
              </Link>
            </h3>
            <p className={`mt-1.5 text-[14.5px] leading-[1.5] ${muted}`}>
              {g.blurb}
            </p>
            <ul className="mt-4 divide-y divide-black/[0.06] border-t border-black/[0.06]">
              {g.items.map((item) => {
                const it = itemInfo(item);
                return (
                  <li key={it.key}>
                    <Link
                      href={it.href}
                      className="group flex items-center gap-2.5 py-2.5 text-[14.5px] text-[#0B0B0C]/80 transition-colors hover:text-[#0B0B0C]"
                    >
                      <it.icon
                        aria-hidden
                        className="size-4 shrink-0 text-[#0B0B0C]/55"
                      />
                      <span className="min-w-0 flex-1">{it.title}</span>
                      <ArrowRight
                        aria-hidden
                        className="size-3.5 shrink-0 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-60"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Rise>
        ))}
      </div>
      <Rise className="mx-auto mt-8 max-w-[1180px]">
        <p className={`max-w-[720px] text-[15px] leading-[1.55] ${muted}`}>
          You set the rules for all of it: approval thresholds, escalation
          rules, send windows, and agent instructions you can read and edit.{" "}
          <Link
            href="/platform"
            className="inline-flex items-center gap-1 font-medium text-[#0B0B0C] underline decoration-black/25 underline-offset-4 hover:decoration-black"
          >
            See the whole platform
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </p>
      </Rise>
      <BuyStrip line="CRM sync, chat, social, WhatsApp and dialer seats come with Pro." />
    </section>
  );
}

// --- Compliance ------------------------------------------------------------------

// What Dialvo does by default. Plain claims only: no certifications.
const RULES: Feature[] = [
  {
    icon: PhoneIncoming,
    title: "Voice agents call people who asked",
    body: "AI calls go to people who asked to hear from you or opted in: form leads, callers and your own customers.",
  },
  {
    icon: Bot,
    title: "Says it's an AI",
    body: "Every call and chat opens by saying it's an AI assistant working for you. It never pretends to be a person.",
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
];

// Pills set in pairs either side of the shield, mirrored.
const SEALS = [
  { text: "Says it's an AI", className: "left-[4%] top-[26%] sm:left-[17%]" },
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
        title="Built to be trusted by the people it talks to"
        lead="Reaching people has rules. These are on by default, on every channel, so you don't have to remember them."
      />
      <Rise delay={0.15}>
        <Shield />
      </Rise>
      <div className="mx-auto mt-14 grid max-w-[1180px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RULES.map((s, i) => (
          <Rise
            key={s.title}
            delay={(i % 3) * 0.08}
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
      </div>
      <Rise className="mx-auto mt-8 max-w-[660px] text-center">
        <p className="text-[13.5px] leading-[1.55] text-[#0B0B0C]/55">
          Dialvo holds no certifications yet and doesn&apos;t claim any. The
          rules for calls, texts and email differ by country and state, and who
          you contact is up to you. If in doubt, check with a lawyer where you
          sell.
        </p>
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
        <Rise>
          <p className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[13px] text-[#0B0B0C]/75 backdrop-blur-md">
            <span className="size-1.5 rounded-full bg-[#1F3BFF]" />
            Early access
          </p>
        </Rise>
        <Words
          text="Agents open the conversations. Your team closes them."
          className={`${serif} mx-auto mt-6 max-w-[820px] text-[44px] leading-[1.02] sm:text-[68px]`}
        />
        <Rise delay={0.3}>
          <ul className="mx-auto mt-8 flex max-w-[680px] flex-wrap justify-center gap-x-6 gap-y-2 text-[14.5px] text-[#0B0B0C]/75">
            {[
              "Free until your first booked meeting",
              "Every call and message visible",
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
            href="/#channels"
            className="inline-flex h-12 items-center rounded-full border border-black/10 bg-white/70 px-6 text-[15.5px] text-[#0B0B0C] backdrop-blur-md hover:bg-white/90"
          >
            See the product
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
