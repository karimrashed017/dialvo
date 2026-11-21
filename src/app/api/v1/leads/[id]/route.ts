import "server-only";
import { LEAD_COLUMNS, leadOut, readLeadWrite } from "@/lib/api/leads";
import {
  apiError,
  apiJson,
  authorise,
  failed,
  isId,
  readBody,
} from "@/lib/api/v1";

// GET   /api/v1/leads/<id>   one lead of the key's workspace (404 otherwise).
// PATCH /api/v1/leads/<id>   changes the fields given (custom_fields is
//       replaced as a whole). do_not_contact and consent can only be switched
//       on through the API.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isId(id)) return apiError(404, "not_found");
  const { data, error } = await auth.ctx
    .from("leads", LEAD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) return failed("get lead", error);
  if (!data) return apiError(404, "not_found");
  return apiJson({ data: leadOut(data as unknown as Record<string, unknown>) });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const { id } = await params;
  if (!isId(id)) return apiError(404, "not_found");
  const read = await readBody(request);
  if (!read.ok) return read.response;
  const lead = readLeadWrite(read.body, false);
  if (!lead.ok) return apiError(422, "invalid", lead.error);
  const { data, error } = await ctx.supabase
    .from("leads")
    .update(lead.values)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id)
    .select(LEAD_COLUMNS)
    .maybeSingle();
  if (error?.code === "23505")
    return apiError(
      409,
      "exists",
      "Another lead in this workspace has that email.",
    );
  if (error) return failed("update lead", error);
  if (!data) return apiError(404, "not_found");
  return apiJson({ data: leadOut(data as unknown as Record<string, unknown>) });
}
