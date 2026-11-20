import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  Check,
  ChevronsUpDown,
  LogOut,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { MarkAvatar } from "@/components/brand/logo";
import { getAppContext } from "@/lib/app/context";
import { FIXTURES_ON } from "@/lib/app/fixture-flag";
import { trialBanner, trialState } from "@/lib/billing/trial";
import { PLANS } from "@/lib/site";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { SetupNotice } from "../(auth)/frame";
import { PAPER } from "../_site/theme";
import { cn } from "@/lib/utils";
import { Dropdown, menuItem } from "./_ui/dropdown";
import { Badge, Initial } from "./_ui/kit";
import { AppNav } from "./_ui/nav";
import { switchWorkspace } from "./workspace-actions";

export const viewport = { themeColor: PAPER };
export const metadata: Metadata = {
  title: { default: "Dialvo", template: "%s · Dialvo" },
  robots: { index: false, follow: false },
};

const ROLE_WORDS = {
  inbound: "Inbound",
  outbound: "Outbound",
  closing: "Closing",
  expansion: "Expansion",
} as const;

/** The signed-in app's frame: sidebar, top bar, and the page. */
async function Shell({ children }: { children: React.ReactNode }) {
  const { user, workspace, workspaces, repo, preview } = await getAppContext();
  const [waiting, agents] = await Promise.all([
    repo.waitingCount(),
    repo.agents(),
  ]);
  const on = agents.filter((a) => a.enabled).map((a) => ROLE_WORDS[a.role]);
  const displayName = user.name || user.email;
  const banner = trialBanner(trialState(workspace));

  const switcher = (
    <Dropdown
      label={`Workspace: ${workspace.name}. Switch workspace`}
      panelClassName="w-[260px]"
      trigger={
        <span className="flex w-full min-w-0 items-center gap-2.5 px-2 py-1.5 hover:bg-black/[0.04]">
          <MarkAvatar className="size-7" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {workspace.name}
            </span>
            <span className="block text-[11px] text-[#0B0B0C]/45">
              {PLANS[workspace.plan].name} plan
            </span>
          </span>
          <ChevronsUpDown
            aria-hidden
            className="size-3.5 shrink-0 text-[#0B0B0C]/40"
          />
        </span>
      }
    >
      <p className="px-2.5 pt-1.5 pb-1 text-[11px] tracking-wide text-[#0B0B0C]/45 uppercase">
        Workspaces
      </p>
      <form action={switchWorkspace}>
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="submit"
            name="workspace"
            value={w.id}
            className={menuItem}
          >
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {w.id === workspace.id && (
              <Check aria-label="Current" className="size-3.5 shrink-0" />
            )}
          </button>
        ))}
      </form>
      <div className="my-1 border-t border-black/[0.06]" />
      <Link href="/onboarding?new=1" className={menuItem}>
        <Plus aria-hidden className="size-3.5" />
        New workspace
      </Link>
      <p className="px-2.5 pt-1 pb-1.5 text-[11.5px] leading-[1.4] text-[#0B0B0C]/45">
        Scale includes {PLANS.scale.workspaces} workspaces, one per client or
        brand.
      </p>
    </Dropdown>
  );

  return (
    <div
      className="flex min-h-dvh font-[family-name:var(--font-geist-sans)] text-[#0B0B0C] selection:bg-[#0B0B0C] selection:text-white"
      style={{ backgroundColor: PAPER }}
    >
      <style>{`html,body{background-color:${PAPER};color-scheme:light}`}</style>

      <aside className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col border-r border-black/[0.07] bg-white/70 p-3 lg:flex">
        {switcher}
        <nav aria-label="App" className="mt-4">
          <AppNav waiting={waiting} />
        </nav>
        <div className="mt-auto rounded-xl border border-black/[0.07] bg-white p-3">
          <p className="text-[11px] text-[#0B0B0C]/45">Agents on</p>
          <p className="mt-1 text-[12.5px] leading-[1.4]">
            {on.length > 0 ? on.join(", ") : "None yet"}
          </p>
          <Link
            href="/app/agents"
            className="mt-1.5 inline-block text-[12px] text-[#0B0B0C]/55 underline decoration-black/20 underline-offset-2 hover:text-[#0B0B0C]"
          >
            {on.length > 0 ? "Manage agents" : "Set up your agents"}
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {banner && (
          <p
            role="status"
            data-trial={banner.ended ? "ended" : "running"}
            className={cn(
              "flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-1.5 text-center text-[12.5px] leading-[1.4]",
              banner.ended
                ? "bg-[#0B0B0C] text-white"
                : "border-b border-black/[0.07] bg-white text-[#0B0B0C]/70",
            )}
          >
            <span>{banner.text}</span>
            {banner.action && (
              <a
                href={banner.action.href}
                className="font-medium underline underline-offset-2"
              >
                {banner.action.label}
              </a>
            )}
          </p>
        )}
        <header className="sticky top-0 z-30 border-b border-black/[0.07] bg-white/85 backdrop-blur-xl">
          <div className="flex h-[52px] items-center gap-2 px-3 sm:px-5">
            <div className="min-w-0 flex-1 lg:hidden">{switcher}</div>
            <form
              action="/app/leads"
              role="search"
              className="hidden h-8 max-w-[340px] flex-1 items-center gap-2 rounded-lg bg-black/[0.045] px-3 text-[13px] focus-within:ring-2 focus-within:ring-[#1F3BFF]/25 sm:flex"
            >
              <Search aria-hidden className="size-3.5 text-[#0B0B0C]/40" />
              <input
                name="q"
                type="search"
                aria-label="Search leads"
                placeholder="Search leads by name, company, email or phone"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#0B0B0C]/40"
              />
            </form>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {preview && (
                <Badge tone="outline" className="hidden sm:inline-flex">
                  Design preview · made-up data
                </Badge>
              )}
              <Link
                href="/app/leads"
                aria-label="Search leads"
                className="grid size-9 place-items-center rounded-lg text-[#0B0B0C]/60 hover:bg-black/[0.05] sm:hidden"
              >
                <Search aria-hidden className="size-4" />
              </Link>
              <Dropdown
                label={`Account: ${displayName}`}
                align="right"
                trigger={
                  <span className="flex items-center gap-2 rounded-full p-1 hover:bg-black/[0.05]">
                    <Initial name={displayName} />
                  </span>
                }
              >
                <div className="px-2.5 pt-1.5 pb-2">
                  <p className="truncate text-[13px] font-medium">
                    {user.name || "Your account"}
                  </p>
                  <p className="truncate text-[12px] text-[#0B0B0C]/50">
                    {user.email}
                  </p>
                </div>
                <div className="mb-1 border-t border-black/[0.06]" />
                <Link href="/app/settings#profile" className={menuItem}>
                  <Settings aria-hidden className="size-3.5" />
                  Settings
                </Link>
                <form action="/logout" method="post">
                  <button type="submit" className={menuItem}>
                    <LogOut aria-hidden className="size-3.5" />
                    Log out
                  </button>
                </form>
              </Dropdown>
            </div>
          </div>
          <nav
            aria-label="App"
            className="border-t border-black/[0.05] lg:hidden"
          >
            <AppNav waiting={waiting} row />
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-3 py-4 sm:px-5 sm:py-5">
          {children}
        </main>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div
      aria-busy
      className="flex min-h-dvh"
      style={{ backgroundColor: PAPER }}
    >
      <style>{`html,body{background-color:${PAPER};color-scheme:light}`}</style>
      <div className="hidden w-[220px] shrink-0 border-r border-black/[0.07] bg-white/70 lg:block" />
      <div className="flex-1">
        <div className="h-[52px] border-b border-black/[0.07] bg-white/85" />
      </div>
      <span className="sr-only">Loading Dialvo</span>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/app">) {
  // Until the database is connected there is no app to show. (The design
  // preview is the one exception, and it only exists in development.)
  if (!APP_CONFIGURED && !FIXTURES_ON) return <SetupNotice />;
  return (
    // The shell reads the session, so it streams in behind this boundary.
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
