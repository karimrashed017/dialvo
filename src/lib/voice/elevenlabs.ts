import "server-only";
import {
  DEFAULT_SCENARIO,
  DEFAULT_VOICE,
  MAX_CALL_SECONDS,
  OPENING_LINE,
  VOICES,
} from "./config";
import { buildPrompt, firstMessage, TIME_UP_MESSAGE } from "./prompt";

// The server's side of the live voice demo: it finds (or once creates) the
// ElevenLabs agent the demo talks to, and asks ElevenLabs for a short-lived
// token so one browser can hold one conversation with it. The API key never
// leaves this file.

const API = "https://api.elevenlabs.io/v1/convai";

export const AGENT_NAME = "Dialvo website demo";

// Bump this when AGENT_SETTINGS changes: an agent tagged with an older
// version is updated in place the next time the server starts.
const SETTINGS_TAG = "dialvo-demo-settings-v3";

/**
 * The language models to try, fastest suitable first. All are on ElevenLabs'
 * supported list; if the account can't use one, creation falls to the next.
 */
export const LLM_CANDIDATES = [
  "claude-haiku-4-5",
  "gemini-3.5-flash-lite",
  "gpt-5.4-nano",
] as const;

/**
 * The speech models to try. ElevenLabs only lets an English agent use Flash
 * v2 or Turbo v2 (it answers "English Agents must use turbo or flash v2"
 * to anything else); Flash v2 is the faster of the two, at about 135 ms.
 * `null` leaves the choice to ElevenLabs' default.
 */
export const TTS_CANDIDATES = ["eleven_flash_v2", "eleven_turbo_v2", null];

/** How many demo calls ElevenLabs will run for this agent in a day. */
export const DAILY_CALL_LIMIT = 100;

/** How many demo calls can run at the same moment. */
export const CONCURRENT_CALL_LIMIT = 3;

export function isConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

class ElevenLabsError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`ElevenLabs answered ${status}: ${body.slice(0, 400)}`);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "xi-api-key": key,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new ElevenLabsError(res.status, await res.text());
  return (await res.json()) as T;
}

/** The agent as we ask ElevenLabs to store it. */
export function agentSettings(llm: string, ttsModel: string | null) {
  const voice = VOICES.find((v) => v.id === DEFAULT_VOICE) ?? VOICES[0];
  return {
    name: AGENT_NAME,
    tags: ["dialvo", "website-demo", SETTINGS_TAG],
    conversation_config: {
      agent: {
        // The opening line is a variable each call fills in. (Replacing
        // first_message outright is refused on WebRTC calls, even when
        // allowed below: "Override for field 'first_message' is not allowed
        // by config". Variables work on both kinds of connection.)
        first_message: `{{${OPENING_LINE}}}`,
        dynamic_variables: {
          dynamic_variable_placeholders: {
            [OPENING_LINE]: firstMessage(DEFAULT_SCENARIO),
          },
        },
        language: "en",
        max_conversation_duration_message: TIME_UP_MESSAGE,
        prompt: {
          // The default; each call replaces it with the picked scenario's.
          prompt: buildPrompt(DEFAULT_SCENARIO),
          llm,
          temperature: 0.4,
          // Short turns: also a ceiling on what one reply can cost.
          max_tokens: 200,
          // Lets the agent hang up after its goodbye.
          built_in_tools: {
            end_call: {
              name: "end_call",
              description: "",
              params: { system_tool_type: "end_call" },
            },
          },
        },
      },
      tts: {
        voice_id: voice.voiceId,
        ...(ttsModel ? { model_id: ttsModel } : {}),
      },
      turn: {
        // Hard to interrupt (founder, 19 Nov 2026: any sound nearby stopped
        // it mid-sentence): wait for real speech, and treat "mm-hm" and
        // "okay" as listening noises, not as someone taking the turn.
        turn_eagerness: "patient",
        interruption_ignore_terms: [
          "mm-hm",
          "mhm",
          "uh-huh",
          "hmm",
          "ok",
          "okay",
          "yeah",
          "yes",
          "yep",
          "right",
          "sure",
          "got it",
          "I see",
          "cool",
          "nice",
        ],
        merge_with_default_ignore_terms: true,
        turn_timeout: 7,
        // Nobody there: hang up rather than hold the line open.
        silence_end_call_timeout: 25,
      },
      // Other people talking in the room are not the caller.
      vad: { background_voice_detection: true },
      conversation: {
        max_duration_seconds: MAX_CALL_SECONDS,
      },
    },
    platform_settings: {
      // Only a token from our server can start a call.
      auth: { enable_auth: true },
      // What a single call may change: its script and its voice.
      overrides: {
        conversation_config_override: {
          agent: { prompt: { prompt: true } },
          tts: { voice_id: true },
        },
      },
      call_limits: {
        agent_concurrency_limit: CONCURRENT_CALL_LIMIT,
        daily_limit: DAILY_CALL_LIMIT,
        // Never pay double to go over the plan's limit.
        bursting_enabled: false,
      },
      // At the limit, turn callers away instead of holding them in a queue.
      queueing_config: { enabled: false },
      // ElevenLabs' "maximum privacy" setup: no audio is saved, and
      // transcripts are deleted straight away rather than kept for two years.
      privacy: { record_voice: false, retention_days: 0 },
    },
  };
}

type AgentSummary = {
  agent_id: string;
  name: string;
  tags?: string[];
  archived?: boolean;
};

async function findAgent(): Promise<AgentSummary | undefined> {
  const { agents } = await call<{ agents: AgentSummary[] }>(
    `/agents?page_size=100&search=${encodeURIComponent(AGENT_NAME)}`,
  );
  return agents.find((a) => a.name === AGENT_NAME && !a.archived);
}

/**
 * Sends the settings with each model pair until ElevenLabs accepts one. A
 * 4xx other than "who are you" means it didn't like the settings (a model
 * the plan can't use, say), so the next pair is worth trying.
 */
async function save(path: string, method: "POST" | "PATCH"): Promise<string> {
  let last: unknown;
  for (const tts of TTS_CANDIDATES) {
    for (const llm of LLM_CANDIDATES) {
      try {
        const { agent_id } = await call<{ agent_id: string }>(path, {
          method,
          body: JSON.stringify(agentSettings(llm, tts)),
        });
        return agent_id;
      } catch (error) {
        last = error;
        const retry =
          error instanceof ElevenLabsError &&
          (error.status === 400 || error.status === 422);
        if (!retry) throw error;
        console.warn(
          `[voice] ${llm} + ${tts ?? "default voice model"}:`,
          error,
        );
      }
    }
  }
  throw last;
}

let agentId: Promise<string> | undefined;

/**
 * The demo agent's id. `ELEVENLABS_AGENT_ID` wins if set. Otherwise the
 * agent named "Dialvo website demo" is looked up, created if it isn't there
 * and brought up to date if its settings are old; the answer is remembered
 * for as long as this server instance lives.
 */
export function ensureAgent(): Promise<string> {
  const fixed = process.env.ELEVENLABS_AGENT_ID;
  if (fixed) return Promise.resolve(fixed);
  agentId ??= (async () => {
    const found = await findAgent();
    if (!found) return save("/agents/create", "POST");
    if (!found.tags?.includes(SETTINGS_TAG)) {
      await save(`/agents/${found.agent_id}`, "PATCH");
    }
    return found.agent_id;
  })().catch((error) => {
    agentId = undefined; // try again on the next request
    throw error;
  });
  return agentId;
}

/** A token that lets one browser hold one conversation with the agent. */
export async function conversationToken(): Promise<string> {
  const id = await ensureAgent();
  const { token } = await call<{ token: string }>(
    `/conversation/token?agent_id=${encodeURIComponent(id)}`,
  );
  return token;
}
