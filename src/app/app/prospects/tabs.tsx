import Link from "next/link";
import { cn } from "@/lib/utils";

// The ways into Find leads: describe who you sell to, bring a list of target
// accounts, find companies like your best ones, or act on buying signals.

const TABS = [
  { id: "search", href: "/app/prospects", label: "Search" },
  { id: "accounts", href: "/app/prospects/accounts", label: "Target accounts" },
  { id: "lookalike", href: "/app/prospects/lookalike", label: "Lookalike" },
  { id: "signals", href: "/app/prospects/signals", label: "Signals" },
] as const;

export function FindTabs({
  current,
}: {
  current: (typeof TABS)[number]["id"];
}) {
  return (
    <nav
      aria-label="Ways to find leads"
      className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-0.5"
    >
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={t.id === current ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-[12.5px] whitespace-nowrap transition-colors",
            t.id === current
              ? "bg-[#0B0B0C] font-medium text-white"
              : "bg-black/[0.045] text-[#0B0B0C]/70 hover:bg-black/[0.08]",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
