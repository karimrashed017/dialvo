import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FEATURES, FEATURE_SLUGS } from "@/lib/content/catalog";
import { APP_FEATURES, isFeatureSlug } from "@/lib/plays/catalog";
import { cn } from "@/lib/utils";
import { btn, PageHead } from "../../_ui/kit";
import { BeingBuilt } from "../../plays/ui";

// A platform feature that isn't built yet: what it will do and what it
// needs. A feature that works sends you to where it lives.

export function generateStaticParams() {
  return FEATURE_SLUGS.filter(isFeatureSlug).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/app/features/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return { title: isFeatureSlug(slug) ? FEATURES[slug].title : "Features" };
}

export default async function FeaturePage({
  params,
}: PageProps<"/app/features/[slug]">) {
  const { slug } = await params;
  if (!isFeatureSlug(slug)) notFound();
  const feature = APP_FEATURES[slug];
  if (!feature) notFound();
  if (
    feature.status !== "building" ||
    !feature.href.startsWith("/app/features")
  )
    redirect(feature.href);
  return (
    <>
      <PageHead title={FEATURES[slug].title}>
        <Link href="/app/features" className={cn(btn.ghost, btn.small)}>
          <ArrowLeft aria-hidden className="size-3.5" />
          All features
        </Link>
      </PageHead>
      <BeingBuilt
        title={FEATURES[slug].title}
        what={feature.note}
        needs={feature.needs ?? []}
      />
    </>
  );
}
