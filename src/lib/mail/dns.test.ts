import { describe, expect, it } from "vitest";
import { checkDomain, type Resolver } from "./dns";

// The DNS check, with DNS faked: no lookup leaves this machine.

const NOW = () => new Date("2026-11-21T10:00:00Z");

function resolver(records: {
  txt?: Record<string, string[]>;
  mx?: Record<string, string[]>;
  cname?: Record<string, string[]>;
}): Resolver & { asked: string[] } {
  const asked: string[] = [];
  const notFound = () =>
    Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  return {
    asked,
    async txt(name) {
      asked.push(`txt ${name}`);
      const r = records.txt?.[name];
      if (!r) throw notFound();
      return r.map((v) => [v]);
    },
    async mx(name) {
      asked.push(`mx ${name}`);
      const r = records.mx?.[name];
      if (!r) throw notFound();
      return r.map((exchange, priority) => ({ exchange, priority }));
    },
    async cname(name) {
      asked.push(`cname ${name}`);
      const r = records.cname?.[name];
      if (!r) throw notFound();
      return r;
    },
  };
}

describe("a mailbox domain's DNS check", () => {
  it("passes a domain with SPF for its provider, a DKIM key, DMARC and MX", async () => {
    const r = resolver({
      txt: {
        "acme.example": ["v=spf1 include:_spf.google.com ~all", "other=1"],
        "_dmarc.acme.example": [
          "v=DMARC1; p=quarantine; rua=mailto:d@acme.example",
        ],
        "google._domainkey.acme.example": ["v=DKIM1; k=rsa; p=MIIBIjAN"],
      },
      mx: { "acme.example": ["aspmx.l.google.com"] },
    });
    const check = await checkDomain("sam@acme.example", "google", r, NOW);
    expect(check).toMatchObject({
      domain: "acme.example",
      managed: false,
      spf: { verdict: "ok" },
      dkim: { verdict: "ok", selector: "google" },
      dmarc: { verdict: "ok" },
      mx: { verdict: "ok", found: "aspmx.l.google.com" },
      checked_at: "2026-11-21T10:00:00.000Z",
    });
  });

  it("finds a Microsoft 365 key behind a CNAME, and says what to fix", async () => {
    const r = resolver({
      txt: {
        "acme.example": ["v=spf1 include:mailgun.org ~all", "v=spf1 -all"],
      },
      cname: {
        "selector1._domainkey.acme.example": [
          "selector1-acme._domainkey.acme.onmicrosoft.com",
        ],
      },
    });
    const check = await checkDomain("sam@acme.example", "microsoft", r, NOW);
    expect(check.dkim).toMatchObject({ verdict: "ok", selector: "selector1" });
    expect(check.spf.verdict).toBe("warn");
    expect(check.spf.fix).toMatch(/only one SPF record/);
    expect(check.dmarc.verdict).toBe("missing");
    expect(check.dmarc.fix).toMatch(/_dmarc/);
    expect(check.mx.verdict).toBe("missing");
  });

  it("asks for the provider's include when SPF doesn't name it, and warns about +all", async () => {
    const missingInclude = await checkDomain(
      "sam@acme.example",
      "google",
      resolver({
        txt: { "acme.example": ["v=spf1 include:other.example ~all"] },
      }),
      NOW,
    );
    expect(missingInclude.spf.fix).toContain("include:_spf.google.com");
    const plusAll = await checkDomain(
      "sam@acme.example",
      "other",
      resolver({ txt: { "acme.example": ["v=spf1 a mx +all"] } }),
      NOW,
    );
    expect(plusAll.spf.fix).toMatch(/\+all/);
    const none = await checkDomain(
      "sam@acme.example",
      "other",
      resolver({}),
      NOW,
    );
    expect(none.spf.verdict).toBe("missing");
    expect(none.dkim.verdict).toBe("missing");
    expect(none.dkim.fix).toMatch(/DKIM signing/);
  });

  it("doesn't look up a free mail domain: its DNS is the provider's", async () => {
    const r = resolver({});
    const check = await checkDomain("sam@gmail.com", "google", r, NOW);
    expect(check.managed).toBe(true);
    expect(r.asked).toEqual([]);
  });
});
