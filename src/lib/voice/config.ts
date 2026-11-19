// The live voice demo's choices and limits, in one place. Safe to import from
// the browser: nothing here is secret. The agent's instructions live in
// `prompt.ts` (server only) and the ElevenLabs calls in `elevenlabs.ts`.

/** What the visitor can ask the agent to demonstrate. */
export const SCENARIOS = [
  {
    id: "receptionist",
    name: "Receptionist",
    does: "Answers your main line day and night, and routes each caller.",
    says: "Thanks for calling Northwind Agency. How can I help?",
  },
  {
    id: "speed-to-lead",
    name: "Speed to lead",
    does: "Calls a new form lead back while they're still on your site.",
    says: "Hi, it's Northwind Agency. You just asked about a new website. Is now a good time?",
  },
  {
    id: "upsell",
    name: "Upsell",
    does: "Calls customers who opted in, when there's a reason to grow.",
    says: "Hi, it's Northwind Agency. Your care plan renews next month, and I had one idea to share.",
  },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]["id"];

/** The scenario picked when the page opens. */
export const DEFAULT_SCENARIO: ScenarioId = "speed-to-lead";

// Each voice style maps to a voice from ElevenLabs' premade library, which
// every account can use. The ids were checked against ElevenLabs' public
// voice list (GET https://api.elevenlabs.io/v1/voices) on 19 Nov 2026. To
// change a voice, swap its `voiceId` here. `pace` is how fast the idle
// waveform moves, so picking a style visibly does something before a call.
export const VOICES = [
  {
    id: "warm",
    name: "Warm",
    pace: 1.25,
    voiceId: "hpp4J3VqNfWAUOO0d1Us", // Bella: professional, bright, warm
  },
  {
    id: "confident",
    name: "Confident",
    pace: 1,
    voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah: mature, reassuring, confident
  },
  {
    id: "upbeat",
    name: "Upbeat",
    pace: 0.75,
    voiceId: "cgSgspJ2msm6clMCkdW9", // Jessica: playful, bright, warm
  },
  {
    id: "calm",
    name: "Calm",
    pace: 1.6,
    voiceId: "SAz9YHcvj6GT2YYXdXww", // River: relaxed, neutral, informative
  },
  {
    id: "professional",
    name: "Professional",
    pace: 1.1,
    voiceId: "XrExE9yKIg1WjnnlVkGX", // Matilda: knowledgeable, professional
  },
  {
    id: "down-to-earth",
    name: "Down to earth",
    pace: 1.35,
    voiceId: "iP95p4xoKVk53GoZ742B", // Chris: charming, down-to-earth
  },
  {
    id: "british",
    name: "British",
    pace: 1.15,
    voiceId: "JBFqnCBsd6RMkjVDRZzb", // George: warm, British
  },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];

export const DEFAULT_VOICE: VoiceId = "warm";

/** The longest a demo call can run. ElevenLabs enforces it; we count it down. */
export const MAX_CALL_SECONDS = 120;

/** When we quietly tell the agent to start wrapping up. */
export const WRAP_UP_AT_SECONDS = 95;

/** How many calls one visitor can start. */
export const RATE_LIMITS = [
  { windowMs: 10 * 60 * 1000, max: 3 },
  { windowMs: 24 * 60 * 60 * 1000, max: 10 },
] as const;

export function isScenarioId(value: unknown): value is ScenarioId {
  return SCENARIOS.some((s) => s.id === value);
}

export function isVoiceId(value: unknown): value is VoiceId {
  return VOICES.some((v) => v.id === value);
}

/** The name of the agent's variable that holds a call's opening line. */
export const OPENING_LINE = "opening_line";

/** What `POST /api/voice/session` answers when a call can start. */
export type VoiceSession = {
  /** A short-lived ElevenLabs WebRTC token for one conversation. */
  conversationToken: string;
  /** What this call changes on the agent: its script and its voice. */
  overrides: {
    agent: { prompt: { prompt: string } };
    tts: { voiceId: string };
  };
  /** The values this call fills in: the agent's opening line. */
  dynamicVariables: { [OPENING_LINE]: string };
  maxSeconds: number;
};

/** Why a call couldn't start. */
export type VoiceSessionError = {
  reason:
    | "not_configured"
    | "rate_limited"
    | "bad_request"
    | "forbidden"
    | "unavailable";
  /** For `rate_limited`: seconds until another call can start. */
  retryAfter?: number;
};
