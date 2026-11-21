import { createHash } from "node:crypto";

// The upload files ad platforms take for a customer list, built from an
// audience's rows. Pure but for the hash.
//
// Formats as the platforms document them (read 21 Nov 2026):
//   LinkedIn contact list   CSV, header row from LinkedIn's template:
//                           email,firstname,lastname,jobtitle,employeecompany,
//                           country,googleaid. Email may be SHA-256 hashed;
//                           it is the only column LinkedIn takes hashed.
//                           At least 300 rows to upload.
//   LinkedIn company list   companyname,companywebsite,companyemaildomain,
//                           linkedincompanypageurl,stocksymbol,industry,city,
//                           state,companycountry,zipcode. Plain text (company
//                           data isn't personal). At least 300 rows.
//   Meta customer list      email,phone,fn,ln,country. Every column may be
//                           SHA-256 hashed after normalising: lower case,
//                           trimmed; phone digits only with the country code;
//                           names without punctuation; country as its
//                           two-letter code.
//   Google Customer Match   Email,Phone,First Name,Last Name,Country,Zip (the
//                           combined template, headers exactly so). Email,
//                           Phone and names hashed with hex SHA-256 after
//                           normalising (gmail.com addresses without dots
//                           before the @, phone in E.164 with "+"); Country
//                           and Zip are never hashed.
// LinkedIn's minimum and the exact templates should be checked against each
// platform's own download before a first upload: they change.

export const FORMATS = {
  linkedin_contacts: {
    label: "LinkedIn contact list",
    kinds: ["contacts", "suppression"],
    hashable: true,
  },
  linkedin_companies: {
    label: "LinkedIn company list",
    kinds: ["companies"],
    hashable: false,
  },
  meta: {
    label: "Meta customer list",
    kinds: ["contacts", "suppression"],
    hashable: true,
  },
  google: {
    label: "Google Ads Customer Match",
    kinds: ["contacts", "suppression"],
    hashable: true,
  },
  plain: {
    label: "Plain CSV (for any tool)",
    kinds: ["contacts", "companies", "suppression"],
    hashable: false,
  },
} as const;
export type Format = keyof typeof FORMATS;
export const isFormat = (v: unknown): v is Format =>
  typeof v === "string" && Object.hasOwn(FORMATS, v);

export type ContactRow = {
  email: string | null;
  phone: string;
  name: string;
  company: string;
  title: string;
  country: string;
  domain: string;
};
export type CompanyRow = {
  company: string;
  domain: string;
  country: string;
  linkedin: string;
};

export const sha256 = (v: string) =>
  createHash("sha256").update(v, "utf8").digest("hex");

export function normalEmail(
  v: string | null | undefined,
  google = false,
): string {
  const e = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "";
  if (!google) return e;
  const [local, domain] = e.split("@");
  return domain === "gmail.com" || domain === "googlemail.com"
    ? `${local.replace(/\./g, "")}@${domain}`
    : e;
}

/** A phone in E.164 ("+447700900123"), or "" when its country code isn't written. */
export function e164(v: string | null | undefined): string {
  const raw = String(v ?? "").trim();
  const intl = raw.startsWith("+") || raw.startsWith("00");
  const digits = raw.replace(/\D/g, "").replace(/^00/, "");
  if (!intl || digits.length < 8 || digits.length > 15) return "";
  return `+${digits}`;
}

const COUNTRIES: Record<string, string> = {
  "united kingdom": "gb",
  uk: "gb",
  "great britain": "gb",
  england: "gb",
  scotland: "gb",
  wales: "gb",
  "united states": "us",
  usa: "us",
  "united states of america": "us",
  us: "us",
  ireland: "ie",
  germany: "de",
  france: "fr",
  spain: "es",
  italy: "it",
  netherlands: "nl",
  belgium: "be",
  portugal: "pt",
  sweden: "se",
  norway: "no",
  denmark: "dk",
  finland: "fi",
  switzerland: "ch",
  austria: "at",
  poland: "pl",
  canada: "ca",
  australia: "au",
  "new zealand": "nz",
  india: "in",
  singapore: "sg",
  japan: "jp",
  brazil: "br",
  mexico: "mx",
  "south africa": "za",
  "united arab emirates": "ae",
  israel: "il",
};

/** A country as its two-letter code in lower case, or "". */
export function countryCode(v: string | null | undefined): string {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  if (/^[a-z]{2}$/.test(s)) return s === "uk" ? "gb" : s;
  if (COUNTRIES[s]) return COUNTRIES[s];
  // "London, United Kingdom": the last part.
  const last = s.split(",").pop()!.trim();
  return COUNTRIES[last] ?? (/^[a-z]{2}$/.test(last) ? last : "");
}

/** A name for matching: lower case, letters (any script), spaces and hyphens. */
export function normalName(v: string): string {
  return v
    .normalize("NFC")
    .toLowerCase()
    .replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/, "")
    .replace(/[^\p{L}\p{M}\s-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitName(full: string): { first: string; last: string } {
  const clean = full.trim().replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "");
  if (!clean || /^website visitor$/i.test(clean))
    return { first: "", last: "" };
  const parts = clean.split(/\s+/);
  return {
    first: parts[0] ?? "",
    last: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

/** Text that can't start a spreadsheet formula. */
const safe = (v: string) =>
  v
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/^[=+@\t\r-]+/, "")
    .trim();

export function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const csv = (rows: string[][]) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export type Built = { filename: string; body: string; rows: number };

/** The file for a contact audience (or a suppression list). */
export function contactFile(
  format: Format,
  rows: ContactRow[],
  hashed: boolean,
  name: string,
): Built {
  const h = (v: string) => (hashed && v ? sha256(v) : v);
  const out: string[][] = [];
  let header: string[];
  for (const r of rows) {
    const { first, last } = splitName(r.name);
    switch (format) {
      case "linkedin_contacts": {
        const email = normalEmail(r.email);
        if (!email) continue;
        out.push([
          h(email),
          safe(first),
          safe(last),
          safe(r.title),
          safe(r.company),
          countryCode(r.country).toUpperCase(),
          "",
        ]);
        break;
      }
      case "meta": {
        const email = normalEmail(r.email);
        const phone = e164(r.phone).replace(/^\+/, "");
        if (!email && !phone) continue;
        out.push([
          h(email),
          h(phone),
          h(normalName(first)),
          h(normalName(last)),
          h(countryCode(r.country)),
        ]);
        break;
      }
      case "google": {
        const email = normalEmail(r.email, true);
        const phone = e164(r.phone);
        if (!email && !phone) continue;
        out.push([
          h(email),
          h(phone),
          h(normalName(first)),
          h(normalName(last)),
          countryCode(r.country).toUpperCase(),
          "",
        ]);
        break;
      }
      default: {
        out.push([
          safe(r.name),
          normalEmail(r.email),
          e164(r.phone) || safe(r.phone),
          safe(r.company),
          safe(r.title),
          safe(r.country),
        ]);
      }
    }
  }
  switch (format) {
    case "linkedin_contacts":
      header = [
        "email",
        "firstname",
        "lastname",
        "jobtitle",
        "employeecompany",
        "country",
        "googleaid",
      ];
      break;
    case "meta":
      header = ["email", "phone", "fn", "ln", "country"];
      break;
    case "google":
      header = ["Email", "Phone", "First Name", "Last Name", "Country", "Zip"];
      break;
    default:
      header = ["name", "email", "phone", "company", "title", "country"];
  }
  return {
    filename: fileName(name, format, hashed),
    body: csv([header, ...out]),
    rows: out.length,
  };
}

/** The file for a company audience. */
export function companyFile(
  format: Format,
  rows: CompanyRow[],
  name: string,
): Built {
  const out: string[][] = [];
  for (const r of rows) {
    if (!r.domain) continue;
    if (format === "linkedin_companies")
      out.push([
        safe(r.company),
        `https://${r.domain}`,
        r.domain,
        /^https:\/\/([a-z]+\.)?linkedin\.com\/company\//i.test(r.linkedin)
          ? r.linkedin
          : "",
        "",
        "",
        "",
        "",
        countryCode(r.country).toUpperCase(),
        "",
      ]);
    else out.push([safe(r.company), r.domain, safe(r.country)]);
  }
  const header =
    format === "linkedin_companies"
      ? [
          "companyname",
          "companywebsite",
          "companyemaildomain",
          "linkedincompanypageurl",
          "stocksymbol",
          "industry",
          "city",
          "state",
          "companycountry",
          "zipcode",
        ]
      : ["company", "domain", "country"];
  return {
    filename: fileName(name, format, false),
    body: csv([header, ...out]),
    rows: out.length,
  };
}

function fileName(name: string, format: Format, hashed: boolean): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "audience";
  return `${slug}-${format.replace(/_/g, "-")}${hashed ? "-sha256" : ""}.csv`;
}
