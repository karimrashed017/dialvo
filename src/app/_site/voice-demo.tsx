"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowRight, Mic, Phone, RotateCcw } from "lucide-react";
import {
  MAX_CALL_SECONDS,
  SCENARIOS,
  VOICES,
  type VoiceSession,
  type VoiceSessionError,
} from "@/lib/voice/config";
import { startHref } from "./links";
import { serif } from "./theme";
import type { CallOutcome } from "./voice-call";
import { Orb, PanelBar, Transcript, type Line } from "./voice-parts";

// The Voice tab's panel: a real conversation with Dialvo's AI sales agent,
// spoken through the visitor's microphone and answered in an ElevenLabs
// voice. Nothing starts by itself: the visitor presses the orb or the
// button, the browser asks for the microphone, and only then do we ask our
// server for a call (POST /api/voice/session). If the demo isn't set up
// (no ElevenLabs key on the server), the panel is the sample it used to be.

// ElevenLabs' SDK is large, so it's fetched when a call starts, not before.
const loadCall = () => import("./voice-call");
const VoiceCall = lazy(loadCall);

type Scenario = (typeof SCENARIOS)[number];
type Voice = (typeof VOICES)[number];

type Phase = "idle" | "starting" | "call" | "ended";

type Problem =
  | { kind: "denied" | "no-mic" | "unsupported" | "unavailable" }
  | { kind: "failed" | "lost" }
  | { kind: "limited"; minutes: number };

function explain(problem: Problem): string {
  switch (problem.kind) {
    case "denied":
      return "The microphone is blocked for this site. Allow it in your browser's address bar or settings, then try again.";
    case "no-mic":
      return "No microphone was found. Connect one, or try on your phone.";
    case "unsupported":
      return "This browser can't share a microphone here. Try a current version of Safari or Chrome.";
    case "limited":
      return `That's the limit for now. You can talk to the agent again in about ${problem.minutes} ${problem.minutes === 1 ? "minute" : "minutes"}.`;
    case "lost":
      return "The connection dropped. Check your network and try again.";
    case "failed":
      return "The call couldn't connect. Please try again in a moment.";
    case "unavailable":
      return "The demo couldn't start just now. Please try again in a moment.";
  }
}

/**
 * Browsers only let a page make sound after a tap. Playing one silent
 * sample inside the tap (before anything is awaited) unlocks audio for the
 * call that starts a moment later; older iPhones need it.
 */
function unlockAudio() {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
    void ctx.resume();
    setTimeout(() => void ctx.close().catch(() => {}), 1000);
  } catch {
    // No sound unlock; the call still tries.
  }
}

export function VoiceDemo({
  scenario,
  voice,
  onBusyChange,
}: {
  scenario: Scenario;
  voice: Voice;
  /** True from the first tap until the visitor is back at the start. */
  onBusyChange: (busy: boolean) => void;
}) {
  // null: not known yet. The page is static, so we ask once it's open.
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const mic = useRef<MediaStream | null>(null);
  const [micAllowed, setMicAllowed] = useState(false);
  const alive = useRef(true);

  const releaseMic = () => {
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
  };

  useEffect(() => {
    alive.current = true;
    const stop = new AbortController();
    fetch("/api/voice/session", { signal: stop.signal })
      .then((r) => r.json())
      .then((d: { configured?: boolean }) =>
        setConfigured(d.configured === true),
      )
      .catch(() => {
        // Couldn't ask: offer the demo and let the start explain.
        if (!stop.signal.aborted) setConfigured(true);
      });
    return () => {
      alive.current = false;
      stop.abort();
      releaseMic();
    };
  }, []);

  const busy = phase === "starting" || phase === "call";
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  const stopWith = (p: Problem) => {
    releaseMic();
    setProblem(p);
    setPhase("idle");
  };

  async function start() {
    if (busy) return;
    unlockAudio(); // must run inside the tap, before any await
    setProblem(null);
    setLines([]);
    setMicAllowed(false);
    setPhase("starting");
    void loadCall().catch(() => {}); // fetch the SDK while the prompt is up

    if (!navigator.mediaDevices?.getUserMedia) {
      return stopWith({ kind: "unsupported" });
    }
    try {
      // Ask for the microphone first: no call is requested (or counted)
      // if the visitor says no. The stream is held until the call is up,
      // which also keeps iOS willing to play the agent's voice.
      mic.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      return stopWith({
        kind:
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "no-mic"
              : "unsupported",
      });
    }
    if (!alive.current) return releaseMic();
    setMicAllowed(true);

    try {
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: scenario.id, voice: voice.id }),
      });
      if (!alive.current) return releaseMic();
      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => ({}))) as Partial<VoiceSessionError>;
        if (body.reason === "not_configured") {
          releaseMic();
          setConfigured(false);
          setPhase("idle");
          return;
        }
        if (res.status === 429) {
          return stopWith({
            kind: "limited",
            minutes: Math.max(1, Math.ceil((body.retryAfter ?? 60) / 60)),
          });
        }
        return stopWith({ kind: "unavailable" });
      }
      setSession((await res.json()) as VoiceSession);
      setPhase("call");
    } catch {
      if (alive.current) stopWith({ kind: "unavailable" });
    }
  }

  function onEnd(outcome: CallOutcome, said: Line[]) {
    releaseMic();
    setSession(null);
    setLines(said);
    if (outcome === "ended") {
      setPhase("ended");
    } else {
      setProblem({ kind: outcome });
      setPhase(said.length ? "ended" : "idle");
    }
  }

  if (configured === false) {
    return <ExampleVoice scenario={scenario} voice={voice} />;
  }

  const connecting = (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <Orb size={96} still />
      <p
        role="status"
        className="mt-1 text-[12px] font-medium tracking-[0.14em] uppercase"
      >
        {micAllowed ? "Connecting…" : "Waiting for your microphone"}
      </p>
      <p className="mt-1 max-w-[320px] text-[12.5px] text-[#0B0B0C]/50">
        {micAllowed
          ? "Setting up the call"
          : "Your browser will ask to use the microphone. Choose Allow to talk."}
      </p>
    </div>
  );

  return (
    <>
      <PanelBar
        icon={Phone}
        title="Voice agent"
        note={scenario.name}
        badge="Live demo"
        live
      />

      {phase === "idle" && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <button
            type="button"
            onClick={start}
            aria-label="Talk to the agent"
            className="group rounded-full transition-transform duration-300 hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none active:scale-[0.98]"
          >
            <Orb size={108} pace={voice.pace} />
          </button>
          <p className="text-[12.5px] text-[#0B0B0C]/50">
            {voice.name} voice · {scenario.does}
          </p>
          <p
            key={scenario.id}
            className={`${serif} mt-3 max-w-[400px] animate-in text-[19px] leading-[1.25] duration-500 fade-in`}
          >
            “{scenario.says}”
          </p>
          {problem && (
            <p
              role="alert"
              className="mt-3 max-w-[380px] rounded-xl bg-black/[0.05] px-3 py-2 text-[12.5px] leading-[1.4]"
            >
              {explain(problem)}
            </p>
          )}
          <button
            type="button"
            onClick={start}
            className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-[#1F3BFF] px-5 text-[14.5px] font-medium text-white transition-colors hover:bg-[#1830d6] focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Mic aria-hidden className="size-4" />
            {problem ? "Try again" : "Talk to the agent"}
          </button>
        </div>
      )}

      {phase === "starting" && connecting}

      {phase === "call" && session && (
        <Suspense fallback={connecting}>
          <VoiceCall session={session} onConnected={releaseMic} onEnd={onEnd} />
        </Suspense>
      )}

      {phase === "ended" && (
        <>
          <div className="shrink-0 px-5 pt-4 text-left">
            <p className="text-[12px] font-medium tracking-[0.14em] uppercase">
              Call ended
            </p>
            <p
              role={problem ? "alert" : undefined}
              className="mt-1 text-[12.5px] leading-[1.4] text-[#0B0B0C]/55"
            >
              {problem
                ? explain(problem)
                : "That was a live AI agent. Yours would use your script, your calendar and your CRM."}
            </p>
          </div>
          <Transcript lines={lines} empty="Nothing was said on this call." />
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-black/[0.07] px-4 py-3">
            <button
              type="button"
              onClick={start}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-black/15 px-4 text-[13.5px] font-medium transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
            >
              <RotateCcw aria-hidden className="size-4" />
              Talk again
            </button>
            <a
              href={startHref()}
              className="ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-[#0B0B0C] px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-black/85"
            >
              Join the waitlist
              <ArrowRight aria-hidden className="size-4" />
            </a>
          </div>
        </>
      )}

      {(phase === "idle" || phase === "starting") && (
        <p className="shrink-0 border-t border-black/[0.07] px-4 py-3 text-center text-[12px] leading-[1.4] text-[#0B0B0C]/55">
          Live demo · uses your microphone · up to {MAX_CALL_SECONDS / 60}{" "}
          minutes · not recorded. Voice by ElevenLabs.
        </p>
      )}
    </>
  );
}

/** The sample panel, shown while the live demo isn't set up. */
function ExampleVoice({
  scenario,
  voice,
}: {
  scenario: Scenario;
  voice: Voice;
}) {
  return (
    <>
      <PanelBar icon={Phone} title="Voice agent" note={scenario.name} />
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <Orb pace={voice.pace} />
        <p className="text-[12px] font-medium tracking-[0.14em] uppercase">
          Ready to talk
        </p>
        <p className="mt-1 text-[12.5px] text-[#0B0B0C]/50">
          {voice.name} voice · {scenario.does}
        </p>
        <p
          key={scenario.id}
          className={`${serif} mt-5 max-w-[400px] animate-in text-[21px] leading-[1.25] duration-500 fade-in`}
        >
          “{scenario.says}”
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-black/[0.07] px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#1F3BFF] text-white">
          <Mic aria-hidden className="size-4" />
        </span>
        <span className="text-[12.5px] leading-[1.35] text-[#0B0B0C]/55">
          Live demo is being set up. On a real call the agent says it&apos;s an
          AI, and the call is recorded and transcribed, with notice.
        </span>
      </div>
    </>
  );
}
