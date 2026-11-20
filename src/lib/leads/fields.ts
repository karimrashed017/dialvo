// How a lead's contact details are cleaned before they are stored, shared by
// the add-lead form, the CSV import and the public capture endpoint.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Lower-cased and trimmed, or null if it isn't an email address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

/**
 * Digits with an optional leading "+", or null if it isn't a phone number.
 * "(555) 010-1234" and "555.010.1234" become the same thing, so duplicates
 * are caught. No country is guessed: a number without one stays without.
 */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let raw = String(value).trim();
  if (!raw) return null;
  // An extension isn't part of the number we'd dial first.
  raw = raw.replace(/\s*(ext\.?|x)\s*\d+$/i, "");
  if (/[^\d+\s().\-/]/.test(raw)) return null;
  const plus = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 6 || digits.length > 15) return null;
  return `${plus ? "+" : ""}${digits}`;
}

/** Trimmed, with runs of whitespace collapsed, cut to a length. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Like cleanText, but keeps line breaks (for messages and notes). */
export function cleanLongText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
