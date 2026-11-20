import "server-only";
import type { Failure } from "@/lib/prospects/findymail";
import type { RunStatus } from "@/lib/prospects/types";
import {
  CAMPAIGN_COMPANIES_PER_RUN,
  CREDITS_COMPANY_LOOKUP,
  CREDITS_EMAIL,
  CREDITS_EMPLOYEE,
  LOOKALIKE_COMPANIES_PER_CREDIT,
} from "./config";
import type { PlaysFindymail } from "./findymail";
import type { PlayStore } from "./store";

// THE COMPANY-LOOKUP PART OF A TARGET-ACCOUNT OR LOOKALIKE RUN
//
// Both are Find leads runs (prospect_runs with a campaign_id) whose companies
// come from a list instead of a search. Each call does one short step under
// the run's lease (see src/lib/prospects/run.ts):
//
//   seeds    lookalike only, once: POST /api/lookalike/search for each seed
//            (at most 3), for at most 25 companies in all. The credits
//            (1 per 10 returned) are reserved against the day's cap first and
//            what wasn't spent is given back.
//   targets  three companies at a time, the cheapest correct way to a named
//            decision-maker with an email Findymail found:
//              1. only a name given: POST /api/search/company (1 credit when
//                 found) for its website;
//              2. POST /api/search/employees with the job titles, one person
//                 (1 credit for the person);
//              3. POST /api/search/name with that person and the domain
//                 (1 credit when an email is found).
//            So 2 credits per company with a website, 3 with only a name,
//            reserved before and given back when not spent. A company the
//            workspace already has, or never wants, is skipped before any
//            credit is spent on a person (campaign_target_resolve).
//
// Then the run reads each company's own site, like any other run, for the
// facts its first email opens with. Nothing here guesses an email: a company
// whose person or email isn't found is marked so and left out.

export type CampaignDeps = { store: PlayStore; findymail: PlaysFindymail };

type Result = { status: RunStatus | "busy"; stop_reason?: string | null };

/** The job titles a target-account search asks for when none were given. */
export const DEFAULT_TITLES = [
  "Founder",
  "CEO",
  "Owner",
  "Managing Director",
  "Head of Sales",
];

const fatal = (f: Failure) =>
  f.problem === "unauthenticated" ||
  f.problem === "no_credits" ||
  f.problem === "paused";

const reasonFor = (f: Failure) =>
  f.problem === "unauthenticated"
    ? "contact_not_authorised"
    : "contact_no_credits";

/**
 * One step of a campaign run, or null when the run isn't one (or is past
 * looking companies up): the caller then does the usual step.
 */
export async function advanceCampaignRun(
  input: { runId: string; workspaceId: string },
  deps: CampaignDeps,
): Promise<Result | null> {
  const { runId, workspaceId } = input;
  const { store, findymail } = deps;
  const claim = await store.claimCampaign(runId, workspaceId);
  if (claim.status === "not_campaign") return null;
  if (claim.status === "busy") return { status: "busy" };
  if (claim.status === "stopped")
    return { status: "stopped", stop_reason: claim.stop_reason };

  // Out of lookups for now: what was found still has its sites read.
  const end = async (
    _status: "stopped" | "failed",
    reason: string,
  ): Promise<Result> => {
    const status = await store.wrapCampaign(runId, workspaceId, reason);
    return {
      status: (status as RunStatus | null) ?? "stopped",
      stop_reason: reason,
    };
  };

  try {
    if (claim.status === "seeds") {
      const seeds = (claim.campaign.settings.seeds ?? []).slice(0, 3);
      const room = Math.max(0, CAMPAIGN_COMPANIES_PER_RUN - claim.have);
      const rows: Parameters<PlayStore["addLookalikes"]>[2] = [];
      for (const seed of seeds) {
        const limit = Math.min(room - rows.length, CAMPAIGN_COMPANIES_PER_RUN);
        if (limit <= 0) break;
        const reserve = Math.ceil(limit / LOOKALIKE_COMPANIES_PER_CREDIT);
        if (!(await store.credits(runId, workspaceId, null, reserve)))
          return await end("stopped", "contact_daily_limit");
        const found = await findymail.lookalike(seed, {
          sameCountry: Boolean(claim.campaign.settings.same_country),
          sameSize: Boolean(claim.campaign.settings.same_size),
          limit,
        });
        if (!found.ok) {
          await store.credits(runId, workspaceId, null, -reserve);
          if (fatal(found)) return await end("failed", reasonFor(found));
          if (found.problem === "invalid") continue; // seed not processable
          await store.releaseCampaign(runId, workspaceId);
          return { status: "searching" };
        }
        const spent = Math.min(found.value.credits, reserve);
        if (spent < reserve)
          await store.credits(runId, workspaceId, null, -(reserve - spent));
        rows.push(...found.value.companies);
      }
      await store.addLookalikes(runId, workspaceId, rows);
      return { status: "searching" };
    }

    if (claim.status !== "targets") return null;
    const titles = claim.campaign.settings.titles?.length
      ? claim.campaign.settings.titles
      : DEFAULT_TITLES;
    let stop: Result | null = null;
    await Promise.all(
      claim.work.map(async (target) => {
        const save = (r: Parameters<PlayStore["saveTarget"]>[3]) =>
          store.saveTarget(runId, workspaceId, target.id, r);
        const reserved =
          CREDITS_EMPLOYEE +
          CREDITS_EMAIL +
          (target.domain ? 0 : CREDITS_COMPANY_LOOKUP);
        if (!(await store.credits(runId, workspaceId, target.id, reserved))) {
          await save({ status: "retry" });
          stop ??= { status: "stopped", stop_reason: "contact_daily_limit" };
          return;
        }
        let spent = 0;
        const giveBack = () =>
          reserved > spent
            ? store.credits(runId, workspaceId, target.id, -(reserved - spent))
            : Promise.resolve(true);
        const failed = async (f: Failure) => {
          await giveBack();
          if (fatal(f)) {
            stop ??= { status: "failed", stop_reason: reasonFor(f) };
            await save({ status: "retry" });
          } else await save({ status: "retry" });
        };

        let domain = target.domain;
        let name = target.company_name;
        if (!domain) {
          const company = await findymail.company(target.input);
          if (!company.ok) return failed(company);
          if (company.value) {
            spent += CREDITS_COMPANY_LOOKUP;
            domain = company.value.domain;
            name = company.value.name || name;
          }
        }
        const resolved = await store.resolveTarget(
          runId,
          workspaceId,
          target.id,
          domain,
          name,
        );
        if (resolved !== "ok") {
          await giveBack();
          return;
        }
        const people = await findymail.employees(domain!, titles);
        if (!people.ok) return failed(people);
        const person = people.value[0];
        spent += Math.min(people.value.length, 1) * CREDITS_EMPLOYEE;
        if (!person) {
          await giveBack();
          await save({ status: "no_contact", reason: "no_person" });
          return;
        }
        const email = await findymail.email(person.name, domain!);
        if (!email.ok) return failed(email);
        if (!email.value) {
          await giveBack();
          await save({ status: "no_contact", reason: "no_email" });
          return;
        }
        spent += CREDITS_EMAIL;
        await giveBack();
        await save({
          status: "found",
          contact_name: person.name,
          contact_role: person.title,
          email: email.value,
          linkedin_url: person.linkedin,
          company_name: name,
        });
      }),
    );
    if (stop) {
      const s = stop as Result;
      return await end(
        s.status === "failed" ? "failed" : "stopped",
        s.stop_reason ?? "contact_daily_limit",
      );
    }
    await store.releaseCampaign(runId, workspaceId);
    return { status: "searching" };
  } catch (error) {
    console.error("[plays] campaign step failed:", (error as Error).message);
    await store.releaseCampaign(runId, workspaceId).catch(() => {});
    return { status: "searching" };
  }
}
