import Image from "next/image";
import {
  CircleCheck,
  Headphones,
  Info,
  MessagesSquare,
  PhoneForwarded,
} from "lucide-react";
import { cn } from "@/lib/utils";
import painting from "../../../public/images/art/heade-york-harbor.jpg";
import { CallPlayer } from "./call-player";
import { Rise, Words } from "./motion";
import { card, GRAIN, muted, serif } from "./theme";

// "You stay in control": nothing an agent does is out of sight. The player
// under the four cards is a sample script (public/audio/demo-call.json) of an
// inbound speed-to-lead call, labelled as an example, never a real
// customer's call.

const CONTROLS = [
  {
    icon: Headphones,
    title: "Listen to every call",
    body: "Each call is recorded and transcribed, with a short summary of what was asked, answered and agreed.",
  },
  {
    icon: MessagesSquare,
    title: "Read every message",
    body: "Every email, chat, text and direct message sits in one inbox, next to the research it was written from.",
  },
  {
    icon: CircleCheck,
    title: "Approve before send",
    body: "Keep agents on approval for as long as you like: for everything, for first messages, or above a threshold you set.",
  },
  {
    icon: PhoneForwarded,
    title: "Human handoff",
    body: "When a buyer wants a person, the call is put through or the thread is passed to a rep, with a summary.",
  },
];

export function ControlSection() {
  return (
    <section id="control" className="scroll-mt-20 px-5 py-28 sm:py-36">
      <div className="mx-auto max-w-[1180px]">
        <Words
          text="You stay in control"
          className={`${serif} max-w-[800px] text-[42px] leading-[1.02] sm:text-[60px]`}
        />
        <Rise delay={0.2}>
          <p
            className={`mt-5 max-w-[560px] text-[17px] leading-[1.55] ${muted}`}
          >
            Agents work on their own, but never out of sight. You can hear what
            was said, read what was sent, decide what needs your yes, and step
            in whenever you want.
          </p>
        </Rise>
      </div>

      <div className="mx-auto mt-14 grid max-w-[1180px] gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CONTROLS.map((s, i) => (
          <Rise
            key={s.title}
            delay={i * 0.07}
            className={cn(card, "flex flex-col p-6")}
          >
            <span className="grid size-11 place-items-center rounded-2xl bg-[#0B0B0C] text-white">
              <s.icon aria-hidden className="size-5" />
            </span>
            <h3 className={`${serif} mt-7 text-[26px] leading-[1.08]`}>
              {s.title}
            </h3>
            <p className={`mt-3 text-[14.5px] leading-[1.6] ${muted}`}>
              {s.body}
            </p>
          </Rise>
        ))}
      </div>

      {/* The sample call and its transcript, on a pale painting. */}
      <Rise
        delay={0.1}
        className="relative isolate mx-auto mt-3 max-w-[1180px] scroll-mt-24 overflow-hidden rounded-[32px] border border-black/[0.07]"
      >
        <div id="listen" className="absolute -top-24" />
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
        <div className="p-4 sm:p-10 lg:p-12">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/75 px-3 py-1 text-[12.5px] text-[#0B0B0C]/75 backdrop-blur-md">
                <span className="size-1.5 rounded-full bg-[#1F3BFF]" />
                Example · sample call script
              </p>
              <h3
                className={`${serif} mt-4 max-w-[560px] text-[30px] leading-[1.06] sm:text-[38px]`}
              >
                A form lead, called back within a minute
              </h3>
            </div>
          </div>
          <CallPlayer />
        </div>
      </Rise>

      <Rise className="mx-auto mt-6 flex max-w-[1180px] items-start justify-center gap-2.5 px-2 text-center">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className={`text-[14.5px] leading-[1.55] ${muted}`}>
          <span className="text-[#0B0B0C]">This is an example.</span> A sample
          script written for this page, not a recording of a real customer call.
          The people and businesses in it are made up.
        </p>
      </Rise>
    </section>
  );
}
