import { API_EVENTS_PER_MINUTE, PRODUCT_EVENTS } from "@/lib/plays/config";
import {
  API_PAGE_DEFAULT,
  API_PAGE_MAX,
  API_REQUESTS_PER_MINUTE,
  WEBHOOK_ENDPOINTS_MAX,
} from "@/lib/integrations/config";
import {
  WEBHOOK_EVENT_LABEL,
  WEBHOOK_EVENTS,
} from "@/lib/integrations/webhooks";
import { cn } from "@/lib/utils";
import { hint, panel, panelHead } from "../../_ui/kit";

// The REST API's reference, as the app shows it on Settings, API. The routes
// it describes are in src/app/api/v1; keep the two in step.

const BASE = "https://trydialvo.com/api/v1";

type Route = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  what: string;
  params?: string;
  body?: string;
};

const ROUTES: { group: string; routes: Route[] }[] = [
  {
    group: "Leads",
    routes: [
      {
        method: "GET",
        path: "/leads",
        what: "Your leads, newest first.",
        params: "limit, cursor, email, status, updated_since (ISO time)",
      },
      {
        method: "POST",
        path: "/leads",
        what: "Add a lead. 201 with the lead; 409 if the email is already a lead.",
        body: `{ "email": "dana@example.com", "name": "Dana Reyes",
  "company": "Example Ltd", "website": "example.com",
  "phone": "+44 20 7946 0000", "status": "new",
  "consent": { "email": true },
  "custom_fields": { "plan": "trial" } }`,
      },
      { method: "GET", path: "/leads/{id}", what: "One lead." },
      {
        method: "PATCH",
        path: "/leads/{id}",
        what: "Change the fields you send. custom_fields is replaced as a whole. do_not_contact and consent can only be switched on through the API.",
        body: `{ "status": "qualified", "do_not_contact": true }`,
      },
    ],
  },
  {
    group: "Conversations and meetings",
    routes: [
      {
        method: "GET",
        path: "/conversations",
        what: "Every conversation (chat, email and other channels), newest first.",
        params:
          "limit, cursor, lead_id, channel, status, include=messages (the last 20 of each)",
      },
      {
        method: "GET",
        path: "/meetings",
        what: "Meetings, newest booked first.",
        params: "limit, cursor, lead_id, status, from, to (by start time)",
      },
    ],
  },
  {
    group: "Plays and sequences",
    routes: [
      {
        method: "GET",
        path: "/plays",
        what: "Every play and sequence the workspace has started. accepts_leads says whether you can add a lead to it.",
        params: "limit, cursor, status",
      },
      {
        method: "POST",
        path: "/plays/{id}/leads",
        what: "Add one of your leads to a running play. Its email is written by the play and waits for your approval, like every other.",
        body: `{ "email": "dana@example.com", "note": "Asked about pricing at our webinar" }`,
      },
    ],
  },
  {
    group: "Webhooks and events",
    routes: [
      {
        method: "GET",
        path: "/webhooks",
        what: "Your endpoints (never their secrets).",
      },
      {
        method: "POST",
        path: "/webhooks",
        what: `Register an endpoint (at most ${WEBHOOK_ENDPOINTS_MAX}). The answer carries its signing secret, once.`,
        body: `{ "url": "https://example.com/hooks/dialvo",
  "events": ["lead.created", "reply.received", "meeting.booked"] }`,
      },
      {
        method: "PATCH",
        path: "/webhooks/{id}",
        what: "Change its events, or pause it (active: false).",
        body: `{ "active": false }`,
      },
      {
        method: "DELETE",
        path: "/webhooks/{id}",
        what: "Remove it and its secret.",
      },
      {
        method: "POST",
        path: "/events",
        what: `A product event on one of your leads, for the trial-users play: ${PRODUCT_EVENTS.join(", ")}. Up to ${API_EVENTS_PER_MINUTE} a minute per key.`,
        body: `{ "email": "dana@example.com", "event": "limit_reached",
  "properties": { "limit": "projects" } }`,
      },
    ],
  },
];

const VERIFY = `import { createHmac, timingSafeEqual } from "node:crypto";

// body: the raw request body, exactly as received.
function fromDialvo(body, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(\`\${t}.\${body}\`).digest("hex");
  return parts.v1?.length === expected.length &&
    timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}`;

const code =
  "overflow-x-auto rounded-xl bg-black/[0.04] p-3 text-[12px] leading-[1.5]";

export function ApiReference() {
  return (
    <section className={cn(panel, "lg:col-span-2")} id="reference">
      <h2 className={panelHead}>API reference</h2>
      <div className="grid grid-cols-1 gap-5 p-4 text-[13px] leading-[1.5] lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <h3 className="font-medium">How it works</h3>
          <pre className={code}>{`GET ${BASE}/leads?limit=25
Authorization: Bearer <your key>`}</pre>
          <ul className="list-disc space-y-1 pl-5 text-[#0B0B0C]/75">
            <li>
              JSON in and out. Every key belongs to one workspace and sees only
              that workspace.
            </li>
            <li>
              Lists come back newest first as{" "}
              <code>{`{ "data": [...], "next_cursor": "..." }`}</code>: pass{" "}
              <code>cursor</code> to get the next page. <code>limit</code> is 1
              to {API_PAGE_MAX} ({API_PAGE_DEFAULT} if you leave it out).
            </li>
            <li>
              Up to {API_REQUESTS_PER_MINUTE} requests a minute per key; over
              that you get 429 with Retry-After.
            </li>
            <li>
              Errors: <code>{`{ "error": "invalid", "message": "..." }`}</code>{" "}
              with 401 (key), 404 (not in this workspace), 409, 413, 422 or 429.
            </li>
            <li>
              Nothing the API does sends an email by itself: emails wait for a
              person&apos;s approval in Dialvo.
            </li>
          </ul>
          <h3 className="pt-2 font-medium">Webhooks</h3>
          <p className="text-[#0B0B0C]/75">
            Dialvo POSTs JSON to your endpoint for the events it is registered
            for:
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-[#0B0B0C]/75">
            {WEBHOOK_EVENTS.map((e) => (
              <li key={e}>
                <code>{e}</code>: {WEBHOOK_EVENT_LABEL[e].toLowerCase()}
              </li>
            ))}
          </ul>
          <pre className={code}>{`POST <your endpoint>
Dialvo-Event: lead.created
Dialvo-Delivery: 5b1c…   (the same on every retry)
Dialvo-Signature: t=1763700000,v1=<hex>

{ "id": "5b1c…", "type": "lead.created",
  "created_at": "2026-11-21T10:00:00Z", "data": { …the lead… } }`}</pre>
          <p className={hint}>
            Answer with any 2xx within 10 seconds. Anything else is retried with
            growing gaps (1 minute up to 12 hours, 8 tries); 4xx answers other
            than 408 and 429 aren&apos;t retried. After 50 failures in a row the
            endpoint is switched off until you switch it back on. Check the
            signature before you trust a delivery:
          </p>
          <pre className={code}>{VERIFY}</pre>
        </div>
        <div className="min-w-0 space-y-4">
          {ROUTES.map((g) => (
            <div key={g.group}>
              <h3 className="font-medium">{g.group}</h3>
              <ul className="mt-1.5 space-y-2.5">
                {g.routes.map((r) => (
                  <li key={r.method + r.path}>
                    <p>
                      <code className="font-medium">
                        {r.method} {r.path}
                      </code>
                    </p>
                    <p className="text-[#0B0B0C]/70">{r.what}</p>
                    {r.params && <p className={hint}>Query: {r.params}</p>}
                    {r.body && <pre className={cn(code, "mt-1")}>{r.body}</pre>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
