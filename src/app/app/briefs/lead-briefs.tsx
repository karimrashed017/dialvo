import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "../_ui/form";
import { Badge, panel, panelHead } from "../_ui/kit";
import { requestBrief } from "./actions";
import { BRIEF_STATUS, BriefBody, type BriefRow } from "./brief-view";

// The account brief on a lead's page: the latest one (and the closed-lost
// note when the lead was lost), and a button to make a fresh one.

const COLUMNS =
  "id, kind, status, reason, summary, content, sources, error, created_at, ready_at";

export async function LeadBriefs({
  workspaceId,
  leadId,
  lost,
  preview,
}: {
  workspaceId: string;
  leadId: string;
  lost: boolean;
  preview: boolean;
}) {
  let briefs: BriefRow[] = [];
  if (!preview) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("account_briefs")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(10);
    briefs = (data ?? []) as unknown as BriefRow[];
  }
  const brief = briefs.find((b) => b.kind === "brief");
  const lostNote = briefs.find((b) => b.kind === "closed_lost");
  return (
    <section className={panel} id="brief">
      <h2 className={panelHead}>
        Account brief
        {brief && (
          <Badge tone={brief.status === "ready" ? "plain" : "outline"}>
            {BRIEF_STATUS[brief.status]}
          </Badge>
        )}
      </h2>
      <div className="space-y-4 p-4">
        {brief ? (
          <BriefBody brief={brief} />
        ) : (
          <p className="text-[13px] text-[#0B0B0C]/60">
            No brief yet. A brief reads the company&apos;s website, searches the
            web and goes through what was said with them, then lists the facts,
            people, open questions and talking points, with sources.
          </p>
        )}
        {lostNote && (
          <div className="border-t border-black/[0.06] pt-3">
            <p className="mb-2 text-[12.5px] font-medium">
              Why this was likely lost
            </p>
            <BriefBody brief={lostNote} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-3">
          <ActionForm action={requestBrief}>
            <input type="hidden" name="lead" value={leadId} />
            <SubmitButton
              small
              variant="secondary"
              pendingText="Asking…"
              disabled={preview}
            >
              {brief ? "Make a fresh brief" : "Make a brief"}
            </SubmitButton>
          </ActionForm>
          {lost && !lostNote && (
            <ActionForm action={requestBrief}>
              <input type="hidden" name="lead" value={leadId} />
              <input type="hidden" name="kind" value="closed_lost" />
              <SubmitButton
                small
                variant="ghost"
                pendingText="Asking…"
                disabled={preview}
              >
                Why did we lose it?
              </SubmitButton>
            </ActionForm>
          )}
          <Link
            href="/app/briefs"
            className="ml-auto text-[12px] text-[#0B0B0C]/55 hover:underline"
          >
            All briefs
          </Link>
        </div>
      </div>
    </section>
  );
}
