import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Mailbox as MailboxIcon } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { agoWords, dateOnly } from "@/lib/app/time";
import {
  AUTH_FAILURES_BEFORE_PAUSE,
  IMAP_POLL_INTERVAL_SECONDS,
  MAILBOX_DAILY_LIMIT_MAX,
  mailRuntimeStatus,
  MAX_MAILBOXES,
  RAMP_START,
  RAMP_STEP,
  WORKSPACE_DAILY_SEND_CAP,
} from "@/lib/mail/config";
import { mailReads } from "@/lib/mail/read";
import { allowanceOn } from "@/lib/mail/schedule";
import { senderDetailsReady, type Mailbox } from "@/lib/mail/types";
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
import {
  disconnectMailbox,
  resumeMailbox,
  saveFollowUps,
  saveSenderDetails,
  sendTestEmail,
  setSending,
  updateMailbox,
} from "./actions";
import { ConnectForm } from "./connect-form";

export const metadata: Metadata = { title: "Mailboxes" };

const link =
  "underline decoration-black/25 underline-offset-2 hover:decoration-black/60";

function MailboxRow({
  box,
  admin,
  timeZone,
  canTest,
}: {
  box: Mailbox;
  admin: boolean;
  timeZone: string;
  canTest: boolean;
}) {
  const today = allowanceOn(box, new Date(), timeZone);
  const ramping = today < box.daily_limit;
  return (
    <li
      data-mailbox={box.email}
      className="border-b border-black/[0.06] p-4 last:border-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="text-[14px] font-medium break-all">{box.email}</h3>
        {box.status === "active" ? (
          <Badge tone="ink">Connected</Badge>
        ) : (
          <Badge tone="warn">Paused</Badge>
        )}
        <span className="text-[12.5px] text-[#0B0B0C]/55">
          Sends as {box.sender_name}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[#0B0B0C]/65">
        Can send up to {today} today
        {ramping
          ? `, on its way to ${box.daily_limit} a day (a new mailbox adds ${RAMP_STEP} a day)`
          : ""}
        . Connected {dateOnly(box.connected_at, timeZone)}.{" "}
        {box.last_sent_at
          ? `Last sent ${agoWords(box.last_sent_at)}.`
          : "Nothing sent yet."}{" "}
        {box.last_polled_at
          ? `Replies last checked ${agoWords(box.last_polled_at)}.`
          : "Replies not checked yet."}
      </p>
      {box.status === "paused" && (
        <p
          role="alert"
          className="mt-2 rounded-xl bg-[#B42318]/[0.06] px-3 py-2 text-[12.5px] leading-[1.5] text-[#B42318]"
        >
          Paused: the mail server refused the login {AUTH_FAILURES_BEFORE_PAUSE}{" "}
          times in a row, so Dialvo stopped trying. Emails waiting for this
          mailbox are held, not lost. Create a new app password, connect this
          address again below, and it carries on.
          {box.last_error && (
            <span className="mt-1 block text-[#0B0B0C]/65">
              What the server said: {box.last_error}
            </span>
          )}
        </p>
      )}
      {box.status === "active" && box.last_error && (
        <p className={cn(hint, "mt-1.5")}>Last problem: {box.last_error}</p>
      )}
      {admin && (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <ActionForm action={sendTestEmail}>
            <input type="hidden" name="mailbox" value={box.id} />
            <SubmitButton
              variant="secondary"
              small
              pendingText="Sending…"
              disabled={!canTest}
            >
              Send me a test email
            </SubmitButton>
          </ActionForm>
          {box.status === "paused" && (
            <ActionForm action={resumeMailbox} quiet>
              <input type="hidden" name="mailbox" value={box.id} />
              <SubmitButton variant="secondary" small pendingText="Resuming…">
                Resume
              </SubmitButton>
            </ActionForm>
          )}
          <details className="min-w-0 open:order-last open:basis-full">
            <summary
              className={cn(
                btn.secondary,
                btn.small,
                "w-fit list-none [&::-webkit-details-marker]:hidden",
              )}
            >
              Edit
            </summary>
            <ActionForm
              action={updateMailbox}
              className="mt-3 grid max-w-[520px] gap-3 sm:grid-cols-[minmax(0,1fr)_140px]"
            >
              <input type="hidden" name="mailbox" value={box.id} />
              <label className={labelCls}>
                Your real name
                <input
                  name="sender_name"
                  required
                  maxLength={120}
                  defaultValue={box.sender_name}
                  className={`${input} mt-1`}
                />
              </label>
              <label className={labelCls}>
                Most emails a day
                <input
                  name="daily_limit"
                  type="number"
                  required
                  min={1}
                  max={MAILBOX_DAILY_LIMIT_MAX}
                  defaultValue={box.daily_limit}
                  className={`${input} mt-1`}
                />
              </label>
              <div className="sm:col-span-2">
                <SubmitButton variant="secondary" small>
                  Save
                </SubmitButton>
              </div>
            </ActionForm>
          </details>
          <ActionForm
            action={disconnectMailbox}
            quiet
            confirm={`Disconnect ${box.email}? Its app password is deleted from Dialvo at once. Follow-ups and replies waiting to leave from it are cancelled; first emails wait for another mailbox.`}
          >
            <input type="hidden" name="mailbox" value={box.id} />
            <SubmitButton
              variant="ghost"
              small
              pendingText="Disconnecting…"
              className="text-[#B42318]"
            >
              Disconnect
            </SubmitButton>
          </ActionForm>
        </div>
      )}
      {admin && !canTest && (
        <p className={cn(hint, "mt-2")}>
          A test email can be sent once sending is switched on on Dialvo&apos;s
          side. Connecting already proved the login works.
        </p>
      )}
    </li>
  );
}

async function Content() {
  const { workspace, user, preview } = await getAppContext();
  const head = (
    <PageHead
      title="Mailboxes"
      note="Connect the mailbox your emails should come from. Approved emails go out from your own address, under your own name, a few at a time."
    >
      <Link href="/app/settings" className={cn(btn.ghost, btn.small)}>
        All settings
      </Link>
      <Link
        href="/app/prospects?view=emails"
        className={cn(btn.secondary, btn.small)}
      >
        First emails
      </Link>
    </PageHead>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={MailboxIcon} title="Not part of the design preview">
            Connecting a mailbox needs the real app.
          </Empty>
        </section>
      </>
    );

  const reads = mailReads(await createClient(), workspace.id);
  const [boxes, settings] = await Promise.all([
    reads.mailboxes(),
    reads.settings(),
  ]);
  const admin = workspace.role !== "member";
  const runtime = mailRuntimeStatus();
  const ready = senderDetailsReady(settings);
  const active = boxes.filter((b) => b.status === "active");
  const adminOnly = !admin && (
    <p className={`${hint} px-4 pb-4`}>
      Only the workspace&apos;s owner and admins can change this.
    </p>
  );
  const missing = [
    !ready && "your sender details",
    active.length === 0 && "a connected mailbox",
  ].filter(Boolean);

  return (
    <>
      {head}
      {!runtime.on && (
        <div
          role="status"
          data-mail="not-live"
          className="mb-3 rounded-2xl border border-black/[0.1] bg-white px-4 py-3 text-[13px] leading-[1.5] text-[#0B0B0C]/75"
        >
          <span className="font-medium text-[#0B0B0C]">
            Sending isn&apos;t switched on yet on Dialvo&apos;s side.
          </span>{" "}
          You can connect a mailbox and fill everything in now: connecting
          checks the login for real. No email leaves until Dialvo switches
          sending on. Nothing here is broken, and there is nothing else you need
          to do.
        </div>
      )}

      <section
        id="sending"
        data-sending={settings.sending_on ? "on" : "off"}
        className={cn(panel, "mb-3 scroll-mt-28")}
      >
        <h2 className={panelHead}>
          Sending
          <Badge tone={settings.sending_on ? "ink" : "outline"}>
            {settings.sending_on ? "On" : "Off"}
          </Badge>
        </h2>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-4">
          <p className="max-w-[640px] text-[13px] leading-[1.5] text-[#0B0B0C]/70">
            {settings.sending_on
              ? "Emails you approve are given a time inside your outbound agent's send window and go out from your mailboxes a few minutes apart. Turning this off stops everything at once: emails already sent stay sent, and the rest wait."
              : missing.length
                ? `Nothing is sent to anyone. To turn sending on you still need ${missing.join(" and ")}.`
                : "Nothing is sent to anyone yet. Everything needed is in place: turn sending on when you're ready. Emails you have already approved will start going out inside your send window."}{" "}
            <Link href="/app/agents" className={link}>
              Change the send window
            </Link>
          </p>
          {admin && (
            <ActionForm
              action={setSending}
              confirm={
                settings.sending_on
                  ? undefined
                  : "Turn sending on? Emails you've approved will start going out from your mailbox inside your send window."
              }
            >
              <input
                type="hidden"
                name="sending_on"
                value={settings.sending_on ? "false" : "true"}
              />
              <SubmitButton
                variant={settings.sending_on ? "secondary" : "primary"}
                disabled={!settings.sending_on && missing.length > 0}
              >
                {settings.sending_on ? "Turn sending off" : "Turn sending on"}
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </section>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <section id="sender" className={cn(panel, "scroll-mt-28")}>
          <h2 className={panelHead}>
            Who is sending
            <Badge tone={ready ? "ink" : "outline"}>
              {ready ? "Complete" : "Needed before any email is sent"}
            </Badge>
          </h2>
          <ActionForm action={saveSenderDetails} className="p-4">
            <fieldset disabled={!admin} className="space-y-3">
              <p className="text-[13px] leading-[1.5] text-[#0B0B0C]/70">
                Every email says who it is from: your name, your business and a
                postal address where it can be reached, with a line on how to
                stop the emails. Use your real details.
              </p>
              <label className={labelCls}>
                Business name
                <input
                  name="business_name"
                  required
                  maxLength={200}
                  defaultValue={settings.business_name || workspace.name}
                  className={`${input} mt-1`}
                />
              </label>
              <label className={labelCls}>
                Postal address
                <textarea
                  name="postal_address"
                  required
                  rows={3}
                  maxLength={500}
                  defaultValue={settings.postal_address}
                  placeholder={"Street and number\nPostcode and city\nCountry"}
                  className={`${input} mt-1`}
                />
              </label>
              {settings.allowed_confirmed_at ? (
                <p
                  data-confirmed
                  className="rounded-xl bg-black/[0.035] px-3 py-2 text-[12.5px] leading-[1.5] text-[#0B0B0C]/75"
                >
                  Confirmed on{" "}
                  {dateOnly(settings.allowed_confirmed_at, workspace.timezone)}:
                  you only contact businesses you are allowed to email.
                </p>
              ) : (
                <label className="flex items-start gap-2.5 text-[13px] leading-[1.45]">
                  <input
                    type="checkbox"
                    name="confirm_allowed"
                    className="mt-0.5 size-4 accent-[#0B0B0C]"
                  />
                  <span>
                    We only contact businesses we are allowed to email.
                    <span className="mt-0.5 block text-[12px] text-[#0B0B0C]/55">
                      The rules on emailing businesses differ from country to
                      country, and following them is up to you.
                    </span>
                  </span>
                </label>
              )}
            </fieldset>
            {admin && (
              <div className="mt-4 flex justify-end">
                <SubmitButton>Save sender details</SubmitButton>
              </div>
            )}
          </ActionForm>
          {adminOnly}
        </section>

        <section id="follow-ups" className={cn(panel, "scroll-mt-28")}>
          <h2 className={panelHead}>Follow-ups, replies and booking</h2>
          <ActionForm action={saveFollowUps} className="p-4">
            <fieldset disabled={!admin} className="space-y-3">
              <label className="flex items-start gap-2.5 text-[13px] leading-[1.45]">
                <input
                  type="checkbox"
                  name="followups_enabled"
                  defaultChecked={settings.followups_enabled}
                  className="mt-0.5 size-4 accent-[#0B0B0C]"
                />
                <span>
                  Follow up when nobody answers
                  <span className="mt-0.5 block text-[12px] text-[#0B0B0C]/55">
                    Up to two follow-ups, each shorter than the last, in the
                    same thread and from the same mailbox. They wait for your
                    approval unless your outbound agent is set to send on its
                    own. A reply, an unsubscribe or a bounce stops them.
                  </span>
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelCls}>
                  First follow-up, days after the first email
                  <input
                    name="followup_1_days"
                    type="number"
                    required
                    min={1}
                    max={30}
                    defaultValue={settings.followup_1_days}
                    className={`${input} mt-1`}
                  />
                </label>
                <label className={labelCls}>
                  Second follow-up, days after the first email
                  <input
                    name="followup_2_days"
                    type="number"
                    required
                    min={2}
                    max={60}
                    defaultValue={settings.followup_2_days}
                    className={`${input} mt-1`}
                  />
                </label>
              </div>
              <label className={labelCls}>
                When someone replies with interest or a question
                <select
                  name="reply_mode"
                  defaultValue={settings.reply_mode}
                  className={`${input} mt-1`}
                >
                  <option value="approve_first">
                    The agent drafts an answer and waits for me
                  </option>
                  <option value="auto">The agent answers on its own</option>
                </select>
                <span className={`${hint} mt-1.5 block`}>
                  Answers come from your Knowledge. Anyone who asks to stop, or
                  says they aren&apos;t interested, goes on your never-contact
                  list straight away, whichever you choose.
                </span>
              </label>
              <label className={labelCls}>
                Booking link{" "}
                <span className="font-normal text-[#0B0B0C]/45">
                  (optional)
                </span>
                <input
                  name="booking_url"
                  inputMode="url"
                  maxLength={500}
                  defaultValue={settings.booking_url ?? ""}
                  placeholder="https://your-scheduling-page.com/you"
                  className={`${input} mt-1`}
                />
                <span className={`${hint} mt-1.5 block`}>
                  Your own scheduling page. The agent offers it when someone
                  wants to talk. Dialvo doesn&apos;t read your calendar: mark a
                  meeting as booked on the lead when one is.
                </span>
              </label>
            </fieldset>
            {admin && (
              <div className="mt-4 flex justify-end">
                <SubmitButton>Save</SubmitButton>
              </div>
            )}
          </ActionForm>
          {adminOnly}
        </section>

        <section
          id="mailboxes"
          className={cn(panel, "scroll-mt-28 lg:col-span-2")}
        >
          <h2 className={panelHead}>
            Your mailboxes
            <span className="text-[11.5px] font-normal text-[#0B0B0C]/50 tabular-nums">
              {boxes.length} of {MAX_MAILBOXES}
            </span>
          </h2>
          {boxes.length === 0 ? (
            <Empty icon={MailboxIcon} title="No mailbox connected">
              Until one is, nothing is sent. Connect the address your emails
              should come from below.
            </Empty>
          ) : (
            <ul>
              {boxes.map((box) => (
                <MailboxRow
                  key={box.id}
                  box={box}
                  admin={admin}
                  timeZone={workspace.timezone}
                  canTest={runtime.on}
                />
              ))}
            </ul>
          )}
          <p className="border-t border-black/[0.06] px-4 py-2.5 text-[12px] leading-[1.5] text-[#0B0B0C]/50">
            Emails are spread across your mailboxes. Each sends at most its own
            daily limit, a new one starts at {RAMP_START} a day, and the whole
            workspace sends at most {WORKSPACE_DAILY_SEND_CAP} a day. Replies
            are checked every {Math.round(IMAP_POLL_INTERVAL_SECONDS / 60)}{" "}
            minutes; only replies to emails Dialvo sent are kept, and nothing in
            your inbox is changed.
          </p>
        </section>

        <section
          id="connect"
          className={cn(panel, "scroll-mt-28 lg:col-span-2")}
        >
          <h2 className={panelHead}>Connect a mailbox</h2>
          {admin ? (
            <ConnectForm
              defaultName={boxes[0]?.sender_name ?? user.name}
              defaultEmail={boxes.length === 0 ? user.email : ""}
            />
          ) : (
            <p className={`${hint} p-4`}>
              Only the workspace&apos;s owner and admins can connect a mailbox.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

export default function MailboxesPage() {
  return (
    // The page reads the session, so it streams in behind this boundary.
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
