import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { languageLabel } from "@/lib/mail/languages";
import {
  describeFilters,
  leadSources,
  listPlaybooks,
} from "@/lib/plays/playbooks";
import { listSequences } from "@/lib/sequences/server";
import { createClient } from "@/lib/supabase/server";
import { dataOptions } from "@/lib/data/read";
import { cn } from "@/lib/utils";
import {
  Badge,
  btn,
  Empty,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { PlaybookForm } from "./form";

export const metadata: Metadata = { title: "Your playbooks" };

// The workspace's own plays: each picks leads by its filters, writes a first
// email for the goal the team gave, and runs a sequence after it.

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Your playbooks"
      note="Your own plays: choose who to pick from your leads, what the first email is for, the steps after it and whether emails wait for you. Run one whenever you like, like any play."
    >
      <Link href="/app/plays" className={cn(btn.ghost, btn.small)}>
        <ArrowLeft aria-hidden className="size-3.5" />
        All plays
      </Link>
    </PageHead>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={cn(panel, "p-4 text-[13px]")}>
          Playbooks need the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );
  const supabase = await createClient();
  const options = await dataOptions(supabase, workspace.id);
  const [playbooks, sequences, sources] = await Promise.all([
    listPlaybooks(supabase, workspace.id),
    listSequences(supabase, workspace.id),
    leadSources(supabase, workspace.id),
  ]);
  const seqName = new Map(sequences.map((q) => [q.id, q.name]));
  return (
    <>
      {head}
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <section className={panel}>
          <h2 className={panelHead}>
            Playbooks
            <span className="text-[12px] font-normal text-[#0B0B0C]/50">
              {playbooks.length} of 20
            </span>
          </h2>
          {playbooks.length === 0 ? (
            <Empty icon={BookOpen} title="No playbook yet">
              {admin
                ? "Write your first one on the right."
                : "An owner or admin can write one."}
            </Empty>
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {playbooks.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/app/plays/playbooks/${p.id}`}
                    className="group flex items-start gap-3 px-4 py-3 text-[13px] hover:bg-black/[0.02]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {p.name}
                        {p.approval_mode === "auto" && (
                          <Badge tone="ink">Sends on its own</Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-[#0B0B0C]/60">
                        {describeFilters(p.filters)}{" "}
                        {p.sequence_id
                          ? `Then ${seqName.get(p.sequence_id) ?? "its sequence"}.`
                          : ""}{" "}
                        {p.language !== "auto" &&
                          `In ${languageLabel(p.language)}.`}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {admin && (
          <section className={panel}>
            <h2 className={panelHead}>New playbook</h2>
            <PlaybookForm
              playbook={null}
              sequences={sequences}
              sources={sources}
              admin={admin}
              lists={options.lists}
              audiences={options.audiences}
              recipes={options.recipes}
            />
          </section>
        )}
      </div>
    </>
  );
}

export default function PlaybooksPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
