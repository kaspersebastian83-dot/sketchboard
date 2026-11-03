// Offline service worker for the GitHub Pages build. The app is a single
// self-contained HTML file, so caching it (plus manifest and icons) is enough
// for the whole app to open with no network at all.
//
// The build stamps a content hash into VERSION. When the page changes, this
// file changes, the browser installs the new worker in the background, and the
// page offers a reload — it never swaps the app out from under you mid-note.

const VERSION = '__VERSION__';
const CACHE = `sketchboard-${VERSION}`;
const PRECACHE = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('sketchboard-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live-collab relay traffic and anything outside our scope goes straight through.
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  if (request.mode === 'navigate') {
    // Cache first: the app opens instantly on a building site with no signal.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./');
      if (cached) return cached;
      try { return await fetch(request); } catch { return Response.error(); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return fetch(request);
  })());
});
