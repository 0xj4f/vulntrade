/**
 * VULN: Service worker caches sensitive data including JWT tokens,
 * user profiles, and API responses containing flags.
 * This makes data persist even after logout and accessible via
 * Chrome DevTools > Application > Cache Storage.
 */

const CACHE_NAME = 'vulntrade-cache-v1';
const SENSITIVE_URLS = [
  '/api/auth/login',
  '/api/users/',
  '/api/accounts/balance',
  '/api/admin/users',
  '/api/market/prices',
  '/api/debug/user-info',
  '/actuator/env',
];

// Install - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(self.clients.claim());
});

// Fetch - VULN: cache ALL API responses including sensitive data
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // VULN: Cache sensitive API responses
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/actuator/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return fetch(event.request.clone()).then((response) => {
          // VULN: Cache everything, including auth tokens and user data
          if (response.ok) {
            cache.put(event.request, response.clone());
            console.log('[SW] Cached sensitive response:', url.pathname);
          }
          return response;
        }).catch(() => {
          // Serve from cache if offline
          return cache.match(event.request);
        });
      })
    );
  }
});
