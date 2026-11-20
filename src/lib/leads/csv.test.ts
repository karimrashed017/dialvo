import { describe, expect, it } from "vitest";
import { dedupe, guessMapping, mapRows, parseCsv } from "./csv";
import { normalizeEmail, normalizePhone } from "./fields";

describe("parseCsv", () => {
  it("reads plain rows, with either line ending and a byte-order mark", () => {
    expect(
      parseCsv("﻿name,email\r\nAda,ada@example.com\nBob,bob@example.com"),
    ).toEqual([
      ["name", "email"],
      ["Ada", "ada@example.com"],
      ["Bob", "bob@example.com"],
    ]);
  });

  it("handles quotes: commas, line breaks and doubled quotes inside", () => {
    expect(
      parseCsv('name,note\n"Smith, Jane","said ""hi""\nthen left"\n'),
    ).toEqual([
      ["name", "note"],
      ["Smith, Jane", 'said "hi"\nthen left'],
    ]);
  });

  it("keeps empty cells and skips blank lines", () => {
    expect(parseCsv("a,b,c\n1,,3\n\n , \n4,5,\n")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
      ["4", "5", ""],
    ]);
  });

  it("reads semicolon and tab files", () => {
    expect(parseCsv("name;email\nAda;ada@example.com")).toEqual([
      ["name", "email"],
      ["Ada", "ada@example.com"],
    ]);
    expect(parseCsv("name\temail\nAda\tada@example.com")[1]).toEqual([
      "Ada",
      "ada@example.com",
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("guessMapping", () => {
  it("recognises the usual headers", () => {
    expect(
      guessMapping([
        "First Name",
        "Last Name",
        "E-mail Address",
        "Mobile Phone",
        "Company Name",
        "Website URL",
        "Lead Status",
        "Notes",
      ]),
    ).toEqual({
      0: "first_name",
      1: "last_name",
      2: "email",
      3: "phone",
      4: "company",
      5: "website",
      6: "status",
    });
    expect(guessMapping(["Name", "Email", "Phone"])).toEqual({
      0: "name",
      1: "email",
      2: "phone",
    });
  });

  it("uses each field once and ignores what it doesn't know", () => {
    expect(
      guessMapping(["Email", "Work email", "Favourite colour", ""]),
    ).toEqual({
      0: "email",
    });
  });
});

describe("mapRows", () => {
  const mapping = guessMapping([
    "First",
    "Last",
    "Email",
    "Phone",
    "Company",
    "Stage",
  ]);

  it("builds clean leads", () => {
    const { leads, problems } = mapRows(
      [
        [
          "Ada",
          "Lovelace",
          " ADA@Example.com ",
          "(555) 010-1234",
          "  Analytical   Engines ",
          "Qualified",
        ],
      ],
      mapping,
    );
    expect(problems).toEqual([]);
    expect(leads).toEqual([
      {
        row: 2,
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "5550101234",
        company: "Analytical Engines",
        website: null,
        status: "qualified",
      },
    ]);
  });

  it("needs an email or a phone, and says which line was wrong", () => {
    const { leads, problems } = mapRows(
      [
        ["No", "Contact", "", "", "", ""],
        ["Bad", "Email", "not-an-email", "", "", ""],
        ["Bad", "Email, good phone", "nope@", "+44 1632 960123", "", ""],
        ["Bad", "Phone", "ok@example.com", "call me", "", "nonsense"],
      ],
      mapping,
    );
    expect(leads.map((l) => [l.row, l.email, l.phone, l.status])).toEqual([
      [4, null, "+441632960123", "new"],
      [5, "ok@example.com", null, "new"],
    ]);
    expect(problems).toEqual([
      { row: 2, problem: "no email or phone number" },
      { row: 3, problem: '"not-an-email" isn\'t an email address' },
      { row: 4, problem: '"nope@" isn\'t an email address' },
      { row: 5, problem: '"call me" isn\'t a phone number' },
    ]);
  });

  it("prefers a full-name column, and copes with short rows", () => {
    const { leads } = mapRows(
      [["Grace Hopper", "grace@example.com"], ["", "x@example.com"], ["Short"]],
      {
        0: "name",
        1: "email",
      },
    );
    expect(leads.map((l) => l.name)).toEqual(["Grace Hopper", ""]);
  });

  it("understands status words from other tools", () => {
    const { leads } = mapRows(
      [
        ["a@example.com", "Closed Won"],
        ["b@example.com", "Meeting Booked"],
        ["c@example.com", "opted-out"],
      ],
      { 0: "email", 1: "status" },
    );
    expect(leads.map((l) => l.status)).toEqual([
      "won",
      "meeting_booked",
      "unsubscribed",
    ]);
  });
});

describe("dedupe", () => {
  const lead = (email: string | null, phone: string | null = null) => ({
    email,
    phone,
  });

  it("drops repeats in the file, by email or by phone", () => {
    const { fresh, inFile, inWorkspace } = dedupe(
      [
        lead("a@example.com", "5550001"),
        lead("a@example.com"),
        lead("b@example.com", "5550001"),
        lead(null, "5550002"),
        lead(null, "5550002"),
        lead("c@example.com"),
      ],
      { emails: [], phones: [] },
    );
    expect(fresh).toEqual([
      lead("a@example.com", "5550001"),
      lead(null, "5550002"),
      lead("c@example.com"),
    ]);
    expect(inFile.length).toBe(3);
    expect(inWorkspace).toEqual([]);
  });

  it("drops leads the workspace already has", () => {
    const { fresh, inWorkspace } = dedupe(
      [
        lead("known@example.com"),
        lead("new@example.com", "5550009"),
        lead("other@example.com", "5550003"),
      ],
      { emails: ["known@example.com"], phones: ["5550003"] },
    );
    expect(fresh).toEqual([lead("new@example.com", "5550009")]);
    expect(inWorkspace.length).toBe(2);
  });
});

describe("normalizing", () => {
  it("emails", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    for (const bad of ["", "a", "a@b", "a b@c.com", "@c.com", null, 5, "a@b.c"])
      expect(normalizeEmail(bad), String(bad)).toBeNull();
  });

  it("phones", () => {
    expect(normalizePhone("(555) 010-1234")).toBe("5550101234");
    expect(normalizePhone("555.010.1234")).toBe("5550101234");
    expect(normalizePhone("+44 (0)1632 960123")).toBe("+4401632960123");
    expect(normalizePhone("0044 1632 960123")).toBe("+441632960123");
    expect(normalizePhone("555 010 1234 ext. 22")).toBe("5550101234");
    expect(normalizePhone(5550101234)).toBe("5550101234");
    for (const bad of [
      "",
      "12345",
      "call me",
      "1234567890123456",
      "555-CALL-NOW",
      null,
    ])
      expect(normalizePhone(bad), String(bad)).toBeNull();
  });
});
