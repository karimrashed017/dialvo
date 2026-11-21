import Link from "next/link";
import { cn } from "@/lib/utils";

// A row of tabs between a section's pages (Lists and Recipes; Leads, Scoring
// and Audiences), in the look of Find leads' tabs.

export function SectionTabs({
  label,
  tabs,
  current,
}: {
  label: string;
  tabs: { id: string; href: string; label: string }[];
  current: string;
}) {
  return (
    <nav
      aria-label={label}
      className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-0.5"
    >
      {tabs.map((t) => (
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

export const LIST_TABS = [
  { id: "lists", href: "/app/lists", label: "Lists" },
  { id: "recipes", href: "/app/lists/recipes", label: "Recipes" },
];

export const LEAD_TABS = [
  { id: "leads", href: "/app/leads", label: "All leads" },
  { id: "scoring", href: "/app/leads/scoring", label: "Scoring and tiers" },
  { id: "audiences", href: "/app/leads/audiences", label: "Audiences" },
];
