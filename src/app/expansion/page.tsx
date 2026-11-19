import type { Metadata } from "next";
import { MOTION_PAGES } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { MotionPage } from "../_site/pages/motion-page";
import { siteViewport } from "../_site/theme";

export const viewport = siteViewport;

const page = MOTION_PAGES.expansion;

export const metadata: Metadata = pageMetadata({
  title: `${page.title} · Dialvo`,
  description: page.description,
  path: "/expansion",
});

export default function Page() {
  return <MotionPage id="expansion" />;
}
