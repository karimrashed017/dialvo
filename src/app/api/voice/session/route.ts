import "server-only";
import { connection, NextResponse, type NextRequest } from "next/server";
import {
  isScenarioId,
  isVoiceId,
  MAX_CALL_SECONDS,
  OPENING_LINE,
  VOICES,
  type VoiceSession,
  type VoiceSessionError,
} from "@/lib/voice/config";
import { conversationToken, isConfigured } from "@/lib/voice/elevenlabs";
import { buildPrompt, firstMessage } from "@/lib/voice/prompt";
import {
  check,
  COOKIE_MAX_AGE,
  COOKIE_NAME,
  readCookie,
  record,
  writeCookie,
} from "@/lib/voice/rate-limit";

// The live voice demo's one endpoint. GET says whether the demo is set up,
// so the page knows whether to offer it. POST starts a call: it checks the
// choice and the visitor's rate limit, then hands back a short-lived
// ElevenLabs token with the script, opening line and voice for that call. Nothing about
// the visitor is stored. Runs on the Node.js runtime, Next's default (the
// rate limiter uses node:crypto).

function fail(
  status: number,
  body: VoiceSessionError,
  headers?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/** The visitor's address as the host (Vercel) reports it. */
function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** A browser on another site may not start calls on our account. */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // not a cross-site browser request
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function GET() {
  await connection(); // read the setting when asked, not at build time
  return NextResponse.json(
    { configured: isConfigured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!isConfigured()) return fail(503, { reason: "not_configured" });
  if (!sameOrigin(request)) return fail(403, { reason: "forbidden" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, { reason: "bad_request" });
  }
  const { scenario, voice } = (body ?? {}) as Record<string, unknown>;
  if (!isScenarioId(scenario) || !isVoiceId(voice)) {
    return fail(400, { reason: "bad_request" });
  }

  const secret = process.env.ELEVENLABS_API_KEY!;
  const now = Date.now();
  const ip = clientIp(request);
  const cookieTimes = readCookie(
    request.cookies.get(COOKIE_NAME)?.value,
    secret,
    now,
  );
  const limit = check(ip, cookieTimes, now);
  if (limit.retryAfter > 0) {
    return fail(
      429,
      { reason: "rate_limited", retryAfter: limit.retryAfter },
      { "Retry-After": String(limit.retryAfter) },
    );
  }

  let token: string;
  try {
    token = await conversationToken();
  } catch (error) {
    // The details go to the server log, not to the visitor.
    console.error("[voice] could not start a session:", error);
    return fail(502, { reason: "unavailable" });
  }

  const session: VoiceSession = {
    conversationToken: token,
    overrides: {
      agent: { prompt: { prompt: buildPrompt(scenario) } },
      tts: { voiceId: VOICES.find((v) => v.id === voice)!.voiceId },
    },
    dynamicVariables: { [OPENING_LINE]: firstMessage(scenario) },
    maxSeconds: MAX_CALL_SECONDS,
  };
  const response = NextResponse.json(session, {
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set(
    COOKIE_NAME,
    writeCookie(record(ip, limit.times, now), secret),
    {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api/voice",
      maxAge: COOKIE_MAX_AGE,
    },
  );
  return response;
}
