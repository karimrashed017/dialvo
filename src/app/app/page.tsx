import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRight,
  BellOff,
  CalendarCheck,
  Check,
  FileUp,
  Hand,
  MessageCircle,
  MessageSquareDashed,
  NotebookPen,
  PenLine,
  Telescope,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { agentRuntimeStatus } from "@/lib/agents/config";
import { CHECKLIST_STEPS, checklistState } from "@/lib/app/checklist";
import { getAppContext } from "@/lib/app/context";
import {
  chatJob,
  findJob,
  greeting,
  needsRows,
  weekFacts,
  type HomeAction,
} from "@/lib/app/home";
import { ago } from "@/lib/app/time";
import { CHANNEL_LABEL, type FeedEvent } from "@/lib/app/types";
import { requestOrigin } from "@/lib/auth/origin";
import { prospectRuntimeStatus } from "@/lib/prospects/config";
import { cn } from "@/lib/utils";
import { ChatSteps } from "./_ui/checklist";
import { ActionForm, SubmitButton } from "./_ui/form";
import { btn, ChannelTile, leadLabel, panel } from "./_ui/kit";
import { LiveRefresh } from "./_ui/live";
import { dismissChecklist } from "./setup-actions";

export const metadata: Metadata = { title: "Home" };

const EVENT_ICON: Record<string, LucideIcon> = {
  chat_started: MessageCircle,
  chat_reply: MessageCircle,
  draft_waiting: MessageSquareDashed,
  draft_approved: Check,
  handoff_requested: Hand,
  handed_back: Hand,
  do_not_contact: BellOff,
  note: NotebookPen,
  lead_created: UserPlus,
  lead_imported: FileUp,
  lead_status_changed: Check,
  meeting_booked: CalendarCheck,
  consent_changed: PenLine,
};

function ActionLink({
  action,
  primary,
}: {
  action: HomeAction;
  primary: boolean;
}) {
  return (
    <Link href={action.href} className={primary ? btn.primary : btn.secondary}>
      {action.label}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}

/** One of the two jobs Dialvo does: where it stands, and the next step. */
function JobCard({
  id,
  icon: Icon,
  title,
  status,
  children,
  ...rest
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  /** Its real state right now, in a sentence. */
  status: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-job={id}
      className={cn(panel, "p-5 sm:p-6")}
      {...rest}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#0B0B0C] text-white">
          <Icon aria-hidden className="size-[17px]" />
        </span>
        <h2
          id={`${id}-title`}
          className="text-[17px] font-medium tracking-[-0.01em]"
        >
          {title}
        </h2>
      </div>
      <p
        data-job-status
        className="mt-3.5 text-[14px] leading-[1.5] text-[#0B0B0C]/75"
      >
        {status}
      </p>
      {children}
    </section>
  );
}

function Feed({ events }: { events: FeedEvent[] }) {
  return (
    <section aria-labelledby="recent-title">
      <h2
        id="recent-title"
        className="px-1 text-[12px] font-medium text-[#0B0B0C]/50"
      >
        Recent activity
      </h2>
      <ul className={cn(panel, "mt-2 px-2 py-1.5")}>
        {events.map((e) => {
          const body = (
            <>
              <ChannelTile channel={e.channel} icon={EVENT_ICON[e.kind]} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] leading-[1.4] font-medium">
                  {/* A found company's research follows its first sentence;
                      the lead's own page has it in full. */}
                  {e.kind === "lead_created"
                    ? e.summary.split(". What they do:")[0]
                    : e.summary}
                </span>
                <span className="block truncate text-[11.5px] text-[#0B0B0C]/50">
                  {[
                    e.channel && CHANNEL_LABEL[e.channel],
                    e.lead && leadLabel(e.lead),
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Workspace"}
                </span>
              </span>
              <span className="shrink-0 pt-0.5 text-[11px] text-[#0B0B0C]/40 tabular-nums">
                {ago(e.created_at)}
              </span>
            </>
          );
          const row = "flex items-start gap-3 rounded-xl px-2 py-2";
          return (
            <li key={e.id}>
              {e.lead ? (
                <Link
                  href={`/app/leads/${e.lead.id}`}
                  className={cn(row, "hover:bg-black/[0.035]")}
                >
                  {body}
                </Link>
              ) : (
                <div className={row}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function Home() {
  const { workspace, repo, user } = await getAppContext();
  const [home, setup, knowledge, widgets, agents, origin] = await Promise.all([
    repo.home(),
    repo.setup(),
    repo.knowledge(),
    repo.chatWidgets(),
    repo.agents(),
    requestOrigin(),
  ]);
  const admin = workspace.role !== "member";
  const state = checklistState({
    setup,
    knowledge,
    widgets,
    agents,
    foundLeads: home.find.found > 0,
  });
  const needs = needsRows(home.needs);
  const find = findJob(home.find);
  let seenOn: string | null = null;
  try {
    if (state.widget?.last_seen_at && state.widget.last_seen_origin)
      seenOn = new URL(state.widget.last_seen_origin).host;
  } catch {
    seenOn = state.widget?.last_seen_origin ?? null;
  }
  const chat = chatJob({
    hasWidget: state.widget !== null,
    seenOn,
    agentOn: state.done.on,
    mode: state.inbound?.approval_mode ?? "approve_first",
    chatsThisWeek: home.week.chats,
    waiting: home.needs.chatDrafts + home.needs.chatsWaiting,
  });
  const week = weekFacts(home.week);
  // While the chat isn't answering yet, its card walks through the steps.
  const chatSetup = !state.dismissed && !state.chatDone;
  const findOn = prospectRuntimeStatus().on;
  const first = user.name.trim().split(/\s+/)[0];
  // One black button per screen region: the rows above take it when there
  // is something to approve.
  const calm = needs.length === 0;

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-4 sm:gap-5">
      {state.reading && <LiveRefresh every={3000} />}
      <h1 className="px-1 pt-1 text-[22px] leading-[1.25] font-medium tracking-[-0.015em] sm:text-[24px]">
        {greeting(new Date(), workspace.timezone)}
        {first && `, ${first}`}.
      </h1>

      {calm ? (
        <p
          data-needs="none"
          className="-mt-2 flex items-center gap-2 px-1 text-[14px] text-[#0B0B0C]/60 sm:-mt-3"
        >
          <Check aria-hidden className="size-4 shrink-0" />
          Nothing needs your yes right now.
        </p>
      ) : (
        <section
          aria-labelledby="needs-title"
          data-needs="some"
          className={cn(panel, "overflow-hidden border-[#0B0B0C]/25")}
        >
          <h2
            id="needs-title"
            className="px-5 pt-4 text-[13px] font-medium text-[#0B0B0C]/55 sm:px-6"
          >
            Needs your yes
          </h2>
          <ul className="px-5 pb-2 sm:px-6">
            {needs.map((row) => (
              <li
                key={row.id}
                data-need={row.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-black/[0.06] py-3 first:border-0"
              >
                <p className="min-w-0 flex-1 basis-[240px]">
                  <span className="block text-[15px] leading-[1.35] font-medium">
                    {row.text}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-[#0B0B0C]/55">
                    {row.note}
                  </span>
                </p>
                <ActionLink action={row.action} primary />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div
        id={state.hidden ? undefined : "get-started"}
        className="grid items-start gap-3 sm:gap-4 lg:grid-cols-2"
      >
        <JobCard
          id="find"
          icon={Telescope}
          title="Find new customers"
          status={find.status}
          data-step="find"
          data-done={state.done.find ? "true" : "false"}
        >
          {home.find.approved > 0 && (
            <p className="mt-1.5 text-[12.5px] leading-[1.45] text-[#0B0B0C]/55">
              Approved emails are stored as ready to send. Nothing is sent from
              Dialvo yet.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <ActionLink action={find.action} primary={calm} />
          </div>
          {!findOn && (
            <p className="mt-3 text-[12.5px] leading-[1.45] text-[#0B0B0C]/55">
              Finding leads isn&apos;t switched on yet on Dialvo&apos;s side.
              You can describe who you sell to now, and searching starts once it
              is.
            </p>
          )}
        </JobCard>

        <JobCard
          id="chat"
          icon={MessageCircle}
          title="Answer website visitors"
          status={chat.status}
        >
          {chatSetup ? (
            <div className="mt-3 border-t border-black/[0.06]">
              <ChatSteps
                state={state}
                knowledge={knowledge}
                website={workspace.website}
                origin={origin}
                runtime={agentRuntimeStatus().on}
                admin={admin}
              />
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <ActionLink action={chat.action} primary={false} />
            </div>
          )}
        </JobCard>

        {!state.hidden && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12.5px] text-[#0B0B0C]/50 lg:col-span-2">
            <span data-setup-count className="tabular-nums">
              Getting set up: {state.count} of {CHECKLIST_STEPS} steps done
            </span>
            <ActionForm action={dismissChecklist} quiet>
              <SubmitButton
                variant="ghost"
                small
                pendingText="…"
                className="-ml-2 h-7 px-2 text-[#0B0B0C]/55"
              >
                Hide the setup steps
              </SubmitButton>
            </ActionForm>
          </div>
        )}
      </div>

      {week.length > 0 && (
        <dl
          aria-label="In the last 7 days"
          data-week
          className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-1 pt-1"
        >
          <span className="w-full text-[12px] font-medium text-[#0B0B0C]/50 sm:w-auto">
            In the last 7 days
          </span>
          {week.map((fact) => (
            <div key={fact.id} className="flex items-baseline gap-1.5">
              <dd className="text-[19px] leading-none font-medium tracking-[-0.01em] tabular-nums">
                {fact.value}
              </dd>
              <dt className="text-[12.5px] text-[#0B0B0C]/60">{fact.label}</dt>
            </div>
          ))}
        </dl>
      )}

      {home.feed.length > 0 && <Feed events={home.feed} />}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div
      aria-busy
      className="mx-auto flex max-w-[1080px] animate-pulse flex-col gap-4"
    >
      <div className="h-8 w-56 rounded-lg bg-black/[0.06]" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-[190px] rounded-2xl bg-black/[0.045]" />
        <div className="h-[190px] rounded-2xl bg-black/[0.045]" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Home />
    </Suspense>
  );
}
