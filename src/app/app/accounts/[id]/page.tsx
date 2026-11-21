import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Users } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago, dateTime } from "@/lib/app/time";
import { CHANNEL_LABEL, type Channel, type LeadStatus } from "@/lib/app/types";
import { COMMITTEE_PEOPLE, SEND_TO_PLAY_MAX } from "@/lib/data/config";
import { dataOptions } from "@/lib/data/read";
import { isUuid } from "@/lib/leads/fields";
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
  StatusBadge,
} from "../../_ui/kit";
import { accountToPlaybook, findCommittee, setAccountOwner } from "../actions";

export const metadata: Metadata = { title: "Account" };

type LeadRow = {
  id: string;
  name: string;
  email: string | null;
  status: LeadStatus;
  tier: number | null;
  custom_fields: Record<string, unknown>;
  owner_id: string | null;
};

async function Content({
  params,
}: {
  params: PageProps<"/app/accounts/[id]">["params"];
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { workspace, preview, repo } = await getAppContext();
  if (preview) notFound();
  const admin = workspace.role !== "member";
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("accounts")
    .select(
      "id, domain, name, country, region, size_range, industry, fit_score, owner_id, territory_id, committee_titles",
    )
    .eq("workspace_id", workspace.id)
    .eq("id", id)
    .maybeSingle();
  if (!account) notFound();
  const { data: leadData } = await supabase
    .from("leads")
    .select("id, name, email, status, tier, custom_fields, owner_id")
    .eq("workspace_id", workspace.id)
    .eq("account_id", id)
    .order("created_at")
    .limit(200);
  const leads = (leadData ?? []) as LeadRow[];
  const leadIds = leads.map((l) => l.id);
  const [convRes, meetRes, members, options, territoryRes] = await Promise.all([
    leadIds.length
      ? supabase
          .from("conversations")
          .select("id, lead_id, channel, status, last_message_at")
          .eq("workspace_id", workspace.id)
          .in("lead_id", leadIds)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    leadIds.length
      ? supabase
          .from("meetings")
          .select("id, lead_id, title, starts_at, status")
          .eq("workspace_id", workspace.id)
          .in("lead_id", leadIds)
          .order("starts_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    repo.members(),
    dataOptions(supabase, workspace.id),
    account.territory_id
      ? supabase
          .from("territories")
          .select("name")
          .eq("id", account.territory_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const conversations = (convRes.data ?? []) as {
    id: string;
    lead_id: string;
    channel: Channel;
    status: string;
    last_message_at: string | null;
  }[];
  const meetings = (meetRes.data ?? []) as {
    id: string;
    lead_id: string;
    title: string | null;
    starts_at: string;
    status: string;
  }[];
  const leadName = new Map(
    leads.map((l) => [l.id, l.name || l.email || "A lead"]),
  );
  const nameOf = new Map(members.map((m) => [m.user_id, m.name || m.email]));
  const titles = ((account.committee_titles ?? []) as string[]).join(", ");
  const territoryName = (territoryRes.data as { name: string } | null)?.name;
  return (
    <>
      <PageHead
        title={account.name || account.domain}
        note={[
          account.domain,
          account.industry,
          account.size_range,
          [account.region, account.country].filter(Boolean).join(", "),
          account.fit_score != null ? `fit ${account.fit_score}` : "",
          territoryName ? `territory ${territoryName}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <Link href="/app/accounts" className={cn(btn.ghost, btn.small)}>
          <ArrowLeft aria-hidden className="size-3.5" />
          Accounts
        </Link>
      </PageHead>
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>
              People at {account.name || account.domain}
              <span className="text-[12px] font-normal text-[#0B0B0C]/50">
                {leads.length}
              </span>
            </h2>
            {leads.length === 0 ? (
              <Empty icon={Users} title="Nobody here yet">
                Find the buying committee on the right, or add leads with an
                email or website at {account.domain}.
              </Empty>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {leads.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/app/leads/${l.id}`}
                      className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-black/[0.02]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{l.name || l.email}</span>
                        <span className="block truncate text-[12px] text-[#0B0B0C]/55">
                          {[
                            typeof l.custom_fields?.title === "string"
                              ? l.custom_fields.title
                              : "",
                            l.email,
                            l.owner_id
                              ? `owner ${nameOf.get(l.owner_id) ?? "a teammate"}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <StatusBadge status={l.status} />
                      {l.tier && (
                        <Badge tone={l.tier === 1 ? "ink" : "outline"}>
                          Tier {l.tier}
                        </Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Conversations</h2>
            {conversations.length === 0 ? (
              <p className="p-4 text-[13px] text-[#0B0B0C]/55">
                No conversations with anyone here yet.
              </p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/app/inbox?c=${c.id}`}
                      className="flex items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-black/[0.02]"
                    >
                      <span className="min-w-0 flex-1">
                        {leadName.get(c.lead_id)} · {CHANNEL_LABEL[c.channel]}
                      </span>
                      <span className="text-[12px] text-[#0B0B0C]/50">
                        {c.status.replace(/_/g, " ")} · {ago(c.last_message_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Meetings</h2>
            {meetings.length === 0 ? (
              <p className="p-4 text-[13px] text-[#0B0B0C]/55">
                No meetings yet.
              </p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {meetings.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 px-4 py-2.5 text-[13px]"
                  >
                    <span className="min-w-0 flex-1">
                      {m.title || "Meeting"} with {leadName.get(m.lead_id)}
                    </span>
                    <span className="text-[12px] text-[#0B0B0C]/50">
                      {dateTime(m.starts_at, workspace.timezone)} ·{" "}
                      {m.status.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>Find the buying committee</h2>
            <ActionForm action={findCommittee} className="space-y-3 p-4">
              <input type="hidden" name="account" value={id} />
              <label className={labelCls}>
                Job titles to look for
                <input
                  name="titles"
                  required
                  maxLength={800}
                  defaultValue={titles}
                  placeholder="Head of Operations, Finance Director, Founder"
                  className={cn(input, "mt-1")}
                />
              </label>
              <p className={hint}>
                Looks up to {COMMITTEE_PEOPLE} people with those titles in the
                contact database, and each one&apos;s work email (only the ones
                it finds). About {COMMITTEE_PEOPLE * 2} credits at most, from
                today&apos;s limit.
              </p>
              <SubmitButton small pendingText="Looking…">
                Find people
              </SubmitButton>
            </ActionForm>
          </section>
          {options.playbooks.length > 0 && (
            <section className={panel}>
              <h2 className={panelHead}>Start a playbook on this account</h2>
              <ActionForm action={accountToPlaybook} className="space-y-3 p-4">
                <input type="hidden" name="account" value={id} />
                <input
                  type="hidden"
                  name="name"
                  value={account.name || account.domain}
                />
                <select
                  name="playbook"
                  required
                  defaultValue=""
                  aria-label="Playbook"
                  className={input}
                >
                  <option value="">Choose a playbook</option>
                  {options.playbooks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p className={hint}>
                  Everyone here the playbook may write to gets their own first
                  email (up to {SEND_TO_PLAY_MAX}), each waiting for approval if
                  the playbook says so.
                </p>
                <SubmitButton small pendingText="Starting…">
                  Start
                </SubmitButton>
              </ActionForm>
            </section>
          )}
          <section className={panel}>
            <h2 className={panelHead}>Owner</h2>
            <ActionForm action={setAccountOwner} className="space-y-3 p-4">
              <input type="hidden" name="account" value={id} />
              <fieldset disabled={!admin} className="space-y-3">
                <select
                  name="owner"
                  defaultValue={account.owner_id ?? ""}
                  aria-label="Owner"
                  className={input}
                >
                  <option value="">Nobody</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name || m.email}
                    </option>
                  ))}
                </select>
              </fieldset>
              {admin ? (
                <SubmitButton small variant="secondary">
                  Save owner
                </SubmitButton>
              ) : (
                <p className={hint}>Only an owner or admin can change this.</p>
              )}
            </ActionForm>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function AccountPage(props: PageProps<"/app/accounts/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}
