"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import { WRAP_UP_AT_SECONDS, type VoiceSession } from "@/lib/voice/config";
import { cn } from "@/lib/utils";
import { clock, Orb, Transcript, type Line } from "./voice-parts";

// The live call itself: connects to the ElevenLabs agent with the token our
// server issued, and shows the orb, the timer, the transcript and the
// controls while it runs. This file pulls in ElevenLabs' SDK, so it is only
// downloaded when a visitor actually starts a call (see voice-demo.tsx).

export type CallOutcome =
  /** Hung up by the visitor, by the agent, or at the time limit. */
  | "ended"
  /** Never connected. */
  | "failed"
  /** Connected, then dropped. */
  | "lost";

type Props = {
  session: VoiceSession;
  /** The call is up: the microphone check's own stream can be let go. */
  onConnected: () => void;
  onEnd: (outcome: CallOutcome, lines: Line[]) => void;
};

export default function VoiceCall(props: Props) {
  // Leaving the provider (a tab change, leaving the page) ends the session.
  return (
    <ConversationProvider>
      <Call {...props} />
    </ConversationProvider>
  );
}

function Call({ session, onConnected, onEnd }: Props) {
  const [lines, setLines] = useState<Line[]>([]);
  const [seconds, setSeconds] = useState(0);
  const linesRef = useRef<Line[]>([]);
  const connected = useRef(false);
  const done = useRef(false);

  const finish = (outcome: CallOutcome) => {
    if (done.current) return;
    done.current = true;
    onEnd(outcome, linesRef.current);
  };

  const update = (next: Line[]) => {
    linesRef.current = next;
    setLines(next);
  };

  const conversation = useConversation({
    onConnect: () => {
      connected.current = true;
      onConnected();
    },
    onDisconnect: (details) => {
      if (details.reason === "error") {
        finish(connected.current ? "lost" : "failed");
      } else if (details.reason === "agent" && !linesRef.current.length) {
        // The far end hung up before a word was said: ElevenLabs refused
        // the call (its daily cap, say), which is not a call that ended.
        finish("failed");
      } else {
        finish("ended");
      }
    },
    onError: (message) => {
      console.warn("[voice demo]", message);
      // Once connected, a real drop arrives through onDisconnect.
      if (!connected.current) finish("failed");
    },
    onMessage: ({ message, role, event_id }) => {
      const text = message.trim();
      // Silence comes through as "..."; only keep lines with words in them.
      if (!/[\p{L}\p{N}]/u.test(text)) return;
      const who = role === "agent" ? "agent" : "you";
      const id = `${who}-${event_id}`;
      const prev = linesRef.current;
      update(
        prev.some((l) => l.id === id)
          ? prev.map((l) => (l.id === id ? { ...l, text } : l))
          : [...prev, { id, who, text }],
      );
    },
    // Interrupted mid-sentence: keep only what the agent actually said.
    onAgentResponseCorrection: ({ corrected_agent_response, event_id }) => {
      const id = `agent-${event_id}`;
      update(
        linesRef.current.map((l) =>
          l.id === id ? { ...l, text: corrected_agent_response } : l,
        ),
      );
    },
  });
  const { status, isSpeaking, isMuted, setMuted } = conversation;
  const live = status === "connected";
  const api = useRef(conversation);
  useEffect(() => {
    api.current = conversation;
  });

  // Start once. The timer skips the first of React's two development
  // mounts, so only one connection is ever made with the token.
  useEffect(() => {
    const id = setTimeout(() => {
      api.current.startSession({
        conversationToken: session.conversationToken,
        connectionType: "webrtc",
        overrides: session.overrides,
        dynamicVariables: session.dynamicVariables,
      });
    }, 0);
    return () => clearTimeout(id);
  }, [session]);

  useEffect(() => {
    if (!live) return;
    const started = Date.now();
    const id = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      500,
    );
    return () => clearInterval(id);
  }, [live]);

  // The agent can't see a clock, so tell it when to wrap up. ElevenLabs
  // ends the call at the limit; a few seconds later we hang up regardless.
  const nudged = useRef(false);
  useEffect(() => {
    if (!live) return;
    if (seconds >= WRAP_UP_AT_SECONDS && !nudged.current) {
      nudged.current = true;
      api.current.sendContextualUpdate(
        "About twenty seconds of the demo are left. Finish your current point, wrap up politely in one sentence, say goodbye and end the call.",
      );
    }
    if (seconds >= session.maxSeconds + 6) api.current.endSession();
  }, [live, seconds, session.maxSeconds]);

  const sample = () => {
    try {
      const c = api.current;
      return c.isSpeaking
        ? c.getOutputByteFrequencyData()
        : c.isMuted
          ? null
          : c.getInputByteFrequencyData();
    } catch {
      return null;
    }
  };

  const state = !live
    ? "Connecting…"
    : isSpeaking
      ? "Agent speaking"
      : isMuted
        ? "You're muted"
        : "Listening";

  return (
    <>
      <div className="flex shrink-0 items-center gap-4 px-5 pt-4 pb-1">
        <Orb
          size={64}
          rings={live && isSpeaking}
          still={!live}
          sample={live ? sample : undefined}
        />
        <div className="min-w-0 text-left">
          <p
            role="status"
            className="text-[12px] font-medium tracking-[0.14em] uppercase"
          >
            {state}
          </p>
          <p className="mt-1 text-[12.5px] text-[#0B0B0C]/50 tabular-nums">
            {live ? (
              <>
                <span aria-label="Call time">{clock(seconds)}</span> of{" "}
                {clock(session.maxSeconds)}
              </>
            ) : (
              "Setting up the call"
            )}
          </p>
        </div>
      </div>
      <Transcript
        lines={lines}
        empty={live ? "Say hello. The agent is listening." : undefined}
      />
      <div className="flex shrink-0 items-center gap-2 border-t border-black/[0.07] px-4 py-3">
        <button
          type="button"
          aria-pressed={isMuted}
          disabled={!live}
          onClick={() => setMuted(!isMuted)}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none disabled:opacity-40",
            isMuted
              ? "border-[#0B0B0C] bg-[#0B0B0C] text-white"
              : "border-black/15 hover:bg-black/[0.04]",
          )}
        >
          {isMuted ? (
            <MicOff aria-hidden className="size-4" />
          ) : (
            <Mic aria-hidden className="size-4" />
          )}
          {isMuted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={() => {
            api.current.endSession();
            finish("ended");
          }}
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-[#0B0B0C] px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-black/85 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <PhoneOff aria-hidden className="size-4" />
          End call
        </button>
      </div>
    </>
  );
}
