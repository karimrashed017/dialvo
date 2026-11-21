// Which company an IP address belongs to, through a data provider. One
// adapter today: ipapi.is (docs read 21 Nov 2026, https://ipapi.is/developers.html),
// chosen as the cheapest with a usable self-serve API: 1,000 lookups a day
// free with a key, then $20 a month for 20,000 a day. Its "company" object
// is the organisation the address is registered to (from WHOIS), with a
// type: we keep only "business" addresses that aren't a data centre, VPN,
// proxy, Tor exit, crawler or mobile network, since those say nothing about
// who is reading. This finds companies that run their own network (most
// mid-sized and large ones); people working from home show as their
// internet provider and are left out.
//
// The key is sent in the POST body, never in a URL. Pure but for the fetch.

export const IPAPI_ENV = "IPAPI_IS_API_KEY";
export const IPAPI_URL = "https://api.ipapi.is";

export type Company = {
  domain: string;
  name: string;
  country: string;
  source: "ipapi";
};

export function visitorIdStatus(
  env: Record<string, string | undefined> = process.env,
): {
  on: boolean;
  provider: string;
  envName: string;
} {
  return {
    on: Boolean(env[IPAPI_ENV]),
    provider: "ipapi.is",
    envName: IPAPI_ENV,
  };
}

const NOT_A_COMPANY = [
  "is_datacenter",
  "is_vpn",
  "is_proxy",
  "is_tor",
  "is_mobile",
  "is_satellite",
  "is_crawler",
  "is_bogon",
] as const;

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** The company in an ipapi.is answer, or null when it isn't one. */
export function readIpapi(json: unknown): Company | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (NOT_A_COMPANY.some((flag) => Boolean(o[flag]))) return null;
  const company = o.company as Record<string, unknown> | null | undefined;
  if (!company || company.type !== "business") return null;
  const domain = String(company.domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!DOMAIN.test(domain) || domain.length > 253) return null;
  const location = o.location as Record<string, unknown> | undefined;
  return {
    domain,
    name: String(company.name ?? "")
      .replace(/[\u0000-\u001f\u007f<>]+/g, " ")
      .trim()
      .slice(0, 200),
    country: String(location?.country_code ?? location?.country ?? "").slice(
      0,
      60,
    ),
    source: "ipapi",
  };
}

/** Public, routable IPv4 or IPv6 only: nothing private is ever sent. */
export function lookupWorthy(ip: string): boolean {
  if (/^(10|127|0)\./.test(ip)) return false;
  if (/^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return false;
  if (/^(::1?|f[cd]|fe80)/i.test(ip)) return false;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || /^[0-9a-f:]{3,45}$/i.test(ip);
}

export async function lookupCompany(
  ip: string,
  key: string,
  fetcher: typeof fetch,
): Promise<Company | null | "failed"> {
  if (!lookupWorthy(ip)) return null;
  try {
    const res = await fetcher(IPAPI_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: ip, key }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return "failed";
    return readIpapi(await res.json());
  } catch {
    return "failed";
  }
}
