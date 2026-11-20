import "server-only";
import {
  MAX_JOB_ATTEMPTS,
  PULL_PAGES_PER_STEP,
  PUSH_BATCH,
  RETRY_BASE_SECONDS,
  RETRY_MAX_SECONDS,
  STEP_BUDGET_MS,
} from "./config";
import {
  chatNote,
  companyDomain,
  companyName,
  dealTitle,
  emailNote,
  marker,
  meetingInput,
  optOutNote,
} from "./content";
import { createHubspotClient } from "./hubspot";
import { realHttpDeps, type HttpDeps } from "./http";
import { createPipedriveClient } from "./pipedrive";
import type { CrmStore, JobOutcome } from "./store";
import {
  CrmError,
  PROVIDER_NAME,
  type ChatDetail,
  type CrmClient,
  type Credentials,
  type EmailDetail,
  type Job,
  type LinkUpdate,
  type MeetingDetail,
} from "./types";

// The two background steps, called by the scheduler (POST /api/crm/step)
// and by "Sync now" in Settings:
//
//   pushStep  claims a batch of queued jobs and writes each to the CRM.
//   pullStep  reads the next pages of one CRM's contacts and companies into
//             the "already in your CRM" list.
//
// Both are short and safe to repeat. A job is claimed with a lease before
// anything is written, so two steps never write the same job; a step that
// dies leaves the lease to run out and the job is picked up again. What a
// retry could write twice (a note, a meeting, a deal) carries a marker, and
// a retry looks for it in the CRM before writing. Contacts are matched by
// email and companies by domain (HubSpot) or exact name (Pipedrive) before
// anything is created. A contact that was already in the CRM is never
// changed: Dialvo only adds its notes to it.

export type StepDeps = {
  store: CrmStore;
  http?: HttpDeps;
  clientFor?: (credentials: Credentials) => CrmClient | null;
  random?: () => number;
};

export function clientFor(
  credentials: Credentials,
  http: HttpDeps = realHttpDeps(),
): CrmClient | null {
  if (credentials.provider === "hubspot")
    return createHubspotClient(credentials.token, http);
  if (credentials.provider === "pipedrive" && credentials.api_domain)
    return createPipedriveClient(
      credentials.token,
      credentials.api_domain,
      http,
    );
  return null;
}

/** 30 s, 1 min, 2 min, ... at most 6 h, plus up to a fifth more. */
export function backoffSeconds(attempts: number, random = Math.random): number {
  const base = Math.min(
    RETRY_BASE_SECONDS * 2 ** Math.max(attempts - 1, 0),
    RETRY_MAX_SECONDS,
  );
  return Math.round(base * (1 + random() * 0.2));
}

type Result = {
  outcome: JobOutcome;
  error?: string;
  externalId?: string;
  link?: LinkUpdate;
};

class Skip extends Error {}

/** Writes one job to the CRM. Throws CrmError when the CRM says no. */
export async function processJob(
  job: Job,
  client: CrmClient,
  link: LinkUpdate,
): Promise<Result> {
  const { lead } = job;
  const crm = PROVIDER_NAME[client.provider];
  if (!job.detail)
    throw new Skip("What this was about has been deleted in Dialvo.");
  const email = lead.email;
  if (!email)
    throw new Skip(
      `This lead has no email address, so it can't be matched to a contact in ${crm}.`,
    );
  const ref = marker(job.workspace_id, job.source_key);
  const retrying = job.attempts > 1;

  // The person (and their company), found or added.
  let contactId = job.link?.contact_id ?? null;
  let companyId = job.link?.company_id ?? null;
  // A contact job always matches by email again (the CRM's record may have
  // been merged or deleted); so does any job that has failed twice.
  if (!contactId || job.kind === "contact" || job.attempts > 2) {
    const domain = companyDomain(lead);
    if (domain && !companyId) {
      const name = companyName(lead, domain);
      const found = await client.findCompany(domain, name);
      if (found) companyId = found.id;
      else {
        companyId = (await client.createCompany(domain, name)).id;
        link.company_created = true;
      }
      link.company_id = companyId;
      link.company_domain = domain;
    }
    const found = await client.findContact(email);
    if (found) {
      contactId = found.id;
      // HubSpot's association call is idempotent; Pipedrive's person has
      // one organisation, which is left alone if it already has one.
      if (companyId && (client.provider === "hubspot" || !found.companyId))
        await client.linkContactToCompany(contactId, companyId);
      if (found.companyId && !companyId) companyId = found.companyId;
    } else {
      try {
        contactId = (await client.createContact(lead, companyId)).id;
        link.contact_created = true;
      } catch (error) {
        // Added in the CRM a moment ago by someone else.
        if (!(error instanceof CrmError && error.kind === "conflict"))
          throw error;
        const again = await client.findContact(email);
        if (!again) throw error;
        contactId = again.id;
      }
    }
    link.contact_id = contactId;
  }

  switch (job.kind) {
    case "contact":
      return { outcome: "done", externalId: contactId };

    case "note": {
      const detail = job.detail as ChatDetail | EmailDetail;
      const html =
        detail.type === "chat" ? chatNote(detail, ref) : emailNote(detail, ref);
      const at = detail.type === "chat" ? detail.started_at : detail.sent_at;
      const earlier = retrying ? await client.findNote(contactId, ref) : null;
      const id =
        earlier ?? (await client.createNote(contactId, companyId, html, at));
      return { outcome: "done", externalId: id };
    }

    case "meeting": {
      const input = meetingInput(job.detail as MeetingDetail, ref);
      const existing =
        job.external_id ??
        (retrying ? await client.findMeeting(contactId, ref) : null);
      const id = await client.saveMeeting(
        existing,
        contactId,
        companyId,
        input,
      );
      return { outcome: "done", externalId: id };
    }

    case "deal": {
      const pipeline = job.connection.deal_pipeline_id;
      if (!job.connection.can_deals || !pipeline)
        throw new Skip("Creating deals isn't switched on.");
      if (job.link?.deal_id)
        return { outcome: "done", externalId: job.link.deal_id };
      const title = dealTitle(lead);
      const earlier = retrying ? await client.findDeal(contactId, title) : null;
      const id =
        earlier ??
        (await client.createDeal(contactId, companyId, {
          title,
          pipelineId: pipeline,
          stageId: job.connection.deal_stage_id,
        }));
      link.deal_id = id;
      return { outcome: "done", externalId: id };
    }

    case "opt_out": {
      const set =
        (client.provider === "pipedrive" || job.connection.can_opt_out) &&
        (await client.optOut(email, contactId));
      if (set) return { outcome: "done" };
      const earlier = retrying ? await client.findNote(contactId, ref) : null;
      const id =
        earlier ??
        (await client.createNote(
          contactId,
          companyId,
          optOutNote(ref),
          new Date().toISOString(),
        ));
      return { outcome: "done", externalId: id };
    }
  }
}

export type PushResult = {
  claimed: number;
  done: number;
  retried: number;
  failed: number;
  skipped: number;
};

/** One pass over the queue. Never throws for one job's problem. */
export async function pushStep(
  deps: StepDeps,
  options: { workspaceId?: string; limit?: number } = {},
): Promise<PushResult> {
  const started = Date.now();
  const random = deps.random ?? Math.random;
  const makeClient =
    deps.clientFor ?? ((c: Credentials) => clientFor(c, deps.http));
  const jobs = await deps.store.claimJobs(
    options.limit ?? PUSH_BATCH,
    options.workspaceId,
  );
  const result: PushResult = {
    claimed: jobs.length,
    done: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };
  const count = (outcome: string) => {
    if (outcome === "done") result.done++;
    else if (outcome === "skipped") result.skipped++;
    else if (outcome === "failed") result.failed++;
    else if (outcome !== "ignored") result.retried++;
  };

  const byWorkspace = new Map<string, Job[]>();
  for (const job of jobs)
    byWorkspace.set(job.workspace_id, [
      ...(byWorkspace.get(job.workspace_id) ?? []),
      job,
    ]);

  for (const [workspaceId, list] of byWorkspace) {
    const finish = async (job: Job, r: Result & { delaySeconds?: number }) =>
      count(await deps.store.finishJob(job, r.outcome, r));
    let client: CrmClient | null = null;
    let stop: (Result & { delaySeconds?: number }) | null = null;
    try {
      const credentials = await deps.store.credentials(workspaceId);
      if (!credentials)
        stop = { outcome: "skipped", error: "The CRM was disconnected." };
      else {
        client = makeClient(credentials);
        if (!client)
          stop = {
            outcome: "auth",
            error: `Connect ${PROVIDER_NAME[credentials.provider]} again: Dialvo is missing its address.`,
          };
      }
    } catch (error) {
      console.error(
        "[crm] reading the connection failed:",
        (error as Error).message,
      );
      stop = {
        outcome: "retry",
        delaySeconds: 60,
        error: "Dialvo couldn't read the connection. It will try again.",
      };
    }

    for (const job of list) {
      if (stop || !client) {
        await finish(job, stop ?? { outcome: "retry", delaySeconds: 60 });
        continue;
      }
      if (Date.now() - started > STEP_BUDGET_MS) {
        await finish(job, { outcome: "retry", delaySeconds: 1 });
        continue;
      }
      const link: LinkUpdate = {};
      try {
        const r = await processJob(job, client, link);
        await finish(job, { ...r, link });
      } catch (error) {
        const keep = Object.keys(link).length ? link : undefined;
        if (error instanceof Skip) {
          await finish(job, {
            outcome: "skipped",
            error: error.message,
            link: keep,
          });
        } else if (error instanceof CrmError) {
          if (error.kind === "auth") {
            stop = { outcome: "auth", error: error.message };
            await finish(job, { ...stop, link: keep });
          } else if (error.kind === "rate") {
            // The CRM's whole budget is shared: the rest of this
            // workspace's batch waits too.
            const delaySeconds = Math.max(error.retryAfterSeconds ?? 60, 1);
            stop = { outcome: "retry", delaySeconds, error: error.message };
            await finish(job, { ...stop, link: keep });
          } else if (["server", "network", "not_found"].includes(error.kind)) {
            await finish(job, {
              outcome: "retry",
              delaySeconds: backoffSeconds(job.attempts, random),
              error: error.message,
              link: keep,
            });
          } else {
            await finish(job, {
              outcome: "failed",
              error: error.message,
              link: keep,
            });
          }
        } else {
          console.error(
            `[crm] job ${job.kind} failed:`,
            (error as Error).message,
          );
          await finish(job, {
            outcome: job.attempts >= MAX_JOB_ATTEMPTS ? "failed" : "retry",
            delaySeconds: backoffSeconds(job.attempts, random),
            error: "Something went wrong on Dialvo's side. It will try again.",
            link: keep,
          });
        }
      }
    }
  }
  return result;
}

export type PullResult = {
  status: "idle" | "running" | "done" | "capped" | "failed" | "ignored";
  entries: number;
};

/** One step of one import. Never throws for the CRM's problem. */
export async function pullStep(deps: StepDeps): Promise<PullResult> {
  const claim = await deps.store.claimPull();
  if (!claim) return { status: "idle", entries: 0 };
  const makeClient =
    deps.clientFor ?? ((c: Credentials) => clientFor(c, deps.http));
  const fail = async (error: string): Promise<PullResult> => ({
    status: ((await deps.store.savePull(claim, {
      entries: [],
      cursor: claim.cursor,
      seen: 0,
      done: false,
      error,
    })) ?? "ignored") as PullResult["status"],
    entries: 0,
  });
  const credentials = await deps.store.credentials(claim.workspace_id);
  const client = credentials ? makeClient(credentials) : null;
  if (!client) return fail("The CRM isn't connected.");
  try {
    const page = await client.pullPage(claim.cursor ?? {}, PULL_PAGES_PER_STEP);
    const status = await deps.store.savePull(claim, {
      entries: page.entries,
      cursor: page.next ?? {},
      seen: page.seen,
      done: page.next === null,
    });
    return {
      status: (status ?? "ignored") as PullResult["status"],
      entries: page.entries.length,
    };
  } catch (error) {
    if (error instanceof CrmError) return fail(error.message);
    console.error("[crm] import step failed:", (error as Error).message);
    return fail("Something went wrong on Dialvo's side. It will try again.");
  }
}
