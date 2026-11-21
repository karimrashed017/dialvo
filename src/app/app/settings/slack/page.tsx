import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Hash } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { agoWords } from "@/lib/app/time";
import { integrationReads } from "@/lib/integrations/read";
import { SLACK_EVENT_LABEL, SLACK_EVENTS } from "@/lib/integrations/slack";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
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
  connectSlack,
  disconnectSlack,
  saveSlackSettings,
  sendSlackNow,
  testSlack,
} from "./actions";

export const metadata: Metadata = { title: "Slack" };

const STATUS: Record<string, string> = {
  pending: "Waiting",
  running: "Sending",
  delivered: "Posted",
  failed: "Failed",
  skipped: "Not posted",
};

async function Content() {
  const { workspace, preview } = await getAppContext();
  const admin = workspace.role !== "member";
  const head = (
    <PageHead
      title="Slack"
      note="Post the moments your team should act on to a Slack channel: hot replies, chats that need a person, meetings booked, what waits for approval, and plays finishing."
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
        <section className={panel}>
          <Empty icon={Hash} title="Not part of the design preview" />
        </section>
      </>
    );
  const on = Boolean(createServiceClient());
  const reads = integrationReads(await createClient(), workspace.id);
  const [slack, posts] = await Promise.all([
    reads.slack(),
    reads.deliveries("slack", 15),
  ]);
  const connected = slack && slack.status !== "disconnected";

  return (
    <>
      {head}
      {!on && (
        <p
          role="status"
          className="mb-3 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-[13px] leading-[1.5]"
        >
          Slack isn&apos;t switched on yet on Dialvo&apos;s side (the server
          needs its database key), so nothing can be connected here yet.
        </p>
      )}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <section className={panel}>
          <h2 className={panelHead}>
            {connected ? "Connected" : "Connect a channel"}
            {connected && (
              <Badge tone={slack.status === "active" ? "ink" : "warn"}>
                {slack.status === "active" ? "Posting" : "Not posting"}
              </Badge>
            )}
          </h2>
          <div className="space-y-3 p-4 text-[13px] leading-[1.5]">
            {connected && (
              <div className="space-y-1">
                <p>
                  Posting to{" "}
                  <span className="font-medium">
                    {slack.channel_label || "your channel"}
                  </span>
                  , connected {agoWords(slack.connected_at)}.
                  {slack.last_posted_at &&
                    ` Last post ${agoWords(slack.last_posted_at)}.`}
                </p>
                {slack.status === "error" && (
                  <p role="alert" className="text-[#B42318]">
                    Slack refused the webhook ({slack.status_reason}). Nothing
                    is posted until you connect a new one below.
                  </p>
                )}
                {slack.status === "active" && slack.last_error && (
                  <p className={hint}>
                    Last problem{" "}
                    {slack.last_error_at && agoWords(slack.last_error_at)}:{" "}
                    {slack.last_error}. Dialvo tries again on its own.
                  </p>
                )}
              </div>
            )}
            {admin ? (
              <ActionForm
                action={connectSlack}
                resetOnSuccess
                className="space-y-3"
              >
                <label className={labelCls}>
                  Slack webhook URL
                  <input
                    name="url"
                    type="password"
                    autoComplete="off"
                    required
                    maxLength={300}
                    placeholder="https://hooks.slack.com/services/…"
                    disabled={!on}
                    className={cn(input, "mt-1")}
                  />
                </label>
                <label className={labelCls}>
                  Channel name{" "}
                  <span className="font-normal text-[#0B0B0C]/45">
                    (to remember where posts go)
                  </span>
                  <input
                    name="label"
                    maxLength={80}
                    placeholder="#sales"
                    defaultValue={slack?.channel_label ?? ""}
                    disabled={!on}
                    className={cn(input, "mt-1")}
                  />
                </label>
                <SubmitButton disabled={!on} pendingText="Sending a test…">
                  {connected
                    ? "Replace and send a test"
                    : "Connect and send a test"}
                </SubmitButton>
                <p className={hint}>
                  Dialvo posts a test message first and saves the URL only if
                  Slack takes it. The URL is kept encrypted and is never shown
                  again.
                </p>
              </ActionForm>
            ) : (
              <p className={hint}>
                Only the workspace&apos;s owner or an admin can connect Slack.
              </p>
            )}
            {connected && admin && (
              <div className="flex flex-wrap gap-2 border-t border-black/[0.06] pt-3">
                <ActionForm action={testSlack}>
                  <SubmitButton
                    variant="secondary"
                    small
                    pendingText="Sending…"
                  >
                    Send a test message
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={sendSlackNow}>
                  <SubmitButton variant="ghost" small pendingText="Sending…">
                    Send what is waiting
                  </SubmitButton>
                </ActionForm>
                <ActionForm
                  action={disconnectSlack}
                  confirm="Disconnect Slack? Dialvo deletes the webhook URL and stops posting."
                >
                  <SubmitButton
                    variant="danger"
                    small
                    pendingText="Disconnecting…"
                  >
                    Disconnect
                  </SubmitButton>
                </ActionForm>
              </div>
            )}
          </div>
        </section>

        <section className={panel}>
          <h2 className={panelHead}>How to get the URL</h2>
          <ol className="list-decimal space-y-1.5 p-4 pl-8 text-[13px] leading-[1.5] text-[#0B0B0C]/75">
            <li>
              In Slack, open{" "}
              <a
                href="https://api.slack.com/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                api.slack.com/apps
              </a>{" "}
              and choose Create New App, From scratch. Name it Dialvo and pick
              your Slack workspace.
            </li>
            <li>Under Features, open Incoming Webhooks and switch it on.</li>
            <li>
              Choose Add New Webhook, pick the channel (for example #sales) and
              allow it.
            </li>
            <li>Copy the Webhook URL and paste it here.</li>
          </ol>
          <p className={cn(hint, "px-4 pb-4")}>
            Posts link back to Dialvo. Approving emails from Slack isn&apos;t
            offered: a Slack message can be forwarded, so approvals stay with a
            signed-in person in the app.
          </p>
        </section>

        {connected && (
          <section className={panel}>
            <h2 className={panelHead}>What to post</h2>
            <ActionForm action={saveSlackSettings} className="space-y-3 p-4">
              <fieldset className="space-y-1.5">
                {SLACK_EVENTS.map((e) => (
                  <label
                    key={e}
                    className="flex items-center gap-2 text-[13px]"
                  >
                    <input
                      type="checkbox"
                      name="events"
                      value={e}
                      defaultChecked={slack.events.includes(e)}
                      disabled={!admin}
                      className="size-3.5 accent-[#0B0B0C]"
                    />
                    {SLACK_EVENT_LABEL[e]}
                  </label>
                ))}
              </fieldset>
              <label className={labelCls}>
                Daily digest at (UTC)
                <select
                  name="digest_hour"
                  defaultValue={String(slack.digest_hour)}
                  disabled={!admin}
                  className={cn(input, "mt-1 max-w-[140px]")}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
              {admin && <SubmitButton>Save</SubmitButton>}
              <p className={hint}>
                At most 60 posts an hour; the digest is posted only on days when
                something waits.
              </p>
            </ActionForm>
          </section>
        )}

        {connected && (
          <section className={panel}>
            <h2 className={panelHead}>Latest posts</h2>
            {posts.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-[#0B0B0C]/50">
                Nothing has been posted yet.
              </p>
            ) : (
              <ul className="divide-y divide-black/[0.06]">
                {posts.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px]"
                  >
                    <span className="min-w-0 flex-1">
                      {SLACK_EVENT_LABEL[
                        p.event as keyof typeof SLACK_EVENT_LABEL
                      ] ?? p.event}
                      {p.last_error && p.status !== "delivered" && (
                        <span className="block truncate text-[11.5px] text-[#0B0B0C]/50">
                          {p.last_error}
                        </span>
                      )}
                    </span>
                    <span className="text-[12px] text-[#0B0B0C]/50">
                      {agoWords(p.created_at)}
                    </span>
                    <Badge
                      tone={
                        p.status === "failed"
                          ? "warn"
                          : p.status === "delivered"
                            ? "plain"
                            : "outline"
                      }
                    >
                      {STATUS[p.status] ?? p.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}

export default function SlackPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
