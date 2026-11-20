import { describe, expect, it, vi } from "vitest";
import { advanceCampaignRun } from "./campaign-run";
import { fakeFindymail, fakePlayStore } from "./testing";

const input = { runId: "r1", workspaceId: "w1" };
const campaign = (kind: "accounts" | "lookalike", settings = {}) => ({
  id: "c1",
  kind,
  settings,
});

describe("a target-account run", () => {
  it("isn't one when the database says so: the usual step runs", async () => {
    const store = fakePlayStore();
    expect(
      await advanceCampaignRun(input, { store, findymail: fakeFindymail() }),
    ).toBeNull();
  });

  it("finds a person, then their email, reserving 2 credits and spending 2", async () => {
    const store = fakePlayStore({
      claimCampaign: vi.fn(async () => ({
        status: "targets" as const,
        campaign: campaign("accounts", { titles: ["CEO"] }),
        work: [
          {
            id: "t1",
            input: "acme.com",
            domain: "acme.com",
            company_name: "Acme",
          },
        ],
      })),
    });
    const findymail = fakeFindymail({
      employees: vi.fn(async () => ({
        ok: true as const,
        value: [{ name: "Dana Lee", title: "CEO", linkedin: null }],
      })),
      email: vi.fn(async () => ({ ok: true as const, value: "dana@acme.com" })),
    });
    expect(await advanceCampaignRun(input, { store, findymail })).toEqual({
      status: "searching",
    });
    expect(store.credits).toHaveBeenCalledWith("r1", "w1", "t1", 2);
    expect(store.credits).toHaveBeenCalledTimes(1); // nothing to give back
    expect(findymail.employees).toHaveBeenCalledWith("acme.com", ["CEO"]);
    expect(store.saveTarget).toHaveBeenCalledWith("r1", "w1", "t1", {
      status: "found",
      contact_name: "Dana Lee",
      contact_role: "CEO",
      email: "dana@acme.com",
      linkedin_url: null,
      company_name: "Acme",
    });
    expect(store.releaseCampaign).toHaveBeenCalled();
  });

  it("never guesses: no email found is 'no contact', and the unspent credit goes back", async () => {
    const store = fakePlayStore({
      claimCampaign: vi.fn(async () => ({
        status: "targets" as const,
        campaign: campaign("accounts"),
        work: [
          { id: "t1", input: "acme.com", domain: "acme.com", company_name: "" },
        ],
      })),
    });
    const findymail = fakeFindymail({
      employees: vi.fn(async () => ({
        ok: true as const,
        value: [{ name: "Dana Lee", title: "CEO", linkedin: null }],
      })),
    });
    await advanceCampaignRun(input, { store, findymail });
    expect(store.saveTarget).toHaveBeenCalledWith("r1", "w1", "t1", {
      status: "no_contact",
      reason: "no_email",
    });
    expect(store.credits).toHaveBeenLastCalledWith("r1", "w1", "t1", -1);
  });

  it("skips a company the workspace already has before spending on a person", async () => {
    const store = fakePlayStore({
      claimCampaign: vi.fn(async () => ({
        status: "targets" as const,
        campaign: campaign("accounts"),
        work: [{ id: "t1", input: "Acme", domain: null, company_name: "Acme" }],
      })),
      resolveTarget: vi.fn(async () => "skipped" as const),
    });
    const findymail = fakeFindymail({
      company: vi.fn(async () => ({
        ok: true as const,
        value: { domain: "acme.com", name: "Acme" },
      })),
    });
    await advanceCampaignRun(input, { store, findymail });
    expect(store.credits).toHaveBeenCalledWith("r1", "w1", "t1", 3);
    expect(store.credits).toHaveBeenLastCalledWith("r1", "w1", "t1", -2);
    expect(findymail.employees).not.toHaveBeenCalled();
  });

  it("stops looking up at the day's credit cap, and still reads what was found", async () => {
    const store = fakePlayStore({
      claimCampaign: vi.fn(async () => ({
        status: "targets" as const,
        campaign: campaign("accounts"),
        work: [
          { id: "t1", input: "acme.com", domain: "acme.com", company_name: "" },
        ],
      })),
      credits: vi.fn(async () => false),
    });
    const findymail = fakeFindymail();
    expect(await advanceCampaignRun(input, { store, findymail })).toEqual({
      status: "researching",
      stop_reason: "contact_daily_limit",
    });
    expect(store.saveTarget).toHaveBeenCalledWith("r1", "w1", "t1", {
      status: "retry",
    });
    expect(store.wrapCampaign).toHaveBeenCalledWith(
      "r1",
      "w1",
      "contact_daily_limit",
    );
    expect(findymail.employees).not.toHaveBeenCalled();
  });

  it("ends the lookups when Findymail refuses the key or has no credits", async () => {
    const store = fakePlayStore({
      claimCampaign: vi.fn(async () => ({
        status: "targets" as const,
        campaign: campaign("accounts"),
        work: [
          { id: "t1", input: "acme.com", domain: "acme.com", company_name: "" },
        ],
      })),
    });
    const findymail = fakeFindymail({
      employees: vi.fn(async () => ({
        ok: false as const,
        problem: "no_credits" as const,
      })),
    });
    const r = await advanceCampaignRun(input, { store, findymail });
    expect(r?.stop_reason).toBe("contact_no_credits");
    expect(store.credits).toHaveBeenLastCalledWith("r1", "w1", "t1", -2);
  });
});

describe("a lookalike run", () => {
  it("looks up the seeds once, reserving credits per 10 companies and giving back the rest", async () => {
    const store = fakePlayStore({
      claimCampaign: vi.fn(async () => ({
        status: "seeds" as const,
        campaign: campaign("lookalike", {
          seeds: ["acme.com"],
          same_country: true,
        }),
        have: 0,
      })),
    });
    const findymail = fakeFindymail({
      lookalike: vi.fn(async () => ({
        ok: true as const,
        value: {
          companies: [
            {
              domain: "b.example.com",
              company_name: "B",
              size_range: "",
              country: "",
            },
          ],
          credits: 1,
        },
      })),
    });
    await advanceCampaignRun(input, { store, findymail });
    expect(store.credits).toHaveBeenNthCalledWith(1, "r1", "w1", null, 3);
    expect(store.credits).toHaveBeenNthCalledWith(2, "r1", "w1", null, -2);
    expect(findymail.lookalike).toHaveBeenCalledWith("acme.com", {
      sameCountry: true,
      sameSize: false,
      limit: 25,
    });
    expect(store.addLookalikes).toHaveBeenCalledWith("r1", "w1", [
      {
        domain: "b.example.com",
        company_name: "B",
        size_range: "",
        country: "",
      },
    ]);
  });
});
