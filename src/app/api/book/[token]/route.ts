import "server-only";
import { cookies } from "next/headers";
import {
  BOOKING_COOKIE,
  BOOKING_COOKIE_DAYS,
  BOOKING_TOKEN,
} from "@/lib/agents/booking";
import { createLimiter } from "@/lib/leads/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { bookingPage } from "../html";

// The booking link the website chat offers: https://trydialvo.com/api/book/<token>
// No login: the token (64 random hex characters, made in the database for
// one conversation) is the proof. Opening it records that it was opened,
// remembers the token in this browser (a first-party cookie, so the booking
// can be matched when the booking page sends the visitor back to
// /api/book/done), and goes on to the workspace's booking page.

const limit = createLimiter({ windowMs: 60_000, max: 30 });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!BOOKING_TOKEN.test(token))
    return bookingPage("This link doesn't work", "It may be incomplete.", 404);
  const who = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "?";
  if (limit.take(who) > 0)
    return bookingPage(
      "Please try again in a minute",
      "Too many requests just now.",
      429,
    );
  const supabase = createServiceClient();
  if (!supabase)
    return bookingPage(
      "Booking isn't available just now",
      "Please go back to the chat and ask the team for a time.",
      503,
    );
  const { data, error } = await supabase.rpc("booking_open", { p_link: token });
  if (error) {
    console.error("[book] open failed:", error.code);
    return bookingPage(
      "That didn't work",
      "Please try again in a moment, or ask the team in the chat.",
      503,
    );
  }
  const url = data as string | null;
  if (!url || !/^https:\/\/[^\s]+$/.test(url))
    return bookingPage(
      "This link doesn't work",
      "The booking page has changed. Please ask the team in the chat.",
      404,
    );
  (await cookies()).set(BOOKING_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/book",
    maxAge: BOOKING_COOKIE_DAYS * 86_400,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
