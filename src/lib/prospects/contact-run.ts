import "server-only";
import {
  CONTACT_CREDITS_PER_COMPANY,
  CONTACT_POLL_SECONDS,
  contactDatabaseStatus,
} from "./config";
import { createContactStore, type ContactStore } from "./contact-store";
import {
  createFindymailClient,
  type Failure,
  type FindymailClient,
} from "./findymail";
import { companiesAffordable, enoughCredits } from "./findymail-parse";
import type { ProspectStore } from "./store";
import type { RunStatus } from "./types";

// THE CONTACT DATABASE'S PART OF A RUN
//
// A run that uses Findymail (prospect_runs.source = 'findymail') looks for
// companies this way instead of with the web search. Each call does one
// short step, under the same lease as every other step (see run.ts):
//
//   start   1. GET /api/credits (free): is the account able to pay at all?
//           2. The workspace's own exclusion list: made on first use, and
//              sent the domains the workspace already has or never wants
//              (free), so they aren't paid for again.
//           3. The day's credit cap, in the database: the companies this run
//              may ask for are reserved there before anything is spent.
//           4. POST /api/intellimatch/search, the one call that costs
//              credits, for at most that many companies, each with a named
//              contact and a verified email (require_email: companies
//              without one aren't charged).
//   wait    GET /api/intellimatch/status (free), every few seconds, or after
//           the retry_after Findymail asks for, until the export is ready.
//   read    GET /api/intellimatch/data (free), page by page. Each company is
//           checked (findymail-parse.ts) and stored unless the workspace
//           already has it, it is on the suppression list or it is a lead.
//           Credits reserved for companies that weren't returned are given
//           back to the day.
//
// Then the run reads each company's own site, exactly as a web run does
// (run.ts), for the facts a first email can use. That reading never replaces
// the contact or the email Findymail returned (prospect_save_research).

export type ContactDeps = {
  contacts: ContactStore;
  findymail: FindymailClient;
};

/** The real contact database, or null without its key (or the secret key). */
export function defaultContactDeps(): ContactDeps | null {
  if (!contactDatabaseStatus().on) return null;
  const contacts = createContactStore();
  const findymail = createFindymailClient();
  return contacts && findymail ? { contacts, findymail } : null;
}

/** The name of a workspace's exclusion list in the Findymail account. */
export const exclusionListName = (workspaceId: string) =>
  `Dialvo workspace ${workspaceId}`;

type Result = {
  status: RunStatus | "busy" | "not_found";
  stop_reason?: string | null;
};

/**
 * One step of a contact-database run, or null when the run isn't one (or is
 * past its search): the caller then does the usual step.
 */
export async function advanceContactRun(
  input: { runId: string; workspaceId: string },
  store: ProspectStore,
  deps: ContactDeps,
): Promise<Result | null> {
  const { runId, workspaceId } = input;
  const { contacts, findymail } = deps;
  const claim = await contacts.claim(runId, workspaceId);
  if (!claim) return { status: "not_found" };
  if (claim.status === "not_contact") return null;
  // Too early to ask again: the page waits a little longer and calls back.
  if (claim.status === "busy" || claim.status === "waiting")
    return { status: "busy" };
  if (claim.status === "stopped") return claim;

  const end = async (
    status: "stopped" | "failed",
    reason: string,
    refundCredits = 0,
  ): Promise<Result> => {
    if (refundCredits > 0)
      await contacts.step(runId, workspaceId, { refundCredits });
    await store.release(runId, workspaceId, { status, reason });
    return { status, stop_reason: reason };
  };
  const wait = async (seconds: number): Promise<Result> => {
    await contacts.step(runId, workspaceId, { waitSeconds: seconds });
    return { status: "searching" };
  };
  /** What to do about a problem that isn't specific to one call. */
  const common = async (failure: Failure, refund = 0): Promise<Result> => {
    switch (failure.problem) {
      case "unauthenticated":
        console.error("[prospects] the Findymail key was refused");
        return end("failed", "contact_not_authorised", refund);
      case "no_credits":
      case "paused":
        return end("failed", "contact_no_credits", refund);
      case "rate_limited":
        return wait(failure.retryAfter ?? 30);
      default:
        return wait(CONTACT_POLL_SECONDS * 3);
    }
  };

  try {
    if (claim.phase === "start") {
      // 1. Can the account pay at all? (Free.)
      const credits = await findymail.credits();
      if (!credits.ok) return await common(credits);
      if (!enoughCredits(credits.value, CONTACT_CREDITS_PER_COMPANY))
        return await end("failed", "contact_no_credits");
      const affordable = companiesAffordable(
        credits.value,
        CONTACT_CREDITS_PER_COMPANY,
      );

      // 2. The workspace's exclusion list, kept up to date. (Free.)
      let listId = claim.exclusion_list_id;
      if (!listId) {
        const list = await findymail.exclusionList(
          exclusionListName(workspaceId),
        );
        if (!list.ok && list.problem === "unauthenticated")
          return await common(list);
        if (!list.ok && list.problem === "rate_limited")
          return await common(list);
        if (list.ok) {
          listId = list.value;
          await contacts.setList(workspaceId, listId);
        }
      }
      if (listId) {
        const known = await contacts.exclusions(workspaceId);
        if (known.domains.length > 0) {
          const sent = await findymail.addExclusions(listId, known.domains);
          if (!sent.ok && sent.problem === "unauthenticated")
            return await common(sent);
          if (!sent.ok && sent.problem === "rate_limited")
            return await common(sent);
          if (sent.ok) await contacts.synced(workspaceId, known.read_at);
          // Otherwise carry on: the database still leaves out what the
          // workspace has; only some credits may be spent on it.
        } else await contacts.synced(workspaceId, known.read_at);
      }

      // 3. The day's cap, reserved in the database before anything is spent.
      const wanted = Math.min(claim.target_count, affordable ?? Infinity);
      const granted = await contacts.reserve(runId, workspaceId, wanted);
      if (granted <= 0)
        return await end(
          wanted <= 0 ? "failed" : "stopped",
          wanted <= 0 ? "contact_no_credits" : "contact_daily_limit",
        );
      const reserved = granted * CONTACT_CREDITS_PER_COMPANY;

      // 4. The search: the one call that costs credits.
      const started = await findymail.startSearch({
        query: claim.query,
        limit: granted,
        titles: claim.titles,
        exclusionListId: listId,
      });
      if (!started.ok) {
        // Refused outright, so nothing was charged: give the day its
        // credits back. A timeout is different: the search may have
        // started, so the reservation stands and the run stops.
        if (started.problem === "invalid")
          return await end("failed", "contact_query_refused", reserved);
        if (
          started.problem === "unavailable" ||
          started.problem === "unreadable"
        )
          return await end("failed", "contact_unavailable");
        return await common(
          started,
          started.problem === "rate_limited" ? 0 : reserved,
        );
      }
      await contacts.step(runId, workspaceId, {
        phase: "wait",
        hash: started.value,
        waitSeconds: CONTACT_POLL_SECONDS,
      });
      return { status: "searching" };
    }

    const hash = claim.hash;
    if (!hash) return await end("failed", "contact_unavailable");

    if (claim.phase === "wait") {
      const status = await findymail.status(hash);
      if (!status.ok) {
        if (status.problem === "not_found")
          return await end("failed", "contact_expired");
        return await common(status);
      }
      if (status.value === "failed")
        return await end(
          "failed",
          "contact_failed",
          claim.limit ? claim.limit * CONTACT_CREDITS_PER_COMPANY : 0,
        );
      if (status.value === "not_found")
        return await end("failed", "contact_expired");
      if (status.value !== "success") return await wait(CONTACT_POLL_SECONDS);
      // Ready: read the first page in this same step.
    }

    const pageNumber = claim.phase === "read" ? claim.page : 1;
    const page = await findymail.page(hash, pageNumber);
    if (!page.ok) {
      // "Not found or not ready yet": ask again shortly.
      if (page.problem === "not_found") return await wait(CONTACT_POLL_SECONDS);
      return await common(page);
    }
    const last =
      page.value.last ||
      page.value.returned === 0 ||
      // Never more pages than the companies asked for could fill.
      pageNumber >= 20;
    const stored = await contacts.add(
      runId,
      workspaceId,
      page.value.rows,
      page.value.returned,
      last,
    );
    return { status: (stored?.status as RunStatus | undefined) ?? "searching" };
  } catch (error) {
    // Leave the run as it is: the lease expires and the next call carries on.
    console.error("[prospects] contact step failed:", (error as Error).message);
    await store.release(runId, workspaceId).catch(() => {});
    return { status: "searching" };
  }
}
