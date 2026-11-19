import { SiteFooter } from "../_site/footer";
import { SiteNav } from "../_site/nav";
import { serif, SiteFrame, siteViewport } from "../_site/theme";

export const viewport = siteViewport;

/** A plain page of legal text, marked as a draft until a lawyer reviews it. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <SiteFrame>
      <SiteNav />
      <main className="flex-1 px-5 pt-36 pb-24 sm:pt-44">
        <article className="mx-auto max-w-[720px]">
          <p
            role="note"
            className="rounded-2xl border border-dashed border-black/25 px-4 py-3 text-[14px] leading-[1.55] text-[#0B0B0C]/75"
          >
            <span className="font-medium text-[#0B0B0C]">Draft.</span> This is a
            plain-language placeholder while Dialvo is in early access. It
            hasn&apos;t been reviewed by a lawyer yet and will change before
            launch.
          </p>
          <h1
            className={`${serif} mt-10 text-[48px] leading-none sm:text-[64px]`}
          >
            {title}
          </h1>
          <p className="mt-4 text-[14px] text-[#0B0B0C]/50">
            Last updated {updated}
          </p>
          <div className="prose mt-10 max-w-none prose-neutral prose-headings:font-medium prose-headings:tracking-[-0.01em] prose-p:text-[#0B0B0C]/75 prose-li:text-[#0B0B0C]/75">
            {children}
          </div>
        </article>
      </main>
      <SiteFooter />
    </SiteFrame>
  );
}
