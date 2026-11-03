import type { Metadata, MetadataRoute } from "next";

/** Pages a search engine should list. Portals and account tools stay out. */
export const PUBLIC_INDEX_PATHS = ["/", "/login", "/register", "/privacy", "/terms", "/support"] as const;

export const privateRobots: Metadata["robots"] = {
  index: false,
  follow: false,
};

export function publicDescription(systemName: string) {
  return `Book a mental health appointment or an online consultation with ${systemName} in Sierra Leone.`;
}

export function homeTitle(systemName: string) {
  return `${systemName} | Mental health appointments`;
}

export function publicSitemap(origin: URL): MetadataRoute.Sitemap {
  return PUBLIC_INDEX_PATHS.map((path) => ({
    url: new URL(path, origin).href,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/login" || path === "/register" ? 0.8 : 0.4,
  }));
}
