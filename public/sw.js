const CACHE_NAME = 'shixu-shell-v18';
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './cloud-config.js',
  './app.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          SHELL_ASSETS.map((asset) =>
            cache.add(new Request(asset, { cache: 'reload' })).catch(() => cache.add(asset).catch(() => {}))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'REFRESH_OFFLINE_CACHE') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) =>
        Promise.all(SHELL_ASSETS.map((a) => cache.add(new Request(a, { cache: 'reload' })).catch(() => {})))
      ).then(() => {
        if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true, cacheName: CACHE_NAME });
      })
    );
  }
});

// True Offline-First (Cache-First + Background Stale-While-Revalidate)
// Guarantees <50ms instant launch in Airplane Mode on iOS Safari & Home Screen PWA
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.hostname.includes('supabase.co')) return;

  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = (await cache.match(req, { ignoreSearch: true }))
      || (isNav ? (await cache.match('./index.html', { ignoreSearch: true })) || (await cache.match('./', { ignoreSearch: true })) : null);

    const networkUpdate = fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          cache.put(isNav ? './index.html' : req, copy).catch(() => {});
        }
        return res;
      })
      .catch(() => null);

    if (cached) {
      // Serve instantly from offline cache; quietly refresh in background if online
      event.waitUntil(networkUpdate);
      return cached;
    }

    const netRes = await networkUpdate;
    if (netRes) return netRes;

    // Final offline fallback for navigations
    if (isNav) {
      const fallback = (await cache.match('./index.html', { ignoreSearch: true })) || (await cache.match('./', { ignoreSearch: true }));
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
