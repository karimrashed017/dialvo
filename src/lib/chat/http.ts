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
/** Reads: an open widget asks every few seconds, and an office shares one
 * address, so this one is generous: 240 a minute. */
export const chatPollLimit = createLimiter({ windowMs: 60_000, max: 240 });
/** The install check: 30 a minute from one address, and per widget. */
export const chatSeenLimit = createLimiter({ windowMs: 60_000, max: 30 });

const ORIGIN = /^https?:\/\/[a-z0-9.-]{1,253}(:\d{1,5})?$/;

/**
 * The origin of the page a widget loaded on, from the browser's Origin
 * header: "https://example.com". Null when there isn't a usable one, or when
 * the page is one of Dialvo's own (the preview in Settings), which says
 * nothing about a customer's site.
 */
export function pageOrigin(request: Request): string | null {
  const origin = (request.headers.get("origin") ?? "").trim().toLowerCase();
  if (!ORIGIN.test(origin)) return null;
  let own: string;
  try {
    own = new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
  const forwarded = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    ""
  ).toLowerCase();
  const host = new URL(origin).host;
  if (host === own || host === forwarded) return null;
  return origin;
}
