"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { startHref } from "./links";
import { useScrolled } from "./motion";

const LINKS = [
  { href: "/#channels", label: "Channels" },
  { href: "/#motions", label: "How it works" },
  { href: "/#plays", label: "Plays" },
  { href: "/#platform", label: "Platform" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

/** The floating nav: frosted over the sky, a little more solid once scrolled. */
export function SiteNav() {
  const scrolled = useScrolled();
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <nav
        aria-label="Main"
        className={cn(
          "mx-auto flex max-w-[1180px] items-center justify-between rounded-2xl border px-3 py-2 transition-[background-color,border-color,backdrop-filter] duration-500 sm:px-4",
          scrolled || open
            ? "border-black/[0.08] bg-white/85 backdrop-blur-xl"
            : "border-black/[0.06] bg-white/75 backdrop-blur-xl",
        )}
      >
        <Link
          href="/"
          aria-label="Dialvo home"
          className="flex h-9 items-center px-1 text-[#0B0B0C]"
        >
          <Logo className="h-[22px]" />
        </Link>
        <ul className="hidden items-center gap-0.5 lg:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="rounded-full px-3 py-2 text-[14px] text-[#0B0B0C]/70 transition-colors hover:text-[#0B0B0C]"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Link
            href="/#channels"
            className="hidden h-9 items-center rounded-full border border-black/20 px-4 text-[14px] font-medium text-[#0B0B0C] transition-colors hover:bg-black/[0.08] xl:inline-flex"
          >
            See the product
          </Link>
          <a
            href={startHref()}
            className="hidden h-9 items-center rounded-full bg-[#0B0B0C] px-4 text-[14px] font-medium text-white transition-colors hover:bg-black/85 sm:inline-flex"
          >
            Get early access
          </a>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="grid size-9 place-items-center rounded-full text-[#0B0B0C] lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>
      {open && (
        <div className="mx-auto mt-2 max-w-[1180px] rounded-2xl border border-black/[0.08] bg-white/95 p-2 backdrop-blur-xl lg:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-4 py-3 text-[16px] text-[#0B0B0C]/80 hover:bg-black/[0.05]"
            >
              {l.label}
            </Link>
          ))}
          <a
            href={startHref()}
            className="mt-1 flex h-11 items-center justify-center rounded-xl bg-[#0B0B0C] text-[15px] font-medium text-white"
          >
            Get early access
          </a>
          <Link
            href="/#channels"
            onClick={() => setOpen(false)}
            className="mt-2 flex h-11 items-center justify-center rounded-xl border border-black/15 text-[15px] font-medium text-[#0B0B0C]"
          >
            See the product
          </Link>
        </div>
      )}
    </header>
  );
}
