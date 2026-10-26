/* ══════════════════════════════════════════════════════
   TCC HOME FX  (v2)
   Motion + data layer for the homepage redesign.
   Pure enhancement: nothing here is load-bearing — the
   page works fully without it. Pairs with css/home.css.
   Reads SUPABASE_URL / SUPABASE_ANON_KEY / imgUrl from
   main.js (loaded first) — never duplicates them.
══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer  = window.matchMedia('(pointer: fine)').matches;
  var root = document.documentElement;

  /* ── HERO SLIDESHOW CONFIG ──────────────────────────────
     HERO_ALBUMS: gallery albums to cycle (names must match
     the album values in the admin gallery tab exactly).
     Empty array = draw from the whole gallery.
     e.g. ['1st XI vs Victoria CC', 'Finals Day 2026']
     HERO_POOL:   newest photos to draw from across albums.
     HERO_SLIDES: slides shown per visit, shuffled from the
     pool so each visit gets a different mix.              */
  var HERO_ALBUMS = ['1st XI vs Edgemead (2025/2026 Season)','2nd XI vs Claremont (2025/2026 Season)'];
  var HERO_POOL   = 30;
  var HERO_SLIDES = 4;

  var SB_URL = (typeof SUPABASE_URL      !== 'undefined') ? SUPABASE_URL      : null;
  var SB_KEY = (typeof SUPABASE_ANON_KEY !== 'undefined') ? SUPABASE_ANON_KEY : null;
  function sbHeaders() {
    return { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY };
  }
  function sized(url, w) {
    return (typeof imgUrl === 'function') ? imgUrl(url, w, 70) : url;
  }

  /* ── 1 · THE SEAM — scroll progress ─────────────────── */
  var ticking = false;
  function updateSeam() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    root.style.setProperty('--scroll-p', p.toFixed(4));
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { requestAnimationFrame(updateSeam); ticking = true; }
  }, { passive: true });
  updateSeam();

  /* ── 2 · GHOST WATERMARK PARALLAX ───────────────────── */
  if (!reduceMotion) {
    var ghosts = Array.prototype.slice.call(
      document.querySelectorAll('section[data-ghost]')
    );
    var gTicking = false;
    function updateGhosts() {
      var vh = window.innerHeight;
      ghosts.forEach(function (sec) {
        var r = sec.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        var t = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
        sec.style.setProperty('--ghost-y', (t * 70).toFixed(1) + 'px');
      });
      gTicking = false;
    }
    window.addEventListener('scroll', function () {
      if (!gTicking) { requestAnimationFrame(updateGhosts); gTicking = true; }
    }, { passive: true });
    updateGhosts();
  }

  /* ── 3 · FANTASY PANEL CURSOR GLOW ──────────────────── */
  var hfInner = document.querySelector('#home-fantasy .hf-inner');
  if (hfInner && finePointer && !reduceMotion) {
    hfInner.addEventListener('mousemove', function (e) {
      var r = hfInner.getBoundingClientRect();
      hfInner.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      hfInner.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    });
  }

  /* ── 4 · LIVING HERO — gallery slideshow ────────────────
     Crossfades recent photos from the configured albums
     (HERO_ALBUMS above) over the base hero.jpg. Starts
     well after load so LCP is safe. Slides mirror
     main.js's parallax (scrollY * 0.4) so there is no
     jump between the base image and slides.             */
  (function heroSlideshow() {
    if (reduceMotion || !SB_URL) return;
    var frame = document.querySelector('.hero-photo-frame');
    if (!frame) return;

    window.addEventListener('load', function () {
      setTimeout(function () {
        var q = SB_URL + '/rest/v1/gallery?select=url'
              + '&order=created_at.desc&limit=' + HERO_POOL;
        if (HERO_ALBUMS.length) {
          q += '&album=in.(' + encodeURIComponent(
                 HERO_ALBUMS.map(function (a) { return '"' + a + '"'; }).join(',')
               ) + ')';
        }
        fetch(q, { headers: sbHeaders() })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
          var urls = (rows || []).map(function (g) { return g.url; }).filter(Boolean);
          if (!urls.length) return;

          /* transform width matched to device: 400px buckets,
             capped at 1600 — phones fetch ~800px, not desktop weight */
          var slideW = Math.min(1600, Math.max(400,
            Math.ceil((window.innerWidth * (window.devicePixelRatio || 1)) / 400) * 400));

          /* shuffle the pool so each visit shows a different mix */
          for (var i = urls.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = urls[i]; urls[i] = urls[j]; urls[j] = tmp;
          }
          urls = urls.slice(0, HERO_SLIDES);

          var slides = urls.map(function (u) {
            var img = document.createElement('img');
            img.className = 'hero-slide';
            img.alt = '';
            img.setAttribute('aria-hidden', 'true');
            img.decoding = 'async';
            img.src = sized(u, slideW);
            frame.appendChild(img);
            return img;
          });

          /* gentle drift — 0.15, not main.js's 0.4: slides carry
             only 15% headroom so they stay true-to-size */
          var sTick = false;
          window.addEventListener('scroll', function () {
            if (!sTick) {
              requestAnimationFrame(function () {
                var y = window.scrollY * 0.15;
                slides.forEach(function (s) { s.style.transform = 'translateY(' + y + 'px)'; });
                sTick = false;
              });
              sTick = true;
            }
          }, { passive: true });
          slides.forEach(function (s) { s.style.transform = 'translateY(' + (window.scrollY * 0.15) + 'px)'; });

          /* cycle: base photo → slide 1 → slide 2 → … → base */
          var idx = -1;
          setInterval(function () {
            idx = (idx + 2 > slides.length) ? -1 : idx + 1;
            slides.forEach(function (s, i) { s.classList.toggle('active', i === idx); });
          }, 7500);
        })
        .catch(function () { /* hero.jpg alone is fine */ });
      }, 4000);
    });
  })();

  /* ── 5 · NEXT-MATCH COUNTDOWN ───────────────────────────
     Counts to midnight of the next fixture date (fixtures
     carry no start time), then shows MATCH DAY on the day.

     League cricket only. A tournament the club hosts has matches
     between other clubs in it, and this counted down to whichever
     came next — so it showed "TCC Cravenby CC vs Primrose CC",
     a match the club isn't even playing in. The tournament has
     its own strip right below this one. */
  (function countdown() {
    var box = document.getElementById('fx-countdown');
    if (!box || !SB_URL) return;

    var today = new Date();
    var todayStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');

    /* A handful, then the first league one — filtering here rather than in
       the query means an older database without the tournament column still
       gets its countdown. */
    fetch(SB_URL + '/rest/v1/fixtures?select=date,team,opponent,tournament_id'
        + '&date=gte.' + todayStr + '&order=date.asc&limit=20', {
      headers: sbHeaders()
    })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var f = (rows || []).filter(function (x) { return x && x.date && !x.tournament_id; })[0];
      if (!f) return;

      var parts = f.date.split('-');
      var target = new Date(+parts[0], +parts[1] - 1, +parts[2]);   // local midnight
      var isToday = (f.date === todayStr);
      var dateLabel = target.toLocaleDateString('en-ZA',
        { weekday: 'long', day: 'numeric', month: 'short' });
      /* "1st Team" needs the club in front of it; a side already named
         "Tygerberg CC" does not, or it reads "TCC Tygerberg CC". */
      var side = String(f.team || '').trim();
      var matchLabel = (/tygerberg|\btcc\b/i.test(side) ? side : ('TCC ' + side).trim()) +
                       ' vs ' + (f.opponent || 'TBC');

      box.innerHTML =
        '<div class="fxc-info">' +
          '<span class="fxc-label">' + (isToday ? 'Match Day' : 'Next Match') + '</span>' +
          '<span class="fxc-match"></span>' +
          '<span class="fxc-date">' + dateLabel + '</span>' +
        '</div>' +
        (isToday
          ? '<div class="fxc-live">Match Day</div>'
          : '<div class="fxc-timer">' +
              seg('d', 'Days') + seg('h', 'Hrs') + seg('m', 'Min') + seg('s', 'Sec') +
            '</div>');
      box.querySelector('.fxc-match').textContent = matchLabel;
      box.style.display = '';

      function seg(k, label) {
        return '<div class="fxc-seg"><span class="fxc-num" data-k="' + k + '">--</span>' +
               '<span class="fxc-unit">' + label + '</span></div>';
      }

      if (isToday) return;

      var nums = {};
      ['d', 'h', 'm', 's'].forEach(function (k) {
        nums[k] = box.querySelector('[data-k="' + k + '"]');
      });

      function tick() {
        var diff = target - new Date();
        if (diff <= 0) {                                  // rolled into match day
          var t = box.querySelector('.fxc-timer');
          if (t) t.outerHTML = '<div class="fxc-live">Match Day</div>';
          var lbl = box.querySelector('.fxc-label');
          if (lbl) lbl.textContent = 'Match Day';
          clearInterval(timer);
          return;
        }
        var s = Math.floor(diff / 1000);
        set('d', Math.floor(s / 86400));
        set('h', Math.floor(s % 86400 / 3600));
        set('m', Math.floor(s % 3600 / 60));
        set('s', s % 60);
      }
      function set(k, v) {
        var el = nums[k];
        var txt = String(v).padStart(2, '0');
        if (el.textContent !== txt) {
          el.textContent = txt;
          if (!reduceMotion) {
            el.classList.remove('flip');
            void el.offsetWidth;                          // restart animation
            el.classList.add('flip');
          }
        }
      }
      tick();
      var timer = setInterval(tick, 1000);
    })
    .catch(function () { /* strip stays hidden */ });
  })();

  /* ── 6 · SEAM ARC DRAW — IO fallback ────────────────────
     Browsers with animation-timeline: view() draw the arcs
     scroll-linked in pure CSS; everyone else gets a one-shot
     draw when the arc enters the viewport.                 */
  if (!(window.CSS && CSS.supports && CSS.supports('animation-timeline: view()'))) {
    var arcs = document.querySelectorAll('.seam-arc');
    if (arcs.length && 'IntersectionObserver' in window) {
      var arcObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            arcObs.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -15% 0px' });
      arcs.forEach(function (a) { arcObs.observe(a); });
    } else {
      arcs.forEach(function (a) { a.classList.add('in'); });
    }
  }

  /* ── 7 · FEATURED PLAYER 3D TILT ────────────────────── */
  (function fpTilt() {
    if (!finePointer || reduceMotion) return;
    var card = document.getElementById('fp-card');
    if (!card) return;
    var MAX = 4;                                          // degrees
    card.addEventListener('mousemove', function (e) {
      var r = card.getBoundingClientRect();
      var rx = ((e.clientY - r.top) / r.height - 0.5) * -2 * MAX;
      var ry = ((e.clientX - r.left) / r.width  - 0.5) *  2 * MAX;
      card.classList.add('tilting');
      card.style.transform =
        'rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
    });
    card.addEventListener('mouseleave', function () {
      card.classList.remove('tilting');
      card.style.transform = '';
    });
  })();

  /* ── 8 · SPONSOR CARD GLARE ─────────────────────────── */
  (function sponsorGlare() {
    if (!finePointer || reduceMotion) return;
    var track = document.getElementById('sponsors-track');
    if (!track) return;
    track.addEventListener('mousemove', function (e) {
      var card = e.target.closest('.sponsor-card');
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty('--gx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      card.style.setProperty('--gy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    });
  })();

  /* ── 9 · MATCH-DAY STATE ────────────────────────────────
     main.js shows #home-live-banner when a game is live;
     mirror that into body.match-live so the seam, eyebrow
     dot and countdown shift to the live red treatment.    */
  (function matchLive() {
    var banner = document.getElementById('home-live-banner');
    if (!banner) return;
    function sync() {
      document.body.classList.toggle(
        'match-live',
        window.getComputedStyle(banner).display !== 'none'
      );
    }
    new MutationObserver(sync).observe(banner, {
      attributes: true, attributeFilter: ['style']
    });
    sync();
  })();
})();
