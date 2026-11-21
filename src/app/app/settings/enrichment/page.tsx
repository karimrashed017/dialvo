import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago } from "@/lib/app/time";
import {
  ENRICH_MAX_CREDITS_PER_LEAD,
  ENRICH_MONTHLY_CAP_DEFAULT,
  ENRICH_MONTHLY_CAP_MAX,
  ENRICH_REFRESH_DAYS_DEFAULT,
} from "@/lib/data/config";
import { contactDatabaseStatus } from "@/lib/prospects/config";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  Badge,
  btn,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { checkNow, saveEnrichment } from "./actions";

export const metadata: Metadata = { title: "Enrichment" };

type Settings = {
  enabled: boolean;
  fill_emails: boolean;
  fill_titles: boolean;
  fill_company: boolean;
  job_changes: boolean;
  personal_emails: boolean;
  write_back: boolean;
  refresh_days: number;
  monthly_credit_cap: number;
};

const DEFAULTS: Settings = {
  enabled: false,
  fill_emails: true,
  fill_titles: true,
  fill_company: true,
  job_changes: true,
  personal_emails: true,
  write_back: true,
  refresh_days: ENRICH_REFRESH_DAYS_DEFAULT,
  monthly_credit_cap: ENRICH_MONTHLY_CAP_DEFAULT,
};

const KIND: Record<string, string> = {
  filled: "Filled in",
  job_change: "Job change",
  email_invalid: "Email stopped working",
  work_email: "Work email found",
};

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Enrichment"
      note="Keeps your leads complete and current: missing work emails, titles and company details filled in from the contact database, emails checked again, job changes spotted, and people who signed up with a personal address matched to the company they work at. Changes can be written to your CRM as notes."
    >
      <Link href="/app/settings" className={cn(btn.ghost, btn.small)}>
        <ArrowLeft aria-hidden className="size-3.5" />
        Settings
      </Link>
    </PageHead>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={cn(panel, "p-4 text-[13px]")}>
          Enrichment needs the real app. Nothing is shown here with made-up
          data.
        </section>
      </>
    );
  const supabase = await createClient();
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const [sRes, uRes, eRes, queued, checked, crm] = await Promise.all([
    supabase
      .from("enrichment_settings")
      .select(
        "enabled, fill_emails, fill_titles, fill_company, job_changes, personal_emails, write_back, refresh_days, monthly_credit_cap",
      )
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    supabase
      .from("enrichment_usage")
      .select("credits, leads")
      .eq("workspace_id", workspace.id)
      .eq("month", month)
      .maybeSingle(),
    supabase
      .from("enrichment_events")
      .select("id, lead_id, kind, summary, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("lead_enrichment")
      .select("lead_id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .in("status", ["queued", "running"]),
    supabase
      .from("lead_enrichment")
      .select("lead_id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("status", "done"),
    supabase
      .from("crm_connections")
      .select("provider, status")
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
  ]);
  const s = (sRes.data as Settings | null) ?? DEFAULTS;
  const usage = (uRes.data as { credits: number; leads: number } | null) ?? {
    credits: 0,
    leads: 0,
  };
  const events = (eRes.data ?? []) as {
    id: string;
    lead_id: string;
    kind: string;
    summary: string;
    created_at: string;
  }[];
  const databaseOn = contactDatabaseStatus().on;
  const box = "size-4 accent-[#0B0B0C]";
  return (
    <>
      {head}
      {!databaseOn && (
        <section className={cn(panel, "mb-3 p-4 text-[13px]")}>
          The contact database isn&apos;t switched on yet on Dialvo&apos;s side.
          You can save the settings now; nothing is checked until it is.
        </section>
      )}
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Settings
              {s.enabled ? (
                <Badge tone="ink">On</Badge>
              ) : (
                <Badge tone="outline">Off</Badge>
              )}
            </h2>
            <ActionForm action={saveEnrichment} className="space-y-3 p-4">
              <fieldset disabled={!admin} className="space-y-3">
                <label className="flex items-center gap-2 text-[13px] font-medium">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={s.enabled}
                    className={box}
                  />
                  Keep my leads enriched
                </label>
                <div className="grid gap-1.5 text-[13px] sm:grid-cols-2">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="fill_emails"
                      defaultChecked={s.fill_emails}
                      className={box}
                    />
                    Find missing work emails
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="fill_titles"
                      defaultChecked={s.fill_titles}
                      className={box}
                    />
                    Fill in job titles
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="fill_company"
                      defaultChecked={s.fill_company}
                      className={box}
                    />
                    Fill in company size and industry
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="job_changes"
                      defaultChecked={s.job_changes}
                      className={box}
                    />
                    Spot job and title changes
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="personal_emails"
                      defaultChecked={s.personal_emails}
                      className={box}
                    />
                    Match personal-email sign-ups to their company
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="write_back"
                      defaultChecked={s.write_back}
                      className={box}
                    />
                    Write changes to my CRM as notes
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={labelCls}>
                    Check each lead again every
                    <span className="mt-1 flex items-center gap-2 font-normal">
                      <input
                        name="refresh_days"
                        type="number"
                        min={7}
                        max={365}
                        required
                        defaultValue={s.refresh_days}
                        className={cn(input, "max-w-[110px]")}
                      />
                      days
                    </span>
                  </label>
                  <label className={labelCls}>
                    Credits a month, at most
                    <input
                      name="monthly_cap"
                      type="number"
                      min={0}
                      max={ENRICH_MONTHLY_CAP_MAX}
                      required
                      defaultValue={s.monthly_credit_cap}
                      className={cn(input, "mt-1 max-w-[140px]")}
                    />
                  </label>
                </div>
                <p className={hint}>
                  Every email comes from the contact database&apos;s own lookup
                  and check; none is made up from a name. Only empty fields are
                  filled; a job change replaces the title and is noted on the
                  lead. A lead uses at most {ENRICH_MAX_CREDITS_PER_LEAD}{" "}
                  credits a check, nothing when nothing is found. A personal
                  address stays the lead&apos;s email; the work email found is
                  kept beside it.
                  {crm.data
                    ? " Notes go to your CRM's contact; its own fields aren't changed."
                    : " No CRM is connected, so nothing is written back."}
                </p>
              </fieldset>
              {admin ? (
                <SubmitButton>Save</SubmitButton>
              ) : (
                <p className={hint}>Only an owner or admin can change this.</p>
              )}
            </ActionForm>
          </section>
          <section className={panel}>
            <h2 className={panelHead}>What changed lately</h2>
            {events.length === 0 ? (
              <p className="p-4 text-[13px] text-[#0B0B0C]/55">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {events.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/app/leads/${e.lead_id}`}
                      className="flex flex-wrap items-start gap-2 px-4 py-2.5 text-[13px] hover:bg-black/[0.02]"
                    >
                      <Badge tone={e.kind === "job_change" ? "ink" : "outline"}>
                        {KIND[e.kind] ?? e.kind}
                      </Badge>
                      <span className="min-w-0 flex-1">{e.summary}</span>
                      <span className="text-[12px] text-[#0B0B0C]/45">
                        {ago(e.created_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>This month</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 p-4 text-[13px]">
              <dt>Credits used</dt>
              <dd className="tabular-nums">
                {usage.credits} of {s.monthly_credit_cap}
              </dd>
              <dt>Leads checked</dt>
              <dd className="tabular-nums">{usage.leads}</dd>
              <dt className="text-[#0B0B0C]/55">Waiting to be checked</dt>
              <dd className="text-[#0B0B0C]/55 tabular-nums">
                {queued.count ?? 0}
              </dd>
              <dt className="text-[#0B0B0C]/55">Checked at least once</dt>
              <dd className="text-[#0B0B0C]/55 tabular-nums">
                {checked.count ?? 0}
              </dd>
            </dl>
          </section>
          {admin && (
            <section className={panel}>
              <h2 className={panelHead}>Check now</h2>
              <ActionForm action={checkNow} className="space-y-3 p-4">
                <label className="flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" name="all" className={box} />
                  Every lead, not only the ones due
                </label>
                <p className={hint}>
                  Leads are otherwise checked when they are added and again
                  after the period above, and when an email to them bounces.
                </p>
                <SubmitButton small variant="secondary" pendingText="Queuing…">
                  Check now
                </SubmitButton>
              </ActionForm>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

export default function EnrichmentPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
