/* SH VALO TRACKER service worker: offline app shell + cached game data and images. */
const VERSION = "shv-2026-10-10a";
const SHELL = `shell-${VERSION}`, API = "api-v1", IMG = "img-v1";
const SHELL_FILES = [
  "./", "./index.html", "./manifest.webmanifest", "./css/app.css",
  "./js/app.js", "./js/data.js", "./js/crosshair.js", "./js/stats.js", "./js/config.js",
  "./data/snapshot.json",
  "./fonts/oswald-400-700.woff2", "./fonts/barlow-400.woff2", "./fonts/barlow-500.woff2", "./fonts/barlow-600.woff2",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-192.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("shell-") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});
async function trim(cacheName, max) {
  const c = await caches.open(cacheName); const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // App navigations: network first, fall back to the cached shell (works offline).
  if (req.mode === "navigate" && url.origin === location.origin) {
    e.respondWith(fetch(req).catch(() => caches.match("./index.html", { ignoreSearch: true })));
    return;
  }
  // Same-origin assets: cache first, refresh in the background.
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone())); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // Live game data: network first, cached copy when offline.
  if (url.hostname === "valorant-api.com") {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const cp = res.clone(); caches.open(API).then((c) => c.put(req, cp)); } return res; })
      .catch(() => caches.match(req)));
    return;
  }
  // Game art: cache first, keep the newest ~600 images.
  if (url.hostname === "media.valorant-api.com") {
    e.respondWith(caches.open(IMG).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") { c.put(req, res.clone()); trim(IMG, 600); }
      return res;
    }));
  }
  // Player stats are always fetched live (no caching).
});
