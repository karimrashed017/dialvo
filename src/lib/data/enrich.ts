import "server-only";
import { isFreeMail } from "@/lib/prospects/domains";
import type { FindymailProblem } from "@/lib/prospects/findymail";
import {
  ENRICH_IN_PARALLEL,
  ENRICH_MAX_CREDITS_PER_LEAD,
  ENRICH_PER_STEP,
} from "./config";
import type { DataFindymail, Profile } from "./findymail";
import type {
  ClaimedLead,
  DataStore,
  EnrichEvent,
  EnrichFinish,
} from "./store";

// Keeping leads complete and current (POST /api/data/step?job=enrich). For
// each lead that is due, in this order and never past
// ENRICH_MAX_CREDITS_PER_LEAD credits:
//
//   1. its email is checked (it may have stopped working: they left);
//   2. its profile is looked up from the email (a title to fill, a job or
//      title change since the last check, and for a personal address such
//      as gmail.com, the company they work at);
//   3. a work email is looked up by name at the company's domain, when the
//      lead has none (or signed up with a personal address, or moved);
//   4. the company's size and industry are looked up.
//
// Every value comes from the contact database's own lookup; nothing is
// made up from a name and a domain. Only empty fields are filled; a job
// change replaces the title and is recorded. The database writes it back
// to the CRM as a note when write-back is on.

class Stop extends Error {
  constructor(readonly problem: FindymailProblem) {
    super(problem);
  }
}

export async function enrichLead(
  lead: ClaimedLead,
  findymail: DataFindymail,
): Promise<EnrichFinish> {
  const { settings, state } = lead;
  const fill: Record<string, string> = {};
  const next: EnrichFinish["state"] = {};
  const events: EnrichEvent[] = [];
  const filled: string[] = [];
  let credits = 0;
  const can = (cost: number) => credits + cost <= ENRICH_MAX_CREDITS_PER_LEAD;
  const take = <T>(
    r:
      | { ok: true; value: { value: T; credits: number } }
      | { ok: false; problem: FindymailProblem },
  ): T => {
    if (!r.ok) throw new Stop(r.problem);
    credits += r.value.credits;
    return r.value.value;
  };

  const email = lead.lead.email;
  const at = email?.split("@")[1] ?? "";
  const personal = Boolean(email && isFreeMail(at));
  const refresh = Boolean(state.last_checked_at);
  let domain = lead.lead.domain;
  const name = lead.lead.name.trim();

  try {
    // 1. Does the address still work?
    if (
      email &&
      (lead.bounced || refresh || state.email_status === null) &&
      can(1)
    ) {
      const works = take(await findymail.verify(email));
      if (works !== null) {
        const status = works ? "valid" : "invalid";
        next.email_status = status;
        fill.email_status = status;
        if (!works && state.email_status !== "invalid")
          events.push({
            kind: "email_invalid",
            summary: `${email} no longer accepts mail. They may have left the company.`,
          });
      }
    }

    // 2. Their profile, from the email.
    const wantProfile =
      email &&
      ((settings.fill_titles && !lead.lead.title) ||
        (settings.personal_emails && personal) ||
        (settings.job_changes && refresh));
    let profile: Profile | null = null;
    if (wantProfile && can(2)) {
      profile = take(await findymail.profile(email!));
      if (profile) {
        next.profile_title = profile.title;
        next.profile_company = profile.company;
        next.profile_domain = profile.domain;
        next.linkedin_url = profile.linkedin_url;
        if (profile.linkedin_url) fill.linkedin_url = profile.linkedin_url;
        if (settings.fill_titles && !lead.lead.title && profile.title) {
          fill.title = profile.title;
          filled.push("title");
        }
        const moved =
          settings.job_changes &&
          refresh &&
          ((state.profile_domain &&
            profile.domain &&
            profile.domain !== state.profile_domain) ||
            (state.profile_title &&
              profile.title &&
              profile.title.toLowerCase() !==
                state.profile_title.toLowerCase()));
        if (moved) {
          const companyChanged =
            state.profile_domain && profile.domain !== state.profile_domain;
          fill.title_now = profile.title;
          events.push({
            kind: "job_change",
            summary: companyChanged
              ? `${name || "They"} moved from ${state.profile_company || state.profile_domain} to ${profile.company || profile.domain}${profile.title ? ` as ${profile.title}` : ""}.`
              : `${name || "Their"} title changed from ${state.profile_title} to ${profile.title}.`,
            changes: {
              ...(companyChanged
                ? {
                    company: {
                      from: state.profile_company || state.profile_domain || "",
                      to: profile.company || profile.domain || "",
                    },
                  }
                : {}),
              title: { from: state.profile_title, to: profile.title },
            },
          });
          if (companyChanged && profile.domain) domain = profile.domain;
        }
        // A sign-up with a personal address: the company they work at.
        if (settings.personal_emails && personal && profile.domain) {
          if (!lead.lead.company && profile.company) {
            fill.company = profile.company;
            filled.push("company");
          }
          if (!lead.lead.website) {
            fill.website = `https://${profile.domain}`;
            filled.push("website");
          }
          domain = profile.domain;
        }
      }
    }

    // 3. A work email, by name at the company's domain.
    const needWork =
      settings.fill_emails &&
      name &&
      domain &&
      !state.work_email &&
      (!email || personal || fill.title_now !== undefined);
    if (needWork && can(1)) {
      const work = take(await findymail.workEmail(name, domain!));
      if (work) {
        fill.work_email = work;
        next.work_email = work;
        events.push({
          kind: "work_email",
          summary: email
            ? `Found a work email for ${name}: ${work}.`
            : `Filled in ${name}'s work email: ${work}.`,
        });
      }
    }

    // 4. The company's size and industry.
    if (
      settings.fill_company &&
      domain &&
      (!lead.lead.company_size || !lead.lead.industry) &&
      can(1)
    ) {
      const c = take(await findymail.company(domain));
      if (c) {
        if (!lead.lead.company_size && c.size_range) {
          fill.company_size = c.size_range;
          filled.push("company size");
        }
        if (!lead.lead.industry && c.industry) {
          fill.industry = c.industry;
          filled.push("industry");
        }
        if (!lead.lead.company && !fill.company && c.name) {
          fill.company = c.name;
          filled.push("company");
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    if (error.problem === "rate_limited" || error.problem === "unavailable")
      return {
        outcome: "retry",
        credits,
        error: "The contact database was busy.",
      };
    return {
      outcome: "failed",
      credits,
      error:
        error.problem === "no_credits"
          ? "The contact database is out of credits."
          : error.problem === "paused"
            ? "The contact database account is paused."
            : error.problem === "unauthenticated"
              ? "The contact database refused Dialvo's key."
              : "The contact database couldn't look this lead up.",
    };
  }
  if (filled.length)
    events.push({
      kind: "filled",
      summary: `Filled in ${filled.join(", ")} from the contact database.`,
    });
  return { outcome: "done", fill, state: next, events, credits };
}

export type EnrichResult = {
  claimed: number;
  done: number;
  failed: number;
  credits: number;
};

export async function enrichStep(
  deps: { store: DataStore; findymail: DataFindymail | null },
  limit = ENRICH_PER_STEP,
): Promise<EnrichResult> {
  const result: EnrichResult = { claimed: 0, done: 0, failed: 0, credits: 0 };
  if (!deps.findymail) return result;
  const leads = await deps.store.claimLeads(limit);
  result.claimed = leads.length;
  const queue = [...leads];
  async function worker() {
    for (let lead = queue.shift(); lead; lead = queue.shift()) {
      let finish: EnrichFinish;
      try {
        finish = await enrichLead(lead, deps.findymail!);
      } catch (error) {
        console.error("[data] enrich failed:", (error as Error).message);
        finish = {
          outcome: "retry",
          credits: 0,
          error: "Something went wrong.",
        };
      }
      try {
        await deps.store.finishLead(lead, finish);
      } catch (error) {
        console.error("[data] enrich finish failed:", (error as Error).message);
        continue;
      }
      result.credits += finish.credits;
      if (finish.outcome === "failed") result.failed++;
      else if (finish.outcome === "done") result.done++;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(ENRICH_IN_PARALLEL, leads.length) }, worker),
  );
  return result;
}
