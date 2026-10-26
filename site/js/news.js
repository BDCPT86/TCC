/* ══════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════ */
var SUPABASE_URL      = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var H = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY };

/* ══ NAV ══ */
var hamburger  = document.getElementById('hamburger');
var navLinksEl = document.getElementById('nav-links');
hamburger.addEventListener('click', function() { hamburger.classList.toggle('open'); navLinksEl.classList.toggle('open'); });
navLinksEl.querySelectorAll('a').forEach(function(a) {
  a.addEventListener('click', function() { hamburger.classList.remove('open'); navLinksEl.classList.remove('open'); });
});
document.querySelectorAll('.copy-year').forEach(function(el) { el.textContent = new Date().getFullYear(); });

/* ══════════════════════════════════════════════════════
   ROUTING — check URL for ?id= param
══════════════════════════════════════════════════════ */
/* ── Supabase image transform helper ── */
function imgUrl(url, width, quality) {
  if (!url || url.indexOf('supabase.co/storage') === -1) return url;
  var sep = url.indexOf('?') === -1 ? '?' : '&';
  return url + sep + 'width=' + (width||800) + '&quality=' + (quality||75) + '&resize=contain';
}


function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

function showList() {
  document.getElementById('view-list').style.display    = 'block';
  document.getElementById('view-article').style.display = 'none';
  document.getElementById('page-hero').style.display    = '';
  _currentView = 'list';
  var ctrls = document.getElementById('news-controls');
  if (ctrls && _controlsReady) ctrls.style.display = 'flex';
  document.getElementById('hero-ghost').textContent     = 'News';
  document.getElementById('hero-tag').textContent       = 'Club Updates';
  document.getElementById('hero-title').innerHTML       = 'Latest <span class="accent">News</span>';
  history.replaceState(null, '', 'news.html');
}

function setMeta(property, content) {
  var el = document.querySelector('meta[property="' + property + '"],meta[name="' + property + '"]');
  if (el && content) el.setAttribute('content', content);
}

function showArticle(article) {
  document.getElementById('view-list').style.display    = 'none';
  document.getElementById('view-article').style.display = 'block';
  document.getElementById('page-hero').style.display    = 'none';
  // Search + filters live outside #view-list, so they need hiding separately
  // or they hang above the article.
  _currentView = 'article';
  var ctrls = document.getElementById('news-controls');
  if (ctrls) ctrls.style.display = 'none';

  var date = new Date(article.created_at).toLocaleDateString('en-ZA', { day:'numeric', month:'long', year:'numeric' });
  document.getElementById('article-date').textContent  = date;
  document.getElementById('article-title').textContent = article.title;
  document.getElementById('article-body').innerHTML    = article.content;

  // Video facades: swap thumbnail for the real YouTube iframe only on click,
  // so embeds cost nothing until a reader actually plays one.
  document.getElementById('article-body').querySelectorAll('figure.news-video').forEach(function(fig) {
    var facade = fig.querySelector('.video-facade');
    var id = fig.getAttribute('data-video-id');
    if (!facade || !id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return;
    facade.addEventListener('click', function() {
      var iframe = document.createElement('iframe');
      iframe.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0';
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('title', 'YouTube video');
      facade.replaceWith(iframe);
    }, { once: true });
  });

  // Cover image hero — always visible, taller when image exists
  var coverEl    = document.getElementById('article-cover');
  var coverImgEl = document.getElementById('article-cover-img');
  coverEl.classList.remove('loaded', 'has-image');
  if (article.cover_image) {
    coverImgEl.style.backgroundImage = 'url(' + imgUrl(article.cover_image, 1400, 85) + ')';
    coverEl.classList.add('has-image');
    var img = new Image();
    img.onload = function() { coverEl.classList.add('loaded'); };
    img.src = imgUrl(article.cover_image, 1400, 85);
  } else {
    coverImgEl.style.backgroundImage = '';
  }

  // Gallery filmstrip
  var filmstripEl = document.getElementById('article-filmstrip');
  if (article.gallery_album) {
    loadFilmstrip(article.gallery_album, filmstripEl);
  } else {
    filmstripEl.style.display = 'none';
    filmstripEl.innerHTML = '';
  }

  // Update page title
  document.title = article.title + ' | Tygerberg Cricket Club';

  // Update OG / Twitter meta for share previews
  var url   = 'https://tygerbergcc.co.za/news.html?id=' + article.id;
  var desc  = article.content.replace(/<[^>]+>/g, '').substring(0, 160).trim();
  var image = article.cover_image || 'https://tygerbergcc.co.za/images/og-image.jpg';

  setMeta('og:title',       article.title);
  setMeta('og:description', desc);
  setMeta('og:image',       image);
  setMeta('og:url',         url);
  setMeta('twitter:title',       article.title);
  setMeta('twitter:description', desc);
  setMeta('twitter:image',       image);

  history.replaceState(null, '', 'news.html?id=' + article.id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ══════════════════════════════════════════════════════
   GALLERY FILMSTRIP
══════════════════════════════════════════════════════ */
function loadFilmstrip(albumName, container) {
  container.style.display = 'block';
  container.innerHTML = '<div class="filmstrip-loading"><div class="spinner"></div></div>';

  fetch(SUPABASE_URL + '/rest/v1/gallery?album=eq.' + encodeURIComponent(albumName) + '&select=id,url,caption&order=sort_order.asc,created_at.asc', { headers: H })
  .then(function(r) { return r.json(); })
  .then(function(photos) {
    if (!photos || !photos.length) { container.style.display = 'none'; return; }

    var html = '<div class="filmstrip-header">'
      + '<span class="filmstrip-label">📸 ' + albumName + '</span>'
      + '<span class="filmstrip-count">' + photos.length + ' photo' + (photos.length !== 1 ? 's' : '') + '</span>'
      + '</div>'
      + '<div class="filmstrip-track">'
      + photos.map(function(p, i) {
          return '<div class="filmstrip-item" data-index="' + i + '">'
            + '<img src="' + imgUrl(p.url, 800, 75) + '" alt="' + (p.caption || '').replace(/"/g,'&quot;') + '" loading="lazy">'
            + (p.caption ? '<div class="filmstrip-caption">' + p.caption + '</div>' : '')
            + '</div>';
        }).join('')
      + '</div>';

    container.innerHTML = html;

    container.querySelectorAll('.filmstrip-item').forEach(function(item) {
      item.addEventListener('click', function() {
        openFilmstripLightbox(photos, parseInt(item.dataset.index), albumName);
      });
    });
  })
  .catch(function() { container.style.display = 'none'; });
}

/* ── Lightbox ── */
var lbPhotos = [], lbIndex = 0;
var _controlsReady = false;   // set once articles have loaded
var _currentView   = 'list';  // 'list' | 'article' — loadList() races loadArticle()

function openFilmstripLightbox(photos, index, albumName) {
  lbPhotos = photos;
  lbIndex  = index;
  document.getElementById('article-lightbox').style.display = 'flex';
  document.getElementById('lb-album-name').textContent = albumName;
  document.body.style.overflow = 'hidden';
  renderLightboxSlide();
}

function closeLightbox() {
  document.getElementById('article-lightbox').style.display = 'none';
  document.body.style.overflow = '';
}

function renderLightboxSlide() {
  var photo = lbPhotos[lbIndex];
  document.getElementById('lb-img').src = imgUrl(photo.url, 1400, 85);
  document.getElementById('lb-img').alt = photo.caption || '';
  document.getElementById('lb-caption').textContent = photo.caption || '';
  document.getElementById('lb-counter').textContent = (lbIndex + 1) + ' / ' + lbPhotos.length;
  document.getElementById('lb-prev').style.visibility = lbIndex > 0 ? 'visible' : 'hidden';
  document.getElementById('lb-next').style.visibility = lbIndex < lbPhotos.length - 1 ? 'visible' : 'hidden';
  /* Preload adjacent images for instant navigation */
  if (lbIndex + 1 < lbPhotos.length) { (new Image()).src = imgUrl(lbPhotos[lbIndex + 1].url, 1400, 85); }
  if (lbIndex > 0)                    { (new Image()).src = imgUrl(lbPhotos[lbIndex - 1].url, 1400, 85); }
}

/* ── Article body images open in the same lightbox ─────────────────────
   Images inside an article — especially in a side-by-side row, where they
   render at a third or quarter width — need a way to be seen full size.
   Reuses the filmstrip lightbox: same nav, keyboard and preloading.
   All images in the article form one set, so prev/next walks the article. */
function collectArticleImages() {
  var body = document.getElementById('article-body');
  if (!body) return [];
  return Array.prototype.slice.call(body.querySelectorAll('figure.news-img img'))
    .map(function (img) {
      var fig = img.closest('figure.news-img');
      var cap = fig ? fig.querySelector('figcaption') : null;
      return { url: img.getAttribute('src') || '', caption: cap ? cap.textContent.trim() : '' };
    })
    .filter(function (p) { return p.url; });
}

var _articleBodyEl = document.getElementById('article-body');
if (_articleBodyEl) {
  _articleBodyEl.addEventListener('click', function (e) {
    var img = e.target.closest('figure.news-img img');
    if (!img) return;
    // don't hijack an image that is itself a link
    if (img.closest('a')) return;
    var photos = collectArticleImages();
    var src = img.getAttribute('src') || '';
    var idx = photos.findIndex(function (p) { return p.url === src; });
    if (idx < 0) idx = 0;
    openFilmstripLightbox(photos, idx, '');
  });
}

document.getElementById('lb-close').addEventListener('click', closeLightbox);
document.getElementById('lb-prev').addEventListener('click', function() { if (lbIndex > 0) { lbIndex--; renderLightboxSlide(); } });
document.getElementById('lb-next').addEventListener('click', function() { if (lbIndex < lbPhotos.length - 1) { lbIndex++; renderLightboxSlide(); } });
document.getElementById('article-lightbox').addEventListener('click', function(e) { if (e.target === this) closeLightbox(); });
document.addEventListener('keydown', function(e) {
  if (document.getElementById('article-lightbox').style.display === 'none') return;
  if (e.key === 'ArrowLeft')  { if (lbIndex > 0) { lbIndex--; renderLightboxSlide(); } }
  if (e.key === 'ArrowRight') { if (lbIndex < lbPhotos.length - 1) { lbIndex++; renderLightboxSlide(); } }
  if (e.key === 'Escape') closeLightbox();
});

/* ══ BACK BUTTON ══ */
document.getElementById('back-btn').addEventListener('click', function() {
  showList();
});

/* ══ SHARE BUTTON ══ */
document.getElementById('share-btn').addEventListener('click', function() {
  var title = document.getElementById('article-title').textContent;
  var url   = window.location.href;
  var btn   = document.getElementById('share-btn');
  var label = document.getElementById('share-btn-label');

  if (navigator.share) {
    navigator.share({ title: title, text: title + ' — Tygerberg Cricket Club', url: url })
    .catch(function() {});
  } else {
    navigator.clipboard.writeText(url).then(function() {
      btn.classList.add('copied');
      label.textContent = 'Link Copied!';
      setTimeout(function() {
        btn.classList.remove('copied');
        label.textContent = 'Share';
      }, 2500);
    }).catch(function() {
      window.prompt('Copy this link:', url);
    });
  }
});

/* ══════════════════════════════════════════════════════
   BUILD EDITORIAL GRID
══════════════════════════════════════════════════════ */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-ZA', { day:'numeric', month:'long', year:'numeric' });
}

function excerpt(html, len) {
  var text = html.replace(/<[^>]+>/g, '').trim();
  return text.length > len ? text.substring(0, len) + '…' : text;
}

function bgStyle(url) {
  var u = imgUrl(url, 600, 75);
  return u ? 'style="background-image:url(\'' + u.replace(/'/g, '%27') + '\')"' : '';
}

function buildFeaturedCard(a) {
  var hasBg = !!a.cover_image;
  var isMR  = a.category === 'match-report';
  var mrBadge = isMR ? '<div class="news-card-category news-mr-badge">🏏 Match Report' + mrResultBadge(a.match_meta) + '</div>' : '<div class="news-card-category">Latest Article</div>';
  return '<div class="news-card news-card-featured' + (isMR ? ' news-card-match' : '') + '" data-id="' + a.id + '">'
    + '<div class="news-card-bg' + (hasBg ? '' : ' no-image') + '" ' + bgStyle(a.cover_image) + '></div>'
    + '<div class="news-card-overlay"></div>'
    + '<div class="news-card-strip"></div>'
    + (a.pinned ? '<div class="news-card-pinned">📌 Pinned</div>' : '')
    + mrBadge
    + '<div class="news-card-content">'
    +   '<div class="news-card-tag">' + formatDate(a.created_at) + '</div>'
    +   '<div class="news-card-title">' + a.title + '</div>'
    +   (isMR ? mrScoreLine(a.match_meta) : '<div class="news-card-excerpt">' + excerpt(a.content, 160) + '</div>')
    + '</div>'
    + '</div>';
}

function buildSmallCard(a) {
  var hasBg = !!a.cover_image;
  var isMR  = a.category === 'match-report';
  return '<div class="news-card news-card-small' + (isMR ? ' news-card-match' : '') + '" data-id="' + a.id + '">'
    + '<div class="news-card-bg' + (hasBg ? '' : ' no-image') + '" ' + bgStyle(a.cover_image) + '></div>'
    + '<div class="news-card-overlay"></div>'
    + '<div class="news-card-strip' + (isMR ? ' news-strip-match' : '') + '"></div>'
    + (a.pinned ? '<div class="news-card-pinned">📌 Pinned</div>' : '')
    + '<div class="news-card-content">'
    +   '<div class="news-card-date">' + formatDate(a.created_at) + (isMR ? ' · <span class="news-mr-label">🏏 Match Report</span>' : '') + '</div>'
    +   '<div class="news-card-title">' + a.title + '</div>'
    +   (isMR ? mrScoreLine(a.match_meta) : '')
    + '</div>'
    + '</div>';
}

function buildMoreCard(a) {
  var isMR = a.category === 'match-report';
  return '<div class="news-more-card' + (isMR ? ' news-more-match' : '') + '" data-id="' + a.id + '">'
    + (isMR ? '<span class="news-mr-label" style="font-size:0.65rem">🏏</span> ' : '')
    + '<div class="news-more-date">' + formatDate(a.created_at) + '</div>'
    + '<div class="news-more-title">' + a.title + '</div>'
    + '</div>';
}

function mrResultBadge(meta) {
  if (!meta) return '';
  var m = typeof meta === 'string' ? JSON.parse(meta) : meta;
  var labels = {W:'Win',L:'Loss',D:'Draw',T:'Tie',NR:'No Result'};
  if (!m.result || !labels[m.result]) return '';
  return ' · <span class="mr-result-' + m.result + '">' + labels[m.result] + '</span>';
}

function mrScoreLine(meta) {
  if (!meta) return '';
  var m = typeof meta === 'string' ? JSON.parse(meta) : meta;
  var parts = [];
  if (m.team) parts.push(m.team);
  if (m.opponent) parts.push('vs ' + m.opponent);
  if (m.our_score || m.their_score) {
    parts.push('· TCC ' + (m.our_score || '—') + ' / ' + (m.opponent || 'Opp') + ' ' + (m.their_score || '—'));
  }
  if (!parts.length) return '';
  return '<div class="news-mr-scores">' + parts.join(' ') + '</div>';
}

/* ══════════════════════════════════════════════════════
   LOAD ARTICLE LIST
══════════════════════════════════════════════════════ */
function loadList() {
  var loadingEl = document.getElementById('list-loading');
  var emptyEl   = document.getElementById('list-empty');
  var gridEl    = document.getElementById('articles-grid');

  fetch(SUPABASE_URL + '/rest/v1/news?select=id,title,content,cover_image,gallery_album,created_at,pinned,status,expires_at,category,match_meta&status=eq.published&order=pinned.desc,created_at.desc', { headers: H })
  .then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(function(articles) {
    loadingEl.style.display = 'none';
    if (!articles || !articles.length) { emptyEl.style.display = 'flex'; return; }

    var html = '';

    // Editorial grid is a 2x2: the featured card is 560px, exactly two 276px
    // small cards plus the gap. Sending four left the left column empty below
    // row 2. Anything beyond three flows into "More Articles" below.
    var featured = articles[0];
    var smallCards = articles.slice(1, 3);  // two small cards

    html += '<div class="news-editorial-grid">';
    html += buildFeaturedCard(featured);
    smallCards.forEach(function(a) { html += buildSmallCard(a); });
    html += '</div>';

    // Articles beyond the editorial grid → plain list
    var rest = articles.slice(3);
    if (rest.length) {
      html += '<div class="news-more-heading">More Articles</div>';
      html += '<div class="news-more-list">';
      rest.forEach(function(a) { html += buildMoreCard(a); });
      html += '</div>';
    }

    gridEl.innerHTML = html;

    // Bind clicks on all cards
    gridEl.querySelectorAll('[data-id]').forEach(function(card) {
      card.addEventListener('click', function() { loadArticle(card.dataset.id); });
    });

    gridEl.style.display = 'block';
    if (_currentView === 'article') {
      document.getElementById('view-list').style.display = 'none';
    }
  })
  .catch(function(err) { console.error(err); loadingEl.style.display = 'none'; emptyEl.style.display = 'flex'; });
}

/* ══════════════════════════════════════════════════════
   LOAD SINGLE ARTICLE
══════════════════════════════════════════════════════ */
function loadArticle(id) {
  fetch(SUPABASE_URL + '/rest/v1/news?id=eq.' + id + '&status=eq.published&select=*', { headers: H })
  .then(function(r) { return r.json(); })
  .then(function(rows) {
    if (!rows || !rows.length) { showList(); return; }
    showArticle(rows[0]);
  })
  .catch(function() { showList(); });
}

/* ══ INIT ══ */
var articleId = getParam('id');
loadList();
if (articleId) {
  loadArticle(articleId);
} else {
  showList();
}

/* ══════════════════════════════════════════════════════
   NEWS SEARCH + CATEGORY FILTER
══════════════════════════════════════════════════════ */
var allArticles  = [];
var activeNewsCat = 'all';

// Patch loadList to also store articles and show controls
var _origLoadList = loadList;
function loadList() {
  var loadingEl = document.getElementById('list-loading');
  var emptyEl   = document.getElementById('list-empty');
  var gridEl    = document.getElementById('articles-grid');

  fetch(SUPABASE_URL + '/rest/v1/news?select=id,title,content,cover_image,gallery_album,created_at,pinned,status,expires_at,category,match_meta&status=eq.published&order=pinned.desc,created_at.desc', { headers: H })
  .then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(function(articles) {
    loadingEl.style.display = 'none';
    if (!articles || !articles.length) { emptyEl.style.display = 'flex'; return; }
    allArticles = articles;
    _controlsReady = true;
    if (_currentView === 'list') {
      document.getElementById('news-controls').style.display = 'flex';
    }
    renderFilteredNews();
  })
  .catch(function(err) { console.error(err); loadingEl.style.display = 'none'; emptyEl.style.display = 'flex'; });
}

function renderFilteredNews() {
  var term = (document.getElementById('news-search').value || '').trim().toLowerCase();
  var gridEl = document.getElementById('articles-grid');
  var emptyEl = document.getElementById('list-empty');

  var filtered = allArticles.filter(function(a) {
    var catMatch = activeNewsCat === 'all' || a.category === activeNewsCat ||
      (activeNewsCat === 'general' && (!a.category || a.category === 'general'));
    var termMatch = !term || a.title.toLowerCase().indexOf(term) !== -1 ||
      a.content.replace(/<[^>]+>/g,'').toLowerCase().indexOf(term) !== -1;
    return catMatch && termMatch;
  });

  if (!filtered.length) {
    gridEl.style.display  = 'none';
    emptyEl.style.display = 'flex';
    return;
  }

  emptyEl.style.display = 'none';
  var html = '';
  var featured   = filtered[0];
  var smallCards = filtered.slice(1, 3);
  var rest       = filtered.slice(3);

  html += '<div class="news-editorial-grid">';
  html += buildFeaturedCard(featured);
  smallCards.forEach(function(a) { html += buildSmallCard(a); });
  html += '</div>';

  if (rest.length) {
    html += '<div class="news-more-heading">More Articles</div>';
    html += '<div class="news-more-list">';
    rest.forEach(function(a) { html += buildMoreCard(a); });
    html += '</div>';
  }

  gridEl.innerHTML = html;
  gridEl.style.display = 'block';

  gridEl.querySelectorAll('[data-id]').forEach(function(card) {
    card.addEventListener('click', function() { loadArticle(card.dataset.id); });
  });
}

// Search input
var newsSearchEl = document.getElementById('news-search');
var newsSearchClear = document.getElementById('news-search-clear');
if (newsSearchEl) {
  newsSearchEl.addEventListener('input', function() {
    newsSearchClear.style.display = this.value ? 'block' : 'none';
    renderFilteredNews();
  });
  newsSearchClear.addEventListener('click', function() {
    newsSearchEl.value = '';
    newsSearchClear.style.display = 'none';
    newsSearchEl.focus();
    renderFilteredNews();
  });
}

// Category filter
document.getElementById('news-filters').querySelectorAll('.news-filter-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.getElementById('news-filters').querySelectorAll('.news-filter-btn')
      .forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    activeNewsCat = btn.dataset.cat;
    // Clear search when switching category
    newsSearchEl.value = '';
    newsSearchClear.style.display = 'none';
    renderFilteredNews();
  });
});
