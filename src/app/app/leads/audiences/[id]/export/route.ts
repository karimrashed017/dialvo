import { getCurrentUser } from "@/lib/auth/user";
import { toCsv } from "@/lib/data/answers";
import { AUDIENCE_MAX_LEADS } from "@/lib/data/config";
import { isUuid } from "@/lib/leads/fields";
import { createClient } from "@/lib/supabase/server";

// A saved audience's leads, as they are now, as a CSV. For a signed-in
// member only: read as the person, so row-level security decides.

type Lead = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  source: string;
  status: string;
  tier: number | null;
  fit_score: number | null;
  engagement_score: number | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
};

export async function GET(
  _request: Request,
  { params }: RouteContext<"/app/leads/audiences/[id]/export">,
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data: audience } = await supabase
    .from("audiences")
    .select("id, name, workspace_id")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (!audience) return new Response(null, { status: 404 });
  const { data: ids } = await supabase.rpc("audience_lead_ids", {
    p_workspace_id: audience.workspace_id,
    p_audience_id: id,
    p_filters: null,
    p_limit: AUDIENCE_MAX_LEADS,
  });
  const all = (ids as string[] | null) ?? [];
  const leads: Lead[] = [];
  for (let i = 0; i < all.length; i += 200) {
    const { data } = await supabase
      .from("leads")
      .select(
        "name, email, phone, company, website, source, status, tier, fit_score, engagement_score, custom_fields, created_at",
      )
      .in("id", all.slice(i, i + 200));
    leads.push(...((data ?? []) as Lead[]));
  }
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const csv = toCsv(
    [
      "Name",
      "Email",
      "Phone",
      "Company",
      "Website",
      "Title",
      "Country",
      "Size",
      "Status",
      "Source",
      "Tier",
      "Fit",
      "Engagement",
      "Added",
    ],
    leads.map((l) => [
      l.name,
      l.email ?? "",
      l.phone ?? "",
      l.company ?? "",
      l.website ?? "",
      text(l.custom_fields?.title),
      text(l.custom_fields?.country),
      text(l.custom_fields?.company_size),
      l.status,
      l.source,
      l.tier ? String(l.tier) : "",
      l.fit_score == null ? "" : String(l.fit_score),
      l.engagement_score == null ? "" : String(l.engagement_score),
      l.created_at.slice(0, 10),
    ]),
  );
  const name =
    audience.name
      .replace(/[^\w -]+/g, "")
      .trim()
      .slice(0, 60) || "audience";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
