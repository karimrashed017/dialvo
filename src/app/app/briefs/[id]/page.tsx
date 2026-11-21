import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { dateTime } from "@/lib/app/time";
import { isUuid } from "@/lib/leads/fields";
import { createClient } from "@/lib/supabase/server";
import { Badge, PageSkeleton, panel, panelHead } from "../../_ui/kit";
import {
  BRIEF_REASON,
  BRIEF_STATUS,
  BriefBody,
  type BriefRow,
} from "../brief-view";

export const metadata: Metadata = { title: "Brief" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, preview } = await getAppContext();
  if (preview || !isUuid(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("account_briefs")
    .select(
      "id, kind, status, reason, summary, content, sources, error, created_at, ready_at, lead:leads(id, name, email, company), meeting:meetings(title, starts_at)",
    )
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const b = data as unknown as BriefRow & {
    lead: {
      id: string;
      name: string;
      email: string | null;
      company: string | null;
    } | null;
    meeting: { title: string; starts_at: string } | null;
  };
  const who = b.lead
    ? `${b.lead.name || b.lead.email || "A lead"}${b.lead.company ? ` (${b.lead.company})` : ""}`
    : "A lead";
  return (
    <>
      <Link
        href="/app/briefs"
        className="mb-3 inline-flex items-center gap-1.5 px-1 text-[12.5px] text-[#0B0B0C]/55 hover:text-[#0B0B0C]"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Briefs
      </Link>
      <section className={`${panel} max-w-[760px]`}>
        <h1 className={panelHead}>
          <span>
            {b.kind === "closed_lost"
              ? "Why it was likely lost: "
              : "Account brief: "}
            {b.lead ? (
              <Link
                href={`/app/leads/${b.lead.id}`}
                className="hover:underline"
              >
                {who}
              </Link>
            ) : (
              who
            )}
          </span>
          <Badge tone={b.status === "ready" ? "plain" : "outline"}>
            {BRIEF_STATUS[b.status] ?? b.status}
          </Badge>
        </h1>
        <div className="space-y-3 p-4">
          <p className="text-[12px] text-[#0B0B0C]/50">
            {BRIEF_REASON[b.reason] ?? b.reason} ·{" "}
            {dateTime(b.ready_at ?? b.created_at, workspace.timezone)}
            {b.meeting &&
              ` · for "${b.meeting.title || "a meeting"}" at ${dateTime(b.meeting.starts_at, workspace.timezone)}`}
          </p>
          <BriefBody brief={b} />
        </div>
      </section>
    </>
  );
}

export default function Page({ params }: PageProps<"/app/briefs/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
