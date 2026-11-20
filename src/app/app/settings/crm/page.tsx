import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getAppContext } from "@/lib/app/context";
import { agoWords, dateOnly } from "@/lib/app/time";
import { PULL_CONTACT_CAP } from "@/lib/crm/config";
import { HUBSPOT_SCOPES } from "@/lib/crm/hubspot";
import { IMPORT_MAPPING, MAPPING } from "@/lib/crm/mapping";
import { crmRuntimeStatus } from "@/lib/crm/runtime";
import { clientFor } from "@/lib/crm/steps";
import { createCrmStore } from "@/lib/crm/store";
import { PROVIDER_NAME, type Pipeline, type Provider } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  Badge,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import {
  disconnectAction,
  pullNowAction,
  retryAction,
  saveSettingsAction,
  syncNowAction,
} from "./actions";
import { ConnectForm } from "./connect-form";

export const metadata: Metadata = { title: "CRM" };

type Connection = {
  provider: Provider;
  status: "active" | "error" | "disconnected";
  status_reason: string | null;
  account_label: string;
  can_opt_out: boolean;
  can_deals: boolean;
  skip_rule: "any_contact" | "customers_and_open_deals";
  deal_trigger: "off" | "qualified" | "meeting_booked";
  deal_pipeline_id: string | null;
  deal_stage_id: string | null;
  pull_status: "idle" | "queued" | "running" | "done" | "capped" | "failed";
  pull_seen: number;
  last_pull_at: string | null;
  last_pull_error: string | null;
  known_count: number;
  last_push_at: string | null;
  connected_at: string;
};

type FailedJob = {
  id: string;
  kind: string;
  last_error: string | null;
  updated_at: string;
  lead: { name: string; email: string | null; company: string | null } | null;
};

const KIND_WORDS: Record<string, string> = {
  contact: "Contact",
  note: "Note",
  meeting: "Meeting",
  deal: "Deal",
  opt_out: "Do not contact",
};

const number = (n: number) => n.toLocaleString("en-US");

async function counts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
) {
  const count = async (
    build: (q: ReturnType<typeof base>) => ReturnType<typeof base>,
  ) => {
    const { count } = await build(base());
    return count ?? 0;
  };
  const base = () =>
    supabase
      .from("crm_sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
  const [contacts, notes, meetings, deals, waiting, failed] = await Promise.all(
    [
      count((q) => q.eq("status", "done").eq("kind", "contact")),
      count((q) => q.eq("status", "done").in("kind", ["note", "opt_out"])),
      count((q) => q.eq("status", "done").eq("kind", "meeting")),
      count((q) => q.eq("status", "done").eq("kind", "deal")),
      count((q) => q.in("status", ["pending", "running"])),
      count((q) => q.eq("status", "failed")),
    ],
  );
  return { contacts, notes, meetings, deals, waiting, failed };
}

function importLine(c: Connection, timeZone: string): string {
  const crm = PROVIDER_NAME[c.provider];
  switch (c.pull_status) {
    case "queued":
      return `Waiting to import your ${crm} contacts. This starts within a minute or two.`;
    case "running":
      return `Importing your ${crm} contacts: ${number(c.pull_seen)} read so far.`;
    case "done":
      return `${number(c.known_count)} emails and company domains from ${crm}, imported ${agoWords(c.last_pull_at)}. Dialvo imports again every day.`;
    case "capped":
      return `${number(c.known_count)} emails and company domains, imported ${agoWords(c.last_pull_at)}. The import stopped at its limit of ${number(PULL_CONTACT_CAP)} contacts and companies, so some of your ${crm} contacts aren't on the list.`;
    case "failed":
      return `The last import didn't finish: ${c.last_pull_error ?? "no reason given"}. Dialvo tries again within the hour.${c.last_pull_at ? ` The list from ${dateOnly(c.last_pull_at, timeZone)} is still used.` : ""}`;
    default:
      return "Nothing imported.";
  }
}

async function Pipelines({
  workspaceId,
  current,
}: {
  workspaceId: string;
  current: string;
}) {
  let pipelines: Pipeline[] | null = null;
  try {
    const store = createCrmStore();
    const credentials = store ? await store.credentials(workspaceId) : null;
    const client = credentials ? clientFor(credentials) : null;
    if (client) pipelines = await client.pipelines();
  } catch {
    pipelines = null;
  }
  if (!pipelines?.length)
    return (
      <p className={`${hint} mt-1`}>
        Dialvo couldn&apos;t read your pipelines just now, so deals can&apos;t
        be set up. Reload the page to try again.
      </p>
    );
  return (
    <select
      name="deal_stage"
      defaultValue={current}
      className={`${input} mt-1`}
    >
      <option value="">Choose a pipeline and stage</option>
      {pipelines.map((p) => (
        <optgroup key={p.id} label={p.name || p.id}>
          {p.stages.map((s) => (
            <option key={s.id} value={`${p.id}::${s.id}`}>
              {p.name}: {s.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

async function Crm() {
  const { workspace } = await getAppContext();
  const supabase = await createClient();
  const on = crmRuntimeStatus().on;
  const admin = workspace.role !== "member";
  const { data } = await supabase
    .from("crm_connections")
    .select(
      "provider, status, status_reason, account_label, can_opt_out, can_deals, skip_rule, deal_trigger, deal_pipeline_id, deal_stage_id, pull_status, pull_seen, last_pull_at, last_pull_error, known_count, last_push_at, connected_at",
    )
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  const c = data as Connection | null;
  const connected = c && c.status !== "disconnected";

  const head = (
    <PageHead
      title="CRM"
      note="Dialvo writes its leads, conversations and meetings into your CRM, and stays away from anyone who is already in it."
    >
      <Link
        href="/app/settings"
        className="text-[13px] text-[#0B0B0C]/60 hover:text-[#0B0B0C]"
      >
        Back to Settings
      </Link>
    </PageHead>
  );
  const offNotice = !on && (
    <p className="mb-3 rounded-2xl border border-black/[0.07] bg-white px-4 py-3 text-[13px] leading-[1.5] text-[#0B0B0C]/70">
      CRM sync isn&apos;t switched on yet on Dialvo&apos;s side, so a CRM
      can&apos;t be connected here yet.
    </p>
  );

  if (!connected)
    return (
      <>
        {head}
        {offNotice}
        <section className={panel}>
          <h2 className={panelHead}>Connect your CRM</h2>
          {admin ? (
            <ConnectForm hubspotScopes={HUBSPOT_SCOPES} disabled={!on} />
          ) : (
            <p className="p-4 text-[13px] text-[#0B0B0C]/70">
              No CRM is connected. Only the workspace&apos;s owner and admins
              can connect one.
            </p>
          )}
          <div className="border-t border-black/[0.06] px-4 py-3 text-[12.5px] leading-[1.55] text-[#0B0B0C]/60">
            One CRM per workspace. Once connected, Dialvo adds each new lead
            with an email address as a contact (or finds the one already there,
            and leaves it as it is), adds its company, and writes notes for
            chats, emails and meetings. It also imports your CRM&apos;s contact
            emails and company domains, as one-way fingerprints only, so Find
            leads and outreach skip people you already know.
          </div>
        </section>
      </>
    );

  const crm = PROVIDER_NAME[c.provider];
  const n = await counts(supabase, workspace.id);
  const { data: failedRows } = await supabase
    .from("crm_sync_jobs")
    .select(
      "id, kind, last_error, updated_at, lead:leads(name, email, company)",
    )
    .eq("workspace_id", workspace.id)
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(20);
  const failed = (failedRows ?? []) as unknown as FailedJob[];
  const currentStage = c.deal_pipeline_id
    ? `${c.deal_pipeline_id}::${c.deal_stage_id ?? ""}`
    : "";

  return (
    <>
      {head}
      {offNotice}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <section className={cn(panel, "lg:col-span-2")}>
          <h2 className={panelHead}>
            {crm}
            {c.status === "active" ? (
              <Badge tone="ink">Connected</Badge>
            ) : (
              <Badge tone="warn">Needs a new token</Badge>
            )}
          </h2>
          <div className="space-y-2 p-4 text-[13px] leading-[1.5] text-[#0B0B0C]/75">
            {c.status === "error" && (
              <p role="alert" className="text-[#B42318]">
                {c.status_reason ?? `${crm} stopped accepting the token.`}{" "}
                Nothing is written to {crm} until it is connected again; what is
                waiting will be written then.
              </p>
            )}
            <p>
              {c.account_label || crm}, connected on{" "}
              {dateOnly(c.connected_at, workspace.timezone)}.{" "}
              {c.last_push_at
                ? `Last written to ${crm} ${agoWords(c.last_push_at)}.`
                : `Nothing written to ${crm} yet.`}
            </p>
            <p>{importLine(c, workspace.timezone)}</p>
          </div>
          {admin && (
            <div className="flex flex-wrap items-start gap-2 border-t border-black/[0.06] px-4 py-3">
              <ActionForm action={syncNowAction}>
                <SubmitButton
                  variant="secondary"
                  small
                  disabled={!on || c.status !== "active"}
                  pendingText="Writing…"
                >
                  Sync now
                </SubmitButton>
              </ActionForm>
              <ActionForm action={pullNowAction}>
                <SubmitButton
                  variant="secondary"
                  small
                  disabled={c.status !== "active"}
                >
                  Import contacts again
                </SubmitButton>
              </ActionForm>
              <ActionForm
                action={disconnectAction}
                confirm={`Disconnect ${crm}? Dialvo deletes the token, stops writing to ${crm} and forgets the imported list, so people in your CRM are no longer skipped. What is already in ${crm} stays there.`}
              >
                <SubmitButton
                  variant="danger"
                  small
                  pendingText="Disconnecting…"
                >
                  Disconnect
                </SubmitButton>
              </ActionForm>
            </div>
          )}
        </section>

        <section className={panel}>
          <h2 className={panelHead}>Written to {crm}</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-[13px]">
            {(
              [
                ["Contacts", n.contacts],
                ["Notes", n.notes],
                ["Meetings", n.meetings],
                ["Deals", n.deals],
                ["Waiting", n.waiting],
                ["Failed", n.failed],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-[12px] text-[#0B0B0C]/55">{label}</dt>
                <dd className="text-[17px] font-medium tabular-nums">
                  {number(value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={panel}>
          <h2 className={panelHead}>Settings</h2>
          <ActionForm action={saveSettingsAction} className="space-y-4 p-4">
            <fieldset disabled={!admin} className="space-y-4">
              <div>
                <p className={labelCls}>Who Find leads and outreach skip</p>
                <label className="mt-2 flex items-start gap-2 text-[13px]">
                  <input
                    type="radio"
                    name="skip_rule"
                    value="any_contact"
                    defaultChecked={c.skip_rule === "any_contact"}
                    className="mt-1"
                  />
                  <span>
                    Anyone in {crm}: every contact, and every company it has.
                  </span>
                </label>
                <label className="mt-1.5 flex items-start gap-2 text-[13px]">
                  <input
                    type="radio"
                    name="skip_rule"
                    value="customers_and_open_deals"
                    defaultChecked={c.skip_rule === "customers_and_open_deals"}
                    className="mt-1"
                  />
                  <span>
                    Only customers and anyone with a deal under way
                    {c.provider === "hubspot"
                      ? " (lifecycle stage Opportunity, Customer or Evangelist)"
                      : " (an open or won deal)"}
                    .
                  </span>
                </label>
                <p className={`${hint} mt-1.5`}>
                  Your own never-contact list always applies as well.
                </p>
              </div>
              <div>
                <label className={labelCls}>
                  Create a deal in {crm}
                  <select
                    name="deal_trigger"
                    defaultValue={c.deal_trigger}
                    disabled={!c.can_deals}
                    className={`${input} mt-1`}
                  >
                    <option value="off">Never</option>
                    <option value="qualified">When a lead is qualified</option>
                    <option value="meeting_booked">
                      When a meeting is booked
                    </option>
                  </select>
                </label>
                {c.can_deals ? (
                  admin && (
                    <Suspense
                      fallback={
                        <p className={`${hint} mt-1`}>
                          Reading your pipelines…
                        </p>
                      }
                    >
                      <Pipelines
                        workspaceId={workspace.id}
                        current={currentStage}
                      />
                    </Suspense>
                  )
                ) : (
                  <p className={`${hint} mt-1`}>
                    The key can&apos;t create deals. Add the deals permissions
                    to it in {crm}, then connect again.
                  </p>
                )}
                {!c.can_deals && (
                  <input type="hidden" name="deal_trigger" value="off" />
                )}
              </div>
            </fieldset>
            {admin ? (
              <SubmitButton>Save</SubmitButton>
            ) : (
              <p className={hint}>
                Only the workspace&apos;s owner and admins can change this.
              </p>
            )}
          </ActionForm>
        </section>

        {failed.length > 0 && (
          <section className={cn(panel, "lg:col-span-2")}>
            <h2 className={panelHead}>
              Couldn&apos;t be written
              {admin && (
                <ActionForm action={retryAction} quiet>
                  <SubmitButton variant="secondary" small>
                    Retry all
                  </SubmitButton>
                </ActionForm>
              )}
            </h2>
            <ul>
              {failed.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-black/[0.06] px-4 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1 text-[13px] leading-[1.5]">
                    <p className="font-medium">
                      {KIND_WORDS[f.kind] ?? f.kind}:{" "}
                      {f.lead?.name ||
                        f.lead?.company ||
                        f.lead?.email ||
                        "a lead"}
                    </p>
                    <p className="text-[#0B0B0C]/65">
                      {f.last_error ?? `${crm} didn't accept it.`}
                    </p>
                    <p className="text-[12px] text-[#0B0B0C]/45">
                      {agoWords(f.updated_at)}
                    </p>
                  </div>
                  {admin && (
                    <ActionForm action={retryAction}>
                      <input type="hidden" name="job_id" value={f.id} />
                      <SubmitButton variant="ghost" small>
                        Retry
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={cn(panel, "lg:col-span-2")}>
          <h2 className={panelHead}>What goes where</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[12.5px]">
              <thead className="text-[#0B0B0C]/55">
                <tr className="border-b border-black/[0.06]">
                  <th className="px-4 py-2 font-medium">In Dialvo</th>
                  <th className="px-4 py-2 font-medium">In {crm}</th>
                  <th className="px-4 py-2 font-medium">How</th>
                </tr>
              </thead>
              <tbody>
                {MAPPING[c.provider].map((row) => (
                  <tr
                    key={row.dialvo}
                    className="border-b border-black/[0.05] align-top last:border-0"
                  >
                    <td className="px-4 py-2">{row.dialvo}</td>
                    <td className="px-4 py-2">{row.crm}</td>
                    <td className="px-4 py-2 text-[#0B0B0C]/60">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-black/[0.06] px-4 py-3 text-[12.5px] leading-[1.55] text-[#0B0B0C]/60">
            Read from {crm}: {IMPORT_MAPPING[c.provider]} Dialvo keeps only a
            one-way fingerprint of each email and domain, nothing else about the
            person. Leads without an email address aren&apos;t written, because
            the CRM matches people by email.
            {c.provider === "hubspot" &&
              !c.can_opt_out &&
              " The key can't change email subscriptions, so a do-not-contact is written as a note."}
          </p>
        </section>
      </div>
    </>
  );
}

export default function CrmPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Crm />
    </Suspense>
  );
}
