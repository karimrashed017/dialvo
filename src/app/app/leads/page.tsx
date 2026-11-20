import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileUp, Search, Telescope, Users } from "lucide-react";
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
        note="Everyone Dialvo has found or talked to for you, and anyone you add yourself, in one list."
      >
        <Link href="/app/leads/import" className={btn.secondary}>
          <FileUp aria-hidden className="size-3.5" />
          Import CSV
        </Link>
        <AddLead variant="secondary" />
        <Link href="/app/prospects" className={btn.primary}>
          <Telescope aria-hidden className="size-3.5" />
          Find leads
        </Link>
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
                <span className="flex flex-wrap justify-center gap-2">
                  <Link href="/app/prospects" className={btn.primary}>
                    Find leads
                  </Link>
                  <Link href="/app/chat#install" className={btn.secondary}>
                    Put the chat on your site
                  </Link>
                </span>
              }
            >
              Leads show up here on their own: companies Dialvo finds that you
              keep, and visitors who write in your website chat or fill in your
              form. You don&apos;t need to bring a list.
            </Empty>
          )
        ) : (
          <>
            {/* On a phone each lead is a card; from a tablet up, a table. */}
            <ul className="divide-y divide-black/[0.06] md:hidden">
              {leads.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`/app/leads/${l.id}`}
                    className="block px-4 py-3 hover:bg-black/[0.02] focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium">
                          {leadLabel(l)}
                        </span>
                        {l.company && l.name && (
                          <span className="block truncate text-[12.5px] text-[#0B0B0C]/55">
                            {l.company}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 pt-0.5 text-[11.5px] text-[#0B0B0C]/45 tabular-nums">
                        {ago(l.created_at)}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-[12.5px] text-[#0B0B0C]/65">
                      {[l.email, l.phone].filter(Boolean).join(" · ") ||
                        "No contact details"}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={l.status} />
                      {l.do_not_contact && (
                        <Badge tone="warn">Do not contact</Badge>
                      )}
                      <span className="min-w-0 truncate text-[11.5px] text-[#0B0B0C]/45">
                        {l.source}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <table className="hidden w-full text-left text-[13px] md:table">
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
          </>
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
