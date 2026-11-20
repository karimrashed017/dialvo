import { describe, expect, it } from "vitest";
import { readAccounts, readAttended, readEventList, readSeeds } from "./lists";

describe("event lists", () => {
  it("reads names, emails, companies and who attended, by column name", () => {
    const list = readEventList(
      [
        "First name,Last name,Email Address,Company,Attended?",
        "Ann,Lee,ANN@Example.com,Ann Co,yes",
        "Ben,,ben@example.com,,no",
        "Cy,,not-an-email,,yes",
        "Ann,Lee,ann@example.com,Ann Co,yes",
      ].join("\n"),
    );
    expect(list).toEqual({
      ok: true,
      hasAttended: true,
      skipped: 2,
      rows: [
        {
          name: "Ann Lee",
          email: "ann@example.com",
          company: "Ann Co",
          attended: true,
        },
        { name: "Ben", email: "ben@example.com", company: "", attended: false },
      ],
    });
  });

  it("needs an email column, and strips markup from names", () => {
    expect(readEventList("Name\nAnn").ok).toBe(false);
    const list = readEventList(
      'Name,Email\n"<script>Ann</script>",a@b.example',
    );
    expect(list.ok && list.rows[0].name).toBe("script Ann /script");
  });

  it("refuses a list over the cap", () => {
    const rows = Array.from({ length: 2001 }, (_, i) => `p${i}@x.example`);
    const list = readEventList(["email", ...rows].join("\n"));
    expect(list.ok).toBe(false);
  });

  it("reads yes and no in the usual ways, and nothing else", () => {
    expect(readAttended("Yes")).toBe(true);
    expect(readAttended("no-show")).toBe(false);
    expect(readAttended("maybe")).toBeNull();
  });
});

describe("target accounts", () => {
  it("takes websites and names, one per line, once each", () => {
    const list = readAccounts(
      "acme.com\nhttps://www.acme.com/about\nContoso Ltd\n\nnorthwind.co.uk",
    );
    expect(list).toEqual({
      ok: true,
      skipped: 1,
      rows: [
        { input: "acme.com", domain: "acme.com", company_name: "" },
        { input: "Contoso Ltd", domain: null, company_name: "Contoso Ltd" },
        {
          input: "northwind.co.uk",
          domain: "northwind.co.uk",
          company_name: "",
        },
      ],
    });
  });

  it("reads a CSV with website and company columns", () => {
    const list = readAccounts("Company,Website\nAcme,acme.com\nContoso,");
    expect(list.ok && list.rows).toEqual([
      { input: "acme.com", domain: "acme.com", company_name: "Acme" },
      { input: "Contoso", domain: null, company_name: "Contoso" },
    ]);
  });

  it("refuses more than 200", () => {
    const text = Array.from(
      { length: 201 },
      (_, i) => `c${i}.example.com`,
    ).join("\n");
    expect(readAccounts(text).ok).toBe(false);
  });

  it("takes seed websites only, at most the cap", () => {
    expect(
      readSeeds(
        "acme.com, not a site, b.example.com c.example.com d.example.com",
        3,
      ),
    ).toEqual(["acme.com", "b.example.com", "c.example.com"]);
  });
});
