import "server-only";
import { verifyHubspot } from "./hubspot";
import { realHttpDeps, type HttpDeps } from "./http";
import { pipedriveDomain, verifyPipedrive } from "./pipedrive";
import type { CrmStore } from "./store";
import { isProvider, PROVIDER_NAME, type Provider } from "./types";

// Connecting a CRM: check what was pasted, ask the CRM whether the token
// works and what it may do, and only then store it (in Vault, through
// crm_connect). The token is never echoed back, logged or put in a message.

export type ConnectResult =
  | { ok: true; label: string }
  | { ok: false; message: string; field?: "token" | "domain" };

export function cleanToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim().replace(/^bearer\s+/i, "");
  // Both CRMs' tokens are long runs of letters, digits and a few marks.
  return /^[A-Za-z0-9._:-]{10,500}$/.test(token) ? token : null;
}

export async function connectCrm(
  input: {
    workspaceId: string;
    userId: string;
    provider: unknown;
    token: unknown;
    domain?: unknown;
  },
  deps: { store: CrmStore; http?: HttpDeps },
): Promise<ConnectResult> {
  if (!isProvider(input.provider))
    return { ok: false, message: "Choose HubSpot or Pipedrive." };
  const provider: Provider = input.provider;
  const name = PROVIDER_NAME[provider];
  const token = cleanToken(input.token);
  if (!token)
    return {
      ok: false,
      field: "token",
      message: `That doesn't look like a ${name} ${provider === "hubspot" ? "key" : "API token"}. Paste the whole thing, with no spaces.`,
    };
  const http = deps.http ?? realHttpDeps();

  let label: string;
  let apiDomain: string | null = null;
  let canOptOut: boolean;
  let canDeals: boolean;
  if (provider === "hubspot") {
    const v = await verifyHubspot(token, http);
    if (!v.ok) return { ok: false, field: "token", message: v.message };
    ({ label, canOptOut, canDeals } = v);
  } else {
    const rawDomain =
      typeof input.domain === "string" ? input.domain.trim() : "";
    const domain = rawDomain ? pipedriveDomain(rawDomain) : null;
    if (rawDomain && !domain)
      return {
        ok: false,
        field: "domain",
        message: "Type only the part before .pipedrive.com, for example acme.",
      };
    const v = await verifyPipedrive(token, domain, http);
    if (!v.ok)
      return {
        ok: false,
        field: v.field === "domain" ? "domain" : "token",
        message: v.message,
      };
    ({ label, apiDomain, canOptOut, canDeals } = v);
  }

  const saved = await deps.store.connect({
    workspaceId: input.workspaceId,
    userId: input.userId,
    provider,
    token,
    label,
    apiDomain,
    canOptOut,
    canDeals,
  });
  if (saved.status === "connected") return { ok: true, label };
  if (saved.status === "other_connected")
    return {
      ok: false,
      message: `This workspace is connected to ${PROVIDER_NAME[saved.provider ?? "hubspot"]}. Disconnect it first: a workspace syncs with one CRM.`,
    };
  return {
    ok: false,
    message: "Only the workspace's owner or an admin can connect a CRM.",
  };
}
