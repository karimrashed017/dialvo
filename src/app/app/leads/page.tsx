import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileUp, Search, Users } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago } from "@/lib/app/time";
import { LEAD_STATUSES, STATUS_LABEL } from "@/lib/app/types";
import { cn } from "@/lib/utils";
import {
  Badge,
  btn,
  Empty,
  input,
  leadLabel,
  PageHead,
  PageSkeleton,
  panel,
  StatusBadge,
} from "../_ui/kit";
import { AddLead } from "./add-lead";

export const metadata: Metadata = { title: "Leads" };

async function Leads({
  searchParams,
}: {
  searchParams: PageProps<"/app/leads">["searchParams"];
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const status =
    typeof params.status === "string" &&
    (LEAD_STATUSES as readonly string[]).includes(params.status)
      ? params.status
      : "";
  const { repo } = await getAppContext();
  const leads = await repo.leads({ q, status });
  const filtered = Boolean(q || status);

  return (
    <>
      <PageHead
        title="Leads"
        note="Everyone your agents and your team are working, in one list."
      >
        <Link href="/app/leads/import" className={btn.secondary}>
          <FileUp aria-hidden className="size-3.5" />
          Import CSV
        </Link>
        <AddLead />
      </PageHead>

      <form
        action="/app/leads"
        role="search"
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <label className="relative min-w-[200px] flex-1 sm:max-w-[340px]">
          <span className="sr-only">Search leads</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[#0B0B0C]/40"
          />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Name, company, email or phone"
            className={cn(input, "h-9 rounded-full py-0 pl-8.5")}
          />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select
            name="status"
            defaultValue={status}
            className={cn(input, "h-9 w-auto rounded-full py-0 pr-8")}
          >
            <option value="">Any status</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={btn.secondary}>
          Filter
        </button>
        {filtered && (
          <Link href="/app/leads" className={btn.ghost}>
            Clear
          </Link>
        )}
        <span className="ml-auto text-[12px] text-[#0B0B0C]/45 tabular-nums">
          {leads.length === 200
            ? "Showing the newest 200"
            : `${leads.length} ${leads.length === 1 ? "lead" : "leads"}`}
        </span>
      </form>

      <section className={cn(panel, "overflow-hidden")}>
        {leads.length === 0 ? (
          filtered ? (
            <Empty icon={Search} title="No leads match that">
              Try a different search, or clear the filter to see everyone.
            </Empty>
          ) : (
            <Empty
              icon={Users}
              title="No leads yet"
              action={
                <Link href="/app/leads/import" className={btn.secondary}>
                  Import a CSV
                </Link>
              }
            >
              Add your first lead, import a list, or put the form from Settings
              on your website and enquiries will arrive on their own.
            </Empty>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-black/[0.06] text-[11.5px] text-[#0B0B0C]/50">
                  {["Lead", "Contact", "Status", "Source", "Added"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-black/[0.045] last:border-0 hover:bg-black/[0.02]"
                  >
                    <td className="max-w-[260px] px-4 py-2.5">
                      <Link
                        href={`/app/leads/${l.id}`}
                        className="block rounded focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
                      >
                        <span className="block truncate font-medium">
                          {leadLabel(l)}
                        </span>
                        {l.company && l.name && (
                          <span className="block truncate text-[12px] text-[#0B0B0C]/50">
                            {l.company}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="max-w-[240px] px-4 py-2.5 text-[12.5px] text-[#0B0B0C]/70">
                      <span className="block truncate">{l.email ?? "–"}</span>
                      {l.phone && (
                        <span className="block truncate text-[#0B0B0C]/50">
                          {l.phone}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        <StatusBadge status={l.status} />
                        {l.do_not_contact && (
                          <Badge tone="warn">Do not contact</Badge>
                        )}
                      </span>
                    </td>
                    <td className="max-w-[160px] truncate px-4 py-2.5 text-[12.5px] text-[#0B0B0C]/55">
                      {l.source}
                    </td>
                    <td className="px-4 py-2.5 text-[12.5px] whitespace-nowrap text-[#0B0B0C]/55 tabular-nums">
                      {ago(l.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default function LeadsPage({ searchParams }: PageProps<"/app/leads">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Leads searchParams={searchParams} />
    </Suspense>
  );
}
