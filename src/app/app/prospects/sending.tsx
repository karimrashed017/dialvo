import Link from "next/link";
import { dateTime } from "@/lib/app/time";
import type { Workspace } from "@/lib/app/types";
import { mailRuntimeStatus } from "@/lib/mail/config";
import {
  mailReads,
  type EmailWithLead,
  type SendingSummary as Summary,
} from "@/lib/mail/read";
import {
  REPLY_CLASS_LABEL,
  senderDetailsReady,
  type Mailbox,
  type MailThread,
  type SendingSettings,
} from "@/lib/mail/types";
import type { Supabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import {
  Badge,
  btn,
  hint,
  input,
  labelCls,
  panel,
  panelHead,
} from "../_ui/kit";
import { decideEmail, resolveEmail } from "./sending-actions";

// The sending half of "First emails": whether anything can go out at all,
// and what has happened to each email once it was approved. All read as the
// signed-in person; nothing here is made up, and an empty list says so.

export type Sending = {
  mailboxes: Mailbox[];
  settings: SendingSettings;
  emails: EmailWithLead[];
  threads: MailThread[];
  summary: Summary;
  timeZone: string;
  /** Can this server send at all (the secret key is set)? */
  runtime: boolean;
  /** A mailbox is connected: the "nothing is sent" notice no longer applies. */
  connected: boolean;
  /** Emails are really going out: connected, details complete, switched on. */
  live: boolean;
  /** First-email drafts that already have an email in the outbox. */
  byDraft: Map<string, EmailWithLead>;
};

export async function loadSending(
  supabase: Supabase,
  workspace: Workspace,
): Promise<Sending> {
  const reads = mailReads(supabase, workspace.id);
  const [mailboxes, settings, emails, threads, summary] = await Promise.all([
    reads.mailboxes(),
    reads.settings(),
    reads.emails(),
    reads.threads(),
    reads.summary(workspace.timezone),
  ]);
  const runtime = mailRuntimeStatus().on;
  const connected = mailboxes.length > 0;
  return {
    mailboxes,
    settings,
    emails,
    threads,
    summary,
    timeZone: workspace.timezone,
    runtime,
    connected,
    live:
      runtime &&
      settings.sending_on &&
      senderDetailsReady(settings) &&
      mailboxes.some((m) => m.status === "active"),
    byDraft: new Map(
      emails.filter((e) => e.draft_id).map((e) => [e.draft_id!, e]),
    ),
  };
}

const link =
  "underline decoration-black/25 underline-offset-2 hover:decoration-black/60";
const MAILBOXES = "/app/settings/mailboxes";

/** The line at the top: the honest "nothing is sent" until it isn't true. */
export function SendingNotice({ s }: { s: Sending }) {
  const box =
    "mb-3 rounded-2xl border border-black/[0.1] bg-white px-4 py-3 text-[13px] leading-[1.5] text-[#0B0B0C]/75";
  const strong = "font-medium text-[#0B0B0C]";
  if (!s.connected)
    return (
      <div role="note" data-sending-state="no-mailbox" className={box}>
        <span className={strong}>Nothing is sent from here yet.</span> Approving
        an email stores it as ready to send. To have approved emails go out from
        your own address,{" "}
        <Link href={MAILBOXES} className={link}>
          connect a mailbox
        </Link>
        . Until one is connected no email leaves Dialvo, approved or not.
      </div>
    );
  const paused = s.mailboxes.every((m) => m.status !== "active");
  const ready = senderDetailsReady(s.settings);
  return (
    <div
      role="note"
      data-sending-state={s.live ? "live" : "not-live"}
      className={cn(box, "flex flex-wrap items-center justify-between gap-3")}
    >
      <p className="min-w-0 flex-1">
        {s.live ? (
          <>
            <span className={strong}>Sending is on.</span> Emails you approve
            are given a time inside your send window and go out from{" "}
            {s.mailboxes.length === 1
              ? s.mailboxes[0].email
              : `your ${s.mailboxes.length} mailboxes`}
            , a few minutes apart. Each one is checked against your
            never-contact list again at the moment it is sent.
          </>
        ) : !s.runtime ? (
          <>
            <span className={strong}>
              Your mailbox is connected, and nothing is sent yet.
            </span>{" "}
            Sending isn&apos;t switched on on Dialvo&apos;s side. Approved
            emails are kept as ready to send, and no email leaves until it is.
          </>
        ) : !ready ? (
          <>
            <span className={strong}>
              Your mailbox is connected, and nothing is sent yet.
            </span>{" "}
            Add your business name and postal address first: every email has to
            say who it is from.
          </>
        ) : paused ? (
          <>
            <span className={strong}>Nothing is being sent.</span> Your mailbox
            is paused because its login was refused. Reconnect it to carry on.
          </>
        ) : (
          <>
            <span className={strong}>Sending is off.</span> Approved emails are
            kept as ready to send, and none leaves until you turn sending on.
          </>
        )}
      </p>
      <Link href={MAILBOXES} className={cn(btn.secondary, btn.small)}>
        {s.live ? "Mailboxes and settings" : "Finish setting up"}
      </Link>
    </div>
  );
}

/** Today's numbers. Shown once a mailbox is connected. */
export function SendingSummary({ s }: { s: Sending }) {
  if (!s.connected) return null;
  const items: [string, number][] = [
    ["Sent today", s.summary.sent],
    ["Replies", s.summary.replies],
    ["Positive replies", s.summary.positive],
    ["Bounces", s.summary.bounces],
    ["Unsubscribes", s.summary.unsubscribes],
  ];
  return (
    <dl
      data-sending-summary
      className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-black/[0.07] bg-black/[0.07] sm:grid-cols-5"
    >
      {items.map(([label, value]) => (
        <div key={label} className="bg-white px-4 py-3">
          <dt className="text-[11.5px] text-[#0B0B0C]/55">{label}</dt>
          <dd className="mt-0.5 text-[19px] font-medium tabular-nums">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const KIND_WORDS = (e: EmailWithLead) =>
  e.kind === "first"
    ? "First email"
    : e.kind === "followup"
      ? `Follow-up ${e.step}`
      : e.written_by === "user"
        ? "A teammate's reply"
        : "The agent's reply";

function Who({ e }: { e: EmailWithLead }) {
  return (
    <>
      <span className="font-medium">
        {e.lead?.company || e.lead?.name || e.to_email.split("@")[1]}
      </span>
      <span className="text-[#0B0B0C]/55">{e.to_email}</span>
    </>
  );
}

function Row({
  e,
  children,
  state,
}: {
  e: EmailWithLead;
  children: React.ReactNode;
  state: string;
}) {
  return (
    <li
      data-email={e.to_email}
      data-email-state={state}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[12.5px]"
    >
      <Who e={e} />
      <span className="text-[#0B0B0C]/45">{KIND_WORDS(e)}</span>
      <span className="ml-auto flex flex-wrap items-center gap-2 text-[#0B0B0C]/60">
        {children}
      </span>
    </li>
  );
}

function Section({
  id,
  title,
  count,
  empty,
  children,
}: {
  id: string;
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-sending-section={id}
      className={cn(panel, "mt-3")}
    >
      <h2 id={id} className={panelHead}>
        <span>
          {title}
          <span className="ml-2 font-normal text-[#0B0B0C]/50">{count}</span>
        </span>
      </h2>
      {count === 0 ? (
        <p className="px-4 py-4 text-[13px] text-[#0B0B0C]/55">{empty}</p>
      ) : (
        <ul className="divide-y divide-black/[0.06]">{children}</ul>
      )}
    </section>
  );
}

function FollowUpCard({ e }: { e: EmailWithLead }) {
  return (
    <li data-followup={e.to_email} className="px-4 py-3.5">
      <ActionForm action={decideEmail}>
        <input type="hidden" name="email" value={e.id} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          <Badge tone="plain">Waiting for you</Badge>
          <Who e={e} />
          <span className="text-[#0B0B0C]/45">
            {KIND_WORDS(e)} · {e.subject}
          </span>
        </div>
        <label className={cn(labelCls, "mt-2.5")} htmlFor={`f-${e.id}`}>
          Email
        </label>
        <textarea
          id={`f-${e.id}`}
          name="body"
          required
          rows={Math.min(10, Math.max(4, e.body.split("\n").length + 1))}
          maxLength={5000}
          defaultValue={e.body}
          className={cn(input, "mt-1 leading-[1.5]")}
        />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <SubmitButton
            name="action"
            value="approve"
            small
            pendingText="Approving…"
          >
            Approve
          </SubmitButton>
          <SubmitButton name="action" value="save" variant="secondary" small>
            Save edits
          </SubmitButton>
          <SubmitButton
            name="action"
            value="discard"
            variant="ghost"
            small
            pendingText="Discarding…"
          >
            Discard and stop following up
          </SubmitButton>
        </div>
      </ActionForm>
    </li>
  );
}

function Resolve({ e }: { e: EmailWithLead }) {
  const button = (
    action: string,
    label: string,
    variant: "secondary" | "ghost",
  ) => (
    <ActionForm action={resolveEmail} quiet>
      <input type="hidden" name="email" value={e.id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton variant={variant} small pendingText="…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
  return (
    <>
      {e.status === "needs_check" && button("sent", "It was sent", "secondary")}
      {button("resend", "Send again", "secondary")}
      {button("cancel", "Leave unsent", "ghost")}
    </>
  );
}

/** Everything that has happened to emails after they were approved. */
export function SendingBoard({ s }: { s: Sending }) {
  if (!s.connected) return null;
  const mailbox = new Map(s.mailboxes.map((m) => [m.id, m.email]));
  const thread = new Map(s.threads.map((t) => [t.id, t]));
  const from = (e: EmailWithLead) =>
    e.mailbox_id
      ? (mailbox.get(e.mailbox_id) ?? "a disconnected mailbox")
      : null;

  const waiting = s.emails.filter(
    (e) => e.status === "draft" && e.kind === "followup",
  );
  const scheduled = s.emails
    .filter((e) => ["queued", "scheduled", "sending"].includes(e.status))
    .sort((a, b) =>
      (a.scheduled_at ?? "9").localeCompare(b.scheduled_at ?? "9"),
    );
  const failed = s.emails.filter(
    (e) => e.status === "failed" || e.status === "needs_check" || e.bounced_at,
  );
  const sentFirst = s.emails.filter(
    (e) => e.status === "sent" && e.kind === "first" && !e.bounced_at,
  );
  const replied = sentFirst.filter((e) =>
    ["replied", "unsubscribed"].includes(
      thread.get(e.thread_id ?? "")?.status ?? "",
    ),
  );
  const sent = sentFirst.filter((e) => !replied.includes(e));

  return (
    <>
      {waiting.length > 0 && (
        <Section
          id="followups"
          title="Follow-ups waiting for you"
          count={waiting.length}
          empty=""
        >
          {waiting.map((e) => (
            <FollowUpCard key={e.id} e={e} />
          ))}
        </Section>
      )}

      <Section
        id="scheduled"
        title="Scheduled"
        count={scheduled.length}
        empty="Nothing is scheduled. Emails you approve get a time here once sending is on."
      >
        {scheduled.map((e) => (
          <Row key={e.id} e={e} state="scheduled">
            {e.status === "sending" ? (
              <Badge tone="blue">Sending now</Badge>
            ) : e.scheduled_at ? (
              <>
                <span>
                  {dateTime(e.scheduled_at, s.timeZone)}
                  {from(e) ? ` · from ${from(e)}` : ""}
                </span>
                <Badge tone="plain">Scheduled</Badge>
              </>
            ) : (
              <Badge tone="outline">
                {s.live ? "Waiting for a free slot" : "Waiting: sending is off"}
              </Badge>
            )}
          </Row>
        ))}
      </Section>

      <Section
        id="sent"
        title="Sent"
        count={sent.length}
        empty="No email has been sent yet."
      >
        {sent.map((e) => {
          const t = thread.get(e.thread_id ?? "");
          return (
            <Row key={e.id} e={e} state="sent">
              <span>
                {dateTime(e.sent_at, s.timeZone)}
                {from(e) ? ` · from ${from(e)}` : ""}
              </span>
              {t && t.followups_sent > 0 && (
                <span>
                  {t.followups_sent} follow-up{t.followups_sent > 1 ? "s" : ""}{" "}
                  sent
                </span>
              )}
              {t?.status === "active" && t.next_followup_at && (
                <span>
                  Next follow-up due {dateTime(t.next_followup_at, s.timeZone)}
                </span>
              )}
              <Badge tone="ink">Sent</Badge>
            </Row>
          );
        })}
      </Section>

      <Section
        id="replied"
        title="Replied"
        count={replied.length}
        empty="No replies yet. They appear here and in your Inbox."
      >
        {replied.map((e) => {
          const t = thread.get(e.thread_id ?? "")!;
          return (
            <Row key={e.id} e={e} state="replied">
              {t.reply_class && (
                <Badge
                  tone={t.reply_class === "interested" ? "ink" : "outline"}
                >
                  {REPLY_CLASS_LABEL[t.reply_class]}
                </Badge>
              )}
              {t.status === "unsubscribed" && !t.reply_class && (
                <Badge tone="outline">Unsubscribed</Badge>
              )}
              <Link
                href={`/app/inbox?queue=all&c=${t.conversation_id}`}
                className={cn(btn.secondary, btn.small)}
              >
                Open in Inbox
              </Link>
            </Row>
          );
        })}
      </Section>

      <Section
        id="failed"
        title="Failed"
        count={failed.length}
        empty="Nothing has failed."
      >
        {failed.map((e) => (
          <li
            key={e.id}
            data-email={e.to_email}
            data-email-state={e.bounced_at ? "bounced" : e.status}
            className="px-4 py-3 text-[12.5px]"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Who e={e} />
              <span className="text-[#0B0B0C]/45">{KIND_WORDS(e)}</span>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                {e.bounced_at ? (
                  <Badge tone="warn">Bounced</Badge>
                ) : e.status === "needs_check" ? (
                  <Badge tone="warn">Needs checking</Badge>
                ) : (
                  <Badge tone="warn">Not sent</Badge>
                )}
                {!e.bounced_at && <Resolve e={e} />}
              </span>
            </div>
            <p className={cn(hint, "mt-1.5 max-w-[720px]")}>
              {e.bounced_at
                ? "The address didn't accept the email. It is on your never-contact list now, and no follow-up will be sent."
                : e.status === "needs_check"
                  ? `Dialvo handed this to the mail server and never heard back, so it may or may not have gone. It will not be sent again on its own. Look in the Sent folder of ${from(e) ?? "the mailbox"}, then say which it was.`
                  : (e.error ?? "The mail server didn't accept it.")}
            </p>
          </li>
        ))}
      </Section>
    </>
  );
}
