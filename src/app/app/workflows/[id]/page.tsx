import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { isUuid } from "@/lib/leads/fields";
import { createClient } from "@/lib/supabase/server";
import type { Condition, Trigger, TriggerConfig } from "@/lib/workflows/types";
import { cn } from "@/lib/utils";
import { CopyOnce } from "../hook-copy";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  hint,
  input,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import {
  deleteWorkflow,
  makeWorkflowHook,
  runWorkflowNow,
  saveWorkflow,
  setWorkflowEnabled,
} from "../actions";
import { WorkflowBuilder, type BuilderInitial } from "../builder";
import { builderOptions } from "../options";
import { RunList, type RunRow } from "../runs";

export const metadata: Metadata = { title: "Workflow" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, repo, preview } = await getAppContext();
  if (preview) notFound();
  const admin = workspace.role !== "member";
  const isNew = id === "new";
  if (!isNew && !isUuid(id)) notFound();
  const supabase = await createClient();
  const options = await builderOptions(supabase, repo, workspace.id);
  let initial: BuilderInitial = {
    id: null,
    name: "",
    enabled: true,
    trigger: "lead_created",
    trigger_config: {},
    conditions: [],
    steps: [],
  };
  let hookPrefix: string | null = null;
  let runs: RunRow[] = [];
  if (!isNew) {
    const { data } = await supabase
      .from("workflows")
      .select(
        "id, name, enabled, trigger, trigger_config, conditions, steps, hook_prefix",
      )
      .eq("workspace_id", workspace.id)
      .eq("id", id)
      .maybeSingle();
    if (!data) notFound();
    const w = data as {
      id: string;
      name: string;
      enabled: boolean;
      trigger: Trigger;
      trigger_config: TriggerConfig;
      conditions: Condition[];
      steps: BuilderInitial["steps"];
      hook_prefix: string | null;
    };
    initial = { ...w };
    hookPrefix = w.hook_prefix;
    const r = await supabase
      .from("workflow_runs")
      .select(
        "id, trigger, status, event, log, created_at, lead:leads(id, name, email)",
      )
      .eq("workspace_id", workspace.id)
      .eq("workflow_id", id)
      .order("created_at", { ascending: false })
      .limit(30);
    runs = (r.data ?? []) as unknown as RunRow[];
  }

  return (
    <>
      <Link
        href="/app/workflows"
        className="mb-3 inline-flex items-center gap-1.5 px-1 text-[12.5px] text-[#0B0B0C]/55 hover:text-[#0B0B0C]"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Workflows
      </Link>
      <PageHead title={isNew ? "New workflow" : initial.name} />
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <WorkflowBuilder
            initial={initial}
            options={options}
            action={saveWorkflow}
            admin={admin}
          />
        </div>
        {!isNew && (
          <div className="flex min-w-0 flex-col gap-3">
            {admin && (
              <section className={panel}>
                <h2 className={panelHead}>Run it</h2>
                <div className="space-y-3 p-4">
                  <ActionForm action={setWorkflowEnabled} quiet>
                    <input type="hidden" name="id" value={id} />
                    <input
                      type="hidden"
                      name="enabled"
                      value={initial.enabled ? "false" : "true"}
                    />
                    <SubmitButton small variant="secondary">
                      {initial.enabled ? "Switch off" : "Switch on"}
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={runWorkflowNow} className="space-y-2">
                    <input type="hidden" name="id" value={id} />
                    {initial.trigger !== "schedule" && (
                      <label className="block text-[12.5px] text-[#0B0B0C]/75">
                        Test on one lead (their email)
                        <input
                          name="email"
                          type="email"
                          maxLength={254}
                          className={cn(input, "mt-1")}
                        />
                      </label>
                    )}
                    <SubmitButton small pendingText="Queuing…">
                      {initial.trigger === "schedule"
                        ? "Run the schedule now"
                        : "Run now"}
                    </SubmitButton>
                    <p className={hint}>
                      A run by hand skips the trigger&apos;s own filter but
                      checks the conditions.
                    </p>
                  </ActionForm>
                </div>
              </section>
            )}
            {initial.trigger === "webhook" && admin && (
              <section className={panel}>
                <h2 className={panelHead}>Its webhook address</h2>
                <div className="space-y-2 p-4 text-[13px]">
                  <p className={hint}>
                    {hookPrefix
                      ? `An address starting ${hookPrefix}… is in use. Making a new one stops the old one.`
                      : "No address yet."}{" "}
                    POST a JSON object to it (up to 8 KB); add &quot;email&quot;
                    to run it for that lead, and an Idempotency-Key header to
                    run a call once.
                  </p>
                  <CopyOnce
                    action={makeWorkflowHook}
                    id={id}
                    label={
                      hookPrefix ? "Make a new address" : "Make the address"
                    }
                  />
                </div>
              </section>
            )}
            <section className={panel}>
              <h2 className={panelHead}>Runs</h2>
              <RunList runs={runs} />
            </section>
            {admin && (
              <ActionForm
                action={deleteWorkflow}
                confirm="Delete this workflow and its run log?"
              >
                <input type="hidden" name="id" value={id} />
                <SubmitButton small variant="danger" pendingText="Deleting…">
                  Delete workflow
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function Page({ params }: PageProps<"/app/workflows/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
