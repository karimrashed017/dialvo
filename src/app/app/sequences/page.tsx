import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ListOrdered } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { mailReads } from "@/lib/mail/read";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
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
} from "../_ui/kit";
import { LANGUAGES, languageLabel } from "@/lib/mail/languages";
import { listSequences, type Sequence } from "@/lib/sequences/server";
import { stepDays } from "@/lib/sequences/steps";
import { setSending } from "../settings/mailboxes/actions";
import {
  archiveSequence,
  saveSequence,
  saveSequenceSteps,
  setSearchSequence,
} from "./actions";
import { StepsEditor } from "./steps-editor";

export const metadata: Metadata = { title: "Sequences" };

// Every email sequence that has started: a first email and its follow-ups,
// grouped by the play or Find leads search it came from, with the steps and
// their timing, and the editor for the workspace's follow-up settings.

const PLAY_LABEL: Record<string, string> = {
  speed_to_lead: "Speed to lead",
  reactivation: "Lead reactivation",
  closed_lost: "Closed lost",
  nurture: "Lead nurture",
  onboarding: "Customer onboarding",
  expansion: "Customer expansion",
  plg: "Trial users ready to buy",
  takeout: "Competitive takeout",
  event_registration: "Event registration",
  event_followup: "Event follow-up",
  event_no_show: "Event no-show",
  accounts: "Target accounts",
  lookalike: "Lookalike",
  signal: "Buying signals",
};

const APPROVAL_LABEL = {
  approve_first: "Follow-ups wait for approval",
  auto: "Follow-ups send on their own",
} as const;

function LanguageSelect({ value }: { value: string }) {
  return (
    <select name="language" defaultValue={value} className={cn(input, "mt-1")}>
      <option value="auto">
        Auto: the company&apos;s own language (from its website)
      </option>
      {Object.entries(LANGUAGES).map(([code, name]) => (
        <option key={code} value={code}>
          {name}
        </option>
      ))}
    </select>
  );
}

/** One sequence's settings and steps, or a new one's. */
function SequenceForm({
  sequence,
  admin,
}: {
  sequence: Sequence | null;
  admin: boolean;
}) {
  return (
    <ActionForm
      action={saveSequenceSteps}
      resetOnSuccess={!sequence}
      className="space-y-3 p-4"
    >
      {sequence && <input type="hidden" name="id" value={sequence.id} />}
      <fieldset disabled={!admin} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelCls}>
            Name
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={sequence?.name ?? ""}
              placeholder="Agencies, three touches"
              className={cn(input, "mt-1")}
            />
          </label>
          <label className={labelCls}>
            Language
            <LanguageSelect value={sequence?.language ?? "auto"} />
          </label>
        </div>
        <label className={labelCls}>
          Follow-ups
          <select
            name="approval"
            defaultValue={sequence?.approval_mode ?? "approve_first"}
            className={cn(input, "mt-1")}
          >
            <option value="approve_first">Wait for my approval</option>
            <option value="auto">Send on their own</option>
          </select>
        </label>
        <StepsEditor
          initial={sequence?.steps ?? [{ wait_days: 3, angle: "" }]}
          disabled={!admin}
        />
        <label className="flex items-start gap-2.5 text-[13px] leading-[1.45]">
          <input
            type="checkbox"
            name="is_default"
            defaultChecked={sequence?.is_default ?? false}
            className="mt-0.5 size-4 accent-[#0B0B0C]"
          />
          <span>
            Use for every first email that names no other sequence
            <span className="mt-0.5 block text-[12px] text-[#0B0B0C]/55">
              Plays written to customers or as a single email (expansion,
              events) stay single unless you choose a sequence when you start
              them.
            </span>
          </span>
        </label>
      </fieldset>
      {admin ? (
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton>{sequence ? "Save" : "Add sequence"}</SubmitButton>
        </div>
      ) : (
        <p className={hint}>
          Only the workspace&apos;s owner or an admin can change this.
        </p>
      )}
    </ActionForm>
  );
}

function SequenceSummary({ sequence }: { sequence: Sequence }) {
  const days = stepDays(sequence.steps);
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-medium">{sequence.name}</span>
      {sequence.is_default && <Badge tone="ink">Default</Badge>}
      <span className="text-[12px] text-[#0B0B0C]/55">
        {days.length === 0
          ? "First email only"
          : `First email, then follow-ups on day ${days.join(", ")}`}
        {" · "}
        {sequence.language === "auto"
          ? "Auto language"
          : languageLabel(sequence.language)}
        {" · "}
        {APPROVAL_LABEL[sequence.approval_mode]}
      </span>
    </span>
  );
}

type Row = {
  thread_id: string | null;
  draft: { play: string | null } | null;
  prospect: { search_id: string | null } | null;
  thread: {
    status: string;
    followups_sent: number;
    next_followup_at: string | null;
    stop_reason: string | null;
    sequence_id: string | null;
  } | null;
};

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Sequences"
      note="A sequence is a first email and up to five follow-ups in the same thread, from the same mailbox, each with its own wait and its own instructions. A reply, an unsubscribe or a bounce stops it."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={ListOrdered} title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const mail = mailReads(supabase, workspace.id);
  const [settings, extra, agent, emails, searches, sequences] =
    await Promise.all([
      mail.settings(),
      supabase
        .from("workspace_sending")
        .select("followup_count")
        .eq("workspace_id", workspace.id)
        .maybeSingle(),
      supabase
        .from("agents")
        .select("approval_mode")
        .eq("workspace_id", workspace.id)
        .eq("role", "outbound")
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("outbound_emails")
        .select("thread_id, draft_id, prospect_id")
        .eq("workspace_id", workspace.id)
        .eq("kind", "first")
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(2000),
      supabase
        .from("prospect_searches")
        .select("id, name, kind, sequence_id, created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(200),
      listSequences(supabase, workspace.id),
    ]);
  if (emails.error) throw new Error(emails.error.message);
  // The email's draft, prospect and thread, read separately (outbound_emails
  // has no foreign key to drafts to join on), as the signed-in person.
  const first = (emails.data ?? []) as {
    thread_id: string | null;
    draft_id: string | null;
    prospect_id: string | null;
  }[];
  const ids = (key: "thread_id" | "draft_id" | "prospect_id") => [
    ...new Set(first.map((e) => e[key]).filter((v): v is string => !!v)),
  ];
  const [drafts, prospects, threads] = await Promise.all([
    supabase
      .from("outbound_drafts")
      .select("id, play")
      .eq("workspace_id", workspace.id)
      .in("id", ids("draft_id").slice(0, 2000)),
    supabase
      .from("prospects")
      .select("id, search_id")
      .eq("workspace_id", workspace.id)
      .in("id", ids("prospect_id").slice(0, 2000)),
    supabase
      .from("mail_threads")
      .select(
        "id, status, followups_sent, next_followup_at, stop_reason, sequence_id",
      )
      .eq("workspace_id", workspace.id)
      .in("id", ids("thread_id").slice(0, 2000)),
  ]);
  for (const r of [drafts, prospects, threads])
    if (r.error) throw new Error(r.error.message);
  const draftPlay = new Map(
    ((drafts.data ?? []) as { id: string; play: string | null }[]).map((d) => [
      d.id,
      d.play,
    ]),
  );
  const prospectSearch = new Map(
    ((prospects.data ?? []) as { id: string; search_id: string | null }[]).map(
      (p) => [p.id, p.search_id],
    ),
  );
  const threadById = new Map(
    (
      (threads.data ?? []) as (NonNullable<Row["thread"]> & { id: string })[]
    ).map((t) => [t.id, t]),
  );
  const rowsOf: Row[] = first.map((e) => ({
    thread_id: e.thread_id,
    draft: e.draft_id ? { play: draftPlay.get(e.draft_id) ?? null } : null,
    prospect: e.prospect_id
      ? { search_id: prospectSearch.get(e.prospect_id) ?? null }
      : null,
    thread: e.thread_id ? (threadById.get(e.thread_id) ?? null) : null,
  }));
  const count = settings.followups_enabled
    ? ((extra.data?.followup_count as number | undefined) ?? 2)
    : 0;
  const approval =
    (agent.data?.approval_mode as string | undefined) ?? "approve_first";
  const searchRows = (searches.data ?? []) as {
    id: string;
    name: string;
    kind: string;
    sequence_id: string | null;
  }[];
  const names = new Map(searchRows.map((s) => [s.id, s.name]));
  const sequenceName = new Map(sequences.map((q) => [q.id, q.name]));
  const fallback = sequences.find((q) => q.is_default) ?? null;

  // One group per play or search.
  const groups = new Map<
    string,
    {
      label: string;
      single: boolean;
      sequences: Set<string>;
      total: number;
      running: number;
      replied: number;
      finished: number;
      stopped: number;
      next: string | null;
    }
  >();
  for (const r of rowsOf) {
    const play = r.draft?.play ?? null;
    const search = r.prospect?.search_id ?? null;
    const key =
      play && PLAY_LABEL[play]
        ? `play:${play}`
        : search
          ? `search:${search}`
          : "other";
    const label =
      play && PLAY_LABEL[play]
        ? PLAY_LABEL[play]
        : search
          ? `Find leads: ${names.get(search) ?? "a search"}`
          : "Other first emails";
    const g = groups.get(key) ?? {
      label,
      single: true,
      sequences: new Set<string>(),
      total: 0,
      running: 0,
      replied: 0,
      finished: 0,
      stopped: 0,
      next: null as string | null,
    };
    g.total += 1;
    if (r.thread?.stop_reason !== "single_touch_play") g.single = false;
    if (r.thread?.sequence_id) {
      const n = sequenceName.get(r.thread.sequence_id);
      if (n) g.sequences.add(n);
    }
    const s = r.thread?.status;
    if (s === "active") {
      g.running += 1;
      const at = r.thread?.next_followup_at;
      if (at && (!g.next || at < g.next)) g.next = at;
    } else if (s === "replied") g.replied += 1;
    else if (s === "finished") g.finished += 1;
    else g.stopped += 1;
    groups.set(key, g);
  }
  const list = [...groups.entries()].sort(
    (a, b) => b[1].running - a[1].running,
  );

  const steps = [
    "First email, once you approve it",
    ...(count >= 1
      ? [`Follow-up 1, ${settings.followup_1_days} days after the first email`]
      : []),
    ...(count >= 2
      ? [`Follow-up 2, ${settings.followup_2_days} days after the first email`]
      : []),
  ];

  return (
    <>
      {head}
      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-3">
          <section className={panel} aria-labelledby="your-sequences">
            <h2 id="your-sequences" className={panelHead}>
              Your sequences
              <span className="text-[12px] font-normal text-[#0B0B0C]/50">
                {sequences.length} of 25
              </span>
            </h2>
            {sequences.length === 0 && (
              <p className="border-b border-black/[0.06] px-4 py-3 text-[13px] text-[#0B0B0C]/70">
                None yet. Until you add one, every first email gets the standard
                follow-ups on the right.
              </p>
            )}
            <ul className="divide-y divide-black/[0.06]">
              {sequences.map((q) => (
                <li key={q.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-[13px] hover:bg-black/[0.02]">
                      <SequenceSummary sequence={q} />
                      <span className="text-[12px] text-[#0B0B0C]/50 group-open:hidden">
                        Edit
                      </span>
                    </summary>
                    <SequenceForm sequence={q} admin={admin} />
                    {admin && (
                      <ActionForm
                        action={archiveSequence}
                        confirm="Archive this sequence? Threads already on it finish their steps."
                        className="px-4 pb-4"
                      >
                        <input type="hidden" name="id" value={q.id} />
                        <SubmitButton
                          variant="ghost"
                          small
                          pendingText="Archiving…"
                        >
                          Archive
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </details>
                </li>
              ))}
              {admin && (
                <li>
                  <details open={sequences.length === 0}>
                    <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-medium hover:bg-black/[0.02]">
                      New sequence
                    </summary>
                    <SequenceForm sequence={null} admin={admin} />
                  </details>
                </li>
              )}
            </ul>
          </section>

          <section className={panel}>
            <h2 className={panelHead}>
              Running sequences
              <Badge tone={settings.sending_on ? "ink" : "outline"}>
                {settings.sending_on ? "Sending on" : "Sending paused"}
              </Badge>
            </h2>
            {list.length === 0 ? (
              <Empty icon={ListOrdered} title="No sequence has started yet">
                A sequence starts when an approved first email is sent. Start
                one from{" "}
                <Link
                  href="/app/plays"
                  className="underline underline-offset-2"
                >
                  Plays
                </Link>{" "}
                or Find leads.
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead className="text-[11.5px] text-[#0B0B0C]/50">
                    <tr className="border-b border-black/[0.06]">
                      <th className="px-4 py-2 font-medium">From</th>
                      <th className="px-2 py-2 text-right font-medium">
                        Started
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Running
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Replied
                      </th>
                      <th className="px-2 py-2 text-right font-medium">
                        Finished
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Stopped
                      </th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {list.map(([key, g]) => (
                      <tr
                        key={key}
                        className="border-b border-black/[0.04] last:border-0"
                      >
                        <td className="px-4 py-2.5">
                          <span className="font-medium">{g.label}</span>
                          <span className="block text-[11.5px] text-[#0B0B0C]/50">
                            {g.single
                              ? "One email, no follow-ups"
                              : g.next
                                ? `Next follow-up ${new Date(g.next).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                                : "No follow-up due"}
                            {g.sequences.size > 0 &&
                              ` · ${[...g.sequences].join(", ")}`}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right">{g.total}</td>
                        <td className="px-2 py-2.5 text-right">{g.running}</td>
                        <td className="px-2 py-2.5 text-right">{g.replied}</td>
                        <td className="px-2 py-2.5 text-right">{g.finished}</td>
                        <td className="px-4 py-2.5 text-right">{g.stopped}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] px-4 py-2.5">
              <p className={hint}>
                Pausing stops every email and follow-up from going out until you
                resume. To end one person&apos;s sequence, stop it from their
                thread in the Inbox.
              </p>
              {admin && (
                <ActionForm action={setSending}>
                  <input
                    type="hidden"
                    name="sending_on"
                    value={settings.sending_on ? "false" : "true"}
                  />
                  <SubmitButton
                    variant="secondary"
                    small
                    pendingText={settings.sending_on ? "Pausing…" : "Resuming…"}
                  >
                    {settings.sending_on
                      ? "Pause all sending"
                      : "Resume sending"}
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Find leads searches</h2>
            {searchRows.filter((r) => r.kind === "search").length === 0 ? (
              <p className="p-4 text-[13px] text-[#0B0B0C]/60">
                No search yet. Each search you make in Find leads can start a
                sequence of its own.
              </p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {searchRows
                  .filter((r) => r.kind === "search")
                  .slice(0, 30)
                  .map((r) => (
                    <li key={r.id} className="px-4 py-2.5">
                      <ActionForm
                        action={setSearchSequence}
                        className="flex flex-wrap items-center gap-2 text-[13px]"
                      >
                        <input type="hidden" name="search" value={r.id} />
                        <span className="min-w-0 flex-1 font-medium">
                          {r.name}
                        </span>
                        <select
                          name="sequence"
                          defaultValue={r.sequence_id ?? ""}
                          aria-label={`Sequence for ${r.name}`}
                          className={cn(input, "h-8 w-auto py-1 text-[13px]")}
                        >
                          <option value="">
                            {fallback
                              ? `Default (${fallback.name})`
                              : "Standard follow-ups"}
                          </option>
                          {sequences.map((q) => (
                            <option key={q.id} value={q.id}>
                              {q.name}
                            </option>
                          ))}
                        </select>
                        <SubmitButton variant="secondary" small>
                          Save
                        </SubmitButton>
                      </ActionForm>
                    </li>
                  ))}
              </ul>
            )}
            <p className="border-t border-black/[0.06] px-4 py-2.5 text-[12px] text-[#0B0B0C]/55">
              Plays and playbooks choose their sequence when you start them.
            </p>
          </section>
        </div>

        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>When no sequence is chosen</h2>
            {fallback ? (
              <p className="p-4 text-[13px] leading-[1.5] text-[#0B0B0C]/75">
                First emails that name no sequence start your default,{" "}
                <span className="font-medium">{fallback.name}</span>. Change it,
                or untick &ldquo;Use for every first email&rdquo;, in Your
                sequences.
              </p>
            ) : (
              <>
                <ol className="space-y-2 p-4 text-[13px]">
                  {steps.map((s, i) => (
                    <li key={s} className="flex gap-2.5">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#0B0B0C] text-[11px] text-white tabular-nums">
                        {i + 1}
                      </span>
                      {s}
                    </li>
                  ))}
                </ol>
                <ActionForm
                  action={saveSequence}
                  className="space-y-3 border-t border-black/[0.06] p-4"
                >
                  <fieldset disabled={!admin} className="space-y-3">
                    <label className={labelCls}>
                      Follow-ups when nobody answers
                      <select
                        name="count"
                        defaultValue={String(count)}
                        className={cn(input, "mt-1")}
                      >
                        <option value="0">None</option>
                        <option value="1">One</option>
                        <option value="2">Two</option>
                      </select>
                    </label>
                    <label className={labelCls}>
                      First follow-up, days after the first email
                      <input
                        name="first_days"
                        type="number"
                        min={1}
                        max={30}
                        required
                        defaultValue={settings.followup_1_days}
                        className={cn(input, "mt-1")}
                      />
                    </label>
                    <label className={labelCls}>
                      Second follow-up, days after the first email
                      <input
                        name="second_days"
                        type="number"
                        min={2}
                        max={60}
                        required
                        defaultValue={settings.followup_2_days}
                        className={cn(input, "mt-1")}
                      />
                    </label>
                    <label className={labelCls}>
                      Follow-ups
                      <select
                        name="approval"
                        defaultValue={approval}
                        className={cn(input, "mt-1")}
                      >
                        <option value="approve_first">
                          Wait for my approval
                        </option>
                        <option value="auto">Send on their own</option>
                      </select>
                    </label>
                  </fieldset>
                  {admin ? (
                    <SubmitButton>Save</SubmitButton>
                  ) : (
                    <p className={hint}>
                      Only the workspace&apos;s owner or an admin can change
                      this.
                    </p>
                  )}
                  <p className={hint}>
                    The standard follow-ups, for first emails with no sequence.
                    For more steps, your own instructions per step or a fixed
                    language, add a sequence and make it the default.
                  </p>
                </ActionForm>
              </>
            )}
          </section>
          <section className={panel}>
            <h2 className={panelHead}>The rules every step keeps</h2>
            <ul className="space-y-1.5 p-4 text-[12.5px] leading-[1.5] text-[#0B0B0C]/70">
              <li>
                Every follow-up goes in the same thread, from the same mailbox.
              </li>
              <li>
                A reply, an unsubscribe or a bounce ends the sequence for that
                person.
              </li>
              <li>
                Nobody on your never-contact list or marked do not contact is
                written to.
              </li>
              <li>
                Every email carries your unsubscribe link and sender details.
              </li>
              <li>
                Sending hours, daily limits and the ramp-up for new mailboxes
                apply to every step.
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function SequencesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
