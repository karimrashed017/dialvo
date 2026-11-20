import { normalizeEmail } from "@/lib/leads/fields";
import { PRODUCT_EVENTS, type ProductEvent } from "./config";

// The body of POST /api/v1/events, checked. Untrusted: whatever the
// workspace's app sends. Properties are kept small and flat (strings,
// numbers and true/false only), because the trial-users play reads two of
// them ("limit" and "ends_at") and shows them to the writer as material.

export type EventBody = {
  email: string;
  event: ProductEvent;
  occurred_at: string | null;
  properties: Record<string, string | number | boolean>;
};

export function readEventBody(
  body: unknown,
): { ok: true; value: EventBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { ok: false, error: "The body must be a JSON object." };
  const b = body as Record<string, unknown>;
  const email = normalizeEmail(b.email);
  if (!email) return { ok: false, error: "email is missing or not valid." };
  if (
    typeof b.event !== "string" ||
    !(PRODUCT_EVENTS as readonly string[]).includes(b.event)
  )
    return {
      ok: false,
      error: `event must be one of: ${PRODUCT_EVENTS.join(", ")}.`,
    };
  let occurred: string | null = null;
  if (b.occurred_at !== undefined && b.occurred_at !== null) {
    const t =
      typeof b.occurred_at === "string" ? Date.parse(b.occurred_at) : NaN;
    if (Number.isNaN(t))
      return { ok: false, error: "occurred_at must be an ISO 8601 time." };
    occurred = new Date(t).toISOString();
  }
  const properties: EventBody["properties"] = {};
  if (b.properties !== undefined && b.properties !== null) {
    if (typeof b.properties !== "object" || Array.isArray(b.properties))
      return { ok: false, error: "properties must be an object." };
    const entries = Object.entries(b.properties as Record<string, unknown>);
    if (entries.length > 20)
      return { ok: false, error: "properties may have at most 20 keys." };
    for (const [key, value] of entries) {
      if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key))
        return {
          ok: false,
          error: `property name not allowed: ${key.slice(0, 40)}`,
        };
      if (typeof value === "string")
        properties[key] = value
          .replace(/[\u0000-\u001f\u007f<>]/g, " ")
          .slice(0, 200);
      else if (typeof value === "number" && Number.isFinite(value))
        properties[key] = value;
      else if (typeof value === "boolean") properties[key] = value;
      else
        return {
          ok: false,
          error: `property ${key} must be a string, number or boolean.`,
        };
    }
  }
  if (JSON.stringify(properties).length > 2000)
    return { ok: false, error: "properties are too large." };
  return {
    ok: true,
    value: {
      email,
      event: b.event as ProductEvent,
      occurred_at: occurred,
      properties,
    },
  };
}
