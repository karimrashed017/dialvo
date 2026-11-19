"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  Mail,
  MessageCircle,
  MessageSquareText,
  Mic,
  Phone,
  PhoneCall,
  Share2,
  SkipForward,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { MarkAvatar } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import painting from "../../../public/images/art/meadow.jpg";
import { startHref } from "./links";
import { Rise, Words } from "./motion";
import { GRAIN, muted, serif } from "./theme";

// The channels section: six tabs, one per channel, each with a line about
// what the agent does there and a product panel beside it. The tabs move on
// by themselves, slowly, and stop while someone is reading or clicking.
// Every person and business in the panels is made up, and each panel is
// marked "Example".

type TabId = "voice" | "email" | "chat" | "social" | "messages" | "dialer";

const TABS: { id: TabId; label: string; icon: LucideIcon; line: string }[] = [
  {
    id: "voice",
    label: "Voice",
    icon: Phone,
    line: "Voice agents answer and call back the people who asked to hear from you, qualify them on the call, book the meeting and grow existing accounts.",
  },
  {
    id: "email",
    label: "Email",
    icon: Mail,
    line: "Email agents research each account, write one message for one person from your own inbox, and handle the replies.",
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageCircle,
    line: "Chat agents answer website visitors straight away and qualify them in the conversation, with no form to fill in.",
  },
  {
    id: "social",
    label: "Social",
    icon: Share2,
    line: "Social agents start and continue conversations with the right people on professional networks, from your reps' own profiles.",
  },
  {
    id: "messages",
    label: "SMS & WhatsApp",
    icon: MessageSquareText,
    line: "Messaging agents follow up by text and WhatsApp when a call doesn't land, with people who opted in.",
  },
  {
    id: "dialer",
    label: "Human dialer",
    icon: PhoneCall,
    line: "When a rep makes the call, the dialer lines up who to ring next, with the research and the opening line on screen.",
  },
];

/** How long each tab stays before the next one, in seconds. */
const STAY = 9;

const SCENARIOS = [
  {
    name: "Receptionist",
    does: "Answers your main line day and night, and routes each caller.",
    says: "Thanks for calling Northwind Agency. I'm the AI assistant here, and this call is recorded. How can I help?",
  },
  {
    name: "Speed to lead",
    does: "Calls a new form lead back while they're still on your site.",
    says: "Hi Lena, I'm the AI assistant at Northwind Agency. You just asked about a new website. Is now a good time?",
  },
  {
    name: "Upsell",
    does: "Calls customers who opted in, when there's a reason to grow.",
    says: "Hi Marcus, I'm the AI assistant at Northwind Agency. Your care plan renews next month, and I had one idea to share.",
  },
];

// Each voice style changes how fast the waveform moves, so picking one
// visibly does something.
const VOICES = [
  { name: "Warm", pace: 1.25 },
  { name: "Confident", pace: 1 },
  { name: "Upbeat", pace: 0.75 },
  { name: "Calm", pace: 1.6 },
  { name: "Professional", pace: 1.1 },
  { name: "Down to earth", pace: 1.35 },
  { name: "British", pace: 1.15 },
];

export function Channels() {
  const [active, setActive] = useState<TabId>("voice");
  const [hover, setHover] = useState(false);
  const [inView, setInView] = useState(false);
  const [scenario, setScenario] = useState(1);
  const [voice, setVoice] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Only count down while the section is on screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      threshold: 0.35,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const index = TABS.findIndex((t) => t.id === active);
  const tab = TABS[index];
  const next = () => setActive(TABS[(index + 1) % TABS.length].id);
  const running = inView && !hover;

  return (
    <section id="channels" className="scroll-mt-20 px-5 py-28 sm:py-36">
      <div
        ref={box}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="mx-auto grid max-w-[1180px] gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14"
      >
        <div className="flex min-w-0 flex-col">
          <Words
            text="One team of agents, on every channel your buyers use"
            className={`${serif} text-[40px] leading-[1.02] sm:text-[56px]`}
          />
          <Rise delay={0.15} className="mt-8">
            <div
              role="tablist"
              aria-label="Channels"
              className="flex flex-wrap gap-1.5"
            >
              {TABS.map((t) => {
                const on = t.id === active;
                return (
                  <button
                    key={t.id}
                    id={`channel-tab-${t.id}`}
                    role="tab"
                    type="button"
                    aria-selected={on}
                    aria-controls="channel-panel"
                    onClick={() => setActive(t.id)}
                    className={cn(
                      "relative inline-flex h-10 items-center gap-2 overflow-hidden rounded-full px-4 text-[14px] font-medium transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2 focus-visible:outline-none",
                      on
                        ? "bg-[#1F3BFF] text-white"
                        : "border border-black/[0.1] bg-white/60 text-[#0B0B0C]/70 hover:bg-white hover:text-[#0B0B0C]",
                    )}
                  >
                    <t.icon aria-hidden className="size-[15px]" />
                    {t.label}
                    {on && (
                      // The countdown to the next tab; when it fills, move on.
                      <span
                        key={`${t.id}-${inView}`}
                        aria-hidden
                        onAnimationEnd={next}
                        className="absolute bottom-0 left-0 h-[3px] bg-white/45 motion-reduce:hidden"
                        style={{
                          animation: `tab-progress ${STAY}s linear forwards`,
                          animationPlayState: running ? "running" : "paused",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </Rise>

          <Rise delay={0.25}>
            <p
              key={tab.id}
              className={`mt-7 max-w-[500px] animate-in text-[18px] leading-[1.5] duration-500 fade-in sm:min-h-[81px] ${muted}`}
            >
              {tab.line}
            </p>
          </Rise>

          {active === "voice" && (
            <div className="mt-6 animate-in space-y-5 duration-500 fade-in">
              <Chips
                label="Scenario"
                items={SCENARIOS.map((s) => s.name)}
                value={scenario}
                onPick={setScenario}
              />
              <Chips
                label="Voice"
                items={VOICES.map((v) => v.name)}
                value={voice}
                onPick={setVoice}
              />
            </div>
          )}

          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 pt-10">
            <a
              href={startHref()}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#0B0B0C] px-5 text-[14.5px] font-medium text-white transition-colors hover:bg-black/85"
            >
              Get early access
              <ArrowRight aria-hidden className="size-4" />
            </a>
            <span className="rounded-full border border-black/15 px-2.5 py-1 text-[12px] text-[#0B0B0C]/60">
              Early access
            </span>
          </div>
        </div>

        {/* The channel's panel, on the meadow. */}
        <Rise delay={0.1} className="min-w-0">
          <div className="relative isolate overflow-hidden rounded-[28px] border border-black/[0.08] p-3 sm:p-7">
            <Image
              src={painting}
              alt=""
              sizes="(min-width: 1024px) 620px, 100vw"
              className="absolute inset-0 -z-20 h-full w-full object-cover"
            />
            <div
              aria-hidden
              className="absolute inset-0 -z-10"
              style={{
                background: `${GRAIN}, linear-gradient(180deg, rgba(247,245,241,0.25), rgba(247,245,241,0.1))`,
              }}
            />
            <div
              id="channel-panel"
              role="tabpanel"
              aria-labelledby={`channel-tab-${tab.id}`}
              key={tab.id}
              className="flex h-[500px] animate-in flex-col overflow-hidden rounded-[20px] border border-black/[0.07] bg-white/[0.94] shadow-[0_30px_70px_-30px_rgba(40,30,20,0.5)] backdrop-blur-xl duration-500 fade-in slide-in-from-bottom-2 sm:h-[520px]"
            >
              {active === "voice" && (
                <VoicePanel
                  scenario={SCENARIOS[scenario]}
                  voice={VOICES[voice]}
                />
              )}
              {active === "email" && <EmailPanel />}
              {active === "chat" && <ChatPanel />}
              {active === "social" && <SocialPanel />}
              {active === "messages" && <MessagesPanel />}
              {active === "dialer" && <DialerPanel />}
            </div>
          </div>
        </Rise>
      </div>
    </section>
  );
}

function Chips({
  label,
  items,
  value,
  onPick,
}: {
  label: string;
  items: string[];
  value: number;
  onPick: (i: number) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="text-[11.5px] tracking-wide text-[#0B0B0C]/45 uppercase">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((name, i) => (
          <button
            key={name}
            type="button"
            aria-pressed={i === value}
            onClick={() => onPick(i)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none",
              i === value
                ? "bg-[#0B0B0C] text-white"
                : "bg-black/[0.055] text-[#0B0B0C]/70 hover:bg-black/[0.09]",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                i === value ? "bg-white" : "bg-[#0B0B0C]/30",
              )}
            />
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Shared pieces -------------------------------------------------------------

/** The bar across the top of each panel: what it is, and that it's a sample. */
function PanelBar({
  icon: Icon,
  title,
  note,
}: {
  icon: LucideIcon;
  title: string;
  note?: string;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-black/[0.07] px-4">
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 truncate text-[13.5px] font-medium">
        {title}
      </span>
      {note && (
        <span className="hidden truncate text-[12px] text-[#0B0B0C]/45 sm:block">
          {note}
        </span>
      )}
      <span className="ml-auto shrink-0 rounded-full border border-black/15 px-2 py-0.5 text-[10.5px] font-medium tracking-wide text-[#0B0B0C]/55 uppercase">
        Example
      </span>
    </div>
  );
}

/** Shows `count` things one after another; all at once for reduced motion. */
function useReveal(count: number, ms = 1300) {
  const [n, setN] = useState(1);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setN(count));
      return () => cancelAnimationFrame(id);
    }
    const id = setInterval(() => setN((v) => Math.min(v + 1, count)), ms);
    return () => clearInterval(id);
  }, [count, ms]);
  return n;
}

type Msg = { me?: boolean; text: string };

function Bubbles({
  messages,
  shown,
  meLabel,
  themLabel,
}: {
  messages: Msg[];
  shown: number;
  meLabel: string;
  themLabel: string;
}) {
  return (
    <ol className="flex flex-1 flex-col justify-end gap-2 overflow-hidden px-4 py-4">
      {messages.slice(0, shown).map((m) => (
        <li
          key={m.text}
          className={cn(
            "flex max-w-[84%] animate-in flex-col duration-500 fade-in slide-in-from-bottom-1",
            m.me && "ml-auto items-end",
          )}
        >
          <span className="sr-only">{m.me ? meLabel : themLabel}: </span>
          <span
            className={cn(
              "rounded-[18px] px-3.5 py-2 text-[14px] leading-[1.42]",
              m.me
                ? "rounded-br-md bg-[#0B0B0C] text-white"
                : "rounded-bl-md bg-black/[0.06]",
            )}
          >
            {m.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

// --- Voice ---------------------------------------------------------------------

const ORB_BARS = [10, 18, 28, 20, 34, 24, 14, 26, 18, 10];

function VoicePanel({
  scenario,
  voice,
}: {
  scenario: (typeof SCENARIOS)[number];
  voice: (typeof VOICES)[number];
}) {
  return (
    <>
      <PanelBar icon={Phone} title="Voice agent" note={scenario.name} />
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div
          aria-hidden
          className="relative grid size-[200px] place-items-center"
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="dv-ring absolute size-[132px] rounded-full border border-black/40"
              style={{ animationDelay: `${i * 1.1}s` }}
            />
          ))}
          <span className="relative grid size-[132px] place-items-center rounded-full bg-[radial-gradient(circle_at_34%_28%,#55555b,#0B0B0C_68%)] shadow-[0_24px_50px_-18px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.25)]">
            <span className="flex h-10 items-center gap-[4px]">
              {ORB_BARS.map((h, i) => (
                <span
                  key={i}
                  className="dv-wave w-[3px] rounded-full bg-white"
                  style={{
                    height: h,
                    animationDuration: `${voice.pace}s`,
                    animationDelay: `${(i % 5) * -0.17}s`,
                  }}
                />
              ))}
            </span>
          </span>
        </div>
        <p className="mt-2 text-[12px] font-medium tracking-[0.14em] uppercase">
          Ready to talk
        </p>
        <p className="mt-1 text-[12.5px] text-[#0B0B0C]/50">
          {voice.name} voice · {scenario.does}
        </p>
        <p
          key={scenario.name}
          className={`${serif} mt-5 max-w-[400px] animate-in text-[21px] leading-[1.25] duration-500 fade-in`}
        >
          “{scenario.says}”
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-black/[0.07] px-4 py-3">
        <span className="grid size-9 place-items-center rounded-full bg-[#1F3BFF] text-white">
          <Mic aria-hidden className="size-4" />
        </span>
        <span className="text-[12.5px] leading-[1.35] text-[#0B0B0C]/55">
          Says it&apos;s an AI. Recorded and transcribed, with notice.
        </span>
      </div>
    </>
  );
}

// --- Email ---------------------------------------------------------------------

const EMAIL = [
  "Hi Lena,",
  "Congratulations on opening the second Bright Smile clinic. I noticed both locations still take bookings by phone, and that you're hiring a receptionist to keep up.",
  "Northwind builds booking pages for dental practices, so patients can pick a time at either clinic. Would a 15-minute look at how it could work for you be useful next week?",
  "Best, Priya · Northwind Agency",
];

function EmailPanel() {
  const shown = useReveal(EMAIL.length, 900);
  const row = "flex items-center gap-3 border-b border-black/[0.06] py-2.5";
  return (
    <>
      <PanelBar icon={Mail} title="New message" note="from Priya's inbox" />
      <div className="flex flex-1 flex-col overflow-hidden px-5">
        <p className={row}>
          <span className="w-14 shrink-0 text-[12.5px] text-[#0B0B0C]/45">
            To
          </span>
          <span className="truncate rounded-md bg-black/[0.05] px-2 py-0.5 text-[13px]">
            lena@brightsmile.example
          </span>
        </p>
        <p className={row}>
          <span className="w-14 shrink-0 text-[12.5px] text-[#0B0B0C]/45">
            Subject
          </span>
          <span className="truncate text-[13.5px] font-medium">
            Online booking for both clinics
          </span>
        </p>
        <div className="flex-1 space-y-3 overflow-hidden pt-4 text-[14px] leading-[1.55]">
          {EMAIL.slice(0, shown).map((p) => (
            <p key={p} className="animate-in duration-700 fade-in">
              {p}
            </p>
          ))}
          <p className="text-[12px] text-[#0B0B0C]/40 underline">Unsubscribe</p>
        </div>
      </div>
      <div className="shrink-0 border-t border-black/[0.07] px-4 py-3">
        <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#0B0B0C]/50">
          <Sparkles aria-hidden className="size-3.5" />
          Written from research:
          {["Second clinic opened", "Hiring a receptionist"].map((s) => (
            <span
              key={s}
              className="rounded-full bg-black/[0.055] px-2 py-0.5 text-[#0B0B0C]/70"
            >
              {s}
            </span>
          ))}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#0B0B0C] px-3.5 text-[12.5px] font-medium text-white">
            <Check aria-hidden className="size-3.5" />
            Approve and send
          </span>
          <span className="inline-flex h-8 items-center rounded-full border border-black/15 px-3.5 text-[12.5px]">
            Edit
          </span>
        </div>
      </div>
    </>
  );
}

// --- Chat ----------------------------------------------------------------------

const CHAT: Msg[] = [
  { text: "Hi, do you build websites for gyms?" },
  {
    me: true,
    text: "We do. I'm Northwind's AI assistant. How many locations do you have, and what's the site built on today?",
  },
  { text: "Two locations, on an old template. Bookings are a mess." },
  {
    me: true,
    text: "That's exactly what we fix. Priya can walk you through it. Which time suits?",
  },
];

function ChatPanel() {
  const shown = useReveal(CHAT.length + 1);
  return (
    <>
      <PanelBar
        icon={MessageCircle}
        title="Website chat"
        note="northwind.example/pricing"
      />
      <div className="flex shrink-0 items-center gap-2.5 px-4 pt-4">
        <MarkAvatar className="size-8" />
        <span>
          <span className="block text-[13.5px] font-medium">
            Northwind Agency
          </span>
          <span className="block text-[11.5px] text-[#0B0B0C]/50">
            AI assistant · replies in seconds
          </span>
        </span>
      </div>
      <Bubbles
        messages={CHAT}
        shown={shown}
        meLabel="AI assistant"
        themLabel="Visitor"
      />
      <div
        className={cn(
          "flex shrink-0 flex-wrap gap-1.5 px-4 pb-4 transition-opacity duration-500",
          shown > CHAT.length ? "opacity-100" : "opacity-0",
        )}
      >
        {["Thu 2:00 pm", "Fri 11:00 am", "Mon 9:30 am"].map((s, i) => (
          <span
            key={s}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px]",
              i === 0
                ? "border-[#0B0B0C] bg-[#0B0B0C] text-white"
                : "border-black/15",
            )}
          >
            <CalendarCheck aria-hidden className="size-3.5" />
            {s}
          </span>
        ))}
      </div>
    </>
  );
}

// --- Social --------------------------------------------------------------------

const SOCIAL: Msg[] = [
  {
    me: true,
    text: "Hi Maya, I saw your post about opening a third studio. Congratulations. Are you rebuilding class booking as part of it?",
  },
  { text: "Thanks! We are, actually. The current one is painful." },
  {
    me: true,
    text: "We rebuilt booking for two studio groups this year. Happy to share what worked. Would a short call be useful?",
  },
  { text: "Sure, send me some times." },
];

function SocialPanel() {
  const shown = useReveal(SOCIAL.length);
  return (
    <>
      <PanelBar
        icon={Share2}
        title="Direct message"
        note="professional network"
      />
      <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-4 py-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-black/[0.08] text-[13px] font-medium">
          MC
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-medium">Maya Chen</span>
          <span className="block truncate text-[12px] text-[#0B0B0C]/50">
            Head of Operations · Cedar Lane Fitness
          </span>
        </span>
      </div>
      <Bubbles
        messages={SOCIAL}
        shown={shown}
        meLabel="Dialvo, for Priya"
        themLabel="Maya"
      />
      <p className="shrink-0 border-t border-black/[0.07] px-4 py-3 text-[12px] leading-[1.4] text-[#0B0B0C]/50">
        Sent from Priya&apos;s own profile. Dialvo drafts, and she can approve
        each message first.
      </p>
    </>
  );
}

// --- SMS & WhatsApp ----------------------------------------------------------------

const TEXTS: Msg[] = [
  {
    me: true,
    text: "Hi Lena, it's the AI assistant at Northwind Agency. Sorry we missed you just now. Would a quick call tomorrow suit?",
  },
  { text: "Tomorrow after 2 works." },
  {
    me: true,
    text: "Booked: tomorrow at 2:30 pm with Priya. I'll send a reminder an hour before.",
  },
  { text: "Great, thanks." },
];

function MessagesPanel() {
  const [app, setApp] = useState<"SMS" | "WhatsApp">("SMS");
  const shown = useReveal(TEXTS.length);
  return (
    <>
      <PanelBar icon={MessageSquareText} title="Messages" note="Lena Ortiz" />
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-3">
        <span className="min-w-0">
          <span className="block text-[14px] font-medium">Lena Ortiz</span>
          <span className="block truncate text-[12px] text-[#0B0B0C]/50">
            Bright Smile Dental · opted in on the contact form
          </span>
        </span>
        <span
          role="group"
          aria-label="Messaging app"
          className="flex shrink-0 rounded-full bg-black/[0.06] p-0.5"
        >
          {(["SMS", "WhatsApp"] as const).map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={app === a}
              onClick={() => setApp(a)}
              className={cn(
                "h-7 rounded-full px-3 text-[12px] font-medium transition-colors",
                app === a
                  ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                  : "text-[#0B0B0C]/55",
              )}
            >
              {a}
            </button>
          ))}
        </span>
      </div>
      <Bubbles
        messages={TEXTS}
        shown={shown}
        meLabel="AI assistant"
        themLabel="Lena"
      />
      <p className="shrink-0 border-t border-black/[0.07] px-4 py-3 text-[12px] leading-[1.4] text-[#0B0B0C]/50">
        {app === "SMS"
          ? "Every text thread can be stopped with a reply of STOP."
          : "Sent from your WhatsApp Business profile, to people who opted in."}
      </p>
    </>
  );
}

// --- Human dialer ----------------------------------------------------------------

const QUEUE = [
  {
    who: "Dr. Lena Ortiz",
    where: "Bright Smile Dental",
    why: "Replied yesterday",
  },
  { who: "Marcus Hale", where: "Harbor & Pine", why: "Opened pricing twice" },
  { who: "Maya Chen", where: "Cedar Lane Fitness", why: "Asked for a call" },
  { who: "Tom Avery", where: "Fernhill Vets", why: "New location" },
];

function DialerPanel() {
  return (
    <>
      <PanelBar icon={PhoneCall} title="Dialer" note="Priya's call list" />
      <div className="grid min-h-0 flex-1 sm:grid-cols-[0.85fr_1.15fr]">
        <ol className="space-y-1 border-b border-black/[0.06] p-2.5 sm:border-r sm:border-b-0">
          {QUEUE.map((q, i) => (
            <li
              key={q.who}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-2.5 py-2",
                i === 0 ? "bg-[#0B0B0C] text-white" : "",
                i > 0 && "hidden sm:flex",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-[11px] tabular-nums",
                  i === 0 ? "bg-white/20" : "bg-black/[0.06]",
                )}
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">
                  {q.who}
                </span>
                <span
                  className={cn(
                    "block truncate text-[11.5px]",
                    i === 0 ? "text-white/60" : "text-[#0B0B0C]/50",
                  )}
                >
                  {q.where} · {q.why}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex min-h-0 flex-col overflow-hidden p-4">
          <p className="text-[11px] tracking-wide text-[#0B0B0C]/45 uppercase">
            Research brief
          </p>
          <p className="mt-1.5 text-[15px] font-medium">Dr. Lena Ortiz</p>
          <p className="text-[12.5px] text-[#0B0B0C]/50">
            Owner · Bright Smile Dental
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px] leading-[1.4]">
            {[
              "Opened a second clinic this autumn",
              "Hiring a receptionist; bookings by phone only",
              "Replied to Tuesday's email: “worth a chat”",
            ].map((f) => (
              <li key={f} className="flex gap-2">
                <Check
                  aria-hidden
                  className="mt-[3px] size-3.5 shrink-0 text-[#0B0B0C]/50"
                />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-xl bg-black/[0.045] px-3 py-2 text-[12.5px] leading-[1.45]">
            <span className="font-medium">Open with:</span> the second clinic,
            then online booking for both.
          </p>
          <div className="mt-auto flex items-center gap-2 pt-3">
            <span className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-[#0B0B0C] text-[13.5px] font-medium text-white">
              <Phone aria-hidden className="size-4" />
              Dial
            </span>
            <span className="inline-flex h-10 items-center gap-1.5 rounded-full border border-black/15 px-4 text-[13px]">
              <SkipForward aria-hidden className="size-3.5" />
              Skip
            </span>
          </div>
        </div>
      </div>
      <p className="shrink-0 border-t border-black/[0.07] px-4 py-2.5 text-[12px] text-[#0B0B0C]/50">
        Your rep makes the call. Dialvo does the prep and logs the outcome.
      </p>
    </>
  );
}
