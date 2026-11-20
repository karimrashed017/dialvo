import "server-only";
import { createCrmStore, type CrmStore } from "./store";

// "Is this person or company already in the workspace's CRM?", for any
// server code that is about to reach out to someone. The same rule is in
// the database as private.crm_is_known(workspace, email, domain), and
// private.outbound_is_suppressed() (the never-contact check that Find leads,
// drafting and sending already use) includes it, so the database paths need
// no call of their own.
//
// With no CRM connected, or no secret key on this server, the answer is
// false: nothing is known to a CRM that isn't there.

export async function isKnownToCrm(
  workspaceId: string,
  who: { email?: string | null; domain?: string | null },
  store: CrmStore | null = createCrmStore(),
): Promise<boolean> {
  if (!store) return false;
  const email = who.email?.trim().toLowerCase() || null;
  const domain = who.domain?.trim().toLowerCase() || null;
  if (!email && !domain) return false;
  return store.isKnown(workspaceId, email, domain);
}
