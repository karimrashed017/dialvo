import { afterEach, describe, expect, it, vi } from "vitest";
import { backoffSeconds, pullStep, pushStep } from "./steps";
import type { CrmStore, JobOutcome, PullClaim } from "./store";
import { fakeCrm, type Route } from "./testing/fake-fetch";
import { jobOf } from "./testing/jobs";
import type { Credentials, Job, KnownEntry, PullCursor } from "./types";

const TOKEN = "fake.token.for.step.tests.only";

type Finished = {
  id: string;
  outcome: JobOutcome;
  delaySeconds?: number;
  error?: string;
  externalId?: string;
  link?: unknown;
};

function fakeStore(
  o: {
    jobs?: Job[];
    credentials?: Credentials | null;
    pull?: PullClaim | null;
  } = {},
) {
  const finished: Finished[] = [];
  const saved: {
    entries: KnownEntry[];
    cursor: PullCursor;
    seen: number;
    done: boolean;
    error?: string;
  }[] = [];
  const store: CrmStore = {
    connect: vi.fn(),
    credentials: async () =>
      o.credentials === undefined
        ? { provider: "hubspot", token: TOKEN, api_domain: null }
        : o.credentials,
    claimJobs: async () => o.jobs ?? [],
    finishJob: async (job, outcome, x = {}) => {
      finished.push({ id: job.id, outcome, ...x });
      return outcome === "auth"
        ? "auth"
        : outcome === "retry"
          ? "retry"
          : outcome;
    },
    claimPull: async () => o.pull ?? null,
    savePull: async (_c, page) => {
      saved.push(page);
      return page.error ? "failed" : page.done ? "done" : "running";
    },
    isKnown: async () => false,
    cronTokenOk: async () => false,
  };
  return { store, finished, saved };
}

const contactRoutes: Route[] = [
  [
    "GET",
    /^\/crm\/v3\/objects\/contacts\/[^?]+\?idProperty/,
    { status: 404, json: {} },
  ],
  ["POST", /companies\/search/, { json: { results: [{ id: "601" }] } }],
  [
    "POST",
    /^\/crm\/v3\/objects\/contacts$/,
    { status: 201, json: { id: "501" } },
  ],
];

const logs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  logs.length = 0;
});
const watchLogs = () => {
  for (const level of ["error", "warn", "log", "info"] as const)
    vi.spyOn(console, level).mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });
};

describe("a push step", () => {
  it("writes each job and records the CRM's ids on the lead", async () => {
    const crm = fakeCrm(contactRoutes);
    const { store, finished } = fakeStore({ jobs: [jobOf()] });
    const r = await pushStep({ store, http: crm.deps });
    expect(r).toMatchObject({ claimed: 1, done: 1 });
    expect(finished).toEqual([
      expect.objectContaining({
        id: "job-1",
        outcome: "done",
        externalId: "501",
        link: {
          company_id: "601",
          company_domain: "analytical.example",
          contact_id: "501",
          contact_created: true,
        },
      }),
    ]);
  });

  it("on a long 429, puts the job and the rest of that workspace's batch back for later", async () => {
    const crm = fakeCrm([
      ["*", /./, { status: 429, headers: { "Retry-After": "90" }, json: {} }],
    ]);
    const jobs = [
      jobOf({ id: "a" }),
      jobOf({ id: "b" }),
      jobOf({ id: "c", workspace_id: "ws-2" }),
    ];
    const { store, finished } = fakeStore({ jobs });
    await pushStep({ store, http: crm.deps });
    expect(finished.find((f) => f.id === "a")).toMatchObject({
      outcome: "retry",
      delaySeconds: 90,
    });
    expect(finished.find((f) => f.id === "b")).toMatchObject({
      outcome: "retry",
      delaySeconds: 90,
    });
    // Workspace 2 has its own CRM budget and was still tried.
    expect(crm.calls.length).toBe(2);
  });

  it("backs off on the CRM's own errors, longer each time", async () => {
    const crm = fakeCrm([["*", /./, { status: 503, json: {} }]]);
    const { store, finished } = fakeStore({ jobs: [jobOf({ attempts: 3 })] });
    await pushStep({ store, http: crm.deps, random: () => 0 });
    expect(finished[0]).toMatchObject({ outcome: "retry", delaySeconds: 120 });
    expect(finished[0].error).toMatch(/HubSpot had a problem/);
    expect(backoffSeconds(1, () => 0)).toBe(30);
    expect(backoffSeconds(2, () => 0)).toBe(60);
    expect(backoffSeconds(30, () => 0)).toBe(6 * 60 * 60);
    expect(backoffSeconds(1, () => 1)).toBe(36);
  });

  it("stops the workspace when the token is refused, without using up the jobs", async () => {
    const crm = fakeCrm([["*", /./, { status: 401, json: {} }]]);
    const { store, finished } = fakeStore({
      jobs: [jobOf({ id: "a" }), jobOf({ id: "b" })],
    });
    await pushStep({ store, http: crm.deps });
    expect(finished.map((f) => f.outcome)).toEqual(["auth", "auth"]);
    expect(finished[0].error).toMatch(/Connect HubSpot again/);
    expect(crm.calls).toHaveLength(1);
  });

  it("fails, with HubSpot's reason, what HubSpot won't accept", async () => {
    const crm = fakeCrm([
      contactRoutes[0],
      contactRoutes[1],
      [
        "POST",
        /^\/crm\/v3\/objects\/contacts$/,
        { status: 400, json: { message: "Property values were not valid" } },
      ],
    ]);
    const { store, finished } = fakeStore({ jobs: [jobOf()] });
    await pushStep({ store, http: crm.deps });
    expect(finished[0]).toMatchObject({ outcome: "failed" });
    expect(finished[0].error).toContain("Property values were not valid");
    // What was found before the failure is kept.
    expect(finished[0].link).toEqual({
      company_id: "601",
      company_domain: "analytical.example",
    });
  });

  it("skips jobs of a CRM that was disconnected, and a lead with no email", async () => {
    const a = fakeStore({ jobs: [jobOf()], credentials: null });
    await pushStep({ store: a.store, http: fakeCrm([]).deps });
    expect(a.finished[0]).toMatchObject({
      outcome: "skipped",
      error: "The CRM was disconnected.",
    });
    const b = fakeStore({ jobs: [jobOf({ lead: { email: null } })] });
    await pushStep({ store: b.store, http: fakeCrm([]).deps });
    expect(b.finished[0].outcome).toBe("skipped");
  });

  it("never logs or stores the token, whatever goes wrong", async () => {
    watchLogs();
    const crm = fakeCrm([
      ["*", /./, { status: 400, json: { message: `token ${TOKEN} rejected` } }],
    ]);
    const { store, finished } = fakeStore({ jobs: [jobOf()] });
    await pushStep({ store, http: crm.deps });
    const boom = fakeStore({ jobs: [jobOf()] });
    await pushStep({
      store: boom.store,
      clientFor: () => {
        throw new Error("unexpected");
      },
    }).catch(() => undefined);
    expect(JSON.stringify(finished)).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain(TOKEN);
  });
});

describe("an import step", () => {
  const claim: PullClaim = {
    workspace_id: "ws-1",
    provider: "hubspot",
    generation: 3,
    cursor: {},
    seen: 0,
  };

  it("saves what it read and where to carry on", async () => {
    const crm = fakeCrm([
      [
        "GET",
        /contacts\?/,
        {
          json: {
            results: [{ id: "1", properties: { email: "a@b.example" } }],
            paging: { next: { after: "n" } },
          },
        },
      ],
    ]);
    const { store, saved } = fakeStore({ pull: claim });
    const r = await pullStep({ store, http: crm.deps });
    expect(r.status).toBe("running");
    // Ten pages a step, each with one contact and a next page.
    expect(saved[0]).toMatchObject({
      cursor: { phase: "contacts", after: "n" },
      seen: 10,
      done: false,
    });
    expect(saved[0].entries[0]).toEqual({
      k: "email",
      v: "a@b.example",
      f: false,
    });
    expect(crm.calls).toHaveLength(10);
  });

  it("finishes on the last page", async () => {
    const crm = fakeCrm([["GET", /./, { json: { results: [] } }]]);
    const { store, saved } = fakeStore({ pull: claim });
    expect((await pullStep({ store, http: crm.deps })).status).toBe("done");
    expect(saved[0].done).toBe(true);
  });

  it("records a failure in plain words", async () => {
    const crm = fakeCrm([["GET", /./, { status: 500, json: {} }]]);
    const { store, saved } = fakeStore({ pull: claim });
    expect((await pullStep({ store, http: crm.deps })).status).toBe("failed");
    expect(saved[0].error).toMatch(/HubSpot had a problem/);
  });

  it("does nothing when no import is due", async () => {
    const { store } = fakeStore();
    expect(await pullStep({ store, http: fakeCrm([]).deps })).toEqual({
      status: "idle",
      entries: 0,
    });
  });
});
