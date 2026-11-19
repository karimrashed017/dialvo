import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { CONTACT_EMAIL, START_HREF } from "@/lib/site";
import { serif } from "./theme";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "What Dialvo does" },
      { href: "/#how", label: "How it works" },
      { href: "/#listen", label: "Listen to a call" },
      { href: "/#speed", label: "Speed to lead" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/#compliance", label: "Compliance" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
  {
    title: "Dialvo",
    links: [
      { href: START_HREF, label: "Get early access" },
      { href: `mailto:${CONTACT_EMAIL}`, label: "Contact" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-black/[0.06] px-5 pt-16 pb-10">
      <div className="mx-auto grid max-w-[1180px] gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo className="-ml-[3px] h-[29px]" />
          <p
            className={`${serif} mt-5 max-w-[300px] text-[22px] leading-[1.2]`}
          >
            Your AI sales team. It calls, follows up and books meetings.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <p className="text-[13px] text-[#0B0B0C]/45">{c.title}</p>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-[14px] text-[#0B0B0C]/75 transition-colors hover:text-[#0B0B0C]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-16 flex max-w-[1180px] flex-col gap-2 text-[12.5px] text-[#0B0B0C]/40 sm:flex-row sm:justify-between">
        <p>
          © 2026 Dialvo ·{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[#0B0B0C]">
            {CONTACT_EMAIL}
          </a>
        </p>
        <p>
          Paintings, all public domain: William Bradford, Coast of Labrador;
          Martin Johnson Heade, York Harbor, Coast of Maine (1877); John
          Frederick Kensett, Rocky Coast.
        </p>
      </div>
    </footer>
  );
}
