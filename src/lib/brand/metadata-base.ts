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

const LIVE_SITE = "https://brain-health-connect.vercel.app";

function localHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/** Public site used in emails. A local address is never sent to a patient. */
export function publicAppOrigin(explicit?: string | null): string {
  const production = productionOrigin();
  for (const raw of [explicit, process.env.APP_BASE_URL]) {
    const url = httpOrigin(raw?.trim());
    if (!url || localHost(url.hostname)) continue;
    if (production && url.hostname.endsWith(".vercel.app") && url.hostname !== production.hostname) {
      return production.origin;
    }
    return url.origin;
  }
  return production?.origin ?? LIVE_SITE;
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
