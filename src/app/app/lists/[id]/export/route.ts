import { getCurrentUser } from "@/lib/auth/user";
import { toCsv } from "@/lib/data/answers";
import { isUuid } from "@/lib/leads/fields";
import { createClient } from "@/lib/supabase/server";

// A list as a CSV: its rows, every added column's answer, and each answer's
// source and reason. For a signed-in member only: everything is read as the
// person, so row-level security decides. Never cached.

type Row = {
  id: string;
  name: string;
  title: string;
  company: string;
  domain: string | null;
  email: string | null;
  linkedin_url: string | null;
  country: string;
  size_range: string;
  fields: Record<string, unknown>;
};

export async function GET(
  _request: Request,
  { params }: RouteContext<"/app/lists/[id]/export">,
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("data_lists")
    .select("id, name, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (!list) return new Response(null, { status: 404 });
  const [columnsRes, rowsRes] = await Promise.all([
    supabase
      .from("data_list_columns")
      .select("id, name")
      .eq("list_id", id)
      .order("position"),
    supabase
      .from("data_list_rows")
      .select(
        "id, name, title, company, domain, email, linkedin_url, country, size_range, fields",
      )
      .eq("list_id", id)
      .order("position")
      .limit(2000),
  ]);
  const columns = (columnsRes.data ?? []) as { id: string; name: string }[];
  const rows = (rowsRes.data ?? []) as Row[];
  const cells = new Map<
    string,
    {
      value_text: string;
      source_url: string | null;
      reason: string;
      status: string;
    }
  >();
  for (let i = 0; i < rows.length; i += 200) {
    const { data } = await supabase
      .from("data_cells")
      .select("row_id, column_id, status, value_text, source_url, reason")
      .eq("list_id", id)
      .in(
        "row_id",
        rows.slice(i, i + 200).map((r) => r.id),
      );
    for (const c of (data ?? []) as {
      row_id: string;
      column_id: string;
      status: string;
      value_text: string;
      source_url: string | null;
      reason: string;
    }[])
      cells.set(`${c.row_id}:${c.column_id}`, c);
  }
  const extra = [
    ...new Set(
      rows.flatMap((r) =>
        Object.keys(r.fields ?? {}).filter((k) => !k.startsWith("_")),
      ),
    ),
  ].slice(0, 20);
  const headers = [
    "Name",
    "Title",
    "Company",
    "Website",
    "Email",
    "LinkedIn",
    "Country",
    "Size",
    ...extra,
    ...columns.flatMap((c) => [c.name, `${c.name}: source`, `${c.name}: why`]),
  ];
  const body = rows.map((r) => [
    r.name,
    r.title,
    r.company,
    r.domain ?? "",
    r.email ?? "",
    r.linkedin_url ?? "",
    r.country,
    r.size_range,
    ...extra.map((k) => String(r.fields?.[k] ?? "")),
    ...columns.flatMap((c) => {
      const cell = cells.get(`${r.id}:${c.id}`);
      if (!cell || cell.status !== "done") return ["", "", cell?.reason ?? ""];
      return [
        cell.value_text || "Not found",
        cell.source_url ?? "",
        cell.reason,
      ];
    }),
  ]);
  const name =
    list.name
      .replace(/[^\w -]+/g, "")
      .trim()
      .slice(0, 60) || "list";
  return new Response(toCsv(headers, body), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
