import { LEAD_STATUSES, type LeadStatus } from "@/lib/app/types";
import { cleanText, normalizeEmail, normalizePhone } from "./fields";

// CSV import, in three steps that can each be tested on their own:
//   parseCsv      text -> rows of cells
//   guessMapping  header row -> which column is which lead field
//   mapRows       rows + mapping -> clean leads, and what was wrong with the rest
//   dedupe        drops leads already in the file or already in the workspace
// Nothing here touches the network or the database, so the same code runs in
// the browser (for the preview) and on the server (which never trusts the
// preview and does it all again).

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 1_000_000;

/** RFC 4180: quoted cells, doubled quotes, commas and line breaks in quotes. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  // Semicolons are what spreadsheets export in much of Europe.
  const firstLine = src.slice(0, src.search(/\r|\n|$/));
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : firstLine.includes("\t") && !firstLine.includes(",")
        ? "\t"
        : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Blank lines aren't rows.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export const IMPORT_FIELDS = [
  "name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "company",
  "website",
  "status",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  website: "Website",
  status: "Status",
};

/** Column index -> field. Columns left out are ignored. */
export type Mapping = Partial<Record<number, ImportField>>;

const HEADER_HINTS: [ImportField, RegExp][] = [
  ["first_name", /^(first|given)(name)?$|^fname$/],
  ["last_name", /^(last|family|sur)(name)?$|^lname$/],
  ["email", /e?mail/],
  ["phone", /phone|mobile|cell|tel|whatsapp/],
  ["company", /company|organi[sz]ation|business|account|employer/],
  ["website", /website|url|domain|web|site/],
  ["status", /^(lead)?(status|stage)$/],
  ["name", /^(full|lead|contact)?name$|^contact$|^lead$/],
];

/** Reads the header row and proposes a mapping; each field is used once. */
export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<ImportField>();
  headers.forEach((header, index) => {
    const key = header.toLowerCase().replace(/[^a-z]/g, "");
    if (!key) return;
    for (const [field, pattern] of HEADER_HINTS) {
      if (used.has(field) || !pattern.test(key)) continue;
      mapping[index] = field;
      used.add(field);
      return;
    }
  });
  return mapping;
}

export type ImportLead = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  status: LeadStatus;
};

export type RowProblem = { row: number; problem: string };

const STATUS_WORDS: Record<string, LeadStatus> = Object.fromEntries([
  ...LEAD_STATUSES.map((s) => [s.replace(/_/g, ""), s]),
  ["booked", "meeting_booked"],
  ["meeting", "meeting_booked"],
  ["closedwon", "won"],
  ["customer", "won"],
  ["closedlost", "lost"],
  ["contacted", "engaged"],
  ["optedout", "unsubscribed"],
]);

/**
 * Turns data rows (no header) into leads. A row needs an email or a phone
 * number that parses; a bad email with a good phone keeps the row and drops
 * the email, and says so. `row` in a problem is the line in the file,
 * counting the header as 1.
 */
export function mapRows(
  rows: string[][],
  mapping: Mapping,
): { leads: (ImportLead & { row: number })[]; problems: RowProblem[] } {
  const leads: (ImportLead & { row: number })[] = [];
  const problems: RowProblem[] = [];
  const columns = Object.entries(mapping) as [string, ImportField][];
  rows.forEach((cells, i) => {
    const row = i + 2;
    const raw: Partial<Record<ImportField, string>> = {};
    for (const [index, field] of columns)
      raw[field] = (cells[Number(index)] ?? "").trim();

    const email = normalizeEmail(raw.email);
    const phone = normalizePhone(raw.phone);
    if (raw.email && !email)
      problems.push({ row, problem: `"${raw.email}" isn't an email address` });
    if (raw.phone && !phone)
      problems.push({ row, problem: `"${raw.phone}" isn't a phone number` });
    if (!email && !phone) {
      if (!raw.email && !raw.phone)
        problems.push({ row, problem: "no email or phone number" });
      return;
    }
    const name =
      cleanText(raw.name, 200) ||
      cleanText(`${raw.first_name ?? ""} ${raw.last_name ?? ""}`, 200);
    const statusKey = (raw.status ?? "").toLowerCase().replace(/[^a-z]/g, "");
    leads.push({
      row,
      name,
      email,
      phone,
      company: cleanText(raw.company, 200) || null,
      website: cleanText(raw.website, 300) || null,
      status: STATUS_WORDS[statusKey] ?? "new",
    });
  });
  return { leads, problems };
}

/**
 * Keeps the first lead for each email address and each phone number, and
 * drops any that match a lead the workspace already has.
 */
export function dedupe<
  T extends { email: string | null; phone: string | null },
>(
  leads: T[],
  existing: { emails: Iterable<string>; phones: Iterable<string> },
): { fresh: T[]; inFile: T[]; inWorkspace: T[] } {
  const knownEmails = new Set(existing.emails);
  const knownPhones = new Set(existing.phones);
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const fresh: T[] = [];
  const inFile: T[] = [];
  const inWorkspace: T[] = [];
  for (const lead of leads) {
    if (
      (lead.email && knownEmails.has(lead.email)) ||
      (lead.phone && knownPhones.has(lead.phone))
    ) {
      inWorkspace.push(lead);
      continue;
    }
    if (
      (lead.email && seenEmails.has(lead.email)) ||
      (lead.phone && seenPhones.has(lead.phone))
    ) {
      inFile.push(lead);
      continue;
    }
    if (lead.email) seenEmails.add(lead.email);
    if (lead.phone) seenPhones.add(lead.phone);
    fresh.push(lead);
  }
  return { fresh, inFile, inWorkspace };
}
