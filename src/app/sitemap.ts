import type { MetadataRoute } from "next";
import { metadataBase } from "@/lib/brand/metadata-base";
import { publicSitemap } from "@/lib/brand/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = metadataBase();
  if (!origin) return [];
  return publicSitemap(origin);
}
