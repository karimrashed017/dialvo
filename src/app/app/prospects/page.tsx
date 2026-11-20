import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Ban, Mail, MailX, Search, Telescope } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago } from "@/lib/app/time";
import { isUuid } from "@/lib/leads/fields";
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

const VIEWS = [
  { id: "find", label: "Find" },
  { id: "emails", label: "First emails" },
  { id: "never", label: "Never contact" },
] as const;
type View = (typeof VIEWS)[number]["id"];

const link =
  "underline decoration-black/25 underline-offset-2 hover:decoration-black/60";

const LEFT_OUT: Record<string, string> = {
  not_a_match: "didn't match your description",
  not_a_business: "not a business's own website",
  no_website: "no website of their own",
  unreadable: "website couldn't be read",
  suppressed: "on your never-contact list",
  already_a_lead: "already one of your leads",
};

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
  return (
    <li
      data-prospect={p.domain}
      className={cn(
        "grid gap-x-5 gap-y-2 px-4 py-3.5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto]",
        p.decision === "removed" && "opacity-55",
      )}
    >
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">
          {p.company_name || p.domain}
        </p>
        <a
          href={p.website}
          target="_blank"
          rel="noreferrer nofollow"
          className={cn(link, "text-[12.5px] text-[#0B0B0C]/60")}
        >
          {host(p.website)}
        </a>
        {p.summary && (
          <p className="mt-1 text-[12.5px] leading-[1.45] text-[#0B0B0C]/70">
            {p.summary}
          </p>
        )}
        {p.location && (
          <p className="mt-0.5 text-[12px] text-[#0B0B0C]/50">{p.location}</p>
        )}
      </div>

      <div className="min-w-0 text-[12.5px] leading-[1.5]">
        {p.email ? (
          <Badge tone="ink">
            <Mail aria-hidden className="size-3" />
            Has email
          </Badge>
        ) : (
          <Badge tone="outline">
            <MailX aria-hidden className="size-3" />
            No email found
          </Badge>
        )}
        {p.contact_name && (
          <p className="mt-1.5">
            {p.contact_name}
            {p.contact_role && (
              <span className="text-[#0B0B0C]/55">, {p.contact_role}</span>
            )}
          </p>
        )}
        {p.email && (
          <p className="mt-1 break-all">
            {p.email}
            <span className="block text-[12px] text-[#0B0B0C]/50">
              {p.email_kind === "free_mail"
                ? "A free mailbox the business lists as its contact. "
                : ""}
              Found on <Source url={p.email_source_url} />
            </span>
          </p>
        )}
        {p.phone && (
          <p className="mt-1">
            {p.phone}
            {p.phone_source_url && (
              <span className="block text-[12px] text-[#0B0B0C]/50">
                Found on <Source url={p.phone_source_url} />
              </span>
            )}
          </p>
        )}
        {!p.email && (
          <p className="mt-1 text-[12px] text-[#0B0B0C]/50">
            Their site doesn&apos;t print an address, and Dialvo never guesses
            one.
          </p>
        )}
      </div>

      <div className="min-w-0 text-[12.5px] leading-[1.5]">
        {p.facts.length > 0 ? (
          <ul className="space-y-1.5">
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
          <p className="text-[#0B0B0C]/50">
            Nothing specific enough to quote was found on their site.
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
            {decide("kept", "Keep", "primary")}
            {decide("removed", "Remove", "secondary")}
          </>
        )}
      </div>
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
        <section aria-labelledby="who" className={panel}>
          <h2 id="who" className={panelHead}>
            1. Who you sell to
            {searches.length > 0 && (
              <Link
                href="/app/prospects?search=new"
                className={cn(btn.ghost, btn.small)}
              >
                New search
              </Link>
            )}
          </h2>
          {searches.length > 1 || (searches.length === 1 && isNew) ? (
            <nav
              aria-label="Saved searches"
              className="flex flex-wrap gap-1 border-b border-black/[0.06] px-3 py-2"
            >
              {searches.map((s) => (
                <Link
                  key={s.id}
                  href={`/app/prospects?search=${s.id}`}
                  aria-current={s.id === search?.id ? "page" : undefined}
                  className={cn(
                    "flex h-7 max-w-[220px] items-center rounded-full px-2.5 text-[12px] font-medium",
                    s.id === search?.id
                      ? "bg-[#0B0B0C] text-white"
                      : "text-[#0B0B0C]/60 hover:bg-black/[0.05]",
                  )}
                >
                  <span className="truncate">{s.name}</span>
                </Link>
              ))}
            </nav>
          ) : null}
          <div className="p-4">
            <SearchForm
              // A different search is a different form.
              key={search?.id ?? "new"}
              search={search}
              canSuggest={on}
              suggestOnOpen={on && searches.length === 0}
            />
          </div>
        </section>

        <section aria-labelledby="find" className={panel}>
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
                disabled={
                  !on || !search || Boolean(active) || runsLeft === 0 || spent
                }
              >
                <Search aria-hidden className="size-3.5" />
                Find leads
              </SubmitButton>
            </ActionForm>
            <p className={cn(hint, "mt-2")}>
              {!on
                ? "Not switched on yet on Dialvo's side."
                : !search
                  ? "Save who you sell to first."
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

      <section aria-labelledby="results" className={cn(panel, "mt-3")}>
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
              ? "Press Find leads. Companies appear here as their websites are read, each with where its details were found."
              : "Describe who you sell to, save it, then press Find leads."}
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
                  className={cn(btn.primary)}
                >
                  Draft first emails
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
}: {
  drafts: DraftWithProspect[];
  toWrite: number;
  usage: Usage;
  on: boolean;
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
            For each company you kept that has an email address, your outbound
            agent writes one short, plain first email from your Knowledge, its
            own instructions and what was found on that company&apos;s site. You
            read every one before it counts as ready.
          </p>
          <div className="mt-3">
            <DraftWriter waiting={toWrite} disabled={!on} />
          </div>
          <p className={cn(hint, "mt-2")}>
            {!on
              ? "Not switched on yet on Dialvo's side."
              : toWrite === 0
                ? "No kept company with an email address is waiting for a draft. Keep some in Find first."
                : `${Math.max(0, DAILY_DRAFT_CAP - usage.drafts)} of ${DAILY_DRAFT_CAP} drafts left today for this workspace.`}{" "}
            <Link href="/app/agents" className={link}>
              Edit the outbound agent&apos;s instructions
            </Link>
          </p>
        </div>
      </section>

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
          <Empty icon={Mail} title="No drafts waiting">
            Drafts appear here as they are written.
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
  const view: View = VIEWS.find((v) => v.id === params.view)?.id ?? "find";
  const { workspace, preview } = await getAppContext();

  const head = (
    <PageHead
      title="Find leads"
      note="Dialvo finds companies that fit who you sell to, reads their websites and drafts a first email for the ones you keep. You don't need to bring a list."
    />
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

  const [prospects, drafts, kept, list] = await Promise.all([
    view === "find" && search ? reads.prospects(search.id) : [],
    view === "emails" ? reads.drafts() : [],
    view === "emails" ? reads.keptWithEmail() : [],
    view === "never" ? reads.suppressions() : [],
  ]);
  const drafted = new Set(
    drafts
      // A failed draft is tried once more, so it still counts as to write.
      .filter((d) => d.status !== "failed")
      .map((d) => d.prospect_id),
  );
  const toWrite = kept.filter((k) => !drafted.has(k.id)).length;
  const writing = drafts.some((d) => d.status === "drafting");

  return (
    <>
      {/* Results and drafts show up as they are found, without a reload. */}
      {((view === "find" && activeRun) || (view === "emails" && writing)) && (
        <LiveRefresh every={4000} />
      )}
      {head}
      {!on && <NotOn />}
      <nav
        aria-label="Find leads"
        className="mb-3 flex [scrollbar-width:none] gap-1 overflow-x-auto"
      >
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={
              v.id === "find" ? "/app/prospects" : `/app/prospects?view=${v.id}`
            }
            aria-current={v.id === view ? "page" : undefined}
            className={cn(
              "flex h-8 shrink-0 items-center rounded-full px-3 text-[12.5px] font-medium",
              v.id === view
                ? "bg-[#0B0B0C] text-white"
                : "text-[#0B0B0C]/60 hover:bg-black/[0.05]",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>
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
        <EmailsView drafts={drafts} toWrite={toWrite} usage={usage} on={on} />
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
