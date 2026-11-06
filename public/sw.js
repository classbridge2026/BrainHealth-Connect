const CHAT_PAGES = "carecircle-chat-pages";
const STATIC_ASSETS = "carecircle-static-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "chat-forget") {
    event.waitUntil(caches.delete(CHAT_PAGES));
  }
});

function isChatPage(pathname) {
  return pathname === "/patient/messages"
    || pathname.startsWith("/patient/messages/")
    || pathname === "/doctor/messages"
    || pathname.startsWith("/doctor/messages/")
    || pathname === "/admin/messages"
    || pathname.startsWith("/admin/messages/");
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

async function chatPage(request, url) {
  const kind = request.mode === "navigate" ? "doc" : "rsc";
  const cacheKey = new Request(`${url.origin}${url.pathname}?carecircle=${kind}`);
  const cache = await caches.open(CHAT_PAGES);
  const cached = await cache.match(cacheKey);
  if (!self.navigator.onLine && cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheKey, response.clone());
    return response;
  } catch {
    if (cached) return cached;
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

  const chatDocument = request.mode === "navigate" || request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  if (isChatPage(url.pathname) && chatDocument) {
    event.respondWith(chatPage(request, url));
  }
});
