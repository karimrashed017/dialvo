import "server-only";
import { headers } from "next/headers";
import { SITE_URL } from "@/lib/site";

/**
 * This site's own address as the visitor sees it, for the links in auth
 * emails. Supabase only follows redirect addresses on its allow-list, so a
 * forged Host header can't send a confirmation link anywhere else.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return SITE_URL;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto === "http" && local ? "http" : "https"}://${host}`;
}
