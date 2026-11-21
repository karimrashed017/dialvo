"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Eye,
  FileText,
  House,
  Inbox,
  LayoutGrid,
  ListOrdered,
  Megaphone,
  Menu,
  MessageCircle,
  Phone,
  Settings,
  Telescope,
  Users,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// The app's sections: the plays first, then what Dialvo finds and sends,
// what it answers, and where the results land.
const NAV: { href: string; icon: LucideIcon; label: string }[] = [
  { href: "/app", icon: House, label: "Home" },
  { href: "/app/plays", icon: Workflow, label: "Plays" },
  { href: "/app/prospects", icon: Telescope, label: "Find leads" },
  { href: "/app/sequences", icon: ListOrdered, label: "Sequences" },
  { href: "/app/workflows", icon: Zap, label: "Workflows" },
  { href: "/app/inbox", icon: Inbox, label: "Inbox" },
  { href: "/app/chat", icon: MessageCircle, label: "Website chat" },
  { href: "/app/visitors", icon: Eye, label: "Website visitors" },
  { href: "/app/calls", icon: Phone, label: "Calls" },
  { href: "/app/leads", icon: Users, label: "Leads" },
  { href: "/app/briefs", icon: FileText, label: "Briefs" },
  { href: "/app/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/app/ad-audiences", icon: Megaphone, label: "Ad audiences" },
  { href: "/app/knowledge", icon: BookOpen, label: "Knowledge" },
  { href: "/app/settings", icon: Settings, label: "Settings" },
];

export type NavCounts = {
  /** Conversations waiting for a person; shown on Inbox. */
  waiting: number;
  /** First emails waiting for approval; shown on Find leads. */
  emails: number;
};

/** The app's sections as a column: in the sidebar, and in the phone's drawer. */
export function AppNav({ waiting, emails }: NavCounts) {
  const pathname = usePathname();
  return (
    <ul className="space-y-px">
      {NAV.map((n) => {
        const active =
          n.href === "/app"
            ? pathname === "/app"
            : pathname === n.href || pathname.startsWith(`${n.href}/`);
        const count =
          n.href === "/app/inbox"
            ? waiting
            : n.href === "/app/prospects"
              ? emails
              : 0;
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none",
                active
                  ? "bg-[#0B0B0C] text-white"
                  : "text-[#0B0B0C]/65 hover:bg-black/[0.05] hover:text-[#0B0B0C]",
              )}
            >
              <n.icon aria-hidden className="size-4 shrink-0" />
              {n.label}
              {count > 0 && (
                <span
                  aria-label={
                    n.href === "/app/inbox"
                      ? `${count} waiting for you`
                      : `${count} waiting for your approval`
                  }
                  className={cn(
                    "ml-auto rounded-full px-1.5 text-[11px] font-medium tabular-nums",
                    active ? "bg-white/20" : "bg-[#0B0B0C] text-white",
                  )}
                >
                  {count}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Every play and platform feature, and where each lives: below the sections. */
export function FeaturesLink() {
  const pathname = usePathname();
  const active = pathname.startsWith("/app/features");
  return (
    <Link
      href="/app/features"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none",
        active
          ? "bg-[#0B0B0C] text-white"
          : "text-[#0B0B0C]/55 hover:bg-black/[0.05] hover:text-[#0B0B0C]",
      )}
    >
      <LayoutGrid aria-hidden className="size-4 shrink-0" />
      All features
    </Link>
  );
}

/** On phones: a menu button that opens the sections in a drawer. */
export function MobileNav(counts: NavCounts) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const total = counts.waiting + counts.emails;

  // Arriving on a page closes the drawer.
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // A tap on the backdrop, or on the section you are already in.
    const click = (event: MouseEvent) => {
      if (event.target === el || (event.target as HTMLElement).closest("a"))
        el.close();
    };
    el.addEventListener("click", click);
    return () => {
      el.removeEventListener("click", click);
      el.close();
    };
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label={total > 0 ? `Menu, ${total} waiting for you` : "Menu"}
        onClick={() => dialog.current?.showModal()}
        className="relative grid size-9 shrink-0 place-items-center rounded-lg text-[#0B0B0C]/75 hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
      >
        <Menu aria-hidden className="size-[18px]" />
        {total > 0 && (
          <span
            aria-hidden
            className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[#0B0B0C] ring-2 ring-white"
          />
        )}
      </button>
      <dialog
        ref={dialog}
        aria-label="Menu"
        className="m-0 h-dvh max-h-none w-[min(84vw,300px)] max-w-none border-r border-black/10 bg-white p-0 text-[#0B0B0C] backdrop:bg-black/30"
      >
        <div className="flex h-full flex-col p-3">
          <div className="mb-2 flex items-center justify-between pl-2.5">
            <p className="text-[12px] text-[#0B0B0C]/50">Menu</p>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => dialog.current?.close()}
              className="grid size-9 place-items-center rounded-lg hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <nav aria-label="App" className="min-h-0 flex-1 overflow-y-auto">
            <AppNav {...counts} />
          </nav>
          <div className="mt-2 border-t border-black/[0.06] pt-2">
            <FeaturesLink />
          </div>
        </div>
      </dialog>
    </>
  );
}
