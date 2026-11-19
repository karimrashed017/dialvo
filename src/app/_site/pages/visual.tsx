import {
  BarChart3,
  Code2,
  FileSearch,
  LayoutList,
  ListTree,
  Mail,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";
import type { Row, Visual } from "@/lib/content";
import { cn } from "@/lib/utils";

// The sample product panels on the play, platform and motion pages, in the
// same white-card style as the channel panels on the home page. They are
// drawn from data in src/lib/content; every person and business in them is
// made up, and each panel is marked "Example".

const ICONS: Record<Visual["kind"], LucideIcon> = {
  thread: MessageSquareText,
  email: Mail,
  list: LayoutList,
  timeline: ListTree,
  brief: FileSearch,
  metrics: BarChart3,
  code: Code2,
};

export const panel =
  "overflow-hidden rounded-[20px] border border-black/[0.07] bg-white/[0.96] text-left shadow-[0_30px_70px_-30px_rgba(40,30,20,0.5)] backdrop-blur-xl";

/** The bar across the top of a panel: what it is, and that it's a sample. */
export function PanelBar({
  icon: Icon,
  title,
  note,
}: {
  icon: LucideIcon;
  title: string;
  note?: string;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-black/[0.07] px-4">
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 truncate text-[13.5px] font-medium">
        {title}
      </span>
      {note && (
        <span className="hidden min-w-0 truncate text-[12px] text-[#0B0B0C]/45 sm:block">
          {note}
        </span>
      )}
      <span className="ml-auto shrink-0 rounded-full border border-black/15 px-2 py-0.5 text-[10.5px] font-medium tracking-wide text-[#0B0B0C]/55 uppercase">
        Example
      </span>
    </div>
  );
}

function Tag({ text, strong }: { text: string; strong?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-[11.5px] leading-none whitespace-nowrap",
        strong
          ? "bg-[#0B0B0C] text-white"
          : "bg-black/[0.055] text-[#0B0B0C]/70",
      )}
    >
      {text}
    </span>
  );
}

export function Rows({ rows }: { rows: Row[] }) {
  return (
    <ul className="divide-y divide-black/[0.06]">
      {rows.map((r) => (
        <li
          key={r.name}
          className="flex flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium [overflow-wrap:anywhere]">
              {r.name}
            </span>
            <span className="mt-0.5 block text-[12.5px] leading-[1.4] text-[#0B0B0C]/55">
              {r.detail}
            </span>
          </span>
          <Tag text={r.tag} strong={r.strong} />
        </li>
      ))}
    </ul>
  );
}

export function Bars({
  bars,
}: {
  bars: { label: string; value: number; note: string }[];
}) {
  return (
    <ul className="space-y-3.5">
      {bars.map((b) => (
        <li key={b.label}>
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate text-[#0B0B0C]/75">
              {b.label}
            </span>
            <span className="shrink-0 text-[#0B0B0C]/50 tabular-nums">
              {b.note}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
            <div
              className="h-full rounded-full bg-[#0B0B0C]"
              style={{ width: `${b.value}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Tiles({
  tiles,
  className,
}: {
  tiles: { label: string; value: string }[];
  className?: string;
}) {
  return (
    <dl className={cn("grid gap-2", className)}>
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-2xl border border-black/[0.07] bg-white px-3.5 py-3"
        >
          <dt className="text-[11.5px] leading-[1.3] text-[#0B0B0C]/55">
            {t.label}
          </dt>
          <dd className="mt-1.5 text-[24px] leading-none font-medium tracking-[-0.02em] tabular-nums">
            {t.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Body({ visual: v }: { visual: Visual }) {
  switch (v.kind) {
    case "thread":
      return (
        <ol className="flex flex-col gap-2 px-4 py-4">
          {v.messages.map((m) => (
            <li
              key={m.text}
              className={cn(
                "flex max-w-[86%] flex-col",
                m.agent && "ml-auto items-end",
              )}
            >
              <span className="sr-only">{m.agent ? "Dialvo: " : "Them: "}</span>
              <span
                className={cn(
                  "rounded-[18px] px-3.5 py-2 text-[13.5px] leading-[1.45]",
                  m.agent
                    ? "rounded-br-md bg-[#0B0B0C] text-white"
                    : "rounded-bl-md bg-black/[0.06]",
                )}
              >
                {m.text}
              </span>
            </li>
          ))}
        </ol>
      );
    case "email": {
      const row =
        "flex gap-3 border-b border-black/[0.06] py-2.5 text-[13px] leading-[1.4]";
      return (
        <div className="px-5 pb-4">
          <p className={row}>
            <span className="w-14 shrink-0 text-[#0B0B0C]/45">From</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{v.from}</span>
          </p>
          <p className={row}>
            <span className="w-14 shrink-0 text-[#0B0B0C]/45">To</span>
            <span className="min-w-0">{v.to}</span>
          </p>
          <p className={row}>
            <span className="w-14 shrink-0 text-[#0B0B0C]/45">Subject</span>
            <span className="min-w-0 font-medium">{v.subject}</span>
          </p>
          <div className="space-y-3 pt-4 text-[13.5px] leading-[1.55] text-[#0B0B0C]/85">
            {v.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </div>
      );
    }
    case "list":
      return <Rows rows={v.rows} />;
    case "timeline":
      return (
        <ol className="px-4 py-4">
          {v.steps.map((s, i) => (
            <li
              key={s.when + s.text}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {i < v.steps.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-4 bottom-0 left-[5px] w-px bg-black/10"
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "relative mt-[5px] size-[11px] shrink-0 rounded-full border-2",
                  s.done
                    ? "border-[#0B0B0C] bg-[#0B0B0C]"
                    : "border-black/25 bg-white",
                )}
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[#0B0B0C]/50">
                  <span className="tabular-nums">{s.when}</span>
                  <span className="rounded-full bg-black/[0.055] px-2 py-0.5 text-[11px] text-[#0B0B0C]/70">
                    {s.channel}
                  </span>
                </span>
                <span className="mt-1 block text-[13.5px] leading-[1.45]">
                  {s.text}
                </span>
              </span>
            </li>
          ))}
        </ol>
      );
    case "brief":
      return (
        <div className="px-5 py-4">
          <p className="text-[15px] leading-[1.35] font-medium">{v.heading}</p>
          <dl className="mt-3 divide-y divide-black/[0.06] border-y border-black/[0.06]">
            {v.facts.map(([k, val]) => (
              <div
                key={k}
                className="flex gap-3 py-2 text-[13px] leading-[1.4]"
              >
                <dt className="w-[38%] shrink-0 text-[#0B0B0C]/50">{k}</dt>
                <dd className="min-w-0">{val}</dd>
              </div>
            ))}
          </dl>
          <ul className="mt-3 space-y-1.5">
            {v.points.map((p) => (
              <li
                key={p}
                className="flex gap-2 text-[13px] leading-[1.45] text-[#0B0B0C]/80"
              >
                <span
                  aria-hidden
                  className="mt-[7px] size-1 shrink-0 rounded-full bg-[#1F3BFF]"
                />
                {p}
              </li>
            ))}
          </ul>
        </div>
      );
    case "metrics":
      return (
        <div className="space-y-5 px-4 py-4">
          <Tiles tiles={v.tiles} className="grid-cols-3" />
          <Bars bars={v.bars} />
        </div>
      );
    case "code":
      return (
        <pre className="overflow-x-auto px-5 py-4 font-[family-name:var(--font-geist-mono)] text-[12.5px] leading-[1.7] text-[#0B0B0C]/85">
          <code>{v.lines.join("\n")}</code>
        </pre>
      );
  }
}

/** One sample panel. */
export function VisualPanel({
  visual,
  className,
}: {
  visual: Visual;
  className?: string;
}) {
  return (
    <figure
      aria-label={`Example: ${visual.title}. Sample data.`}
      className={cn(panel, "flex flex-col", className)}
    >
      <PanelBar
        icon={ICONS[visual.kind]}
        title={visual.title}
        note={visual.note}
      />
      <Body visual={visual} />
      {visual.foot && (
        <figcaption className="mt-auto border-t border-black/[0.06] px-4 py-2.5 text-[11.5px] leading-[1.4] text-[#0B0B0C]/45">
          {visual.foot}
        </figcaption>
      )}
    </figure>
  );
}
