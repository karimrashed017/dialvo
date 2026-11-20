import "server-only";
import {
  fetchPageWithLinks,
  PageFetchError,
  type FetchedPage,
  type PageLink,
} from "./fetch-page";

// Reads a business's website for its Knowledge: the home page, plus up to
// four more pages of the same site that look useful to a sales agent
// (pricing, what they offer, FAQ, about, contact), found from the home
// page's own links. Every request goes through the safe fetcher
// (fetch-page.ts), so the private-address rules apply to each page.

/** Pages read besides the home page. */
export const MAX_EXTRA_PAGES = 4;
/** The whole read may take this long; pages still loading then are left out. */
export const SITE_BUDGET_MS = 25_000;

const KINDS: { kind: string; label: string; words: RegExp }[] = [
  {
    kind: "pricing",
    label: "Pricing",
    words: /\b(pricing|prices?|plans?|rates|fees|tarifs?|preise|precios)\b/i,
  },
  {
    kind: "offer",
    label: "What we offer",
    words:
      /\b(services?|products?|platform|features|solutions|what[- ]we[- ]do|offerings?|how[- ]it[- ]works|treatments|menu)\b/i,
  },
  {
    kind: "faq",
    label: "FAQ",
    words: /\b(faqs?|frequently[- ]asked|questions|help|support)\b/i,
  },
  {
    kind: "about",
    label: "About",
    words: /\b(about([- ]us)?|our[- ]story|who[- ]we[- ]are|company|team)\b/i,
  },
  {
    kind: "contact",
    label: "Contact",
    words: /\b(contact([- ]us)?|get[- ]in[- ]touch|locations?|find[- ]us)\b/i,
  },
];

/** Pages that are never worth an agent's attention, or aren't pages. */
const SKIP =
  /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mov|mp3|docx?|xlsx?|pptx?|ics|xml|json|css|js)$|\/(login|log-in|signin|sign-in|signup|sign-up|register|cart|checkout|account|admin|wp-admin|privacy|terms|legal|cookies?|careers?|jobs)(\/|$)/i;

/** The site a host belongs to, as far as we can tell: its name without www. */
export const siteHost = (hostname: string) =>
  hostname.toLowerCase().replace(/^www\./, "");

const pathKey = (url: URL) =>
  (url.pathname.replace(/\/+$/, "") || "/").toLowerCase() + url.search;

/**
 * Which of the home page's links to read: same site only, one per kind of
 * page, the most important kinds first.
 */
export function pickPages(
  home: string,
  links: PageLink[],
  max: number = MAX_EXTRA_PAGES,
): (PageLink & { kind: string })[] {
  const homeUrl = new URL(home);
  const site = siteHost(homeUrl.hostname);
  const candidates = links.flatMap((link) => {
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      return [];
    }
    if (url.protocol !== "https:" || (url.port && url.port !== "443"))
      return [];
    if (siteHost(url.hostname) !== site) return [];
    if (pathKey(url) === pathKey(homeUrl) || pathKey(url) === "/") return [];
    if (SKIP.test(url.pathname)) return [];
    // A sentence in the address reads as words: /what-we-do, /about_us.
    const path = decodeURIComponent(url.pathname).replace(/[/_.]+/g, " ");
    return [{ link, url, path, depth: url.pathname.split("/").length }];
  });

  const picked: (PageLink & { kind: string })[] = [];
  const taken = new Set<string>();
  for (const { kind, words } of KINDS) {
    if (picked.length >= max) break;
    const best = candidates
      .filter((c) => !taken.has(pathKey(c.url)))
      .map((c) => ({
        c,
        // The address says more than the words on the link; a short address
        // (/pricing) beats a deep one (/blog/2024/pricing-update).
        score:
          (words.test(c.path) ? 10 : 0) +
          (words.test(c.link.text) ? 4 : 0) -
          c.depth,
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (!best) continue;
    taken.add(pathKey(best.c.url));
    picked.push({ ...best.c.link, kind });
  }
  return picked;
}

export type SitePage = FetchedPage & { kind: string };

export type SiteRead =
  { ok: true; pages: SitePage[] } | { ok: false; problem: string };

export type SiteDeps = {
  fetch: typeof fetchPageWithLinks;
  budgetMs: number;
};

const DEFAULTS: SiteDeps = {
  fetch: fetchPageWithLinks,
  budgetMs: SITE_BUDGET_MS,
};

const kindLabel = (kind: string) =>
  KINDS.find((k) => k.kind === kind)?.label ?? "Home page";

/** A title for the knowledge item: the page's own, or what kind of page it is. */
export function siteTitle(page: SitePage): string {
  const host = siteHost(new URL(page.url).hostname);
  return (page.title || `${kindLabel(page.kind)} (${host})`).slice(0, 200);
}

/**
 * Reads the site. Never throws: a site that can't be read is an answer
 * ({ ok: false }), and a page that fails or is slow is simply left out.
 */
export async function readSite(
  address: string,
  deps: Partial<SiteDeps> = {},
): Promise<SiteRead> {
  const { fetch, budgetMs } = { ...DEFAULTS, ...deps };
  const started = Date.now();
  let home: Awaited<ReturnType<typeof fetchPageWithLinks>>;
  try {
    home = await fetch(address);
  } catch (error) {
    return {
      ok: false,
      problem: error instanceof PageFetchError ? error.problem : "unreachable",
    };
  }
  const pages: SitePage[] = [{ ...home.page, kind: "home" }];
  const site = siteHost(new URL(home.page.url).hostname);
  const wanted = pickPages(home.page.url, home.links);

  const left = Math.max(0, budgetMs - (Date.now() - started));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), left);
  });
  const results = await Promise.all(
    wanted.map((link) =>
      Promise.race([
        fetch(link.url).then(
          (read) => ({ ...read.page, kind: link.kind }),
          () => null,
        ),
        timeUp,
      ]),
    ),
  );
  clearTimeout(timer);

  const seen = new Set([home.page.url]);
  for (const page of results) {
    if (!page || seen.has(page.url)) continue;
    // A link that redirected off the site (a booking tool, a shop) is not
    // this business's own page.
    if (siteHost(new URL(page.url).hostname) !== site) continue;
    seen.add(page.url);
    pages.push(page);
  }
  return { ok: true, pages };
}
