import { createLimiter } from "@/lib/leads/rate-limit";

// Shared by the public chat endpoints. They are called from the customer's
// own website, so any origin may use them (and only them: no other route
// sends these headers). There is no session and no cookie: a request carries
// the widget's public token, and for an existing chat the visitor's key.

export const CHAT_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

export const CHAT_TOKEN = /^[0-9a-f]{64}$/;

/** The longest message a visitor may send. The database checks it again. */
export const MAX_CHAT_MESSAGE = 2000;
/** The largest request body the chat endpoints read. */
export const MAX_CHAT_BYTES = 12_000;

export function chatJson(
  body: Record<string, unknown>,
  status = 200,
  extra: HeadersInit = {},
) {
  return Response.json(body, { status, headers: { ...CHAT_CORS, ...extra } });
}

export const chatOptions = () =>
  new Response(null, { status: 204, headers: CHAT_CORS });

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * The body as JSON. The widget posts it as text/plain, which browsers send
 * across origins without a preflight request.
 */
export async function readChatBody(
  request: Request,
): Promise<Record<string, unknown> | "too_large" | "unreadable"> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CHAT_BYTES)
    return "too_large";
  try {
    const text = await request.text();
    if (text.length > MAX_CHAT_BYTES) return "too_large";
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      return "unreadable";
    return data as Record<string, unknown>;
  } catch {
    return "unreadable";
  }
}

// Per address, in this server instance's memory. The limits that hold across
// instances are in the database (chat_start, chat_post).
/** New chats: 6 a minute from one address. */
export const chatStartLimit = createLimiter({ windowMs: 60_000, max: 6 });
/** Messages: 20 a minute from one address. */
export const chatPostLimit = createLimiter({ windowMs: 60_000, max: 20 });
/** Reads: the widget asks every few seconds; 90 a minute is plenty. */
export const chatPollLimit = createLimiter({ windowMs: 60_000, max: 90 });
