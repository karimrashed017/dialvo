import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { Logo, Mark } from "@/components/brand/logo";
import { CONTACT_EMAIL } from "@/lib/site";
import painting from "../../../public/images/art/heade-york-harbor.jpg";
import { GRAIN, serif, SiteFrame } from "../_site/theme";

/**
 * The page around every auth form: the form on paper to the left, and on
 * wide screens a painting to the right with an example of the product.
 */
export function AuthFrame({
  title,
  intro,
  children,
  footer,
  points,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Short reassurances listed under the form (sign-up). */
  points?: string[];
}) {
  return (
    <SiteFrame>
      <div className="grid min-h-dvh flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex flex-col px-5 pt-7 pb-8 sm:px-10">
          <header className="flex items-center justify-between">
            <Link
              href="/"
              aria-label="Dialvo home"
              className="inline-block rounded-md focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
            >
              <Logo className="h-6" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[13.5px] text-[#0B0B0C]/55 transition-colors hover:text-[#0B0B0C]"
            >
              <ArrowLeft aria-hidden className="size-3.5" />
              Back to the site
            </Link>
          </header>
          <main className="flex flex-1 flex-col justify-center py-12">
            <div className="auth-rise mx-auto w-full max-w-[400px]">
              <h1
                className={`${serif} text-[42px] leading-[1.04] sm:text-[48px]`}
              >
                {title}
              </h1>
              {intro && (
                <p className="mt-3 text-[15.5px] leading-[1.55] text-[#0B0B0C]/65">
                  {intro}
                </p>
              )}
              <div className="mt-8">{children}</div>
              {points && (
                <ul className="mt-7 space-y-2 border-t border-black/[0.08] pt-6 text-[13.5px] text-[#0B0B0C]/65">
                  {points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5">
                      <Check
                        aria-hidden
                        className="mt-[3px] size-3.5 shrink-0 text-[#0B0B0C]"
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              )}
              {footer && (
                <p className="mt-7 text-[14.5px] text-[#0B0B0C]/65">{footer}</p>
              )}
            </div>
          </main>
          <p className="text-[12.5px] text-[#0B0B0C]/40">
            © 2026 Dialvo ·{" "}
            <Link href="/privacy" className="hover:text-[#0B0B0C]">
              Privacy
            </Link>{" "}
            ·{" "}
            <Link href="/terms" className="hover:text-[#0B0B0C]">
              Terms
            </Link>
          </p>
        </div>
        <AuthArt />
      </div>
      <style>{`@keyframes auth-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}.auth-rise{animation:auth-rise .6s cubic-bezier(.2,.7,.2,1) both}.auth-rise-late{animation:auth-rise .7s .25s cubic-bezier(.2,.7,.2,1) both}@media (prefers-reduced-motion:reduce){.auth-rise,.auth-rise-late{animation:none}}`}</style>
    </SiteFrame>
  );
}

const bubble =
  "max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-[1.45]";

/** Wide screens only: a painting, the promise, and an example chat. */
function AuthArt() {
  return (
    <aside
      aria-hidden
      className="relative isolate m-3 hidden overflow-hidden rounded-[32px] border border-black/[0.08] lg:sticky lg:top-3 lg:flex lg:h-[calc(100dvh-1.5rem)] lg:flex-col lg:justify-between lg:p-10 xl:p-14"
    >
      <Image
        src={painting}
        alt=""
        priority
        sizes="55vw"
        className="absolute inset-0 -z-20 h-full w-full object-cover"
      />
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: `${GRAIN}, linear-gradient(180deg, rgba(247,245,241,0.82) 0%, rgba(247,245,241,0.25) 42%, rgba(247,245,241,0.05) 100%)`,
        }}
      />
      <div className="auth-rise max-w-[460px]">
        <p className={`${serif} text-[40px] leading-[1.05] xl:text-[48px]`}>
          Every lead answered within a minute.
        </p>
        <p className="mt-4 max-w-[380px] text-[15.5px] leading-[1.55] text-[#0B0B0C]/70">
          Your agent replies from what you&apos;ve taught it, asks your
          qualifying questions and hands the good ones to your team.
        </p>
      </div>
      <div className="auth-rise-late w-full max-w-[400px] self-end rounded-[24px] border border-white/60 bg-white/85 p-4 shadow-[0_30px_80px_-30px_rgba(20,30,50,0.45)] backdrop-blur-xl">
        <div className="flex items-center gap-2.5 border-b border-black/[0.07] pb-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-[#0B0B0C]">
            <Mark white className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] leading-tight font-medium">
              Inbound agent
            </p>
            <p className="text-[12px] leading-tight text-[#0B0B0C]/50">
              Website chat
            </p>
          </div>
          <span className="rounded-full border border-black/15 px-2 py-0.5 text-[11px] text-[#0B0B0C]/55">
            Example
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <p className={`${bubble} self-start bg-black/[0.055]`}>
            Do you work with clinics that have more than one location?
          </p>
          <p className={`${bubble} self-end bg-[#0B0B0C] text-white`}>
            We do. How many locations do you have, and when would you like to
            start?
          </p>
          <p className={`${bubble} self-start bg-black/[0.055]`}>
            Three. Next month if we can.
          </p>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-black/[0.04] px-3 py-2 text-[12.5px] text-[#0B0B0C]/75">
          <span className="flex size-4 items-center justify-center rounded-full bg-[#0B0B0C] text-white">
            <Check className="size-2.5" strokeWidth={3} />
          </span>
          Qualified and handed to your team
        </div>
      </div>
    </aside>
  );
}

export const authLink =
  "font-medium text-[#0B0B0C] underline decoration-black/25 underline-offset-[3px] hover:decoration-black";

/** Shown at /login, /signup and /app until the database is connected. */
export function SetupNotice() {
  return (
    <SiteFrame>
      <header className="px-5 pt-7 sm:px-8">
        <Link href="/" aria-label="Dialvo home" className="inline-block">
          <Logo className="h-6" />
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-5 pt-10 pb-28 text-center">
        <p className="text-[13px] font-medium tracking-[0.08em] text-[#0B0B0C]/55 uppercase">
          One moment
        </p>
        <h1
          className={`${serif} mt-4 max-w-[560px] text-[40px] leading-[1.05] sm:text-[54px]`}
        >
          Dialvo&apos;s app is being set up
        </h1>
        <p className="mt-5 max-w-[440px] text-[16px] leading-[1.6] text-[#0B0B0C]/65">
          Log-in isn&apos;t available right now. Please try again shortly.
          Questions?{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={authLink}>
            {CONTACT_EMAIL}
          </a>
        </p>
        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex h-12 items-center rounded-full border border-black/10 bg-white/70 px-6 text-[15.5px] hover:bg-white"
          >
            Back to the site
          </Link>
        </div>
      </main>
    </SiteFrame>
  );
}
