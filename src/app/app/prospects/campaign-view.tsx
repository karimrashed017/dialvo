import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { ago } from "@/lib/app/time";
import { isUuid } from "@/lib/leads/fields";
import {
  CAMPAIGN_COMPANIES_PER_RUN,
  LOOKALIKE_MAX_SEEDS,
  TARGET_ACCOUNTS_MAX,
} from "@/lib/plays/config";
import { playReads, type Target } from "@/lib/plays/read";
import {
  contactDatabaseStatus,
  DAILY_CONTACT_CREDIT_CAP,
  prospectRuntimeStatus,
} from "@/lib/prospects/config";
import type { Supabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import {
  Badge,
  btn,
  Empty,
  hint,
  input,
  labelCls,
  panel,
  panelHead,
} from "../_ui/kit";
import {
  continueCampaign,
  createAccounts,
  createLookalike,
} from "../plays/actions";
import { RunDriver } from "./drivers";

// Target accounts and Lookalike: a list of companies (pasted, or found from
// seed companies) looked up in the contact database for a named
// decision-maker with an email, then read and drafted like any search.

const TARGET_STATUS: Record<string, string> = {
  pending: "Waiting",
  working: "Looking up",
  found: "Found",
  no_contact: "No contact found",
  not_found: "Company not found",
  skipped: "Left out",
  failed: "Couldn't be looked up",
};

const REASON: Record<string, string> = {
  suppressed: "on your never-contact list",
  already_a_lead: "already one of your leads",
  already_found: "already found",
  duplicate: "in the list twice",
  no_website: "no website found",
  no_person: "nobody with those job titles",
  no_email: "no email found",
  lookup_failed: "lookup failed twice",
};

const RUN_NOTE: Record<string, string> = {
  contact_daily_limit:
    "Paused: today's contact-database allowance is used. The rest of the list waits for tomorrow.",
  contact_no_credits:
    "Paused: the contact database is out of credits. This is on Dialvo's side.",
  contact_not_authorised:
    "Paused: Dialvo couldn't sign in to the contact database. This is on Dialvo's side.",
  daily_limit:
    "Paused: this workspace reached today's limit for finding leads.",
};

function tally(targets: Target[]) {
  const t: Record<string, number> = {};
  for (const x of targets) t[x.status] = (t[x.status] ?? 0) + 1;
  return t;
}

export async function CampaignView({
  kind,
  supabase,
  workspaceId,
  selected,
}: {
  kind: "accounts" | "lookalike";
  supabase: Supabase;
  workspaceId: string;
  selected: string | null;
}) {
  const on = prospectRuntimeStatus().on && contactDatabaseStatus().on;
  const reads = playReads(supabase, workspaceId);
  const campaigns = await reads.campaigns([kind]);
  const current =
    (selected &&
      isUuid(selected) &&
      campaigns.find((c) => c.id === selected)) ||
    campaigns[0] ||
    null;
  const [targets, runs] = await Promise.all([
    reads.targets(campaigns.map((c) => c.id)),
    campaigns.length
      ? supabase
          .from("prospect_runs")
          .select("id, status, stop_reason, campaign_id, created_at")
          .eq("workspace_id", workspaceId)
          .in(
            "campaign_id",
            campaigns.map((c) => c.id),
          )
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (runs.error) throw new Error(runs.error.message);
  const runList = (runs.data ?? []) as {
    id: string;
    status: string;
    stop_reason: string | null;
    campaign_id: string;
  }[];
  const mine = targets.filter((t) => t.campaign_id === current?.id);
  const counts = tally(mine);
  const run = runList.find((r) => r.campaign_id === current?.id);
  const active =
    run && (run.status === "searching" || run.status === "researching");
  const left = (counts.pending ?? 0) + (counts.working ?? 0);

  return (
    <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
      <section className={panel}>
        <h2 className={panelHead}>
          {kind === "accounts" ? "A new list" : "Companies like these"}
        </h2>
        <ActionForm
          action={kind === "accounts" ? createAccounts : createLookalike}
          className="space-y-3 p-4"
        >
          {kind === "accounts" ? (
            <>
              <label className={labelCls}>
                Name{" "}
                <span className="font-normal text-[#0B0B0C]/45">
                  (optional)
                </span>
                <input
                  name="name"
                  maxLength={120}
                  className={cn(input, "mt-1")}
                />
              </label>
              <label className={labelCls}>
                Companies, one per line
                <textarea
                  name="accounts"
                  required
                  rows={8}
                  placeholder={"acme.com\nnorthwind.co.uk\nContoso Ltd"}
                  className={cn(input, "mt-1 font-mono text-[12.5px]")}
                />
                <span className={cn(hint, "mt-1.5 block font-normal")}>
                  A website (best) or a company name, or paste a CSV with a
                  website or company column. Up to {TARGET_ACCOUNTS_MAX}.
                </span>
              </label>
            </>
          ) : (
            <>
              <label className={labelCls}>
                Your best customers&apos; websites
                <textarea
                  name="seeds"
                  required
                  rows={3}
                  placeholder={"acme.com\nnorthwind.co.uk"}
                  className={cn(input, "mt-1 font-mono text-[12.5px]")}
                />
                <span className={cn(hint, "mt-1.5 block font-normal")}>
                  Up to {LOOKALIKE_MAX_SEEDS}. Dialvo finds up to{" "}
                  {CAMPAIGN_COMPANIES_PER_RUN} similar companies, leaving out
                  ones you already have.
                </span>
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  name="same_country"
                  className="size-4 accent-[#0B0B0C]"
                />
                Same country
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  name="same_size"
                  className="size-4 accent-[#0B0B0C]"
                />
                Same size
              </label>
            </>
          )}
          <label className={labelCls}>
            Who to write to
            <input
              name="titles"
              maxLength={600}
              placeholder="Founder, CEO, Head of Sales"
              className={cn(input, "mt-1")}
            />
            <span className={cn(hint, "mt-1.5 block font-normal")}>
              Job titles, separated by commas. One person per company.
            </span>
          </label>
          <SubmitButton disabled={!on} pendingText="Starting…">
            {kind === "accounts"
              ? "Find decision-makers"
              : "Find similar companies"}
          </SubmitButton>
          <p className={hint}>
            {on
              ? `Each company costs about ${kind === "accounts" ? "2 to 3" : "2"} contact-database credits, from this workspace's ${DAILY_CONTACT_CREDIT_CAP} a day. A company already in your leads, your CRM or your never-contact list is skipped before anything is spent on it.`
              : "Needs the contact database, which isn't switched on yet on Dialvo's side."}
          </p>
        </ActionForm>
      </section>

      <div className="min-w-0 space-y-3">
        {campaigns.length === 0 ? (
          <section className={panel}>
            <Empty icon={Building2} title="No list yet">
              {kind === "accounts"
                ? "Paste the companies you want to sell to. Dialvo finds the right person at each, with an email from the contact database, then reads their site and drafts a first email you approve."
                : "Give the websites of a few customers you'd like more of. Dialvo finds companies like them, then a named person and an email at each."}
            </Empty>
          </section>
        ) : (
          <>
            {active && run && <RunDriver runId={run.id} />}
            <section className={panel}>
              <h2 className={panelHead}>
                <span className="min-w-0 truncate">{current?.name}</span>
                <Badge tone={active ? "ink" : "outline"}>
                  {active
                    ? run!.status === "researching"
                      ? "Reading their sites"
                      : "Looking up"
                    : left > 0
                      ? "Paused"
                      : "Done"}
                </Badge>
              </h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-black/[0.06] px-4 py-2.5 text-[12.5px] text-[#0B0B0C]/65 tabular-nums">
                <span>{mine.length} companies</span>
                <span>{counts.found ?? 0} found</span>
                <span>{left} waiting</span>
                <span>
                  {(counts.no_contact ?? 0) +
                    (counts.not_found ?? 0) +
                    (counts.skipped ?? 0) +
                    (counts.failed ?? 0)}{" "}
                  left out
                </span>
              </div>
              {run?.stop_reason && RUN_NOTE[run.stop_reason] && (
                <p className="border-b border-black/[0.06] px-4 py-2.5 text-[12.5px]">
                  {RUN_NOTE[run.stop_reason]}
                </p>
              )}
              <div className="flex flex-wrap gap-2 px-4 py-3">
                {current?.search_id && (counts.found ?? 0) > 0 && (
                  <Link
                    href={`/app/prospects?search=${current.search_id}`}
                    className={cn(btn.primary, btn.small)}
                  >
                    Review what was found
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                )}
                {!active && left > 0 && current && (
                  <ActionForm action={continueCampaign}>
                    <input type="hidden" name="campaign" value={current.id} />
                    <SubmitButton
                      variant="secondary"
                      small
                      disabled={!on}
                      pendingText="Starting…"
                    >
                      Look up the next{" "}
                      {Math.min(left, CAMPAIGN_COMPANIES_PER_RUN)}
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
              {mine.length > 0 && (
                <div className="max-h-[480px] overflow-y-auto border-t border-black/[0.06]">
                  <table className="w-full text-left text-[12.5px]">
                    <tbody>
                      {mine.map((t) => (
                        <tr
                          key={t.id}
                          className="border-b border-black/[0.04] last:border-0"
                        >
                          <td className="px-4 py-2">
                            <span className="font-medium">
                              {t.company_name || t.domain || t.input}
                            </span>
                            {t.domain && t.company_name && (
                              <span className="ml-1.5 text-[#0B0B0C]/45">
                                {t.domain}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap text-[#0B0B0C]/60">
                            {TARGET_STATUS[t.status] ?? t.status}
                            {t.reason && REASON[t.reason] && (
                              <span className="block text-[11.5px] text-[#0B0B0C]/45">
                                {REASON[t.reason]}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {campaigns.length > 1 && (
              <section className={panel}>
                <h2 className={panelHead}>Earlier lists</h2>
                <ul className="divide-y divide-black/[0.06]">
                  {campaigns
                    .filter((c) => c.id !== current?.id)
                    .map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`?campaign=${c.id}`}
                          className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-black/[0.02]"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {c.name}
                          </span>
                          <span className="text-[12px] text-[#0B0B0C]/50">
                            {ago(c.created_at)}
                          </span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
