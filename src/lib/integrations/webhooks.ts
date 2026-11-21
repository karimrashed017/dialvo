import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Outgoing webhooks: the events, the signing secret, the body and the
// signature. Pure but for the random bytes.
//
// Every delivery is a POST of JSON:
//
//   { "id": "<delivery id>", "type": "lead.created",
//     "created_at": "<when the event happened>", "data": { ... } }
//
// with three headers:
//   Dialvo-Event:      lead.created
//   Dialvo-Delivery:   the same id (the same on every retry of one delivery)
//   Dialvo-Signature:  t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">
//
// The receiver recomputes the HMAC with its secret over the exact body it
// received and compares, and refuses a timestamp more than five minutes old.

export const WEBHOOK_EVENTS = [
  "lead.created",
  "reply.received",
  "meeting.booked",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, string> = {
  "lead.created": "A lead is added (any source)",
  "reply.received": "A lead replies (email and other channels, not the chat)",
  "meeting.booked": "A meeting is booked",
};

export const isWebhookEvent = (v: unknown): v is WebhookEvent =>
  typeof v === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(v);

export function makeWebhookSecret(
  random: (n: number) => Buffer = randomBytes,
): string {
  return `whsec_${random(30).toString("base64url")}`;
}

export function webhookBody(input: {
  id: string;
  type: string;
  createdAt: string;
  data: unknown;
}): string {
  return JSON.stringify({
    id: input.id,
    type: input.type,
    created_at: input.createdAt,
    data: input.data,
  });
}

export function signWebhook(
  secret: string,
  body: string,
  timestamp: number,
): string {
  const v1 = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/**
 * How a receiver checks a delivery (the same code is in the API docs). True
 * when the signature matches and is at most `toleranceSeconds` old.
 */
export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  now: number = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.trim().split("=", 2) as [string, string]),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(now - t) > toleranceSeconds)
    return false;
  const expected = signWebhook(secret, body, t).split("v1=")[1];
  const given = String(parts.v1 ?? "");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export function webhookHeaders(input: {
  secret: string;
  body: string;
  event: string;
  deliveryId: string;
  now?: number;
}): Record<string, string> {
  const t = input.now ?? Math.floor(Date.now() / 1000);
  return {
    "dialvo-event": input.event,
    "dialvo-delivery": input.deliveryId,
    "dialvo-signature": signWebhook(input.secret, input.body, t),
  };
}
