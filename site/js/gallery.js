/* ══════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════ */
var SUPABASE_URL      = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';

/* ══════════════════════════════════════════════════════
   NAV
══════════════════════════════════════════════════════ */
var hamburger  = document.getElementById('hamburger');
var navLinksEl = document.getElementById('nav-links');
hamburger.addEventListener('click', function() { hamburger.classList.toggle('open'); navLinksEl.classList.toggle('open'); });
navLinksEl.querySelectorAll('a').forEach(function(a) {
  a.addEventListener('click', function() { hamburger.classList.remove('open'); navLinksEl.classList.remove('open'); });
});

/* ══════════════════════════════════════════════════════
   COPYRIGHT YEAR
══════════════════════════════════════════════════════ */
document.querySelectorAll('.copy-year').forEach(function(el) { el.textContent = new Date().getFullYear(); });

/* ══════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════ */
/* ── Supabase image transform helper ──────────────────
   Appends width/quality params so Supabase serves a
   resized version from the CDN edge — reduces egress
   significantly vs serving full-res originals.
   Only applies to Supabase Storage URLs.            */
function imgUrl(url, width, quality) {
  if (!url) return url;
  // Only transform Supabase storage URLs
  if (url.indexOf('supabase.co/storage') === -1) return url;
  var sep = url.indexOf('?') === -1 ? '?' : '&';
  return url + sep + 'width=' + (width||800) + '&quality=' + (quality||75) + '&resize=contain';
}


function setState(state) {
  document.getElementById('gallery-loading').style.display  = state === 'loading' ? 'block' : 'none';
  document.getElementById('gallery-empty').style.display    = state === 'empty'   ? 'flex'  : 'none';
  document.getElementById('gallery-error').style.display    = state === 'error'   ? 'flex'  : 'none';
  document.getElementById('albums-grid').style.display      = state === 'grid'    ? 'grid'  : 'none';
  document.getElementById('gallery-controls').style.display = state === 'grid'    ? 'flex'  : 'none';
}

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
function updateGalleryCount(n) {
  var el = document.getElementById('gallery-count');
  if (el) el.textContent = n + ' album' + (n !== 1 ? 's' : '');
}

function esc(s) { return s.replace(/"/g, '&quot;'); }

function slugify(s) {
  return s.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deslugify(slug, albumMap) {
  // Find the real album name that matches this slug
  var keys = Object.keys(albumMap);
  for (var i = 0; i < keys.length; i++) {
    if (slugify(keys[i]) === slug) return keys[i];
  }
  // Fallback — try to match loosely
  slug = slug.replace(/-/g, ' ').toLowerCase();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === slug) return keys[i];
  }
  return null;
}


var lbPhotos  = [];
var lbIndex   = 0;
var lbAlbum   = '';

function openLightbox(photos, index, albumName) {
  lbPhotos = photos;
  lbIndex  = index;
  lbAlbum  = albumName;
  document.getElementById('lightbox-title').textContent = albumName;
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
  history.replaceState(null, '', 'gallery.html?album=' + slugify(albumName));
  buildLightboxStrip(); /* build strip once */
  renderLightbox();     /* then render main image */
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
  history.replaceState(null, '', 'gallery.html');
}

/* ── Lightbox rendering ────────────────────────────────
   Strip is built ONCE when the lightbox opens.
   Navigation only swaps the main image and active class —
   no strip rebuild, no redundant image requests.
   Thumbnails use loading="lazy" so only visible ones load.
──────────────────────────────────────────────────── */

function buildLightboxStrip() {
  var thumbsEl = document.getElementById('lightbox-thumbs');
  thumbsEl.innerHTML = lbPhotos.map(function(p, i) {
    return '<img class="lb-thumb' + (i === lbIndex ? ' active' : '') + '"'
      + ' src="' + imgUrl(p.url, 120, 60) + '"'
      + ' data-index="' + i + '"'
      + ' loading="lazy" alt="">';
  }).join('');
}

function renderLightbox() {
  var photo = lbPhotos[lbIndex];

  /* ── Main image — preload the next image in background ── */
  var imgEl = document.getElementById('lightbox-img');
  imgEl.src = imgUrl(photo.url, 1400, 85);
  imgEl.alt = photo.caption || '';

  /* Preload adjacent images so nav feels instant */
  if (lbIndex + 1 < lbPhotos.length) {
    var preNext = new Image();
    preNext.src = imgUrl(lbPhotos[lbIndex + 1].url, 1400, 85);
  }
  if (lbIndex > 0) {
    var prePrev = new Image();
    prePrev.src = imgUrl(lbPhotos[lbIndex - 1].url, 1400, 85);
  }

  document.getElementById('lightbox-caption').textContent = photo.caption || '';
  document.getElementById('lightbox-counter').textContent = (lbIndex + 1) + ' / ' + lbPhotos.length;
  document.getElementById('lb-prev').disabled = lbIndex === 0;
  document.getElementById('lb-next').disabled = lbIndex === lbPhotos.length - 1;

  /* ── Update active thumb without rebuilding the strip ── */
  var thumbsEl = document.getElementById('lightbox-thumbs');
  thumbsEl.querySelectorAll('.lb-thumb').forEach(function(t) {
    t.classList.toggle('active', parseInt(t.dataset.index) === lbIndex);
  });

  var activeThumb = thumbsEl.querySelector('.lb-thumb.active');
  if (activeThumb) activeThumb.scrollIntoView({ inline: 'center', behavior: 'smooth' });
}

document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-overlay').addEventListener('click', closeLightbox);
document.getElementById('lb-prev').addEventListener('click', function() { if (lbIndex > 0) { lbIndex--; renderLightbox(); } });
document.getElementById('lb-next').addEventListener('click', function() { if (lbIndex < lbPhotos.length - 1) { lbIndex++; renderLightbox(); } });

// Thumbnail click (delegated)
document.getElementById('lightbox-thumbs').addEventListener('click', function(e) {
  if (e.target.classList.contains('lb-thumb')) {
    lbIndex = parseInt(e.target.dataset.index);
    renderLightbox();
  }
});

// Keyboard navigation
document.addEventListener('keydown', function(e) {
  if (!document.getElementById('lightbox').classList.contains('open')) return;
  if (e.key === 'ArrowLeft' && lbIndex > 0)                      { lbIndex--; renderLightbox(); }
  if (e.key === 'ArrowRight' && lbIndex < lbPhotos.length - 1)   { lbIndex++; renderLightbox(); }
  if (e.key === 'Escape')                                          { closeLightbox(); }
});

/* ══════════════════════════════════════════════════════
   FETCH & RENDER
══════════════════════════════════════════════════════ */
function loadGallery() {
  setState('loading');

  fetch(SUPABASE_URL + '/rest/v1/gallery?select=*&order=sort_order.asc,created_at.asc', {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
  })
  .then(function(res) {
    if (!res.ok) {
      return res.text().then(function(body) {
        throw new Error('HTTP ' + res.status + ' — ' + body);
      });
    }
    return res.json();
  })
  .then(function(photos) {
    if (!photos || photos.length === 0) { setState('empty'); return; }

    // Group by album
    var albumMap = {};
    photos.forEach(function(p) {
      var key = p.album || 'General';
      if (!albumMap[key]) albumMap[key] = [];
      albumMap[key].push(p);
    });

    var grid = document.getElementById('albums-grid');
    var allAlbumNames = Object.keys(albumMap);

    grid.innerHTML = allAlbumNames.map(function(albumName) {
      var items    = albumMap[albumName];
      var cover    = items[0];
      var count    = items.length;
      var category = cover.category || '';
      var date     = cover.taken_at ? new Date(cover.taken_at).toLocaleDateString('en-ZA', { year:'numeric', month:'short', day:'numeric' }) : '';

      return '<div class="album-card masonry-placing" data-album="' + esc(albumName) + '" data-category="' + (cover.category || 'General') + '">'
        + '<div class="album-cover">'
        +   '<img src="' + imgUrl(cover.url, 400, 70) + '" alt="' + albumName + '" loading="lazy">'
        +   '<div class="album-cover-count">' + count + (count === 1 ? ' photo' : ' photos') + '</div>'
        + '</div>'
        + '<div class="album-info">'
        +   '<div class="album-name">' + albumName + '</div>'
        +   '<div class="album-meta">'
        +     (category ? '<span class="album-category">' + category + '</span>' : '')
        +     (date ? '<span>' + date + '</span>' : '')
        +   '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    // Album click — open lightbox
    grid.querySelectorAll('.album-card').forEach(function(card) {
      card.addEventListener('click', function() {
        var name   = card.dataset.album;
        var photos = albumMap[name];
        openLightbox(photos, 0, name);
      });
    });

    setState('grid');
    updateGalleryCount(allAlbumNames.length);
    checkAlbumUrl(albumMap);

    /* ── MASONRY ENGINE ── */
    var GAP     = 20;
    var MIN_COL = 280;
    var resizeTimer;

    function getColCount() {
      return Math.max(1, Math.floor((grid.offsetWidth + GAP) / (MIN_COL + GAP)));
    }

    function runMasonry(cards) {
      var cols    = getColCount();
      var colW    = (grid.offsetWidth - (cols - 1) * GAP) / cols;
      var colTops = new Array(cols).fill(0);

      cards.forEach(function(card) {
        if (card.style.display === 'none') return;
        var minTop = Math.min.apply(null, colTops);
        var col    = colTops.indexOf(minTop);
        card.style.width = colW + 'px';
        card.style.left  = (col * (colW + GAP)) + 'px';
        card.style.top   = minTop + 'px';
        colTops[col]    += card.offsetHeight + GAP;
      });

      grid.style.height = (Math.max.apply(null, colTops) - GAP) + 'px';
    }

    function layoutMasonry() {
      var cards = Array.from(grid.querySelectorAll('.album-card'));
      var imgs  = cards.map(function(c) { return c.querySelector('img'); }).filter(Boolean);
      var loaded = 0;
      var total  = imgs.length;

      function doLayout() {
        cards.forEach(function(c) { c.classList.remove('masonry-placing'); });
        runMasonry(cards);
      }

      if (!total) { doLayout(); return; }

      imgs.forEach(function(img) {
        if (img.complete && img.naturalHeight > 0) {
          loaded++;
          if (loaded === total) doLayout();
        } else {
          img.addEventListener('load',  function() { loaded++; if (loaded === total) doLayout(); });
          img.addEventListener('error', function() { loaded++; if (loaded === total) doLayout(); });
        }
      });
    }

    layoutMasonry();

    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() {
        runMasonry(Array.from(grid.querySelectorAll('.album-card')));
      }, 120);
    });

    /* ── CATEGORY FILTER ── */
    document.querySelectorAll('#gallery-filters .filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('#gallery-filters .filter-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var cat   = btn.dataset.category;
        var cards = Array.from(grid.querySelectorAll('.album-card'));
        var visible = 0;
        cards.forEach(function(card) {
          var show = cat === 'all' || card.dataset.category === cat;
          card.style.display = show ? '' : 'none';
          if (show) visible++;
        });
        updateGalleryCount(visible);
        runMasonry(cards);
      });
    });
  })
  .catch(function(err) { console.error(err); setState('error'); });
}

loadGallery();

/* ══════════════════════════════════════════════════════
   LIGHTBOX SHARE BUTTON
══════════════════════════════════════════════════════ */
document.getElementById('lightbox-share').addEventListener('click', function() {
  var url   = window.location.origin + '/gallery.html?album=' + slugify(lbAlbum);
  var btn   = document.getElementById('lightbox-share');
  var label = document.getElementById('lightbox-share-label');

  if (navigator.share) {
    navigator.share({ title: lbAlbum + ' — TCC Gallery', url: url }).catch(function(){});
  } else {
    navigator.clipboard.writeText(url).then(function() {
      btn.classList.add('copied');
      label.textContent = 'Copied!';
      setTimeout(function() { btn.classList.remove('copied'); label.textContent = 'Share'; }, 2500);
    }).catch(function() { window.prompt('Copy this link:', url); });
  }
});

/* ══════════════════════════════════════════════════════
   URL ROUTING — open album from ?album= param on load
══════════════════════════════════════════════════════ */
function getAlbumParam() {
  return new URLSearchParams(window.location.search).get('album') || '';
}

// Called after albums load — check if URL has an album to open
function checkAlbumUrl(albumMap) {
  var param = getAlbumParam();
  if (!param) return;
  // param may be a slug (no spaces) or a legacy encoded name
  var album = albumMap[param] ? param : deslugify(param, albumMap);
  if (!album) return;
  var cards = document.querySelectorAll('.album-card');
  cards.forEach(function(card) {
    if (card.dataset.album === album) card.click();
  });
}
