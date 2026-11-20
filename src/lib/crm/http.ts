import { MAX_INLINE_WAIT_MS, REQUEST_TIMEOUT_MS } from "./config";
import { CrmError, type Provider } from "./types";

// Every request to a CRM goes through here: one place that spaces requests
// out, waits out a short 429, turns the CRM's answer into a CrmError with a
// plain message, and makes sure the token never ends up in a message. The
// CRM's own error text is untrusted: it is cut short and stripped of
// anything that looks like markup before it is shown to anyone.

export type HttpDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export const realHttpDeps = (): HttpDeps => ({
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
});

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Search endpoints have their own, lower limit. */
  search?: boolean;
};

export type Http = <T = unknown>(
  path: string,
  o?: RequestOptions,
) => Promise<T>;

/** What the CRM said, safe to show and to store. */
export function cleanCrmMessage(raw: unknown, token: string): string {
  let text = typeof raw === "string" ? raw : "";
  if (token) text = text.split(token).join("[token]");
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Seconds to wait, from the headers a 429 came with; null if none. */
export function retryAfterSeconds(
  headers: Headers,
  now: number,
): number | null {
  const after = headers.get("retry-after");
  if (after) {
    const n = Number(after);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
    const at = Date.parse(after);
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - now) / 1000));
  }
  // Pipedrive: seconds until the 2-second window resets.
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (headers.get("x-ratelimit-reset") && Number.isFinite(reset) && reset >= 0)
    return Math.ceil(reset);
  // HubSpot: the window's length in milliseconds.
  const interval = Number(
    headers.get("x-hubspot-ratelimit-interval-milliseconds"),
  );
  if (Number.isFinite(interval) && interval > 0)
    return Math.ceil(interval / 1000);
  return null;
}

function crmMessageOf(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const o = json as Record<string, unknown>;
  // HubSpot: { message }. Pipedrive: { error, error_info }.
  return String(o.message ?? o.error ?? "");
}

/** HubSpot lists the scopes a call needed when it refuses one. */
export function missingScopesOf(json: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || !value || typeof value !== "object") return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (/scopes/i.test(key) && Array.isArray(v))
        for (const s of v)
          if (typeof s === "string" && /^[a-z0-9._-]{3,80}$/i.test(s))
            found.add(s);
      visit(v, depth + 1);
    }
  };
  visit(json, 0);
  return [...found].slice(0, 10);
}

export function createHttp(input: {
  provider: Provider;
  baseUrl: string;
  token: string;
  headers: Record<string, string>;
  gapMs: number;
  searchGapMs: number;
  deps: HttpDeps;
}): Http {
  const { deps, token } = input;
  const name = input.provider === "hubspot" ? "HubSpot" : "Pipedrive";
  let last = 0;
  let lastSearch = 0;

  async function space(search: boolean) {
    const gap = search ? input.searchGapMs : input.gapMs;
    const since = deps.now() - (search ? lastSearch : last);
    if (since < gap) await deps.sleep(gap - since);
    last = deps.now();
    if (search) lastSearch = last;
  }

  return async function request<T>(path: string, o: RequestOptions = {}) {
    for (let waited = 0; ; waited++) {
      await space(Boolean(o.search));
      let res: Response;
      try {
        res = await deps.fetch(input.baseUrl + path, {
          method: o.method ?? "GET",
          headers: {
            ...input.headers,
            Accept: "application/json",
            ...(o.body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
          },
          body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          redirect: "error",
          cache: "no-store",
        });
      } catch {
        throw new CrmError(
          "network",
          `${name} couldn't be reached. Dialvo will try again.`,
        );
      }
      const text = await res.text().catch(() => "");
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.ok) return json as T;

      const said = cleanCrmMessage(crmMessageOf(json), token);
      const s = res.status;
      if (s === 429) {
        const after = retryAfterSeconds(res.headers, deps.now());
        if (waited < 2 && (after ?? 2) * 1000 <= MAX_INLINE_WAIT_MS) {
          await deps.sleep(Math.max(after ?? 2, 1) * 1000);
          continue;
        }
        throw new CrmError(
          "rate",
          `${name} asked Dialvo to slow down (its API limit was reached). Dialvo will try again.`,
          s,
          after ?? 60,
        );
      }
      if (s === 401)
        throw new CrmError(
          "auth",
          `${name} no longer accepts the token Dialvo has. Connect ${name} again with a new one.`,
          s,
        );
      if (s === 403) {
        const scopes = missingScopesOf(json);
        throw new CrmError(
          "forbidden",
          scopes.length
            ? `${name} refused: the key is missing the permission ${scopes.join(", ")}. Add it to the key in ${name}, then press Retry.`
            : `${name} refused: the token isn't allowed to do this${said ? ` (${name} said: "${said}")` : ""}. Check the token's permissions, then press Retry.`,
          s,
        );
      }
      if (s === 404)
        throw new CrmError("not_found", `${name} couldn't find it.`, s);
      if (s === 409)
        throw new CrmError(
          "conflict",
          `${name} says it already exists${said ? `: "${said}"` : ""}.`,
          s,
        );
      if (s >= 500)
        throw new CrmError(
          "server",
          `${name} had a problem on its side (${s}). Dialvo will try again.`,
          s,
        );
      throw new CrmError(
        "bad_request",
        `${name} didn't accept what Dialvo sent${said ? `: "${said}"` : ` (${s})`}.`,
        s,
      );
    }
  };
}
