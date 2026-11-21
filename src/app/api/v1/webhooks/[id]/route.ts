import "server-only";
import {
  apiError,
  apiJson,
  authorise,
  failed,
  isId,
  readBody,
} from "@/lib/api/v1";
import { readEvents } from "@/lib/integrations/endpoints";
import { createIntegrationStore } from "@/lib/integrations/store";

// PATCH  /api/v1/webhooks/<id>   { "events": [...], "active": true | false }
// DELETE /api/v1/webhooks/<id>   removes it and its secret.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isId(id)) return apiError(404, "not_found");
  const read = await readBody(request);
  if (!read.ok) return read.response;
  const events =
    read.body.events === undefined ? null : readEvents(read.body.events);
  if (read.body.events !== undefined && !events)
    return apiError(
      422,
      "invalid",
      "events must name lead.created, reply.received or meeting.booked.",
    );
  const active = read.body.active === undefined ? null : read.body.active;
  if (active !== null && typeof active !== "boolean")
    return apiError(422, "invalid", "active must be true or false.");
  if (events === null && active === null)
    return apiError(422, "invalid", "Nothing to change.");
  const store = createIntegrationStore();
  if (!store) return apiError(503, "unavailable");
  try {
    const ok = await store.webhookUpdate(
      auth.ctx.workspaceId,
      null,
      id,
      events,
      active,
    );
    return ok ? apiJson({ status: "updated" }) : apiError(404, "not_found");
  } catch (error) {
    return failed("update webhook", error as Error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isId(id)) return apiError(404, "not_found");
  const store = createIntegrationStore();
  if (!store) return apiError(503, "unavailable");
  try {
    const ok = await store.webhookDelete(auth.ctx.workspaceId, null, id);
    return ok ? apiJson({ status: "deleted" }) : apiError(404, "not_found");
  } catch (error) {
    return failed("delete webhook", error as Error);
  }
}
