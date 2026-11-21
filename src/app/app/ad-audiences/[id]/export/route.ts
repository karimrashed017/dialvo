import { AUDIENCE_EXPORT_MAX_ROWS } from "@/lib/audiences/config";
import {
  companyFile,
  contactFile,
  FORMATS,
  isFormat,
  type CompanyRow,
  type ContactRow,
} from "@/lib/audiences/formats";
import { getCurrentUser } from "@/lib/auth/user";
import { isUuid } from "@/lib/leads/fields";
import { createClient } from "@/lib/supabase/server";

// GET /app/ad-audiences/<id>/export?format=meta&hashed=1: one audience as
// the upload file an ad platform takes, for a signed-in member of its
// workspace only. The rows are read as the person through
// ad_audience_rows(), which checks membership, leaves out do not contact,
// unsubscribed and never-contact people, and records the export. Never
// cached.

export async function GET(
  request: Request,
  { params }: RouteContext<"/app/ad-audiences/[id]/export">,
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (!isFormat(format))
    return new Response("Unknown format.", { status: 400 });
  const hashed =
    FORMATS[format].hashable && url.searchParams.get("hashed") !== "0";
  const supabase = await createClient();
  const { data: audience } = await supabase
    .from("ad_audiences")
    .select("name, kind")
    .eq("id", id)
    .maybeSingle();
  const a = audience as { name: string; kind: string } | null;
  if (!a) return new Response(null, { status: 404 });
  if (!(FORMATS[format].kinds as readonly string[]).includes(a.kind))
    return new Response("That format doesn't fit this audience.", {
      status: 400,
    });
  const { data, error } = await supabase.rpc("ad_audience_rows", {
    p_audience_id: id,
    p_format: format,
    p_hashed: hashed,
    p_max: AUDIENCE_EXPORT_MAX_ROWS,
  });
  if (error) {
    console.error("[audiences] export failed:", error.message);
    return new Response("The export failed. Try again in a moment.", {
      status: 503,
    });
  }
  const r = data as { status: string; rows: unknown[]; truncated: boolean };
  if (r.status !== "ok") return new Response(null, { status: 404 });
  const file =
    a.kind === "companies"
      ? companyFile(format, r.rows as CompanyRow[], a.name)
      : contactFile(format, r.rows as ContactRow[], hashed, a.name);
  return new Response(file.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Rows": String(file.rows),
      ...(r.truncated ? { "X-Truncated": "1" } : {}),
    },
  });
}
