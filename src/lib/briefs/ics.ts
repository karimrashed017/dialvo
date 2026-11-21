// Reads a calendar's iCal (ICS) feed into plain events: the secret address
// Google Calendar, Outlook and Apple Calendar give for a calendar. Pure.
//
// What it understands: VEVENT with UID, SUMMARY, DTSTART / DTEND or DURATION
// (UTC, floating, or with a TZID, IANA or the common Windows names Outlook
// uses), STATUS:CANCELLED, ATTENDEE and ORGANIZER addresses, and repeating
// events by RRULE with FREQ=DAILY or WEEKLY (INTERVAL, COUNT, UNTIL, BYDAY),
// EXDATE and moved occurrences (RECURRENCE-ID). Monthly and yearly repeats
// keep their first occurrence only. All-day events are left out: a meeting
// with a lead has a time.

export type CalendarEvent = {
  /** Unique per occurrence: the event's UID, plus the start for a repeat. */
  uid: string;
  title: string;
  starts_at: string;
  ends_at: string;
  cancelled: boolean;
  attendees: { email: string; name: string }[];
};

type Prop = { name: string; params: Record<string, string>; value: string };

/** Lines unfolded (a line starting with a space or tab continues the last). */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else if (line) out.push(line);
  }
  return out;
}

export function parseProp(line: string): Prop | null {
  // The value starts at the first colon that isn't inside a quoted parameter.
  let quoted = false;
  let at = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) {
      at = i;
      break;
    }
  }
  if (at < 1) return null;
  const head = line.slice(0, at);
  const value = line.slice(at + 1);
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) ?? [];
  const name = (parts.shift() ?? "").toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq > 0)
      params[p.slice(0, eq).toUpperCase()] = p
        .slice(eq + 1)
        .replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

const unescapeText = (v: string) =>
  v
    .replace(/\\n/gi, " ")
    .replace(/\\([,;\\])/g, "$1")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Windows time zone names Outlook writes, to their IANA names. */
const WINDOWS_ZONES: Record<string, string> = {
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Etc/GMT",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "Canada Central Standard Time": "America/Regina",
  "E. South America Standard Time": "America/Sao_Paulo",
  "India Standard Time": "Asia/Kolkata",
  "Singapore Standard Time": "Asia/Singapore",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  "Arabian Standard Time": "Asia/Dubai",
  "Israel Standard Time": "Asia/Jerusalem",
  "South Africa Standard Time": "Africa/Johannesburg",
  UTC: "UTC",
};

function zoneName(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const name = WINDOWS_ZONES[tzid] ?? tzid.replace(/^\/[^/]*\/[^/]*\//, "");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/** The UTC time of a wall-clock time in a zone. */
export function zonedToUtc(
  parts: [number, number, number, number, number, number],
  zone: string,
): Date {
  const [y, mo, d, h, mi, s] = parts;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (t: number) => {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(t));
    const get = (type: string) => Number(f.find((p) => p.type === type)?.value);
    return (
      Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour"),
        get("minute"),
        get("second"),
      ) - t
    );
  };
  // Twice, so a time near a clock change settles on the right offset.
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

/** A DATE-TIME (or DATE) value, or null. `allDay` for a date alone. */
export function readTime(
  value: string,
  params: Record<string, string>,
): { at: Date; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const parts: [number, number, number, number, number, number] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
  ];
  if (!m[4] || params.VALUE === "DATE")
    return {
      at: new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])),
      allDay: true,
    };
  const utc = new Date(
    Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]),
  );
  if (m[7]) return { at: utc, allDay: false };
  const zone = zoneName(params.TZID);
  // A floating time (no zone) is read as UTC.
  const at = zone ? zonedToUtc(parts, zone) : utc;
  return Number.isNaN(at.getTime()) ? null : { at, allDay: false };
}

/** An ISO 8601 duration ("PT1H30M", "P1D") in milliseconds, or null. */
export function readDuration(value: string): number | null {
  const m =
    /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value.trim(),
    );
  if (!m) return null;
  const ms =
    ((Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * 86_400 +
      Number(m[4] ?? 0) * 3600 +
      Number(m[5] ?? 0) * 60 +
      Number(m[6] ?? 0)) *
    1000;
  return m[1] === "-" ? -ms : ms;
}

const EMAIL = /^[^\s@<>"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function address(prop: Prop): { email: string; name: string } | null {
  const email = prop.value
    .replace(/^mailto:/i, "")
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return null;
  return { email, name: unescapeText(prop.params.CN ?? "").slice(0, 120) };
}

type RawEvent = {
  uid: string;
  title: string;
  start: { at: Date; allDay: boolean } | null;
  end: Date | null;
  duration: number | null;
  cancelled: boolean;
  attendees: { email: string; name: string }[];
  rrule: Record<string, string> | null;
  exdates: number[];
  recurrenceId: number | null;
};

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** The starts of a repeating event inside [from, to], at most `max`. */
export function occurrences(
  start: Date,
  rule: Record<string, string>,
  from: number,
  to: number,
  max = 200,
): Date[] {
  const freq = rule.FREQ;
  if (freq !== "DAILY" && freq !== "WEEKLY") return [start];
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = Number(rule.COUNT) || Infinity;
  const untilRaw = rule.UNTIL ? readTime(rule.UNTIL, {}) : null;
  const until = untilRaw
    ? untilRaw.at.getTime() + (untilRaw.allDay ? 86_399_000 : 0)
    : Infinity;
  const byDay =
    freq === "WEEKLY" && rule.BYDAY
      ? rule.BYDAY.split(",")
          .map((d) => DAYS.indexOf(d.replace(/^[+-]?\d+/, "")))
          .filter((d) => d >= 0)
      : [start.getUTCDay()];
  const out: Date[] = [];
  let n = 0;
  const day = 86_400_000;
  // Walk day by day from the first occurrence: simple, and bounded by the
  // window (two weeks ahead) and the cap.
  const weekStart = start.getTime() - start.getUTCDay() * day;
  for (let t = start.getTime(); t <= Math.min(to, until); t += day) {
    const d = new Date(t);
    let hit: boolean;
    if (freq === "DAILY")
      hit = Math.round((t - start.getTime()) / day) % interval === 0;
    else {
      const week = Math.floor((t - weekStart) / (7 * day));
      hit = week % interval === 0 && byDay.includes(d.getUTCDay());
    }
    if (!hit) continue;
    n++;
    if (n > count) break;
    if (t >= from) out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The timed events of a feed that overlap [from, to], with repeats
 * expanded. Moved occurrences replace the ones they move; cancelled ones
 * stay, marked cancelled, so a meeting already imported can be updated.
 */
export function parseCalendar(
  text: string,
  from: Date,
  to: Date,
): CalendarEvent[] {
  const raws: RawEvent[] = [];
  let current: RawEvent | null = null;
  let depth = 0;
  for (const line of unfold(text)) {
    const prop = parseProp(line);
    if (!prop) continue;
    if (prop.name === "BEGIN" && prop.value.toUpperCase() === "VEVENT") {
      current = {
        uid: "",
        title: "",
        start: null,
        end: null,
        duration: null,
        cancelled: false,
        attendees: [],
        rrule: null,
        exdates: [],
        recurrenceId: null,
      };
      depth = 0;
      continue;
    }
    if (!current) continue;
    // Alarms inside an event have their own properties: ignore them.
    if (prop.name === "BEGIN") {
      depth++;
      continue;
    }
    if (prop.name === "END") {
      if (depth > 0) depth--;
      else if (prop.value.toUpperCase() === "VEVENT") {
        raws.push(current);
        current = null;
      }
      continue;
    }
    if (depth > 0) continue;
    switch (prop.name) {
      case "UID":
        current.uid = prop.value.trim().slice(0, 250);
        break;
      case "SUMMARY":
        current.title = unescapeText(prop.value).slice(0, 200);
        break;
      case "DTSTART":
        current.start = readTime(prop.value, prop.params);
        break;
      case "DTEND":
        current.end = readTime(prop.value, prop.params)?.at ?? null;
        break;
      case "DURATION":
        current.duration = readDuration(prop.value);
        break;
      case "STATUS":
        current.cancelled = prop.value.trim().toUpperCase() === "CANCELLED";
        break;
      case "ATTENDEE":
      case "ORGANIZER": {
        const a = address(prop);
        if (
          a &&
          current.attendees.length < 50 &&
          !current.attendees.some((x) => x.email === a.email)
        )
          current.attendees.push(a);
        break;
      }
      case "RRULE":
        current.rrule = Object.fromEntries(
          prop.value
            .split(";")
            .map((kv) => kv.split("=") as [string, string])
            .filter(([k, v]) => k && v)
            .map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
        );
        break;
      case "EXDATE":
        for (const v of prop.value.split(",")) {
          const t = readTime(v, prop.params);
          if (t) current.exdates.push(t.at.getTime());
        }
        break;
      case "RECURRENCE-ID":
        current.recurrenceId =
          readTime(prop.value, prop.params)?.at.getTime() ?? null;
        break;
    }
  }

  const lo = from.getTime();
  const hi = to.getTime();
  const moved = new Set(
    raws
      .filter((r) => r.recurrenceId !== null)
      .map((r) => `${r.uid}|${r.recurrenceId}`),
  );
  const out = new Map<string, CalendarEvent>();
  for (const r of raws) {
    if (!r.uid || !r.start || r.start.allDay) continue;
    const length =
      r.end && r.end > r.start.at
        ? r.end.getTime() - r.start.at.getTime()
        : r.duration && r.duration > 0
          ? r.duration
          : 3_600_000;
    const starts =
      r.rrule && r.recurrenceId === null
        ? occurrences(r.start.at, r.rrule, lo - length, hi)
        : [r.start.at];
    for (const s of starts) {
      const t = s.getTime();
      if (t + length < lo || t > hi) continue;
      if (r.recurrenceId === null && r.exdates.includes(t)) continue;
      if (r.rrule && r.recurrenceId === null && moved.has(`${r.uid}|${t}`))
        continue;
      const key =
        r.rrule || r.recurrenceId !== null
          ? `${r.uid}|${new Date(r.recurrenceId ?? t).toISOString()}`
          : r.uid;
      out.set(key, {
        uid: key.slice(0, 300),
        title: r.title,
        starts_at: new Date(t).toISOString(),
        ends_at: new Date(t + length).toISOString(),
        cancelled: r.cancelled,
        attendees: r.attendees,
      });
    }
  }
  return [...out.values()].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
}

/** Whether a body looks like a calendar at all. */
export const looksLikeCalendar = (text: string) =>
  /BEGIN:VCALENDAR/i.test(text.slice(0, 2000));
