import { describe, expect, it, vi } from "vitest";
import { checkG2Token, G2Problem, g2Url, pullG2, readG2Page } from "./g2";
import { readIntentBody, readIntentCsv } from "./rows";

describe("intent rows", () => {
  it("read a CSV by column names, in any order", () => {
    const csv =
      "﻿Visit Date,Company Name,Company Domain,Visit Type,Product Name,Total Activity\n2026-11-19,Acme,acme.com,pricing,CRM,4\n2026-11-19,No site,,profile,,1\n";
    const r = readIntentCsv(csv, 10);
    expect(r).toEqual({
      ok: true,
      skipped: 1,
      rows: [
        {
          provider: "other",
          company_name: "Acme",
          company_domain: "acme.com",
          company_country: "",
          company_size: "",
          company_industry: "",
          signal_type: "pricing",
          topic: "CRM",
          activity: 4,
          seen_on: "2026-11-19",
        },
      ],
    });
    expect(readIntentCsv("name,email\nA,a@b.c\n", 10).ok).toBe(false);
    expect(readIntentCsv("domain\na.com\nb.com\nc.com\n", 2).ok).toBe(false);
  });

  it("read a webhook body", () => {
    expect(
      readIntentBody({ signals: [{ company_domain: "a.com" }, "x"] }, 10),
    ).toMatchObject({ ok: true, skipped: 1 });
    expect(readIntentBody({ nope: [] }, 10).ok).toBe(false);
    expect(readIntentBody(new Array(11).fill({ domain: "a.com" }), 10).ok).toBe(
      false,
    );
  });
});

describe("G2", () => {
  it("asks for the day's buyer intent and follows G2's own cursor only", () => {
    const url = new URL(g2Url("2026-11-20", "abc"));
    expect(url.origin).toBe("https://data.g2.com");
    expect(url.pathname).toBe("/api/v2/buyer_intent");
    expect(url.searchParams.get("dimension_filters[day_gteq]")).toBe(
      "2026-11-20",
    );
    expect(url.searchParams.get("page[after]")).toBe("abc");
    const page = readG2Page({
      data: [
        {
          attributes: {
            company_name: "Acme",
            company_domain: "acme.com",
            signal_type: "compare",
            left_product_name: "Rival",
            day: "2026-11-20",
            total_activity: 3,
          },
        },
      ],
      links: {
        next: "https://data.g2.com/api/v2/buyer_intent?page%5Bafter%5D=next1",
      },
    });
    expect(page.next).toBe("next1");
    expect(page.rows[0]).toMatchObject({
      provider: "g2",
      company_domain: "acme.com",
      topic: "Rival",
      seen_on: "2026-11-20",
      activity: 3,
    });
    expect(
      readG2Page({
        data: [],
        links: { next: "https://evil.example/?page%5Bafter%5D=x" },
      }).next,
    ).toBe(null);
  });

  it("sends the token as a bearer and says what G2's refusals mean", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(
      checkG2Token("tok-123456789", fetcher as unknown as typeof fetch),
    ).rejects.toMatchObject({ kind: "not_included" });
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect((call[1].headers as Record<string, string>).authorization).toBe(
      "Bearer tok-123456789",
    );
    const revoked = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(
      pullG2("t", "2026-11-20", 2, revoked as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(G2Problem);
  });

  it("reads pages until there is no next one", async () => {
    const pages = [
      {
        data: [{ attributes: { company_domain: "a.com", day: "2026-11-20" } }],
        links: { next: "https://data.g2.com/x?page%5Bafter%5D=2" },
      },
      {
        data: [{ attributes: { company_domain: "b.com", day: "2026-11-20" } }],
        links: { next: null },
      },
    ];
    let i = 0;
    const fetcher = vi.fn(async () => Response.json(pages[i++]));
    const rows = await pullG2(
      "t",
      "2026-11-20",
      5,
      fetcher as unknown as typeof fetch,
    );
    expect(rows.map((r) => r.company_domain)).toEqual(["a.com", "b.com"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
