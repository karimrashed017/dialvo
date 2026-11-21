import "server-only";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  isPublicAddress,
  PageFetchError,
  parsePageUrl,
} from "@/lib/knowledge/fetch-page";
import { DELIVERY_TIMEOUT_MS, RESPONSE_MAX_BYTES } from "./config";

// One POST of JSON to an address a customer gave us (a webhook endpoint or a
// Slack incoming webhook). The address must be HTTPS on port 443 and resolve
// only to public addresses, and the connection goes to the address we
// checked, so a hook can't be pointed at something inside our own network.
// Redirects are not followed. The answer is read up to a few KB, for the
// status and a short error.

export type PostResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; error: string; permanent: boolean };

export type Resolved = { address: string; family: 4 | 6 };

export type PostDeps = {
  resolve(host: string): Promise<Resolved[]>;
  request(input: {
    url: URL;
    address: Resolved;
    body: string;
    headers: Record<string, string>;
    timeoutMs: number;
  }): Promise<{ status: number; body: string }>;
};

async function resolveHost(host: string): Promise<Resolved[]> {
  const bare = host.replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  if (family) return [{ address: bare, family: family as 4 | 6 }];
  const found = await dnsLookup(bare, { all: true, verbatim: true });
  return found.map((f) => ({ address: f.address, family: f.family as 4 | 6 }));
}

function requestOnce({
  url,
  address,
  body,
  headers,
  timeoutMs,
}: Parameters<PostDeps["request"]>[0]): Promise<{
  status: number;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: 443,
        path: url.pathname + url.search,
        method: "POST",
        agent: false,
        timeout: timeoutMs,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "Dialvo-Webhooks/1 (+https://trydialvo.com)",
          ...headers,
        },
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options.all)
            callback(null, [address] as never, undefined as never);
          else callback(null, address.address, address.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        res.on("data", (chunk: Buffer) => {
          if (size >= RESPONSE_MAX_BYTES) return;
          chunks.push(chunk.subarray(0, RESPONSE_MAX_BYTES - size));
          size += chunk.length;
          if (size >= RESPONSE_MAX_BYTES) {
            done();
            res.destroy();
          }
        });
        res.on("end", done);
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

export const realPostDeps: PostDeps = {
  resolve: resolveHost,
  request: requestOnce,
};

/** What a receiver said, short and plain, safe to store and show. */
export function shortError(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Whether a URL is one we would deliver to (before any DNS lookup). */
export function checkTargetUrl(
  raw: string,
): { ok: true; url: URL } | { ok: false; error: string } {
  try {
    const url = parsePageUrl(raw);
    if (!/^https:\/\//i.test(raw.trim()))
      return { ok: false, error: "The address must start with https://." };
    if (raw.length > 500)
      return { ok: false, error: "That address is too long." };
    return { ok: true, url };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof PageFetchError && error.problem === "private_address"
          ? "That address is on a private network."
          : "Give a full https:// address on the public internet.",
    };
  }
}

export async function postJson(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  deps: PostDeps = realPostDeps,
): Promise<PostResult> {
  const checked = checkTargetUrl(rawUrl);
  if (!checked.ok)
    return { ok: false, status: null, error: checked.error, permanent: true };
  const { url } = checked;
  let addresses: Resolved[];
  try {
    addresses = await deps.resolve(url.hostname);
  } catch {
    return {
      ok: false,
      status: null,
      error: "The address's host name couldn't be found.",
      permanent: false,
    };
  }
  if (
    addresses.length === 0 ||
    !addresses.every((a) => isPublicAddress(a.address))
  )
    return {
      ok: false,
      status: null,
      error: "The address points to a private network.",
      permanent: true,
    };
  try {
    const res = await deps.request({
      url,
      address: addresses[0],
      body,
      headers,
      timeoutMs: DELIVERY_TIMEOUT_MS,
    });
    if (res.status >= 200 && res.status < 300)
      return { ok: true, status: res.status };
    const said = shortError(res.body);
    return {
      ok: false,
      status: res.status,
      error: `${res.status}${said ? `: ${said}` : ""}`,
      // Try again later on rate limits, server errors and redirects (an
      // address that moves may move back); give up on other refusals.
      permanent:
        res.status >= 400 &&
        res.status < 500 &&
        res.status !== 408 &&
        res.status !== 429,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: shortError((error as Error).message) || "No answer.",
      permanent: false,
    };
  }
}
