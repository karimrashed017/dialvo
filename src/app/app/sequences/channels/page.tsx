import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ExternalLink, ListChecks } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { dateTime } from "@/lib/app/time";
import {
  LINKEDIN_DAILY_TASKS,
  LINKEDIN_NOTE_CHARS,
  MAX_STEPS,
  SMS_MAX_CHARS,
  STEP_CHANNEL_LABEL,
  type StepChannel,
} from "@/lib/channels/config";
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
import { finishTask, removeStep, saveStep } from "./actions";

export const metadata: Metadata = { title: "Sequence channels" };

// Steps on other channels, added to every email sequence: a text, a
// LinkedIn message a person sends, or a call a person makes. Tasks that are
// due today wait here. A reply on any channel stops the rest.

type Step = {
  id: string;
  applies_to: "sequences" | "nurture";
  channel: StepChannel;
  day_offset: number;
  message: string;
  note: string;
};
type Run = {
  id: string;
  channel: StepChannel;
  status: string;
  due_at: string;
  body: string | null;
  profile_url: string | null;
  skip_reason: string | null;
  outcome: string | null;
  lead: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
  } | null;
};

const RUN_STATUS: Record<string, string> = {
  scheduled: "Scheduled",
  due: "Due",
  sending: "Sending",
  done: "Done",
  skipped: "Skipped",
  stopped: "Stopped",
  failed: "Failed",
};

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Sequences"
      note="Steps on other channels, added to every email sequence. A reply on any channel, an unsubscribe or a bounce stops the rest, emails included."
    >
      <Link href="/app/sequences" className={cn(btn.secondary, btn.small)}>
        Email steps
      </Link>
    </PageHead>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={ListChecks} title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const [steps, tasks, recent] = await Promise.all([
    supabase
      .from("sequence_channel_steps")
      .select("id, applies_to, channel, day_offset, message, note")
      .eq("workspace_id", workspace.id)
      .eq("active", true)
      .order("day_offset"),
    supabase
      .from("sequence_channel_runs")
      .select(
        "id, channel, status, due_at, body, profile_url, skip_reason, outcome, lead:leads(id, name, company, phone)",
      )
      .eq("workspace_id", workspace.id)
      .eq("status", "due")
      .order("due_at")
      .limit(100),
    supabase
      .from("sequence_channel_runs")
      .select(
        "id, channel, status, due_at, body, profile_url, skip_reason, outcome, lead:leads(id, name, company, phone)",
      )
      .eq("workspace_id", workspace.id)
      .neq("status", "due")
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);
  const list = (steps.data ?? []) as Step[];
  const due = (tasks.data ?? []) as unknown as Run[];
  const log = (recent.data ?? []) as unknown as Run[];
  const tz = workspace.timezone;

  return (
    <>
      {head}
      <section className={panel}>
        <h2 className={panelHead}>
          Tasks due
          <span className="text-[12px] font-normal text-[#0B0B0C]/50">
            {due.length}
          </span>
        </h2>
        {due.length === 0 ? (
          <Empty icon={ListChecks} title="Nothing to do right now">
            LinkedIn and call steps show here on the day they are due.
          </Empty>
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {due.map((r) => (
              <li key={r.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>
                    {r.channel === "linkedin" ? "LinkedIn" : "Call"}
                  </Badge>
                  {r.lead && (
                    <Link
                      href={`/app/leads/${r.lead.id}`}
                      className="text-[13.5px] font-medium hover:underline"
                    >
                      {r.lead.name || r.lead.phone}
                      {r.lead.company ? ` · ${r.lead.company}` : ""}
                    </Link>
                  )}
                  <span className="text-[12px] text-[#0B0B0C]/50">
                    Due {dateTime(r.due_at, tz)}
                  </span>
                </div>
                {r.body && (
                  <p className="rounded-xl bg-black/[0.035] px-3 py-2 text-[13px] leading-[1.5] whitespace-pre-wrap">
                    {r.body}
                  </p>
                )}
                {r.channel === "linkedin" &&
                  r.body &&
                  r.body.length > LINKEDIN_NOTE_CHARS && (
                    <p className={hint}>
                      Longer than a connection request&apos;s{" "}
                      {LINKEDIN_NOTE_CHARS}-character note: send it as a message
                      once you&apos;re connected.
                    </p>
                  )}
                <div className="flex flex-wrap items-center gap-2">
                  {r.channel === "linkedin" && r.profile_url && (
                    <a
                      href={r.profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(btn.secondary, btn.small)}
                    >
                      Open on LinkedIn
                      <ExternalLink aria-hidden className="size-3.5" />
                    </a>
                  )}
                  {r.channel === "call_task" && r.lead?.phone && (
                    <a
                      href={`tel:${r.lead.phone}`}
                      className={cn(btn.secondary, btn.small)}
                    >
                      Call {r.lead.phone}
                    </a>
                  )}
                  <ActionForm
                    action={finishTask}
                    quiet
                    className="flex flex-wrap gap-2"
                  >
                    <input type="hidden" name="run" value={r.id} />
                    <SubmitButton small name="outcome" value="done">
                      {r.channel === "linkedin" ? "I sent it" : "I called"}
                    </SubmitButton>
                    <SubmitButton
                      small
                      variant="secondary"
                      name="outcome"
                      value="replied"
                    >
                      They replied
                    </SubmitButton>
                    <SubmitButton
                      small
                      variant="ghost"
                      name="outcome"
                      value="skipped"
                    >
                      Skip
                    </SubmitButton>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(panel, "mt-3")}>
        <h2 className={panelHead}>
          Steps
          <span className="text-[12px] font-normal text-[#0B0B0C]/50">
            {list.length} of {MAX_STEPS}
          </span>
        </h2>
        <div className="space-y-3 p-4">
          {list.length === 0 ? (
            <p className={hint}>No steps yet: sequences are email only.</p>
          ) : (
            <ul className="divide-y divide-black/[0.06] rounded-xl border border-black/[0.07]">
              {list.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-start gap-3 px-3 py-2.5"
                >
                  <span className="w-16 shrink-0 text-[12.5px] text-[#0B0B0C]/55">
                    Day {s.day_offset}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">
                      {STEP_CHANNEL_LABEL[s.channel]}
                      <span className="font-normal text-[#0B0B0C]/50">
                        {" "}
                        ·{" "}
                        {s.applies_to === "nurture"
                          ? "lead nurture"
                          : "every sequence"}
                      </span>
                    </span>
                    <span className="block text-[12.5px] whitespace-pre-wrap text-[#0B0B0C]/65">
                      {s.message || s.note}
                    </span>
                  </span>
                  {admin && (
                    <ActionForm
                      action={removeStep}
                      quiet
                      confirm="Remove this step? It stops wherever it hasn't run yet."
                    >
                      <input type="hidden" name="step" value={s.id} />
                      <SubmitButton variant="ghost" small>
                        Remove
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
          {admin && list.length < MAX_STEPS && (
            <ActionForm
              action={saveStep}
              resetOnSuccess
              className="space-y-3 rounded-xl border border-black/[0.07] p-3"
            >
              <p className="text-[13px] font-medium">Add a step</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label>
                  <span className={labelCls}>Channel</span>
                  <select name="channel" className={cn(input, "mt-1")}>
                    {(Object.keys(STEP_CHANNEL_LABEL) as StepChannel[]).map(
                      (c) => (
                        <option key={c} value={c}>
                          {STEP_CHANNEL_LABEL[c]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  <span className={labelCls}>Days after the first email</span>
                  <input
                    type="number"
                    name="day_offset"
                    min={0}
                    max={60}
                    defaultValue={2}
                    className={cn(input, "mt-1")}
                  />
                </label>
                <label>
                  <span className={labelCls}>In</span>
                  <select name="applies_to" className={cn(input, "mt-1")}>
                    <option value="sequences">
                      Every sequence with follow-ups
                    </option>
                    <option value="nurture">Lead nurture</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className={labelCls}>Message (text or LinkedIn)</span>
                <textarea
                  name="message"
                  rows={3}
                  maxLength={1000}
                  placeholder="Hi {first_name}, I emailed about ... at {company}. Worth a quick chat?"
                  className={cn(input, "mt-1")}
                />
                <span className={hint}>
                  {"{first_name}"} and {"{company}"} are filled in per lead.
                  Texts: up to {SMS_MAX_CHARS} characters, no links; the first
                  text to someone starts with your business name and ends with
                  &ldquo;Reply STOP to opt out.&rdquo;
                </span>
              </label>
              <label className="block">
                <span className={labelCls}>Talking points (call task)</span>
                <input
                  name="note"
                  maxLength={500}
                  placeholder="Ask whether the proposal landed and offer a call"
                  className={cn(input, "mt-1")}
                />
              </label>
              <SubmitButton variant="secondary">Add step</SubmitButton>
            </ActionForm>
          )}
          <div className="rounded-xl bg-black/[0.035] p-3 text-[12.5px] leading-[1.5] text-[#0B0B0C]/70">
            <p className="font-medium text-[#0B0B0C]">How each channel runs</p>
            <p className="mt-1">
              <strong>Texts</strong> go out from your number on Twilio, only to
              leads with recorded consent to be texted, inside your call window
              and daily cap (
              <Link href="/app/calls/settings#sms" className="underline">
                Calls, Settings
              </Link>
              ).
            </p>
            <p className="mt-1">
              <strong>LinkedIn</strong> steps are sent by you, from your own
              profile: LinkedIn&apos;s User Agreement doesn&apos;t allow
              software to send messages or connection requests for you, so
              Dialvo never does. It drafts the message, links to the
              person&apos;s profile (or a search for their name), and hands out
              at most {LINKEDIN_DAILY_TASKS} a day; LinkedIn also limits how
              many invitations an account sends each week.
            </p>
            <p className="mt-1">
              <strong>Call tasks</strong> are calls you make yourself, with the
              talking points. For AI calls to people who agreed to be called,
              use{" "}
              <Link href="/app/calls/outbound" className="underline">
                Calls, Outbound
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <section className={cn(panel, "mt-3")}>
        <h2 className={panelHead}>Recent steps</h2>
        {log.length === 0 ? (
          <Empty title="None yet" />
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {log.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12.5px]"
              >
                <Badge tone="outline">
                  {r.channel === "linkedin"
                    ? "LinkedIn"
                    : r.channel === "sms"
                      ? "Text"
                      : "Call"}
                </Badge>
                <span className="min-w-0 flex-1 truncate">
                  {r.lead?.name || r.lead?.phone || "Lead"}
                </span>
                <span className="text-[#0B0B0C]/55">
                  {RUN_STATUS[r.status] ?? r.status}
                  {r.skip_reason
                    ? `: ${r.skip_reason}`
                    : r.outcome === "replied"
                      ? ": they replied"
                      : ""}
                  {" · "}
                  {dateTime(r.due_at, tz)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function SequenceChannelsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
