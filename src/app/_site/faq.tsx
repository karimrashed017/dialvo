"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { CONTACT_EMAIL } from "@/lib/site";
import { cn } from "@/lib/utils";
import { Rise, Words } from "./motion";
import { muted, serif } from "./theme";

export type Faq = { q: string; a: string };

/** Questions in tabs, each opening in place. */
export function FaqSection({ groups }: { groups: Record<string, Faq[]> }) {
  const names = Object.keys(groups);
  const [tab, setTab] = useState(names[0]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section id="faq" className="scroll-mt-20 px-5 py-28 sm:py-36">
      <div className="mx-auto grid max-w-[1180px] gap-12 lg:grid-cols-[1fr_1.5fr]">
        <div>
          <Words
            text="Before you ask"
            className={`${serif} text-[44px] leading-[1.02] sm:text-[60px]`}
          />
          <Rise delay={0.2}>
            <p
              className={`mt-5 max-w-[360px] text-[17px] leading-[1.55] ${muted}`}
            >
              Straight answers to what people ask us first. Anything else, email{" "}
              {CONTACT_EMAIL}.
            </p>
          </Rise>
        </div>
        <Rise>
          <div
            role="tablist"
            aria-label="Topics"
            className="flex flex-wrap gap-2"
          >
            {names.map((n) => (
              <button
                key={n}
                role="tab"
                type="button"
                aria-selected={tab === n}
                onClick={() => {
                  setTab(n);
                  setOpen(null);
                }}
                className={cn(
                  "h-9 rounded-full px-4 text-[14px] transition-colors",
                  tab === n
                    ? "bg-[#0B0B0C] text-white"
                    : "border border-black/12 text-[#0B0B0C]/70 hover:text-[#0B0B0C]",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <ul className="mt-6 divide-y divide-black/[0.08] border-y border-black/[0.08]">
            {groups[tab].map((f) => {
              const isOpen = open === f.q;
              return (
                <li key={f.q}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : f.q)}
                    className="flex w-full items-center justify-between gap-6 py-5 text-left text-[16.5px]"
                  >
                    {f.q}
                    <Plus
                      aria-hidden
                      className={cn(
                        "size-5 shrink-0 text-[#0B0B0C]/60 transition-transform duration-300",
                        isOpen && "rotate-45",
                      )}
                    />
                  </button>
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-300",
                      isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <p
                      className={`overflow-hidden pr-10 text-[15px] leading-[1.6] ${muted} ${isOpen ? "pb-6" : ""}`}
                    >
                      {f.a}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Rise>
      </div>
    </section>
  );
}
