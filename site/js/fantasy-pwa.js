/**
 * TCC Fantasy Cricket — PWA helpers
 * Registers the service worker and handles the install prompt banner.
 * Shared across fantasy.html, leaderboard.html, pick.html.
 */

(function() {

  /* ── Register service worker ── */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/fantasy-sw.js', { scope: '/' })
        .then(function(reg) {
          // Check for updates on every page load
          reg.update();
        })
        .catch(function(err) {
          console.warn('Fantasy SW registration failed:', err);
        });
    });
  }

  /* ── Install prompt (Android Chrome / Samsung Browser) ── */
  var deferredPrompt = null;
  var banner = document.getElementById('pwa-banner');
  var installBtn = document.getElementById('pwa-install-btn');
  var closeBtn = document.getElementById('pwa-banner-close');
  var DISMISSED_KEY = 'tcc-pwa-dismissed';

  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;

    // Don't show if user already dismissed
    if (sessionStorage.getItem(DISMISSED_KEY)) return;
    // Don't show if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Show banner after a short delay so it doesn't flash immediately on load
    setTimeout(function() {
      if (banner) banner.style.display = 'flex';
    }, 3000);
  });

  if (installBtn) {
    installBtn.addEventListener('click', function() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function(result) {
        deferredPrompt = null;
        if (banner) banner.style.display = 'none';
      });
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', function() {
      if (banner) banner.style.display = 'none';
      sessionStorage.setItem(DISMISSED_KEY, '1');
    });
  }

  /* ── iOS Safari install hint ── */
  // iOS doesn't fire beforeinstallprompt — show a manual hint instead
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isStandalone = window.navigator.standalone === true;
  var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  if (isIOS && isSafari && !isStandalone && !sessionStorage.getItem(DISMISSED_KEY)) {
    setTimeout(function() {
      if (!banner) return;
      // Swap text for iOS-specific instruction
      var titleEl = banner.querySelector('.pwa-banner-title');
      var subEl   = banner.querySelector('.pwa-banner-sub');
      var btnEl   = document.getElementById('pwa-install-btn');
      if (titleEl) titleEl.textContent = 'Add to Home Screen';
      if (subEl)   subEl.textContent   = 'Tap Share  then "Add to Home Screen"';
      if (btnEl)   btnEl.style.display = 'none'; // no programmatic prompt on iOS
      banner.style.display = 'flex';
    }, 3000);
  }

  /* ── Hide banner if already running as PWA ── */
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    if (banner) banner.style.display = 'none';
  }

})();
