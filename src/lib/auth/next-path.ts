// Where to send someone after they log in. `?next=` comes from the address
// bar, so it is only ever followed when it is a plain path on this site:
// never another site, never a scheme, never something a browser would read as
// one ("//evil.example", "/\evil.example").

export const DEFAULT_NEXT = "/app";

/** Paths a login may lead to. Anything else falls back to the app's home. */
const ALLOWED = ["/app", "/onboarding", "/reset-password"];

export function safeNextPath(
  next: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512)
    return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  // Backslashes and control characters are how "/\host" and friends slip by.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, "https://dialvo.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "https://dialvo.invalid") return fallback;
  const path = url.pathname;
  if (!ALLOWED.some((a) => path === a || path.startsWith(`${a}/`)))
    return fallback;
  return `${path}${url.search}`;
}
