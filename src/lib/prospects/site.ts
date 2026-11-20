import "server-only";
import {
  fetchPageSource,
  PageFetchError,
  readableText,
  type PageSource,
} from "@/lib/knowledge/fetch-page";
import { PAGES_PER_COMPANY } from "./config";
import { isCompanySite, sameSite, siteDomain } from "./domains";
import { contactLinks, emailsOnPage, phonesOnPage } from "./extract";
import { mayRead, type RobotsFetcher } from "./robots";
import type { SitePage } from "./types";

// Reads a company's own website: its home page, then its contact and about
// pages, found from the home page's links and only on the same host. Every
// request goes through the knowledge base's page reader, so the same rules
// hold (public https pages only, never a private address, also after a
// redirect).

// Before any page, the host's robots.txt is consulted (robots.ts): a site
// that asks not to be read by DialvoBot, or by every robot, isn't.

export type SiteProblem = "no_website" | "unreadable" | "robots_disallowed";

export type SiteRead =
  | { ok: true; domain: string; pages: SitePage[] }
  | { ok: false; problem: SiteProblem };

export type FetchSource = (url: string) => Promise<PageSource>;

function toPage(source: PageSource, domain: string): SitePage | null {
  if (!source.html) return null;
  const { title, text } = readableText(
    // Keep the footer: it is where most sites print how to reach them.
    source.body.replace(/<(\/?)footer\b/gi, "<$1div"),
  );
  if (text.length < 40) return null;
  return {
    url: source.url,
    title,
    text,
    emails: emailsOnPage(source.body, domain),
    phones: phonesOnPage(source.body),
  };
}

/** robots.txt through the same safe reader. Not text: there is none. */
export function robotsFromSource(fetchSource: FetchSource): RobotsFetcher {
  return async (url) => {
    const source = await fetchSource(url);
    return source.html ? null : source.body;
  };
}

export async function readSite(
  website: string,
  fetchSource: FetchSource = fetchPageSource,
  fetchRobots: RobotsFetcher = robotsFromSource(fetchSource),
): Promise<SiteRead> {
  if (!(await mayRead(website, fetchRobots)))
    return { ok: false, problem: "robots_disallowed" };
  let home: PageSource;
  try {
    home = await fetchSource(website);
  } catch (error) {
    if (error instanceof PageFetchError)
      return { ok: false, problem: "unreadable" };
    throw error;
  }
  // The address may have redirected. Wherever it ended up is "the site",
  // unless that is a social network or a directory page.
  const domain = siteDomain(home.url);
  if (!domain || !isCompanySite(domain))
    return { ok: false, problem: "no_website" };
  // A redirect to another host: that host's rules apply too.
  if (!(await mayRead(home.url, fetchRobots)))
    return { ok: false, problem: "robots_disallowed" };
  const first = toPage(home, domain);
  if (!first) return { ok: false, problem: "unreadable" };

  const more = await Promise.all(
    contactLinks(home.body, home.url, PAGES_PER_COMPANY - 1).map(
      async (url) => {
        try {
          if (!(await mayRead(url, fetchRobots))) return null;
          const source = await fetchSource(url);
          // A contact link that redirects off the site isn't the site.
          if (
            !sameSite(new URL(source.url).hostname, new URL(home.url).hostname)
          )
            return null;
          return toPage(source, domain);
        } catch (error) {
          if (error instanceof PageFetchError) return null;
          throw error;
        }
      },
    ),
  );
  const pages = [first];
  for (const page of more)
    if (page && !pages.some((p) => p.url === page.url)) pages.push(page);
  return { ok: true, domain, pages };
}
