import { describe, expect, it, vi } from "vitest";
import { cleanToken, connectCrm } from "./connect";
import { isKnownToCrm } from "./known";
import type { CrmStore } from "./store";
import { fakeCrm } from "./testing/fake-fetch";

const TOKEN = "fake.token.for.connect.tests.only";

function store(status = "connected") {
  const connect = vi.fn(async () => ({ status, provider: "hubspot" as const }));
  const isKnown = vi.fn(async () => true);
  return { connect, isKnown, s: { connect, isKnown } as unknown as CrmStore };
}

const hubspotOk = () =>
  fakeCrm([
    [
      "POST",
      /access-token-info/,
      {
        json: {
          hubId: 7,
          scopes: [
            "crm.objects.contacts.read",
            "crm.objects.contacts.write",
            "crm.objects.companies.read",
            "crm.objects.companies.write",
          ],
        },
      },
    ],
    ["GET", /./, { json: { results: [] } }],
  ]);

describe("connecting a CRM", () => {
  it("refuses what doesn't look like a token before asking the CRM", async () => {
    const crm = fakeCrm([]);
    const { s, connect } = store();
    for (const token of [
      "",
      "short",
      "has spaces in it here",
      "<script>x</script>",
    ]) {
      const r = await connectCrm(
        { workspaceId: "w", userId: "u", provider: "hubspot", token },
        { store: s, http: crm.deps },
      );
      expect(r).toMatchObject({ ok: false, field: "token" });
    }
    expect(crm.calls).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
    expect(cleanToken(`  Bearer ${TOKEN} `)).toBe(TOKEN);
  });

  it("stores a token only after the CRM accepted it, and never returns it", async () => {
    const { s, connect } = store();
    const r = await connectCrm(
      { workspaceId: "w", userId: "u", provider: "hubspot", token: TOKEN },
      { store: s, http: hubspotOk().deps },
    );
    expect(r).toEqual({ ok: true, label: "HubSpot account 7" });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "w",
        userId: "u",
        provider: "hubspot",
        token: TOKEN,
        canDeals: false,
      }),
    );
  });

  it("doesn't store a token the CRM refused", async () => {
    const { s, connect } = store();
    const crm = fakeCrm([
      ["POST", /./, { status: 401, json: {} }],
      ["GET", /./, { status: 401, json: {} }],
    ]);
    const r = await connectCrm(
      { workspaceId: "w", userId: "u", provider: "hubspot", token: TOKEN },
      { store: s, http: crm.deps },
    );
    expect(r.ok).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it("explains one CRM per workspace, and admins only", async () => {
    const other = await connectCrm(
      { workspaceId: "w", userId: "u", provider: "hubspot", token: TOKEN },
      { store: store("other_connected").s, http: hubspotOk().deps },
    );
    expect(other).toMatchObject({ ok: false });
    expect(!other.ok && other.message).toMatch(/Disconnect it first/);
    const notAdmin = await connectCrm(
      { workspaceId: "w", userId: "u", provider: "hubspot", token: TOKEN },
      { store: store("not_found").s, http: hubspotOk().deps },
    );
    expect(!notAdmin.ok && notAdmin.message).toMatch(/owner or an admin/);
  });

  it("checks a Pipedrive company domain before using it in an address", async () => {
    const crm = fakeCrm([]);
    const r = await connectCrm(
      {
        workspaceId: "w",
        userId: "u",
        provider: "pipedrive",
        token: TOKEN,
        domain: "evil.example/x?",
      },
      { store: store().s, http: crm.deps },
    );
    expect(r).toMatchObject({ ok: false, field: "domain" });
    expect(crm.calls).toEqual([]);
  });

  it("refuses an unknown CRM", async () => {
    expect(
      await connectCrm(
        { workspaceId: "w", userId: "u", provider: "salesforce", token: TOKEN },
        { store: store().s, http: fakeCrm([]).deps },
      ),
    ).toMatchObject({ ok: false });
  });
});

describe("isKnownToCrm", () => {
  it("asks the database with lower-cased values", async () => {
    const { s, isKnown } = store();
    expect(await isKnownToCrm("w", { email: " Ada@Example.COM " }, s)).toBe(
      true,
    );
    expect(isKnown).toHaveBeenCalledWith("w", "ada@example.com", null);
  });

  it("is false with no secret key on the server, or nothing to ask about", async () => {
    expect(await isKnownToCrm("w", { email: "a@b.example" }, null)).toBe(false);
    const { s, isKnown } = store();
    expect(await isKnownToCrm("w", {}, s)).toBe(false);
    expect(isKnown).not.toHaveBeenCalled();
  });
});
