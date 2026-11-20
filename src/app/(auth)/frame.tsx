import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { CONTACT_EMAIL } from "@/lib/site";
import { serif, SiteFrame } from "../_site/theme";

/** The page around every auth form: paper, the logo, one white card. */
export function AuthFrame({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <SiteFrame>
      <header className="px-5 pt-7 sm:px-8">
        <Link
          href="/"
          aria-label="Dialvo home"
          className="inline-block rounded-md focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none"
        >
          <Logo className="h-6" />
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center px-5 pt-12 pb-20 sm:pt-20">
        <div className="w-full max-w-[420px]">
          <h1 className={`${serif} text-center text-[40px] leading-[1.05]`}>
            {title}
          </h1>
          {intro && (
            <p className="mx-auto mt-3 max-w-[360px] text-center text-[15px] leading-[1.55] text-[#0B0B0C]/65">
              {intro}
            </p>
          )}
          <div className="mt-8 rounded-3xl border border-black/10 bg-white p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.25)] sm:p-7">
            {children}
          </div>
          {footer && (
            <p className="mt-5 text-center text-[14px] text-[#0B0B0C]/65">
              {footer}
            </p>
          )}
        </div>
      </main>
    </SiteFrame>
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
        <p className="text-[13px] font-medium tracking-[0.08em] text-[#1F3BFF] uppercase">
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
