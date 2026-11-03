import type { MetadataRoute } from "next";
import { metadataBase } from "@/lib/brand/metadata-base";

export default function robots(): MetadataRoute.Robots {
  const origin = metadataBase();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/patient", "/doctor", "/admin", "/api", "/verify", "/reset-password", "/forgot-password", "/account-unavailable", "/offline"],
    },
    sitemap: origin ? new URL("/sitemap.xml", origin).href : undefined,
  };
}
