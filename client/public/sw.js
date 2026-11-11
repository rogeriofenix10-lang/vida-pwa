// Iris PWA — cache local básico; APIs e arquivos privados nunca são interceptados.
const CACHE_NAME = "iris-pwa-v6-private-cache-guard";
const APP_SHELL = ["/", "/manifest.webmanifest", "/iris.svg", "/icons/iris-192.png", "/icons/iris-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("iris-pwa-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isApiRequest =
    url.pathname.startsWith("/api/") || url.pathname.startsWith("/__manus__/");
  const isPrivateResource =
    url.pathname.startsWith("/manus-storage/") ||
    request.headers.has("Authorization") ||
    request.headers.has("Cookie") ||
    /(?:private|no-store)/i.test(request.headers.get("Cache-Control") || "");
  if (request.method !== "GET" || !isSameOrigin || isApiRequest || isPrivateResource) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        const cacheControl = response.headers.get("Cache-Control") || "";
        if (response.ok && !/(?:private|no-store)/i.test(cacheControl)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || Response.error()),
      ),
  );
});
