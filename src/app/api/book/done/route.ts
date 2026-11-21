import "server-only";
import { cookies } from "next/headers";
import {
  BOOKING_COOKIE,
  BOOKING_TOKEN,
  bookedTimes,
} from "@/lib/agents/booking";
import { createLimiter } from "@/lib/leads/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { bookingPage } from "../html";

// Where a workspace's booking page sends the visitor after they book (the
// "redirect after booking" setting every common scheduling tool has):
// https://trydialvo.com/api/book/done
//
// The booking link they opened from the chat left its token in this
// browser. With it, the booking is recorded once on that conversation's lead
// (booking_done): status "meeting booked", a line on their timeline, a
// meeting when the booking page passed its time, and an alert to the team.
// Without it there is nothing to match, and nothing is recorded.

const limit = createLimiter({ windowMs: 60_000, max: 20 });

const THANKS = () =>
  bookingPage(
    "You're booked",
    "Thank you. The confirmation is on its way from the booking page. You can close this tab.",
  );

export async function GET(request: Request) {
  const who = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "?";
  if (limit.take(who) > 0) return THANKS();
  const store = await cookies();
  const token = store.get(BOOKING_COOKIE)?.value ?? "";
  if (!BOOKING_TOKEN.test(token)) return THANKS();
  const supabase = createServiceClient();
  if (!supabase) return THANKS();
  const { starts, ends } = bookedTimes(new URL(request.url).searchParams);
  const { error } = await supabase.rpc("booking_done", {
    p_link: token,
    p_starts: starts,
    p_ends: ends,
  });
  if (error) console.error("[book] done failed:", error.code);
  else store.delete({ name: BOOKING_COOKIE, path: "/api/book" });
  return THANKS();
}
