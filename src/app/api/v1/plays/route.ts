import "server-only";
import {
  apiError,
  apiJson,
  authorise,
  failed,
  pageOf,
  paged,
  readPage,
} from "@/lib/api/v1";

// GET /api/v1/plays   the workspace's plays and sequences (every campaign a
//     play or Find leads started), newest first. ?limit &cursor
//     &status=active|done|stopped. "accepts_leads" says whether POST
//     /api/v1/plays/<id>/leads can add one of your leads to it.

const STATUSES = ["active", "done", "stopped"];
const COMPANY_KINDS = ["accounts", "lookalike", "signals"];

export async function GET(request: Request) {
  const auth = await authorise(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const page = readPage(url);
  if (!page.ok) return page.response;
  let q = auth.ctx.from(
    "outbound_campaigns",
    "id, kind, name, status, created_at, updated_at",
  );
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
  const { data, error } = await paged(q, page.cursor, page.size);
  if (error) return failed("list plays", error);
  const out = pageOf(
    (data ?? []) as unknown as {
      created_at: string;
      id: string;
      kind: string;
      status: string;
    }[],
    page.size,
  );
  return apiJson({
    ...out,
    data: out.data.map((c) => ({
      ...c,
      accepts_leads: c.status === "active" && !COMPANY_KINDS.includes(c.kind),
    })),
  });
}
