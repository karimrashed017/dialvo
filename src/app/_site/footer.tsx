import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import {
  GROUPS,
  itemInfo,
  MOTIONS,
  playHref,
  PLAYS,
  playsIn,
} from "@/lib/content/catalog";
import { CONTACT_EMAIL, START_HREF } from "@/lib/site";
import { serif } from "./theme";

type Column = { title: string; links: { href: string; label: string }[] };

// Every page on the site, grouped: the motions (closing among them), the
// plays under each motion,
// the six platform groups, then pricing, trust and contact.
const COLUMNS: Column[] = [
  {
    title: "Use cases",
    links: [
      ...MOTIONS.map((m) => ({ href: m.href, label: m.name })),
      { href: "/plays", label: "All plays" },
    ],
  },
  // Closing has no plays of its own, so no column.
  ...MOTIONS.filter((m) => playsIn(m.id).length > 0).map((m) => ({
    title: `${m.name} plays`,
    links: playsIn(m.id).map((s) => ({
      href: playHref(s),
      label: PLAYS[s].title,
    })),
  })),
  ...GROUPS.map((g) => ({
    title: g.title,
    links: g.items
      // The plays in a platform group are already listed under their motion.
      .filter((item) => item.type === "feature")
      .map((item) => {
        const it = itemInfo(item);
        return { href: it.href, label: it.title };
      }),
  })),
  {
    title: "Product",
    links: [
      { href: "/platform", label: "Platform overview" },
      { href: "/#voice-demo", label: "Talk to the agent" },
      { href: "/#channels", label: "Channels" },
      { href: "/pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/#control", label: "Nothing out of sight" },
      { href: "/#listen", label: "Sample call" },
      { href: "/#compliance", label: "Compliance" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
  {
    title: "Dialvo",
    links: [
      { href: START_HREF, label: "Start free" },
      { href: `mailto:${CONTACT_EMAIL}`, label: "Contact" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-black/[0.06] px-5 pt-16 pb-10">
      <div className="mx-auto max-w-[1180px]">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <Logo className="h-[26px]" />
            <p
              className={`${serif} mt-5 max-w-[340px] text-[22px] leading-[1.2]`}
            >
              Inbound and outbound sales, run by AI agents.
            </p>
          </div>
        </div>
        <nav
          aria-label="Footer"
          className="mt-14 columns-2 gap-x-8 md:columns-3 lg:columns-4 xl:columns-5"
        >
          {COLUMNS.map((c) => (
            <div key={c.title} className="mb-9 break-inside-avoid">
              <p className="text-[13px] text-[#0B0B0C]/45">{c.title}</p>
              <ul className="mt-3.5 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-[14px] leading-[1.35] text-[#0B0B0C]/75 transition-colors hover:text-[#0B0B0C]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="mx-auto mt-8 flex max-w-[1180px] flex-col gap-2 text-[12.5px] text-[#0B0B0C]/40 sm:flex-row sm:justify-between sm:gap-8">
        <p className="shrink-0">
          © 2026 Dialvo ·{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[#0B0B0C]">
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="sm:text-right">
          Paintings, all public domain: William Bradford, Coast of Labrador;
          Martin Johnson Heade, York Harbor, Coast of Maine (1877); John
          Frederick Kensett, Rocky Coast. The meadow photograph was made for
          Dialvo.
        </p>
      </div>
    </footer>
  );
}
