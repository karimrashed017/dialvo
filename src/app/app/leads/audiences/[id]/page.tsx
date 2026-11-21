import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Download, Search } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import type { Lead } from "@/lib/app/types";
import { AUDIENCE_MAX_LEADS, SEND_TO_PLAY_MAX } from "@/lib/data/config";
import { describeFilters, type LeadFilters } from "@/lib/data/filters";
import { dataOptions } from "@/lib/data/read";
import { isUuid } from "@/lib/leads/fields";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../../_ui/form";
import { LeadFilterFields } from "../../../_ui/lead-filters";
import {
  Badge,
  btn,
  Empty,
  hint,
  input,
  labelCls,
  leadLabel,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
  StatusBadge,
} from "../../../_ui/kit";
import { archiveAudience, audienceToPlaybook, saveAudience } from "../actions";

export const metadata: Metadata = { title: "Audience" };

async function Content({
  params,
}: {
  params: PageProps<"/app/leads/audiences/[id]">["params"];
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { workspace, preview } = await getAppContext();
  if (preview) notFound();
  const supabase = await createClient();
  const { data: audience } = await supabase
    .from("audiences")
    .select("id, name, filters")
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (!audience) notFound();
  const [idsRes, options] = await Promise.all([
    supabase.rpc("audience_lead_ids", {
      p_workspace_id: workspace.id,
      p_audience_id: id,
      p_filters: null,
      p_limit: AUDIENCE_MAX_LEADS,
    }),
    dataOptions(supabase, workspace.id),
  ]);
  const ids = (idsRes.data as string[] | null) ?? [];
  const { data: leadRows } = ids.length
    ? await supabase
        .from("leads")
        .select(
          "id, name, email, phone, company, status, source, tier, fit_score, engagement_score, created_at",
        )
        .eq("workspace_id", workspace.id)
        .in("id", ids.slice(0, 100))
        .order("created_at", { ascending: false })
    : { data: [] };
  const leads = (leadRows ?? []) as Lead[];
  const filters = audience.filters as LeadFilters;
  const names = {
    lists: new Map(options.lists.map((l) => [l.id, l.name])),
    recipes: new Map(options.recipes.map((r) => [r.id, r.name])),
  };
  return (
    <>
      <PageHead
        title={audience.name}
        note={`${describeFilters(filters, names)}. ${ids.length.toLocaleString("en-GB")} ${ids.length === 1 ? "lead" : "leads"} now.`}
      >
        <Link href="/app/leads/audiences" className={cn(btn.ghost, btn.small)}>
          <ArrowLeft aria-hidden className="size-3.5" />
          Audiences
        </Link>
        <a
          href={`/app/leads/audiences/${id}/export`}
          className={cn(btn.secondary, btn.small)}
        >
          <Download aria-hidden className="size-3.5" />
          Export CSV
        </a>
      </PageHead>
      <div className="grid gap-3 lg:grid-cols-[1fr_400px]">
        <section className={cn(panel, "min-w-0 overflow-hidden")}>
          <h2 className={panelHead}>
            Who is in it now
            {ids.length > 100 && (
              <span className="text-[12px] font-normal text-[#0B0B0C]/50">
                The newest 100 shown
              </span>
            )}
          </h2>
          {leads.length === 0 ? (
            <Empty icon={Search} title="Nobody right now">
              Leads join as soon as they match.
            </Empty>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {leads.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/app/leads/${l.id}`}
                    className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-black/[0.02]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{leadLabel(l)}</span>
                      <span className="block truncate text-[12px] text-[#0B0B0C]/55">
                        {[l.company, l.email].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <StatusBadge status={l.status} />
                    {l.tier && (
                      <Badge tone={l.tier === 1 ? "ink" : "outline"}>
                        Tier {l.tier}
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="min-w-0 space-y-3">
          {options.playbooks.length > 0 && (
            <section className={panel}>
              <h2 className={panelHead}>Start a playbook on it</h2>
              <ActionForm action={audienceToPlaybook} className="space-y-3 p-4">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="name" value={audience.name} />
                <label className={labelCls}>
                  Playbook
                  <select
                    name="playbook"
                    required
                    defaultValue=""
                    className={cn(input, "mt-1")}
                  >
                    <option value="">Choose a playbook</option>
                    {options.playbooks.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={hint}>
                  Picks up to {SEND_TO_PLAY_MAX} people from this audience, with
                  every rule the playbook keeps. You can also choose this
                  audience in a playbook&apos;s own filters so it picks from it
                  every run.
                </p>
                <SubmitButton pendingText="Starting…">Start</SubmitButton>
              </ActionForm>
            </section>
          )}
          <section className={panel}>
            <h2 className={panelHead}>Filters</h2>
            <ActionForm action={saveAudience} className="space-y-3 p-4">
              <input type="hidden" name="id" value={id} />
              <label className={labelCls}>
                Name
                <input
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={audience.name}
                  className={cn(input, "mt-1")}
                />
              </label>
              <LeadFilterFields
                filters={filters}
                lists={options.lists}
                recipes={options.recipes}
                basic
              />
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
            <p className={cn(hint, "px-4")}>
              To work on these people as a table, make a list from this audience
              on{" "}
              <Link
                href="/app/lists"
                className="underline decoration-black/25 underline-offset-2"
              >
                Lists
              </Link>
              .
            </p>
            <ActionForm
              action={archiveAudience}
              confirm="Remove this audience? Playbooks that use it stop picking from it."
              className="px-4 py-3"
            >
              <input type="hidden" name="id" value={id} />
              <SubmitButton variant="ghost" small pendingText="Removing…">
                Remove audience
              </SubmitButton>
            </ActionForm>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function AudiencePage(
  props: PageProps<"/app/leads/audiences/[id]">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}
