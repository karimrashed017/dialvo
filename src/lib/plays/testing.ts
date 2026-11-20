import { vi } from "vitest";
import type { PlaysFindymail } from "./findymail";
import type { PlayStore } from "./store";

// Fakes for the plays' unit tests: every database call and Findymail call
// is a spy with a harmless default, overridden per test.

export function fakePlayStore(over: Partial<PlayStore> = {}): PlayStore {
  const store: PlayStore = {
    preview: vi.fn(async () => ({ count: 0 })),
    start: vi.fn(async () => ({ status: "empty" })),
    stop: vi.fn(async () => true),
    claimDrafts: vi.fn(async () => null),
    saveDraft: vi.fn(async () => {}),
    eventImport: vi.fn(async () => ({ status: "empty" })),
    speedWorklist: vi.fn(async () => []),
    speedSweep: vi.fn(async () => 0),
    autoApprove: vi.fn(async () => 0),
    recordEvent: vi.fn(async () => ({ status: "recorded" })),
    createCompanyCampaign: vi.fn(async () => ({ status: "invalid" })),
    startCampaignRun: vi.fn(async () => ({ status: "capped" })),
    claimCampaign: vi.fn(async () => ({ status: "not_campaign" as const })),
    credits: vi.fn(async () => true),
    addLookalikes: vi.fn(async () => 0),
    resolveTarget: vi.fn(async () => "ok" as const),
    saveTarget: vi.fn(async () => "found"),
    releaseCampaign: vi.fn(async () => {}),
    wrapCampaign: vi.fn(async () => "researching"),
    reserveCredits: vi.fn(async () => true),
    addFact: vi.fn(async () => true),
    monitorBegin: vi.fn(async () => ({ status: "created", id: "m1" })),
    monitorMade: vi.fn(async () => {}),
    monitorRemove: vi.fn(async () => ({ id: "m1", external_id: 9 })),
    monitorRemoved: vi.fn(async () => {}),
    pullClaim: vi.fn(async () => []),
    ingest: vi.fn(async () => ({ added: 0, skipped: 0, over: 0 })),
    pullRelease: vi.fn(async () => {}),
    keepBegin: vi.fn(async () => ({ status: "not_found" })),
    keepFinish: vi.fn(async () => "kept"),
    ...over,
  };
  return store;
}

export function fakeFindymail(
  over: Partial<PlaysFindymail> = {},
): PlaysFindymail {
  return {
    lookalike: vi.fn(async () => ({
      ok: true as const,
      value: { companies: [], credits: 0 },
    })),
    company: vi.fn(async () => ({ ok: true as const, value: null })),
    employees: vi.fn(async () => ({ ok: true as const, value: [] })),
    email: vi.fn(async () => ({ ok: true as const, value: null })),
    technology: vi.fn(async () => ({
      ok: true as const,
      value: { found: false, detected: null, label: "" },
    })),
    createMonitor: vi.fn(async () => ({ ok: true as const, value: 9 })),
    deleteMonitor: vi.fn(async () => ({
      ok: true as const,
      value: true as const,
    })),
    signals: vi.fn(async () => ({
      ok: true as const,
      value: { rows: [], last: true },
    })),
    ...over,
  };
}
