// Dates for the app: "today" in the workspace's time zone, and short labels.

/** A valid IANA zone, or UTC. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const n = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    n("year"),
    n("month") - 1,
    n("day"),
    n("hour"),
    n("minute"),
    n("second"),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant today began in that zone. */
export function startOfDayInTz(now: Date, timeZone: string): Date {
  const tz = safeTimeZone(timeZone);
  const local = new Date(now.getTime() + offsetMinutes(now, tz) * 60000);
  const midnightAsUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  // The offset at midnight can differ from the offset now (clock changes).
  let start = new Date(
    midnightAsUtc - offsetMinutes(new Date(midnightAsUtc), tz) * 60000,
  );
  start = new Date(midnightAsUtc - offsetMinutes(start, tz) * 60000);
  return start;
}

/** "now", "5m", "3h", "2d", then a date. */
export function ago(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** "Thu, Nov 20, 2:00 PM" in the workspace's zone. */
export function dateTime(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: safeTimeZone(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dateOnly(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: safeTimeZone(timeZone),
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
