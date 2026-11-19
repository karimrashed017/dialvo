"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_SCENARIO, SCENARIOS, VOICES } from "@/lib/voice/config";
import painting from "../../../public/images/art/meadow.jpg";
import { Rise, Words } from "./motion";
import { GRAIN, muted, serif } from "./theme";
import { VoiceDemo } from "./voice-demo";

// "Don't take our word for it. Talk to it.": the live voice demo, in its own
// section straight after the four jobs. This is the only place on the page
// where the real agent runs (voice-demo.tsx); the Voice tab further down is
// a sample transcript that links back here. Every "Talk to the agent" link
// (#voice-demo) scrolls to the panel and puts focus on its button.

export function VoiceSection() {
  const [scenario, setScenario] = useState(
    SCENARIOS.findIndex((s) => s.id === DEFAULT_SCENARIO),
  );
  const [voice, setVoice] = useState(0);
  // A call is being set up or is running: the choices are fixed.
  const [onCall, setOnCall] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const onBusyChange = useCallback((busy: boolean) => setOnCall(busy), []);

  // The scrolling is the link's own (smooth-scroll.tsx, or the browser's for
  // an address that ends in #voice-demo). We only make the demo ready: focus
  // goes to "Talk to the agent" without moving the page again.
  useEffect(() => {
    const ready = () =>
      panel.current
        ?.querySelector<HTMLButtonElement>("button[data-talk]")
        ?.focus({ preventScroll: true });
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (link?.getAttribute("href")?.endsWith("#voice-demo")) ready();
    };
    const onHash = () => {
      if (window.location.hash === "#voice-demo") ready();
    };
    onHash();
    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", onHash);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  return (
    <section id="talk" className="scroll-mt-20 px-5 py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1180px] gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
        <div className="flex min-w-0 flex-col">
          <Rise>
            <p className="inline-flex items-center gap-2 rounded-full border border-[#1F3BFF]/25 bg-white/70 px-3 py-1 text-[12.5px] font-medium text-[#1F3BFF]">
              <span className="size-1.5 rounded-full bg-[#1F3BFF]" />
              Live demo
            </p>
          </Rise>
          <Words
            text="Don't take our word for it. Talk to it."
            className={`${serif} mt-6 text-[40px] leading-[1.02] sm:text-[56px]`}
          />
          <Rise delay={0.15}>
            <p
              className={`mt-5 max-w-[500px] text-[17px] leading-[1.55] ${muted}`}
            >
              This is a live Dialvo voice agent. Pick a scenario, press talk,
              and see how it handles you.
            </p>
          </Rise>
          <Rise delay={0.25} className="mt-8 space-y-5">
            <Chips
              label="Scenario"
              items={SCENARIOS.map((s) => s.name)}
              value={scenario}
              onPick={setScenario}
              disabled={onCall}
            />
            <Chips
              label="Voice"
              items={VOICES.map((v) => v.name)}
              value={voice}
              onPick={setVoice}
              disabled={onCall}
            />
          </Rise>
        </div>

        {/* The live agent's panel, on the meadow. */}
        <Rise delay={0.1} className="min-w-0">
          <div
            id="voice-demo"
            ref={panel}
            className="relative isolate overflow-hidden rounded-[28px] border border-black/[0.08] p-3 sm:p-7"
          >
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
              role="region"
              aria-label="Live voice demo"
              className="flex h-[500px] flex-col overflow-hidden rounded-[20px] border border-black/[0.07] bg-white/[0.94] shadow-[0_30px_70px_-30px_rgba(40,30,20,0.5)] backdrop-blur-xl sm:h-[520px]"
            >
              <VoiceDemo
                scenario={SCENARIOS[scenario]}
                voice={VOICES[voice]}
                onBusyChange={onBusyChange}
              />
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
  disabled,
}: {
  label: string;
  items: readonly string[];
  value: number;
  onPick: (i: number) => void;
  /** During a call, the choice is fixed. */
  disabled?: boolean;
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
            disabled={disabled}
            onClick={() => onPick(i)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
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
