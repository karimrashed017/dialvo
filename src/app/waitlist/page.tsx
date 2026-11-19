import type { Metadata } from "next";
import { Suspense } from "react";
import { pageMetadata } from "@/lib/seo";
import { SiteFooter } from "../_site/footer";
import { SiteNav } from "../_site/nav";
import { serif, SiteFrame, siteViewport } from "../_site/theme";
import { WaitlistForm } from "./form";

export const viewport = siteViewport;

export const metadata: Metadata = pageMetadata({
  title: "Join the waitlist · Dialvo",
  description:
    "Join the Dialvo waitlist. AI sales agents for every channel, free until your first booked meeting. We bring teams on in small groups.",
  path: "/waitlist",
});

export default function Waitlist() {
  return (
    <SiteFrame>
      <SiteNav />
      <main className="flex-1 px-5 pt-36 pb-24 sm:pt-44">
        <div className="mx-auto max-w-[620px]">
          <p className="text-center text-[13px] font-medium tracking-[0.08em] text-[#1F3BFF] uppercase">
            Early access
          </p>
          <h1
            className={`${serif} mt-4 text-center text-[44px] leading-[1.02] sm:text-[60px]`}
          >
            Join the waitlist
          </h1>
          <p className="mx-auto mt-5 max-w-[480px] text-center text-[16px] leading-[1.6] text-[#0B0B0C]/65">
            Dialvo is opening to teams in small groups. Tell us a little about
            your business and we&apos;ll email you when it&apos;s your turn.
            Free until your first booked meeting.
          </p>
          <div className="mt-10">
            {/* The form reads the plan or play from the address. */}
            <Suspense>
              <WaitlistForm />
            </Suspense>
          </div>
        </div>
      </main>
      <SiteFooter />
    </SiteFrame>
  );
}
