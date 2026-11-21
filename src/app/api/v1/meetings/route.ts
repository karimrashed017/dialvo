import "server-only";
import {
  apiError,
  apiJson,
  authorise,
  failed,
  isId,
  pageOf,
  paged,
  readPage,
} from "@/lib/api/v1";

// GET /api/v1/meetings   the workspace's meetings, newest booked first.
//     ?limit &cursor &lead_id= &status=scheduled|completed|cancelled|no_show
//     &from=<ISO time> &to=<ISO time>   (by start time)

const STATUSES = ["scheduled", "completed", "cancelled", "no_show"];

export async function GET(request: Request) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const page = readPage(url);
  if (!page.ok) return page.response;
  let q = auth.ctx.from(
    "meetings",
    "id, lead_id, title, starts_at, ends_at, booked_by, channel, status, created_at, updated_at",
  );
  const lead = url.searchParams.get("lead_id");
  if (lead !== null) {
    if (!isId(lead)) return apiError(422, "invalid", "lead_id must be an id.");
    q = q.eq("lead_id", lead);
  }
  const status = url.searchParams.get("status");
  if (status !== null) {
    if (!STATUSES.includes(status))
      return apiError(
        422,
        "invalid",
        `status must be one of ${STATUSES.join(", ")}.`,
      );
    q = q.eq("status", status);
  }
  for (const [param, op] of [
    ["from", "gte"],
    ["to", "lt"],
  ] as const) {
    const v = url.searchParams.get(param);
    if (v === null) continue;
    if (Number.isNaN(Date.parse(v)))
      return apiError(422, "invalid", `${param} must be an ISO time.`);
    q = q[op]("starts_at", new Date(v).toISOString());
  }
  const { data, error } = await paged(q, page.cursor, page.size);
  if (error) return failed("list meetings", error);
  return apiJson(
    pageOf(
      (data ?? []) as unknown as { created_at: string; id: string }[],
      page.size,
    ),
  );
}
