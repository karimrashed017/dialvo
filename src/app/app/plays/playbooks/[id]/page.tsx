import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago } from "@/lib/app/time";
import { isUuid } from "@/lib/leads/fields";
import {
  createPlaybookStore,
  describeFilters,
  getPlaybook,
  leadSources,
} from "@/lib/plays/playbooks";
import { playReads } from "@/lib/plays/read";
import { prospectRuntimeStatus } from "@/lib/prospects/config";
import { listSequences } from "@/lib/sequences/server";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../../_ui/form";
import {
  Badge,
  btn,
  hint,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../../_ui/kit";
import { DraftWriter } from "../../../prospects/drivers";
import { stopCampaign } from "../../actions";
import { CountStrip, GoLink, sumCounts } from "../../ui";
import { archivePlaybook, startPlaybook } from "../actions";
import { PlaybookForm } from "../form";

export const metadata: Metadata = { title: "Playbook" };

async function Content({ id }: { id: string }) {
  const { workspace, user, preview } = await getAppContext();
  if (preview) notFound();
  const admin = workspace.role !== "member";
  const on = prospectRuntimeStatus().on;
  const supabase = await createClient();
  const playbook = await getPlaybook(supabase, workspace.id, id);
  if (!playbook) notFound();
  const reads = playReads(supabase, workspace.id);
  const [sequences, sources, counts, toWrite, campaigns] = await Promise.all([
    listSequences(supabase, workspace.id),
    leadSources(supabase, workspace.id),
    reads.counts(),
    reads.toWrite(),
    supabase
      .from("outbound_campaigns")
      .select("id, name, status, created_at")
      .eq("workspace_id", workspace.id)
      .eq("playbook_id", playbook.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const runs = (campaigns.data ?? []) as {
    id: string;
    name: string;
    status: string;
    created_at: string;
  }[];
  const fits = on
    ? await createPlaybookStore()
        ?.preview(workspace.id, user.id, playbook.id)
        .catch(() => null)
    : null;
  const c = sumCounts(counts, ["playbook"]);
  return (
    <>
      <PageHead title={playbook.name} note={describeFilters(playbook.filters)}>
        <Link href="/app/plays/playbooks" className={cn(btn.ghost, btn.small)}>
          <ArrowLeft aria-hidden className="size-3.5" />
          Your playbooks
        </Link>
      </PageHead>
      <div className="grid gap-3 lg:grid-cols-[1fr_420px]">
        <div className="min-w-0 space-y-3">
          {!on && (
            <p
              role="status"
              className="rounded-xl border border-black/15 bg-white px-4 py-2.5 text-[13px] leading-[1.5]"
            >
              Writing emails isn&apos;t switched on yet on Dialvo&apos;s side,
              so this can be saved but not run yet.
            </p>
          )}
          <section aria-label="Numbers for all your playbooks">
            <CountStrip counts={c} />
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Run it</h2>
            <ActionForm action={startPlaybook} className="space-y-3 p-4">
              <input type="hidden" name="id" value={playbook.id} />
              <p className="text-[13px] text-[#0B0B0C]/70">
                {fits == null
                  ? "Running it picks the leads that fit right now."
                  : fits.count === 0
                    ? "No lead fits right now."
                    : `${fits.count} ${fits.count === 1 ? "lead fits" : "leads fit"} right now (at most 50 per run).`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <SubmitButton disabled={!on} pendingText="Starting…">
                  Run for these leads
                </SubmitButton>
                <span className={hint}>
                  {playbook.approval_mode === "auto"
                    ? "Set to send on its own: each email is approved as soon as it is written."
                    : "Nothing is sent: each email waits for your approval."}
                </span>
              </div>
            </ActionForm>
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Write and approve</h2>
            <div className="space-y-3 p-4">
              <DraftWriter waiting={toWrite} disabled={!on} noun="email" />
              <GoLink href="/app/prospects?view=emails">
                Open the approval queue
                {c.waiting > 0 ? ` (${c.waiting} waiting)` : ""}
              </GoLink>
            </div>
          </section>
          {runs.length > 0 && (
            <section className={panel}>
              <h2 className={panelHead}>Runs</h2>
              <ul className="divide-y divide-black/[0.06]">
                {runs.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[13px]"
                  >
                    <span className="min-w-0 flex-1 font-medium">{r.name}</span>
                    <span className="text-[12px] text-[#0B0B0C]/55">
                      {ago(r.created_at)}
                    </span>
                    <Badge tone={r.status === "active" ? "ink" : "outline"}>
                      {r.status === "active"
                        ? "Running"
                        : r.status === "done"
                          ? "Done"
                          : "Stopped"}
                    </Badge>
                    {r.status === "active" && (
                      <ActionForm
                        action={stopCampaign}
                        confirm="Stop this run? Emails not written yet won't be."
                      >
                        <input type="hidden" name="campaign" value={r.id} />
                        <SubmitButton
                          variant="ghost"
                          small
                          pendingText="Stopping…"
                        >
                          Stop
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>Settings</h2>
            <PlaybookForm
              playbook={playbook}
              sequences={sequences}
              sources={sources}
              admin={admin}
            />
            {admin && (
              <ActionForm
                action={archivePlaybook}
                confirm="Archive this playbook? Its running runs stop; emails already written stay where they are."
                className="border-t border-black/[0.06] px-4 py-3"
              >
                <input type="hidden" name="id" value={playbook.id} />
                <SubmitButton variant="ghost" small pendingText="Archiving…">
                  Archive playbook
                </SubmitButton>
              </ActionForm>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

async function Page({ params }: PageProps<"/app/plays/playbooks/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <Content id={id} />;
}

export default function PlaybookPage(
  props: PageProps<"/app/plays/playbooks/[id]">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Page {...props} />
    </Suspense>
  );
}
