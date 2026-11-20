import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress } from "@/lib/knowledge/fetch-page";

// A mailbox's servers are typed in by a customer, and Dialvo's server then
// connects to them. So that this can't be used to poke at things only the
// server can reach (localhost, a private network, cloud metadata), a server
// must be a public host name on one of the usual mail ports.

export const SMTP_PORTS = [465, 587, 2525];
export const IMAP_PORTS = [993];

const HOST = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** A problem to show the person, or null when the host may be used. */
export async function mailHostProblem(
  host: string,
  what: "SMTP" | "IMAP",
  resolve: (host: string) => Promise<{ address: string }[]> = (h) =>
    lookup(h, { all: true }),
): Promise<string | null> {
  if (isIP(host) || !HOST.test(host))
    return `The ${what} server has to be a host name such as ${what.toLowerCase()}.yourprovider.com.`;
  let addresses: { address: string }[];
  try {
    addresses = await resolve(host);
  } catch {
    return `No mail server was found at ${host}. Check the ${what} server name.`;
  }
  if (
    addresses.length === 0 ||
    addresses.some((a) => !isPublicAddress(a.address))
  )
    return `${host} isn't a public mail server, so Dialvo won't connect to it.`;
  return null;
}
