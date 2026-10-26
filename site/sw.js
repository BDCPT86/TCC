/**
 * TCC Service Worker — Image Cache
 * Caches Supabase Storage images after first load.
 * Subsequent visits serve from cache instantly.
 */

var CACHE_NAME    = 'tcc-images-v1';
var SUPABASE_HOST = 'cgjannvzpqecwzjdzwso.supabase.co';

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  // Clean up old caches on activation
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k)   { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Only cache GET requests from Supabase Storage
  if (e.request.method !== 'GET') return;
  if (url.hostname !== SUPABASE_HOST) return;
  if (!url.pathname.includes('/storage/v1/object/public/')) return;

  // Cache-first strategy for images
  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        if (cached) return cached;

        // Not in cache — fetch, store and return
        return fetch(e.request).then(function(response) {
          // Only cache valid image responses
          if (response.ok && response.status === 200) {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(function() {
          // Network failed and nothing cached — return nothing gracefully
          return new Response('', { status: 503 });
        });
      });
    })
  );
});
