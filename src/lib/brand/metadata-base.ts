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

/** Absolute origin for Open Graph, Twitter, the sitemap, and canonical URLs. */
export function metadataBase(): URL | undefined {
  const configured = httpOrigin(process.env.APP_BASE_URL?.trim());
  if (configured) return configured;
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return httpOrigin(`https://${productionHost.replace(/^https?:\/\//, "")}`);
  if (process.env.NODE_ENV !== "production") return new URL("http://localhost:3000");
  return undefined;
}
