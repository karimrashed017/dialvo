import "server-only";
import {
  LEAD_COLUMNS,
  LEAD_STATUSES,
  leadOut,
  readLeadWrite,
} from "@/lib/api/leads";
import {
  apiError,
  apiJson,
  authorise,
  failed,
  pageOf,
  paged,
  readBody,
  readPage,
} from "@/lib/api/v1";
import { normalizeEmail } from "@/lib/leads/fields";

// GET  /api/v1/leads    the workspace's leads, newest first.
//      ?limit=1..100 &cursor=<next_cursor> &email= &status= &updated_since=<ISO time>
// POST /api/v1/leads    adds a lead: { email | phone, name, company, website,
//      status, consent: { email: true }, custom_fields }. 409 if the email is
//      already a lead of this workspace.
// Every query is scoped to the key's workspace in authorise() (ctx.from).

export async function GET(request: Request) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const url = new URL(request.url);
  const page = readPage(url);
  if (!page.ok) return page.response;
  let q = ctx.from("leads", LEAD_COLUMNS);
  const email = url.searchParams.get("email");
  if (email !== null) {
    const e = normalizeEmail(email);
    if (!e) return apiError(422, "invalid", "email isn't an email address.");
    q = q.eq("email", e);
  }
  const status = url.searchParams.get("status");
  if (status !== null) {
    if (!(LEAD_STATUSES as readonly string[]).includes(status))
      return apiError(
        422,
        "invalid",
        `status must be one of ${LEAD_STATUSES.join(", ")}.`,
      );
    q = q.eq("status", status);
  }
  const since = url.searchParams.get("updated_since");
  if (since !== null) {
    if (Number.isNaN(Date.parse(since)))
      return apiError(422, "invalid", "updated_since must be an ISO time.");
    q = q.gte("updated_at", new Date(since).toISOString());
  }
  const { data, error } = await paged(q, page.cursor, page.size);
  if (error) return failed("list leads", error);
  const out = pageOf(
    (data ?? []) as unknown as { created_at: string; id: string }[],
    page.size,
  );
  return apiJson({ ...out, data: out.data.map((r) => leadOut(r)) });
}

export async function POST(request: Request) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const read = await readBody(request);
  if (!read.ok) return read.response;
  const lead = readLeadWrite(read.body, true);
  if (!lead.ok) return apiError(422, "invalid", lead.error);
  const { data, error } = await ctx.supabase
    .from("leads")
    .insert({ ...lead.values, workspace_id: ctx.workspaceId })
    .select(LEAD_COLUMNS)
    .single();
  if (error?.code === "23505")
    return apiError(
      409,
      "exists",
      "A lead with that email is already in this workspace.",
    );
  if (error) return failed("create lead", error);
  return apiJson(
    { data: leadOut(data as unknown as Record<string, unknown>) },
    201,
  );
}
