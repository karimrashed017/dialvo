import { describe, expect, it, vi } from "vitest";
import {
  createPlaysFindymail,
  monitorBody,
  readEmployees,
  readFoundEmail,
  readLookalike,
  readSignal,
  readTechnology,
} from "./findymail";

type Call = { url: string; init: RequestInit };

function fetcher(...answers: { status?: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers.shift() ?? { status: 500 };
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), {
      status: a.status ?? 200,
    });
  });
  return { fn, calls };
}

describe("what Findymail sends back is checked", () => {
  it("lookalike: company sites only, once each, capped", () => {
    expect(
      readLookalike(
        {
          companies: [
            {
              domain: "Notion.so",
              name: "Notion",
              company_size: "501-1000",
              country: "United States",
            },
            { domain: "notion.so", name: "Again" },
            { domain: "linkedin.com", name: "Not a company site" },
            { domain: "<script>", name: "x" },
            { domain: "airtable.com", name: "Airtable" },
          ],
          credits_used: 1,
        },
        10,
      ),
    ).toEqual({
      companies: [
        {
          domain: "notion.so",
          company_name: "Notion",
          size_range: "501-1000",
          country: "United States",
        },
        {
          domain: "airtable.com",
          company_name: "Airtable",
          size_range: "",
          country: "",
        },
      ],
      credits: 1,
    });
    expect(readLookalike({ nope: 1 }, 10)).toBeNull();
  });

  it("employees: a real-looking name, never an address posing as one", () => {
    expect(
      readEmployees([
        {
          name: "Dana Lee",
          jobTitle: "CEO",
          linkedinUrl: "https://www.linkedin.com/in/dana",
        },
        { name: "admin@acme.com", jobTitle: "CEO" },
        { name: "Sam", linkedinUrl: "javascript:alert(1)" },
      ]),
    ).toEqual([
      {
        name: "Dana Lee",
        title: "CEO",
        linkedin: "https://www.linkedin.com/in/dana",
      },
      { name: "Sam", title: "", linkedin: null },
    ]);
  });

  it("an email is kept only at the company's own domain, and not a shared inbox", () => {
    expect(
      readFoundEmail({ contact: { email: "Dana@Acme.com" } }, "acme.com"),
    ).toBe("dana@acme.com");
    expect(
      readFoundEmail({ contact: { email: "dana@other.com" } }, "acme.com"),
    ).toBeNull();
    expect(
      readFoundEmail({ contact: { email: "info@acme.com" } }, "acme.com"),
    ).toBeNull();
    expect(readFoundEmail({}, "acme.com")).toBeNull();
  });

  it("a technology counts only when it is the one named", () => {
    expect(
      readTechnology(
        {
          technologies: [
            { name: "Rivalsoft", last_detected_at: "2026-03-15T10:00:00Z" },
          ],
        },
        "rivalsoft",
      ),
    ).toEqual({ found: true, detected: "2026-03-15", label: "Rivalsoft" });
    expect(
      readTechnology({ technologies: [{ name: "Other" }] }, "Rivalsoft")?.found,
    ).toBe(false);
  });

  it("a signal becomes one plain sentence from its own fields", () => {
    const s = readSignal({
      id: 12,
      type: "keyword_mention",
      payload: {
        matched_keyword: "hiring",
        snippet: "We are hiring <b>SDRs</b>",
      },
      detected_at: "2026-11-19T12:00:00+00:00",
      contact: {
        name: "Dana Lee",
        job_title: "CEO",
        linkedin_url: "https://www.linkedin.com/in/dana",
      },
      company: {
        name: "Acme",
        domain: "acme.com",
        employee_count_range: "51-200",
        country: "GB",
      },
      monitors: [{ relevance_score: 4 }],
    });
    expect(s).toMatchObject({
      external_id: "12",
      summary: 'Dana Lee (CEO) at Acme posted about "hiring" on 2026-11-19',
      snippet: "We are hiring b SDRs /b",
      company_domain: "acme.com",
      relevance_score: 4,
    });
    expect(readSignal({ id: "bad id!" })).toBeNull();
  });

  it("a monitor never asks for enrichment, and only sends what its type takes", () => {
    const body = monitorBody({
      name: "Hiring",
      signal_type: "keyword_mention",
      keywords: ["hiring"],
      countries: ["GB"],
      employee_count_ranges: [],
      target_companies: ["acme.com"],
      max_matches: 100,
    });
    expect(body).toEqual({
      name: "Hiring",
      signal_type: "keyword_mention",
      keywords: ["hiring"],
      icp_filters: { countries: ["GB"] },
      max_matches: 100,
      is_shared: false,
    });
  });
});

describe("the client", () => {
  it("sends the key only to Findymail, and turns statuses into plain problems", async () => {
    const { fn, calls } = fetcher(
      { body: { companies: [{ domain: "a.example.com" }], credits_used: 1 } },
      { status: 402, body: { error: "insufficient_credits" } },
      { status: 404, body: { message: "Not Found" } },
      { status: 429, body: { retry_after: 30 } },
    );
    const fm = createPlaysFindymail("test-key", fn)!;
    const look = await fm.lookalike("seed.example.com", {
      sameCountry: true,
      sameSize: false,
      limit: 25,
    });
    expect(look.ok && look.value.companies).toHaveLength(1);
    expect(calls[0].url).toBe("https://app.findymail.com/api/lookalike/search");
    expect(
      (calls[0].init.headers as Record<string, string>).authorization,
    ).toBe("Bearer test-key");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      seed: "seed.example.com",
      same_country: true,
      same_size: false,
      limit: 25,
    });
    expect(await fm.employees("acme.com", ["CEO"])).toEqual({
      ok: false,
      problem: "no_credits",
    });
    expect(await fm.company("Nobody Ltd")).toEqual({ ok: true, value: null });
    expect(await fm.email("Dana Lee", "acme.com")).toMatchObject({
      ok: false,
      problem: "rate_limited",
      retryAfter: 30,
    });
    expect(createPlaysFindymail("", fn)).toBeNull();
  });

  it("treats an empty answer to a delete as done", async () => {
    const { fn, calls } = fetcher({ status: 204 });
    const fm = createPlaysFindymail("k", fn)!;
    expect(await fm.deleteMonitor(7)).toEqual({ ok: true, value: true });
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url).toBe(
      "https://app.findymail.com/api/signals/monitors/7",
    );
  });
});
