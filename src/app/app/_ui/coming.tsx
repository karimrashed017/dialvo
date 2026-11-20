import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn, NotLive, PageHead, panel } from "./kit";

/** A section that isn't built yet: what it will do, and what works today. */
export function ComingPage({
  icon: Icon,
  title,
  lead,
  points,
  meanwhile,
}: {
  icon: LucideIcon;
  title: string;
  lead: string;
  points: string[];
  meanwhile: { text: string; href: string; action: string };
}) {
  return (
    <>
      <PageHead title={title}>
        <NotLive>Not built yet</NotLive>
      </PageHead>
      <section className={cn(panel, "p-5 sm:p-7")}>
        <span className="grid size-10 place-items-center rounded-xl border border-black/[0.08]">
          <Icon aria-hidden className="size-[18px]" />
        </span>
        <h2 className="mt-4 max-w-[560px] text-[17px] leading-[1.35] font-medium">
          {lead}
        </h2>
        <p className="mt-4 text-[11px] tracking-wide text-[#0B0B0C]/45 uppercase">
          What&apos;s coming
        </p>
        <ul className="mt-2 max-w-[600px] space-y-2">
          {points.map((p) => (
            <li
              key={p}
              className="flex gap-2.5 text-[13.5px] leading-[1.5] text-[#0B0B0C]/75"
            >
              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-[#0B0B0C]/40" />
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-black/[0.03] px-4 py-3">
          <p className="min-w-0 flex-1 text-[13px] leading-[1.5] text-[#0B0B0C]/70">
            <span className="font-medium text-[#0B0B0C]">Today: </span>
            {meanwhile.text}
          </p>
          <Link href={meanwhile.href} className={btn.secondary}>
            {meanwhile.action}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
        <p className="mt-4 text-[12px] text-[#0B0B0C]/45">
          There is no data on this page because nothing has produced any yet. We
          don&apos;t show sample numbers in your workspace.
        </p>
      </section>
    </>
  );
}
