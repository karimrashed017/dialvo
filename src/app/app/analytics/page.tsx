import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BarChart3 } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { playReads, type Analytics } from "@/lib/plays/read";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { Empty, PageHead, PageSkeleton, panel, panelHead } from "../_ui/kit";

export const metadata: Metadata = { title: "Analytics" };

// Only what the database holds (public.analytics_summary, as the signed-in
// person). Nothing estimated, nothing made up: a number that is zero shows
// as zero, and a chart with nothing in it says so instead of drawing.
//
// Charts follow the dataviz method: single series each (so no legend box;
// the title names it), ink columns at most 24px wide with a 4px rounded top,
// a hairline baseline, the value on hover and keyboard focus, and the same
// numbers in a table underneath.

const RANGES = [7, 30, 90] as const;

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

const pct = (n: number, of: number) =>
  of > 0 ? `${((n / of) * 100).toFixed(n / of < 0.1 ? 1 : 0)}%` : "–";

const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string;
  note?: string;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-[12px] text-[#0B0B0C]/55">{label}</dt>
      <dd className="mt-1 text-[22px] font-semibold tracking-[-0.01em] tabular-nums">
        {typeof value === "number" ? value.toLocaleString("en") : value}
      </dd>
      {note && <p className="text-[11.5px] text-[#0B0B0C]/45">{note}</p>}
    </div>
  );
}

/** Columns per day for one measure. */
function DailyColumns({
  title,
  daily,
  field,
}: {
  title: string;
  daily: Analytics["daily"];
  field: "sent" | "replies";
}) {
  const max = Math.max(0, ...daily.map((d) => d[field]));
  const total = daily.reduce((s, d) => s + d[field], 0);
  // A clean top for the scale: 1, 2, 5 × 10^n.
  const top =
    max <= 0
      ? 1
      : (() => {
          const p = 10 ** Math.floor(Math.log10(max));
          return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= max)!;
        })();
  return (
    <section className={panel} aria-label={title}>
      <h2 className={panelHead}>
        {title}
        <span className="text-[12px] font-normal text-[#0B0B0C]/55 tabular-nums">
          {total.toLocaleString("en")} in all
        </span>
      </h2>
      {total === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-[#0B0B0C]/50">
          None in this period.
        </p>
      ) : (
        <div className="px-4 pt-4 pb-3">
          <div className="flex gap-2">
            <div
              aria-hidden
              className="flex h-[140px] flex-col justify-between text-right text-[11px] text-[#0B0B0C]/45 tabular-nums"
            >
              <span>{top}</span>
              <span>0</span>
            </div>
            <ul className="relative flex h-[140px] flex-1 items-end gap-[2px] border-b border-black/10">
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 border-t border-black/[0.06]"
              />
              {daily.map((d) => {
                const v = d[field];
                return (
                  <li
                    key={d.day}
                    tabIndex={0}
                    aria-label={`${fmtDay(d.day)}: ${v}`}
                    className="group relative flex h-full flex-1 items-end justify-center outline-none"
                  >
                    {v > 0 && (
                      <span
                        className="block w-full max-w-[24px] rounded-t-[4px] bg-[#0B0B0C] group-hover:bg-[#0B0B0C]/75 group-focus-visible:bg-[#0B0B0C]/75"
                        style={{ height: `${(v / top) * 100}%` }}
                      />
                    )}
                    <span className="pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-md bg-[#0B0B0C] px-2 py-1 text-[11.5px] whitespace-nowrap text-white group-hover:block group-focus-visible:block">
                      <strong className="font-semibold tabular-nums">
                        {v}
                      </strong>{" "}
                      <span className="text-white/70">{fmtDay(d.day)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="mt-1.5 flex justify-between pl-6 text-[11px] text-[#0B0B0C]/45">
            <span>{fmtDay(daily[0].day)}</span>
            <span>{fmtDay(daily[daily.length - 1].day)}</span>
          </div>
        </div>
      )}
    </section>
  );
}

async function Content({ days }: { days: number }) {
  const { workspace, preview } = await getAppContext();
  const head = (
    <PageHead
      title="Analytics"
      note="What happened in this workspace, from its own records. Nothing here is estimated."
    >
      <nav
        aria-label="Period"
        className="flex gap-1 rounded-full bg-black/[0.05] p-0.5"
      >
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/app/analytics?days=${r}`}
            aria-current={r === days ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-[12.5px] tabular-nums",
              r === days
                ? "bg-white font-medium shadow-sm"
                : "text-[#0B0B0C]/60",
            )}
          >
            {r} days
          </Link>
        ))}
      </nav>
    </PageHead>
  );
  if (preview)
    return (
      <>
        {head}
        <section className={panel}>
          <Empty icon={BarChart3} title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const a = await playReads(supabase, workspace.id).analytics(days);
  const t = a.totals;
  const sources = a.by_source.map((s) => ({
    ...s,
    label: s.play
      ? (PLAY_LABEL[s.play] ?? s.play)
      : s.search_id
        ? `Find leads: ${s.search_name ?? "a search"}`
        : "Other first emails",
  }));

  return (
    <>
      {head}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-black/[0.07] bg-black/[0.07] sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Leads found" value={t.leads_found} />
        <Tile
          label="Emails sent"
          value={t.emails_sent}
          note={`${t.first_emails_sent} first emails`}
        />
        <Tile label="Replies" value={t.replies} />
        <Tile
          label="Positive replies"
          value={t.positive_replies}
          note="Interested or a question"
        />
        <Tile label="Meetings booked" value={t.meetings_booked} />
        <Tile label="Chats" value={t.chats} />
        <Tile label="Chats answered" value={t.chats_answered} />
        <Tile
          label="Qualified leads"
          value={t.qualified_leads}
          note="Moved to qualified or further"
        />
        <Tile
          label="Reply rate"
          value={pct(t.replies, t.first_emails_sent)}
          note="Replies per first email"
        />
        <Tile
          label="Positive reply rate"
          value={pct(t.positive_replies, t.first_emails_sent)}
          note="Per first email"
        />
      </dl>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <DailyColumns
          title="Emails sent per day"
          daily={a.daily}
          field="sent"
        />
        <DailyColumns title="Replies per day" daily={a.daily} field="replies" />
      </div>

      <section className={cn(panel, "mt-3")}>
        <h2 className={panelHead}>By play and search</h2>
        {sources.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-[#0B0B0C]/50">
            No first email was sent in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px] tabular-nums">
              <thead className="text-[11.5px] text-[#0B0B0C]/50">
                <tr className="border-b border-black/[0.06]">
                  <th className="px-4 py-2 font-medium">From</th>
                  <th className="px-2 py-2 text-right font-medium">
                    First emails
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Replied</th>
                  <th className="px-2 py-2 text-right font-medium">Positive</th>
                  <th className="px-4 py-2 text-right font-medium">Meetings</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr
                    key={`${s.play}-${s.search_id}`}
                    className="border-b border-black/[0.04] last:border-0"
                  >
                    <td className="px-4 py-2.5 font-medium">{s.label}</td>
                    <td className="px-2 py-2.5 text-right">{s.sent}</td>
                    <td className="px-2 py-2.5 text-right">
                      {s.replied}{" "}
                      <span className="text-[#0B0B0C]/45">
                        {pct(s.replied, s.sent)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right">{s.positive}</td>
                    <td className="px-4 py-2.5 text-right">{s.meetings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={cn(panel, "mt-3")}>
        <h2 className={panelHead}>Mailbox health</h2>
        {a.by_mailbox.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-[#0B0B0C]/50">
            No mailbox is connected.{" "}
            <Link
              href="/app/settings/mailboxes"
              className="underline underline-offset-2"
            >
              Connect one
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px] tabular-nums">
              <thead className="text-[11.5px] text-[#0B0B0C]/50">
                <tr className="border-b border-black/[0.06]">
                  <th className="px-4 py-2 font-medium">Mailbox</th>
                  <th className="px-2 py-2 text-right font-medium">Sent</th>
                  <th className="px-2 py-2 text-right font-medium">Replies</th>
                  <th className="px-2 py-2 text-right font-medium">
                    Bounce rate
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Unsubscribe rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {a.by_mailbox.map((m) => (
                  <tr
                    key={m.mailbox_id}
                    className="border-b border-black/[0.04] last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{m.email}</span>
                      {m.status !== "active" && (
                        <span className="ml-2 text-[11.5px] text-[#0B0B0C]/50">
                          {m.status}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">{m.sent}</td>
                    <td className="px-2 py-2.5 text-right">{m.replies}</td>
                    <td className="px-2 py-2.5 text-right">
                      {pct(m.bounces, m.sent)}{" "}
                      <span className="text-[#0B0B0C]/45">({m.bounces})</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {pct(m.unsubscribes, m.sent)}{" "}
                      <span className="text-[#0B0B0C]/45">
                        ({m.unsubscribes})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-black/[0.06] px-4 py-2.5 text-[12px] text-[#0B0B0C]/50">
          A bounce rate above about 2% or an unsubscribe rate above about 1% is
          worth a look: check the list it came from and the mailbox&apos;s
          setup.
        </p>
      </section>

      <details className={cn(panel, "mt-3")}>
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium">
          Daily numbers as a table
        </summary>
        <div className="max-h-[320px] overflow-y-auto border-t border-black/[0.06]">
          <table className="w-full text-left text-[12.5px] tabular-nums">
            <thead className="sticky top-0 bg-white text-[11.5px] text-[#0B0B0C]/50">
              <tr>
                <th className="px-4 py-2 font-medium">Day</th>
                <th className="px-2 py-2 text-right font-medium">
                  Emails sent
                </th>
                <th className="px-4 py-2 text-right font-medium">Replies</th>
              </tr>
            </thead>
            <tbody>
              {[...a.daily].reverse().map((d) => (
                <tr key={d.day} className="border-t border-black/[0.04]">
                  <td className="px-4 py-1.5">{fmtDay(d.day)}</td>
                  <td className="px-2 py-1.5 text-right">{d.sent}</td>
                  <td className="px-4 py-1.5 text-right">{d.replies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

async function Page({ searchParams }: PageProps<"/app/analytics">) {
  const params = await searchParams;
  const n = Number(params.days);
  const days = (RANGES as readonly number[]).includes(n) ? n : 30;
  return <Content days={days} />;
}

export default function AnalyticsPage(props: PageProps<"/app/analytics">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Page {...props} />
    </Suspense>
  );
}
