import type { MetadataRoute } from "next";
import {
  FEATURE_SLUGS,
  featureHref,
  MOTIONS,
  PLAY_SLUGS,
  playHref,
} from "@/lib/content/catalog";
import { SITE_URL } from "@/lib/site";

// Every public page. The motion, play and platform pages come from the
// content catalog, so a new entry there is listed here by itself.
const PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/pricing", priority: 0.9 },
  { path: "/waitlist", priority: 0.8 },
  ...MOTIONS.map((m) => ({ path: m.href, priority: 0.9 })),
  { path: "/platform", priority: 0.8 },
  { path: "/plays", priority: 0.8 },
  ...PLAY_SLUGS.map((s) => ({ path: playHref(s), priority: 0.7 })),
  ...FEATURE_SLUGS.map((s) => ({ path: featureHref(s), priority: 0.6 })),
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({
    url: `${SITE_URL}${p.path === "/" ? "" : p.path}`,
    changeFrequency: "weekly",
    priority: p.priority,
  }));
}
