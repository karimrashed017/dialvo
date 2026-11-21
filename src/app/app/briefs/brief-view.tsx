import type { AnyBrief, Cited, Source } from "@/lib/briefs/types";
import { hint } from "../_ui/kit";

// One brief or closed-lost note as the app shows it, with its numbered
// sources. Everything in it came from a website, the web or a conversation,
// so it is shown as text only (React escapes it) and links only go to the
// sources the brief kept.

export type BriefRow = {
  id: string;
  kind: "brief" | "closed_lost";
  status: string;
  reason: string;
  summary: string;
  content: AnyBrief | Record<string, never>;
  sources: Source[];
  error: string | null;
  created_at: string;
  ready_at: string | null;
};

export const BRIEF_STATUS: Record<string, string> = {
  pending: "Waiting",
  running: "Being written",
  ready: "Ready",
  failed: "Couldn't be made",
  skipped: "Not made",
};

export const BRIEF_REASON: Record<string, string> = {
  manual: "Asked for",
  meeting: "Before a meeting",
  digest: "Morning digest",
  workflow: "A workflow",
  lost: "Marked lost",
  mcp: "From an assistant",
};

function Refs({ n }: { n: number[] }) {
  if (n.length === 0) return null;
  return (
    <sup className="ml-0.5 text-[10.5px] text-[#0B0B0C]/45">
      {n.map((x, i) => (
        <a key={x} href={`#src-${x}`} className="hover:underline">
          {i ? "," : ""}
          {x}
        </a>
      ))}
    </sup>
  );
}

function List({ title, items }: { title: string; items: (Cited | string)[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-[12px] font-medium tracking-wide text-[#0B0B0C]/50 uppercase">
        {title}
      </h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] leading-[1.5]">
        {items.map((item, i) =>
          typeof item === "string" ? (
            <li key={i}>{item}</li>
          ) : (
            <li key={i}>
              {item.text}
              <Refs n={item.sources} />
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

export function BriefBody({ brief }: { brief: BriefRow }) {
  const c = brief.content as AnyBrief;
  if (brief.status !== "ready" || !c || !("kind" in c))
    return (
      <p className="text-[13px] text-[#0B0B0C]/60">
        {brief.status === "failed" || brief.status === "skipped"
          ? brief.error || "It couldn't be made."
          : "Being written. It usually takes a minute or two."}
      </p>
    );
  return (
    <div className="space-y-4">
      {brief.summary && (
        <p className="text-[13.5px] leading-[1.55]">{brief.summary}</p>
      )}
      {c.kind === "brief" ? (
        <>
          <List title="The company" items={c.company} />
          {c.people.length > 0 && (
            <div>
              <h3 className="text-[12px] font-medium tracking-wide text-[#0B0B0C]/50 uppercase">
                People
              </h3>
              <ul className="mt-1 space-y-1 text-[13px] leading-[1.5]">
                {c.people.map((p, i) => (
                  <li key={i}>
                    <span className="font-medium">{p.name}</span>
                    {p.role && `, ${p.role}`}
                    {p.note && (
                      <span className="text-[#0B0B0C]/70">: {p.note}</span>
                    )}
                    <Refs n={p.sources} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <List title="What was said before" items={c.history} />
          <List title="Open questions" items={c.open_questions} />
          <List title="Talking points" items={c.talking_points} />
        </>
      ) : (
        <>
          <List title="Why it was likely lost" items={c.reasons} />
          <List title="What might change" items={c.what_might_change} />
          {c.next_step && <List title="Next step" items={[c.next_step]} />}
        </>
      )}
      {brief.sources.length > 0 && (
        <div>
          <h3 className="text-[12px] font-medium tracking-wide text-[#0B0B0C]/50 uppercase">
            Sources
          </h3>
          <ol className="mt-1 space-y-0.5 text-[12px] leading-[1.5] text-[#0B0B0C]/65">
            {brief.sources.map((s) => (
              <li key={s.n} id={`src-${s.n}`} className="flex gap-1.5">
                <span className="tabular-nums">{s.n}.</span>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="min-w-0 truncate underline underline-offset-2"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className={hint}>
        Written by Dialvo&apos;s AI from the company&apos;s website, a web
        search and your conversations. Check anything important against its
        source.
      </p>
    </div>
  );
}
