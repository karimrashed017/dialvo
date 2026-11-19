import { Inter, Newsreader } from "next/font/google";
import { cn } from "@/lib/utils";
import { SmoothAnchors } from "./smooth-scroll";

// Dialvo's site: warm paper with a fine grain, thin Newsreader serif
// headlines, Geist for everything else, and public-domain paintings behind
// the big sections. Black and white everywhere else.

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["300", "400"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

// The phone screens' font where San Francisco isn't installed (phone.tsx).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const INK = "#0B0B0C";

/** The page: a warm off-white with a fine grain, like paper. */
export const PAPER = "#F7F5F1";

// Fine grain, drawn once as a tiny SVG and tiled. Kept faint so it reads as
// texture, not dirt.
export const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.3 0 0 0 0 0.25 0 0 0 0.09 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** The phone's browser bar matches the site (export as `viewport`). */
export const siteViewport = { themeColor: PAPER };
export const CARD = "#FFFFFF";

/** Serif display classes; add a size. */
export const serif =
  "font-[family-name:var(--font-newsreader)] font-light tracking-[-0.035em]";

/** Every page's frame: colours, fonts, and room for the floating nav. */
export function SiteFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        newsreader.variable,
        inter.variable,
        "flex min-h-full flex-1 flex-col font-[family-name:var(--font-geist-sans)] text-[#0B0B0C] selection:bg-[#0B0B0C] selection:text-white",
        className,
      )}
      style={{ backgroundColor: PAPER, backgroundImage: GRAIN }}
    >
      {/* Phones show the page behind the frame when you scroll past the top
          or the bottom: make it this site's paper too. */}
      <style>{`html,body{background-color:${PAPER};color-scheme:light}`}</style>
      <SmoothAnchors />
      {children}
    </div>
  );
}

/** A white card lifted off the paper by a hairline and a soft shadow. */
export const card =
  "rounded-[24px] border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-18px_rgba(60,45,30,0.18)]";

export const muted = "text-[#0B0B0C]/[0.62]";
