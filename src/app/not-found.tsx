import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter } from "./_site/footer";
import { SiteNav } from "./_site/nav";
import { muted, serif, SiteFrame } from "./_site/theme";

export default function NotFound() {
  return (
    <SiteFrame>
      <SiteNav />
      <main className="flex flex-1 flex-col items-center justify-center px-5 pt-40 pb-32 text-center">
        <p className="text-[13px] text-[#0B0B0C]/45">404</p>
        <h1 className={`${serif} mt-4 text-[48px] leading-none sm:text-[72px]`}>
          Nothing here.
        </h1>
        <p className={`mt-5 max-w-[420px] text-[17px] leading-[1.55] ${muted}`}>
          This page doesn&apos;t exist, or it moved. Try the home page, or have
          a look at the product.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-[#0B0B0C] px-6 text-[15.5px] font-medium text-white hover:bg-black/85"
          >
            Go home
            <ArrowRight aria-hidden className="size-4" />
          </Link>
          <Link
            href="/#channels"
            className="inline-flex h-12 items-center rounded-full border border-black/10 bg-white/70 px-6 text-[15.5px] hover:bg-white"
          >
            See the product
          </Link>
        </div>
      </main>
      <SiteFooter />
    </SiteFrame>
  );
}
