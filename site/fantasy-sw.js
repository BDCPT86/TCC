/**
 * TCC Fantasy Cricket — Service Worker
 * Caches the fantasy shell (HTML/CSS/JS/fonts) for fast load and basic offline.
 * Live data (Supabase API) always goes to network — stale picks would be worse than no offline.
 */

var SHELL_CACHE    = 'tcc-fantasy-shell-v2';
var IMAGE_CACHE    = 'tcc-fantasy-images-v1';
var SUPABASE_HOST  = 'cgjannvzpqecwzjdzwso.supabase.co';

var SHELL_URLS = [
  '/fantasy.html',
  '/leaderboard.html',
  '/pick.html',
  '/css/fantasy.css',
  '/css/leaderboard.css',
  '/css/pick.css',
  '/js/fantasy.js',
  '/js/leaderboard.js',
  '/js/pick.js',
  '/images/tcc-logo.png',
  '/images/tcc-logo.webp',
  '/images/apple-touch-icon.png',
  '/images/favicon.ico',
  '/fantasy-manifest.json'
];

/* ── INSTALL: pre-cache shell ── */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function(cache) {
      return cache.addAll(SHELL_URLS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

/* ── ACTIVATE: prune old caches ── */
self.addEventListener('activate', function(e) {
  var keep = [SHELL_CACHE, IMAGE_CACHE];
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return !keep.includes(k); })
            .map(function(k)   { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;

  var url = new URL(e.request.url);

  // Supabase API calls — always network, never cache (live data, auth tokens)
  if (url.hostname === SUPABASE_HOST && url.pathname.includes('/rest/v1/')) {
    return; // fall through to browser default
  }

  // Supabase Storage images — cache-first
  if (url.hostname === SUPABASE_HOST && url.pathname.includes('/storage/v1/object/public/')) {
    e.respondWith(
      caches.open(IMAGE_CACHE).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          if (cached) return cached;
          return fetch(e.request).then(function(response) {
            if (response.ok) cache.put(e.request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  // Shell files — cache-first, fall back to network
  if (url.hostname === self.location.hostname) {
    e.respondWith(
      caches.open(SHELL_CACHE).then(function(cache) {
        return cache.match(e.request).then(function(cached) {
          // Always try network in background to keep cache fresh
          var networkFetch = fetch(e.request).then(function(response) {
            if (response.ok) cache.put(e.request, response.clone());
            return response;
          }).catch(function() { return cached; });

          // Serve cached immediately if available, otherwise wait for network
          return cached || networkFetch;
        });
      })
    );
  }
});
