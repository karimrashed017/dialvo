import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { PLAYS } from "@/lib/content/catalog";
import { APP_PLAYS, PLAY_GROUPS } from "@/lib/plays/catalog";
import { playReads, type Counts } from "@/lib/plays/read";
import { createClient } from "@/lib/supabase/server";
import { PageHead, PageSkeleton } from "../_ui/kit";
import { StatusPill, sumCounts } from "./ui";

export const metadata: Metadata = { title: "Plays" };

async function Content() {
  const { workspace, preview } = await getAppContext();
  let counts: Record<string, Counts> = {};
  if (!preview) {
    const supabase = await createClient();
    counts = await playReads(supabase, workspace.id).counts();
  }
  return (
    <>
      <PageHead
        title="Plays"
        note="Ready-made ways to find, follow up and grow customers. Each one says who it writes to and what it needs. Every email waits for your approval before it is sent."
      />
      <div className="space-y-6">
        {PLAY_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`g-${group.id}`}>
            <h2
              id={`g-${group.id}`}
              className="mb-2 px-1 text-[12px] font-medium tracking-wide text-[#0B0B0C]/50 uppercase"
            >
              {group.title}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.plays.map((slug) => {
                const play = APP_PLAYS[slug];
                const Icon = PLAYS[slug].icon;
                const c = sumCounts(counts, play.kinds);
                const busy = c.targeted + c.drafted + c.sent > 0;
                return (
                  <li key={slug}>
                    <Link
                      href={`/app/plays/${slug}`}
                      data-play={slug}
                      className="group flex h-full flex-col rounded-2xl border border-black/[0.07] bg-white p-4 transition-colors hover:border-black/20 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-black/[0.08]">
                          <Icon aria-hidden className="size-4" />
                        </span>
                        <StatusPill status={play.status} />
                      </div>
                      <p className="mt-3 text-[14px] font-medium">
                        {PLAYS[slug].title}
                      </p>
                      <p className="mt-1 line-clamp-3 text-[12.5px] leading-[1.5] text-[#0B0B0C]/60">
                        {play.what}
                      </p>
                      <p className="mt-auto flex items-center justify-between gap-2 pt-3 text-[12px] text-[#0B0B0C]/55">
                        <span className="tabular-nums">
                          {busy
                            ? `${c.targeted} picked · ${c.sent} sent · ${c.replied} replied`
                            : play.status === "building"
                              ? "Not running yet"
                              : "Not started"}
                        </span>
                        <ArrowRight
                          aria-hidden
                          className="size-3.5 transition-transform group-hover:translate-x-0.5"
                        />
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <section aria-labelledby="g-own">
          <h2
            id="g-own"
            className="mb-2 px-1 text-[12px] font-medium tracking-wide text-[#0B0B0C]/50 uppercase"
          >
            Your own
          </h2>
          <Link
            href="/app/plays/playbooks"
            data-play="playbooks"
            className="group flex items-center justify-between gap-3 rounded-2xl border border-black/[0.07] bg-white p-4 transition-colors hover:border-black/20 focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
          >
            <span>
              <span className="block text-[14px] font-medium">
                Your playbooks
              </span>
              <span className="mt-1 block text-[12.5px] leading-[1.5] text-[#0B0B0C]/60">
                Write your own play: who to pick from your leads, what the first
                email is for, the steps after it, and whether it waits for you.
              </span>
            </span>
            <ArrowRight
              aria-hidden
              className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </section>
      </div>
    </>
  );
}

export default function PlaysPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}
