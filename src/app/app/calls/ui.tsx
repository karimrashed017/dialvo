import Link from "next/link";
import { phoneRuntime, TWILIO_PRICES } from "@/lib/phone/config";
import { cn } from "@/lib/utils";
import { panel, panelHead } from "../_ui/kit";

// The pieces the Calls pages share: the tabs, and the plain note that says
// which server value switches each part on, and what Twilio charges.

const TABS = [
  { id: "calls", href: "/app/calls", label: "Calls" },
  { id: "numbers", href: "/app/calls/numbers", label: "Numbers" },
  { id: "settings", href: "/app/calls/settings", label: "Settings" },
] as const;

export function CallsTabs({
  current,
}: {
  current: (typeof TABS)[number]["id"];
}) {
  return (
    <nav
      aria-label="Calls"
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

const WHAT: Record<string, string> = {
  TWILIO_ACCOUNT_SID:
    "Twilio's account id (AC...). Turns on numbers, calls and texts, with TWILIO_AUTH_TOKEN.",
  TWILIO_AUTH_TOKEN:
    "Twilio's auth token. Also checks that every webhook really comes from Twilio.",
  SUPABASE_SECRET_KEY:
    "Lets the webhooks and the scheduler write calls and texts without a signed-in person.",
  ANTHROPIC_API_KEY:
    "Lets the agent talk. Without it, calls go to your transfer number.",
};

/** Says exactly what isn't switched on yet on Dialvo's side, and the price. */
export function SetupNotice({ prices = false }: { prices?: boolean }) {
  const runtime = phoneRuntime();
  if (runtime.missing.length === 0 && !prices) return null;
  return (
    <section className={cn(panel, "mb-3")}>
      <h2 className={panelHead}>
        {runtime.missing.length
          ? "Calls aren't switched on yet on Dialvo's side"
          : "What Twilio charges"}
      </h2>
      <div className="space-y-3 p-4 text-[13px] leading-[1.5]">
        {runtime.missing.length > 0 && (
          <>
            <p className="text-[#0B0B0C]/70">
              Numbers, calls and texts run on Twilio. Nothing on these pages is
              made up: until these server values are set, nothing can be bought,
              dialled or texted, and the lists stay empty.
            </p>
            <ul className="space-y-1.5">
              {runtime.missing.map((name) => (
                <li key={name}>
                  <code className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[12px]">
                    {name}
                  </code>{" "}
                  <span className="text-[#0B0B0C]/60">{WHAT[name]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div>
          <p className="font-medium">
            Twilio&apos;s prices (US, pay as you go)
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[#0B0B0C]/60">
            <li>{TWILIO_PRICES.localNumberMonth}</li>
            <li>{TWILIO_PRICES.inboundMinute}</li>
            <li>{TWILIO_PRICES.speech}</li>
            <li>{TWILIO_PRICES.voice}</li>
            <li>{TWILIO_PRICES.recording}</li>
            <li>{TWILIO_PRICES.sms}</li>
            <li>{TWILIO_PRICES.a2p}</li>
          </ul>
          <p className="mt-1 text-[12px] text-[#0B0B0C]/45">
            Read from twilio.com on 21 Nov 2026. The agent&apos;s replies also
            use the language model, billed separately.
          </p>
        </div>
      </div>
    </section>
  );
}

export const CALL_STATUS: Record<string, string> = {
  queued: "Queued",
  ringing: "Ringing",
  in_progress: "In progress",
  completed: "Completed",
  missed: "Missed",
  voicemail: "Voicemail",
  failed: "Failed",
};

export const CALL_OUTCOME: Record<string, string> = {
  qualified: "Qualified",
  not_qualified: "Not a fit",
  needs_human: "Needs a person",
  transferred: "Transferred",
  opted_out: "Asked not to be called",
  no_answer: "No answer",
  voicemail: "Voicemail",
  none: "No outcome",
};

export const duration = (s: number | null) =>
  s == null ? "" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

/** The instant n days ago, for "the last 7 days" reads. */
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
