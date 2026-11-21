import { parseCsv } from "@/lib/leads/csv";
import { cleanText } from "@/lib/leads/fields";

// A CSV as list rows: the known columns are recognised by their header, the
// rest are kept as extra fields. Pure; the database checks every row again.

export type ImportRow = {
  name: string;
  title: string;
  company: string;
  domain: string;
  email: string;
  linkedin_url: string;
  country: string;
  size_range: string;
  fields: Record<string, string>;
};

type Known = Exclude<keyof ImportRow, "fields"> | "first_name" | "last_name";

const HEADERS: [Known, RegExp][] = [
  ["first_name", /^(first ?name|given name|forename)$/],
  ["last_name", /^(last ?name|surname|family name)$/],
  ["name", /^(name|full ?name|contact( name)?|person)$/],
  ["title", /^(title|job ?title|role|position)$/],
  ["company", /^(company|company ?name|organi[sz]ation|account( name)?)$/],
  ["domain", /^(domain|website|web ?site|url|company (domain|website))$/],
  ["email", /^(e-?mail|email address|work email)$/],
  ["linkedin_url", /^(linkedin|linkedin ?url|linkedin profile)$/],
  ["country", /^(country|location|region)$/],
  ["size_range", /^(size|employees|company size|headcount|employee count)$/],
];

/** Which known field a header is, if any. */
export function headerField(header: string): Known | null {
  const h = header.trim().toLowerCase().replace(/[_-]+/g, " ");
  return HEADERS.find(([, re]) => re.test(h))?.[0] ?? null;
}

export const MAX_EXTRA_COLUMNS = 15;

export function csvToRows(
  text: string,
  maxRows: number,
): {
  rows: ImportRow[];
  columns: string[];
  extra: string[];
} {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (table.length === 0) return { rows: [], columns: [], extra: [] };
  const [header, ...body] = table;
  const map = header.map(headerField);
  const extra: { index: number; name: string }[] = [];
  header.forEach((h, index) => {
    const name = cleanText(h, 40);
    if (!map[index] && name && extra.length < MAX_EXTRA_COLUMNS)
      extra.push({ index, name });
  });
  const rows = body.slice(0, maxRows).map((cells) => {
    const get = (field: Known) => {
      const i = map.indexOf(field);
      return i >= 0 ? cleanText(cells[i] ?? "", 300) : "";
    };
    const name =
      get("name") ||
      [get("first_name"), get("last_name")].filter(Boolean).join(" ");
    const fields: Record<string, string> = {};
    for (const e of extra) {
      const v = cleanText(cells[e.index] ?? "", 200);
      if (v) fields[e.name] = v;
    }
    return {
      name: name.slice(0, 200),
      title: get("title").slice(0, 200),
      company: get("company").slice(0, 200),
      domain: get("domain"),
      email: get("email"),
      linkedin_url: get("linkedin_url"),
      country: get("country").slice(0, 80),
      size_range: get("size_range").slice(0, 40),
      fields,
    };
  });
  return {
    rows,
    columns: header.map((h) => cleanText(h, 40)),
    extra: extra.map((e) => e.name),
  };
}
