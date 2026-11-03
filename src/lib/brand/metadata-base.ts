function httpOrigin(raw: string | undefined): URL | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url;
  } catch {
    return undefined;
  }
  return undefined;
}

function productionOrigin(): URL | undefined {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/^https?:\/\//, "");
  if (!host) return undefined;
  return httpOrigin(`https://${host}`);
}

/** Absolute origin for Open Graph, Twitter, the sitemap, and canonical URLs. */
export function metadataBase(): URL | undefined {
  const configured = httpOrigin(process.env.APP_BASE_URL?.trim());
  const production = productionOrigin();
  if (configured && production && configured.hostname.endsWith(".vercel.app") && configured.hostname !== production.hostname) {
    return production;
  }
  if (configured) return configured;
  if (production) return production;
  if (process.env.NODE_ENV !== "production") return new URL("http://localhost:3000");
  return undefined;
}
