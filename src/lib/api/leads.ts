import { cleanText, normalizeEmail, normalizePhone } from "@/lib/leads/fields";

// Reading a lead from an API request body. Pure. Only these fields can be
// written through the API; everything else (owner, consent times, the
// workspace) is set by Dialvo.

export const LEAD_COLUMNS =
  "id, name, email, phone, company, website, source, status, do_not_contact, consent_email, consent_call, consent_sms, consent_whatsapp, custom_fields, created_at, updated_at";

export const LEAD_STATUSES = [
  "new",
  "engaged",
  "qualified",
  "meeting_booked",
  "won",
  "lost",
  "unsubscribed",
] as const;

type LeadRow = Record<string, unknown> & {
  consent_email?: boolean;
  consent_call?: boolean;
  consent_sms?: boolean;
  consent_whatsapp?: boolean;
};

/** A lead as the API shows it. */
export function leadOut(row: LeadRow) {
  const {
    consent_email,
    consent_call,
    consent_sms,
    consent_whatsapp,
    ...rest
  } = row;
  return {
    ...rest,
    consent: {
      email: Boolean(consent_email),
      call: Boolean(consent_call),
      sms: Boolean(consent_sms),
      whatsapp: Boolean(consent_whatsapp),
    },
  };
}

export type LeadWrite =
  { ok: true; values: Record<string, unknown> } | { ok: false; error: string };

const CHANNELS = ["email", "call", "sms", "whatsapp"] as const;

/**
 * The columns to write. For a new lead (`create`) an email or a phone is
 * required. Consent can only be given, with "api" as where it came from;
 * taking it back is a person's job in the app (or the lead's, by
 * unsubscribing).
 */
export function readLeadWrite(
  body: Record<string, unknown>,
  create: boolean,
  now = new Date(),
): LeadWrite {
  const v: Record<string, unknown> = {};
  const has = (k: string) => Object.hasOwn(body, k);
  if (has("email")) {
    if (body.email === null && !create) v.email = null;
    else {
      const email = normalizeEmail(body.email);
      if (!email) return { ok: false, error: "email isn't an email address." };
      v.email = email;
    }
  }
  if (has("phone")) {
    if (body.phone === null) v.phone = null;
    else {
      const phone = normalizePhone(body.phone);
      if (!phone) return { ok: false, error: "phone isn't a phone number." };
      v.phone = phone;
    }
  }
  for (const [k, max] of [
    ["name", 200],
    ["company", 200],
    ["website", 300],
  ] as const)
    if (has(k)) {
      if (body[k] !== null && typeof body[k] !== "string")
        return { ok: false, error: `${k} must be a string.` };
      v[k] = cleanText(body[k], max) || (k === "name" ? "" : null);
    }
  if (has("status")) {
    if (!(LEAD_STATUSES as readonly unknown[]).includes(body.status))
      return {
        ok: false,
        error: `status must be one of ${LEAD_STATUSES.join(", ")}.`,
      };
    v.status = body.status;
  }
  if (has("do_not_contact")) {
    if (typeof body.do_not_contact !== "boolean")
      return { ok: false, error: "do_not_contact must be true or false." };
    // Only ever switched on through the API: switching it off is a person's call.
    if (body.do_not_contact) {
      v.do_not_contact = true;
      v.do_not_contact_at = now.toISOString();
    } else if (!create)
      return {
        ok: false,
        error: "do_not_contact can only be switched off in the app.",
      };
  }
  if (has("consent")) {
    const c = body.consent;
    if (!c || typeof c !== "object" || Array.isArray(c))
      return { ok: false, error: "consent must be an object." };
    for (const [k, val] of Object.entries(c)) {
      if (!(CHANNELS as readonly string[]).includes(k))
        return { ok: false, error: `consent.${k} isn't a channel.` };
      if (val !== true)
        return {
          ok: false,
          error: "Consent can only be given (true) through the API.",
        };
      v[`consent_${k}`] = true;
      v[`consent_${k}_at`] = now.toISOString();
      v[`consent_${k}_source`] = "api";
    }
  }
  if (has("custom_fields")) {
    const f = body.custom_fields;
    if (!f || typeof f !== "object" || Array.isArray(f))
      return { ok: false, error: "custom_fields must be an object." };
    const entries = Object.entries(f);
    if (entries.length > 30 || JSON.stringify(f).length > 4000)
      return { ok: false, error: "custom_fields is too large." };
    for (const [k, val] of entries)
      if (
        k.length > 60 ||
        !(val === null || ["string", "number", "boolean"].includes(typeof val))
      )
        return {
          ok: false,
          error: "custom_fields takes short names and plain values.",
        };
    v.custom_fields = f;
  }
  if (create) {
    if (!v.email && !v.phone)
      return { ok: false, error: "A new lead needs an email or a phone." };
    v.source = "api";
  }
  if (Object.keys(v).length === 0)
    return { ok: false, error: "Nothing to change." };
  return { ok: true, values: v };
}
