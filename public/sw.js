const PAGE_CACHE = "carecircle-pages-v1";
const STATIC_ASSETS = "carecircle-static-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "chat-forget") {
    event.waitUntil(Promise.all([caches.delete(PAGE_CACHE), caches.delete("carecircle-chat-pages")]));
  }
});

function isPortalPage(pathname) {
  return pathname === "/patient" || pathname.startsWith("/patient/")
    || pathname === "/doctor" || pathname.startsWith("/doctor/")
    || pathname === "/admin" || pathname.startsWith("/admin/");
}

function isPrefetch(request) {
  return request.headers.get("Next-Router-Prefetch") === "1"
    || request.headers.get("Purpose") === "prefetch"
    || request.headers.get("Sec-Purpose") === "prefetch";
}

async function fromNetworkOrCache(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (!self.navigator.onLine && cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    if (cached) return cached;
    throw new Error("offline");
  }
}

function offlineDocument() {
  const html = "<!doctype html><title>Offline</title><body style=\"font-family:Segoe UI,sans-serif;padding:2rem;color:#0C2B45\"><h1>You're offline</h1><p>Pages you have already opened on this device still open. Changes you make sync when the internet returns.</p></body>";
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function pageCacheKey(url, kind) {
  const key = new URL(url.href);
  key.searchParams.delete("_rsc");
  key.searchParams.set("carecircle", kind);
  return new Request(key.toString());
}

async function portalPage(request, url) {
  const kind = request.mode === "navigate" ? "doc" : "rsc";
  const cacheKey = pageCacheKey(url, kind);
  const cache = await caches.open(PAGE_CACHE);
  const cached = await cache.match(cacheKey);
  if (!self.navigator.onLine && cached) return cached;
  try {
    const response = await fetch(request);
    const type = response.headers.get("content-type") || "";
    const page = type.includes("text/html") || type.includes("text/x-component");
    if (response.ok && page) await cache.put(cacheKey, response.clone());
    return response;
  } catch {
    if (cached) return cached;
    if (request.mode === "navigate") return offlineDocument();
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || isPrefetch(request)) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(fromNetworkOrCache(STATIC_ASSETS, request));
    return;
  }

  const portalDocument = request.mode === "navigate" || request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  if (isPortalPage(url.pathname) && portalDocument) {
    event.respondWith(portalPage(request, url));
  }
});
