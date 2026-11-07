export type PageHere = { origin: string; pathname: string; search: string };

/** Same-origin page a click would open. Skips the current page, files, and APIs. */
export function pageHref(href: string, here: PageHere) {
  if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return null;
  let url: URL;
  try {
    url = new URL(href, here.origin);
  } catch {
    return null;
  }
  if (url.origin !== here.origin) return null;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return null;
  const next = `${url.pathname}${url.search}`;
  if (next === `${here.pathname}${here.search}`) return null;
  return next;
}

export function isPortalPath(pathname: string) {
  return pathname.startsWith("/patient") || pathname.startsWith("/doctor") || pathname.startsWith("/admin");
}
