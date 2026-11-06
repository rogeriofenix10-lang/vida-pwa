// Iris PWA — cache local básico; APIs e ações externas nunca são interceptadas.
const CACHE_NAME = "iris-pwa-v3-ocr-finance";
const APP_SHELL = ["/", "/manifest.webmanifest", "/iris.svg"];

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
            .filter((key) => key !== CACHE_NAME)
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
  if (request.method !== "GET" || !isSameOrigin || isApiRequest) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/")),
      ),
  );
});
