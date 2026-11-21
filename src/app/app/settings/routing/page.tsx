import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Route } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago } from "@/lib/app/time";
import type { Member } from "@/lib/app/types";
import {
  describeMatch,
  ROUTING_PLAYS,
  type RoutingMatch,
} from "@/lib/routing/rules";
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
import { deleteRule, saveRule } from "./actions";

export const metadata: Metadata = { title: "Lead routing" };

type Rule = {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  match: RoutingMatch;
  mode: "one" | "round_robin";
};

const optional = (
  <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
);

function RuleForm({
  rule,
  people,
  members,
  next,
  admin,
}: {
  rule: Rule | null;
  people: string[];
  members: Member[];
  next: number;
  admin: boolean;
}) {
  const m = rule?.match ?? {};
  return (
    <ActionForm
      action={saveRule}
      resetOnSuccess={!rule}
      className="space-y-3 p-4"
    >
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <fieldset disabled={!admin} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
          <label className={labelCls}>
            Name
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={rule?.name ?? ""}
              placeholder="UK and Ireland"
              className={cn(input, "mt-1")}
            />
          </label>
          <label className={labelCls}>
            Order
            <input
              name="position"
              type="number"
              min={0}
              max={1000}
              defaultValue={rule?.position ?? next}
              className={cn(input, "mt-1")}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>
            Country or territory {optional}
            <input
              name="countries"
              maxLength={600}
              defaultValue={(m.countries ?? []).join(", ")}
              placeholder="GB, Ireland"
              className={cn(input, "mt-1")}
            />
          </label>
          <label className={labelCls}>
            Where the lead came from {optional}
            <input
              name="sources"
              maxLength={600}
              defaultValue={(m.sources ?? []).join(", ")}
              placeholder="form, website chat"
              className={cn(input, "mt-1")}
            />
          </label>
          <label className={labelCls}>
            Company size, from {optional}
            <input
              name="size_min"
              type="number"
              min={1}
              defaultValue={m.size_min ?? ""}
              placeholder="50"
              className={cn(input, "mt-1")}
            />
          </label>
          <label className={labelCls}>
            to {optional}
            <input
              name="size_max"
              type="number"
              min={1}
              defaultValue={m.size_max ?? ""}
              placeholder="500"
              className={cn(input, "mt-1")}
            />
          </label>
        </div>
        <details>
          <summary className="cursor-pointer text-[12.5px] font-medium text-[#0B0B0C]/75">
            Only leads written to by these plays {optional}
          </summary>
          <div className="mt-2 grid gap-1.5 text-[13px] sm:grid-cols-2">
            {Object.entries(ROUTING_PLAYS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="plays"
                  value={key}
                  defaultChecked={m.plays?.includes(key) ?? false}
                  className="size-4 accent-[#0B0B0C]"
                />
                {label}
              </label>
            ))}
          </div>
        </details>
        <fieldset>
          <legend className={labelCls}>Who gets them</legend>
          <div className="mt-1.5 grid gap-1.5 text-[13px] sm:grid-cols-2">
            {members.map((p) => (
              <label key={p.user_id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="assignees"
                  value={p.user_id}
                  defaultChecked={people.includes(p.user_id)}
                  className="size-4 accent-[#0B0B0C]"
                />
                {p.name || p.email}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="mode"
              value="one"
              defaultChecked={(rule?.mode ?? "one") === "one"}
              className="size-4 accent-[#0B0B0C]"
            />
            Always the first person ticked
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="mode"
              value="round_robin"
              defaultChecked={rule?.mode === "round_robin"}
              className="size-4 accent-[#0B0B0C]"
            />
            Each in turn (round robin)
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={rule?.enabled ?? true}
              className="size-4 accent-[#0B0B0C]"
            />
            On
          </label>
        </div>
      </fieldset>
      {admin && <SubmitButton>{rule ? "Save rule" : "Add rule"}</SubmitButton>}
    </ActionForm>
  );
}

async function Content() {
  const { workspace, preview, repo } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Lead routing"
      note="Rules that give each new lead, and its conversations, to the right teammate, who is then sent an alert. The first rule a lead matches wins; a lead that matches none stays with the whole team."
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
          Routing needs the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );
  const supabase = await createClient();
  const [members, rulesRes, peopleRes, routedRes] = await Promise.all([
    repo.members(),
    supabase
      .from("routing_rules")
      .select("id, name, position, enabled, match, mode")
      .eq("workspace_id", workspace.id)
      .order("position")
      .order("created_at")
      .limit(50),
    supabase
      .from("routing_rule_assignees")
      .select("rule_id, user_id, position")
      .eq("workspace_id", workspace.id)
      .order("position")
      .limit(1000),
    supabase
      .from("activity_events")
      .select("id, lead_id, summary, created_at")
      .eq("workspace_id", workspace.id)
      .eq("kind", "lead_routed")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const rules = (rulesRes.data ?? []) as Rule[];
  const people = new Map<string, string[]>();
  for (const a of (peopleRes.data ?? []) as {
    rule_id: string;
    user_id: string;
  }[])
    people.set(a.rule_id, [...(people.get(a.rule_id) ?? []), a.user_id]);
  const nameOf = new Map(members.map((m) => [m.user_id, m.name || m.email]));
  const routed = (routedRes.data ?? []) as {
    id: string;
    lead_id: string | null;
    summary: string;
    created_at: string;
  }[];
  const next =
    rules.length === 0 ? 0 : Math.max(...rules.map((r) => r.position)) + 1;
  return (
    <>
      {head}
      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>
              Rules, in order
              <span className="text-[12px] font-normal text-[#0B0B0C]/50">
                {rules.length} of 30
              </span>
            </h2>
            {rules.length === 0 ? (
              <Empty icon={Route} title="No rules yet">
                Until there is one, every lead is the whole team&apos;s, and
                alerts go to everyone who has them on.
              </Empty>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {rules.map((r) => (
                  <li key={r.id}>
                    <details className="group">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-[13px] hover:bg-black/[0.02]">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#0B0B0C] text-[11px] text-white tabular-nums">
                          {r.position}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{r.name}</span>
                          <span className="block text-[12px] text-[#0B0B0C]/60">
                            {describeMatch(r.match)} go to{" "}
                            {(people.get(r.id) ?? [])
                              .map((u) => nameOf.get(u) ?? "someone")
                              .join(
                                r.mode === "round_robin"
                                  ? ", in turn, "
                                  : " or ",
                              )}
                            .
                          </span>
                        </span>
                        {!r.enabled && <Badge tone="outline">Off</Badge>}
                        <span className="text-[12px] text-[#0B0B0C]/50 group-open:hidden">
                          Edit
                        </span>
                      </summary>
                      <RuleForm
                        rule={r}
                        people={people.get(r.id) ?? []}
                        members={members}
                        next={next}
                        admin={admin}
                      />
                      {admin && (
                        <ActionForm
                          action={deleteRule}
                          confirm="Remove this rule? Leads already routed keep their owner."
                          className="px-4 pb-4"
                        >
                          <input type="hidden" name="id" value={r.id} />
                          <SubmitButton
                            variant="ghost"
                            small
                            pendingText="Removing…"
                          >
                            Remove rule
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {admin && (
            <section className={panel}>
              <h2 className={panelHead}>New rule</h2>
              <RuleForm
                rule={null}
                people={[]}
                members={members}
                next={next}
                admin={admin}
              />
            </section>
          )}
        </div>
        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>How it works</h2>
            <ul className="space-y-1.5 p-4 text-[12.5px] leading-[1.5] text-[#0B0B0C]/70">
              <li>
                A lead is routed when it is added (a form, the chat, an import,
                Find leads), and again when its first email goes out if it still
                has nobody: then the play is known.
              </li>
              <li>
                Country and size come from the company&apos;s research in Find
                leads, or the lead&apos;s own fields (country, company_size or
                employees, for example from an import).
              </li>
              <li>
                The person gets an email alert if they have alerts on, the lead
                shows them as its owner, and its conversations are assigned to
                them in the Inbox.
              </li>
              <li>Leads that already have an owner are never moved.</li>
            </ul>
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Recently routed</h2>
            {routed.length === 0 ? (
              <p className="p-4 text-[13px] text-[#0B0B0C]/55">
                Nothing routed yet.
              </p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {routed.map((e) => (
                  <li key={e.id} className="px-4 py-2.5 text-[12.5px]">
                    {e.lead_id ? (
                      <Link
                        href={`/app/leads/${e.lead_id}`}
                        className="underline decoration-black/25 underline-offset-2"
                      >
                        {e.summary}
                      </Link>
                    ) : (
                      e.summary
                    )}
                    <span className={cn(hint, "block")}>
                      {ago(e.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

export default function RoutingPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
