"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Bot,
  Inbox,
  LayoutDashboard,
  ListTree,
  Phone,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV: { href: string; icon: LucideIcon; label: string }[] = [
  { href: "/app", icon: LayoutDashboard, label: "Today" },
  { href: "/app/inbox", icon: Inbox, label: "Inbox" },
  { href: "/app/leads", icon: Users, label: "Leads" },
  { href: "/app/agents", icon: Bot, label: "Agents" },
  { href: "/app/sequences", icon: ListTree, label: "Sequences" },
  { href: "/app/calls", icon: Phone, label: "Calls" },
  { href: "/app/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/app/knowledge", icon: BookOpen, label: "Knowledge" },
  { href: "/app/settings", icon: Settings, label: "Settings" },
];

/** The app's sections: a column in the sidebar, a scrolling row on phones. */
export function AppNav({
  waiting,
  row,
}: {
  /** Conversations waiting for a person; shown on Inbox. */
  waiting: number;
  row?: boolean;
}) {
  const pathname = usePathname();
  return (
    <ul
      className={cn(
        row
          ? "flex [scrollbar-width:none] gap-1 overflow-x-auto px-3 py-2 [&::-webkit-scrollbar]:hidden"
          : "space-y-0.5",
      )}
    >
      {NAV.map((n) => {
        const active =
          n.href === "/app"
            ? pathname === "/app"
            : pathname === n.href || pathname.startsWith(`${n.href}/`);
        const count = n.href === "/app/inbox" ? waiting : 0;
        return (
          <li key={n.href} className={cn(row && "shrink-0")}>
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
                  aria-label={`${count} waiting for you`}
                  className={cn(
                    "ml-auto rounded-full px-1.5 text-[11px] tabular-nums",
                    active ? "bg-white/20" : "bg-[#1F3BFF] text-white",
                    row && "ml-0.5",
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
