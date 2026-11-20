import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Inbox as InboxIcon, MessageCircle } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import type { InboxQueue } from "@/lib/app/repo";
import { ago, dateTime } from "@/lib/app/time";
import {
  CHANNEL_LABEL,
  type ConversationThread,
  type Member,
} from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import {
  Badge,
  ChannelTile,
  Empty,
  input,
  leadLabel,
  PageHead,
  PageSkeleton,
  panel,
} from "../_ui/kit";
import { assign, reply, setConversationStatus } from "./actions";

export const metadata: Metadata = { title: "Inbox" };

const QUEUES: { id: InboxQueue; label: string }[] = [
  { id: "waiting", label: "Waiting for you" },
  { id: "mine", label: "Assigned to me" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

const STATUS_WORDS = {
  open: "Open",
  waiting_for_you: "Waiting for you",
  closed: "Closed",
} as const;

function Thread({
  thread,
  members,
  timezone,
  back,
}: {
  thread: ConversationThread;
  members: Member[];
  timezone: string;
  back: string;
}) {
  const names = new Map(members.map((m) => [m.user_id, m.name || m.email]));
  const channel = CHANNEL_LABEL[thread.channel];
  return (
    <section className={cn(panel, "min-h-[480px] lg:h-[calc(100dvh-170px)]")}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-black/[0.06] px-4 py-2.5">
        <Link
          href={back}
          aria-label="Back to the list"
          className="grid size-8 place-items-center rounded-full hover:bg-black/[0.06] lg:hidden"
        >
          <ArrowLeft aria-hidden className="size-4" />
        </Link>
        <ChannelTile channel={thread.channel} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] font-medium">
            <Link
              href={`/app/leads/${thread.lead.id}`}
              className="hover:underline"
            >
              {leadLabel(thread.lead)}
            </Link>
          </h2>
          <p className="truncate text-[11.5px] text-[#0B0B0C]/50">
            {channel}
            {thread.lead.company && thread.lead.name
              ? ` · ${thread.lead.company}`
              : ""}
          </p>
        </div>
        <Badge tone={thread.status === "waiting_for_you" ? "blue" : "plain"}>
          {STATUS_WORDS[thread.status]}
        </Badge>
        <ActionForm action={assign} quiet className="flex items-center gap-1.5">
          <input type="hidden" name="conversation" value={thread.id} />
          <label>
            <span className="sr-only">Assigned to</span>
            <select
              // Remount when the server's value changes, so it shows.
              key={thread.assigned_to ?? "none"}
              name="assignee"
              defaultValue={thread.assigned_to ?? ""}
              className={cn(input, "h-8 w-[150px] py-0 text-[12.5px]")}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton variant="secondary" small>
            Assign
          </SubmitButton>
        </ActionForm>
        <ActionForm action={setConversationStatus} quiet>
          <input type="hidden" name="conversation" value={thread.id} />
          <input
            type="hidden"
            name="status"
            value={thread.status === "closed" ? "open" : "closed"}
          />
          <SubmitButton variant="secondary" small>
            {thread.status === "closed" ? "Reopen" : "Close"}
          </SubmitButton>
        </ActionForm>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
        {thread.messages.length === 0 && (
          <p className="m-auto max-w-[320px] text-center text-[13px] leading-[1.5] text-[#0B0B0C]/50">
            No messages yet. This lead came in without one, for example from a
            form with no message field.
          </p>
        )}
        {thread.messages.map((m) => {
          const out = m.direction === "out";
          const who =
            m.author === "lead"
              ? leadLabel(thread.lead)
              : m.author === "agent"
                ? "Dialvo agent"
                : (names.get(m.author_user_id ?? "") ?? "A teammate");
          return (
            <div
              key={m.id}
              className={cn("flex max-w-[82%] flex-col", out && "self-end")}
            >
              <p
                className={cn(
                  "w-fit rounded-2xl px-3.5 py-2 text-[13.5px] leading-[1.45] whitespace-pre-wrap",
                  out
                    ? "self-end rounded-br-md bg-[#0B0B0C] text-white"
                    : "rounded-bl-md bg-black/[0.055]",
                )}
              >
                {m.body}
              </p>
              <p
                className={cn(
                  "mt-1 text-[11px] text-[#0B0B0C]/45",
                  out && "text-right",
                )}
              >
                {who} · {dateTime(m.sent_at, timezone)}
                {out && m.delivery_status === "not_delivered" && (
                  <span className="text-[#0B0B0C]/70">
                    {" "}
                    · Saved, not delivered
                  </span>
                )}
                {out && m.delivery_status === "failed" && " · Failed to send"}
              </p>
            </div>
          );
        })}
      </div>

      <ActionForm
        action={reply}
        resetOnSuccess
        quiet
        className="border-t border-black/[0.06] p-3"
      >
        <input type="hidden" name="conversation" value={thread.id} />
        <label className="sr-only" htmlFor="reply-body">
          Your reply
        </label>
        <textarea
          id="reply-body"
          name="body"
          rows={2}
          required
          maxLength={10000}
          placeholder={`Write a reply to ${leadLabel(thread.lead)}`}
          className={input}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-[440px] text-[11.5px] leading-[1.45] text-[#0B0B0C]/55">
            Saved, not delivered: {channel} isn&apos;t connected yet, so your
            reply is stored on this thread but not sent to the lead.
          </p>
          <SubmitButton small>Save reply</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

async function InboxContent({
  searchParams,
}: {
  searchParams: PageProps<"/app/inbox">["searchParams"];
}) {
  const params = await searchParams;
  const queue =
    QUEUES.find((q) => q.id === params.queue)?.id ?? ("waiting" as const);
  const selected = typeof params.c === "string" ? params.c : "";
  const { repo, workspace } = await getAppContext();
  const [list, thread, members] = await Promise.all([
    repo.conversations(queue),
    selected ? repo.conversation(selected) : null,
    repo.members(),
  ]);
  const link = (c?: string) => `/app/inbox?queue=${queue}${c ? `&c=${c}` : ""}`;

  return (
    <>
      <PageHead
        title="Inbox"
        note="Every conversation on every channel. Your agents' handoffs and new enquiries wait for you here."
      />
      <nav
        aria-label="Queues"
        className="mb-3 flex [scrollbar-width:none] gap-1 overflow-x-auto"
      >
        {QUEUES.map((q) => (
          <Link
            key={q.id}
            href={`/app/inbox?queue=${q.id}`}
            aria-current={q.id === queue ? "page" : undefined}
            className={cn(
              "flex h-8 shrink-0 items-center rounded-full px-3 text-[12.5px] font-medium",
              q.id === queue
                ? "bg-[#0B0B0C] text-white"
                : "text-[#0B0B0C]/60 hover:bg-black/[0.05]",
            )}
          >
            {q.label}
          </Link>
        ))}
      </nav>

      <div className="grid items-start gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section
          aria-label="Conversations"
          className={cn(
            panel,
            "overflow-hidden lg:max-h-[calc(100dvh-170px)]",
            thread && "hidden lg:flex",
          )}
        >
          {list.length === 0 ? (
            <Empty
              icon={InboxIcon}
              title={
                queue === "waiting"
                  ? "Nothing is waiting for you"
                  : "No conversations here"
              }
            >
              {queue === "waiting"
                ? "New form enquiries and handoffs from your agents will queue up here."
                : "Conversations start when a lead fills in your form or, in later releases, when a channel is connected."}
            </Empty>
          ) : (
            <ul className="overflow-y-auto p-1.5">
              {list.map((c) => (
                <li key={c.id}>
                  <Link
                    href={link(c.id)}
                    aria-current={c.id === thread?.id ? "true" : undefined}
                    className={cn(
                      "flex items-start gap-3 rounded-xl px-2.5 py-2.5",
                      c.id === thread?.id
                        ? "bg-black/[0.055]"
                        : "hover:bg-black/[0.03]",
                    )}
                  >
                    <ChannelTile channel={c.channel} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium">
                          {leadLabel(c.lead)}
                        </span>
                        {c.status === "waiting_for_you" && (
                          <span
                            aria-label="Waiting for you"
                            className="size-1.5 shrink-0 rounded-full bg-[#1F3BFF]"
                          />
                        )}
                      </span>
                      <span className="block truncate text-[12px] text-[#0B0B0C]/50">
                        {c.preview ?? `New ${CHANNEL_LABEL[c.channel]} enquiry`}
                      </span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-[11px] text-[#0B0B0C]/40 tabular-nums">
                      {ago(c.last_message_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {thread ? (
          <Thread
            thread={thread}
            members={members}
            timezone={workspace.timezone}
            back={link()}
          />
        ) : (
          <section className={cn(panel, "hidden min-h-[360px] lg:flex")}>
            <Empty
              icon={MessageCircle}
              title={
                selected
                  ? "That conversation doesn't exist"
                  : "Choose a conversation"
              }
            >
              {selected
                ? "It may have been deleted, or it belongs to another workspace."
                : "Pick one from the list to read the thread and reply."}
            </Empty>
          </section>
        )}
      </div>
    </>
  );
}

export default function InboxPage({ searchParams }: PageProps<"/app/inbox">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InboxContent searchParams={searchParams} />
    </Suspense>
  );
}
