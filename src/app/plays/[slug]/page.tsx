import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  motionById,
  PLAY_PAGES,
  PLAY_SLUGS,
  PLAYS,
  type PlaySlug,
} from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { PlayPage } from "../../_site/pages/play-page";
import { siteViewport } from "../../_site/theme";

export const viewport = siteViewport;

// Every play is built ahead of time; any other slug is a 404.
export function generateStaticParams() {
  return PLAY_SLUGS.map((slug) => ({ slug }));
}

const isPlay = (slug: string): slug is PlaySlug => Object.hasOwn(PLAYS, slug);

export async function generateMetadata({
  params,
}: PageProps<"/plays/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!isPlay(slug)) return {};
  const play = PLAYS[slug];
  return pageMetadata({
    title: `${play.title} · ${motionById(play.motion).name} play · Dialvo`,
    description: PLAY_PAGES[slug].description,
    path: `/plays/${slug}`,
  });
}

export default async function Page({ params }: PageProps<"/plays/[slug]">) {
  const { slug } = await params;
  if (!isPlay(slug)) notFound();
  return <PlayPage slug={slug} />;
}
