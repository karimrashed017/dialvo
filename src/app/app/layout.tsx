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
import { planLine, trialBanner, trialState } from "@/lib/billing/trial";
import { PLANS } from "@/lib/site";
import { APP_CONFIGURED } from "@/lib/supabase/env";
import { SetupNotice } from "../(auth)/frame";
import { PAPER } from "../_site/theme";
import { Dropdown, menuItem } from "./_ui/dropdown";
import { Badge, Initial } from "./_ui/kit";
import { AppNav, FeaturesLink, MobileNav } from "./_ui/nav";
import { switchWorkspace } from "./workspace-actions";

export const viewport = { themeColor: PAPER };
export const metadata: Metadata = {
  title: { default: "Dialvo", template: "%s · Dialvo" },
  robots: { index: false, follow: false },
};

/** The signed-in app's frame: sidebar, top bar, and the page. */
async function Shell({ children }: { children: React.ReactNode }) {
  const { user, workspace, workspaces, repo, preview } = await getAppContext();
  const [waiting, emails] = await Promise.all([
    repo.waitingCount(),
    repo.emailDraftCount(),
  ]);
  const displayName = user.name || user.email;
  const trial = trialState(workspace);
  // A running trial is said once, under the workspace's name. Only a trial
  // that has ended, which asks for something, gets the line across the top.
  const banner = trial.phase === "ended" ? trialBanner(trial) : null;

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
            <span
              data-plan-line={trial.phase}
              className="block truncate text-[11px] text-[#0B0B0C]/50"
            >
              {planLine(trial, PLANS[workspace.plan].name)}
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
        <nav aria-label="App" className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <AppNav waiting={waiting} emails={emails} />
        </nav>
        <div className="mt-2 border-t border-black/[0.06] pt-2">
          <FeaturesLink />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {banner && (
          <p
            role="status"
            data-trial="ended"
            className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 bg-[#0B0B0C] px-4 py-1.5 text-center text-[12.5px] leading-[1.4] text-white"
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
          <div className="flex h-[52px] items-center gap-1.5 px-2 sm:px-5 lg:gap-2">
            <div className="lg:hidden">
              <MobileNav waiting={waiting} emails={emails} />
            </div>
            <div className="min-w-0 flex-1 sm:max-w-[240px] lg:hidden">
              {switcher}
            </div>
            <form
              action="/app/leads"
              role="search"
              className="hidden h-8 max-w-[340px] flex-1 items-center gap-2 rounded-lg bg-black/[0.045] px-3 text-[13px] focus-within:ring-2 focus-within:ring-black/15 sm:flex"
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
