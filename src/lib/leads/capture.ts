import { CONSENT_CHANNELS, type ConsentChannel } from "@/lib/app/types";
import {
  cleanLongText,
  cleanText,
  normalizeEmail,
  normalizePhone,
} from "./fields";

// What the public lead form may send, checked before anything is written.
// The same fields work as JSON or as an ordinary HTML form post.

export const MAX_CAPTURE_BYTES = 20_000;

/** A field bots fill in and people never see. */
export const HONEYPOT = "_hp";

export type CapturedLead = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  message: string | null;
  /** Only the channels the payload mentioned. Absent means "not asked". */
  consent: Partial<Record<ConsentChannel, boolean>>;
};

export type CaptureResult =
  | { ok: true; bot: boolean; lead: CapturedLead }
  | { ok: false; field: string; problem: string };

const YES = new Set(["true", "1", "on", "yes", "y", "checked"]);
const NO = new Set(["false", "0", "off", "no", "n", ""]);

/** true / false for a recognisable answer, undefined for anything else. */
function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number")
    return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== "string") return undefined;
  const word = value.trim().toLowerCase();
  if (YES.has(word)) return true;
  if (NO.has(word)) return false;
  return undefined;
}

export function parseCapture(input: unknown): CaptureResult {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, field: "body", problem: "Send the form's fields." };
  const raw = input as Record<string, unknown>;

  for (const [key, max] of [
    ["name", 200],
    ["first_name", 100],
    ["last_name", 100],
    ["email", 254],
    ["phone", 40],
    ["company", 200],
    ["website", 300],
    ["message", 5000],
  ] as const) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" && typeof value !== "number")
      return { ok: false, field: key, problem: `${key} must be text.` };
    if (String(value).length > max)
      return { ok: false, field: key, problem: `${key} is too long.` };
  }

  const hasEmail = cleanText(raw.email, 254) !== "";
  const hasPhone = cleanText(raw.phone, 40) !== "";
  const email = normalizeEmail(raw.email);
  const phone = normalizePhone(raw.phone);
  if (hasEmail && !email)
    return {
      ok: false,
      field: "email",
      problem: "That email doesn't look right.",
    };
  if (hasPhone && !phone)
    return {
      ok: false,
      field: "phone",
      problem: "That phone number doesn't look right.",
    };
  if (!email && !phone)
    return {
      ok: false,
      field: "email",
      problem: "Add an email or a phone number.",
    };

  // Consent is recorded only for channels the form actually asked about:
  // `consent_call=true` style fields, or a `consent` object.
  const consent: CapturedLead["consent"] = {};
  const nested =
    raw.consent &&
    typeof raw.consent === "object" &&
    !Array.isArray(raw.consent)
      ? (raw.consent as Record<string, unknown>)
      : {};
  for (const channel of CONSENT_CHANNELS) {
    const given = raw[`consent_${channel}`] ?? nested[channel];
    if (given === undefined || given === null) continue;
    const answer = asBoolean(given);
    if (answer === undefined)
      return {
        ok: false,
        field: `consent_${channel}`,
        problem: `consent_${channel} must be true or false.`,
      };
    consent[channel] = answer;
  }

  return {
    ok: true,
    bot: cleanText(raw[HONEYPOT], 10) !== "",
    lead: {
      name:
        cleanText(raw.name, 200) ||
        cleanText(
          `${cleanText(raw.first_name, 100)} ${cleanText(raw.last_name, 100)}`,
          200,
        ),
      email,
      phone,
      company: cleanText(raw.company, 200) || null,
      website: cleanText(raw.website, 300) || null,
      message:
        cleanLongText(
          typeof raw.message === "number" ? String(raw.message) : raw.message,
          5000,
        ) || null,
      consent,
    },
  };
}
