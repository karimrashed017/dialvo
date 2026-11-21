import { checkTargetUrl } from "./post";
import { isWebhookEvent, type WebhookEvent } from "./webhooks";

// Reading a webhook endpoint from a form or an API body. Pure.

export type EndpointInput =
  | { ok: true; url: string; events: WebhookEvent[]; description: string }
  | { ok: false; error: string; field: "url" | "events" };

export function readEvents(raw: unknown): WebhookEvent[] | null {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const events = [...new Set(list.filter(isWebhookEvent))];
  return events.length > 0 && events.length === new Set(list).size
    ? events
    : null;
}

export function readEndpoint(input: Record<string, unknown>): EndpointInput {
  const raw = typeof input.url === "string" ? input.url.trim() : "";
  const url = checkTargetUrl(raw);
  if (!url.ok) return { ok: false, error: url.error, field: "url" };
  const events = readEvents(input.events);
  if (!events)
    return {
      ok: false,
      error:
        "Choose one or more of lead.created, reply.received and meeting.booked.",
      field: "events",
    };
  const description =
    typeof input.description === "string"
      ? input.description.replace(/\s+/g, " ").trim().slice(0, 120)
      : "";
  return { ok: true, url: url.url.toString(), events, description };
}
