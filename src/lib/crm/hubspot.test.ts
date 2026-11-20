import { describe, expect, it } from "vitest";
import { marker } from "./content";
import { createHubspotClient, verifyHubspot } from "./hubspot";
import { processJob } from "./steps";
import { fakeCrm, type Route } from "./testing/fake-fetch";
import { jobOf } from "./testing/jobs";
import type { LinkUpdate } from "./types";

const TOKEN = "fake.token.for.hubspot.tests.only";
const ALL_SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  "communication_preferences.read_write",
];

const noContact: Route = [
  "GET",
  /^\/crm\/v3\/objects\/contacts\/ada/,
  { status: 404, json: {} },
];
const noCompany: Route = [
  "POST",
  /^\/crm\/v3\/objects\/companies\/search/,
  { json: { results: [] } },
];
const newCompany: Route = [
  "POST",
  /^\/crm\/v3\/objects\/companies$/,
  { status: 201, json: { id: "601" } },
];
const newContact: Route = [
  "POST",
  /^\/crm\/v3\/objects\/contacts$/,
  { status: 201, json: { id: "501" } },
];

const run = async (routes: Route[], job = jobOf()) => {
  const crm = fakeCrm(routes);
  const link: LinkUpdate = {};
  const result = await processJob(
    job,
    createHubspotClient(TOKEN, crm.deps),
    link,
  );
  return { crm, link, result };
};

describe("connecting HubSpot", () => {
  it("accepts a key with every permission it needs, and says which account", async () => {
    const crm = fakeCrm([
      [
        "POST",
        /access-token-info/,
        { json: { hubId: 4242, scopes: ALL_SCOPES } },
      ],
      [
        "GET",
        /^\/crm\/v3\/objects\/(contacts|companies)\?/,
        { json: { results: [] } },
      ],
    ]);
    expect(await verifyHubspot(TOKEN, crm.deps)).toEqual({
      ok: true,
      label: "HubSpot account 4242",
      canOptOut: true,
      canDeals: true,
    });
    expect(
      crm.calls.every((c) => c.headers.authorization === `Bearer ${TOKEN}`),
    ).toBe(true);
  });

  it("names the permissions a key is missing", async () => {
    const crm = fakeCrm([
      [
        "POST",
        /access-token-info/,
        {
          json: {
            hubId: 1,
            scopes: ["crm.objects.contacts.read", "crm.objects.companies.read"],
          },
        },
      ],
    ]);
    const v = await verifyHubspot(TOKEN, crm.deps);
    expect(v).toMatchObject({ ok: false });
    expect(!v.ok && v.message).toContain(
      "crm.objects.contacts.write, crm.objects.companies.write",
    );
  });

  it("says plainly when the key is refused, without repeating it", async () => {
    const crm = fakeCrm([
      [
        "POST",
        /access-token-info/,
        { status: 401, json: { message: `bad ${TOKEN}` } },
      ],
      ["GET", /./, { status: 401, json: {} }],
    ]);
    const v = await verifyHubspot(TOKEN, crm.deps);
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v)).not.toContain(TOKEN);
    expect(!v.ok && v.message).toMatch(/didn't accept this key/);
  });

  it("works with a service key whose permissions can't be listed, by reading", async () => {
    const crm = fakeCrm([
      ["POST", /access-token-info/, { status: 400, json: {} }],
      [
        "GET",
        /^\/crm\/v3\/objects\/(contacts|companies)\?/,
        { json: { results: [] } },
      ],
      ["GET", /^\/crm\/v3\/pipelines\/deals/, { status: 403, json: {} }],
    ]);
    expect(await verifyHubspot(TOKEN, crm.deps)).toEqual({
      ok: true,
      label: "HubSpot",
      canOptOut: true,
      canDeals: false,
    });
  });
});

describe("writing a lead to HubSpot", () => {
  it("adds the company by domain and the contact by email, linked", async () => {
    const { crm, link, result } = await run([
      noContact,
      noCompany,
      newCompany,
      newContact,
    ]);
    expect(result).toEqual({ outcome: "done", externalId: "501" });
    expect(link).toEqual({
      company_id: "601",
      company_created: true,
      company_domain: "analytical.example",
      contact_id: "501",
      contact_created: true,
    });
    const search = crm.calls.find((c) => c.path.includes("companies/search"))!;
    expect(search.body).toMatchObject({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "domain",
              operator: "EQ",
              value: "analytical.example",
            },
          ],
        },
      ],
    });
    const created = crm.calls.find(
      (c) => c.method === "POST" && c.path === "/crm/v3/objects/contacts",
    )!;
    expect(created.body).toEqual({
      properties: {
        email: "ada@analytical.example",
        firstname: "Ada",
        lastname: "Lovelace",
        company: "Analytical Engines",
        website: "https://www.analytical.example",
        lifecyclestage: "lead",
      },
      associations: [
        {
          to: { id: "601" },
          types: [
            { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 279 },
          ],
        },
      ],
    });
  });

  it("leaves an existing contact and company as they are, and only links them", async () => {
    const { crm, link } = await run([
      ["GET", /^\/crm\/v3\/objects\/contacts\/ada/, { json: { id: "77" } }],
      ["POST", /companies\/search/, { json: { results: [{ id: "88" }] } }],
      [
        "PUT",
        /^\/crm\/v4\/objects\/contacts\/77\/associations\/default\/companies\/88$/,
        { json: {} },
      ],
    ]);
    expect(link).toEqual({
      company_id: "88",
      company_domain: "analytical.example",
      contact_id: "77",
    });
    expect(
      crm.calls.filter(
        (c) =>
          c.method === "PATCH" ||
          (c.method === "POST" && !c.path.includes("search")),
      ),
    ).toEqual([]);
  });

  it("uses no company for a free email address with no website", async () => {
    const { crm, link } = await run(
      [
        [
          "GET",
          /^\/crm\/v3\/objects\/contacts\/ada/,
          { status: 404, json: {} },
        ],
        newContact,
      ],
      jobOf({ lead: { email: "ada@gmail.com", website: null } }),
    );
    expect(crm.calls.some((c) => c.path.includes("companies"))).toBe(false);
    expect(link).toEqual({ contact_id: "501", contact_created: true });
  });

  it("finds the contact again when it was added a moment ago", async () => {
    const { link } = await run([
      [
        "GET",
        /^\/crm\/v3\/objects\/contacts\/ada/,
        (_c, n) =>
          n === 0 ? { status: 404, json: {} } : { json: { id: "99" } },
      ],
      ["POST", /companies\/search/, { json: { results: [{ id: "88" }] } }],
      [
        "POST",
        /^\/crm\/v3\/objects\/contacts$/,
        { status: 409, json: { message: "Contact already exists" } },
      ],
    ]);
    expect(link.contact_id).toBe("99");
    expect(link.contact_created).toBeUndefined();
  });

  it("skips a lead with no email address", async () => {
    await expect(run([], jobOf({ lead: { email: null } }))).rejects.toThrow(
      /no email address/,
    );
  });
});

describe("notes, meetings, deals and opt-outs in HubSpot", () => {
  const linked = {
    contact_id: "501",
    company_id: "601",
    deal_id: null,
    contact_created: true,
    company_created: false,
  };

  it("writes a chat as one note on the contact and company, escaped", async () => {
    const job = jobOf({
      kind: "note",
      source_key: "chat:c1:qualified",
      link: linked,
      detail: {
        type: "chat",
        outcome: "qualified",
        outcome_summary: "Wants <b>pricing</b>",
        started_at: "2026-11-20T09:00:00.000Z",
        transcript: "Visitor: hi <script>alert(1)</script>",
      },
    });
    const { crm, result } = await run(
      [
        [
          "POST",
          /^\/crm\/v3\/objects\/notes$/,
          { status: 201, json: { id: "n1" } },
        ],
      ],
      job,
    );
    expect(result).toEqual({ outcome: "done", externalId: "n1" });
    expect(crm.calls).toHaveLength(1); // first try: no search
    const body = crm.calls[0].body as {
      properties: { hs_note_body: string; hs_timestamp: string };
      associations: unknown;
    };
    expect(body.properties.hs_timestamp).toBe("2026-11-20T09:00:00.000Z");
    expect(body.properties.hs_note_body).toContain("Qualified");
    expect(body.properties.hs_note_body).toContain(
      "&lt;b&gt;pricing&lt;/b&gt;",
    );
    expect(body.properties.hs_note_body).not.toContain("<script>");
    expect(body.properties.hs_note_body).toContain(
      marker("ws-1", "chat:c1:qualified"),
    );
    expect(body.associations).toEqual([
      {
        to: { id: "501" },
        types: [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 },
        ],
      },
      {
        to: { id: "601" },
        types: [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 190 },
        ],
      },
    ]);
  });

  it("on a retry, finds the note the last try wrote instead of writing it twice", async () => {
    const job = jobOf({
      kind: "note",
      source_key: "msg:m1",
      attempts: 2,
      link: linked,
      detail: {
        type: "email",
        direction: "in",
        subject: "Re: hi",
        body: "Sounds good",
        sent_at: "2026-11-20T09:00:00Z",
      },
    });
    const { crm, result } = await run(
      [["POST", /notes\/search/, { json: { results: [{ id: "n-old" }] } }]],
      job,
    );
    expect(result.externalId).toBe("n-old");
    expect(crm.calls.map((c) => c.path)).toEqual([
      "/crm/v3/objects/notes/search",
    ]);
    expect(crm.calls[0].body).toMatchObject({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "hs_note_body",
              operator: "CONTAINS_TOKEN",
              value: marker("ws-1", "msg:m1"),
            },
          ],
        },
      ],
    });
  });

  it("creates a meeting, then updates the same one when it changes", async () => {
    const detail = {
      type: "meeting" as const,
      title: "Intro call",
      starts_at: "2026-11-21T10:00:00.000Z",
      ends_at: "2026-11-21T10:30:00.000Z",
      status: "scheduled" as const,
      booked_by: "lead",
    };
    const first = await run(
      [
        [
          "POST",
          /^\/crm\/v3\/objects\/meetings$/,
          { status: 201, json: { id: "mt1" } },
        ],
      ],
      jobOf({ kind: "meeting", source_key: "meeting:x", link: linked, detail }),
    );
    expect(first.result.externalId).toBe("mt1");
    const sent = first.crm.calls[0].body as {
      properties: Record<string, string>;
      associations: { types: { associationTypeId: number }[] }[];
    };
    expect(sent.properties).toMatchObject({
      hs_meeting_title: "Intro call",
      hs_meeting_start_time: "2026-11-21T10:00:00.000Z",
      hs_meeting_end_time: "2026-11-21T10:30:00.000Z",
      hs_meeting_outcome: "SCHEDULED",
    });
    expect(sent.associations.map((a) => a.types[0].associationTypeId)).toEqual([
      200, 188,
    ]);

    const second = await run(
      [
        [
          "PATCH",
          /^\/crm\/v3\/objects\/meetings\/mt1$/,
          { json: { id: "mt1" } },
        ],
      ],
      jobOf({
        kind: "meeting",
        source_key: "meeting:x",
        link: linked,
        external_id: "mt1",
        detail: { ...detail, status: "completed" },
      }),
    );
    expect(second.result.externalId).toBe("mt1");
    expect(
      (second.crm.calls[0].body as { properties: Record<string, string> })
        .properties.hs_meeting_outcome,
    ).toBe("COMPLETED");
  });

  it("creates one deal in the chosen pipeline and stage", async () => {
    const { crm, link } = await run(
      [
        [
          "POST",
          /^\/crm\/v3\/objects\/deals$/,
          { status: 201, json: { id: "d1" } },
        ],
      ],
      jobOf({ kind: "deal", source_key: "deal:lead-1", link: linked }),
    );
    expect(link.deal_id).toBe("d1");
    expect(crm.calls[0].body).toMatchObject({
      properties: {
        dealname: "Analytical Engines (from Dialvo)",
        pipeline: "default",
        dealstage: "appointmentscheduled",
      },
    });
    const types = (
      crm.calls[0].body as {
        associations: { types: { associationTypeId: number }[] }[];
      }
    ).associations.map((a) => a.types[0].associationTypeId);
    expect(types).toEqual([3, 341]);
    // Already has one: nothing is written.
    const again = await run(
      [],
      jobOf({
        kind: "deal",
        source_key: "deal:lead-1",
        link: { ...linked, deal_id: "d1" },
      }),
    );
    expect(again.crm.calls).toEqual([]);
  });

  it("doesn't create a deal when deals aren't switched on", async () => {
    await expect(
      run(
        [],
        jobOf({
          kind: "deal",
          link: linked,
          connection: {
            provider: "hubspot",
            can_opt_out: true,
            can_deals: true,
            deal_pipeline_id: null,
            deal_stage_id: null,
          },
        }),
      ),
    ).rejects.toThrow(/isn't switched on/);
  });

  it("unsubscribes from all email, or writes a note when the key may not", async () => {
    const ok = await run(
      [
        [
          "POST",
          /^\/communication-preferences\/v4\/statuses\/ada%40analytical\.example\/unsubscribe-all\?channel=EMAIL$/,
          { json: {} },
        ],
      ],
      jobOf({ kind: "opt_out", source_key: "opt_out:lead-1", link: linked }),
    );
    expect(ok.result).toEqual({ outcome: "done" });
    const refused = await run(
      [
        [
          "POST",
          /unsubscribe-all/,
          { status: 403, json: { category: "MISSING_SCOPES" } },
        ],
        [
          "POST",
          /^\/crm\/v3\/objects\/notes$/,
          { status: 201, json: { id: "n9" } },
        ],
      ],
      jobOf({ kind: "opt_out", source_key: "opt_out:lead-1", link: linked }),
    );
    expect(refused.result.externalId).toBe("n9");
    expect(JSON.stringify(refused.crm.calls[1].body)).toContain(
      "asked not to be contacted",
    );
  });
});

describe("importing from HubSpot", () => {
  it("reads contacts then companies, page by page, flags customers and open deals, drops junk", async () => {
    const crm = fakeCrm([
      [
        "GET",
        /^\/crm\/v3\/objects\/contacts\?/,
        (c) =>
          c.path.includes("after=p2")
            ? {
                json: {
                  results: [
                    {
                      id: "3",
                      properties: {
                        email: "Not an email",
                        lifecyclestage: "lead",
                      },
                    },
                  ],
                },
              }
            : {
                json: {
                  results: [
                    {
                      id: "1",
                      properties: {
                        email: "Customer@Client.example",
                        lifecyclestage: "customer",
                      },
                    },
                    {
                      id: "2",
                      properties: {
                        email: "lead@prospect.example",
                        lifecyclestage: "lead",
                      },
                    },
                  ],
                  paging: { next: { after: "p2" } },
                },
              },
      ],
      [
        "GET",
        /^\/crm\/v3\/objects\/companies\?/,
        {
          json: {
            results: [
              {
                id: "9",
                properties: {
                  domain: "client.example",
                  lifecyclestage: "opportunity",
                },
              },
              { id: "10", properties: { domain: "gmail.com" } },
              { id: "11", properties: { domain: null } },
            ],
          },
        },
      ],
    ]);
    const client = createHubspotClient(TOKEN, crm.deps);
    const page = await client.pullPage({}, 10);
    expect(page).toEqual({
      entries: [
        { k: "email", v: "customer@client.example", f: true },
        { k: "email", v: "lead@prospect.example", f: false },
        { k: "domain", v: "client.example", f: true },
      ],
      seen: 6,
      next: null,
    });
    expect(crm.calls[0].path).toContain("limit=100");
    expect(crm.calls[0].path).toContain("properties=email%2Clifecyclestage");

    // With fewer pages per step, it stops and says where to carry on.
    const crm2 = fakeCrm([
      [
        "GET",
        /contacts\?/,
        { json: { results: [], paging: { next: { after: "zz" } } } },
      ],
    ]);
    expect(await createHubspotClient(TOKEN, crm2.deps).pullPage({}, 1)).toEqual(
      {
        entries: [],
        seen: 0,
        next: { phase: "contacts", after: "zz" },
      },
    );
  });
});
