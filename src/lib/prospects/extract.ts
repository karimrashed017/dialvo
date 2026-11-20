import { readableText } from "@/lib/knowledge/fetch-page";
import { normalizeEmail, normalizePhone } from "@/lib/leads/fields";
import { emailBelongsToSite, isFreeMail, sameSite } from "./domains";
import type { FoundEmail } from "./types";

// What the finder takes from a company's page besides its text: the email
// addresses and phone numbers the page itself publishes, and the links to
// its contact and about pages. Pure functions over the page's markup.
//
// THE RULE ON EMAIL ADDRESSES: an address is only ever one that appears,
// character for character, on the company's own page. Nothing here builds an
// address from a name and a domain, completes a partial one, or undoes
// "name [at] company [dot] com". If the site doesn't print it, we don't
// have it.

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

// "logo@2x.png" and friends look like addresses and aren't.
const FILE_ENDING =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|json|xml|pdf|woff2?|ttf|eot|mp4|webm)$/i;

// Mailboxes nobody reads, or that aren't a way to reach the business.
const NOT_A_CONTACT =
  /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|webmaster|hostmaster|privacy|dpo|gdpr|legal|unsubscribe|bounce|bounces|noreply-.*)$/i;

// Addresses that come with a website template, not with the business.
const PLACEHOLDER_LOCAL =
  /^(you|your|yourname|your-?email|name|email|e-?mail|user|username|someone|example|test|john\.?doe|jane\.?doe|firstname\.lastname|first\.last)$/i;
const PLACEHOLDER_DOMAIN =
  /^(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yourcompany\.com|company\.com|website\.com|mysite\.com|sentry\.io|.*\.sentry\.io|wixpress\.com|.*\.wixpress\.com|sentry-next\.wixpress\.com)$/i;

// The general mailboxes a business publishes for exactly this.
const GENERAL =
  /^(sales|hello|hi|info|contact|contactus|enquiries|enquiry|inquiries|inquiry|office|team|hey|mail|admin|bookings?|business|partnerships?|studio)$/i;

function decodeHref(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const unescape = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&");

/**
 * Why an address a page prints may not be used, or null if it may.
 *   not_theirs: on another company's domain (the web agency's in the footer,
 *     a supplier's), so not this business's contact.
 *   free_mail_unlinked: a free mailbox the page mentions but doesn't offer
 *     as a way to get in touch (no mailto: link). A free mailbox is only
 *     kept when the business itself publishes it as its contact.
 */
export function emailProblem(
  email: string,
  siteDomainName: string,
  linked: boolean,
):
  | null
  | "not_an_address"
  | "placeholder"
  | "not_a_contact"
  | "not_theirs"
  | "free_mail_unlinked" {
  const clean = normalizeEmail(email);
  if (!clean || FILE_ENDING.test(clean)) return "not_an_address";
  const [local, domain] = clean.split("@");
  if (PLACEHOLDER_LOCAL.test(local) || PLACEHOLDER_DOMAIN.test(domain))
    return "placeholder";
  if (NOT_A_CONTACT.test(local)) return "not_a_contact";
  if (isFreeMail(domain)) return linked ? null : "free_mail_unlinked";
  if (!emailBelongsToSite(domain, siteDomainName)) return "not_theirs";
  return null;
}

/**
 * The usable addresses a page publishes, best first: the general business
 * mailboxes on the company's own domain, then other addresses on it, then a
 * free mailbox the page links as its contact.
 */
export function emailsOnPage(
  html: string,
  siteDomainName: string,
): FoundEmail[] {
  const found = new Map<string, FoundEmail>();
  const add = (raw: string, linked: boolean) => {
    const email = normalizeEmail(raw.replace(/\.+$/, ""));
    if (!email || emailProblem(email, siteDomainName, linked)) return;
    const kind = isFreeMail(email.split("@")[1]) ? "free_mail" : "business";
    const seen = found.get(email);
    if (seen) seen.linked ||= linked;
    else found.set(email, { email, kind, linked });
  };
  for (const m of html.matchAll(/href\s*=\s*["']\s*mailto:([^"'?>\s]+)/gi))
    for (const part of decodeHref(unescape(m[1])).split(/[,;]/))
      add(part, true);
  // The page as a visitor reads it, footer included: that is where most
  // businesses print their address.
  const visible = readableText(html.replace(/<(\/?)footer\b/gi, "<$1div")).text;
  for (const m of visible.matchAll(EMAIL)) add(m[0], false);
  const rank = (e: FoundEmail) =>
    (e.kind === "free_mail" ? 4 : 0) +
    (GENERAL.test(e.email.split("@")[0]) ? 0 : 2) +
    (e.linked ? 0 : 1);
  return [...found.values()].sort(
    (a, b) => rank(a) - rank(b) || a.email.localeCompare(b.email),
  );
}

/** Phone numbers the page offers as tel: links. */
export function phonesOnPage(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']\s*tel:([^"'>]+)/gi)) {
    const phone = normalizePhone(decodeHref(unescape(m[1])).trim());
    if (phone) found.add(phone);
  }
  return [...found].slice(0, 3);
}

const CONTACT_WORDS =
  /contact|kontakt|contacto|contatti|get-in-touch|reach-us|impressum/i;
const ABOUT_WORDS =
  /about|team|who-we-are|our-story|company|ueber-uns|uber-uns|a-propos|chi-siamo|quienes-somos|over-ons/i;

/**
 * The site's own contact and about pages, from the links on a page: same
 * host only, https only, contact first. At most `max`.
 */
export function contactLinks(
  html: string,
  pageUrl: string,
  max: number,
): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const contact: string[] = [];
  const about: string[] = [];
  const seen = new Set<string>([base.pathname.replace(/\/+$/, "") || "/"]);
  for (const m of html.matchAll(
    /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi,
  )) {
    let url: URL;
    try {
      url = new URL(unescape(m[1]).trim(), base);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || !sameSite(url.hostname, base.hostname))
      continue;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (seen.has(path) || path.split("/").length > 4) continue;
    if (FILE_ENDING.test(path)) continue;
    const label = `${path} ${m[2].replace(/<[^>]+>/g, " ")}`;
    const list = CONTACT_WORDS.test(label)
      ? contact
      : ABOUT_WORDS.test(label)
        ? about
        : null;
    if (!list) continue;
    seen.add(path);
    url.hash = "";
    url.search = "";
    list.push(url.toString());
  }
  // One of each when there is room, contact first.
  return [contact[0], about[0], ...contact.slice(1), ...about.slice(1)]
    .filter((u): u is string => Boolean(u))
    .slice(0, max);
}
