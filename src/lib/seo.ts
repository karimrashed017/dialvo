import type { Metadata } from "next";
import { SITE_NAME } from "./site";

// Search and share metadata for the public pages. Canonical URLs are relative
// to metadataBase (trydialvo.com, set in the root layout), so preview
// deployments never compete with the real site in search.

/** The share card every page uses (public/og.png, 1200x630). */
export const SHARE_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "Dialvo: AI sales agents for every channel, across inbound, outbound and expansion.",
};

/** Title, description, canonical URL and share text for one public page. */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title,
      description,
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SHARE_IMAGE],
    },
  };
}

/**
 * A JSON-LD <script> body. `<` is escaped so text in the data can never
 * close the script tag.
 */
export function jsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
