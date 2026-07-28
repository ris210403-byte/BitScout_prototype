// biteScout service worker — network-first for the app, cache-first for assets.
// Network-first matters while we iterate: a cache-first shell can serve a stale
// app for a whole load after you deploy. Offline still works via the cache fallback.
const CACHE = 'bitescout-v13';
const SHELL = ['./', './index.html', './support.js', './bitescout-live.js', './manifest.json', './icon-192.png', './icon-512.png'];
const ASSET = /\.(png|jpg|jpeg|svg|webp|woff2?|ttf)$/i;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // images, fonts, map tiles: cache-first (they never change under the same URL)
  if (ASSET.test(url.pathname) || url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // the app itself: always try the network, fall back to cache when offline
  if (sameOrigin) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
  }
});
