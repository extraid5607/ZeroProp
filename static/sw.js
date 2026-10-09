// ZeroProp Progressive Web App Service Worker
const CACHE_NAME = 'zeroprop-pwa-v1';

const STATIC_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/manifest.json',
  '/css/app.css',
  '/js/app.js',
  '/js/util.js',
  '/js/store.js',
  '/js/api.js',
  '/js/theme.js',
  '/js/chart.js',
  '/js/ticket.js',
  '/js/dock.js',
  '/js/dialogs.js',
  '/js/views/trade.js',
  '/js/views/journal.js',
  '/js/views/stats.js',
  '/js/views/rules.js',
  '/js/views/leaderboard.js',
  '/js/views/auth.js',
  '/img/logo.svg',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/img/apple-touch-icon.png',
  '/fonts/ibm-plex-sans-latin-wdth-normal.woff2',
  '/vendor/lightweight-charts.standalone.production.js',
];

// Install: pre-cache application shell for offline support and instant loading
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_SHELL).catch((err) => {
        console.warn('Some shell files failed to cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old versions and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: stale-while-revalidate for static assets, network-first for live APIs
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-GET requests or WebSocket connections
  if (req.method !== 'GET' || url.protocol.startsWith('ws')) {
    return;
  }

  // Live market API data: Network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // App Shell & Static Assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
