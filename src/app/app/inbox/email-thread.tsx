import Link from "next/link";
import { dateTime } from "@/lib/app/time";
import { mailRuntimeStatus } from "@/lib/mail/config";
import type { mailReads } from "@/lib/mail/read";
import { REPLY_CLASS_LABEL, type OutboundEmail } from "@/lib/mail/types";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import { Badge, btn, input } from "../_ui/kit";
import { decideEmail, resolveEmail } from "../prospects/sending-actions";

// What an email conversation shows that other channels don't: where the
// sequence stands, the agent's draft answer waiting for a yes, and replies
// that are on their way out or didn't go.

export type MailConversation = NonNullable<
  Awaited<ReturnType<ReturnType<typeof mailReads>["conversation"]>>
>;

const SEQUENCE: Record<string, string> = {
  active: "No reply yet.",
  replied: "They replied, so follow-ups have stopped.",
  bounced:
    "The email bounced. The address is on your never-contact list and nothing more will be sent.",
  unsubscribed:
    "They asked not to be contacted. They are on your never-contact list and nothing more will be sent.",
  stopped: "Follow-ups were stopped.",
  finished: "Both follow-ups were sent. No reply yet.",
};

/** The line under the thread's header. */
export function EmailStatus({
  mail,
  timezone,
}: {
  mail: MailConversation;
  timezone: string;
}) {
  const { thread, mailbox, latest } = mail;
  return (
    <div
      data-email-thread={thread.status}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-black/[0.06] bg-black/[0.02] px-4 py-2 text-[12.5px] leading-[1.45] text-[#0B0B0C]/70"
    >
      <p className="min-w-0 flex-1">
        {thread.reply_class && (
          <Badge
            tone={thread.reply_class === "interested" ? "ink" : "outline"}
            className="mr-2"
          >
            {REPLY_CLASS_LABEL[thread.reply_class]}
          </Badge>
        )}
        Email with {thread.to_email}
        {mailbox ? `, from ${mailbox.email}` : ""}. {SEQUENCE[thread.status]}
        {thread.status === "active" &&
          thread.next_followup_at &&
          ` Next follow-up due ${dateTime(thread.next_followup_at, timezone)}.`}
        {latest?.class_summary && (
          <span className="mt-0.5 block text-[#0B0B0C]/55">
            Agent&apos;s note: {latest.class_summary}
          </span>
        )}
      </p>
      <Link
        href={`/app/leads/${thread.lead_id}#meeting`}
        className={cn(btn.secondary, btn.small)}
      >
        Mark meeting booked
      </Link>
    </div>
  );
}

function DraftCard({ e }: { e: OutboundEmail }) {
  return (
    <div
      data-email-draft={e.kind}
      className="border-t border-black/[0.06] bg-[#1F3BFF]/[0.04] p-3"
    >
      <p className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-[#0B0B0C]/70">
        <Badge tone="blue">Draft</Badge>
        {e.kind === "followup"
          ? `The agent wrote follow-up ${e.step}. It hasn't been sent.`
          : "The agent wrote this answer. It hasn't been sent."}
      </p>
      <ActionForm action={decideEmail} quiet>
        <input type="hidden" name="email" value={e.id} />
        <label className="sr-only" htmlFor={`draft-${e.id}`}>
          Edit the draft
        </label>
        <textarea
          id={`draft-${e.id}`}
          name="body"
          rows={Math.min(10, Math.max(3, e.body.split("\n").length + 1))}
          required
          maxLength={5000}
          defaultValue={e.body}
          className={input}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SubmitButton
            name="action"
            value="approve"
            small
            pendingText="Sending…"
          >
            Approve &amp; send
          </SubmitButton>
          <SubmitButton
            name="action"
            value="discard"
            variant="ghost"
            small
            pendingText="Discarding…"
          >
            Discard
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

/** Drafts to decide on, and emails on their way out or stuck. */
export function EmailPending({
  mail,
  timezone,
}: {
  mail: MailConversation;
  timezone: string;
}) {
  const runtime = mailRuntimeStatus().on;
  return (
    <>
      {mail.pending.map((e) =>
        e.status === "draft" ? (
          <DraftCard key={e.id} e={e} />
        ) : e.status === "failed" || e.status === "needs_check" ? (
          <div
            key={e.id}
            data-email-stuck={e.status}
            role="alert"
            className="border-t border-black/[0.06] bg-[#B42318]/[0.05] px-4 py-2.5 text-[12.5px] leading-[1.5]"
          >
            <p>
              {e.status === "needs_check"
                ? "Dialvo handed this email to the mail server and never heard back, so it may or may not have gone. It won't be sent again on its own: check the mailbox's Sent folder, then say which it was."
                : `This email wasn't sent. ${e.error ?? ""}`}
            </p>
            <p className="mt-1 rounded-lg bg-white px-3 py-1.5 whitespace-pre-wrap text-[#0B0B0C]/75">
              {e.body}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(e.status === "needs_check"
                ? [
                    ["sent", "It was sent"],
                    ["resend", "Send again"],
                    ["cancel", "Leave unsent"],
                  ]
                : [
                    ["resend", "Send again"],
                    ["cancel", "Leave unsent"],
                  ]
              ).map(([action, label]) => (
                <ActionForm key={action} action={resolveEmail} quiet>
                  <input type="hidden" name="email" value={e.id} />
                  <input type="hidden" name="action" value={action} />
                  <SubmitButton variant="secondary" small pendingText="…">
                    {label}
                  </SubmitButton>
                </ActionForm>
              ))}
            </div>
          </div>
        ) : e.status === "writing" ? null : (
          <p
            key={e.id}
            data-email-outgoing={e.status}
            role="status"
            className="border-t border-black/[0.06] bg-black/[0.02] px-4 py-2 text-[12.5px] leading-[1.5] text-[#0B0B0C]/70"
          >
            <span className="font-medium text-[#0B0B0C]">
              {e.written_by === "user" ? "Your reply" : "The agent's email"}{" "}
              {e.status === "sending"
                ? "is being sent now."
                : !runtime
                  ? "is saved and waiting. Sending isn't switched on yet on Dialvo's side, so it hasn't gone."
                  : e.status === "scheduled" && e.scheduled_at
                    ? `is scheduled for ${dateTime(e.scheduled_at, timezone)}.`
                    : "is on its way: it goes out within a minute or two."}
            </span>{" "}
            <span className="block truncate text-[#0B0B0C]/55">{e.body}</span>
          </p>
        ),
      )}
    </>
  );
}
