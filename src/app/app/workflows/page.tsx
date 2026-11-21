import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Zap } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { agoWords, dateOnly } from "@/lib/app/time";
import { WORKFLOW_RUNS_PER_DAY, WORKFLOWS_MAX } from "@/lib/workflows/config";
import {
  ACTION_LABEL,
  TRIGGER_LABEL,
  type ActionKind,
  type Trigger,
} from "@/lib/workflows/types";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import {
  Badge,
  btn,
  Empty,
  hint,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../_ui/kit";
import { setTaskDone } from "./actions";
import { RunList, type RunRow } from "./runs";

export const metadata: Metadata = { title: "Workflows" };

type WorkflowRow = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  steps: { action: ActionKind }[];
  last_run_at: string | null;
  runs_total: number;
};
type TaskRow = {
  id: string;
  title: string;
  due_at: string | null;
  assignee_id: string | null;
  lead: { id: string; name: string; email: string | null } | null;
};

async function Content() {
  const { workspace, user, repo, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Workflows"
      note="When something happens, Dialvo does the next steps for you: research the company, add the lead to a play, give it to a teammate, change its stage, post to Slack, call your webhook, make a task or add a note. Every run is logged with why each step ran or was skipped."
    >
      {admin && !preview && (
        <Link href="/app/workflows/new" className={btn.primary}>
          <Plus aria-hidden className="size-4" />
          New workflow
        </Link>
      )}
    </PageHead>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={Zap} title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const [workflows, tasks, runs, members] = await Promise.all([
    supabase
      .from("workflows")
      .select("id, name, enabled, trigger, steps, last_run_at, runs_total")
      .eq("workspace_id", workspace.id)
      .order("created_at"),
    supabase
      .from("workflow_tasks")
      .select("id, title, due_at, assignee_id, lead:leads(id, name, email)")
      .eq("workspace_id", workspace.id)
      .eq("status", "open")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(50),
    supabase
      .from("workflow_runs")
      .select(
        "id, trigger, status, event, log, created_at, workflow:workflows(name), lead:leads(id, name, email)",
      )
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(20),
    repo.members(),
  ]);
  const list = (workflows.data ?? []) as unknown as WorkflowRow[];
  const openTasks = (tasks.data ?? []) as unknown as TaskRow[];
  const names = new Map(members.map((m) => [m.user_id, m.name || m.email]));

  return (
    <>
      {head}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Your workflows
              <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
                {list.length} of {WORKFLOWS_MAX}
              </span>
            </h2>
            {list.length === 0 ? (
              <Empty
                icon={Zap}
                title="No workflows yet"
                action={
                  admin ? (
                    <Link href="/app/workflows/new" className={btn.secondary}>
                      Make your first
                    </Link>
                  ) : undefined
                }
              >
                For example: when a reply is sorted as interested, give the lead
                to its owner, change its stage to qualified and post to Slack.
              </Empty>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {list.map((w) => (
                  <li key={w.id}>
                    <Link
                      href={`/app/workflows/${w.id}`}
                      className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-[13px] hover:bg-black/[0.02]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{w.name}</span>
                        <span className="block text-[12.5px] text-[#0B0B0C]/60">
                          {TRIGGER_LABEL[w.trigger]} →{" "}
                          {w.steps
                            .map(
                              (s) =>
                                ACTION_LABEL[s.action]?.split(" (")[0] ??
                                s.action,
                            )
                            .join(", then ")}
                        </span>
                        <span className="block text-[11.5px] text-[#0B0B0C]/40">
                          {w.runs_total} {w.runs_total === 1 ? "run" : "runs"}
                          {w.last_run_at && `, last ${agoWords(w.last_run_at)}`}
                        </span>
                      </span>
                      <Badge tone={w.enabled ? "ink" : "outline"}>
                        {w.enabled ? "On" : "Off"}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Latest runs</h2>
            <RunList
              runs={(runs.data ?? []) as unknown as RunRow[]}
              showWorkflow
            />
          </section>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Tasks
              <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
                {openTasks.length} open
              </span>
            </h2>
            {openTasks.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-[#0B0B0C]/50">
                Nothing to do. Workflows with a &quot;create a task&quot; step
                put tasks here.
              </p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {openTasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start gap-2 px-4 py-2.5 text-[13px]"
                  >
                    <ActionForm action={setTaskDone} quiet>
                      <input type="hidden" name="task" value={t.id} />
                      <input type="hidden" name="done" value="true" />
                      <SubmitButton
                        small
                        variant="secondary"
                        pendingText="…"
                        aria-label="Mark done"
                      >
                        Done
                      </SubmitButton>
                    </ActionForm>
                    <span className="min-w-0 flex-1">
                      <span className="block">{t.title}</span>
                      <span className="block text-[11.5px] text-[#0B0B0C]/45">
                        {t.assignee_id
                          ? t.assignee_id === user.id
                            ? "You"
                            : (names.get(t.assignee_id) ?? "A teammate")
                          : "The team"}
                        {t.due_at &&
                          ` · due ${dateOnly(t.due_at, workspace.timezone)}`}
                        {t.lead && (
                          <>
                            {" · "}
                            <Link
                              href={`/app/leads/${t.lead.id}`}
                              className="underline underline-offset-2"
                            >
                              {t.lead.name || t.lead.email || "the lead"}
                            </Link>
                          </>
                        )}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={cn(panel, "p-4")}>
            <p className={hint}>
              Up to {WORKFLOW_RUNS_PER_DAY} runs a day per workspace. A
              workflow&apos;s own changes (a stage it sets, a lead it assigns)
              don&apos;t start other workflows, so they can&apos;t loop. Nothing
              a workflow does sends an email by itself: a lead added to a play
              gets a first email that waits for approval under that play&apos;s
              rules.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

export default function WorkflowsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
