import { describe, expect, it } from "vitest";
import {
  createPipedriveClient,
  pipedriveDomain,
  verifyPipedrive,
} from "./pipedrive";
import { processJob } from "./steps";
import { fakeCrm, type Route } from "./testing/fake-fetch";
import { jobOf } from "./testing/jobs";
import type { LinkUpdate } from "./types";

const TOKEN = "fake.token.for.pipedrive.tests.only";
const pd = {
  provider: "pipedrive" as const,
  can_opt_out: false,
  can_deals: true,
  deal_pipeline_id: "1",
  deal_stage_id: "2",
};

const run = async (routes: Route[], job = jobOf({ connection: pd })) => {
  const crm = fakeCrm(routes);
  const link: LinkUpdate = {};
  const result = await processJob(
    job,
    createPipedriveClient(TOKEN, "acme", crm.deps),
    link,
  );
  return { crm, link, result };
};

describe("connecting Pipedrive", () => {
  it("finds the company's address from the token alone", async () => {
    const crm = fakeCrm([
      [
        "GET",
        /^\/api\/v1\/users\/me$/,
        {
          json: {
            success: true,
            data: { company_domain: "acme", company_name: "Acme Ltd" },
          },
        },
      ],
    ]);
    expect(await verifyPipedrive(TOKEN, null, crm.deps)).toEqual({
      ok: true,
      label: "Acme Ltd on Pipedrive",
      apiDomain: "acme",
      canOptOut: false,
      canDeals: true,
    });
    expect(crm.calls.map((c) => new URL(c.url).host)).toEqual([
      "api.pipedrive.com",
      "acme.pipedrive.com",
    ]);
    for (const c of crm.calls) {
      expect(c.headers["x-api-token"]).toBe(TOKEN);
      expect(c.url).not.toContain(TOKEN);
    }
  });

  it("says plainly when the token is refused", async () => {
    const crm = fakeCrm([
      ["GET", /users\/me/, { status: 401, json: { error: "unauthorized" } }],
    ]);
    const v = await verifyPipedrive(TOKEN, "acme", crm.deps);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.message).toMatch(/didn't accept this token/);
    expect(JSON.stringify(v)).not.toContain(TOKEN);
  });

  it("reads a company domain however it is typed, and refuses anything else", () => {
    expect(pipedriveDomain("acme")).toBe("acme");
    expect(pipedriveDomain("https://Acme-Co.pipedrive.com/deals")).toBe(
      "acme-co",
    );
    expect(pipedriveDomain("evil.example.com/")).toBeNull();
    expect(pipedriveDomain("a b")).toBeNull();
  });
});

describe("writing a lead to Pipedrive", () => {
  it("adds the organization and the person, by email, with the organization set", async () => {
    const { crm, link } = await run([
      [
        "GET",
        /^\/api\/v2\/organizations\/search\?/,
        { json: { data: { items: [] } } },
      ],
      [
        "POST",
        /^\/api\/v2\/organizations$/,
        { json: { success: true, data: { id: 31 } } },
      ],
      [
        "GET",
        /^\/api\/v2\/persons\/search\?/,
        { json: { data: { items: [] } } },
      ],
      [
        "POST",
        /^\/api\/v2\/persons$/,
        { json: { success: true, data: { id: 41 } } },
      ],
    ]);
    expect(link).toEqual({
      company_id: "31",
      company_created: true,
      company_domain: "analytical.example",
      contact_id: "41",
      contact_created: true,
    });
    const search = crm.calls.find((c) =>
      c.path.startsWith("/api/v2/persons/search"),
    )!;
    const q = new URL(search.url).searchParams;
    expect(Object.fromEntries(q)).toEqual({
      term: "ada@analytical.example",
      fields: "email",
      exact_match: "true",
      limit: "1",
    });
    expect(
      crm.calls.find((c) => c.path === "/api/v2/organizations")!.body,
    ).toEqual({
      name: "Analytical Engines",
      website: "https://analytical.example",
    });
    expect(crm.calls.find((c) => c.path === "/api/v2/persons")!.body).toEqual({
      name: "Ada Lovelace",
      emails: [
        { value: "ada@analytical.example", primary: true, label: "work" },
      ],
      org_id: 31,
    });
  });

  it("leaves a person's own organization alone", async () => {
    const { crm, link } = await run([
      [
        "GET",
        /organizations\/search/,
        { json: { data: { items: [{ item: { id: 31 } }] } } },
      ],
      [
        "GET",
        /persons\/search/,
        {
          json: {
            data: { items: [{ item: { id: 41, organization: { id: 99 } } }] },
          },
        },
      ],
    ]);
    expect(link.contact_id).toBe("41");
    expect(
      crm.calls.some((c) => c.method === "PATCH" || c.method === "POST"),
    ).toBe(false);
  });

  it("writes a note, a meeting activity and a deal", async () => {
    const linked = {
      contact_id: "41",
      company_id: "31",
      deal_id: null,
      contact_created: true,
      company_created: true,
    };
    const note = await run(
      [
        [
          "POST",
          /^\/api\/v1\/notes$/,
          { json: { success: true, data: { id: 7 } } },
        ],
      ],
      jobOf({
        connection: pd,
        kind: "note",
        source_key: "msg:1",
        link: linked,
        detail: {
          type: "email",
          direction: "out",
          subject: "Hello",
          body: "Hi Ada",
          sent_at: "2026-11-20T09:05:00.000Z",
        },
      }),
    );
    expect(note.crm.calls[0].body).toMatchObject({
      person_id: 41,
      org_id: 31,
      add_time: "2026-11-20 09:05:00",
    });
    expect((note.crm.calls[0].body as { content: string }).content).toContain(
      "Email sent by Dialvo",
    );

    const meeting = await run(
      [
        [
          "POST",
          /^\/api\/v2\/activities$/,
          { json: { success: true, data: { id: 8 } } },
        ],
      ],
      jobOf({
        connection: pd,
        kind: "meeting",
        source_key: "meeting:1",
        link: linked,
        detail: {
          type: "meeting",
          title: "Intro",
          starts_at: "2026-11-21T10:00:00.000Z",
          ends_at: "2026-11-21T10:45:00.000Z",
          status: "scheduled",
          booked_by: "agent",
        },
      }),
    );
    expect(meeting.result.externalId).toBe("8");
    expect(meeting.crm.calls[0].body).toMatchObject({
      subject: "Intro",
      type: "meeting",
      due_date: "2026-11-21",
      due_time: "10:00",
      duration: "00:45",
      done: false,
      participants: [{ person_id: 41, primary: true }],
      org_id: 31,
    });

    const deal = await run(
      [
        [
          "POST",
          /^\/api\/v2\/deals$/,
          { json: { success: true, data: { id: 9 } } },
        ],
      ],
      jobOf({
        connection: pd,
        kind: "deal",
        source_key: "deal:lead-1",
        link: linked,
      }),
    );
    expect(deal.link.deal_id).toBe("9");
    expect(deal.crm.calls[0].body).toEqual({
      title: "Analytical Engines (from Dialvo)",
      person_id: 41,
      pipeline_id: 1,
      stage_id: 2,
      org_id: 31,
    });
  });

  it("sets marketing status where Campaigns exists, and writes a note where it doesn't", async () => {
    const linked = {
      contact_id: "41",
      company_id: null,
      deal_id: null,
      contact_created: false,
      company_created: false,
    };
    const job = jobOf({
      connection: pd,
      kind: "opt_out",
      source_key: "opt_out:lead-1",
      link: linked,
    });
    const set = await run(
      [
        [
          "PATCH",
          /^\/api\/v2\/persons\/41$/,
          {
            json: { success: true, data: { marketing_status: "unsubscribed" } },
          },
        ],
      ],
      job,
    );
    expect(set.result).toEqual({ outcome: "done" });
    const none = await run(
      [
        ["PATCH", /persons\/41/, { json: { success: true, data: {} } }],
        [
          "POST",
          /^\/api\/v1\/notes$/,
          { json: { success: true, data: { id: 70 } } },
        ],
      ],
      job,
    );
    expect(none.result.externalId).toBe("70");
  });
});

describe("importing from Pipedrive", () => {
  it("reads people and organizations with their deals, and work domains only", async () => {
    const crm = fakeCrm([
      [
        "GET",
        /^\/api\/v2\/persons\?/,
        (c) =>
          c.path.includes("cursor=c2")
            ? {
                json: {
                  data: [{ emails: [{ value: "solo@gmail.com" }] }],
                  additional_data: { next_cursor: null },
                },
              }
            : {
                json: {
                  data: [
                    {
                      emails: [
                        { value: "Buyer@Client.example" },
                        { value: "junk" },
                      ],
                      open_deals_count: 1,
                      won_deals_count: 0,
                    },
                  ],
                  additional_data: { next_cursor: "c2" },
                },
              },
      ],
      [
        "GET",
        /^\/api\/v2\/organizations\?/,
        {
          json: {
            data: [
              {
                website: "https://www.other.example/about",
                won_deals_count: 2,
              },
              { website: null },
            ],
          },
        },
      ],
    ]);
    const page = await createPipedriveClient(TOKEN, "acme", crm.deps).pullPage(
      {},
      10,
    );
    expect(page).toEqual({
      entries: [
        { k: "email", v: "buyer@client.example", f: true },
        { k: "domain", v: "client.example", f: true },
        { k: "email", v: "solo@gmail.com", f: false },
        { k: "domain", v: "other.example", f: true },
      ],
      seen: 4,
      next: null,
    });
    expect(crm.calls[0].path).toContain("limit=500");
    expect(crm.calls[0].path).toContain(
      "include_fields=open_deals_count%2Cwon_deals_count",
    );
  });
});
