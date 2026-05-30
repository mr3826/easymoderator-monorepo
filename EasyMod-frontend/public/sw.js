/**
 * EasyMod Service Worker
 *
 * Two jobs:
 *   1. PWA offline shell — installable app for phone-only BD sellers on patchy
 *      networks. Navigations are network-first with an offline cache fallback;
 *      hashed build assets are cache-first (stale-while-revalidate).
 *   2. Web Push — incoming push events → browser notifications (unchanged).
 *
 * API calls (/api/*) and cross-origin requests are never intercepted.
 */

const CACHE_VERSION = 'easymod-v1';
const APP_SHELL = ['/', '/app', '/manifest.webmanifest', '/icon-512.png'];

// ── Install: precache the app shell ────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: drop old caches, take control immediately ────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: offline-tolerant routing ────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only handle same-origin GETs; never touch the API.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // SPA navigations: network-first, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('/app', copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/app') || caches.match('/')))
    );
    return;
  }

  // Hashed build assets (immutable): cache-first with background refresh.
  if (url.pathname.startsWith('/assets/') || /\.(?:js|css|woff2?|png|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});

// ── Web Push ────────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'EasyMod', body: event.data.text() };
  }

  const { title = 'EasyMod', body = '', icon = '/icon-512.png', data = {} } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/icon-512.png',
      data,
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
