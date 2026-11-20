import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  Mail,
  MailX,
  Search,
  Telescope,
} from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago } from "@/lib/app/time";
import type { Agent } from "@/lib/app/types";
import { isUuid } from "@/lib/leads/fields";
import { emailRole, isUnsuitableEmail } from "@/lib/prospects/extract";
import {
  DAILY_DRAFT_CAP,
  DAILY_RUN_CAP,
  DAILY_SPEND_CAP_MICROS,
  MAX_COMPANIES_PER_RUN,
  prospectRuntimeStatus,
} from "@/lib/prospects/config";
import { prospectReads, type DraftWithProspect } from "@/lib/prospects/read";
import type {
  Prospect,
  ProspectRun,
  ProspectSearch,
  Suppression,
  Usage,
} from "@/lib/prospects/types";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { updateEmailInstructions } from "../chat/actions";
import { Dropdown, menuItem } from "../_ui/dropdown";
import { ActionForm, SubmitButton } from "../_ui/form";
import { LiveRefresh } from "../_ui/live";
import {
  Badge,
  btn,
  Empty,
  hint,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../_ui/kit";
import {
  addSuppression,
  addToLeads,
  approveDrafts,
  decideDraft,
  decideProspect,
  keepAllWithEmail,
  removeSuppression,
  startRun,
  stopRun,
} from "./actions";
import { DraftWriter, RunDriver } from "./drivers";
import { SearchForm } from "./search-form";
import { field } from "./ui";

export const metadata: Metadata = { title: "Find leads" };

const VIEWS = ["find", "emails", "never"] as const;
type View = (typeof VIEWS)[number];

const link =
  "underline decoration-black/25 underline-offset-2 hover:decoration-black/60";

const LEFT_OUT: Record<string, string> = {
  not_a_match: "didn't match your description",
  competitor: "sell the same kind of thing as you",
  too_large: "much larger than you asked for",
  not_a_business: "not a business's own website",
  no_website: "no website of their own",
  unreadable: "website couldn't be read",
  suppressed: "on your never-contact list",
  already_a_lead: "already one of your leads",
};

/** Whose mailbox the address is, as the review list says it. */
const EMAIL_ROLE = {
  person: "Named person",
  general: "General inbox",
  other: "Printed on their site",
} as const;

const STOPPED: Record<string, string> = {
  daily_limit:
    "Stopped: this workspace reached today's limit for finding leads. What was found is below.",
  stopped_by_user: "Stopped by a teammate. What was found is below.",
  too_many_steps:
    "Stopped: this search ran for too long. What was found is below.",
  nothing_found:
    "Finished without finding a company that matched. Try a broader description or another place.",
  not_authorised:
    "Stopped: Dialvo couldn't reach its search service. This is on Dialvo's side; nothing is wrong with your search.",
  refused:
    "Stopped: this search couldn't be run as described. Try rewording it.",
};

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** A link to the page something was found on. */
function Source({ url, label }: { url: string | null; label?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer nofollow"
      className={cn(link, "text-[#0B0B0C]/55")}
    >
      {label ?? host(url)}
    </a>
  );
}

/**
 * The four steps as one line across the top: which are done, which is next.
 * The first three live on one page; the fourth is the emails page.
 */
function Flow({
  current,
  done,
  notes,
  searchId,
}: {
  /** The step to do next (1 to 4), or 0 on the never-contact list. */
  current: number;
  done: boolean[];
  /** A few words under each step, when there is something to say. */
  notes: string[];
  searchId: string | null;
}) {
  const base = searchId
    ? `/app/prospects?search=${searchId}`
    : "/app/prospects";
  const steps = [
    { label: "Who you sell to", href: `${base}#who` },
    { label: "Find", href: `${base}#find` },
    { label: "Review", href: `${base}#results` },
    { label: "First emails", href: "/app/prospects?view=emails" },
  ];
  return (
    <nav aria-label="Steps" className="mb-3">
      <ol className="grid grid-cols-4 gap-1 rounded-2xl border border-black/[0.07] bg-white p-1 sm:gap-1.5 sm:p-1.5">
        {steps.map((step, i) => {
          const on = current === i + 1;
          return (
            <li key={step.label} className="min-w-0">
              <Link
                href={step.href}
                aria-current={on ? "step" : undefined}
                data-flow-step={i + 1}
                data-done={done[i] ? "true" : "false"}
                className={cn(
                  "flex h-full flex-col items-start gap-1.5 rounded-xl px-2 py-2 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-2.5 sm:px-3",
                  on ? "bg-[#0B0B0C] text-white" : "hover:bg-black/[0.04]",
                )}
              >
                <span
                  className={cn(
                    "grid size-[22px] shrink-0 place-items-center rounded-full text-[11px] font-medium tabular-nums",
                    on
                      ? "bg-white text-[#0B0B0C]"
                      : done[i]
                        ? "bg-[#0B0B0C] text-white"
                        : "border border-black/20 text-[#0B0B0C]/55",
                  )}
                >
                  {done[i] && !on ? (
                    <Check aria-hidden className="size-3" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] leading-[1.25] font-medium sm:text-[13px]">
                    {step.label}
                    <span className="sr-only">
                      {done[i] ? " (done)" : on ? " (next)" : ""}
                    </span>
                  </span>
                  {notes[i] && (
                    <span
                      className={cn(
                        "block truncate text-[11px] leading-[1.3] sm:text-[11.5px]",
                        on ? "text-white/65" : "text-[#0B0B0C]/50",
                      )}
                    >
                      {notes[i]}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function NotOn() {
  return (
    <div
      role="status"
      className="mb-3 rounded-2xl border border-black/[0.1] bg-white px-4 py-3 text-[13px] leading-[1.5] text-[#0B0B0C]/75"
    >
      <span className="font-medium text-[#0B0B0C]">
        Finding leads isn&apos;t switched on yet on Dialvo&apos;s side.
      </span>{" "}
      You can describe who you sell to and keep your never-contact list now.
      Searching the web and writing first emails start once Dialvo switches them
      on. Nothing here is broken, and there is nothing you need to do.
    </div>
  );
}

function RunStatus({
  run,
  prospects,
}: {
  run: ProspectRun;
  prospects: Prospect[];
}) {
  const mine = prospects.filter((p) => p.run_id === run.id);
  const read = mine.filter((p) =>
    ["found", "skipped", "failed"].includes(p.research_status),
  ).length;
  const found = mine.filter((p) => p.research_status === "found").length;
  const active = run.status === "searching" || run.status === "researching";
  const words =
    run.status === "searching"
      ? `Searching the web for companies that match. ${mine.length} found so far.`
      : run.status === "researching"
        ? `Reading each company's own website. ${read} of ${mine.length} read.`
        : run.status === "done" && !run.stop_reason
          ? `Finished ${ago(run.finished_at)}. ${read} ${read === 1 ? "company" : "companies"} read, ${found} listed below.`
          : (STOPPED[run.stop_reason ?? ""] ??
            "This search stopped early. What was found is below.");
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-black/[0.06] bg-black/[0.02] px-4 py-2.5 text-[12.5px] leading-[1.45] text-[#0B0B0C]/70">
      <p role="status" className="flex min-w-0 flex-1 items-center gap-2">
        {active && (
          <span
            aria-hidden
            className="size-2 shrink-0 animate-pulse rounded-full bg-[#0B0B0C]"
          />
        )}
        {words}
        {active && " Keep this page open: it runs while you watch."}
      </p>
      {active && (
        <ActionForm action={stopRun} quiet>
          <input type="hidden" name="run" value={run.id} />
          <SubmitButton variant="secondary" small pendingText="Stopping…">
            Stop
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

function ProspectRow({ p }: { p: Prospect }) {
  const decide = (
    decision: string,
    label: string,
    variant: "primary" | "secondary" | "ghost",
  ) => (
    <ActionForm action={decideProspect} quiet>
      <input type="hidden" name="prospect" value={p.id} />
      <input type="hidden" name="decision" value={decision} />
      <SubmitButton variant={variant} small pendingText="…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
  const sourced = p.facts.length + (p.email ? 1 : 0) + (p.phone ? 1 : 0);
  return (
    <li
      data-prospect={p.domain}
      className={cn("px-4 py-3", p.decision === "removed" && "opacity-55")}
    >
      <div className="grid gap-x-5 gap-y-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px] font-medium">
            {p.company_name || p.domain}
            <a
              href={p.website}
              target="_blank"
              rel="noreferrer nofollow"
              className={cn(
                link,
                "text-[12.5px] font-normal text-[#0B0B0C]/55",
              )}
            >
              {host(p.website)}
            </a>
          </p>
          {(p.summary || p.location) && (
            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-[#0B0B0C]/65 lg:line-clamp-1">
              {[p.summary, p.location].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-[1.45] lg:flex-col lg:items-start">
          {p.email ? (
            <Badge tone="ink">
              <Mail aria-hidden className="size-3" />
              Has email
            </Badge>
          ) : null}
          {p.email ? (
            <span data-email-kind className="text-[12px] text-[#0B0B0C]/55">
              {isUnsuitableEmail(p.email)
                ? "Not a sales inbox"
                : EMAIL_ROLE[emailRole(p.email, p.contact_name)]}
            </span>
          ) : (
            <Badge tone="outline">
              <MailX aria-hidden className="size-3" />
              No email found
            </Badge>
          )}
          {(p.contact_name || p.email) && (
            <p className="min-w-0 break-words">
              {p.contact_name}
              {p.contact_name && p.contact_role && (
                <span className="text-[#0B0B0C]/55">, {p.contact_role}</span>
              )}
              {!p.contact_name && (
                <span className="break-all text-[#0B0B0C]/70">{p.email}</span>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-1.5 lg:w-[150px] lg:justify-end">
          {p.lead_id ? (
            <Link
              href={`/app/leads/${p.lead_id}`}
              className={cn(btn.secondary, btn.small)}
            >
              In Leads
            </Link>
          ) : p.decision === "kept" ? (
            <>
              <Badge tone="ink" className="h-8 px-3">
                Kept
              </Badge>
              {decide("undecided", "Undo", "ghost")}
            </>
          ) : p.decision === "removed" ? (
            <>
              <Badge tone="outline" className="h-8 px-3">
                Removed
              </Badge>
              {decide("undecided", "Undo", "ghost")}
            </>
          ) : (
            <>
              {decide("kept", "Keep", "secondary")}
              {decide("removed", "Remove", "ghost")}
            </>
          )}
        </div>
      </div>

      <details className="group mt-1.5 text-[12.5px] leading-[1.5]">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-[#0B0B0C]/60 hover:text-[#0B0B0C] focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <ChevronDown
            aria-hidden
            className="size-3.5 transition-transform group-open:rotate-180"
          />
          Why this company
          {sourced > 0 && (
            <span className="text-[#0B0B0C]/40">
              · {sourced} {sourced === 1 ? "detail" : "details"} with sources
            </span>
          )}
        </summary>
        <div className="mt-2 grid gap-x-8 gap-y-3 rounded-xl bg-black/[0.025] px-3.5 py-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-[#0B0B0C]/50">
              Found on their website
            </p>
            {p.facts.length > 0 ? (
              <ul className="mt-1 space-y-1.5">
                {p.facts.map((f, i) => (
                  <li key={i}>
                    {f.fact}{" "}
                    <span className="text-[12px] text-[#0B0B0C]/50">
                      (<Source url={f.source_url} label="source" />)
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[#0B0B0C]/55">
                Nothing specific enough to quote was found on their site.
              </p>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-[#0B0B0C]/50">
              How to reach them
            </p>
            {p.email ? (
              <p className="mt-1 break-all">
                {p.email}
                <span className="block text-[12px] break-normal text-[#0B0B0C]/50">
                  {p.email_kind === "free_mail"
                    ? "A free mailbox the business lists as its contact. "
                    : ""}
                  Found on <Source url={p.email_source_url} />
                </span>
              </p>
            ) : (
              <p className="mt-1 text-[#0B0B0C]/55">
                Their site doesn&apos;t print an address, and Dialvo never
                guesses one.
              </p>
            )}
            {p.phone && (
              <p className="mt-1.5">
                {p.phone}
                {p.phone_source_url && (
                  <span className="block text-[12px] text-[#0B0B0C]/50">
                    Found on <Source url={p.phone_source_url} />
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}

function FindView({
  searches,
  search,
  isNew,
  runs,
  prospects,
  usage,
  on,
}: {
  searches: ProspectSearch[];
  search: ProspectSearch | null;
  isNew: boolean;
  runs: ProspectRun[];
  prospects: Prospect[];
  usage: Usage;
  on: boolean;
}) {
  const active = runs.find(
    (r) => r.status === "searching" || r.status === "researching",
  );
  const latest = search
    ? runs.find((r) => r.search_id === search.id)
    : undefined;
  const found = prospects.filter((p) => p.research_status === "found");
  const leftOut = prospects.filter(
    (p) => p.research_status === "skipped" || p.research_status === "failed",
  );
  const kept = found.filter((p) => p.decision === "kept");
  const toAdd = kept.filter((p) => !p.lead_id);
  const undecidedWithEmail = found.filter(
    (p) => p.decision === "undecided" && p.email,
  );
  const reasons = new Map<string, number>();
  for (const p of leftOut) {
    const key =
      p.research_status === "failed" ? "unreadable" : (p.skip_reason ?? "");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const runsLeft = Math.max(0, DAILY_RUN_CAP - usage.runs);
  const spent = usage.cost_micros >= DAILY_SPEND_CAP_MICROS;

  return (
    <>
      {active && <RunDriver runId={active.id} />}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
        <section aria-labelledby="who" className={cn(panel, "scroll-mt-28")}>
          <h2 id="who" className={panelHead}>
            1. Who you sell to
            {searches.length > 0 && (
              <span className="flex min-w-0 items-center gap-1">
                {/* More than one description: a small switcher, not a wall. */}
                {searches.length > 1 && (
                  <Dropdown
                    label="Switch to another saved search"
                    align="right"
                    panelClassName="w-[280px] max-h-[320px] overflow-y-auto"
                    trigger={
                      <span className={cn(btn.ghost, btn.small, "font-normal")}>
                        {searches.length} saved
                        <ChevronDown aria-hidden className="size-3.5" />
                      </span>
                    }
                  >
                    {searches.map((s) => (
                      <Link
                        key={s.id}
                        href={`/app/prospects?search=${s.id}`}
                        aria-current={s.id === search?.id ? "page" : undefined}
                        className={menuItem}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {s.name}
                        </span>
                        {s.id === search?.id && (
                          <Check
                            aria-label="Showing"
                            className="size-3.5 shrink-0"
                          />
                        )}
                      </Link>
                    ))}
                  </Dropdown>
                )}
                {isNew ? (
                  <Link
                    href="/app/prospects"
                    className={cn(btn.ghost, btn.small)}
                  >
                    Cancel
                  </Link>
                ) : (
                  <Link
                    href="/app/prospects?search=new"
                    className={cn(btn.ghost, btn.small)}
                  >
                    New search
                  </Link>
                )}
              </span>
            )}
          </h2>
          {search ? (
            // Saved: shown as a sentence, with the form one click away.
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] leading-[1.5]">
                    {search.description}
                  </span>
                  {(search.location ||
                    search.company_size ||
                    search.exclusions) && (
                    <span className="mt-1 block text-[12.5px] leading-[1.45] text-[#0B0B0C]/55">
                      {[
                        search.location,
                        search.company_size,
                        search.exclusions && `leaving out ${search.exclusions}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </span>
                <span className={cn(btn.secondary, btn.small)}>
                  <span className="group-open:hidden">Edit</span>
                  <span className="hidden group-open:inline">Close</span>
                </span>
              </summary>
              <div className="border-t border-black/[0.06] p-4">
                <SearchForm
                  // A different search is a different form.
                  key={search.id}
                  search={search}
                  canSuggest={on}
                  suggestOnOpen={false}
                />
              </div>
            </details>
          ) : (
            <div className="p-4">
              <SearchForm
                key="new"
                search={null}
                canSuggest={on}
                suggestOnOpen={on && searches.length === 0}
              />
            </div>
          )}
        </section>

        <section aria-labelledby="find" className={cn(panel, "scroll-mt-28")}>
          <h2 id="find" className={panelHead}>
            2. Find
          </h2>
          <div className="p-4">
            <p className="text-[13px] leading-[1.5] text-[#0B0B0C]/70">
              Dialvo searches the web for companies that fit, then reads each
              company&apos;s own website for what they do, how to reach them and
              something specific to say. It only uses what a company publishes
              itself, and it never guesses an email address.
            </p>
            <ActionForm action={startRun} className="mt-3">
              <input type="hidden" name="search" value={search?.id ?? ""} />
              <SubmitButton
                pendingText="Starting…"
                data-find
                // The black button is whichever step comes next.
                variant={found.length > 0 ? "secondary" : "primary"}
                disabled={
                  !on || !search || Boolean(active) || runsLeft === 0 || spent
                }
              >
                <Search aria-hidden className="size-3.5" />
                {found.length > 0 ? "Find more leads" : "Find leads"}
              </SubmitButton>
            </ActionForm>
            <p className={cn(hint, "mt-2")}>
              {!on
                ? "Not switched on yet on Dialvo's side."
                : !search
                  ? "Step 1 first: save who you sell to."
                  : active && active.search_id !== search.id
                    ? "Another search is running. One at a time."
                    : runsLeft === 0 || spent
                      ? "This workspace has reached today's limit for finding leads. It resets at midnight UTC."
                      : `Each search looks at up to ${MAX_COMPANIES_PER_RUN} companies and takes a few minutes. ${runsLeft} of ${DAILY_RUN_CAP} searches left today.`}
            </p>
          </div>
          {latest && <RunStatus run={latest} prospects={prospects} />}
        </section>
      </div>

      <section
        aria-labelledby="results"
        className={cn(panel, "mt-3 scroll-mt-28")}
      >
        <h2 id="results" className={panelHead}>
          <span>
            3. Review
            {found.length > 0 && (
              <span className="ml-2 font-normal text-[#0B0B0C]/50">
                {found.length} found · {found.filter((p) => p.email).length}{" "}
                with an email · {kept.length} kept
              </span>
            )}
          </span>
          {found.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              {undecidedWithEmail.length > 0 && (
                <ActionForm action={keepAllWithEmail} quiet>
                  <input type="hidden" name="search" value={search!.id} />
                  <SubmitButton
                    variant="secondary"
                    small
                    pendingText="Keeping…"
                  >
                    Keep all {undecidedWithEmail.length} with an email
                  </SubmitButton>
                </ActionForm>
              )}
            </span>
          )}
        </h2>
        {found.length === 0 ? (
          <Empty icon={Telescope} title="No results yet">
            {search
              ? "Press Find leads above. Companies appear here as their websites are read, each with where its details were found."
              : "Companies Dialvo finds for you appear here. Start with step 1: describe who you sell to."}
          </Empty>
        ) : (
          <>
            <ul className="divide-y divide-black/[0.06]">
              {found.map((p) => (
                <ProspectRow key={p.id} p={p} />
              ))}
            </ul>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-black/[0.06] px-4 py-3">
              <p className={cn(hint, "max-w-[560px]")}>
                Keep the ones worth contacting. &ldquo;Add to leads&rdquo; puts
                the kept companies in your Leads list, marked &ldquo;found by
                Dialvo&rdquo;, with this research on each lead. Removed
                companies aren&apos;t suggested again.
              </p>
              <div className="flex flex-wrap items-start gap-2">
                <ActionForm action={addToLeads}>
                  <input type="hidden" name="search" value={search!.id} />
                  <SubmitButton
                    variant="secondary"
                    pendingText="Adding…"
                    disabled={toAdd.length === 0}
                  >
                    Add {toAdd.length > 0 ? `${toAdd.length} kept ` : ""}to
                    leads
                  </SubmitButton>
                </ActionForm>
                <Link
                  href="/app/prospects?view=emails"
                  className={cn(kept.length > 0 ? btn.primary : btn.secondary)}
                >
                  Next: first emails
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </div>
            </div>
          </>
        )}
        {leftOut.length > 0 && (
          <p className="border-t border-black/[0.06] px-4 py-2.5 text-[12px] leading-[1.5] text-[#0B0B0C]/50">
            {leftOut.length} more {leftOut.length === 1 ? "was" : "were"} looked
            at and left out:{" "}
            {[...reasons]
              .map(([reason, n]) => `${n} ${LEFT_OUT[reason] ?? "left out"}`)
              .join(", ")}
            .
          </p>
        )}
      </section>
    </>
  );
}

function DraftCard({ d }: { d: DraftWithProspect }) {
  const approved = d.status === "approved";
  return (
    <li data-draft={d.to_email} className="px-4 py-3.5">
      <ActionForm action={decideDraft}>
        <input type="hidden" name="draft" value={d.id} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          {approved ? (
            <Badge tone="ink">Ready to send</Badge>
          ) : (
            <Badge tone="plain">Waiting for you</Badge>
          )}
          <span className="font-medium">
            {d.prospect?.company_name || d.to_email.split("@")[1]}
          </span>
          <span className="text-[#0B0B0C]/55">
            To {d.prospect?.contact_name ? `${d.prospect.contact_name}, ` : ""}
            {d.to_email}
          </span>
          {d.edited && <Badge tone="outline">Edited</Badge>}
        </div>
        <label className={cn(labelCls, "mt-2.5")} htmlFor={`s-${d.id}`}>
          Subject
        </label>
        <input
          id={`s-${d.id}`}
          name="subject"
          required
          maxLength={200}
          defaultValue={d.subject}
          className={cn(field, "mt-1")}
        />
        <label className={cn(labelCls, "mt-2.5")} htmlFor={`b-${d.id}`}>
          Email
        </label>
        <textarea
          id={`b-${d.id}`}
          name="body"
          required
          rows={Math.min(14, Math.max(6, d.body.split("\n").length + 2))}
          maxLength={5000}
          defaultValue={d.body}
          className={cn(
            field,
            "mt-1 font-[family-name:var(--font-geist-sans)] leading-[1.5]",
          )}
        />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {approved ? (
            <>
              <SubmitButton
                name="action"
                value="save"
                variant="secondary"
                small
              >
                Save edits
              </SubmitButton>
              <SubmitButton
                name="action"
                value="reopen"
                variant="ghost"
                small
                pendingText="Moving…"
              >
                Move back to waiting
              </SubmitButton>
            </>
          ) : (
            <>
              <SubmitButton
                name="action"
                value="approve"
                small
                pendingText="Approving…"
              >
                Approve
              </SubmitButton>
              <SubmitButton
                name="action"
                value="save"
                variant="secondary"
                small
              >
                Save edits
              </SubmitButton>
            </>
          )}
          <SubmitButton
            name="action"
            value="discard"
            variant="ghost"
            small
            pendingText="Discarding…"
          >
            Discard
          </SubmitButton>
        </div>
      </ActionForm>
    </li>
  );
}

function EmailsView({
  drafts,
  toWrite,
  usage,
  on,
  writer,
  admin,
}: {
  drafts: DraftWithProspect[];
  toWrite: number;
  usage: Usage;
  on: boolean;
  /** The agent whose instructions the first emails follow. */
  writer: Agent | undefined;
  admin: boolean;
}) {
  const waiting = drafts.filter((d) => d.status === "draft");
  const ready = drafts.filter((d) => d.status === "approved");
  const failed = drafts.filter((d) => d.status === "failed").length;
  const discarded = drafts.filter((d) => d.status === "discarded").length;
  return (
    <>
      <div
        role="note"
        className="mb-3 rounded-2xl border border-black/[0.1] bg-white px-4 py-3 text-[13px] leading-[1.5] text-[#0B0B0C]/75"
      >
        <span className="font-medium text-[#0B0B0C]">
          Nothing is sent from here yet.
        </span>{" "}
        Approving an email stores it as ready to send. Sending switches on when
        a mailbox is connected, which is the next thing Dialvo is building.
        Until then no email leaves Dialvo, approved or not.
      </div>

      <section aria-labelledby="write" className={panel}>
        <h2 id="write" className={panelHead}>
          4. Draft the first email
        </h2>
        <div className="p-4">
          <p className="max-w-[640px] text-[13px] leading-[1.5] text-[#0B0B0C]/70">
            For each company you kept that has an email address, Dialvo writes
            one short, plain first email from your Knowledge, your instructions
            below and what was found on that company&apos;s site. You read every
            one before it counts as ready.
          </p>
          <div className="mt-3">
            <DraftWriter waiting={toWrite} disabled={!on} />
          </div>
          <p className={cn(hint, "mt-2")}>
            {!on
              ? "Not switched on yet on Dialvo's side."
              : toWrite === 0
                ? "No kept company with an email address is waiting for a draft. Keep some in Review first."
                : `${Math.max(0, DAILY_DRAFT_CAP - usage.drafts)} of ${DAILY_DRAFT_CAP} drafts left today for this workspace.`}
          </p>
        </div>
      </section>

      {writer && (
        <section
          id="instructions"
          aria-labelledby="instructions-title"
          className={cn(panel, "mt-3 scroll-mt-28")}
        >
          <details className="group" open={!writer.instructions.trim()}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-[13px] font-medium focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
              <span id="instructions-title">
                How your emails should sound
                <span className="ml-2 font-normal text-[#0B0B0C]/50">
                  {writer.instructions.trim()
                    ? "Your instructions are in use"
                    : "No instructions yet"}
                </span>
              </span>
              <ChevronDown
                aria-hidden
                className="size-4 shrink-0 text-[#0B0B0C]/40 transition-transform group-open:rotate-180"
              />
            </summary>
            <ActionForm
              action={updateEmailInstructions}
              className="border-t border-black/[0.06] p-4"
            >
              <input type="hidden" name="agent" value={writer.id} />
              <label htmlFor="writer-instructions" className={labelCls}>
                Instructions for first emails
              </label>
              <textarea
                id="writer-instructions"
                name="instructions"
                rows={4}
                maxLength={20000}
                disabled={!admin}
                defaultValue={writer.instructions}
                placeholder="For example: write to the owner or practice manager. Mention the free site review. Sign off as Sam from Northside Web. Never mention prices."
                className={cn(field, "mt-1.5")}
              />
              <p className={cn(hint, "mt-1.5 max-w-[640px]")}>
                In plain words: who you are writing to, what to offer, how to
                sign off, what never to say. What you sell and your prices come
                from Knowledge. These apply to emails written from now on, not
                to drafts already written.
              </p>
              {admin ? (
                <div className="mt-3 flex justify-end">
                  <SubmitButton variant="secondary">
                    Save instructions
                  </SubmitButton>
                </div>
              ) : (
                <p className={cn(hint, "mt-2")}>
                  Only the workspace&apos;s owner and admins can change these.
                </p>
              )}
            </ActionForm>
          </details>
        </section>
      )}

      <section aria-labelledby="queue" className={cn(panel, "mt-3")}>
        <h2 id="queue" className={panelHead}>
          <span>
            Waiting for you
            <span className="ml-2 font-normal text-[#0B0B0C]/50">
              {waiting.length}
            </span>
          </span>
          {waiting.length > 1 && (
            <ActionForm
              action={approveDrafts}
              confirm={`Approve all ${waiting.length} as they are? They'll be stored as ready to send. Nothing is sent yet.`}
            >
              {waiting.map((d) => (
                <input key={d.id} type="hidden" name="draft" value={d.id} />
              ))}
              <SubmitButton variant="secondary" small pendingText="Approving…">
                Approve all {waiting.length}
              </SubmitButton>
            </ActionForm>
          )}
        </h2>
        {waiting.length === 0 ? (
          <Empty
            icon={Mail}
            title="No first emails waiting"
            action={
              toWrite === 0 ? (
                <Link
                  href="/app/prospects#results"
                  className={cn(btn.secondary)}
                >
                  <ArrowLeft aria-hidden className="size-3.5" />
                  Back to Review
                </Link>
              ) : undefined
            }
          >
            {toWrite === 0
              ? "First emails are written for companies you keep in Review that have an email address. Each one waits here for your yes."
              : "Press the button above. Each email appears here as it is written, and waits for your yes."}
          </Empty>
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {waiting.map((d) => (
              <DraftCard key={d.id} d={d} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ready" className={cn(panel, "mt-3")}>
        <h2 id="ready" className={panelHead}>
          <span>
            Ready to send
            <span className="ml-2 font-normal text-[#0B0B0C]/50">
              {ready.length}
            </span>
          </span>
          <Badge tone="outline">Not sent: no mailbox connected</Badge>
        </h2>
        {ready.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-[#0B0B0C]/55">
            Emails you approve are kept here until sending is switched on.
          </p>
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {ready.map((d) => (
              <DraftCard key={d.id} d={d} />
            ))}
          </ul>
        )}
        {(failed > 0 || discarded > 0) && (
          <p className="border-t border-black/[0.06] px-4 py-2.5 text-[12px] leading-[1.5] text-[#0B0B0C]/50">
            {[
              discarded > 0 && `${discarded} discarded`,
              failed > 0 &&
                `${failed} couldn't be written to our standard and ${failed === 1 ? "was" : "were"} left out`,
            ]
              .filter(Boolean)
              .join("; ")}
            .
          </p>
        )}
      </section>
    </>
  );
}

function NeverView({ list, admin }: { list: Suppression[]; admin: boolean }) {
  return (
    <section aria-labelledby="never" className={panel}>
      <h2 id="never" className={panelHead}>
        Never contact
      </h2>
      <div className="p-4">
        <p className="max-w-[640px] text-[13px] leading-[1.5] text-[#0B0B0C]/70">
          Email addresses and whole domains Dialvo must never find or write to
          for this workspace: existing customers, competitors, anyone who asked
          not to hear from you. A domain covers every address at it. Finding
          leads skips them, no first email is drafted for them, and adding one
          discards any email waiting or ready to send to it.
        </p>
        <ActionForm
          action={addSuppression}
          resetOnSuccess
          className="mt-3 max-w-[640px]"
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label htmlFor="sup-value" className={labelCls}>
                Email address or domain
              </label>
              <input
                id="sup-value"
                name="value"
                required
                maxLength={254}
                placeholder="name@company.com or company.com"
                className={cn(field, "mt-1.5")}
              />
            </div>
            <div>
              <label htmlFor="sup-note" className={labelCls}>
                Why{" "}
                <span className="font-normal text-[#0B0B0C]/45">
                  (optional)
                </span>
              </label>
              <input
                id="sup-note"
                name="note"
                maxLength={200}
                placeholder="For example: existing customer"
                className={cn(field, "mt-1.5")}
              />
            </div>
            <SubmitButton pendingText="Adding…">Add</SubmitButton>
          </div>
        </ActionForm>
      </div>
      {list.length === 0 ? (
        <Empty
          icon={Ban}
          title="Nobody on the list yet"
          className="border-t border-black/[0.06]"
        >
          Add the addresses and domains you never want contacted.
        </Empty>
      ) : (
        <ul className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
          {list.map((s) => (
            <li
              key={s.id}
              data-suppression={s.value}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]"
            >
              <Badge tone="outline">
                {s.kind === "email" ? "Email" : "Domain"}
              </Badge>
              <span className="font-medium break-all">{s.value}</span>
              {s.note && <span className="text-[#0B0B0C]/55">{s.note}</span>}
              <span className="ml-auto text-[12px] text-[#0B0B0C]/45">
                Added {ago(s.created_at)}
              </span>
              {admin && (
                <ActionForm
                  action={removeSuppression}
                  quiet
                  confirm={`Take ${s.value} off the list? Dialvo may then find and write to it again.`}
                >
                  <input type="hidden" name="suppression" value={s.id} />
                  <SubmitButton variant="ghost" small pendingText="Removing…">
                    Remove
                  </SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
      {!admin && list.length > 0 && (
        <p className={cn(hint, "border-t border-black/[0.06] px-4 py-2.5")}>
          Only the workspace&apos;s owner or an admin can take an entry off the
          list.
        </p>
      )}
    </section>
  );
}

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/app/prospects">["searchParams"];
}) {
  const params = await searchParams;
  const view: View = VIEWS.find((v) => v === params.view) ?? "find";
  const { workspace, preview, repo } = await getAppContext();

  const head = (
    <PageHead
      title="Find leads"
      note="Dialvo finds companies that fit who you sell to, reads their websites and drafts a first email for the ones you keep. You don't need to bring a list."
    >
      <Link
        href={view === "never" ? "/app/prospects" : "/app/prospects?view=never"}
        className={cn(btn.ghost, btn.small)}
      >
        {view === "never" ? (
          <>
            <ArrowLeft aria-hidden className="size-3.5" />
            Back to Find leads
          </>
        ) : (
          <>
            <Ban aria-hidden className="size-3.5" />
            Never-contact list
          </>
        )}
      </Link>
    </PageHead>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={Telescope} title="Not part of the design preview">
            Finding leads needs the real app. Nothing is shown here with made-up
            data.
          </Empty>
        </section>
      </>
    );

  const on = prospectRuntimeStatus().on;
  const reads = prospectReads(await createClient(), workspace.id);
  const [searches, runs, usage] = await Promise.all([
    reads.searches(),
    reads.runs(),
    reads.usageToday(),
  ]);
  const wanted = typeof params.search === "string" ? params.search : "";
  const isNew = wanted === "new" || searches.length === 0;
  const search = isNew
    ? null
    : (isUuid(wanted) && searches.find((s) => s.id === wanted)) ||
      // Otherwise the one that is running, else the newest.
      searches.find((s) =>
        runs.some(
          (r) =>
            r.search_id === s.id &&
            (r.status === "searching" || r.status === "researching"),
        ),
      ) ||
      searches[0];
  const activeRun = runs.some(
    (r) => r.status === "searching" || r.status === "researching",
  );

  const [prospects, drafts, kept, list, agents, waitingEmails] =
    await Promise.all([
      // The steps across the top need the results on every view.
      search ? reads.prospects(search.id) : [],
      view === "emails" ? reads.drafts() : [],
      view === "emails" ? reads.keptWithEmail() : [],
      view === "never" ? reads.suppressions() : [],
      view === "emails" ? repo.agents() : [],
      repo.emailDraftCount(),
    ]);
  const drafted = new Set(
    drafts
      // A failed draft is tried once more, so it still counts as to write.
      .filter((d) => d.status !== "failed")
      .map((d) => d.prospect_id),
  );
  const toWrite = kept.filter((k) => !drafted.has(k.id)).length;
  const found = prospects.filter((p) => p.research_status === "found");
  const undecided = found.filter((p) => p.decision === "undecided").length;
  const keptCount = found.filter((p) => p.decision === "kept").length;
  const writing = drafts.some((d) => d.status === "drafting");

  return (
    <>
      {/* Results and drafts show up as they are found, without a reload. */}
      {((view === "find" && activeRun) || (view === "emails" && writing)) && (
        <LiveRefresh every={4000} />
      )}
      {head}
      {!on && <NotOn />}
      <Flow
        current={
          view === "never"
            ? 0
            : view === "emails"
              ? 4
              : !search
                ? 1
                : found.length === 0 || activeRun
                  ? 2
                  : 3
        }
        done={[
          Boolean(search),
          found.length > 0,
          keptCount > 0 && undecided === 0,
          false,
        ]}
        notes={[
          "",
          activeRun
            ? "Searching now"
            : found.length > 0
              ? `${found.length} found`
              : "",
          found.length > 0
            ? undecided > 0
              ? `${undecided} to decide`
              : `${keptCount} kept`
            : "",
          waitingEmails > 0 ? `${waitingEmails} waiting` : "",
        ]}
        searchId={search?.id ?? null}
      />
      {view === "find" && (
        <FindView
          searches={searches}
          search={search ?? null}
          isNew={isNew}
          runs={runs}
          prospects={prospects}
          usage={usage}
          on={on}
        />
      )}
      {view === "emails" && (
        <EmailsView
          drafts={drafts}
          toWrite={toWrite}
          usage={usage}
          on={on}
          writer={agents.find((a) => a.role === "outbound")}
          admin={workspace.role !== "member"}
        />
      )}
      {view === "never" && (
        <NeverView list={list} admin={workspace.role !== "member"} />
      )}
    </>
  );
}

export default function ProspectsPage({
  searchParams,
}: PageProps<"/app/prospects">) {
  return (
    // The page reads the session, so it streams in behind this boundary.
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
