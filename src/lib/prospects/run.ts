import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  DAILY_SEARCH_CAP,
  DAILY_SPEND_CAP_MICROS,
  DRAFTS_PER_STEP,
  prospectRuntimeStatus,
  SEARCHES_PER_ROUND,
} from "./config";
import {
  advanceContactRun,
  defaultContactDeps,
  type ContactDeps,
} from "./contact-run";
import {
  draftFirstEmail,
  findCompanies,
  researchCompany,
  type ModelClient,
} from "./model";
import { readSite, type FetchSource } from "./site";
import { createProspectStore, type ProspectStore } from "./store";
import { NO_SPEND, type RunStatus } from "./types";

// HOW A RUN GETS DONE WITHOUT A LONG-RUNNING PROCESS
//
// Finding and reading 25 companies takes minutes; a serverless request
// should take seconds. So a run is a row in the database (prospect_runs) and
// advanceRun() below does ONE short step of it and returns:
//
//   searching    one model call that runs a few web searches and stores the
//                companies it found as candidates. Repeats until there are
//                enough, or the search has run dry.
//   researching  reads the websites of the next two candidates and stores
//                what was found. Repeats until none are left.
//   done / stopped / failed
//
// Every step starts by claiming the run in the database
// (prospect_run_claim). The claim takes a lease, so two callers never work
// the same run at once: the second is told "busy" and does nothing. A step
// that dies (a timeout, a deploy) simply leaves its lease to expire after
// 90 seconds; the next call picks up where the database says the run is,
// and the companies that step was reading are handed out again. Results are
// written only for rows still marked as being worked on, so a late or
// repeated write changes nothing. All state is in the database; nothing is
// kept in memory between steps.
//
// What calls advanceRun: the open "Find leads" page, about once every two
// seconds while a run is active (POST /api/prospects/runs/[id]/advance,
// signed in). Because a step is idempotent and leased, anything else may
// call it too: a scheduled job can later sweep runs whose page was closed,
// with no change here. Until then, a run whose page is closed waits and
// continues when someone opens the page again.
//
// The longest a step can take: one search round (40 s limit), or two
// companies side by side, each at most 10 s for the home page, 10 s for its
// contact and about pages, 25 s for the model. Every cap is in config.ts.

export type StepDeps = {
  store: ProspectStore | null;
  client: ModelClient | null;
  /** For tests: reads a page without the network. */
  fetchSource?: FetchSource;
  /** The contact database (Findymail), when its key is set. */
  contacts?: ContactDeps | null;
};

/** The real database and model, or nulls when their keys aren't set. */
export function defaultDeps(): StepDeps {
  if (!prospectRuntimeStatus().on) return { store: null, client: null };
  // Reads ANTHROPIC_API_KEY from the environment.
  return {
    store: createProspectStore(),
    client: new Anthropic(),
    contacts: defaultContactDeps(),
  };
}

export type StepResult = {
  status: RunStatus | "busy" | "not_configured" | "not_found";
  stop_reason?: string | null;
};

export async function advanceRun(
  input: { runId: string; workspaceId: string },
  deps: StepDeps = defaultDeps(),
): Promise<StepResult> {
  const { store, client } = deps;
  if (!store || !client) return { status: "not_configured" };
  const { runId, workspaceId } = input;
  // A run that uses the contact database finds its companies there (see
  // contact-run.ts); from reading their sites on, it is like any other.
  if (deps.contacts) {
    const contact = await advanceContactRun(input, store, deps.contacts);
    if (contact) return contact;
  }
  const claim = await store.claim(runId, workspaceId);
  if (!claim) return { status: "not_found" };
  if (claim.status !== "searching" && claim.status !== "researching")
    return {
      status: claim.status,
      stop_reason: "stop_reason" in claim ? claim.stop_reason : null,
    };

  const end = async (status: "stopped" | "failed", reason: string) => {
    await store.release(runId, workspaceId, { status, reason });
    return { status, stop_reason: reason } as const;
  };

  try {
    // The day's budget is checked before anything is spent.
    if (claim.usage.cost_micros >= DAILY_SPEND_CAP_MICROS)
      return await end("stopped", "daily_limit");

    if (claim.status === "searching") {
      const searchesLeft = DAILY_SEARCH_CAP - claim.usage.searches;
      if (searchesLeft <= 0) {
        // Out of searches for today. Read what was found so far, if anything.
        const moved = await store.addCandidates(
          runId,
          workspaceId,
          [],
          NO_SPEND,
        );
        if (moved?.status === "searching")
          return await end("stopped", "daily_limit");
        return { status: moved?.status ?? "stopped" };
      }
      const found = await findCompanies(client, {
        brief: claim.run.brief,
        known: claim.known,
        wanted: claim.run.target_count - claim.run.found,
        searches: Math.min(SEARCHES_PER_ROUND, searchesLeft),
      });
      if (!found.ok) {
        if (found.reason === "not_authorised")
          return await end("failed", "not_authorised");
        // A refusal won't change on a second try. Anything else is counted
        // as a round that found nobody, so a run can't loop on failures.
        if (found.reason === "refused") return await end("failed", "refused");
        const moved = await store.addCandidates(
          runId,
          workspaceId,
          [],
          found.spend,
        );
        return { status: moved?.status ?? "searching" };
      }
      const stored = await store.addCandidates(
        runId,
        workspaceId,
        found.candidates,
        found.spend,
      );
      return { status: stored?.status ?? "searching" };
    }

    // Researching: read each company's own site, then ask what it says.
    const outcomes = await Promise.all(
      claim.work.map(async (company) => {
        const site = await readSite(company.website, deps.fetchSource);
        if (!site.ok) {
          // An unreachable site is tried once more on a later step; one
          // that turns out not to be a company's site, or asks robots not
          // to read it, is not.
          await store.saveResearch(
            runId,
            workspaceId,
            company.id,
            site.problem === "no_website" ||
              site.problem === "robots_disallowed"
              ? { status: "skipped", reason: site.problem }
              : { status: "retry" },
            NO_SPEND,
          );
          return null;
        }
        const read = await researchCompany(client, {
          brief: claim.run.brief,
          pages: site.pages,
          fallbackName: company.company_name,
        });
        await store.saveResearch(
          runId,
          workspaceId,
          company.id,
          read.ok ? read.result : { status: "retry" },
          read.spend,
        );
        return read.ok ? null : read.reason;
      }),
    );
    if (outcomes.includes("not_authorised"))
      return await end("failed", "not_authorised");
    await store.release(runId, workspaceId);
    return { status: "researching" };
  } catch (error) {
    // Leave the run as it is: the lease expires and the next call carries on.
    console.error("[prospects] step failed:", (error as Error).message);
    await store.release(runId, workspaceId).catch(() => {});
    return { status: claim.status };
  }
}

export type DraftStepResult = {
  status: "ok" | "capped" | "not_configured" | "not_found";
  written: number;
  failed: number;
  /** Kept prospects with an email that still have no draft. */
  remaining: number;
};

/**
 * Writes the next few first emails for a workspace's kept prospects. Like a
 * run's step: short, safe to call again, and safe to call twice at once
 * (each draft row is reserved in the database before it is written).
 */
export async function advanceDrafts(
  input: { workspaceId: string; userId: string },
  deps: StepDeps = defaultDeps(),
): Promise<DraftStepResult> {
  const { store, client } = deps;
  const none = { written: 0, failed: 0, remaining: 0 };
  if (!store || !client) return { status: "not_configured", ...none };
  const claim = await store.claimDrafts(
    input.workspaceId,
    input.userId,
    DRAFTS_PER_STEP,
  );
  if (!claim) return { status: "not_found", ...none };
  if (claim.drafts.length === 0)
    return {
      status: claim.capped && claim.remaining > 0 ? "capped" : "ok",
      ...none,
      remaining: claim.remaining,
    };
  const results = await Promise.all(
    claim.drafts.map(async ({ draft_id, prospect }) => {
      try {
        const written = await draftFirstEmail(client, {
          context: claim.context,
          prospect,
        });
        await store.saveDraft(
          input.workspaceId,
          draft_id,
          written.ok
            ? {
                subject: written.subject,
                body: written.body,
                model: written.model,
              }
            : null,
          written.spend.cost_micros,
        );
        return written.ok;
      } catch (error) {
        console.error("[prospects] draft failed:", (error as Error).message);
        await store
          .saveDraft(input.workspaceId, draft_id, null, 0)
          .catch(() => {});
        return false;
      }
    }),
  );
  const written = results.filter(Boolean).length;
  return {
    status: "ok",
    written,
    failed: results.length - written,
    remaining: claim.remaining,
  };
}
