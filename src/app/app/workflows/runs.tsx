import { agoWords } from "@/lib/app/time";
import type { LogLine } from "@/lib/workflows/engine";
import { TRIGGER_LABEL, type Trigger } from "@/lib/workflows/types";
import { Badge } from "../_ui/kit";

// A workflow run's log: one line per step, with what happened and why.

export type RunRow = {
  id: string;
  trigger: string;
  status: string;
  event: { summary?: string };
  log: LogLine[];
  created_at: string;
  workflow?: { name: string } | null;
  lead?: { id: string; name: string; email: string | null } | null;
};

const RUN_STATUS: Record<string, string> = {
  pending: "Waiting",
  running: "Running",
  done: "Done",
  skipped: "Skipped",
  failed: "Failed",
};

export function RunList({
  runs,
  showWorkflow = false,
}: {
  runs: RunRow[];
  showWorkflow?: boolean;
}) {
  if (runs.length === 0)
    return (
      <p className="px-4 py-6 text-center text-[13px] text-[#0B0B0C]/50">
        No runs yet.
      </p>
    );
  return (
    <ul className="divide-y divide-black/[0.06]">
      {runs.map((r) => (
        <li key={r.id} className="px-4 py-2.5 text-[13px]">
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {showWorkflow && r.workflow ? `${r.workflow.name}: ` : ""}
                  {r.event?.summary ||
                    TRIGGER_LABEL[r.trigger as Trigger] ||
                    r.trigger}
                </span>
                <span className="block text-[11.5px] text-[#0B0B0C]/45">
                  {r.lead
                    ? `${r.lead.name || r.lead.email || "A lead"} · `
                    : ""}
                  {agoWords(r.created_at)}
                </span>
              </span>
              <Badge
                tone={
                  r.status === "failed"
                    ? "warn"
                    : r.status === "done"
                      ? "plain"
                      : "outline"
                }
              >
                {RUN_STATUS[r.status] ?? r.status}
              </Badge>
            </summary>
            {r.log.length > 0 && (
              <ol className="mt-2 space-y-1 border-l border-black/10 pl-3 text-[12.5px] leading-[1.45]">
                {r.log.map((l, i) => (
                  <li key={i}>
                    <span className="font-medium">
                      {l.step > 0
                        ? `Step ${l.step}`
                        : l.action === "trigger"
                          ? "Trigger"
                          : l.action === "condition"
                            ? "Condition"
                            : "Run"}
                      {": "}
                      {l.outcome === "done"
                        ? "done"
                        : l.outcome === "skipped"
                          ? "skipped"
                          : "failed"}
                    </span>
                    <span className="text-[#0B0B0C]/65"> · {l.why}</span>
                  </li>
                ))}
              </ol>
            )}
          </details>
        </li>
      ))}
    </ul>
  );
}
