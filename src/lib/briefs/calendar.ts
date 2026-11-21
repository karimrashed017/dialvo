import "server-only";
import {
  DEFAULT_DEPS,
  isPublicAddress,
  PageFetchError,
  parsePageUrl,
  type PageDeps,
} from "@/lib/knowledge/fetch-page";
import {
  CALENDAR_AHEAD_DAYS,
  CALENDAR_EVENTS_PER_READ,
  CALENDAR_FEEDS_PER_STEP,
  CALENDAR_PAST_DAYS,
} from "./config";
import { looksLikeCalendar, parseCalendar, type CalendarEvent } from "./ics";
import type { BriefStore } from "./store";

// Reading a person's secret calendar address. The address is a credential
// (anyone holding it can read the calendar), so it lives in Vault, is only
// ever sent to its own host, and is fetched under the same rules as every
// page Dialvo reads: https on 443, public addresses only, also after a
// redirect, a time limit and a size limit.

export class CalendarProblem extends Error {
  constructor(
    message: string,
    readonly gone: boolean,
  ) {
    super(message);
  }
}

const MAX_HOPS = 3;

/** A Google, Outlook or Apple address pasted as webcal:// works too. */
export function readFeedUrl(raw: unknown): URL | null {
  const text =
    typeof raw === "string"
      ? raw.trim().replace(/^webcals?:\/\//i, "https://")
      : "";
  if (!text || text.length > 1000) return null;
  try {
    return parsePageUrl(text);
  } catch {
    return null;
  }
}

export async function fetchCalendar(
  raw: string,
  deps: PageDeps = DEFAULT_DEPS,
): Promise<string> {
  let url = readFeedUrl(raw);
  if (!url)
    throw new CalendarProblem(
      "That isn't an https address on the public internet.",
      true,
    );
  const deadline = AbortSignal.timeout(15_000);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let status: number;
    let body: Buffer;
    let location: string | undefined;
    try {
      const addresses = await deps.resolve(url.hostname);
      if (
        addresses.length === 0 ||
        !addresses.every((a) => isPublicAddress(a.address))
      )
        throw new CalendarProblem(
          "That address isn't on the public internet.",
          true,
        );
      const res = await deps.request(url, addresses[0], deadline);
      status = res.status;
      body = res.body;
      location = res.headers.location;
    } catch (error) {
      if (error instanceof CalendarProblem) throw error;
      throw new CalendarProblem(
        deadline.aborted
          ? "The calendar took too long to answer."
          : "The calendar couldn't be reached.",
        false,
      );
    }
    if (status >= 300 && status < 400 && location) {
      try {
        url = parsePageUrl(new URL(location, url).toString());
      } catch (error) {
        throw new CalendarProblem(
          error instanceof PageFetchError
            ? "The calendar moved somewhere Dialvo won't follow."
            : "The calendar moved.",
          true,
        );
      }
      continue;
    }
    if ([401, 403, 404, 410].includes(status))
      throw new CalendarProblem(
        "The calendar says this address no longer works. Copy the secret address again and save it.",
        true,
      );
    if (status !== 200)
      throw new CalendarProblem(`The calendar answered ${status}.`, false);
    const text = body.toString("utf8");
    if (!looksLikeCalendar(text))
      throw new CalendarProblem(
        "That address doesn't return a calendar (ICS).",
        true,
      );
    return text;
  }
  throw new CalendarProblem("The calendar redirected too many times.", true);
}

/** The events to send to the database: in the window, others' addresses only. */
export function eventsToImport(
  text: string,
  ownEmails: string[],
  now = new Date(),
): CalendarEvent[] {
  const own = new Set(ownEmails.map((e) => e.toLowerCase()));
  const from = new Date(now.getTime() - CALENDAR_PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + CALENDAR_AHEAD_DAYS * 86_400_000);
  return parseCalendar(text, from, to)
    .map((e) => ({
      ...e,
      attendees: e.attendees.filter((a) => !own.has(a.email)),
    }))
    .filter((e) => e.attendees.length > 0)
    .slice(0, CALENDAR_EVENTS_PER_READ);
}

export type CalendarStepResult = {
  feeds: number;
  added: number;
  failed: number;
};

export async function calendarStep(deps: {
  store: BriefStore;
  fetchText?: (url: string) => Promise<string>;
  now?: () => Date;
}): Promise<CalendarStepResult> {
  const feeds = await deps.store.feedClaim(CALENDAR_FEEDS_PER_STEP);
  const result: CalendarStepResult = {
    feeds: feeds.length,
    added: 0,
    failed: 0,
  };
  const read = deps.fetchText ?? ((u: string) => fetchCalendar(u));
  for (const feed of feeds) {
    try {
      if (!feed.url)
        throw new CalendarProblem(
          "The address is missing. Save it again.",
          true,
        );
      const text = await read(feed.url);
      const r = await deps.store.feedIngest(
        feed.id,
        feed.workspace_id,
        eventsToImport(text, feed.own_emails ?? [], deps.now?.() ?? new Date()),
      );
      result.added += r.added ?? 0;
    } catch (error) {
      result.failed++;
      const problem = error instanceof CalendarProblem ? error : null;
      if (!problem)
        console.error("[calendar] read failed:", (error as Error).message);
      await deps.store
        .feedFail(
          feed.id,
          feed.workspace_id,
          problem?.message ?? "It couldn't be read.",
          problem?.gone ?? false,
        )
        .catch(() => undefined);
    }
  }
  return result;
}
