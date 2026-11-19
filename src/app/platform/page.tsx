import type { Metadata } from "next";
import { PLATFORM_PAGE } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { PlatformPage } from "../_site/pages/platform-page";
import { siteViewport } from "../_site/theme";

export const viewport = siteViewport;

export const metadata: Metadata = pageMetadata({
  title: `${PLATFORM_PAGE.title} · Dialvo`,
  description: PLATFORM_PAGE.description,
  path: "/platform",
});

export default function Page() {
  return <PlatformPage />;
}
