// Minimal service worker: network-first for navigation (so deploys land immediately), with a
// cached app-shell fallback for offline opens on the tablet. Static assets are cache-first —
// Vite fingerprints them, so stale entries are impossible.
const CACHE = 'rabbi-app-v2';  // bumped with the Rov Console redesign
const SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // never touch Supabase calls

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.match(/\.(png|svg|ico|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then((hit) =>
        hit ?? fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        }),
      ),
    );
  }
});
