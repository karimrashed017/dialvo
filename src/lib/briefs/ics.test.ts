import { describe, expect, it } from "vitest";
import {
  occurrences,
  parseCalendar,
  readDuration,
  readTime,
  unfold,
  zonedToUtc,
} from "./ics";

const FROM = new Date("2026-11-20T00:00:00Z");
const TO = new Date("2026-12-05T00:00:00Z");

const cal = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");

describe("reading an iCal feed", () => {
  it("unfolds lines and reads times in UTC, in a zone and in Outlook's zone names", () => {
    expect(unfold("SUMMARY:Long\r\n  title\r\nUID:1")).toEqual([
      "SUMMARY:Long title",
      "UID:1",
    ]);
    expect(readTime("20261122T150000Z", {})?.at.toISOString()).toBe(
      "2026-11-22T15:00:00.000Z",
    );
    expect(
      readTime("20261122T150000", { TZID: "Europe/London" })?.at.toISOString(),
    ).toBe("2026-11-22T15:00:00.000Z");
    // New York is five hours behind UTC in November, four in July.
    expect(
      readTime("20261122T100000", {
        TZID: "America/New_York",
      })?.at.toISOString(),
    ).toBe("2026-11-22T15:00:00.000Z");
    expect(
      zonedToUtc([2026, 7, 1, 10, 0, 0], "America/New_York").toISOString(),
    ).toBe("2026-07-01T14:00:00.000Z");
    expect(
      readTime("20261122T100000", {
        TZID: "Eastern Standard Time",
      })?.at.toISOString(),
    ).toBe("2026-11-22T15:00:00.000Z");
    expect(readTime("20261122", { VALUE: "DATE" })?.allDay).toBe(true);
    expect(readDuration("PT1H30M")).toBe(5_400_000);
  });

  it("keeps timed events with their attendees, and leaves out all-day ones", () => {
    const text = cal(
      "BEGIN:VEVENT",
      "UID:a1@google.com",
      "SUMMARY:Demo\\, with Acme",
      "DTSTART:20261122T150000Z",
      "DTEND:20261122T153000Z",
      'ORGANIZER;CN="Rep, Ann":mailto:ann@us.example',
      "ATTENDEE;CN=Pat Lead;PARTSTAT=ACCEPTED:mailto:PAT@acme.example",
      "BEGIN:VALARM",
      "TRIGGER:-PT10M",
      "SUMMARY:Alarm, not the title",
      "END:VALARM",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:a2",
      "SUMMARY:Holiday",
      "DTSTART;VALUE=DATE:20261123",
      "END:VEVENT",
    );
    const events = parseCalendar(text, FROM, TO);
    expect(events).toEqual([
      {
        uid: "a1@google.com",
        title: "Demo, with Acme",
        starts_at: "2026-11-22T15:00:00.000Z",
        ends_at: "2026-11-22T15:30:00.000Z",
        cancelled: false,
        attendees: [
          { email: "ann@us.example", name: "Rep, Ann" },
          { email: "pat@acme.example", name: "Pat Lead" },
        ],
      },
    ]);
  });

  it("expands weekly repeats in the window, skipping EXDATEs and using moved occurrences", () => {
    const text = cal(
      "BEGIN:VEVENT",
      "UID:weekly",
      "SUMMARY:Weekly sync",
      "DTSTART:20261102T090000Z",
      "DURATION:PT30M",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261123T090000Z",
      "ATTENDEE:mailto:client@acme.example",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:weekly",
      "RECURRENCE-ID:20261130T090000Z",
      "SUMMARY:Weekly sync (moved)",
      "DTSTART:20261201T100000Z",
      "DTEND:20261201T103000Z",
      "ATTENDEE:mailto:client@acme.example",
      "END:VEVENT",
    );
    const events = parseCalendar(text, FROM, TO);
    expect(events.map((e) => [e.starts_at, e.title])).toEqual([
      ["2026-12-01T10:00:00.000Z", "Weekly sync (moved)"],
    ]);
    expect(events[0].uid).toBe("weekly|2026-11-30T09:00:00.000Z");
    expect(
      occurrences(
        new Date("2026-11-02T09:00:00Z"),
        { FREQ: "DAILY", COUNT: "3" },
        0,
        Infinity,
      ),
    ).toHaveLength(3);
  });

  it("marks cancelled events", () => {
    const text = cal(
      "BEGIN:VEVENT",
      "UID:c1",
      "STATUS:CANCELLED",
      "DTSTART:20261125T090000Z",
      "DTEND:20261125T100000Z",
      "ATTENDEE:mailto:x@acme.example",
      "END:VEVENT",
    );
    expect(parseCalendar(text, FROM, TO)[0].cancelled).toBe(true);
  });
});
