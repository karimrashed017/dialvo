import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Table2 } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago } from "@/lib/app/time";
import {
  DAILY_DATA_CREDITS,
  DAILY_RESEARCH_CELLS,
  DAILY_RESEARCH_SPEND_MICROS,
  LIST_ROWS_MAX,
  LISTS_MAX,
} from "@/lib/data/config";
import { dataOptions, dollars, todayUsage } from "@/lib/data/read";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import {
  Badge,
  Empty,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../_ui/kit";
import { LIST_TABS, SectionTabs } from "../_ui/tabs";
import { createList } from "./actions";
import { NewListFields } from "./new-list-fields";

export const metadata: Metadata = { title: "Lists" };

const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by hand",
  csv: "From a CSV",
  find_leads: "From Find leads",
  leads: "From your leads",
  crm: "From your CRM",
  audience: "From an audience",
  sourcing: "Always-on search",
  accounts: "Target accounts",
};

type ListRow = {
  id: string;
  name: string;
  kind: "companies" | "people";
  source: string;
  is_target: boolean;
  updated_at: string;
};

async function Content() {
  const { workspace, preview } = await getAppContext();
  const head = (
    <PageHead
      title="Lists"
      note="Spreadsheet-style lists of companies or people. Add a column with a plain question and Dialvo researches the answer for each row, with its source; or look up work emails, titles and company details. Then send rows to Leads or to a playbook."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <section className={cn(panel, "p-4 text-[13px]")}>
          Lists need the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );
  const supabase = await createClient();
  const [listsRes, searchesRes, options, usage] = await Promise.all([
    supabase
      .from("data_lists")
      .select("id, name, kind, source, is_target, updated_at")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(LISTS_MAX),
    supabase
      .from("prospect_searches")
      .select("id, name")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(50),
    dataOptions(supabase, workspace.id),
    todayUsage(supabase, workspace.id),
  ]);
  const lists = (listsRes.data ?? []) as ListRow[];
  const counts = new Map<string, number>();
  await Promise.all(
    lists.map(async (l) => {
      const { count } = await supabase
        .from("data_list_rows")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("list_id", l.id);
      counts.set(l.id, count ?? 0);
    }),
  );

  return (
    <>
      {head}
      <SectionTabs label="Lists and recipes" tabs={LIST_TABS} current="lists" />
      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <section className={cn(panel, "min-w-0")}>
          <h2 className={panelHead}>
            Your lists
            <span className="text-[12px] font-normal text-[#0B0B0C]/50">
              {lists.length} of {LISTS_MAX}
            </span>
          </h2>
          {lists.length === 0 ? (
            <Empty icon={Table2} title="No lists yet">
              Start one from a CSV, a Find leads search, your leads or your CRM.
              Each list holds up to {LIST_ROWS_MAX.toLocaleString("en-GB")}{" "}
              rows.
            </Empty>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {lists.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/app/lists/${l.id}`}
                    className="group flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-black/[0.02]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{l.name}</span>
                      <span className="block text-[12px] text-[#0B0B0C]/55">
                        {(counts.get(l.id) ?? 0).toLocaleString("en-GB")}{" "}
                        {l.kind === "companies" ? "companies" : "people"} ·{" "}
                        {SOURCE_LABEL[l.source] ?? l.source} · changed{" "}
                        {ago(l.updated_at)}
                      </span>
                    </span>
                    {l.is_target && <Badge tone="ink">Target accounts</Badge>}
                    <ArrowRight
                      aria-hidden
                      className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>New list</h2>
            <ActionForm action={createList} className="space-y-3 p-4">
              <label className={labelCls}>
                Name
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder="UK gyms with 2+ sites"
                  className={cn(input, "mt-1")}
                />
              </label>
              <fieldset className="flex gap-4 text-[13px]">
                <legend className={labelCls}>Each row is</legend>
                <label className="mt-1 flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="kind"
                    value="companies"
                    defaultChecked
                    className="size-4 accent-[#0B0B0C]"
                  />
                  A company
                </label>
                <label className="mt-1 flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="kind"
                    value="people"
                    className="size-4 accent-[#0B0B0C]"
                  />
                  A person
                </label>
              </fieldset>
              <NewListFields
                searches={
                  (searchesRes.data ?? []) as { id: string; name: string }[]
                }
                audiences={options.audiences}
              />
              <SubmitButton pendingText="Making the list…">
                Make the list
              </SubmitButton>
            </ActionForm>
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Today&apos;s limits</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 p-4 text-[12.5px]">
              <dt className="text-[#0B0B0C]/60">Research answers</dt>
              <dd className="tabular-nums">
                {usage.cells} of {DAILY_RESEARCH_CELLS}
              </dd>
              <dt className="text-[#0B0B0C]/60">Research spend</dt>
              <dd className="tabular-nums">
                {dollars(usage.micros)} of{" "}
                {dollars(DAILY_RESEARCH_SPEND_MICROS)}
              </dd>
              <dt className="text-[#0B0B0C]/60">Contact database credits</dt>
              <dd className="tabular-nums">
                {usage.credits} of {DAILY_DATA_CREDITS}
              </dd>
            </dl>
            <p className={cn(hint, "px-4 pb-4")}>
              Each run shows its estimate first and is refused if it would go
              over. The day starts again at midnight UTC. Estimates are reserved
              when a run starts and corrected as answers come in.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function ListsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
