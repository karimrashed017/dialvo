import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";

// Reads one public web page for the Knowledge base and returns its readable
// text. The address comes from a signed-in teammate, but this server makes
// the request, so it must never be talked into fetching something only it
// can reach (cloud metadata, localhost, a private network):
//
//   * https only, on the standard port, no user:password in the address;
//   * the host name is resolved first, every address it resolves to must be
//     public, and the connection is then made to that checked address (not
//     resolved a second time, so the answer can't change in between);
//   * redirects are followed by hand, at most three, each checked the same
//     way;
//   * 10 seconds in all, 1.5 MB at most, text and HTML only.

export const MAX_PAGE_BYTES = 1_500_000;
export const MAX_PAGE_TEXT = 20_000;
export const PAGE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export type PageProblem =
  | "bad_address"
  | "private_address"
  | "unreachable"
  | "too_slow"
  | "too_many_redirects"
  | "not_found"
  | "not_text"
  | "no_text";

const WORDS: Record<PageProblem, string> = {
  bad_address:
    "That doesn't look like a public web address. Use one that starts with https://",
  private_address:
    "That address points at a private network, so Dialvo won't read it.",
  unreachable: "Dialvo couldn't reach that page. Check the address.",
  too_slow: "That page took too long to answer. Try again in a moment.",
  too_many_redirects: "That address redirects too many times.",
  not_found: "That page answered with an error instead of content.",
  not_text: "That address isn't a web page Dialvo can read (HTML or text).",
  no_text:
    "There was no readable text on that page. It may be drawn by JavaScript: paste the text in instead.",
};

export class PageFetchError extends Error {
  constructor(readonly problem: PageProblem) {
    super(WORDS[problem]);
  }
}

// Everything that isn't the public internet.
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 127], // unspecified and loopback
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23], // Teredo and other special-purpose blocks
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const)
  PRIVATE.addSubnet(net, bits, "ipv6");

/** True only for an address on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 4) return !PRIVATE.check(address, "ipv4");
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is refused whatever it
  // maps to: no public site needs one, and it is a classic way round a
  // check like this. The URL parser gives us one spelling to test.
  let compact: string;
  try {
    compact = new URL(`http://[${address}]`).hostname;
  } catch {
    return false;
  }
  if (compact.startsWith("[::ffff:")) return false;
  return !PRIVATE.check(address, "ipv6");
}

/** The address as a URL we are willing to fetch, or a PageFetchError. */
export function parsePageUrl(raw: string): URL {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`,
    );
  } catch {
    throw new PageFetchError("bad_address");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new PageFetchError("bad_address");
  if (url.port && url.port !== "443") throw new PageFetchError("bad_address");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    // A bare IP address is refused outright unless it is public.
    if (!isPublicAddress(host)) throw new PageFetchError("private_address");
  } else if (
    !host.includes(".") ||
    /\.(local|localhost|internal|lan|home|corp|test|invalid|example)$/i.test(
      host,
    ) ||
    host.toLowerCase() === "localhost"
  )
    throw new PageFetchError("bad_address");
  url.hash = "";
  return url;
}

export type Resolved = { address: string; family: 4 | 6 };
export type RawResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  /** The body, cut at MAX_PAGE_BYTES. */
  body: Buffer;
};

export type PageDeps = {
  resolve(host: string): Promise<Resolved[]>;
  /** One GET to `url`, connecting to `address` and nowhere else. */
  request(
    url: URL,
    address: Resolved,
    signal: AbortSignal,
  ): Promise<RawResponse>;
};

async function resolveHost(host: string): Promise<Resolved[]> {
  const bare = host.replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  if (family) return [{ address: bare, family: family as 4 | 6 }];
  const found = await dnsLookup(bare, { all: true, verbatim: true });
  return found.map((f) => ({ address: f.address, family: f.family as 4 | 6 }));
}

function requestOnce(
  url: URL,
  address: Resolved,
  signal: AbortSignal,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: 443,
        path: url.pathname + url.search,
        method: "GET",
        signal,
        // No shared sockets: a kept-alive connection would skip the lookup.
        agent: false,
        headers: {
          "user-agent": "DialvoKnowledgeFetcher/1.0 (+https://trydialvo.com)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "accept-language": "en",
        },
        // Connect to the address we checked, whatever DNS says now. The
        // certificate is still verified against the host name.
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options.all)
            callback(null, [address] as never, undefined as never);
          else callback(null, address.address, address.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: {
              "content-type": res.headers["content-type"],
              location: res.headers.location,
            },
            body: Buffer.concat(chunks),
          });
        res.on("data", (chunk: Buffer) => {
          const room = MAX_PAGE_BYTES - size;
          if (room <= 0) return;
          chunks.push(chunk.subarray(0, room));
          size += Math.min(chunk.length, room);
          if (size >= MAX_PAGE_BYTES) {
            // Enough: stop reading and work with what arrived.
            finish();
            res.destroy();
          }
        });
        res.on("end", finish);
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const DEFAULT_DEPS: PageDeps = { resolve: resolveHost, request: requestOnce };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1].toLowerCase() === "x"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
          ? String.fromCodePoint(n)
          : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    },
  );
}

const DROPPED =
  "script|style|noscript|template|svg|iframe|object|canvas|select|nav|footer|form|button|aside";

/** The page's title and its text, with markup, scripts and menus removed. */
export function readableText(html: string): { title: string; text: string } {
  const title = decodeEntities(
    (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(
      /<[^>]+>/g,
      "",
    ),
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<head[\s>][\s\S]*?<\/head>/gi, " ")
      .replace(new RegExp(`<(${DROPPED})\\b[\\s\\S]*?<\\/\\1\\s*>`, "gi"), " ")
      // An unclosed script or style swallows the rest: drop it.
      .replace(/<(script|style)\b[\s\S]*$/gi, " ")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(
        /<\/?(p|div|section|article|main|header|h[1-6]|li|ul|ol|tr|table|blockquote|pre|dt|dd|figcaption)\b[^>]*>/gi,
        "\n",
      )
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

function decodeBody(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export type FetchedPage = {
  /** Where the text was finally read from, after redirects. */
  url: string;
  title: string;
  text: string;
  /** True when the page had more text than we keep. */
  truncated: boolean;
};

export type PageSource = {
  /** Where the page was finally read from, after redirects. */
  url: string;
  /** True for HTML, false for plain text. */
  html: boolean;
  /** The page as it was sent, decoded, cut at MAX_PAGE_BYTES. */
  body: string;
};

/**
 * One public page as it was sent, under all the rules at the top of this
 * file. For callers that need more than the readable text (the lead finder
 * reads a company's contact links from the markup); everyone else wants
 * fetchPage.
 */
export async function fetchPageSource(
  raw: string,
  deps: PageDeps = DEFAULT_DEPS,
): Promise<PageSource> {
  let url = parsePageUrl(raw);
  const deadline = AbortSignal.timeout(PAGE_TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: RawResponse;
    try {
      const addresses = await Promise.race([
        deps.resolve(url.hostname),
        new Promise<never>((_, reject) =>
          deadline.addEventListener("abort", () => reject(deadline.reason), {
            once: true,
          }),
        ),
      ]);
      if (addresses.length === 0) throw new PageFetchError("unreachable");
      // One private address among public ones is enough to refuse.
      if (!addresses.every((a) => isPublicAddress(a.address)))
        throw new PageFetchError("private_address");
      response = await deps.request(url, addresses[0], deadline);
    } catch (error) {
      if (error instanceof PageFetchError) throw error;
      if (deadline.aborted) throw new PageFetchError("too_slow");
      throw new PageFetchError("unreachable");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new PageFetchError("not_found");
      let next: string;
      try {
        next = new URL(location, url).toString();
      } catch {
        throw new PageFetchError("bad_address");
      }
      // The same rules apply to wherever it points: https, public, no ports.
      url = parsePageUrl(next);
      continue;
    }
    if (response.status !== 200) throw new PageFetchError("not_found");
    const type = (response.headers["content-type"] ?? "").toLowerCase();
    const html = /^(text\/html|application\/xhtml\+xml)\b/.test(type);
    if (!html && !/^text\/plain\b/.test(type))
      throw new PageFetchError("not_text");
    return {
      url: url.toString(),
      html,
      body: decodeBody(response.body, type),
    };
  }
  throw new PageFetchError("too_many_redirects");
}

export async function fetchPage(
  raw: string,
  deps: PageDeps = DEFAULT_DEPS,
): Promise<FetchedPage> {
  const source = await fetchPageSource(raw, deps);
  const page = source.html
    ? readableText(source.body)
    : { title: "", text: source.body.replace(/\r\n?/g, "\n").trim() };
  if (page.text.length < 40) throw new PageFetchError("no_text");
  return {
    url: source.url,
    title: page.title,
    text: page.text.slice(0, MAX_PAGE_TEXT),
    truncated: page.text.length > MAX_PAGE_TEXT,
  };
}
