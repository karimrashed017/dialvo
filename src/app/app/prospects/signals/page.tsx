import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Radar } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { agoWords } from "@/lib/app/time";
import {
  SIGNAL_MONITOR_MAX_MATCHES,
  SIGNAL_MONITORS_MAX,
  SIGNALS_PER_DAY,
} from "@/lib/plays/config";
import { EMPLOYEE_RANGES } from "@/lib/plays/findymail";
import { playReads } from "@/lib/plays/read";
import {
  contactDatabaseStatus,
  prospectRuntimeStatus,
} from "@/lib/prospects/config";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  Badge,
  btn,
  Empty,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { addMonitor, decideSignal, deleteMonitor } from "../../plays/actions";
import { FindTabs } from "../tabs";

export const metadata: Metadata = { title: "Signals" };

const TYPE_LABEL: Record<string, string> = {
  new_hire: "New hires",
  job_change: "Job changes",
  keyword_mention: "Keyword mentions",
  post_engagement: "Post engagement",
};

const SIGNAL_STATUS: Record<string, string> = {
  kept: "Kept",
  no_email: "No email found",
  dismissed: "Dismissed",
  skipped: "Already yours or never contact",
  finding: "Finding their email",
};

async function Content() {
  const { workspace, preview } = await getAppContext();
  const on = prospectRuntimeStatus().on && contactDatabaseStatus().on;
  const head = (
    <>
      <PageHead
        title="Find leads"
        note="Buying signals: a new hire, a job change, or someone posting about what you solve. Keep one and Dialvo finds that person's email and drafts a first email that opens with the signal."
      />
      <FindTabs current="signals" />
    </>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={cn(panel, "p-4 text-[13px]")}>
          This needs the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );
  const supabase = await createClient();
  const reads = playReads(supabase, workspace.id);
  const [monitors, signals, campaigns] = await Promise.all([
    reads.monitors(),
    reads.signals(),
    reads.campaigns(["signals"]),
  ]);
  const fresh = signals.filter((s) => s.status === "new");
  const decided = signals.filter((s) => s.status !== "new").slice(0, 30);
  const signalsSearch = campaigns[0]?.search_id ?? null;

  return (
    <>
      {head}
      <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
        <div className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Watch for a signal
              <span className="text-[11.5px] font-normal text-[#0B0B0C]/50 tabular-nums">
                {monitors.filter((m) => m.status !== "failed").length} of{" "}
                {SIGNAL_MONITORS_MAX}
              </span>
            </h2>
            <ActionForm
              action={addMonitor}
              resetOnSuccess
              className="space-y-3 p-4"
            >
              <label className={labelCls}>
                Signal
                <select
                  name="type"
                  className={cn(input, "mt-1")}
                  defaultValue="keyword_mention"
                >
                  <option value="keyword_mention">
                    Someone posts about a keyword
                  </option>
                  <option value="new_hire">A company makes a new hire</option>
                  <option value="job_change">Someone changes job</option>
                </select>
              </label>
              <label className={labelCls}>
                Keywords{" "}
                <span className="font-normal text-[#0B0B0C]/45">
                  (for posts, up to 5)
                </span>
                <input
                  name="keywords"
                  maxLength={300}
                  placeholder="hiring SDRs, new CRM"
                  className={cn(input, "mt-1")}
                />
              </label>
              <label className={labelCls}>
                Only these companies{" "}
                <span className="font-normal text-[#0B0B0C]/45">
                  (hires and job changes, optional)
                </span>
                <textarea
                  name="companies"
                  rows={2}
                  maxLength={4000}
                  placeholder="acme.com, northwind.co.uk"
                  className={cn(input, "mt-1")}
                />
              </label>
              <label className={labelCls}>
                Countries{" "}
                <span className="font-normal text-[#0B0B0C]/45">
                  (two-letter codes, optional)
                </span>
                <input
                  name="countries"
                  maxLength={60}
                  placeholder="GB, IE"
                  className={cn(input, "mt-1")}
                />
              </label>
              <fieldset>
                <legend className={labelCls}>Company size (optional)</legend>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {EMPLOYEE_RANGES.map((r) => (
                    <label
                      key={r}
                      className="flex items-center gap-1.5 text-[12.5px]"
                    >
                      <input
                        type="checkbox"
                        name="sizes"
                        value={r}
                        className="size-3.5 accent-[#0B0B0C]"
                      />
                      {r}
                    </label>
                  ))}
                </div>
              </fieldset>
              <SubmitButton
                disabled={
                  !on ||
                  monitors.filter((m) => m.status !== "failed").length >=
                    SIGNAL_MONITORS_MAX
                }
              >
                Start watching
              </SubmitButton>
              <p className={hint}>
                {on
                  ? `Each monitor stops after ${SIGNAL_MONITOR_MAX_MATCHES} signals, and this workspace takes at most ${SIGNALS_PER_DAY} a day. The contact database charges for each signal a monitor delivers (about 1 to 2 credits), and 1 more when you keep one and an email is found.`
                  : "Needs the contact database, which isn't switched on yet on Dialvo's side."}
              </p>
            </ActionForm>
          </section>
          {monitors.length > 0 && (
            <section className={panel}>
              <h2 className={panelHead}>Watching</h2>
              <ul className="divide-y divide-black/[0.06]">
                {monitors.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{m.name}</span>
                      <span className="block text-[11.5px] text-[#0B0B0C]/50">
                        {TYPE_LABEL[m.signal_type] ?? m.signal_type}
                        {m.keywords.length ? `: ${m.keywords.join(", ")}` : ""}
                        {" · "}
                        {m.status === "active"
                          ? m.last_pulled_at
                            ? `checked ${agoWords(m.last_pulled_at)}`
                            : "first check within a day"
                          : m.status === "failed"
                            ? "not accepted by the contact database"
                            : m.status}
                      </span>
                    </span>
                    <ActionForm
                      action={deleteMonitor}
                      confirm="Stop watching? It stops finding, and charging for, signals."
                    >
                      <input type="hidden" name="monitor" value={m.id} />
                      <SubmitButton
                        variant="ghost"
                        small
                        pendingText="Removing…"
                      >
                        Remove
                      </SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>
              New signals
              {signalsSearch && (
                <Link
                  href={`/app/prospects?search=${signalsSearch}`}
                  className={cn(btn.ghost, btn.small)}
                >
                  Kept people
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              )}
            </h2>
            {fresh.length === 0 ? (
              <Empty icon={Radar} title="No new signals">
                {monitors.length
                  ? "Signals arrive once a day. When something matches, it shows here with who it is and why."
                  : "Start watching for a signal. When something matches, it shows here with who it is and why."}
              </Empty>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {fresh.map((s) => (
                  <li key={s.id} className="px-4 py-3 text-[13px]">
                    <p className="font-medium">{s.summary}</p>
                    {s.snippet && (
                      <p className="mt-1 line-clamp-3 text-[12.5px] text-[#0B0B0C]/60">
                        “{s.snippet}”
                      </p>
                    )}
                    <p className="mt-1 text-[11.5px] text-[#0B0B0C]/50">
                      {[s.company_domain, s.company_size, s.company_country]
                        .filter(Boolean)
                        .join(" · ")}
                      {s.relevance_score !== null &&
                        ` · relevance ${s.relevance_score} of 5`}
                      {s.contact_linkedin_url && (
                        <>
                          {" · "}
                          <a
                            href={s.contact_linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="underline underline-offset-2"
                          >
                            Profile
                          </a>
                        </>
                      )}
                    </p>
                    <ActionForm
                      action={decideSignal}
                      className="mt-2 flex flex-wrap gap-2"
                    >
                      <input type="hidden" name="signal" value={s.id} />
                      <SubmitButton
                        name="action"
                        value="keep"
                        small
                        disabled={!on}
                        pendingText="Finding their email…"
                      >
                        Keep and find email
                      </SubmitButton>
                      <SubmitButton
                        name="action"
                        value="dismiss"
                        variant="ghost"
                        small
                        pendingText="Dismissing…"
                      >
                        Dismiss
                      </SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {decided.length > 0 && (
            <section className={panel}>
              <h2 className={panelHead}>Decided</h2>
              <ul className="divide-y divide-black/[0.06]">
                {decided.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-start gap-3 px-4 py-2 text-[12.5px]"
                  >
                    <span className="min-w-0 flex-1 text-[#0B0B0C]/75">
                      {s.summary}
                    </span>
                    <Badge tone={s.status === "kept" ? "ink" : "outline"}>
                      {SIGNAL_STATUS[s.status] ?? s.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export default function SignalsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
