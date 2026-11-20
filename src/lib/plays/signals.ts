import "server-only";
import { CREDITS_SIGNAL_KEEP, SIGNAL_PAGES_PER_PULL } from "./config";
import type { MonitorInput, PlaysFindymail } from "./findymail";
import type { PlayStore } from "./store";

// Buying signals (inside Find leads). A workspace's monitors live in the
// one Findymail account Dialvo uses; each is mirrored in signal_monitors and
// only ever read by its own workspace's id. Once a day the scheduler pulls
// what each monitor found (pullSignals, POST /api/prospects/signals/step);
// "Keep" on a signal finds that person's email (one lookup) and makes them a
// prospect whose first email opens with the signal.

export type SignalDeps = { store: PlayStore; findymail: PlaysFindymail };

/** Makes a monitor: a row here first, then in Findymail. */
export async function createMonitor(
  input: { workspaceId: string; userId: string; monitor: MonitorInput },
  deps: SignalDeps,
): Promise<"created" | "capped" | "invalid" | "refused" | "not_found"> {
  const { monitor } = input;
  const begun = await deps.store.monitorBegin(input.workspaceId, input.userId, {
    name: monitor.name,
    type: monitor.signal_type,
    keywords: monitor.keywords,
    filters: {
      countries: monitor.countries,
      employee_count_ranges: monitor.employee_count_ranges,
    },
    targetCompanies: monitor.target_companies,
    maxMatches: monitor.max_matches,
  });
  if (begun.status !== "created" || !begun.id)
    return begun.status as "capped" | "invalid" | "not_found";
  const made = await deps.findymail.createMonitor(monitor);
  await deps.store.monitorMade(
    input.workspaceId,
    begun.id,
    made.ok ? made.value : null,
    made.ok ? null : made.problem,
  );
  return made.ok ? "created" : "refused";
}

/** Takes a monitor off, in Findymail too (so it stops charging). */
export async function removeMonitor(
  input: { workspaceId: string; userId: string; monitorId: string },
  deps: SignalDeps,
): Promise<boolean> {
  const row = await deps.store.monitorRemove(
    input.workspaceId,
    input.userId,
    input.monitorId,
  );
  if (!row) return false;
  if (row.external_id) {
    const gone = await deps.findymail.deleteMonitor(row.external_id);
    // Left as "removing": the next try deletes it in Findymail.
    if (!gone.ok) return false;
  }
  await deps.store.monitorRemoved(input.workspaceId, input.monitorId);
  return true;
}

export type PullResult = {
  monitors: number;
  added: number;
  skipped: number;
  over: number;
  failed: number;
};

/** The scheduler's step: pulls the monitors that are due. */
export async function pullSignals(deps: SignalDeps): Promise<PullResult> {
  const result: PullResult = {
    monitors: 0,
    added: 0,
    skipped: 0,
    over: 0,
    failed: 0,
  };
  const due = await deps.store.pullClaim();
  for (const m of due) {
    result.monitors += 1;
    try {
      let page = 1;
      let last = false;
      const rows = [];
      while (page <= SIGNAL_PAGES_PER_PULL && !last) {
        const got = await deps.findymail.signals(m.external_id, m.since, page);
        if (!got.ok) throw new Error(got.problem);
        rows.push(...got.value.rows);
        last = got.value.last;
        page += 1;
      }
      const stored = await deps.store.ingest(
        m.workspace_id,
        m.monitor_id,
        rows,
        true,
      );
      result.added += stored?.added ?? 0;
      result.skipped += stored?.skipped ?? 0;
      result.over += stored?.over ?? 0;
    } catch (error) {
      result.failed += 1;
      console.error("[signals] pull failed:", (error as Error).message);
      await deps.store
        .pullRelease(m.workspace_id, m.monitor_id)
        .catch(() => {});
    }
  }
  return result;
}

/** "Keep": one email lookup, then a prospect with the signal as its fact. */
export async function keepSignal(
  input: { workspaceId: string; userId: string; signalId: string },
  deps: SignalDeps,
): Promise<
  "kept" | "no_email" | "skipped" | "capped" | "not_found" | "failed"
> {
  const begun = await deps.store.keepBegin(
    input.workspaceId,
    input.userId,
    input.signalId,
  );
  if (begun.status === "skipped") return "skipped";
  if (begun.status === "capped") return "capped";
  if (begun.status !== "ok" || !begun.contact_name || !begun.domain)
    return "not_found";
  const found = await deps.findymail.email(begun.contact_name, begun.domain);
  if (!found.ok) {
    // Nothing was charged: the credit goes back, and the signal can be
    // kept again in two minutes (signal_keep_begin takes it back then).
    await deps.store.reserveCredits(input.workspaceId, -CREDITS_SIGNAL_KEEP);
    return "failed";
  }
  const done = await deps.store.keepFinish(
    input.workspaceId,
    input.signalId,
    found.value,
    // Findymail charges only when an email is found.
    Boolean(found.value) && CREDITS_SIGNAL_KEEP > 0,
  );
  return done as "kept" | "no_email" | "skipped";
}
