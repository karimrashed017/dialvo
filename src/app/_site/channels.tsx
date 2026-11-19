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
import { PanelBar } from "./voice-parts";

// The channels section: six tabs, one per channel, each with a line about
// what the agent does there and a product panel beside it. The tabs move on
// by themselves, slowly, and stop while someone is reading or clicking.
// Every person and business in the panels is made up, and each panel is
// marked "Example". The Voice tab is a sample transcript too: the one live
// demo on the page sits in the section above (voice-section.tsx), and the
// Voice panel links up to it.

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

export function Channels() {
  const [active, setActive] = useState<TabId>("voice");
  const [hover, setHover] = useState(false);
  const [inView, setInView] = useState(false);
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
    <section
      id="channels"
      className="scroll-mt-20 px-5 pt-12 pb-16 sm:pt-16 sm:pb-20"
    >
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
            text="One conversation, wherever they answer."
            className={`${serif} text-[40px] leading-[1.02] sm:text-[56px]`}
          />
          <Rise delay={0.1}>
            <p
              className={`mt-5 max-w-[500px] text-[17px] leading-[1.55] ${muted}`}
            >
              Voice, email, chat, social, SMS and WhatsApp, run by agents that
              know what was already said. Nobody gets the same message twice,
              and nobody gets forgotten.
            </p>
          </Rise>
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
              className="mt-6 max-w-[500px] animate-in border-l-2 border-[#1F3BFF] pl-4 text-[16px] leading-[1.5] text-[#0B0B0C]/80 duration-500 fade-in sm:min-h-[72px]"
            >
              {tab.line}
            </p>
          </Rise>

          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 pt-10">
            <a
              href={startHref()}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#0B0B0C] px-5 text-[14.5px] font-medium text-white transition-colors hover:bg-black/85"
            >
              Join the waitlist
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
              {active === "voice" && <VoicePanel />}
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

// --- Shared pieces -------------------------------------------------------------

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

const CALL: Msg[] = [
  {
    me: true,
    text: "Hi Lena, it's Northwind Agency, and this call is recorded. Got a minute?",
  },
  { text: "That was quick. Yes, go ahead." },
  { me: true, text: "What should the new site do first?" },
  { text: "Take bookings for both clinics." },
  {
    me: true,
    text: "Priya has Tuesday at 10:30 or Thursday at 2. Which suits you?",
  },
];

/** A sample call as a transcript. The live agent is one section up. */
function VoicePanel() {
  const shown = useReveal(CALL.length, 1500);
  return (
    <>
      <PanelBar icon={Phone} title="Voice agent" note="Speed to lead" />
      <div className="shrink-0 border-b border-black/[0.06] px-4 py-3">
        <span className="block text-[14px] font-medium">Lena Ortiz</span>
        <span className="block truncate text-[12px] text-[#0B0B0C]/50">
          Bright Smile Dental · filled in the contact form at 21:14
        </span>
      </div>
      <Bubbles
        messages={CALL}
        shown={shown}
        meLabel="AI assistant"
        themLabel="Lena"
      />
      <p className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-black/[0.07] px-4 py-3 text-[12px] leading-[1.4] text-[#0B0B0C]/50">
        A sample transcript.
        <a
          href="#voice-demo"
          className="inline-flex items-center gap-1.5 font-medium text-[#1F3BFF] hover:underline"
        >
          <Mic aria-hidden className="size-3.5" />
          Talk to the live agent
        </a>
      </p>
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
    text: "We do. How many locations do you have, and what's the site built on today?",
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
            Replies in seconds
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
    text: "Hi Lena, it's Northwind Agency. Sorry we missed you just now. Would a quick call tomorrow suit?",
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
