import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  FEATURE_PAGES,
  FEATURE_SLUGS,
  FEATURES,
  groupById,
  type FeatureSlug,
} from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { FeaturePage } from "../../_site/pages/feature-page";
import { siteViewport } from "../../_site/theme";

export const viewport = siteViewport;

// Every feature is built ahead of time; any other slug is a 404.
export function generateStaticParams() {
  return FEATURE_SLUGS.map((slug) => ({ slug }));
}

const isFeature = (slug: string): slug is FeatureSlug =>
  Object.hasOwn(FEATURES, slug);

export async function generateMetadata({
  params,
}: PageProps<"/platform/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!isFeature(slug)) return {};
  const feature = FEATURES[slug];
  return pageMetadata({
    title: `${feature.title} · ${groupById(feature.group).title} · Dialvo`,
    description: FEATURE_PAGES[slug].description,
    path: `/platform/${slug}`,
  });
}

export default async function Page({ params }: PageProps<"/platform/[slug]">) {
  const { slug } = await params;
  if (!isFeature(slug)) notFound();
  return <FeaturePage slug={slug} />;
}
