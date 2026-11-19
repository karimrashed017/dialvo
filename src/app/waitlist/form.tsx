"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { CONTACT_EMAIL } from "@/lib/site";

const field =
  "mt-1.5 w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-[15px] text-[#0B0B0C] outline-none placeholder:text-[#0B0B0C]/35 focus:border-[#1F3BFF] focus:ring-2 focus:ring-[#1F3BFF]/20";
const label = "block text-[13px] font-medium text-[#0B0B0C]/80";

const PROBLEMS: Record<string, string> = {
  name: "Please add your name.",
  email: "That email doesn't look right.",
};

export function WaitlistForm() {
  const params = useSearchParams();
  const plan = params.get("plan") ?? "";
  const play = params.get("play") ?? "";
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setState("sending");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...data, plan, play }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        field?: string;
      };
      if (res.ok && json.ok) return setState("done");
      setError(
        json.reason === "invalid"
          ? (PROBLEMS[json.field ?? ""] ??
              "Please check the form and try again.")
          : json.reason === "limited"
            ? "That's a lot of sign-ups from one place. Try again in an hour."
            : `We couldn't save that just now. Please email ${CONTACT_EMAIL} and we'll add you.`,
      );
    } catch {
      setError(
        `We couldn't reach the server. Please try again, or email ${CONTACT_EMAIL}.`,
      );
    }
    setState("idle");
  }

  if (state === "done")
    return (
      <div
        role="status"
        className="rounded-3xl border border-black/10 bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(0,0,0,0.25)]"
      >
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#1F3BFF] text-white">
          <Check className="size-6" aria-hidden />
        </span>
        <h2 className="mt-5 text-[22px] font-medium tracking-[-0.01em]">
          You&apos;re on the waitlist.
        </h2>
        <p className="mx-auto mt-2 max-w-[380px] text-[15px] leading-[1.6] text-[#0B0B0C]/65">
          We&apos;re bringing teams on in small groups. We&apos;ll email you
          when it&apos;s your turn.
        </p>
      </div>
    );

  return (
    <form
      onSubmit={submit}
      className="rounded-3xl border border-black/10 bg-white p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.25)] sm:p-8"
    >
      {(plan || play) && (
        <p className="mb-5 rounded-xl bg-[#1F3BFF]/[0.06] px-3.5 py-2.5 text-[13px] text-[#0B0B0C]/75">
          {plan && (
            <>
              Plan: <span className="font-medium capitalize">{plan}</span>
            </>
          )}
          {plan && play && " · "}
          {play && (
            <>
              First play: <span className="font-medium">{play}</span>
            </>
          )}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Your name
          <input
            name="name"
            required
            maxLength={100}
            autoComplete="name"
            className={field}
          />
        </label>
        <label className={label}>
          Work email
          <input
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            className={field}
          />
        </label>
        <label className={label}>
          Company{" "}
          <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
          <input
            name="company"
            maxLength={150}
            autoComplete="organization"
            className={field}
          />
        </label>
        <label className={label}>
          Website{" "}
          <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
          <input
            name="website"
            maxLength={200}
            placeholder="yourcompany.com"
            className={field}
          />
        </label>
        <label className={`${label} sm:col-span-2`}>
          What do you sell, and to whom?{" "}
          <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
          <textarea name="sells" rows={3} maxLength={500} className={field} />
        </label>
        <label className={`${label} sm:col-span-2`}>
          New leads a month{" "}
          <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
          <select name="leads" defaultValue="" className={field}>
            <option value="">Choose one</option>
            <option>Under 50</option>
            <option>50 to 200</option>
            <option>200 to 1,000</option>
            <option>Over 1,000</option>
          </select>
        </label>
      </div>
      {/* Hidden from people; bots fill it in. */}
      <input
        name="url2"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
      />
      {error && (
        <p role="alert" className="mt-4 text-[14px] text-[#B42318]">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === "sending"}
        className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0B0B0C] text-[15px] font-medium text-white transition hover:bg-black disabled:opacity-60"
      >
        {state === "sending" ? "Adding you…" : "Join the waitlist"}
        <ArrowRight className="size-4" aria-hidden />
      </button>
      <p className="mt-3 text-center text-[12px] text-[#0B0B0C]/45">
        We only use this to contact you about Dialvo. No spam.
      </p>
    </form>
  );
}
