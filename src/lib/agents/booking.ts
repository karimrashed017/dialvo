// Offering the workspace's booking page in the website chat. The model is
// given the booking link and writes it out when it offers it; the reply that
// is stored carries Dialvo's own link for this conversation instead
// (/api/book/<token>), which records the visit and goes on to the booking
// page, so a booking made there can be recorded on the lead. Pure.

export const BOOKING_PATH = "/api/book";
export const BOOKING_COOKIE = "dv_booking";
/** How long the browser remembers which chat a booking came from. */
export const BOOKING_COOKIE_DAYS = 30;
export const BOOKING_TOKEN = /^[0-9a-f]{64}$/;

const trimSlash = (u: string) => u.replace(/\/+$/, "");

/** Whether the reply already shows the booking link (any trailing slash). */
export function mentionsLink(reply: string, bookingUrl: string): boolean {
  return reply.toLowerCase().includes(trimSlash(bookingUrl).toLowerCase());
}

/**
 * The reply with the booking link in it, written as `link` (Dialvo's own,
 * or the booking page itself when there is none). Every place the model
 * wrote the booking page becomes `link`; if it didn't write it, the link
 * goes on a line of its own at the end.
 */
export function placeBookingLink(
  reply: string,
  bookingUrl: string,
  link: string,
): string {
  const raw = trimSlash(bookingUrl);
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}/?`, "gi");
  if (pattern.test(reply)) return reply.replace(pattern, link);
  return `${reply.trimEnd()}\n\n${link}`;
}

/**
 * A time the booking page passed back after a booking, from the names the
 * common scheduling tools use. Null when none is there or it isn't a date.
 */
export function bookedTimes(params: URLSearchParams): {
  starts: string | null;
  ends: string | null;
} {
  const pick = (names: string[]) => {
    for (const n of names) {
      const v = params.get(n);
      if (!v) continue;
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return null;
  };
  return {
    starts: pick([
      "event_start_time",
      "startTime",
      "start_time",
      "start",
      "invitee_start_time",
    ]),
    ends: pick(["event_end_time", "endTime", "end_time", "end"]),
  };
}
