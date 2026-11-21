import { SITE_URL } from "@/lib/site";

// The phone agent's, calls' and texts' fixed settings. Changing the model,
// a cap or the countries numbers can be bought in is a cost decision: ask
// the founder first. Twilio's prices below were read from twilio.com on
// 21 Nov 2026 (US, pay as you go) and are shown in the app before anything
// is bought.

/** The model that speaks for the business on a call. */
export const PHONE_MODEL = "claude-haiku-4-5";
/** One turn's answer, the JSON around it included. */
export const MAX_OUTPUT_TOKENS = 500;
/**
 * Twilio waits 15 seconds for a webhook's answer, then drops the call. The
 * model gets 8 of them; if it is slower the caller hears an apology and the
 * team is told.
 */
export const MODEL_TIMEOUT_MS = 8_000;
/** What the agent says in one turn, at most. A phone turn is short. */
export const MAX_SPOKEN_CHARS = 600;
/** Turns before the agent wraps up, whatever the call's length. */
export const MAX_TURNS = 40;
/** Silences in a row before the agent says goodbye. */
export const MAX_SILENCES = 2;
/** Incoming calls the agent answers per workspace per day (model spend). */
export const INBOUND_DAILY_CAP = 200;
/** How much of the workspace's knowledge goes into one prompt. */
export const MAX_KNOWLEDGE_CHARS = 40_000;

/** Numbers one workspace may hold. */
export const MAX_NUMBERS_PER_WORKSPACE = 3;
/** The most a number may cost a month, in US dollars, to be bought here. */
export const MAX_MONTHLY_PRICE_USD = 5;
/**
 * Countries numbers can be bought in from the app. Elsewhere Twilio needs
 * regulatory documents (an address and an identity bundle) first.
 */
export const BUYABLE_COUNTRIES = ["US", "CA"] as const;
export type BuyableCountry = (typeof BUYABLE_COUNTRIES)[number];

/** Outbound calls one scheduler step places, across all workspaces. */
export const CALL_CLAIM_LIMIT = 10;
/** Texts one scheduler step sends. */
export const SMS_CLAIM_LIMIT = 20;
/** Leads in one call batch, and open batches per workspace. */
export const BATCH_MAX_LEADS = 200;
export const MAX_OPEN_BATCHES = 5;
/**
 * A number "rests" (isn't used for outbound calls) while, over three days,
 * at least REST_MIN_CALLS of its calls ended and fewer than REST_MIN_RATE
 * of them were answered for 10 seconds or more: the usual sign carriers are
 * labelling it as spam.
 */
export const REST_MIN_CALLS = 20;
export const REST_MIN_RATE = 0.15;

/** The voices a workspace can choose (Amazon Polly neural voices on Twilio). */
export const VOICES = [
  {
    id: "Polly.Joanna-Neural",
    label: "Joanna (US English)",
    language: "en-US",
  },
  {
    id: "Polly.Matthew-Neural",
    label: "Matthew (US English)",
    language: "en-US",
  },
  { id: "Polly.Amy-Neural", label: "Amy (British English)", language: "en-GB" },
  {
    id: "Polly.Brian-Neural",
    label: "Brian (British English)",
    language: "en-GB",
  },
  {
    id: "Polly.Olivia-Neural",
    label: "Olivia (Australian English)",
    language: "en-AU",
  },
] as const;
export const VOICE_IDS: readonly string[] = VOICES.map((v) => v.id);

/** What Twilio charges, as shown in the app (USD, United States). */
export const TWILIO_PRICES = {
  localNumberMonth: "$1.15 a month per local number",
  outboundMinute: "$0.014 a minute for outbound calls",
  inboundMinute: "$0.0085 a minute for incoming calls",
  speech: "$0.02 per speech recognition (one per caller turn)",
  voice: "$0.0032 per 100 characters spoken (neural voice)",
  recording: "$0.0025 a minute to record, if recording is on",
  sms: "$0.0083 per text segment, plus carrier fees of about $0.003 to $0.005",
  a2p: "A2P 10DLC: about $4.50 brand registration plus $41.50 vetting for a standard brand, $15 campaign vetting, then $1.50 to $10 a month per campaign",
} as const;

/** The variables Twilio needs. Names only; values live on the server. */
export const TWILIO_VARIABLES = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
] as const;

export type PhoneRuntime = {
  /** Twilio and the database's secret key: numbers, calls and texts. */
  on: boolean;
  /** The model as well: the agent can talk. */
  agent: boolean;
  missing: string[];
};

/**
 * What this server can do. Without Twilio's two values nothing can be
 * bought, dialled or texted, and the Calls page says which value turns each
 * part on. Without the Anthropic key, calls go to the transfer number.
 */
export function phoneRuntime(
  env: Record<string, string | undefined> = process.env,
): PhoneRuntime {
  const missing = [...TWILIO_VARIABLES, "SUPABASE_SECRET_KEY"].filter(
    (name) => !env[name],
  );
  const agentMissing = env.ANTHROPIC_API_KEY ? [] : ["ANTHROPIC_API_KEY"];
  return {
    on: missing.length === 0,
    agent: missing.length === 0 && agentMissing.length === 0,
    missing: [...missing, ...agentMissing],
  };
}

/**
 * Where Twilio calls the app back. Twilio signs the exact address it
 * called, so this has to be the public one; TWILIO_WEBHOOK_BASE_URL
 * overrides it for a preview deployment.
 */
export function webhookBase(
  env: Record<string, string | undefined> = process.env,
): string {
  const base = env.TWILIO_WEBHOOK_BASE_URL?.trim() || SITE_URL;
  return base.replace(/\/+$/, "");
}

export const WEBHOOK_PATHS = {
  voice: "/api/phone/voice",
  turn: "/api/phone/voice/turn",
  transfer: "/api/phone/voice/transfer",
  status: "/api/phone/voice/status",
  sms: "/api/phone/sms",
  smsStatus: "/api/phone/sms/status",
} as const;
