import "server-only";
import { promises as dns } from "node:dns";

// The DNS check of a mailbox's domain: the records that decide whether mail
// from it is trusted (SPF, DKIM, DMARC) and whether replies can reach it
// (MX). Each result comes with a plain fix. Only public DNS is read; nothing
// is sent anywhere. Inbox-placement (seed) testing isn't part of this.
//
// DKIM can't be listed: a key lives under a "selector" only the sender
// knows. The selectors the common mail providers and senders use are tried
// (google, selector1 and selector2 for Microsoft 365, and a few more), and
// a key found under any of them counts.

export type Verdict = "ok" | "warn" | "missing";

export type DnsItem = {
  verdict: Verdict;
  /** What was found, in a few words. */
  found: string;
  /** What to do, in plain words. Empty when nothing needs doing. */
  fix: string;
};

export type DnsCheck = {
  domain: string;
  /** A free mail domain (gmail.com, outlook.com…): its DNS isn't yours. */
  managed: boolean;
  spf: DnsItem;
  dkim: DnsItem & { selector: string | null };
  dmarc: DnsItem;
  mx: DnsItem;
  checked_at: string;
};

/** The few lookups the check makes. Faked in the tests. */
export type Resolver = {
  txt(name: string): Promise<string[][]>;
  mx(name: string): Promise<{ exchange: string; priority: number }[]>;
  cname(name: string): Promise<string[]>;
};

export const realResolver: Resolver = {
  txt: (name) => dns.resolveTxt(name),
  mx: (name) => dns.resolveMx(name),
  cname: (name) => dns.resolveCname(name),
};

export const DKIM_SELECTORS = [
  "google",
  "selector1",
  "selector2",
  "default",
  "dkim",
  "mail",
  "k1",
  "s1",
  "s2",
  "zoho",
  "smtp",
] as const;

const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "zoho.com",
]);

/** What each provider's SPF include is, for the fix line. */
const SPF_INCLUDE: Record<string, string> = {
  google: "include:_spf.google.com",
  microsoft: "include:spf.protection.outlook.com",
};

export function domainOf(email: string): string {
  return email.split("@")[1]?.trim().toLowerCase() ?? "";
}

const join = (record: string[]) => record.join("");

async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

function spfItem(records: string[], provider: string): DnsItem {
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r));
  const include = SPF_INCLUDE[provider];
  const add = include ? ` that includes ${include}` : "";
  if (spf.length === 0)
    return {
      verdict: "missing",
      found: "No SPF record",
      fix: `Add a TXT record on the domain: v=spf1${include ? ` ${include}` : ""} ~all (with your mail provider's include${include ? "" : ", from its setup page"}).`,
    };
  if (spf.length > 1)
    return {
      verdict: "warn",
      found: `${spf.length} SPF records`,
      fix: `Merge them into one: a domain may have only one SPF record${add}.`,
    };
  const record = spf[0];
  if (include && !record.toLowerCase().includes(include.toLowerCase()))
    return {
      verdict: "warn",
      found: record.slice(0, 200),
      fix: `Your SPF record doesn't name your mail provider. Add ${include} before the final ~all or -all.`,
    };
  if (/\s\+all\b/i.test(record))
    return {
      verdict: "warn",
      found: record.slice(0, 200),
      fix: "It ends in +all, which lets anyone send as you. Change it to ~all.",
    };
  return { verdict: "ok", found: record.slice(0, 200), fix: "" };
}

function dmarcItem(records: string[]): DnsItem {
  const dmarc = records.find((r) => /^v=DMARC1/i.test(r));
  if (!dmarc)
    return {
      verdict: "missing",
      found: "No DMARC record",
      fix: "Add a TXT record named _dmarc with: v=DMARC1; p=none; rua=mailto:you@yourdomain. Large mailbox providers expect one from anyone sending in volume.",
    };
  const policy = /;\s*p=(\w+)/i.exec(dmarc)?.[1]?.toLowerCase() ?? "";
  if (!["none", "quarantine", "reject"].includes(policy))
    return {
      verdict: "warn",
      found: dmarc.slice(0, 200),
      fix: "The record has no valid p= policy. Start with p=none.",
    };
  return { verdict: "ok", found: dmarc.slice(0, 200), fix: "" };
}

/** Checks one mailbox's domain. Never throws: a lookup that fails is "missing". */
export async function checkDomain(
  email: string,
  provider: string,
  resolver: Resolver = realResolver,
  now: () => Date = () => new Date(),
): Promise<DnsCheck> {
  const domain = domainOf(email);
  const checked_at = now().toISOString();
  if (FREE_MAIL.has(domain)) {
    const managed: DnsItem = {
      verdict: "ok",
      found: `Managed by ${domain}`,
      fix: "",
    };
    return {
      domain,
      managed: true,
      spf: managed,
      dkim: { ...managed, selector: null },
      dmarc: managed,
      mx: managed,
      checked_at,
    };
  }
  const [txt, dmarcTxt, mx] = await Promise.all([
    safe(() => resolver.txt(domain), [] as string[][]),
    safe(() => resolver.txt(`_dmarc.${domain}`), [] as string[][]),
    safe(() => resolver.mx(domain), []),
  ]);
  let selector: string | null = null;
  for (const s of DKIM_SELECTORS) {
    const name = `${s}._domainkey.${domain}`;
    const key = await safe(() => resolver.txt(name), [] as string[][]);
    const hasKey = key.map(join).some((r) => /(^|;)\s*p=[A-Za-z0-9+/]/.test(r));
    const alias =
      !hasKey && (await safe(() => resolver.cname(name), [] as string[]));
    if (hasKey || (alias && alias.length > 0)) {
      selector = s;
      break;
    }
  }
  const dkimFix =
    provider === "google"
      ? "In the Google Admin console: Apps, Google Workspace, Gmail, Authenticate email. Generate a key and add the TXT record it gives you, then start authentication."
      : provider === "microsoft"
        ? "In Microsoft 365 Defender: Email authentication settings, DKIM. Add the two CNAME records (selector1 and selector2) it shows, then enable signing."
        : "Turn on DKIM signing in your mail provider's settings and add the DNS record it gives you. If you already did, it may use a selector Dialvo doesn't guess.";
  return {
    domain,
    managed: false,
    spf: spfItem(txt.map(join), provider),
    dkim: selector
      ? {
          verdict: "ok",
          found: `Key found (selector "${selector}")`,
          fix: "",
          selector,
        }
      : {
          verdict: "missing",
          found: "No key under the usual selectors",
          fix: dkimFix,
          selector: null,
        },
    dmarc: dmarcItem(dmarcTxt.map(join)),
    mx:
      mx.length > 0
        ? {
            verdict: "ok",
            found: [...mx]
              .sort((a, b) => a.priority - b.priority)
              .slice(0, 3)
              .map((m) => m.exchange)
              .join(", "),
            fix: "",
          }
        : {
            verdict: "missing",
            found: "No MX record",
            fix: "Replies can't reach this domain. Add the MX records your mail provider gives you.",
          },
    checked_at,
  };
}
