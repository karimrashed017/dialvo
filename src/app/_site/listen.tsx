import Image from "next/image";
import { FileText, Info, Mic, PhoneForwarded } from "lucide-react";
import { cn } from "@/lib/utils";
import painting from "../../../public/images/art/heade-york-harbor.jpg";
import { CallPlayer } from "./call-player";
import { Rise, Words } from "./motion";
import { card, GRAIN, muted, serif } from "./theme";

// "Listen to every call": the biggest section, because being able to hear
// exactly what the AI said is what makes people trust it. The call is a
// sample script (public/audio/demo-call.json), labelled as a demo, never a
// real customer's call.

const STEPS = [
  {
    icon: Mic,
    title: "Every call recorded",
    body: "Each call is recorded, and the person on the other end is told so at the start.",
  },
  {
    icon: FileText,
    title: "Read every word",
    body: "Transcripts and a short summary of every call and message, so you know what was said and agreed.",
  },
  {
    icon: PhoneForwarded,
    title: "Jump in live",
    body: "When a prospect wants a person, Dialvo puts the call through to you, mid-conversation.",
  },
];

export function ListenSection() {
  return (
    <section id="listen" className="scroll-mt-20 px-5 pt-32 pb-24 sm:pt-40">
      <div className="mx-auto max-w-[1180px] text-center">
        <Rise>
          <p className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[13px] text-[#0B0B0C]/75">
            <span className="size-1.5 rounded-full bg-[#0B0B0C]" />
            Demo · sample call script
          </p>
        </Rise>
        <Words
          text="Listen to every call."
          className={`${serif} mx-auto mt-6 max-w-[900px] text-[52px] leading-[0.98] sm:text-[88px]`}
        />
        <Rise delay={0.3}>
          <p
            className={`mx-auto mt-6 max-w-[600px] text-[18px] leading-[1.55] ${muted}`}
          >
            Nothing happens out of sight. Hear exactly what Dialvo said, how it
            handled the hard part and what was agreed. Press play on a sample
            call: an AI calling an agency owner for a web design studio.
          </p>
        </Rise>
      </div>

      {/* The player and its transcript, on a pale painting. */}
      <Rise
        delay={0.1}
        className="relative isolate mx-auto mt-16 max-w-[1180px] overflow-hidden rounded-[32px] border border-black/[0.07]"
      >
        <Image
          src={painting}
          alt=""
          sizes="(min-width: 1180px) 1180px, 100vw"
          className="absolute inset-0 -z-20 h-full w-full object-cover object-[50%_40%]"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background: `${GRAIN}, linear-gradient(180deg, rgba(247,245,241,0.55), rgba(247,245,241,0.2) 45%, rgba(247,245,241,0.45))`,
          }}
        />
        <div className="p-5 sm:p-10 lg:p-14">
          <CallPlayer />
        </div>
      </Rise>

      <div className="mx-auto mt-3 grid max-w-[1180px] gap-3 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <Rise
            key={s.title}
            delay={i * 0.08}
            className={cn(card, "flex flex-col p-7")}
          >
            <div className="flex items-center justify-between">
              <span className="grid size-11 place-items-center rounded-2xl bg-[#0B0B0C] text-white">
                <s.icon aria-hidden className="size-5" />
              </span>
              <span className="text-[13px] text-[#0B0B0C]/40 tabular-nums">
                0{i + 1}
              </span>
            </div>
            <h3 className={`${serif} mt-8 text-[28px] leading-[1.08]`}>
              {s.title}
            </h3>
            <p className={`mt-3 text-[15px] leading-[1.6] ${muted}`}>
              {s.body}
            </p>
          </Rise>
        ))}
      </div>

      <Rise className="mx-auto mt-6 flex max-w-[1180px] items-start justify-center gap-2.5 px-2 text-center">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className={`text-[14.5px] leading-[1.55] ${muted}`}>
          <span className="text-[#0B0B0C]">This is a demo.</span> A sample
          script written for this page, not a recording of a real customer call.
          The people and businesses in it are made up.
        </p>
      </Rise>
    </section>
  );
}
