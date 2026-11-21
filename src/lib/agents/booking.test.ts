import { describe, expect, it } from "vitest";
import { bookedTimes, mentionsLink, placeBookingLink } from "./booking";

const PAGE = "https://cal.example/acme/intro";
const LINK = "https://trydialvo.com/api/book/" + "a".repeat(64);

describe("the booking link in a chat reply", () => {
  it("puts Dialvo's own link where the model wrote the booking page", () => {
    expect(
      placeBookingLink(
        `Pick a time here: ${PAGE}/ and we'll talk.`,
        PAGE,
        LINK,
      ),
    ).toBe(`Pick a time here: ${LINK} and we'll talk.`);
    expect(mentionsLink(`See ${PAGE.toUpperCase()}`, PAGE)).toBe(true);
  });

  it("adds it on its own line when the model forgot it", () => {
    expect(placeBookingLink("You can book a call. ", PAGE, LINK)).toBe(
      `You can book a call.\n\n${LINK}`,
    );
  });

  it("reads the time the booking page passes back, from the usual names", () => {
    expect(
      bookedTimes(
        new URLSearchParams(
          "event_start_time=2026-12-01T10:00:00Z&event_end_time=2026-12-01T10:30:00Z",
        ),
      ),
    ).toEqual({
      starts: "2026-12-01T10:00:00.000Z",
      ends: "2026-12-01T10:30:00.000Z",
    });
    expect(
      bookedTimes(new URLSearchParams("startTime=2026-12-01T09:00:00%2B01:00")),
    ).toEqual({ starts: "2026-12-01T08:00:00.000Z", ends: null });
    expect(bookedTimes(new URLSearchParams("start=soon"))).toEqual({
      starts: null,
      ends: null,
    });
  });
});
