import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTACT_CREDITS_PER_COMPANY,
  CONTACT_POLL_SECONDS,
  MAX_COMPANIES_PER_RUN,
} from "./config";
import {
  advanceContactRun,
  exclusionListName,
  type ContactDeps,
} from "./contact-run";
import type { ContactClaim, ContactStore } from "./contact-store";
import type { FindymailClient } from "./findymail";
import type { ContactRow } from "./findymail-parse";
import type { ModelClient } from "./model";
import { advanceRun } from "./run";
import type { Claim, ProspectStore } from "./store";

// The contact database's steps, with Findymail, the database and the model
// all faked. The real Findymail API is never called here.

const ids = { runId: "run", workspaceId: "ws" };

const searching = (
  extra: Partial<Extract<ContactClaim, { phase: string }>> = {},
): ContactClaim => ({
  status: "searching",
  phase: "start",
  hash: null,
  page: 1,
  limit: null,
  query: "Independent dental clinics in Leeds",
  titles: [["Owner", "Founder"]],
  target_count: MAX_COMPANIES_PER_RUN,
  credits_today: 0,
  exclusion_list_id: null,
  exclusions_synced_at: null,
  ...extra,
});

function fakeContacts(
  claim: ContactClaim | null,
  granted = MAX_COMPANIES_PER_RUN,
) {
  const contacts = {
    startRun: vi.fn(),
    claim: vi.fn(async () => claim),
    reserve: vi.fn(async () => granted),
    step: vi.fn(async () => {}),
    add: vi.fn(async () => ({ status: "researching", added: 1 })),
    exclusions: vi.fn(async () => ({
      list_id: null,
      read_at: "2026-11-20T12:00:00Z",
      domains: ["known.example", "never.example"],
    })),
    setList: vi.fn(async () => {}),
    synced: vi.fn(async () => {}),
  };
  return contacts as typeof contacts & ContactStore;
}

type Calls = Partial<{
  [K in keyof FindymailClient]: Awaited<ReturnType<FindymailClient[K]>>;
}>;

function fakeFindymail(replies: Calls = {}) {
  const client = {
    credits: vi.fn(
      async () =>
        replies.credits ?? {
          ok: true as const,
          value: { credits: 1000, hasCapacity: null },
        },
    ),
    startSearch: vi.fn(
      async () => replies.startSearch ?? { ok: true as const, value: "hash1" },
    ),
    status: vi.fn(
      async () =>
        replies.status ?? { ok: true as const, value: "processing" as const },
    ),
    page: vi.fn(
      async () =>
        replies.page ?? {
          ok: true as const,
          value: { rows: [contactRow()], returned: 1, last: true },
        },
    ),
    exclusionList: vi.fn(
      async () => replies.exclusionList ?? { ok: true as const, value: 42 },
    ),
    addExclusions: vi.fn(
      async () =>
        replies.addExclusions ?? { ok: true as const, value: true as const },
    ),
  };
  return client as typeof client & FindymailClient;
}

function fakeStore(claim: Claim | null = null) {
  const store = {
    takeSuggestion: vi.fn(async () => true),
    recordSpend: vi.fn(async () => {}),
    startRun: vi.fn(),
    claim: vi.fn(async () => claim),
    addCandidates: vi.fn(async () => ({
      status: "searching" as const,
      added: 0,
    })),
    saveResearch: vi.fn(async () => "found"),
    release: vi.fn(async () => {}),
    claimDrafts: vi.fn(async () => null),
    saveDraft: vi.fn(async () => {}),
  };
  return store as typeof store & ProspectStore;
}

const contactRow = (extra: Partial<ContactRow> = {}): ContactRow => ({
  external_id: "7",
  domain: "acme-dental.example",
  company_name: "Acme Dental",
  description: "A family dental clinic.",
  size_range: "11-50",
  industries: ["Dentistry"],
  country: "United Kingdom",
  match_score: 91,
  contact_name: "Dana Smith",
  contact_role: "Practice Owner",
  email: "dana@acme-dental.example",
  linkedin_url: null,
  ...extra,
});

let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => error.mockRestore());

const run = (
  contacts: ContactStore,
  findymail: FindymailClient,
  store = fakeStore(),
) =>
  advanceContactRun(ids, store, { contacts, findymail } satisfies ContactDeps);

describe("starting the search", () => {
  it("checks the account, makes and fills the workspace's exclusion list, reserves the day's credits, then asks once", async () => {
    const contacts = fakeContacts(searching());
    const findymail = fakeFindymail();
    expect(await run(contacts, findymail)).toEqual({ status: "searching" });

    expect(findymail.credits).toHaveBeenCalledTimes(1);
    expect(findymail.exclusionList).toHaveBeenCalledWith(
      exclusionListName("ws"),
    );
    expect(contacts.setList).toHaveBeenCalledWith("ws", 42);
    expect(findymail.addExclusions).toHaveBeenCalledWith(42, [
      "known.example",
      "never.example",
    ]);
    expect(contacts.synced).toHaveBeenCalledWith("ws", "2026-11-20T12:00:00Z");
    expect(contacts.reserve).toHaveBeenCalledWith(
      "run",
      "ws",
      MAX_COMPANIES_PER_RUN,
    );
    // The paid call comes after the reservation, never before.
    expect(contacts.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      findymail.startSearch.mock.invocationCallOrder[0],
    );
    expect(findymail.startSearch).toHaveBeenCalledWith({
      query: "Independent dental clinics in Leeds",
      limit: MAX_COMPANIES_PER_RUN,
      titles: [["Owner", "Founder"]],
      exclusionListId: 42,
    });
    expect(contacts.step).toHaveBeenCalledWith("run", "ws", {
      phase: "wait",
      hash: "hash1",
      waitSeconds: CONTACT_POLL_SECONDS,
    });
  });

  it("uses the list it already has, and asks only for what the day's cap allows", async () => {
    const contacts = fakeContacts(searching({ exclusion_list_id: 9 }), 7);
    const findymail = fakeFindymail();
    await run(contacts, findymail);
    expect(findymail.exclusionList).not.toHaveBeenCalled();
    expect(findymail.addExclusions).toHaveBeenCalledWith(9, expect.any(Array));
    expect(findymail.startSearch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 7 }),
    );
  });

  it("never pays past the daily credit cap: nothing is asked when the database grants nothing", async () => {
    const contacts = fakeContacts(searching(), 0);
    const findymail = fakeFindymail();
    const store = fakeStore();
    expect(await run(contacts, findymail, store)).toEqual({
      status: "stopped",
      stop_reason: "contact_daily_limit",
    });
    expect(findymail.startSearch).not.toHaveBeenCalled();
    expect(store.release).toHaveBeenCalledWith("run", "ws", {
      status: "stopped",
      reason: "contact_daily_limit",
    });
  });

  it("asks only for what the account's balance pays for", async () => {
    const contacts = fakeContacts(searching(), 10);
    const findymail = fakeFindymail({
      credits: { ok: true, value: { credits: 31, hasCapacity: null } },
    });
    await run(contacts, findymail);
    expect(contacts.reserve).toHaveBeenCalledWith("run", "ws", 10);
  });

  it("fails plainly when the account is out of credits or paused, before reserving or asking", async () => {
    for (const credits of [
      { ok: true as const, value: { credits: 2, hasCapacity: null } },
      { ok: true as const, value: { credits: 0, hasCapacity: false } },
      { ok: false as const, problem: "paused" as const },
      { ok: false as const, problem: "no_credits" as const },
    ]) {
      const contacts = fakeContacts(searching());
      const findymail = fakeFindymail({ credits });
      expect(await run(contacts, findymail)).toEqual({
        status: "failed",
        stop_reason: "contact_no_credits",
      });
      expect(contacts.reserve).not.toHaveBeenCalled();
      expect(findymail.startSearch).not.toHaveBeenCalled();
    }
  });

  it("gives the day its credits back when the search is refused, and keeps them when it may have started", async () => {
    const refused = fakeContacts(searching(), 25);
    expect(
      await run(
        refused,
        fakeFindymail({ startSearch: { ok: false, problem: "no_credits" } }),
      ),
    ).toEqual({ status: "failed", stop_reason: "contact_no_credits" });
    expect(refused.step).toHaveBeenCalledWith("run", "ws", {
      refundCredits: 25 * CONTACT_CREDITS_PER_COMPANY,
    });

    const invalid = fakeContacts(searching(), 25);
    expect(
      await run(
        invalid,
        fakeFindymail({ startSearch: { ok: false, problem: "invalid" } }),
      ),
    ).toEqual({ status: "failed", stop_reason: "contact_query_refused" });
    expect(invalid.step).toHaveBeenCalledWith("run", "ws", {
      refundCredits: 75,
    });

    const timedOut = fakeContacts(searching(), 25);
    expect(
      await run(
        timedOut,
        fakeFindymail({ startSearch: { ok: false, problem: "unavailable" } }),
      ),
    ).toEqual({ status: "failed", stop_reason: "contact_unavailable" });
    expect(timedOut.step).not.toHaveBeenCalled();
  });

  it("waits as long as Findymail asks after a 429, without giving up the reservation", async () => {
    const contacts = fakeContacts(searching({ limit: 25 }), 25);
    const findymail = fakeFindymail({
      startSearch: { ok: false, problem: "rate_limited", retryAfter: 300 },
    });
    expect(await run(contacts, findymail)).toEqual({ status: "searching" });
    expect(contacts.step).toHaveBeenCalledWith("run", "ws", {
      waitSeconds: 300,
    });
  });

  it("stops for a refused key", async () => {
    const contacts = fakeContacts(searching());
    expect(
      await run(
        contacts,
        fakeFindymail({ credits: { ok: false, problem: "unauthenticated" } }),
      ),
    ).toEqual({ status: "failed", stop_reason: "contact_not_authorised" });
  });

  it("carries on without the exclusion list if it can't be made, and still dedupes in the database", async () => {
    const contacts = fakeContacts(searching());
    const findymail = fakeFindymail({
      exclusionList: { ok: false, problem: "unavailable" },
    });
    await run(contacts, findymail);
    expect(findymail.addExclusions).not.toHaveBeenCalled();
    expect(findymail.startSearch).toHaveBeenCalledWith(
      expect.objectContaining({ exclusionListId: null }),
    );
  });
});

describe("waiting for the export", () => {
  it("asks again in a few seconds while it is being made", async () => {
    const contacts = fakeContacts(searching({ phase: "wait", hash: "hash1" }));
    const findymail = fakeFindymail({ status: { ok: true, value: "pending" } });
    expect(await run(contacts, findymail)).toEqual({ status: "searching" });
    expect(contacts.step).toHaveBeenCalledWith("run", "ws", {
      waitSeconds: CONTACT_POLL_SECONDS,
    });
    expect(findymail.page).not.toHaveBeenCalled();
    expect(findymail.startSearch).not.toHaveBeenCalled();
  });

  it("respects retry_after", async () => {
    const contacts = fakeContacts(searching({ phase: "wait", hash: "hash1" }));
    await run(
      contacts,
      fakeFindymail({
        status: { ok: false, problem: "rate_limited", retryAfter: 120 },
      }),
    );
    expect(contacts.step).toHaveBeenCalledWith("run", "ws", {
      waitSeconds: 120,
    });
  });

  it("reads the first page as soon as it is ready, and stores it as the last", async () => {
    const contacts = fakeContacts(searching({ phase: "wait", hash: "hash1" }));
    const findymail = fakeFindymail({ status: { ok: true, value: "success" } });
    expect(await run(contacts, findymail)).toEqual({ status: "researching" });
    expect(findymail.page).toHaveBeenCalledWith("hash1", 1);
    expect(contacts.add).toHaveBeenCalledWith(
      "run",
      "ws",
      [contactRow()],
      1,
      true,
    );
  });

  it("gives up on a failed or vanished export", async () => {
    const failed = fakeContacts(
      searching({ phase: "wait", hash: "h", limit: 20 }),
    );
    expect(
      await run(
        failed,
        fakeFindymail({ status: { ok: true, value: "failed" } }),
      ),
    ).toEqual({
      status: "failed",
      stop_reason: "contact_failed",
    });
    expect(failed.step).toHaveBeenCalledWith("run", "ws", {
      refundCredits: 60,
    });
    const gone = fakeContacts(searching({ phase: "wait", hash: "h" }));
    expect(
      await run(
        gone,
        fakeFindymail({ status: { ok: false, problem: "not_found" } }),
      ),
    ).toEqual({
      status: "failed",
      stop_reason: "contact_expired",
    });
  });

  it("doesn't call Findymail at all while it's too early, or another step holds the run", async () => {
    for (const status of ["waiting", "busy"] as const) {
      const findymail = fakeFindymail();
      expect(await run(fakeContacts({ status }), findymail)).toEqual({
        status: "busy",
      });
      for (const fn of Object.values(findymail))
        expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("reading the export", () => {
  it("reads the page the run is on, and keeps going until the last", async () => {
    const contacts = fakeContacts(
      searching({ phase: "read", hash: "h", page: 2 }),
    );
    contacts.add.mockResolvedValueOnce({ status: "searching", added: 3 });
    const findymail = fakeFindymail({
      page: {
        ok: true,
        value: { rows: [contactRow()], returned: 100, last: false },
      },
    });
    expect(await run(contacts, findymail)).toEqual({ status: "searching" });
    expect(findymail.page).toHaveBeenCalledWith("h", 2);
    expect(contacts.add).toHaveBeenCalledWith(
      "run",
      "ws",
      [contactRow()],
      100,
      false,
    );
  });

  it("waits when the results aren't ready yet", async () => {
    const contacts = fakeContacts(searching({ phase: "read", hash: "h" }));
    await run(
      contacts,
      fakeFindymail({ page: { ok: false, problem: "not_found" } }),
    );
    expect(contacts.add).not.toHaveBeenCalled();
    expect(contacts.step).toHaveBeenCalledWith("run", "ws", {
      waitSeconds: CONTACT_POLL_SECONDS,
    });
  });

  it("leaves the run as it is if the database call throws", async () => {
    const contacts = fakeContacts(searching({ phase: "read", hash: "h" }));
    contacts.add.mockRejectedValueOnce(new Error("connection reset"));
    const store = fakeStore();
    expect(await run(contacts, fakeFindymail(), store)).toEqual({
      status: "searching",
    });
    expect(store.release).toHaveBeenCalledWith("run", "ws");
  });
});

describe("inside the run engine", () => {
  const noModel = {
    messages: {
      create: vi.fn(async () => {
        throw new Error("no model call expected");
      }),
    },
  } as unknown as ModelClient;

  it("hands a run that isn't a contact-database run to the usual step", async () => {
    const store = fakeStore({ status: "done" });
    const contacts = fakeContacts({ status: "not_contact" });
    expect(
      await advanceRun(ids, {
        store,
        client: noModel,
        contacts: { contacts, findymail: fakeFindymail() },
      }),
    ).toEqual({ status: "done", stop_reason: null });
    expect(store.claim).toHaveBeenCalled();
  });

  it("does the contact step and nothing else for a contact-database run", async () => {
    const store = fakeStore();
    const contacts = fakeContacts(searching({ phase: "wait", hash: "h" }));
    expect(
      await advanceRun(ids, {
        store,
        client: noModel,
        contacts: { contacts, findymail: fakeFindymail() },
      }),
    ).toEqual({ status: "searching" });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("without the Findymail key, runs search the web as before", async () => {
    vi.stubEnv("FINDYMAIL_API_KEY", "");
    const { defaultContactDeps } = await import("./contact-run");
    expect(defaultContactDeps()).toBeNull();
    vi.unstubAllEnvs();
    const store = fakeStore({ status: "done" });
    expect(
      await advanceRun(ids, { store, client: noModel, contacts: null }),
    ).toEqual({
      status: "done",
      stop_reason: null,
    });
    expect(store.claim).toHaveBeenCalled();
  });
});
