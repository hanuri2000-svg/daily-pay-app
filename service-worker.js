const APP_SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = "rabic-gongsu-pro:" + encodeURIComponent(APP_SCOPE.href) + ":v";
const CACHE_NAME = CACHE_PREFIX + "5.6.9";
// Only cache families shipped by this application are eligible for migration.
const LEGACY_CACHE = /^(?:rabic-gongsu-pro|labor-settlement-pro)-v\d+(?:[.-]\d+)*$/;
const APP_FILES = [
  "./", "./index.html", "./manifest.webmanifest", "./version.json",
  "./favicon.ico", "./favicon-32.png", "./icon-180.png", "./icon-192.png",
  "./icon-512.png", "./icon-maskable-512.png"
];
const APP_URLS = new Set(APP_FILES.map(path => new URL(path, APP_SCOPE).href));

function isAppURL(url) {
  return url.origin === APP_SCOPE.origin && url.pathname.startsWith(APP_SCOPE.pathname);
}

async function isOwnedCache(key) {
  if (key.startsWith(CACHE_PREFIX)) return true;
  if (!LEGACY_CACHE.test(key)) return false;
  // Legacy names were not scoped. Leave ambiguous caches for other deployments alone.
  const cache = await caches.open(key);
  const requests = await cache.keys();
  return requests.every(request => isAppURL(new URL(request.url)));
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Bypass HTTP cache so a successful install contains the new release's app shell.
    await cache.addAll(APP_FILES.map(path => new Request(new URL(path, APP_SCOPE), {cache: "reload"})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(async key => {
      if (key !== CACHE_NAME && await isOwnedCache(key)) await caches.delete(key);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (!isAppURL(url)) return;
  // Release/check timestamps must not prevent offline use of known app files.
  url.searchParams.delete("v");
  url.searchParams.delete("t");
  const cacheKey = APP_URLS.has(url.href) ? url.href : event.request;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(cache.put(cacheKey, copy).catch(() => {}));
      }
      return response;
    } catch (err) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
      if (event.request.mode === "navigate") {
        const page = await cache.match(new URL("./index.html", APP_SCOPE).href);
        if (page) return page;
      }
      return Response.error();
    }
  })());
});
