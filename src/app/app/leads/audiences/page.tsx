import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, UsersRound } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { AUDIENCE_MAX_LEADS, AUDIENCES_MAX } from "@/lib/data/config";
import { describeFilters, type LeadFilters } from "@/lib/data/filters";
import { dataOptions } from "@/lib/data/read";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import { LeadFilterFields } from "../../_ui/lead-filters";
import {
  Empty,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { LEAD_TABS, SectionTabs } from "../../_ui/tabs";
import { saveAudience } from "./actions";

export const metadata: Metadata = { title: "Audiences" };

async function Content() {
  const { workspace, preview } = await getAppContext();
  const head = (
    <PageHead
      title="Audiences"
      note="Saved segments of your leads that keep themselves up to date: by stage, tier, scores, source, country, company size, list and last activity. Start a playbook on one, make a list from it, or export it."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <section className={cn(panel, "p-4 text-[13px]")}>
          Audiences need the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );
  const supabase = await createClient();
  const [audRes, options] = await Promise.all([
    supabase
      .from("audiences")
      .select("id, name, filters")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("created_at"),
    dataOptions(supabase, workspace.id),
  ]);
  const audiences = (audRes.data ?? []) as {
    id: string;
    name: string;
    filters: LeadFilters;
  }[];
  const counts = new Map<string, number>();
  await Promise.all(
    audiences.map(async (a) => {
      const { data } = await supabase.rpc("audience_lead_ids", {
        p_workspace_id: workspace.id,
        p_audience_id: a.id,
        p_filters: null,
        p_limit: AUDIENCE_MAX_LEADS,
      });
      counts.set(a.id, ((data as string[] | null) ?? []).length);
    }),
  );
  const names = {
    lists: new Map(options.lists.map((l) => [l.id, l.name])),
    recipes: new Map(options.recipes.map((r) => [r.id, r.name])),
  };
  return (
    <>
      {head}
      <SectionTabs label="Leads" tabs={LEAD_TABS} current="audiences" />
      <div className="grid gap-3 lg:grid-cols-[1fr_420px]">
        <section className={cn(panel, "min-w-0")}>
          <h2 className={panelHead}>
            Saved audiences
            <span className="text-[12px] font-normal text-[#0B0B0C]/50">
              {audiences.length} of {AUDIENCES_MAX}
            </span>
          </h2>
          {audiences.length === 0 ? (
            <Empty icon={UsersRound} title="No audiences yet">
              Save one on the right. It is worked out again every time you use
              it, so new leads that match are always in it.
            </Empty>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {audiences.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/app/leads/audiences/${a.id}`}
                    className="group flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-black/[0.02]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{a.name}</span>
                      <span className="block text-[12px] text-[#0B0B0C]/55">
                        {describeFilters(a.filters, names)}
                      </span>
                    </span>
                    <span className="text-[12px] text-[#0B0B0C]/55 tabular-nums">
                      {(counts.get(a.id) ?? 0).toLocaleString("en-GB")} now
                    </span>
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
        <aside className="min-w-0">
          <section className={panel}>
            <h2 className={panelHead}>New audience</h2>
            <ActionForm action={saveAudience} className="space-y-3 p-4">
              <label className={labelCls}>
                Name
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder="Tier 1, UK, quiet for a month"
                  className={cn(input, "mt-1")}
                />
              </label>
              <LeadFilterFields
                filters={{}}
                lists={options.lists}
                recipes={options.recipes}
                basic
              />
              <SubmitButton>Save audience</SubmitButton>
            </ActionForm>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function AudiencesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
