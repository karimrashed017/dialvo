import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { APP_ONLY_FEATURES, featureGroups } from "@/lib/plays/catalog";
import { FEATURES } from "@/lib/content";
import { PageHead } from "../_ui/kit";
import { StatusPill } from "../plays/ui";

export const metadata: Metadata = { title: "All features" };

// Every item of the website's Platform menu, grouped exactly as the menu
// groups them, each linking to where it lives in the app or to its "being
// built" page. Nothing here reads the session, so it needs no Suspense.

export default function FeaturesPage() {
  // App-only features that now have a website page show in their menu group.
  const appOnly = APP_ONLY_FEATURES.filter((f) => !(f.key in FEATURES));
  const groups = [
    ...featureGroups(),
    ...(appOnly.length
      ? [
          {
            id: "app-only",
            title: "More in the app",
            blurb: "",
            items: appOnly.map((f) => ({ ...f, key: `app:${f.key}` })),
          },
        ]
      : []),
  ];
  return (
    <>
      <PageHead
        title="All features"
        note="Everything on Dialvo's website, and where to find it here. Live works today, Partly live says which part works, and Being built isn't running yet."
      />
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`f-${g.id}`}>
            <div className="mb-2 px-1">
              <h2
                id={`f-${g.id}`}
                className="text-[12px] font-medium tracking-wide text-[#0B0B0C]/50 uppercase"
              >
                {g.title}
              </h2>
            </div>
            <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
              {g.items.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    data-feature={item.key}
                    className="group flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02] focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-medium">
                          {item.title}
                        </span>
                        <StatusPill status={item.status} />
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-[#0B0B0C]/60">
                        {item.note}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="mt-1 size-3.5 shrink-0 text-[#0B0B0C]/40 transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
