import "server-only";
import { CONTACT_PAGE_SIZE, CONTACT_TIMEOUT_MS } from "./config";
import {
  findList,
  readContactPage,
  readCredits,
  readExportStatus,
  readHash,
  readListId,
  readRetryAfter,
  type ContactPage,
  type Credits,
  type ExportStatus,
} from "./findymail-parse";

// The few Findymail endpoints the lead finder uses
// (https://app.findymail.com/docs/). The key is read from FINDYMAIL_API_KEY
// on the server and only ever sent in the Authorization header to
// app.findymail.com: it is never logged, stored or shown. Every answer is
// checked in findymail-parse.ts before it is used.
//
// No call here throws for an HTTP or network problem: each returns a plain
// reason, and the run decides what to do (see contact-run.ts).

const BASE = "https://app.findymail.com";

export type FindymailProblem =
  /** 401 or 403: the key was refused. */
  | "unauthenticated"
  /** 402: the account is out of credits. */
  | "no_credits"
  /** 423: the subscription is paused. */
  | "paused"
  /** 429: too many requests at once, or the plan's capacity for now. */
  | "rate_limited"
  /** 422: the request was refused as invalid. */
  | "invalid"
  /** 404: no such export (or no longer). */
  | "not_found"
  /** A 5xx, a timeout, or no answer. */
  | "unavailable"
  /** An answer we couldn't read. */
  | "unreadable";

export type Failure = {
  ok: false;
  problem: FindymailProblem;
  /** For rate_limited: seconds to wait. */
  retryAfter?: number;
};
type Result<T> = { ok: true; value: T } | Failure;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type ExportConfig = {
  query: string;
  limit: number;
  titles: string[][];
  exclusionListId: number | null;
};

export interface FindymailClient {
  credits(): Promise<Result<Credits>>;
  startSearch(config: ExportConfig): Promise<Result<string>>;
  status(hash: string): Promise<Result<ExportStatus>>;
  page(hash: string, page: number): Promise<Result<ContactPage>>;
  /** The workspace's own exclusion list: found by name, or made. */
  exclusionList(name: string): Promise<Result<number>>;
  addExclusions(listId: number, domains: string[]): Promise<Result<true>>;
}

/** The request body for POST /api/intellimatch/search. Pure, for tests. */
export function searchBody(config: ExportConfig) {
  return {
    query: config.query,
    limit: config.limit,
    config: {
      find_contact: true,
      find_email: true,
      find_phone: false,
      // Only companies where an email was found: the others aren't charged.
      require_email: true,
      mode: "targeted",
      ...(config.titles.length ? { target_job_titles: config.titles } : {}),
      ...(config.exclusionListId
        ? {
            // Leave out what this workspace already has, and add what this
            // export returns to the same list. Never the account's global
            // list ([0]), which every workspace would share.
            exclusion_filter_list_ids: [config.exclusionListId],
            add_to_exclusion_list: true,
            exclusion_list_id: config.exclusionListId,
          }
        : { exclusion_filter_list_ids: [-1] }),
    },
  };
}

export function createFindymailClient(
  key: string | undefined = process.env.FINDYMAIL_API_KEY,
  fetcher: Fetcher = fetch,
): FindymailClient | null {
  if (!key) return null;

  async function call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Result<unknown>> {
    let response: Response;
    try {
      response = await fetcher(`${BASE}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(CONTACT_TIMEOUT_MS),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      return { ok: false, problem: "unavailable" };
    }
    let json: unknown = null;
    try {
      // Capped: an answer this endpoint sends is never this big.
      const text = await response.text();
      json = text.length <= 5_000_000 ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const status = response.status;
    if (status >= 200 && status < 300) {
      if (json === null) return { ok: false, problem: "unreadable" };
      return { ok: true, value: json };
    }
    // Status codes only in the log: the body may echo the request.
    console.error("[findymail]", method, path.split("?")[0], status);
    if (status === 401 || status === 403)
      return { ok: false, problem: "unauthenticated" };
    if (status === 402) return { ok: false, problem: "no_credits" };
    if (status === 423) return { ok: false, problem: "paused" };
    if (status === 429)
      return {
        ok: false,
        problem: "rate_limited",
        retryAfter: readRetryAfter(json, response.headers.get("retry-after")),
      };
    if (status === 422) return { ok: false, problem: "invalid" };
    if (status === 404) return { ok: false, problem: "not_found" };
    return { ok: false, problem: "unavailable" };
  }

  const then = <T>(
    result: Result<unknown>,
    read: (value: unknown) => T | null,
  ): Result<T> => {
    if (!result.ok) return result;
    const value = read(result.value);
    return value === null
      ? { ok: false, problem: "unreadable" }
      : { ok: true, value };
  };

  return {
    async credits() {
      return then(await call("GET", "/api/credits"), readCredits);
    },
    async startSearch(config) {
      return then(
        await call("POST", "/api/intellimatch/search", searchBody(config)),
        readHash,
      );
    },
    async status(hash) {
      return then(
        await call(
          "GET",
          `/api/intellimatch/status?hash=${encodeURIComponent(hash)}`,
        ),
        readExportStatus,
      );
    },
    async page(hash, page) {
      return then(
        await call(
          "GET",
          `/api/intellimatch/data?hash=${encodeURIComponent(hash)}&page=${page}&per_page=${CONTACT_PAGE_SIZE}`,
        ),
        (body) => readContactPage(body, page),
      );
    },
    async exclusionList(name) {
      const made = await call("POST", "/api/intellimatch/exclusion-lists", {
        name,
        is_shared: false,
      });
      if (made.ok) {
        const id = readListId((made.value as { id?: unknown } | null)?.id);
        return id
          ? { ok: true, value: id }
          : { ok: false, problem: "unreadable" };
      }
      // 422 "name already taken": it exists from an earlier attempt.
      if (made.problem !== "invalid") return made;
      return then(
        await call("GET", "/api/intellimatch/exclusion-lists"),
        (body) => findList(body, name),
      );
    },
    async addExclusions(listId, domains) {
      if (domains.length === 0) return { ok: true, value: true };
      const result = await call("POST", "/api/intellimatch/domains", {
        domains,
        list_id: listId,
      });
      return result.ok ? { ok: true, value: true } : result;
    },
  };
}
