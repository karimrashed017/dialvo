import "server-only";
import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { parseSignup } from "@/lib/waitlist/validate";

// The waitlist form posts here. Each sign-up is one private JSON file in the
// Vercel Blob store "dialvo-waitlist", named by a hash of the email so signing
// up twice replaces the first rather than adding a second. Nothing is public:
// the store is private and only this server holds its token.

// A light brake on one address filling the list: 5 sign-ups an hour, kept in
// this server instance's memory.
const HOUR = 60 * 60 * 1000;
const recent = new Map<string, number[]>();

function limited(ip: string, now: number) {
  const times = (recent.get(ip) ?? []).filter((t) => now - t < HOUR);
  if (times.length >= 5) return true;
  times.push(now);
  recent.set(ip, times);
  return false;
}

export async function POST(request: Request) {
  // Only our own pages may post.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host !== host)
    return Response.json({ ok: false, reason: "forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  // A hidden field people never see; bots fill it in. Pretend it worked.
  if (body && typeof body === "object" && (body as { url2?: string }).url2)
    return Response.json({ ok: true });

  const parsed = parseSignup(body);
  if (!parsed.ok)
    return Response.json(
      { ok: false, reason: "invalid", field: parsed.field },
      { status: 400 },
    );

  if (!process.env.BLOB_READ_WRITE_TOKEN)
    return Response.json(
      { ok: false, reason: "not_configured" },
      { status: 503 },
    );

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(ip, Date.now()))
    return Response.json({ ok: false, reason: "limited" }, { status: 429 });

  const id = createHash("sha256")
    .update(parsed.signup.email)
    .digest("hex")
    .slice(0, 32);
  try {
    await put(
      `waitlist/${id}.json`,
      JSON.stringify(
        { ...parsed.signup, joinedAt: new Date().toISOString() },
        null,
        2,
      ),
      {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
      },
    );
  } catch (error) {
    console.error("[waitlist] could not save a sign-up:", error);
    return Response.json({ ok: false, reason: "unavailable" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
