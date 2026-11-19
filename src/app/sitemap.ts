import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Every public page. Add new pages here.
const PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/pricing", priority: 0.9 },
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
