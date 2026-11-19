import { StickyBuy } from "../buy";
import { SiteFooter } from "../footer";
import { SiteNav } from "../nav";
import { FinalCall } from "../sections";
import { SiteFrame } from "../theme";

/** The frame every content page shares: nav, the page, the last call, footer. */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <SiteFrame>
      <SiteNav />
      <main className="flex-1">
        {children}
        <FinalCall />
      </main>
      <SiteFooter />
      <StickyBuy />
    </SiteFrame>
  );
}
