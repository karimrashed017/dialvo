import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The signed-in app, its doors and the endpoints behind them. (They
      // also send noindex themselves.)
      disallow: [
        "/app",
        "/onboarding",
        "/login",
        "/signup",
        "/logout",
        "/forgot-password",
        "/reset-password",
        "/auth/",
        "/api/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
