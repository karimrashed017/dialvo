import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Check, Circle } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago, agoWords } from "@/lib/app/time";
import { PLAYS, type PlaySlug } from "@/lib/content/catalog";
import { mailReads } from "@/lib/mail/read";
import { APP_PLAYS, isPlaySlug } from "@/lib/plays/catalog";
import {
  API_EVENTS_PER_MINUTE,
  EVENT_LIST_MAX_ROWS,
  PLAY_DAYS_MAX,
  PLAY_DAYS_MIN,
  PLAY_DEFAULT_DAYS,
  PLAY_MAX_LEADS_PER_START,
} from "@/lib/plays/config";
import { playReads, type Campaign } from "@/lib/plays/read";
import { createPlayStore, type LeadPlay } from "@/lib/plays/store";
import {
  contactDatabaseStatus,
  prospectRuntimeStatus,
} from "@/lib/prospects/config";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../../_ui/form";
import {
  Badge,
  btn,
  hint,
  input,
  labelCls,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../../_ui/kit";
import { DraftWriter } from "../../prospects/drivers";
import {
  checkTakeout,
  importEvent,
  saveSpeedToLead,
  startLeadPlay,
  startTakeout,
  stopCampaign,
} from "../actions";
import { BeingBuilt, CountStrip, GoLink, StatusPill, sumCounts } from "../ui";
import { SequenceFields } from "../sequence-fields";
import { listSequences } from "@/lib/sequences/server";
import { PURPOSE_SEQUENCES } from "@/lib/sequences/steps";

/** The plays that start on the workspace's own leads, and their kind. */
const LEAD_PLAY: Partial<Record<PlaySlug, LeadPlay>> = {
  "lead-reactivation": "reactivation",
  "closed-lost": "closed_lost",
  "lead-nurture": "nurture",
  "customer-onboarding-operations": "onboarding",
  "customer-expansion": "expansion",
  "plg-conversion": "plg",
};

const DAYS_LABEL: Record<LeadPlay, string> = {
  reactivation: "No activity for at least this many days",
  closed_lost: "Marked lost at least this many days ago",
  nurture: "Last email at least this many days ago",
  onboarding: "Became a customer in the last this many days",
  expansion: "Agreed to email or talked to you; checked again after",
  plg: "Reached a limit in the last this many days",
};

const EVENT_AUDIENCE: Partial<Record<PlaySlug, string>> = {
  "event-registration": "registered",
  "event-follow-up": "attended",
  "event-no-show": "no_show",
};

export async function generateMetadata({
  params,
}: PageProps<"/app/plays/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return { title: isPlaySlug(slug) ? PLAYS[slug].title : "Plays" };
}

function Need({ ok, children }: { ok: boolean | null; children: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <Check aria-label="Done" className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <Circle
          aria-label={ok === false ? "Not yet" : ""}
          className="mt-0.5 size-3.5 shrink-0 text-[#0B0B0C]/35"
        />
      )}
      <span>{children}</span>
    </li>
  );
}

function CampaignList({
  campaigns,
  sizes,
}: {
  campaigns: Campaign[];
  sizes: Map<string, number>;
}) {
  if (campaigns.length === 0) return null;
  return (
    <section className={cn(panel, "mt-3")}>
      <h2 className={panelHead}>Started</h2>
      <ul className="divide-y divide-black/[0.06]">
        {campaigns.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[13px]"
          >
            <span className="min-w-0 flex-1 font-medium">{c.name}</span>
            <span className="text-[12px] text-[#0B0B0C]/55 tabular-nums">
              {sizes.get(c.id) ?? 0} people · {ago(c.created_at)}
            </span>
            <Badge tone={c.status === "active" ? "ink" : "outline"}>
              {c.status === "active"
                ? "Running"
                : c.status === "done"
                  ? "Done"
                  : "Stopped"}
            </Badge>
            {c.status === "active" && (
              <ActionForm
                action={stopCampaign}
                confirm="Stop this? Emails not written yet won't be. Ones already written stay where they are."
              >
                <input type="hidden" name="campaign" value={c.id} />
                <SubmitButton variant="ghost" small pendingText="Stopping…">
                  Stop
                </SubmitButton>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Content({ slug }: { slug: PlaySlug }) {
  const { workspace, user, preview, repo } = await getAppContext();
  const play = APP_PLAYS[slug];
  const title = PLAYS[slug].title;
  const admin = workspace.role !== "member";
  const on = prospectRuntimeStatus().on;
  const contactOn = contactDatabaseStatus().on;

  const head = (
    <PageHead title={title} note={play.what}>
      <Link href="/app/plays" className={cn(btn.ghost, btn.small)}>
        <ArrowLeft aria-hidden className="size-3.5" />
        All plays
      </Link>
      <StatusPill status={play.status} />
    </PageHead>
  );

  if (play.status === "building")
    return (
      <>
        {head}
        <BeingBuilt title={title} what={play.what} needs={play.needs} />
      </>
    );
  if (preview)
    return (
      <>
        {head}
        <section className={cn(panel, "p-4 text-[13px]")}>
          Plays need the real app. Nothing is shown here with made-up data.
        </section>
      </>
    );

  const supabase = await createClient();
  const reads = playReads(supabase, workspace.id);
  const mail = mailReads(supabase, workspace.id);
  const leadKind = LEAD_PLAY[slug];
  const audience = EVENT_AUDIENCE[slug];
  const campaignKinds = leadKind
    ? [leadKind]
    : audience
      ? ["event"]
      : slug === "speed-to-lead"
        ? ["speed_to_lead"]
        : [];
  const [
    counts,
    boxes,
    sending,
    campaignsAll,
    toWrite,
    widgets,
    speed,
    keys,
    sequences,
  ] = await Promise.all([
    reads.counts(),
    mail.mailboxes(),
    mail.settings(),
    campaignKinds.length ? reads.campaigns(campaignKinds) : [],
    reads.toWrite(),
    slug === "speed-to-lead" ? repo.chatWidgets() : [],
    slug === "speed-to-lead" ? reads.speedSettings() : null,
    slug === "plg-conversion" ? reads.apiKeys() : [],
    leadKind || audience ? listSequences(supabase, workspace.id) : [],
  ]);
  const campaigns = audience
    ? campaignsAll.filter((c) => c.settings.audience === audience)
    : campaignsAll;
  const targets = await reads.targets(campaigns.map((c) => c.id));
  const sizes = new Map<string, number>();
  for (const t of targets)
    sizes.set(t.campaign_id, (sizes.get(t.campaign_id) ?? 0) + 1);
  const c = sumCounts(counts, play.kinds);
  const mailboxOk =
    boxes.some((b) => b.status === "active") && sending.sending_on;

  // How many leads it would pick right now, with the default days.
  let preview_count: number | null = null;
  if (leadKind && on) {
    const s = createPlayStore();
    preview_count =
      (
        await s
          ?.preview(
            workspace.id,
            user.id,
            leadKind,
            PLAY_DEFAULT_DAYS[leadKind],
          )
          .catch(() => null)
      )?.count ?? null;
  }

  const takeouts =
    slug === "competitive-takeout" ? await reads.takeoutSearches() : [];

  // The chat's booking links: how often offered, opened and used.
  let bookings: { offered: number; opened: number; booked: number } | null =
    null;
  if (slug === "automated-meeting-scheduling") {
    const { data } = await supabase
      .from("booking_links")
      .select("opened_at, booked_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(1000);
    const list = (data ?? []) as {
      opened_at: string | null;
      booked_at: string | null;
    }[];
    bookings = {
      offered: list.length,
      opened: list.filter((b) => b.opened_at).length,
      booked: list.filter((b) => b.booked_at).length,
    };
  }

  return (
    <>
      {head}
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-3">
          {!on && play.kinds.length > 0 && (
            <p
              role="status"
              className="rounded-xl border border-black/15 bg-white px-4 py-2.5 text-[13px] leading-[1.5]"
            >
              Writing emails isn&apos;t switched on yet on Dialvo&apos;s side,
              so nothing can be started or written here yet. The numbers below
              are real.
            </p>
          )}
          {play.kinds.length > 0 && (
            <section aria-label="Numbers">
              <CountStrip counts={c} />
            </section>
          )}

          {leadKind && (
            <section className={panel}>
              <h2 className={panelHead}>Start</h2>
              <ActionForm action={startLeadPlay} className="space-y-3 p-4">
                <input type="hidden" name="kind" value={leadKind} />
                {leadKind !== "expansion" && (
                  <label className={labelCls}>
                    {DAYS_LABEL[leadKind]}
                    <input
                      name="days"
                      type="number"
                      min={PLAY_DAYS_MIN}
                      max={PLAY_DAYS_MAX}
                      required
                      defaultValue={PLAY_DEFAULT_DAYS[leadKind]}
                      className={cn(input, "mt-1 block max-w-[140px]")}
                    />
                  </label>
                )}
                <SequenceFields
                  sequences={sequences}
                  single={leadKind === "expansion"}
                  purpose={
                    leadKind === "onboarding" || leadKind === "nurture"
                      ? {
                          key: leadKind,
                          label: `The ${PURPOSE_SEQUENCES[leadKind].name.toLowerCase()} steps: ${(sequences.find((q) => q.purpose === leadKind)?.steps ?? PURPOSE_SEQUENCES[leadKind].steps).length} follow-ups (edit them in Sequences)`,
                        }
                      : null
                  }
                />
                <p className="text-[13px] text-[#0B0B0C]/70">
                  {preview_count === null
                    ? "Starting it picks the leads that fit right now."
                    : preview_count === 0
                      ? `No lead fits right now with ${PLAY_DEFAULT_DAYS[leadKind]} days.`
                      : `${preview_count} ${preview_count === 1 ? "lead fits" : "leads fit"} right now with ${PLAY_DEFAULT_DAYS[leadKind]} days${preview_count >= PLAY_MAX_LEADS_PER_START ? ` (the most one start takes is ${PLAY_MAX_LEADS_PER_START})` : ""}.`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <SubmitButton disabled={!on} pendingText="Starting…">
                    Start for these leads
                  </SubmitButton>
                  <span className={hint}>
                    Nothing is sent: each email waits for your approval.
                  </span>
                </div>
              </ActionForm>
            </section>
          )}

          {audience && (
            <section className={panel}>
              <h2 className={panelHead}>Upload your list</h2>
              <ActionForm
                action={importEvent}
                resetOnSuccess
                className="space-y-3 p-4"
              >
                <input type="hidden" name="play" value={slug} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={labelCls}>
                    Event name
                    <input
                      name="event"
                      required
                      maxLength={120}
                      placeholder="Spring product webinar"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    Date{" "}
                    <span className="font-normal text-[#0B0B0C]/45">
                      (optional)
                    </span>
                    <input
                      name="date"
                      maxLength={40}
                      placeholder="12 March, 4pm UK time"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                </div>
                <label className={labelCls}>
                  {slug === "event-registration"
                    ? "Link to join"
                    : "Link to the replay or slides"}{" "}
                  <span className="font-normal text-[#0B0B0C]/45">
                    (optional)
                  </span>
                  <input
                    name="link"
                    inputMode="url"
                    maxLength={500}
                    placeholder="https://"
                    className={cn(input, "mt-1")}
                  />
                </label>
                <label className={labelCls}>
                  CSV file
                  <input
                    name="file"
                    type="file"
                    required
                    accept=".csv,text/csv"
                    className="mt-1 block w-full text-[13px] file:mr-3 file:rounded-full file:border file:border-black/15 file:bg-white file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium"
                  />
                  <span className={cn(hint, "mt-1.5 block font-normal")}>
                    A header row with an email column, and name and company if
                    you have them
                    {slug !== "event-registration" &&
                      ", plus an attended column (yes or no)"}
                    . Up to {EVENT_LIST_MAX_ROWS.toLocaleString("en")} people.
                    New people become leads; anyone marked do not contact or on
                    your never-contact list is left out.
                  </span>
                </label>
                <SequenceFields sequences={sequences} single />
                <SubmitButton disabled={!on} pendingText="Reading the list…">
                  Use this list
                </SubmitButton>
              </ActionForm>
            </section>
          )}

          {slug === "speed-to-lead" && speed && (
            <section className={panel}>
              <h2 className={panelHead}>Settings</h2>
              <ActionForm action={saveSpeedToLead} className="space-y-3 p-4">
                <fieldset disabled={!admin} className="space-y-3">
                  <label className="flex items-start gap-2.5 text-[13px] leading-[1.45]">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={speed.enabled}
                      className="mt-0.5 size-4 accent-[#0B0B0C]"
                    />
                    <span>
                      Reply by email to new form and chat leads
                      <span className="mt-0.5 block text-[12px] text-[#0B0B0C]/55">
                        Only people who left an email address, from the moment
                        this is on. Never anyone you have already emailed,
                        marked do not contact, or on your never-contact list.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 text-[13px] leading-[1.45]">
                    <input
                      type="checkbox"
                      name="auto_send"
                      defaultChecked={speed.auto_send}
                      className="mt-0.5 size-4 accent-[#0B0B0C]"
                    />
                    <span>
                      Send without waiting for my approval
                      <span className="mt-0.5 block text-[12px] text-[#0B0B0C]/55">
                        Off by default: each reply waits for you in Find leads,
                        Emails. On, a reply goes in the next sending slot,
                        inside your sending hours and daily limits.
                      </span>
                    </span>
                  </label>
                </fieldset>
                {admin ? (
                  <SubmitButton>Save</SubmitButton>
                ) : (
                  <p className={hint}>
                    Only the workspace&apos;s owner or an admin can change this.
                  </p>
                )}
              </ActionForm>
              <p className="border-t border-black/[0.06] px-4 py-2.5 text-[12.5px] text-[#0B0B0C]/60">
                {speed.enabled
                  ? `Switched on ${agoWords(speed.enabled_at ?? new Date().toISOString())}. New leads are picked up within a minute while a mailbox is connected.`
                  : "Off. The website chat still answers visitors as they write."}
              </p>
            </section>
          )}

          {slug === "automated-meeting-scheduling" && (
            <section className={panel}>
              <h2 className={panelHead}>Your booking link</h2>
              <div className="space-y-3 p-4 text-[13px] leading-[1.5]">
                {sending.booking_url ? (
                  <p>
                    Offered in email replies and in the website chat:{" "}
                    <span className="font-medium break-all">
                      {sending.booking_url}
                    </span>
                  </p>
                ) : (
                  <p>
                    No booking link yet. Until there is one, replies ask which
                    days and times suit them, and the chat hands the visitor to
                    your team.
                  </p>
                )}
                {bookings && (
                  <p className="tabular-nums">
                    In the website chat: offered {bookings.offered}{" "}
                    {bookings.offered === 1 ? "time" : "times"}, opened{" "}
                    {bookings.opened}, booked {bookings.booked}.
                  </p>
                )}
                <p className={hint}>
                  To record bookings made from the chat, set your scheduling
                  page&apos;s &ldquo;redirect after booking&rdquo; to{" "}
                  <span className="font-medium break-all text-[#0B0B0C]/75">
                    https://trydialvo.com/api/book/done
                  </span>
                  . The lead is then marked meeting booked, with the meeting and
                  its time when your scheduling page passes it, and your team is
                  told.
                </p>
                <GoLink href="/app/settings/mailboxes#follow-ups" primary>
                  {sending.booking_url
                    ? "Change the booking link"
                    : "Add a booking link"}
                </GoLink>
              </div>
            </section>
          )}

          {slug === "outbound-lead-generation" && (
            <section className={panel}>
              <h2 className={panelHead}>Start</h2>
              <div className="flex flex-wrap gap-2 p-4">
                <GoLink href="/app/prospects?search=new" primary>
                  Describe who you sell to
                </GoLink>
                <GoLink href="/app/prospects/accounts">
                  Use a list of target accounts
                </GoLink>
                <GoLink href="/app/prospects/lookalike">
                  Find companies like your best customers
                </GoLink>
                <GoLink href="/app/prospects/signals">Buying signals</GoLink>
              </div>
            </section>
          )}

          {slug === "competitive-takeout" && (
            <>
              <section className={panel}>
                <h2 className={panelHead}>Start</h2>
                <ActionForm action={startTakeout} className="space-y-3 p-4">
                  <label className={labelCls}>
                    The competitor&apos;s product
                    <input
                      name="competitor"
                      required
                      maxLength={80}
                      placeholder="For example: the product your buyers use today"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <label className={labelCls}>
                    Who you sell to{" "}
                    <span className="font-normal text-[#0B0B0C]/45">
                      (optional)
                    </span>
                    <textarea
                      name="who"
                      rows={2}
                      maxLength={1500}
                      placeholder="Independent clinics with 5 to 50 staff"
                      className={cn(input, "mt-1")}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={labelCls}>
                      Where{" "}
                      <span className="font-normal text-[#0B0B0C]/45">
                        (optional)
                      </span>
                      <input
                        name="location"
                        maxLength={200}
                        className={cn(input, "mt-1")}
                      />
                    </label>
                    <label className={labelCls}>
                      Size{" "}
                      <span className="font-normal text-[#0B0B0C]/45">
                        (optional)
                      </span>
                      <input
                        name="company_size"
                        maxLength={200}
                        className={cn(input, "mt-1")}
                      />
                    </label>
                  </div>
                  <SubmitButton disabled={!on || !contactOn}>
                    Search for their users
                  </SubmitButton>
                  <p className={hint}>
                    {contactOn
                      ? "Opens Find leads with this search. Run it, keep the companies that fit, then come back here to check which use the product."
                      : "Needs the contact database, which isn't switched on yet on Dialvo's side."}
                  </p>
                </ActionForm>
              </section>
              {takeouts.length > 0 && (
                <section className={panel}>
                  <h2 className={panelHead}>Your takeout searches</h2>
                  <ul className="divide-y divide-black/[0.06]">
                    {takeouts.map((t) => (
                      <li
                        key={t.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[13px]"
                      >
                        <Link
                          href={`/app/prospects?search=${t.id}`}
                          className="min-w-0 flex-1 font-medium underline decoration-black/25 underline-offset-2"
                        >
                          {t.name}
                        </Link>
                        <ActionForm action={checkTakeout}>
                          <input type="hidden" name="search" value={t.id} />
                          <SubmitButton
                            variant="secondary"
                            small
                            disabled={!contactOn}
                            pendingText="Checking…"
                          >
                            Check kept companies for {t.competitor}
                          </SubmitButton>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-black/[0.06] px-4 py-2.5 text-[12px] text-[#0B0B0C]/55">
                    Each check is one contact-database credit when the product
                    is found, none when it isn&apos;t. Only a confirmed
                    company&apos;s email mentions it.
                  </p>
                </section>
              )}
            </>
          )}

          {slug === "plg-conversion" && (
            <section className={panel}>
              <h2 className={panelHead}>Send events from your app</h2>
              <div className="space-y-3 p-4 text-[13px] leading-[1.5]">
                <p>
                  {keys.some((k) => !k.revoked_at)
                    ? "You have an API key. Events land on the lead with the same email."
                    : "Make an API key first, then send events from your app's server."}
                </p>
                <pre className="overflow-x-auto rounded-xl bg-black/[0.04] p-3 text-[12px] leading-[1.5]">
                  {`curl -X POST https://trydialvo.com/api/v1/events \\
  -H "Authorization: Bearer $DIALVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"dana@example.com","event":"limit_reached","properties":{"limit":"projects"}}'`}
                </pre>
                <p className={hint}>
                  Events: trial_started, limit_reached, teammate_invited,
                  trial_ending (with properties.ends_at as a date),
                  trial_converted. Up to {API_EVENTS_PER_MINUTE} a minute per
                  key. Only someone already in your leads is matched.
                </p>
                <GoLink href="/app/settings/api" primary>
                  {keys.some((k) => !k.revoked_at)
                    ? "Manage API keys"
                    : "Make an API key"}
                </GoLink>
              </div>
            </section>
          )}

          {play.kinds.length > 0 && (
            <section className={panel}>
              <h2 className={panelHead}>Write and approve</h2>
              <div className="space-y-3 p-4">
                <p className="max-w-[620px] text-[13px] leading-[1.5] text-[#0B0B0C]/70">
                  Emails are written from your Knowledge and your instructions,
                  then wait in Find leads, Emails, where you read, edit, approve
                  or discard each one. Approved emails are sent inside your
                  sending hours and limits, with your unsubscribe link and
                  sender details.
                </p>
                {slug !== "speed-to-lead" && (
                  <DraftWriter waiting={toWrite} disabled={!on} noun="email" />
                )}
                <div className="flex flex-wrap gap-2">
                  <GoLink href="/app/prospects?view=emails">
                    Open the approval queue
                    {c.waiting > 0 ? ` (${c.waiting} waiting)` : ""}
                  </GoLink>
                </div>
              </div>
            </section>
          )}

          <CampaignList campaigns={campaigns} sizes={sizes} />
        </div>

        <aside className="min-w-0 space-y-3">
          <section className={panel}>
            <h2 className={panelHead}>Who it writes to</h2>
            <p className="p-4 text-[13px] leading-[1.5] text-[#0B0B0C]/75">
              {play.who}
            </p>
          </section>
          <section className={panel}>
            <h2 className={panelHead}>What it needs</h2>
            <ul className="space-y-1.5 p-4 text-[13px] leading-[1.45]">
              {play.needs.map((n) => (
                <Need
                  key={n}
                  ok={
                    /mailbox/i.test(n)
                      ? mailboxOk
                      : /chat/i.test(n) && slug === "speed-to-lead"
                        ? widgets.length > 0
                        : /contact database|Findymail/i.test(n)
                          ? contactOn
                          : /booking link/i.test(n)
                            ? Boolean(sending.booking_url)
                            : /API key/i.test(n)
                              ? keys.some((k) => !k.revoked_at)
                              : null
                  }
                >
                  {n}
                </Need>
              ))}
            </ul>
            {!mailboxOk && (
              <p className="border-t border-black/[0.06] px-4 py-2.5 text-[12px] text-[#0B0B0C]/55">
                <Link
                  href="/app/settings/mailboxes"
                  className="underline decoration-black/25 underline-offset-2"
                >
                  Connect a mailbox and switch sending on
                </Link>{" "}
                to send. Emails can be written and approved before that.
              </p>
            )}
          </section>
          {play.note && (
            <section className={panel}>
              <h2 className={panelHead}>
                What works today
                <StatusPill status={play.status} />
              </h2>
              <p className="p-4 text-[13px] leading-[1.5] text-[#0B0B0C]/75">
                {play.note}
              </p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

async function Page({ params }: PageProps<"/app/plays/[slug]">) {
  const { slug } = await params;
  if (!isPlaySlug(slug)) notFound();
  return <Content slug={slug} />;
}

export default function PlayPage(props: PageProps<"/app/plays/[slug]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Page {...props} />
    </Suspense>
  );
}
