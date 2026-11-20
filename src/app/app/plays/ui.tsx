import Link from "next/link";
import { ArrowRight, Hammer } from "lucide-react";
import { STATUS_LABEL, type Status } from "@/lib/plays/catalog";
import { NO_COUNTS, type Counts } from "@/lib/plays/read";
import { cn } from "@/lib/utils";
import { Badge, btn, panel, panelHead } from "../_ui/kit";

// The few pieces the Plays, Features, Calls and "being built" pages share.

export function StatusPill({ status }: { status: Status }) {
  return (
    <Badge
      tone={
        status === "live" ? "ink" : status === "partly" ? "blue" : "outline"
      }
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Adds up the counts of a play's draft kinds. */
export function sumCounts(
  all: Record<string, Counts>,
  kinds: string[],
): Counts {
  const out = { ...NO_COUNTS };
  for (const k of kinds) {
    const c = all[k];
    if (!c) continue;
    for (const key of Object.keys(out) as (keyof Counts)[])
      out[key] += Number(c[key] ?? 0);
  }
  return out;
}

const COUNT_LABELS: [keyof Counts, string][] = [
  ["targeted", "People picked"],
  ["drafted", "Emails written"],
  ["approved", "Approved, not sent yet"],
  ["sent", "Sent"],
  ["replied", "Replied"],
  ["meetings", "Meetings"],
];

/** A play's real numbers. Zeros are shown as they are. */
export function CountStrip({ counts }: { counts: Counts }) {
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-black/[0.07] bg-black/[0.07] sm:grid-cols-6">
      {COUNT_LABELS.map(([key, label]) => (
        <div key={key} className="bg-white px-3 py-2.5">
          <dt className="text-[11.5px] leading-tight text-[#0B0B0C]/50">
            {label}
          </dt>
          <dd className="mt-0.5 text-[17px] font-medium tabular-nums">
            {counts[key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A page for something that isn't built: what it will do, and what it needs. */
export function BeingBuilt({
  title,
  what,
  needs,
  more,
}: {
  title: string;
  what: string;
  needs: string[];
  more?: React.ReactNode;
}) {
  return (
    <section className={panel}>
      <h2 className={panelHead}>
        <span className="flex items-center gap-2">
          <Hammer aria-hidden className="size-4 text-[#0B0B0C]/55" />
          {title}
        </span>
        <StatusPill status="building" />
      </h2>
      <div className="space-y-4 p-4 text-[13.5px] leading-[1.55]">
        <p className="max-w-[640px]">{what}</p>
        {needs.length > 0 && (
          <div>
            <p className="text-[12.5px] font-medium text-[#0B0B0C]/75">
              What it needs before it can work
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[#0B0B0C]/70">
              {needs.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[12.5px] text-[#0B0B0C]/55">
          Nothing on this page is running yet, and no data is shown for it. It
          will appear here as soon as it works.
        </p>
        {more}
      </div>
    </section>
  );
}

export function GoLink({
  href,
  children,
  primary,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(primary ? btn.primary : btn.secondary, btn.small)}
    >
      {children}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}
