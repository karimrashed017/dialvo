"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import {
  GROUPS,
  itemInfo,
  MENU_PLAYS,
  MOTIONS,
  playHref,
  PLAYS,
} from "@/lib/content/catalog";
import { cn } from "@/lib/utils";
import { startHref } from "./links";
import { useScrolled } from "./motion";

// The floating nav: frosted over the page, with two menus. On a wide screen
// "Use cases" and "Platform" open panels under the bar (hover, click or
// keyboard); on a phone they are accordions inside the menu sheet. Escape
// closes whatever is open and puts focus back on the button that opened it.

type MenuId = "use-cases" | "platform";

const MENUS: { id: MenuId; label: string }[] = [
  { id: "use-cases", label: "Use cases" },
  { id: "platform", label: "Platform" },
];

const glass = "border border-black/[0.08] bg-white/[0.97] backdrop-blur-xl";
const ring =
  "focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none";
const menuLink = cn(
  "block rounded-lg px-2.5 py-1.5 text-[14px] text-[#0B0B0C]/75 transition-colors hover:bg-black/[0.05] hover:text-[#0B0B0C]",
  ring,
);

/** The three motions as large links. */
function MotionLinks({ compact }: { compact?: boolean }) {
  return (
    <ul className={cn("grid gap-1", !compact && "grid-cols-3")}>
      {MOTIONS.map((m) => (
        <li key={m.id}>
          <Link
            href={m.href}
            className={cn(
              "flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-black/[0.05]",
              ring,
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-black/12 bg-white">
              <m.icon aria-hidden className="size-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-[#0B0B0C]">
                {m.name}
              </span>
              <span className="mt-0.5 block text-[13px] leading-[1.4] text-[#0B0B0C]/55">
                {m.blurb}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Every menu play, grouped under its motion. */
function PlayColumns({ compact }: { compact?: boolean }) {
  return (
    <div className={cn("grid gap-x-4 gap-y-5", !compact && "grid-cols-3")}>
      {MOTIONS.map((m) => (
        <div key={m.id}>
          <p className="px-2.5 text-[12px] tracking-wide text-[#0B0B0C]/45 uppercase">
            {m.name}
          </p>
          <ul className="mt-1.5">
            {MENU_PLAYS[m.id].map((slug) => (
              <li key={slug}>
                <Link href={playHref(slug)} className={menuLink}>
                  {PLAYS[slug].title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The six platform groups and their links. */
function PlatformColumns({ compact }: { compact?: boolean }) {
  return (
    <div className={cn("grid gap-x-4 gap-y-6", !compact && "grid-cols-3")}>
      {GROUPS.map((g) => (
        <div key={g.id}>
          <p className="flex items-center gap-2 px-2.5 text-[13.5px] font-medium text-[#0B0B0C]">
            <g.icon aria-hidden className="size-4 shrink-0" />
            {g.title}
          </p>
          <ul className="mt-1.5">
            {g.items.map((item) => {
              const it = itemInfo(item);
              return (
                <li key={it.key}>
                  <Link href={it.href} className={menuLink}>
                    {it.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function SiteNav() {
  const scrolled = useScrolled();
  // Desktop: which panel is open, and whether a click (not a hover) opened it.
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [pinned, setPinned] = useState(false);
  const [morePlays, setMorePlays] = useState(false);
  // Phone: the sheet, and which accordion inside it is open.
  const [sheet, setSheet] = useState(false);
  const [section, setSection] = useState<MenuId | null>(null);

  const root = useRef<HTMLElement>(null);
  const sheetButton = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const closeMenu = useCallback(() => {
    clearTimeout(timer.current);
    setMenu(null);
    setPinned(false);
  }, []);

  const closeAll = useCallback(() => {
    closeMenu();
    setSheet(false);
  }, [closeMenu]);

  useEffect(() => {
    if (!menu && !sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) {
        root.current
          ?.querySelector<HTMLButtonElement>(`[data-menu-button="${menu}"]`)
          ?.focus();
      } else {
        sheetButton.current?.focus();
      }
      closeAll();
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) closeAll();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [menu, sheet, closeAll]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const hoverOpen = (id: MenuId) => {
    clearTimeout(timer.current);
    if (!pinned) setMenu(id);
  };
  const hoverLeave = () => {
    clearTimeout(timer.current);
    if (!pinned) timer.current = setTimeout(() => setMenu(null), 180);
  };
  const toggle = (id: MenuId) => {
    clearTimeout(timer.current);
    if (menu === id && pinned) {
      closeMenu();
    } else {
      setMenu(id);
      setPinned(true);
    }
  };
  const focusFirst = (id: MenuId) => {
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(`#menu-${id} a, #menu-${id} button`)
        ?.focus(),
    );
  };

  // Any link inside a panel or the sheet closes it.
  const closeOnLink = (e: React.MouseEvent) => {
    if ((e.target as Element).closest("a")) closeAll();
  };

  const open = menu !== null || sheet;

  const usecases = (
    <div
      id="menu-use-cases"
      hidden={menu !== "use-cases"}
      onClick={closeOnLink}
      className={cn(
        glass,
        "absolute -inset-x-px top-full mt-2 hidden rounded-2xl p-3 shadow-[0_30px_60px_-30px_rgba(40,30,20,0.35)]",
        menu === "use-cases" && "lg:block",
      )}
    >
      <MotionLinks />
      <div className="mt-2 border-t border-dashed border-black/10 pt-2">
        <button
          type="button"
          aria-expanded={morePlays}
          aria-controls="menu-plays"
          onClick={() => setMorePlays((v) => !v)}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[14.5px] font-medium text-[#0B0B0C] transition-colors hover:bg-black/[0.05]",
            ring,
          )}
        >
          See more plays
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 transition-transform duration-200",
              morePlays && "rotate-180",
            )}
          />
        </button>
        <div id="menu-plays" hidden={!morePlays} className="px-0.5 pt-3 pb-1">
          <PlayColumns />
        </div>
      </div>
    </div>
  );

  const platform = (
    <div
      id="menu-platform"
      hidden={menu !== "platform"}
      onClick={closeOnLink}
      className={cn(
        glass,
        "absolute -inset-x-px top-full mt-2 hidden max-h-[calc(100dvh-96px)] overflow-y-auto overscroll-contain rounded-2xl p-5 shadow-[0_30px_60px_-30px_rgba(40,30,20,0.35)]",
        menu === "platform" && "lg:block",
      )}
    >
      <PlatformColumns />
      <div className="mt-4 border-t border-dashed border-black/10 pt-3">
        <Link
          href="/platform"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[14px] font-medium text-[#0B0B0C] transition-colors hover:bg-black/[0.05]",
            ring,
          )}
        >
          Platform overview
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </div>
  );

  return (
    <header
      ref={root}
      className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4"
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={hoverLeave}
      onBlur={(e) => {
        // Tabbing out of the nav closes the panel.
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget))
          closeMenu();
      }}
    >
      <nav aria-label="Main" className="relative mx-auto max-w-[1180px]">
        <div
          className={cn(
            "relative flex items-center justify-between rounded-2xl border px-3 py-2 transition-[background-color,border-color,backdrop-filter] duration-500 sm:px-4",
            scrolled || open
              ? "border-black/[0.08] bg-white/85 backdrop-blur-xl"
              : "border-black/[0.06] bg-white/75 backdrop-blur-xl",
          )}
        >
          <Link
            href="/"
            aria-label="Dialvo home"
            className={cn(
              "flex h-9 items-center rounded-lg px-1 text-[#0B0B0C]",
              ring,
            )}
          >
            <Logo className="h-[22px]" />
          </Link>

          <ul className="hidden items-center gap-0.5 lg:flex">
            {MENUS.map((m) => {
              const on = menu === m.id;
              return (
                <li key={m.id} onMouseEnter={() => hoverOpen(m.id)}>
                  <button
                    type="button"
                    data-menu-button={m.id}
                    aria-expanded={on}
                    aria-controls={`menu-${m.id}`}
                    onClick={() => toggle(m.id)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMenu(m.id);
                        setPinned(true);
                        focusFirst(m.id);
                      }
                    }}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-3 py-2 text-[14px] transition-colors hover:text-[#0B0B0C]",
                      on ? "text-[#0B0B0C]" : "text-[#0B0B0C]/70",
                      ring,
                    )}
                  >
                    {m.label}
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "size-3.5 transition-transform duration-200",
                        on && "rotate-180",
                      )}
                    />
                  </button>
                  {/* The panel sits right after its button, so Tab moves
                      from one into the other. Both panels stay in the page
                      (hidden) so their links are always there for search
                      engines and for aria-controls. */}
                  {m.id === "use-cases" ? usecases : platform}
                </li>
              );
            })}
            <li
              onMouseEnter={() => {
                if (!pinned) closeMenu();
              }}
            >
              <Link
                href="/pricing"
                className={cn(
                  "rounded-full px-3 py-2 text-[14px] text-[#0B0B0C]/70 transition-colors hover:text-[#0B0B0C]",
                  ring,
                )}
              >
                Pricing
              </Link>
            </li>
          </ul>

          <div className="flex items-center gap-2">
            <Link
              href="/#channels"
              className={cn(
                "hidden h-9 items-center rounded-full border border-black/20 px-4 text-[14px] font-medium text-[#0B0B0C] transition-colors hover:bg-black/[0.08] xl:inline-flex",
                ring,
              )}
            >
              See the product
            </Link>
            <a
              href={startHref()}
              className={cn(
                "hidden h-9 items-center rounded-full bg-[#0B0B0C] px-4 text-[14px] font-medium text-white transition-colors hover:bg-black/85 sm:inline-flex",
                ring,
              )}
            >
              Get early access
            </a>
            <button
              ref={sheetButton}
              type="button"
              aria-label={sheet ? "Close menu" : "Open menu"}
              aria-expanded={sheet}
              aria-controls="menu-sheet"
              onClick={() => setSheet((o) => !o)}
              className={cn(
                "grid size-9 place-items-center rounded-full text-[#0B0B0C] lg:hidden",
                ring,
              )}
            >
              {sheet ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {/* The phone sheet. */}
        {sheet && (
          <div
            id="menu-sheet"
            onClick={closeOnLink}
            className={cn(
              glass,
              "mt-2 max-h-[calc(100dvh-84px)] overflow-y-auto overscroll-contain rounded-2xl p-2 lg:hidden",
            )}
          >
            {MENUS.map((m) => {
              const on = section === m.id;
              return (
                <div key={m.id}>
                  <button
                    type="button"
                    aria-expanded={on}
                    aria-controls={`sheet-${m.id}`}
                    onClick={() => setSection(on ? null : m.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[16px] text-[#0B0B0C]/85 hover:bg-black/[0.05]",
                      ring,
                    )}
                  >
                    {m.label}
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "size-4 transition-transform duration-200",
                        on && "rotate-180",
                      )}
                    />
                  </button>
                  <div
                    id={`sheet-${m.id}`}
                    hidden={!on}
                    className="px-1.5 pt-1 pb-3"
                  >
                    {m.id === "use-cases" ? (
                      <>
                        <MotionLinks compact />
                        <p className="mt-3 mb-3 border-t border-dashed border-black/10 px-2.5 pt-4 text-[14.5px] font-medium">
                          Plays
                        </p>
                        <PlayColumns compact />
                      </>
                    ) : (
                      <>
                        <PlatformColumns compact />
                        <Link
                          href="/platform"
                          className={cn(
                            menuLink,
                            "mt-4 inline-flex items-center gap-1.5 font-medium text-[#0B0B0C]",
                          )}
                        >
                          Platform overview
                          <ArrowRight aria-hidden className="size-3.5" />
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            <Link
              href="/pricing"
              className={cn(
                "block rounded-xl px-4 py-3 text-[16px] text-[#0B0B0C]/85 hover:bg-black/[0.05]",
                ring,
              )}
            >
              Pricing
            </Link>
            <a
              href={startHref()}
              className="mt-1 flex h-11 items-center justify-center rounded-xl bg-[#0B0B0C] text-[15px] font-medium text-white"
            >
              Get early access
            </a>
            <Link
              href="/#channels"
              className="mt-2 flex h-11 items-center justify-center rounded-xl border border-black/15 text-[15px] font-medium text-[#0B0B0C]"
            >
              See the product
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}
