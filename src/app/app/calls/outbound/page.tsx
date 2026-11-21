import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PhoneOutgoing } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { dateTime } from "@/lib/app/time";
import { BATCH_MAX_LEADS } from "@/lib/phone/config";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  Badge,
  Empty,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { createBatch, decideBatch } from "../actions";
import { CallsTabs, SetupNotice } from "../ui";

export const metadata: Metadata = { title: "Outbound calls" };

// Consented outbound calling: choose leads who agreed to be called, say
// what the calls are for, and an owner or admin approves the batch before
// a single call is made. The database checks every rule again at the
// moment of each call.

type Lead = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  time_zone: string | null;
  consent_call_source: string | null;
};
type Batch = {
  id: string;
  name: string;
  purpose: string;
  status: string;
  lead_count: number;
  created_at: string;
  approved_at: string | null;
};
type Item = {
  batch_id: string;
  status: string;
  skip_reason: string | null;
  lead: { id: string; name: string; phone: string | null } | null;
};

const BATCH_STATUS: Record<string, string> = {
  waiting_approval: "Waiting for approval",
  approved: "Approved: calling in the window",
  done: "Done",
  cancelled: "Cancelled",
};
const ITEM_STATUS: Record<string, string> = {
  waiting: "Waiting",
  calling: "Calling",
  called: "Called",
  skipped: "Left out",
  cancelled: "Cancelled",
};

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Calls"
      note="Calls only to people who agreed to be called, inside your call window in their own time zone, under the daily caps, never to anyone on the do-not-call list, and only after an owner or admin approves the batch."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <CallsTabs current="outbound" />
        <section className={panel}>
          <Empty title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const [leads, batches, items, phone] = await Promise.all([
    supabase
      .from("leads")
      .select("id, name, company, phone, time_zone, consent_call_source")
      .eq("workspace_id", workspace.id)
      .eq("consent_call", true)
      .eq("do_not_contact", false)
      .neq("status", "unsubscribed")
      .not("phone", "is", null)
      .order("updated_at", { ascending: false })
      .limit(BATCH_MAX_LEADS),
    supabase
      .from("call_batches")
      .select("id, name, purpose, status, lead_count, created_at, approved_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("call_batch_leads")
      .select("batch_id, status, skip_reason, lead:leads(id, name, phone)")
      .eq("workspace_id", workspace.id)
      .order("created_at")
      .limit(2000),
    supabase
      .from("workspace_phone")
      .select("outbound_on")
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
  ]);
  const eligible = (leads.data ?? []) as Lead[];
  const list = (batches.data ?? []) as Batch[];
  const all = (items.data ?? []) as unknown as Item[];
  const outboundOn = Boolean(
    (phone.data as { outbound_on: boolean } | null)?.outbound_on,
  );

  return (
    <>
      {head}
      <CallsTabs current="outbound" />
      <SetupNotice />
      {!outboundOn && (
        <p className="mb-3 rounded-xl border border-black/[0.1] bg-white px-4 py-3 text-[13px]">
          Outbound calling is switched off in{" "}
          <Link href="/app/calls/settings" className="underline">
            Settings
          </Link>
          . Batches can be made and approved; nobody is dialled until it is on.
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className={panel}>
          <h2 className={panelHead}>New batch</h2>
          {eligible.length === 0 ? (
            <Empty
              icon={PhoneOutgoing}
              title="Nobody has agreed to be called yet"
            >
              Record call consent on a lead&apos;s page (how and when they
              agreed), or collect it on your lead form. Only those leads can be
              called.
            </Empty>
          ) : (
            <ActionForm
              action={createBatch}
              resetOnSuccess
              className="space-y-3 p-4"
            >
              <label className="block">
                <span className={labelCls}>Name</span>
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder="Callbacks this week"
                  className={cn(input, "mt-1")}
                />
              </label>
              <label className="block">
                <span className={labelCls}>
                  What the calls are for (the agent&apos;s brief)
                </span>
                <textarea
                  name="purpose"
                  rows={3}
                  maxLength={2000}
                  placeholder="They asked for a quote on the form. Find out what they need and offer a call with Priya."
                  className={cn(input, "mt-1")}
                />
              </label>
              <fieldset>
                <legend className={labelCls}>
                  Leads who agreed to be called ({eligible.length})
                </legend>
                <ul className="mt-1 max-h-80 divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/[0.07]">
                  {eligible.map((l) => (
                    <li key={l.id}>
                      <label className="flex items-start gap-2.5 px-3 py-2">
                        <input
                          type="checkbox"
                          name="lead"
                          value={l.id}
                          className="mt-1 accent-[#0B0B0C]"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium">
                            {l.name || l.phone}
                            {l.company ? ` · ${l.company}` : ""}
                          </span>
                          <span className="block truncate text-[12px] text-[#0B0B0C]/50">
                            {l.phone} ·{" "}
                            {l.time_zone ?? "time zone from the number"} ·{" "}
                            {l.consent_call_source}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
              <SubmitButton>Make the batch</SubmitButton>
              <p className={hint}>
                It waits for an owner or admin to approve it.
              </p>
            </ActionForm>
          )}
        </section>

        <section className={panel}>
          <h2 className={panelHead}>Batches</h2>
          {list.length === 0 ? (
            <Empty title="No batches yet" />
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {list.map((b) => {
                const mine = all.filter((i) => i.batch_id === b.id);
                const count = (s: string) =>
                  mine.filter((i) => i.status === s).length;
                return (
                  <li key={b.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium">
                        {b.name}
                      </span>
                      <Badge
                        tone={
                          b.status === "waiting_approval" ? "blue" : "plain"
                        }
                      >
                        {BATCH_STATUS[b.status] ?? b.status}
                      </Badge>
                    </div>
                    <p className="text-[12px] text-[#0B0B0C]/55">
                      {dateTime(b.created_at, workspace.timezone)} ·{" "}
                      {b.lead_count} {b.lead_count === 1 ? "lead" : "leads"}:{" "}
                      {count("waiting")} waiting, {count("called")} called,{" "}
                      {count("skipped")} left out
                    </p>
                    {b.purpose && (
                      <p className="text-[12.5px] text-[#0B0B0C]/70">
                        {b.purpose}
                      </p>
                    )}
                    <details>
                      <summary className="cursor-pointer text-[12.5px] text-[#0B0B0C]/70">
                        Who is in it
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-[12.5px]">
                        {mine.map((i, n) => (
                          <li key={n} className="flex gap-2">
                            <span className="min-w-0 flex-1 truncate">
                              {i.lead?.name || i.lead?.phone}
                            </span>
                            <span className="text-[#0B0B0C]/55">
                              {ITEM_STATUS[i.status] ?? i.status}
                              {i.skip_reason ? `: ${i.skip_reason}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                    {admin &&
                      (b.status === "waiting_approval" ||
                        b.status === "approved") && (
                        <ActionForm
                          action={decideBatch}
                          className="flex gap-2"
                          confirm={
                            b.status === "approved"
                              ? "Cancel this batch? Nobody else in it will be called."
                              : undefined
                          }
                        >
                          <input type="hidden" name="batch" value={b.id} />
                          {b.status === "waiting_approval" && (
                            <SubmitButton small name="decision" value="approve">
                              Approve {count("waiting")}{" "}
                              {count("waiting") === 1 ? "call" : "calls"}
                            </SubmitButton>
                          )}
                          <SubmitButton
                            small
                            variant="ghost"
                            name="decision"
                            value="cancel"
                          >
                            Cancel
                          </SubmitButton>
                        </ActionForm>
                      )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export default function OutboundPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
