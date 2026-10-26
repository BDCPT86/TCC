const CACHE = 'tcc-scorer-v108';
const ASSETS = [
  './',
  './index.html',
  './scoring.css',
  './scoring.js',
  './scorer-user-guide.html',
  './recover.html',
  './manual-scorecard.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function(cache) {
        // addAll fails if any asset 404s — use individual adds so one failure
        // doesn't break the whole install
        return Promise.allSettled(
          ASSETS.map(function(url) {
            /* cache:'reload' skips the browser's HTTP cache, so a new
               version installs the new files instead of re-caching stale
               copies of scoring.js / scoring.css. */
            return cache.add(new Request(url, { cache: 'reload' })).catch(function(err) {
              console.warn('SW: failed to cache', url, err);
            });
          })
        );
      })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE; })
          .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Always network-first for API / Supabase / Worker calls
  if (url.includes('supabase') || url.includes('workers.dev') || url.includes('fonts.googleapis')) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Cache-first for app shell assets
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(response) {
        // Cache successful GET responses for app assets
        if (e.request.method === 'GET' && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      });
    }).catch(function() {
      // Offline fallback — serve the app shell
      return caches.match('./index.html');
    })
  );
});

// Handle skip waiting message from the page
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
