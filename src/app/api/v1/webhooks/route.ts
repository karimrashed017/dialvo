import "server-only";
import { apiError, apiJson, authorise, failed, readBody } from "@/lib/api/v1";
import { WEBHOOK_ENDPOINTS_MAX } from "@/lib/integrations/config";
import { readEndpoint } from "@/lib/integrations/endpoints";
import { createIntegrationStore } from "@/lib/integrations/store";
import { makeWebhookSecret } from "@/lib/integrations/webhooks";

// GET  /api/v1/webhooks   the workspace's endpoints (never their secrets).
// POST /api/v1/webhooks   registers one: { "url": "https://...", "events":
//      ["lead.created", "reply.received", "meeting.booked"], "description" }.
//      The answer carries the signing secret, once.

export const ENDPOINT_COLUMNS =
  "id, url, description, events, status, status_reason, secret_prefix, consecutive_failures, last_success_at, last_failure_at, last_error, created_at, updated_at";

export async function GET(request: Request) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.ctx
    .from("webhook_endpoints", ENDPOINT_COLUMNS)
    .order("created_at", { ascending: true });
  if (error) return failed("list webhooks", error);
  return apiJson({ data: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const read = await readBody(request);
  if (!read.ok) return read.response;
  const endpoint = readEndpoint(read.body);
  if (!endpoint.ok) return apiError(422, "invalid", endpoint.error);
  const store = createIntegrationStore();
  if (!store) return apiError(503, "unavailable");
  const secret = makeWebhookSecret();
  try {
    const made = await store.webhookCreate({
      workspaceId: auth.ctx.workspaceId,
      userId: null,
      url: endpoint.url,
      events: endpoint.events,
      description: endpoint.description,
      secret,
      max: WEBHOOK_ENDPOINTS_MAX,
    });
    if (made.status === "capped")
      return apiError(
        409,
        "capped",
        `A workspace has at most ${WEBHOOK_ENDPOINTS_MAX} endpoints.`,
      );
    if (made.status !== "created" || !made.id) return apiError(422, "invalid");
    return apiJson(
      {
        data: {
          id: made.id,
          url: endpoint.url,
          events: endpoint.events,
          secret,
        },
      },
      201,
    );
  } catch (error) {
    return failed("create webhook", error as Error);
  }
}
