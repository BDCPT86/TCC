/* TCC Push Service Worker
   Handles incoming Web Push notifications for the live score page.
   Kept separate from the scorer SW (scoring/sw.js) to avoid scope conflicts.
*/

self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}

  var title = data.title || 'TCC Live Score';
  var body  = data.body  || 'Match update';
  var icon  = data.icon  || '/images/tcc-logo.png';
  var badge = '/images/tcc-logo.png';
  var url   = data.url   || '/live.html';

  e.waitUntil(
    self.registration.showNotification(title, {
      body:    body,
      icon:    icon,
      badge:   badge,
      tag:     data.tag || 'tcc-match',
      renotify: true,
      data:    { url: url }
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/live.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.includes('/live.html')) {
          return list[i].focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
