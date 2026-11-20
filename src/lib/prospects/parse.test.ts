import { describe, expect, it } from "vitest";
import {
  readCandidates,
  readDraft,
  readResearch,
  readSuggestion,
} from "./parse";
import type { SitePage } from "./types";

describe("readCandidates", () => {
  it("reads the list, normalises domains and drops what isn't a company's own site", () => {
    const text = `I searched and found these.
<companies>
[
  {"name": "Acme Dental", "website": "https://www.acmedental.co.uk/contact"},
  {"name": "Acme again", "website": "acmedental.co.uk"},
  {"name": "On LinkedIn", "website": "https://www.linkedin.com/company/x"},
  {"name": "On a directory", "website": "https://yelp.com/biz/x"},
  {"name": "No site"},
  {"name": "Known", "website": "https://known.example"},
  "nonsense",
  {"name": "Bright Smiles", "website": "brightsmiles.example"}
]
</companies>`;
    expect(readCandidates(text, ["known.example"], 10)).toEqual([
      {
        domain: "acmedental.co.uk",
        website: "https://acmedental.co.uk/",
        company_name: "Acme Dental",
      },
      {
        domain: "brightsmiles.example",
        website: "https://brightsmiles.example/",
        company_name: "Bright Smiles",
      },
    ]);
  });
  it("stops at the number asked for", () => {
    const list = JSON.stringify(
      Array.from({ length: 9 }, (_, i) => ({
        name: `C${i}`,
        website: `c${i}.example`,
      })),
    );
    expect(
      readCandidates(`<companies>${list}</companies>`, [], 3),
    ).toHaveLength(3);
  });
  it("gives nothing for an answer with no list, or a broken one", () => {
    for (const text of [
      "",
      "I couldn't find any.",
      "<companies>[{oops</companies>",
      "<companies>{}</companies>",
      "<companies>[]</companies>",
    ])
      expect(readCandidates(text, [], 5), text).toEqual([]);
  });
});

const pages: SitePage[] = [
  {
    url: "https://acme.example/",
    title: "Acme Anvils",
    text: "Acme Anvils. We have been making anvils in Leeds since 1950. Our founder Dana Smith still runs the forge.",
    emails: [],
    phones: [],
  },
  {
    url: "https://acme.example/contact",
    title: "Contact",
    text: "Contact us. Email hello@acme.example or dana@acme.example. Unit 4, Mill Lane, Leeds.",
    emails: [
      { email: "hello@acme.example", kind: "business", linked: true },
      { email: "dana@acme.example", kind: "business", linked: false },
    ],
    phones: ["+441130000000"],
  },
];

const report = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: "business",
    matches: true,
    company_name: "Acme Anvils",
    summary: "Makes anvils.",
    location: "Leeds, UK",
    contact_name: "Dana Smith",
    contact_role: "Founder",
    contact_source_url: "https://acme.example/",
    email: "dana@acme.example",
    facts: [
      {
        fact: "They have made anvils in Leeds since 1950.",
        quote: "making anvils in Leeds since 1950",
        source_url: "https://acme.example/",
      },
    ],
    ...extra,
  });

describe("readResearch", () => {
  it("keeps what the pages back up, with a source for each piece", () => {
    expect(readResearch(report(), pages, "acme")).toEqual({
      status: "found",
      company_name: "Acme Anvils",
      website: "https://acme.example/",
      summary: "Makes anvils.",
      location: "Leeds, UK",
      contact_name: "Dana Smith",
      contact_role: "Founder",
      contact_source_url: "https://acme.example/",
      email: "dana@acme.example",
      email_source_url: "https://acme.example/contact",
      email_kind: "business",
      phone: "+441130000000",
      phone_source_url: "https://acme.example/contact",
      facts: [
        {
          fact: "They have made anvils in Leeds since 1950.",
          quote: "making anvils in Leeds since 1950",
          source_url: "https://acme.example/",
        },
      ],
      pages: ["https://acme.example/", "https://acme.example/contact"],
    });
  });

  it("never accepts an email address the model wrote that the pages don't print", () => {
    for (const invented of [
      "dana.smith@acme.example",
      "sales@acme.example",
      "d.smith@gmail.com",
      "DANA@ACME.EXAMPLE.evil.com",
    ]) {
      const result = readResearch(report({ email: invented }), pages, "acme");
      // Falls back to an address that is on the page, never the invented one.
      expect(result).toMatchObject({
        email: "hello@acme.example",
        email_source_url: "https://acme.example/contact",
      });
    }
    // With no printed address at all there is no email, whatever the model says.
    const bare = pages.map((p) => ({ ...p, emails: [] }));
    expect(
      readResearch(report({ email: "dana@acme.example" }), bare, "acme"),
    ).toMatchObject({
      status: "found",
      email: "",
      email_source_url: "",
      email_kind: "",
    });
  });

  it("drops a contact whose name isn't on the site, with their role", () => {
    expect(
      readResearch(
        report({ contact_name: "Sam Jones", contact_role: "CEO" }),
        pages,
        "acme",
      ),
    ).toMatchObject({
      contact_name: "",
      contact_role: "",
      contact_source_url: "",
    });
    // A wrong page for a real name is corrected to the page it is on.
    expect(
      readResearch(
        report({ contact_source_url: "https://acme.example/contact" }),
        pages,
        "acme",
      ),
    ).toMatchObject({
      contact_name: "Dana Smith",
      contact_source_url: "https://acme.example/",
    });
  });

  it("drops facts without a real quote from a page we read, and keeps at most three", () => {
    const good = {
      fact: "Founder runs the forge.",
      quote: "Dana Smith  still runs the FORGE",
      source_url: "https://acme.example/",
    };
    const result = readResearch(
      report({
        facts: [
          {
            fact: "Won an award in 2023.",
            quote: "winner of the 2023 anvil award",
            source_url: "https://acme.example/",
          },
          {
            fact: "On another page.",
            quote: "making anvils in Leeds since 1950",
            source_url: "https://acme.example/contact",
          },
          {
            fact: "From elsewhere.",
            quote: "making anvils in Leeds since 1950",
            source_url: "https://news.example/acme",
          },
          {
            fact: "Too thin.",
            quote: "anvils",
            source_url: "https://acme.example/",
          },
          good,
          good,
          good,
          good,
        ],
      }),
      pages,
      "acme",
    );
    expect(result).toMatchObject({ status: "found" });
    const facts = (result as { facts: unknown[] }).facts;
    expect(facts).toHaveLength(3);
    expect(facts[0]).toEqual({
      ...good,
      quote: "Dana Smith still runs the FORGE",
    });
  });

  it("drops a location the pages never mention", () => {
    expect(
      readResearch(report({ location: "Manchester, UK" }), pages, "acme"),
    ).toMatchObject({ location: "" });
  });

  it("skips private individuals, non-companies and companies that don't match", () => {
    expect(readResearch(report({ kind: "individual" }), pages, "acme")).toEqual(
      {
        status: "skipped",
        reason: "not_a_business",
        company_name: "Acme Anvils",
      },
    );
    expect(
      readResearch(report({ kind: "unclear" }), pages, "acme"),
    ).toMatchObject({ reason: "not_a_business" });
    expect(
      readResearch(report({ kind: "not_a_company" }), pages, "acme"),
    ).toMatchObject({ reason: "not_a_business" });
    expect(
      readResearch(report({ matches: false }), pages, "acme"),
    ).toMatchObject({ status: "skipped", reason: "not_a_match" });
    expect(
      readResearch(report({ matches: "yes" }), pages, "acme"),
    ).toMatchObject({ reason: "not_a_match" });
  });

  it("refuses an answer that isn't the agreed shape", () => {
    for (const raw of [
      "",
      "not json",
      "[]",
      "null",
      JSON.stringify({ kind: "company" }),
    ])
      expect(readResearch(raw, pages, "acme"), raw).toBeNull();
  });
});

describe("readDraft", () => {
  const draft = (subject: string, body: string) =>
    readDraft(JSON.stringify({ subject, body }));
  it("accepts a short plain email and tidies its spacing", () => {
    expect(
      draft(
        " Anvils in Leeds ",
        "Hello,\r\n\r\n\r\nI read that you make anvils.   Worth a chat?\n\nErin\nWorkspace X",
      ),
    ).toEqual({
      ok: true,
      subject: "Anvils in Leeds",
      body: "Hello,\n\nI read that you make anvils. Worth a chat?\n\nErin\nWorkspace X",
    });
  });
  it("refuses what breaks the rules a person shouldn't have to catch", () => {
    expect(draft("Hi", "word ".repeat(161))).toEqual({
      ok: false,
      problem: "too_long",
    });
    expect(
      draft("Hi", 'Hello <img src="https://t.example/p.gif" width="1">'),
    ).toEqual({ ok: false, problem: "not_plain_text" });
    expect(draft("Hi", "See [our site](https://x.example)")).toEqual({
      ok: false,
      problem: "not_plain_text",
    });
    expect(draft("Hi", "Hi [First name], hello")).toEqual({
      ok: false,
      problem: "placeholder",
    });
    expect(draft("Hi", "Hi {{first_name}}")).toEqual({
      ok: false,
      problem: "placeholder",
    });
    expect(draft("Hi", "We increase bookings by 40% for clinics.")).toEqual({
      ok: false,
      problem: "result_claim",
    });
    expect(draft("Hi", "Results guaranteed.")).toEqual({
      ok: false,
      problem: "result_claim",
    });
    expect(draft("Hi", "Clients get 3x more leads.")).toEqual({
      ok: false,
      problem: "result_claim",
    });
    expect(draft("", "Hello")).toEqual({ ok: false, problem: "empty" });
    expect(readDraft("oops")).toEqual({ ok: false, problem: "unreadable" });
  });
});

describe("readSuggestion", () => {
  it("needs a description and trims the rest", () => {
    expect(
      readSuggestion(
        JSON.stringify({
          name: " Clinics ",
          description: "Dental\nclinics",
          location: "",
          company_size: 5,
          exclusions: "chains",
        }),
      ),
    ).toEqual({
      name: "Clinics",
      description: "Dental clinics",
      location: "",
      company_size: "",
      exclusions: "chains",
    });
    expect(readSuggestion(JSON.stringify({ description: "" }))).toBeNull();
    expect(readSuggestion("nope")).toBeNull();
  });
});
