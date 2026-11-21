import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { dateTime } from "@/lib/app/time";
import { isUuid } from "@/lib/leads/fields";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  Badge,
  btn,
  Empty,
  hint,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../_ui/kit";
import {
  CALL_OUTCOME,
  CALL_STATUS,
  CallsTabs,
  daysAgo,
  duration,
  SetupNotice,
} from "./ui";

export const metadata: Metadata = { title: "Calls" };

// Every call the agent answered or made, newest first, with its outcome;
// one call's transcript, summary and recording beside the list.

type Call = {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  outcome: string | null;
  started_at: string | null;
  created_at: string;
  duration_seconds: number | null;
  from_number: string | null;
  to_number: string | null;
  summary: string | null;
  transcript: { t: number; speaker: "agent" | "lead"; text: string }[];
  recording_sid: string | null;
  disclosed_at: string | null;
  conversation_id: string | null;
  lead: {
    id: string;
    name: string;
    phone: string | null;
    company: string | null;
  } | null;
};

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/app/calls">["searchParams"];
}) {
  const { workspace, preview } = await getAppContext();
  const params = await searchParams;
  const head = (
    <PageHead
      title="Calls"
      note="Calls your AI phone agent answered and made, with what was said and what came of it. Every call starts by telling the person it is transcribed."
    />
  );
  if (preview)
    return (
      <>
        {head}
        <CallsTabs current="calls" />
        <section className={panel}>
          <Empty title="Not part of the design preview" />
        </section>
      </>
    );
  const supabase = await createClient();
  const since = daysAgo(7).toISOString();
  const [list, week] = await Promise.all([
    supabase
      .from("calls")
      .select(
        "id, direction, status, outcome, started_at, created_at, duration_seconds, from_number, to_number, summary, transcript, recording_sid, disclosed_at, conversation_id, lead:leads(id, name, phone, company)",
      )
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("calls")
      .select("direction, status, outcome, duration_seconds")
      .eq("workspace_id", workspace.id)
      .gte("created_at", since)
      .limit(5000),
  ]);
  if (list.error) throw new Error(list.error.message);
  const calls = (list.data ?? []) as unknown as Call[];
  const recent = (week.data ?? []) as Pick<
    Call,
    "direction" | "status" | "outcome" | "duration_seconds"
  >[];
  const picked = isUuid(params.call)
    ? calls.find((c) => c.id === params.call)
    : calls[0];
  const tz = workspace.timezone;
  const stats = [
    ["Incoming", recent.filter((c) => c.direction === "inbound").length],
    ["Outbound", recent.filter((c) => c.direction === "outbound").length],
    ["Answered", recent.filter((c) => c.status === "completed").length],
    ["Qualified", recent.filter((c) => c.outcome === "qualified").length],
    ["Transferred", recent.filter((c) => c.outcome === "transferred").length],
    ["Missed", recent.filter((c) => c.status === "missed").length],
  ] as const;

  return (
    <>
      {head}
      <CallsTabs current="calls" />
      <SetupNotice />
      <dl className="mb-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-black/[0.07] bg-black/[0.07] sm:grid-cols-6">
        {stats.map(([label, n]) => (
          <div key={label} className="bg-white px-3 py-2.5">
            <dt className="text-[11.5px] leading-tight text-[#0B0B0C]/50">
              {label}, 7 days
            </dt>
            <dd className="mt-0.5 text-[17px] font-medium tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      {calls.length === 0 ? (
        <section className={panel}>
          <Empty icon={PhoneIncoming} title="No calls yet">
            Calls show here once a number is set up and someone calls it, or an
            approved batch starts calling.
          </Empty>
          <div className="flex justify-center gap-2 pb-8">
            <Link
              href="/app/calls/numbers"
              className={cn(btn.secondary, btn.small)}
            >
              Numbers
            </Link>
            <Link
              href="/app/calls/settings"
              className={cn(btn.secondary, btn.small)}
            >
              Agent settings
            </Link>
          </div>
        </section>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section className={panel}>
            <h2 className={panelHead}>Latest calls</h2>
            <ul className="divide-y divide-black/[0.06]">
              {calls.map((c) => {
                const Icon =
                  c.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
                const who =
                  c.lead?.name ||
                  c.lead?.phone ||
                  (c.direction === "inbound" ? c.from_number : c.to_number) ||
                  "Unknown";
                return (
                  <li key={c.id}>
                    <Link
                      href={`/app/calls?call=${c.id}`}
                      aria-current={picked?.id === c.id ? "true" : undefined}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.03]",
                        picked?.id === c.id && "bg-black/[0.045]",
                      )}
                    >
                      <Icon
                        aria-hidden
                        className="size-4 shrink-0 text-[#0B0B0C]/55"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {who}
                        </span>
                        <span className="block truncate text-[12px] text-[#0B0B0C]/50">
                          {dateTime(c.started_at ?? c.created_at, tz)}
                          {c.duration_seconds
                            ? ` · ${duration(c.duration_seconds)}`
                            : ""}
                        </span>
                      </span>
                      <Badge
                        tone={c.status === "completed" ? "plain" : "outline"}
                      >
                        {CALL_OUTCOME[c.outcome ?? ""] ??
                          CALL_STATUS[c.status] ??
                          c.status}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
          {picked && <CallDetail call={picked} tz={tz} />}
        </div>
      )}
    </>
  );
}

function CallDetail({ call, tz }: { call: Call; tz: string }) {
  return (
    <section className={panel} aria-label="Call">
      <h2 className={panelHead}>
        <span>
          {call.direction === "inbound" ? "Incoming call" : "Outbound call"}
          {call.lead?.name ? ` · ${call.lead.name}` : ""}
        </span>
        <Badge>{CALL_STATUS[call.status] ?? call.status}</Badge>
      </h2>
      <div className="space-y-4 p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
          <div>
            <dt className="text-[#0B0B0C]/50">When</dt>
            <dd>{dateTime(call.started_at ?? call.created_at, tz)}</dd>
          </div>
          <div>
            <dt className="text-[#0B0B0C]/50">Length</dt>
            <dd>{duration(call.duration_seconds) || "Not ended yet"}</dd>
          </div>
          <div>
            <dt className="text-[#0B0B0C]/50">From</dt>
            <dd>{call.from_number ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-[#0B0B0C]/50">To</dt>
            <dd>{call.to_number ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-[#0B0B0C]/50">Outcome</dt>
            <dd>{CALL_OUTCOME[call.outcome ?? ""] ?? "None yet"}</dd>
          </div>
          <div>
            <dt className="text-[#0B0B0C]/50">Told it was transcribed</dt>
            <dd>
              {call.disclosed_at
                ? dateTime(call.disclosed_at, tz)
                : "No agent spoke on this call"}
            </dd>
          </div>
        </dl>
        {call.summary && (
          <div>
            <h3 className="text-[12.5px] font-medium">Summary</h3>
            <p className="mt-1 text-[13px] leading-[1.5] text-[#0B0B0C]/75">
              {call.summary}
            </p>
          </div>
        )}
        {call.recording_sid && (
          <div>
            <h3 className="text-[12.5px] font-medium">Recording</h3>
            <audio
              controls
              preload="none"
              className="mt-1 w-full"
              src={`/app/calls/${call.id}/recording`}
            />
          </div>
        )}
        <div>
          <h3 className="text-[12.5px] font-medium">Transcript</h3>
          {call.transcript.length === 0 ? (
            <p className={cn(hint, "mt-1")}>
              Nothing was said to the agent on this call.
            </p>
          ) : (
            <ol className="mt-2 space-y-2">
              {call.transcript.map((t, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-[1.5]">
                  <span className="w-12 shrink-0 text-[11.5px] text-[#0B0B0C]/45 tabular-nums">
                    {duration(t.t) || "0s"}
                  </span>
                  <span>
                    <span className="font-medium">
                      {t.speaker === "agent"
                        ? "Agent"
                        : call.lead?.name || "Caller"}
                      :{" "}
                    </span>
                    {t.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {call.lead && (
            <Link
              href={`/app/leads/${call.lead.id}`}
              className={cn(btn.secondary, btn.small)}
            >
              Open the lead
            </Link>
          )}
          {call.conversation_id && (
            <Link
              href={`/app/inbox?c=${call.conversation_id}`}
              className={cn(btn.ghost, btn.small)}
            >
              In the Inbox
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

export default function CallsPage({ searchParams }: PageProps<"/app/calls">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
