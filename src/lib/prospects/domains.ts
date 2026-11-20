// Which web addresses count as "a company's own site", and which mailboxes
// are free ones. Pure functions.

/**
 * Social networks, directories, marketplaces and other places a company has
 * a page but doesn't own. The finder never treats one of these as a
 * company's website and never reads them: contact details come from the
 * company's own site or not at all.
 */
const NOT_A_COMPANY_SITE = [
  "linkedin.com",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "pinterest.com",
  "threads.net",
  "reddit.com",
  "snapchat.com",
  "whatsapp.com",
  "wa.me",
  "t.me",
  "telegram.org",
  "medium.com",
  "wikipedia.org",
  "google.com",
  "goo.gl",
  "bing.com",
  "apple.com",
  "amazon.com",
  "ebay.com",
  "etsy.com",
  "yelp.com",
  "yell.com",
  "tripadvisor.com",
  "trustpilot.com",
  "glassdoor.com",
  "indeed.com",
  "crunchbase.com",
  "bloomberg.com",
  "zoominfo.com",
  "yellowpages.com",
  "bbb.org",
  "clutch.co",
  "g2.com",
  "capterra.com",
  "github.com",
  "linktr.ee",
  "wixsite.com",
  "wordpress.com",
  "blogspot.com",
  "substack.com",
] as const;

/** Passed to the web search tool, so these never come back as results. */
export const SOCIAL_NETWORKS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "pinterest.com",
  "threads.net",
  "reddit.com",
  "snapchat.com",
] as const;

const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.de",
  "ymail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "outlook.com",
  "live.com",
  "live.co.uk",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "btinternet.com",
  "sky.com",
  "orange.fr",
  "free.fr",
  "t-online.de",
  "libero.it",
  "qq.com",
  "163.com",
]);

const sameOrSub = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

/**
 * "https://www.Example.com/about" -> "example.com". Null for anything that
 * isn't a public-looking host name (no dot, an IP address, odd characters).
 */
export function siteDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let raw = value.trim().toLowerCase();
  if (!raw || /\s/.test(raw)) return null;
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = raw
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (host.length < 4 || host.length > 253) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  // An IP address is not a company's domain.
  if (/^\d+(\.\d+){3}$/.test(host)) return null;
  if (!/[a-z]{2,}$/.test(host)) return null;
  return host;
}

/** True when the host is a company's own site, as far as the name can tell. */
export function isCompanySite(domain: string): boolean {
  return !NOT_A_COMPANY_SITE.some((d) => sameOrSub(domain, d));
}

export function isFreeMail(domain: string): boolean {
  return FREE_MAIL.has(domain.toLowerCase());
}

/** Two hosts of the same site: equal once "www." is set aside. */
export function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a) === strip(b);
}

/**
 * True when an address at `emailDomain` belongs to the company at
 * `siteDomainName`: the same domain, or one inside the other (mail.acme.com
 * and acme.com).
 */
export function emailBelongsToSite(
  emailDomain: string,
  siteDomainName: string,
): boolean {
  const e = emailDomain.toLowerCase();
  const s = siteDomainName.toLowerCase().replace(/^www\./, "");
  return sameOrSub(e, s) || sameOrSub(s, e);
}
