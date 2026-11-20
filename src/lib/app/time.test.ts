import { describe, expect, it } from "vitest";
import { ago, safeTimeZone, startOfDayInTz } from "./time";

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
