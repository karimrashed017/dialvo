import { describe, expect, it } from "vitest";
import { ago, agoWords, safeTimeZone, seenLine, startOfDayInTz } from "./time";

describe("startOfDayInTz", () => {
  it("is midnight UTC for UTC", () => {
    expect(
      startOfDayInTz(new Date("2026-11-20T15:30:00Z"), "UTC").toISOString(),
    ).toBe("2026-11-20T00:00:00.000Z");
  });

  it("follows the workspace's zone, either side of UTC", () => {
    // 01:00 UTC on the 20th is still the 19th in New York (UTC-5).
    expect(
      startOfDayInTz(
        new Date("2026-11-20T01:00:00Z"),
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-11-19T05:00:00.000Z");
    // 23:00 UTC on the 20th is already the 21st in Tokyo (UTC+9).
    expect(
      startOfDayInTz(
        new Date("2026-11-20T23:00:00Z"),
        "Asia/Tokyo",
      ).toISOString(),
    ).toBe("2026-11-20T15:00:00.000Z");
    expect(
      startOfDayInTz(
        new Date("2026-11-20T12:00:00Z"),
        "Asia/Kolkata",
      ).toISOString(),
    ).toBe("2026-11-19T18:30:00.000Z");
  });

  it("gets the day the clocks change right", () => {
    // London, 29 Mar 2026: midnight is still GMT, the afternoon is BST.
    expect(
      startOfDayInTz(
        new Date("2026-03-29T15:00:00Z"),
        "Europe/London",
      ).toISOString(),
    ).toBe("2026-03-29T00:00:00.000Z");
    // And 25 Oct 2026: midnight is BST, the afternoon is GMT.
    expect(
      startOfDayInTz(
        new Date("2026-10-25T15:00:00Z"),
        "Europe/London",
      ).toISOString(),
    ).toBe("2026-10-24T23:00:00.000Z");
  });

  it("treats a made-up zone as UTC", () => {
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(safeTimeZone("")).toBe("UTC");
    expect(
      startOfDayInTz(
        new Date("2026-11-20T15:30:00Z"),
        "Nope/Nope",
      ).toISOString(),
    ).toBe("2026-11-20T00:00:00.000Z");
  });
});

describe("ago", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  it("is short", () => {
    expect(ago("2026-11-20T11:59:40Z", now)).toBe("now");
    expect(ago("2026-11-20T11:48:00Z", now)).toBe("12m");
    expect(ago("2026-11-20T07:00:00Z", now)).toBe("5h");
    expect(ago("2026-11-18T12:00:00Z", now)).toBe("2d");
    expect(ago("2026-10-01T12:00:00Z", now)).toBe("Oct 1");
    expect(ago(null, now)).toBe("");
  });
});

describe("the install check in words", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const at = (secondsAgo: number) =>
    new Date(now.getTime() - secondsAgo * 1000).toISOString();

  it("says how long ago in whole units", () => {
    expect(agoWords(at(5), now)).toBe("just now");
    expect(agoWords(at(60), now)).toBe("1 minute ago");
    expect(agoWords(at(125), now)).toBe("2 minutes ago");
    expect(agoWords(at(3 * 3600 + 5), now)).toBe("3 hours ago");
    expect(agoWords(at(86400), now)).toBe("1 day ago");
    expect(agoWords(null, now)).toBe("");
  });

  it("names the site without the protocol", () => {
    expect(
      seenLine(
        { last_seen_at: at(120), last_seen_origin: "https://example.com" },
        now,
      ),
    ).toBe("Seen on example.com, 2 minutes ago");
    expect(
      seenLine(
        { last_seen_at: at(10), last_seen_origin: "http://127.0.0.1:8080" },
        now,
      ),
    ).toBe("Seen on 127.0.0.1:8080, just now");
  });

  it("says so when the widget has never loaded anywhere", () => {
    expect(seenLine({ last_seen_at: null, last_seen_origin: null }, now)).toBe(
      "Not seen yet",
    );
  });
});
