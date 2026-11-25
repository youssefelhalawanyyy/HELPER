const CACHE_NAME = 'devdeck-shell-v14';
const PRECACHE_URLS = [
  '/manifest.json',
  '/keepawake.mp4',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never intercept cross-origin bridge/tunnel API or WebSocket calls
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || req.headers.has('authorization')) return;

  // Network-first for HTML page navigations so deployments apply immediately on refresh!
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then((c) => c.put(req, res.clone())).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // Stale-while-revalidate for static assets (icons, hashed JS/CSS chunks)
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);

      return cached || networkPromise;
    }),
  );
});

self.addEventListener('push', event => {
  const message = event.data?.json()?.message || 'Website status changed';
  event.waitUntil(self.registration.showNotification('DevDeck • Website Monitor', {
    body: message, icon: '/icons/icon-192.png',
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/?view=webmonitor'));
});
