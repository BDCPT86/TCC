/* ══════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════ */
const SUPABASE_URL      = 'https://cgjannvzpqecwzjdzwso.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
const FIXTURES_TABLE    = 'fixtures';
const FANTASY_ENABLED   = false;   // set false to hide fantasy section site-wide

/* ══════════════════════════════════════════════════════
   CLUB AGE — auto-calculated so it never goes stale
══════════════════════════════════════════════════════ */
var FOUNDED = 1957;
var CLUB_AGE = new Date().getFullYear() - FOUNDED;
var CUR_YEAR = new Date().getFullYear();
(function(){ var el = document.getElementById("copyright-year"); if(el) el.textContent = CUR_YEAR; })();

(function setClubAge() {
  var els = document.querySelectorAll('#stat-years, #hero-years');
  els.forEach(function(el) { el.textContent = CLUB_AGE; });
  // Keep hero stat card and about section counter in sync with auto-calculated age
  document.querySelectorAll('.hps-num[data-target="69"], .stat-counter-val[data-target="69"]').forEach(function(el) {
    el.dataset.target = CLUB_AGE;
  });
})();

/* ══════════════════════════════════════════════════════
   PRACTICE DATA
══════════════════════════════════════════════════════ */
const practiceSchedule = [
  {
    title: 'Senior Squad', sub: 'All senior players', icon: '🏏',
    sessions: [
      { day: 'Tuesday',  time: '17:30–19:30', venue: 'Florida Park — Main Nets' },
      { day: 'Thursday', time: '17:30–19:30', venue: 'Florida Park — Main Nets' },
    ]
  },
  {
    title: 'Juniors (U10–U13)', sub: 'All junior age groups', icon: '🌟',
    sessions: [
      { day: 'Tuesday',  time: '15:30–17:30', venue: 'Florida Park — Nets' },
      { day: 'Thursday', time: '15:30–17:30', venue: 'Florida Park — Nets' },
    ]
  },
  {
    title: 'Mini Cricket', sub: 'Entry level · soft ball', icon: '🎯',
    sessions: [
      { day: 'Friday', time: '16:30–18:00', venue: 'Florida Park' },
    ]
  },
];

/* ── Supabase image transform helper ── */
function imgUrl(url, width, quality) {
  if (!url || url.indexOf('supabase.co/storage') === -1) return url;
  var sep = url.indexOf('?') === -1 ? '?' : '&';
  return url + sep + 'width=' + (width||800) + '&quality=' + (quality||75) + '&resize=contain';
}


function renderPracticeGrid(id, schedule) {
  var el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = schedule.map(function(p) {
    return '<div class="practice-card">'
      + '<div class="practice-card-header">'
      +   '<div class="practice-icon">' + p.icon + '</div>'
      +   '<div>'
      +     '<div class="practice-card-title">' + p.title + '</div>'
      +     '<div class="practice-card-sub">' + p.sub + '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="practice-sessions">'
      + p.sessions.map(function(s) {
          return '<div class="session-row">'
            + '<div><div class="session-day">' + s.day + '</div>'
            + '<div class="session-venue">' + s.venue + '</div></div>'
            + '<div class="session-time">' + s.time + '</div>'
            + '</div>';
        }).join('')
      + '</div>'
      + '</div>';
  }).join('');
}

/* Practice grid removed from homepage — times shown in About section and youth age cards */


/* ══════════════════════════════════════════════════════
   SUPABASE — NEXT FIXTURE PER SENIOR TEAM
══════════════════════════════════════════════════════ */
var SENIOR_TEAMS = ['1st Team', '2nd Team', '3rd Team', '4th Team'];
var today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

function supabaseHeaders() {
  return {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type':  'application/json',
  };
}

function fmtDate(dateStr) {
  if (!dateStr) return { day: '--', month: '---', year: '' };
  var d = new Date(dateStr + 'T00:00:00');
  return {
    day:   String(d.getDate()).padStart(2, '0'),
    month: d.toLocaleString('en-ZA', { month: 'short' }).toUpperCase(),
    year:  d.getFullYear(),
  };
}

function resultBadge(result) {
  if (!result) return '<span class="badge badge-upcoming">Upcoming</span>';
  var r = result.toLowerCase();
  if (r === 'won'  || r === 'win')  return '<span class="badge badge-win">Won</span>';
  if (r === 'lost' || r === 'loss') return '<span class="badge badge-loss">Lost</span>';
  if (r === 'draw')                 return '<span class="badge badge-result">Draw</span>';
  return '<span class="badge badge-result">' + result + '</span>';
}

function setFixtureState(state) {
  document.getElementById('fixtures-loading').style.display = state === 'loading' ? 'block' : 'none';
  document.getElementById('fixtures-error').style.display   = state === 'error'   ? 'flex' : 'none';
  document.getElementById('fixtures-empty').style.display   = state === 'empty'   ? 'flex' : 'none';
  document.getElementById('fixtures-list').style.display    = state === 'list'    ? 'block' : 'none';
}

function renderNextFixtures(allFixtures) {
  var list = document.getElementById('fixtures-list');

  // Check if there are any upcoming fixtures at all across all senior teams
  var hasAny = SENIOR_TEAMS.some(function(team) {
    return allFixtures.some(function(f) { return f.team === team && f.date >= today; });
  });

  if (!hasAny) {
    setFixtureState('empty');
    return;
  }

  /* ── Editorial row layout ── */
  var html = '<div class="frl">';

  SENIOR_TEAMS.forEach(function(team) {
    var upcoming = allFixtures
      .filter(function(f) { return f.team === team && f.date >= today; })
      .sort(function(a, b) { return a.date < b.date ? -1 : 1; });

    var f = upcoming[0] || null;
    var d = f ? fmtDate(f.date) : null;

    hasAny = hasAny || !!f;

    html += '<div class="frl-row' + (f ? '' : ' frl-row-empty') + '"'
      + ' data-fixture-id="' + (f ? f.id : '') + '">';

    if (f) {
      /* Date */
      html += '<div class="frl-date">';
      html +=   '<div class="frl-day">' + d.day + '</div>';
      html +=   '<div class="frl-mon">' + d.month + '</div>';
      html += '</div>';

      /* Team */
      html += '<div class="frl-team">' + team + '</div>';

      /* Match info */
      html += '<div class="frl-match">';
      html +=   '<div class="frl-opp">' + (f.opponent || 'TBC') + '</div>';
      html +=   '<div class="frl-meta">';
      html +=     (f.venue    ? '<span>📍 ' + f.venue    + '</span>' : '');
      html +=     (f.division ? '<span>' + f.division + '</span>' : '');
      html +=   '</div>';
      html += '</div>';

      /* Live score — hidden until active */
      html += '<div class="frl-score" id="frl-score-' + f.id + '" style="display:none">';
      html +=   '<div class="frl-score-num" id="frl-snum-' + f.id + '">0/0</div>';
      html +=   '<div class="frl-score-sub">';
      html +=     '<div class="frl-score-detail" id="frl-sdet-' + f.id + '"></div>';
      html +=     '<div class="frl-score-need" id="frl-sneed-' + f.id + '"></div>';
      html +=   '</div>';
      html += '</div>';

      /* Badge */
      html += '<div class="frl-badge-wrap">';
      html +=   '<div class="frl-live-badge" id="frl-badge-' + f.id + '" style="display:none">';
      html +=     '<span class="frl-live-dot"></span>Live';
      html +=   '</div>';
      if (!f.result) {
        html += '<div class="frl-badge-upcoming">Upcoming</div>';
      } else {
        html += resultBadge(f.result);
      }
      html += '</div>';

    } else {
      html += '<div class="frl-date"><div class="frl-day">—</div></div>';
      html += '<div class="frl-team">' + team + '</div>';
      html += '<div class="frl-match"><div class="frl-none">No upcoming fixtures</div></div>';
      html += '<div class="frl-score"></div>';
      html += '<div class="frl-badge-wrap"></div>';
    }

    html += '</div>';
  });

  html += '</div>';

  list.innerHTML = html;
  setFixtureState('list');
  observeReveal();
}

function loadFixtures() {
  setFixtureState('loading');
  // Fetch all senior team fixtures from today onwards, ordered by date
  var url = SUPABASE_URL + '/rest/v1/' + FIXTURES_TABLE
    + '?select=*&order=date.asc';

  fetch(url, { headers: supabaseHeaders() })
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function(data) {
      renderNextFixtures(data);
    })
    .catch(function(err) {
      console.error('Fixtures error:', err);
      setFixtureState('error');
    });
}

loadFixtures();

/* ══════════════════════════════════════════════════════
   SCROLL REVEAL
══════════════════════════════════════════════════════ */
var revealObserver = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

function observeReveal() {
  document.querySelectorAll('.reveal:not(.visible)').forEach(function(el) {
    revealObserver.observe(el);
  });
}
observeReveal();
setTimeout(observeReveal, 600);

/* ══════════════════════════════════════════════════════
   NAV ACTIVE LINK
══════════════════════════════════════════════════════ */
var navLinkEls = document.querySelectorAll('.nav-link');
var trackedIds = ['home','youth','contact'];
var sectionObs = new IntersectionObserver(function(entries) {
  entries.forEach(function(e) {
    if (e.isIntersecting) {
      var id = e.target.id;
      navLinkEls.forEach(function(l) {
        l.classList.toggle('active', l.getAttribute('href') === '#' + id);
      });
    }
  });
}, { rootMargin: '-40% 0px -40% 0px' });
trackedIds.forEach(function(id) {
  var el = document.getElementById(id);
  if (el) sectionObs.observe(el);
});

/* ══════════════════════════════════════════════════════
   HAMBURGER
══════════════════════════════════════════════════════ */
var hamburger  = document.getElementById('hamburger');
var navLinksEl = document.getElementById('nav-links');
hamburger.addEventListener('click', function() {
  hamburger.classList.toggle('open');
  navLinksEl.classList.toggle('open');
});
navLinksEl.querySelectorAll('a').forEach(function(a) {
  a.addEventListener('click', function() {
    hamburger.classList.remove('open');
    navLinksEl.classList.remove('open');
  });
});

/* ══════════════════════════════════════════════════════
   CONTACT FORM — Turnstile + Worker proxy
══════════════════════════════════════════════════════ */
var contactSubmitting = false;  // guard against double-submission
var contactSendInFlight = false; // guard against sendEmail being called twice (e.g. Turnstile double-callback)

document.getElementById('contact-form').addEventListener('submit', function(e) {
  e.preventDefault();

  // Hard guard — ignore if already in flight
  if (contactSubmitting) return;

  ['err-name', 'err-email', 'err-msg', 'err-turnstile'].forEach(function(id) {
    document.getElementById(id).classList.remove('show');
  });
  var sendError = document.getElementById('form-send-error');
  sendError.style.display = 'none';
  document.getElementById('form-success').classList.remove('show');

  var nameEl  = document.getElementById('c-name');
  var emailEl = document.getElementById('c-email');
  var msgEl   = document.getElementById('c-message');
  var btn     = document.getElementById('form-submit-btn');
  var ok      = true;

  if (!nameEl.value.trim())                                    { document.getElementById('err-name').classList.add('show');  ok = false; }
  if (!emailEl.value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))     { document.getElementById('err-email').classList.add('show'); ok = false; }
  if (!msgEl.value.trim())                                     { document.getElementById('err-msg').classList.add('show');   ok = false; }
  if (!ok) return;

  contactSubmitting = true;
  btn.disabled = true;
  document.getElementById('btn-label').style.display  = 'none';
  document.getElementById('btn-spinner').style.display = 'inline';

  if (typeof turnstile !== 'undefined') {
    turnstile.execute('#cf-turnstile-widget', {
      callback: function(token) { sendEmail(token); },
      'error-callback': function() {
        document.getElementById('err-turnstile').classList.add('show');
        contactSubmitting = false;
        btn.disabled = false;
        document.getElementById('btn-label').style.display  = 'inline';
        document.getElementById('btn-spinner').style.display = 'none';
      }
    });
  } else {
    sendEmail('');
  }
});

function sendEmail(turnstileToken) {
  // Hard guard — if a send is already in flight, ignore this call entirely
  if (contactSendInFlight) return;
  contactSendInFlight = true;

  var nameEl    = document.getElementById('c-name');
  var emailEl   = document.getElementById('c-email');
  var msgEl     = document.getElementById('c-message');
  var btn       = document.getElementById('form-submit-btn');
  var sendError = document.getElementById('form-send-error');

  fetch('https://tcc-admin.bydaries.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'contact.send',
      payload: {
        name:           nameEl.value.trim(),
        email:          emailEl.value.trim(),
        message:        msgEl.value.trim(),
        turnstileToken: turnstileToken,
        requestId:      Date.now().toString(36) + Math.random().toString(36).slice(2)
      }
    })
  })
  .then(function(r) {
    if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || ('Server error ' + r.status)); }).catch(function(e) { throw e.message ? e : new Error('Server error ' + r.status); });
    return r.json();
  })
  .then(function() {
    // Success — show message, reset form, leave button disabled (job done)
    document.getElementById('form-success').classList.add('show');
    document.getElementById('contact-form').reset();
    if (typeof turnstile !== 'undefined') turnstile.reset();
    document.getElementById('btn-label').style.display  = 'inline';
    document.getElementById('btn-spinner').style.display = 'none';
    // Guard stays true — prevents any further submission on this page load
    setTimeout(function() { document.getElementById('form-success').classList.remove('show'); }, 8000);
  })
  .catch(function(err) {
    console.error('Contact form error:', err);
    var msg = err.message || '';
    var display = (msg && msg !== 'Server error' && !msg.startsWith('Server error'))
      ? '❌ &nbsp;' + msg
      : '❌ &nbsp;Something went wrong. Please try again or email us at <a href="mailto:info@tygerbergcc.co.za" style="color:var(--gold)">info@tygerbergcc.co.za</a>';
    sendError.innerHTML = display;
    sendError.style.display = 'block';
    // Only release guards on failure so user can retry
    contactSubmitting = false;
    contactSendInFlight = false;
    btn.disabled = false;
    document.getElementById('btn-label').style.display  = 'inline';
    document.getElementById('btn-spinner').style.display = 'none';
    if (typeof turnstile !== 'undefined') turnstile.reset();
  });
}

/* ══════════════════════════════════════════════════════
   THREE.JS — init on window load so canvas has real dims
══════════════════════════════════════════════════════ */
window.addEventListener('load', function() {

  /* ── Background canvas — full page drifting particles ── */
  (function initBgCanvas() {
    var bgCanvas = document.getElementById('bg-canvas');
    if (!bgCanvas || !window.THREE) return;

    var bgRenderer = new THREE.WebGLRenderer({ canvas: bgCanvas, antialias: false, alpha: true });
    bgRenderer.setClearColor(0x000000, 0);
    bgRenderer.setPixelRatio(1); // keep cheap

    var bgScene  = new THREE.Scene();
    var bgCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    bgCamera.position.z = 40;

    function bgResize() {
      bgRenderer.setSize(window.innerWidth, window.innerHeight, false);
      bgCamera.aspect = window.innerWidth / window.innerHeight;
      bgCamera.updateProjectionMatrix();
    }
    bgResize();
    window.addEventListener('resize', bgResize);

    // Two layers of particles — different sizes and speeds
    function makeParticles(count, spread, size, opacity) {
      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array(count * 3);
      for (var i = 0; i < count; i++) {
        pos[i*3]   = (Math.random() - 0.5) * spread;
        pos[i*3+1] = (Math.random() - 0.5) * spread * 1.5;
        pos[i*3+2] = (Math.random() - 0.5) * spread * 0.5;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var mat = new THREE.PointsMaterial({
        color: 0xb8922a,
        size: size,
        transparent: true,
        opacity: opacity,
        sizeAttenuation: true,
      });
      return new THREE.Points(geo, mat);
    }

    var layer1 = makeParticles(420, 120, 0.18, 0.55); // larger, slower
    var layer2 = makeParticles(280, 100, 0.09, 0.30); // smaller, faster
    bgScene.add(layer1);
    bgScene.add(layer2);

    var bgT = 0, bgLast = 0;
    (function bgLoop(ts) {
      requestAnimationFrame(bgLoop);
      if (document.hidden) return;          // pause when tab not visible
      if (ts - bgLast < 32) return;         // cap to ~30fps
      bgLast = ts;
      bgT += 0.0004;
      layer1.rotation.y = bgT * 0.6;
      layer1.rotation.x = bgT * 0.2;
      layer2.rotation.y = -bgT * 0.9;
      layer2.rotation.z = bgT * 0.15;
      bgRenderer.render(bgScene, bgCamera);
    })(0);
  })();

});

/* ══════════════════════════════════════════════════════
   AGE GROUP CARD SCROLLER
══════════════════════════════════════════════════════ */
(function initAgeScroller() {
  var scroller = document.getElementById('age-scroller');
  var dotsEl   = document.getElementById('age-dots');
  var prevBtn  = document.getElementById('age-prev');
  var nextBtn  = document.getElementById('age-next');
  if (!scroller) return;

  var cards = scroller.querySelectorAll('.age-card');
  var total  = cards.length;

  // Build dots
  for (var i = 0; i < total; i++) {
    var dot = document.createElement('div');
    dot.className = 'age-dot' + (i === 0 ? ' active' : '');
    dot.dataset.index = i;
    dotsEl.appendChild(dot);
  }
  var dots = dotsEl.querySelectorAll('.age-dot');

  var cachedCardWidth = 0;
  function getCardWidth() {
    if (!cachedCardWidth) cachedCardWidth = cards[0].offsetWidth + 20;
    return cachedCardWidth;
  }
  // Invalidate on resize
  window.addEventListener('resize', function() { cachedCardWidth = 0; }, { passive: true });

  function scrollTo(index) {
    scroller.scrollTo({ left: index * getCardWidth(), behavior: 'smooth' });
  }

  function updateDots() {
    var idx = Math.round(scroller.scrollLeft / getCardWidth());
    dots.forEach(function(d, i) { d.classList.toggle('active', i === idx); });
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx >= total - 1;
  }

  prevBtn.addEventListener('click', function() {
    var idx = Math.round(scroller.scrollLeft / getCardWidth());
    scrollTo(Math.max(0, idx - 1));
  });

  nextBtn.addEventListener('click', function() {
    var idx = Math.round(scroller.scrollLeft / getCardWidth());
    scrollTo(Math.min(total - 1, idx + 1));
  });

  dots.forEach(function(dot) {
    dot.addEventListener('click', function() { scrollTo(parseInt(dot.dataset.index)); });
  });

  scroller.addEventListener('scroll', updateDots);

  // Drag-to-scroll (mouse)
  var isDragging = false, startX, startLeft;
  scroller.addEventListener('mousedown', function(e) {
    isDragging = true;
    startX    = e.pageX;
    startLeft = scroller.scrollLeft;
    scroller.classList.add('grabbing');
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    scroller.scrollLeft = startLeft - (e.pageX - startX);
  });
  document.addEventListener('mouseup', function() {
    if (!isDragging) return;
    isDragging = false;
    scroller.classList.remove('grabbing');
    updateDots();
  });

  // Init state
  updateDots();
})();

/* ══════════════════════════════════════════════════════
   MAPBOX — Florida Park, Ravensmead
   Coordinates: -33.9166, 18.5903
══════════════════════════════════════════════════════ */
(function initMap() {
  var mapEl = document.getElementById('tcc-map');
  if (!mapEl || typeof mapboxgl === 'undefined') return;

  mapboxgl.accessToken = 'REDACTED_MAPBOX_TOKEN';

  var map = new mapboxgl.Map({
    container: 'tcc-map',
    style:     'mapbox://styles/mapbox/dark-v11',
    center:    [18.605392618181373, -33.92310234754082],   // [lng, lat] — Pinedene Rd & Stroebel St, Ravensmead
    zoom:      16,
    pitch:     30,
    bearing:   -10,
    interactive: true,
  });

  // Navigation controls (zoom +/-)
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

  // Custom gold marker element
  var markerEl = document.createElement('div');
  markerEl.className = 'map-marker';

  // Popup
  var popup = new mapboxgl.Popup({ offset: 28, closeButton: false })
    .setHTML('<strong>Tygerberg Cricket Club</strong>Florida Park, Pinedene Rd & Stroebel St<br>Ravensmead, Cape Town');

  new mapboxgl.Marker(markerEl)
    .setLngLat([18.605392618181373, -33.92310234754082])
    .setPopup(popup)
    .addTo(map);

  // Open popup by default
  popup.addTo(map);
})();

/* ══════════════════════════════════════════════════════
   FEATURED PLAYER
   Rotates every 2 weeks based on a fixed epoch.
   No manual switching needed — deterministic from date.
══════════════════════════════════════════════════════ */

// Hash scroll correction — re-scroll after reveal animations settle.
// .reveal elements start at translateY(28px)/opacity:0, so the browser's
// initial hash scroll lands short. We override it after 650ms once settled.
if (window.location.hash) {
  window.scrollTo(0, 0);
  setTimeout(function() {
    var target = document.querySelector(window.location.hash);
    if (target) {
      var offset = target.getBoundingClientRect().top + window.pageYOffset - 66;
      window.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
    }
  }, 650);
}

document.addEventListener('DOMContentLoaded', function() {
(function loadFeaturedPlayer() {
  var loadingEl = document.getElementById('fp-loading');
  var cardEl    = document.getElementById('fp-card');
  var emptyEl   = document.getElementById('fp-empty');
  if (!loadingEl) return;

  fetch(SUPABASE_URL + '/rest/v1/public_players?select=id,name,nickname,role,squad,active,captain,vice_captain,fantasy_value,batting_hand,bowling_style,bio,cricket_hero,favourite_shot,years_at_tcc,photo_url,member_type&active=not.eq.false&member_type=eq.player&order=name.asc', {
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    }
  })
  .then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  })
  .then(function(players) {
    loadingEl.style.display = 'none';

    if (!players || players.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }

    // Deterministic selection: which 2-week period are we in?
    // Epoch: 1 Jan 2025 — change this to shift the rotation cycle
    var EPOCH       = new Date('2025-01-01').getTime();
    var TWO_WEEKS   = 14 * 24 * 60 * 60 * 1000;
    var periodIndex = Math.floor((Date.now() - EPOCH) / TWO_WEEKS);
    var player      = players[periodIndex % players.length];

    // Populate card
    document.getElementById('fp-name').textContent = player.name;
    document.getElementById('fp-role').textContent = player.role;

    // Detail line
    var detail = '';
    if (player.batting_hand)  detail += player.batting_hand + ' Hand Bat';
    if (player.bowling_style) detail += (detail ? ' · ' : '') + player.bowling_style;
    var detailEl = document.getElementById('fp-detail');
    if (detail) { detailEl.textContent = detail; } else { detailEl.style.display = 'none'; }

    // Fact chips
    var chipsEl = document.getElementById('fp-chips');
    var chips = [];
    chips.push({ label: 'Role', value: player.role });
    if (player.batting_hand)  chips.push({ label: 'Batting', value: player.batting_hand + ' Hand' });
    if (player.bowling_style) chips.push({ label: 'Bowling', value: player.bowling_style });
    chipsEl.innerHTML = chips.map(function(c) {
      return '<div class="fp-chip">'
        + '<span class="fp-chip-label">' + c.label + '</span>'
        + '<span class="fp-chip-value">' + c.value + '</span>'
        + '</div>';
    }).join('');

    // Photo
    var photoEl    = document.getElementById('fp-photo');
    var fallbackEl = document.getElementById('fp-fallback');
    if (player.photo_url) {
      photoEl.src = imgUrl(player.photo_url, 600, 80);
      photoEl.alt = player.name;
      photoEl.onerror = function() {
        photoEl.style.display    = 'none';
        fallbackEl.style.display = 'flex';
      };
    } else {
      photoEl.style.display    = 'none';
      fallbackEl.style.display = 'flex';
    }

    // Badges
    var badgesEl = document.getElementById('fp-badges');
    if (player.captain)      badgesEl.innerHTML += '<span class="fp-badge fp-badge-captain">Captain</span>';
    if (player.vice_captain) badgesEl.innerHTML += '<span class="fp-badge fp-badge-vc">Vice Captain</span>';

    // Bio (optional)
    var bioEl = document.getElementById('fp-bio');
    var bio = player.bio || null;
    bioEl.innerHTML     = '<span class="fp-bio-label">About</span><span class="fp-bio-content">' + (bio ? bio : '<span class="fp-bio-soon">Bio coming soon</span>') + '</span>';
    bioEl.style.display = 'block';

    cardEl.style.display = 'grid';
  })
  .catch(function(err) {
    console.error('Featured player error:', err);
    loadingEl.style.display = 'none';
    emptyEl.style.display   = 'block';
  });
})();
}); // DOMContentLoaded

/* ══════════════════════════════════════════════════════
   BACK TO TOP
══════════════════════════════════════════════════════ */
(function() {
  var btn = document.getElementById('back-to-top');
  if (!btn) return;
  window.addEventListener('scroll', function() {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
  btn.addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

/* ══════════════════════════════════════════════════════
   HOME NEWS
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function() {
  var loadingEl = document.getElementById('home-news-loading');
  var gridEl    = document.getElementById('home-news-grid');
  var emptyEl   = document.getElementById('home-news-empty');
  var footerEl  = document.getElementById('home-news-footer');
  if (!loadingEl) return;

  fetch(SUPABASE_URL + '/rest/v1/news?select=id,title,content,cover_image,created_at,pinned,status,expires_at,category,match_meta&status=eq.published&order=pinned.desc,created_at.desc&limit=5', {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
  })
  .then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(function(articles) {
    loadingEl.style.display = 'none';
    if (!articles || !articles.length) { emptyEl.style.display = 'block'; return; }

    gridEl.innerHTML = articles.map(function(a, i) {
      var date    = new Date(a.created_at).toLocaleDateString('en-ZA', { day:'numeric', month:'long', year:'numeric' });
      var excerpt = a.content.replace(/<[^>]+>/g, '').substring(0, 150).trim();
      if (a.content.replace(/<[^>]+>/g,'').length > 150) excerpt += '…';
      var hasBg   = !!a.cover_image;
      var bgStyle = hasBg ? ' style="background-image:url(\'' + a.cover_image.replace(/'/g,'%27') + '\')"' : '';
      var isMR    = a.category === 'match-report';
      var meta    = a.match_meta ? (typeof a.match_meta === 'string' ? JSON.parse(a.match_meta) : a.match_meta) : null;
      var scoreLine = '';
      if (isMR && meta) {
        var parts = [];
        if (meta.team) parts.push(meta.team);
        if (meta.opponent) parts.push('vs ' + meta.opponent);
        if (meta.our_score || meta.their_score) parts.push('\u00b7 TCC ' + (meta.our_score||'\u2014') + ' / ' + (meta.opponent||'Opp') + ' ' + (meta.their_score||'\u2014'));
        if (parts.length) scoreLine = '<div class="news-mr-scores">' + parts.join(' ') + '</div>';
      }
      return '<a class="news-card' + (isMR ? ' news-card-match' : '') + '" href="news.html?id=' + a.id + '">'
        + '<div class="news-card-bg' + (hasBg ? '' : ' no-image') + '"' + bgStyle + '></div>'
        + '<div class="news-card-overlay"></div>'
        + '<div class="news-card-strip' + (isMR ? ' news-strip-match' : '') + '"></div>'
        + (a.pinned ? '<div class="news-card-pinned">📌 Pinned</div>' : '')
        + (isMR ? '<div class="news-card-category news-mr-badge">🏏 Match Report</div>' : '')
        + '<div class="news-card-content">'
        +   (i === 0 ? '<div class="news-card-tag">' + date + '</div>' : '<div class="news-card-date">' + date + '</div>')
        +   '<div class="news-card-title">' + a.title + '</div>'
        +   (isMR ? scoreLine : (i === 0 ? '<div class="news-card-excerpt">' + excerpt + '</div>' : ''))
        + '</div>'
        + '</a>';
    }).join('');

    gridEl.style.display = 'grid';
    if (articles.length >= 3) footerEl.style.display = 'block';
  })
  .catch(function(err) { console.error('News fetch error:', err); loadingEl.style.display = 'none'; });
});

/* ══════════════════════════════════════════════════════
   HERO STAT COUNTERS
══════════════════════════════════════════════════════ */
(function() {
  var flips = document.querySelectorAll('.sb-flip[data-target], .hps-num[data-target]');
  if (!flips.length) return;

  function animateFlip(el) {
    var target   = parseInt(el.dataset.target, 10);
    var duration = 1400;
    var start    = null;
    el.classList.add('counting');
    function step(ts) {
      if (!start) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var eased    = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(target * eased);
      if (progress < 1) { requestAnimationFrame(step); }
      else { el.textContent = target; el.classList.remove('counting'); }
    }
    requestAnimationFrame(step);
  }

  // Hero is visible on load — delay slightly then run
  var triggered = false;
  function trigger() {
    if (triggered) return;
    triggered = true;
    flips.forEach(function(el, i) {
      setTimeout(function() { animateFlip(el); }, 600 + i * 200);
    });
  }

  // Fire once page has loaded
  if (document.readyState === 'complete') { trigger(); }
  else { window.addEventListener('load', trigger); }
})();

/* ══════════════════════════════════════════════════════
   HERO PARALLAX
══════════════════════════════════════════════════════ */
(function() {
  var bgs = document.querySelectorAll('.hero-photo-bg');
  if (!bgs.length) return;
  var ticking = false;
  window.addEventListener('scroll', function() {
    if (!ticking) {
      requestAnimationFrame(function() {
        var scrollY = window.scrollY;
        bgs.forEach(function(bg) {
          bg.style.transform = 'translateY(' + (scrollY * 0.4) + 'px)';
        });
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
})();

/* ══════════════════════════════════════════════════════
   MOTION BACKGROUND — fixed canvas behind the page
══════════════════════════════════════════════════════ */
(function() {
  var canvas = document.getElementById('motion-bg');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var W, H, particles = [], raf;
  var COUNT     = 90;
  var GOLD      = [184, 146, 42];
  var WHITE     = [220, 210, 190];
  var LINK_DIST = 160;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width  = W;
    canvas.height = H;
  }

  function rand(min, max) { return min + Math.random() * (max - min); }

  function make() {
    var useGold = Math.random() > 0.4;
    var col = useGold ? GOLD : WHITE;
    return {
      x:   rand(0, W),
      y:   rand(0, H),
      vx:  rand(-0.3, 0.3),
      vy:  rand(-0.2, 0.2),
      r:   rand(1.2, 3.0),
      a:   rand(0.25, 0.65),
      col: col
    };
  }

  resize();
  for (var i = 0; i < COUNT; i++) particles.push(make());
  window.addEventListener('resize', function() { resize(); }, { passive: true });

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Update + wrap
    particles.forEach(function(p) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10;
      if (p.y > H + 10) p.y = -10;
    });

    // Lines
    for (var i = 0; i < particles.length; i++) {
      for (var j = i + 1; j < particles.length; j++) {
        var dx   = particles[i].x - particles[j].x;
        var dy   = particles[i].y - particles[j].y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < LINK_DIST) {
          var alpha = (1 - dist / LINK_DIST) * 0.22;
          var col   = particles[i].col;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + alpha + ')';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    // Dots
    particles.forEach(function(p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + p.col[0] + ',' + p.col[1] + ',' + p.col[2] + ',' + p.a + ')';
      ctx.fill();
    });

    raf = requestAnimationFrame(draw);
  }

  // Pause when page hidden, resume when visible
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) { cancelAnimationFrame(raf); raf = null; }
    else if (!raf) draw();
  });

  draw();
})();

/* ══════════════════════════════════════════════════════
   ANIMATED STAT COUNTERS — About section
══════════════════════════════════════════════════════ */
(function() {
  var counters = document.querySelectorAll('.stat-counter-val');
  if (!counters.length) return;

  function animateCounter(el) {
    var target   = parseInt(el.dataset.target, 10);
    var duration = 1800;
    var start    = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.floor(ease * target);
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = target;
    }
    requestAnimationFrame(step);
  }

  var triggered = false;
  var section = document.getElementById('about');
  if (!section) return;
  new IntersectionObserver(function(entries) {
    if (triggered) return;
    if (entries[0].isIntersecting) {
      triggered = true;
      counters.forEach(animateCounter);
    }
  }, { threshold: 0.3 }).observe(section);
})();

/* ══════════════════════════════════════════════════════
   SERVICE WORKER — IMAGE CACHE
══════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js')
      .then(function(reg) { /* Service worker registered */ })
      .catch(function(err) { console.warn('SW registration failed:', err); });
  });
}

/* ── INSTAGRAM FALLBACK ──────────────────────────────
   Show fallback card if behold-widget doesn't render
   within 4 seconds (widget failed or blocked)        */
(function() {
  var fallback = document.getElementById('social-fallback');
  if (!fallback) return;
  setTimeout(function() {
    var widget = document.querySelector('behold-widget');
    // Widget renders shadow DOM — check if it has children or a known loaded attribute
    var loaded = widget && (widget.shadowRoot || widget.children.length > 0 ||
                            widget.getAttribute('loaded') !== null);
    if (!loaded) fallback.style.display = 'flex';
  }, 4000);
})();

/* ── HOME LIVE SCORE WIDGET ──────────────────────────
   Supabase Realtime — instant push, 5-min fallback poll */
(function() {
  function fetchHomeLive() {
    fetch(SUPABASE_URL + '/rest/v1/live_scores?select=*&status=eq.live', {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
    })
    .then(function(r) { return r.json(); })
    .then(function(scores) { renderHomeLive(scores); })
    .catch(function() { /* silent fail — non-critical */ });
  }

  function renderHomeLive(scores) {
    var wrap = document.getElementById('home-live-wrap');

    // Reset all rows
    document.querySelectorAll('.frl-row').forEach(function(r) { r.classList.remove('frl-row-live'); });
    document.querySelectorAll('[id^="frl-score-"]').forEach(function(el) { el.style.display = 'none'; });
    document.querySelectorAll('[id^="frl-badge-"]').forEach(function(el) { el.style.display = 'none'; });

    if (!scores || !scores.length) {
      if (wrap) wrap.style.display = 'none';
      return;
    }

    var anyMatch = false;

    scores.forEach(function(ls) {
      var row   = document.querySelector('.frl-row[data-fixture-id="' + ls.fixture_id + '"]');
      var sEl   = document.getElementById('frl-score-' + ls.fixture_id);
      var bEl   = document.getElementById('frl-badge-' + ls.fixture_id);
      if (!row || !sEl) return;

      anyMatch = true;
      row.classList.add('frl-row-live');

      var overs  = ls.overs + '.' + (ls.balls || 0);
      var effMax = ls.revised_overs || ls.max_overs;
      var need   = ls.target
        ? (ls.target - ls.runs) + ' to win'
          + (effMax ? ' from ' + ((effMax - ls.overs) * 6 - (ls.balls||0)) + ' balls' : '')
        : null;

      var snumEl  = document.getElementById('frl-snum-'  + ls.fixture_id);
      var sdetEl  = document.getElementById('frl-sdet-'  + ls.fixture_id);
      var sneedEl = document.getElementById('frl-sneed-' + ls.fixture_id);

      if (snumEl)  snumEl.textContent  = ls.runs + '/' + ls.wickets;
      if (sdetEl)  sdetEl.textContent  = (ls.batting_team || '') + ' bat · ' + overs + ' ov'
        + (ls.run_rate ? ' · RR ' + ls.run_rate : '')
        + (ls.revised_overs ? ' (rev. ' + ls.revised_overs + ')' : '');
      if (sneedEl) sneedEl.textContent = need || '';

      sEl.style.display = 'flex';
      if (bEl) bEl.style.display = 'inline-flex';
    });

    if (wrap) wrap.style.display = anyMatch ? 'block' : 'none';
  }

  function timeSinceHome(iso) {
    if (!iso) return '';
    var secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60)   return 'just now';
    if (secs < 3600) return Math.floor(secs/60) + ' min ago';
    return Math.floor(secs/3600) + 'h ago';
  }

  fetchHomeLive(); // immediate first load

  // Supabase Realtime — raw WebSocket, same pattern as live.js
  (function startHomeRealtime() {
    var wsUrl = 'wss://cgjannvzpqecwzjdzwso.supabase.co/realtime/v1/websocket'
              + '?apikey=' + SUPABASE_ANON_KEY + '&vsn=1.0.0';
    var ws  = new WebSocket(wsUrl);
    var ref = 0;

    ws.addEventListener('open', function() {
      ws.send(JSON.stringify({
        topic:   'realtime:live_scores_home',
        event:   'phx_join',
        payload: { config: { postgres_changes: [{ event: '*', schema: 'public', table: 'live_scores' }] } },
        ref:     String(++ref)
      }));
      var hb = setInterval(function() {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }));
        }
      }, 25000);
      ws._hb = hb;
    });

    ws.addEventListener('message', function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.topic === 'phoenix') return;
        var type = msg.payload && (msg.payload.type || (msg.payload.data && msg.payload.data.type));
        if (msg.event === 'postgres_changes' || type === 'INSERT' || type === 'UPDATE' || type === 'DELETE') {
          fetchHomeLive();
        }
      } catch(err) {}
    });

    ws.addEventListener('close', function() {
      clearInterval(ws._hb);
      setTimeout(startHomeRealtime, 5000);
    });

    ws.addEventListener('error', function() {
      clearInterval(ws._hb);
    });
  })();
})();

/* ══════════════════════════════════════════════════════
   FIXTURE TAB TOGGLE — Upcoming / Results
══════════════════════════════════════════════════════ */
var fixtureTabActive = 'upcoming';
var allFixturesCache = [];

function switchFixtureTab(tab) {
  fixtureTabActive = tab;
  document.getElementById('tab-upcoming').classList.toggle('active', tab === 'upcoming');
  document.getElementById('tab-results').classList.toggle('active', tab === 'results');

  if (tab === 'upcoming') {
    document.getElementById('fixtures-list').style.display    = allFixturesCache.length ? 'block' : 'none';
    document.getElementById('results-list').style.display     = 'none';
    document.getElementById('results-loading').style.display  = 'none';
    document.getElementById('results-empty').style.display    = 'none';
  } else {
    document.getElementById('fixtures-list').style.display    = 'none';
    loadResults();
  }
}

function renderResults(fixtures) {
  var past = fixtures
    .filter(function(f) { return f.date < today && f.result; })
    .sort(function(a, b) { return a.date > b.date ? -1 : 1; })
    .slice(0, 10);

  if (!past.length) {
    document.getElementById('results-loading').style.display = 'none';
    document.getElementById('results-empty').style.display   = 'flex';
    document.getElementById('results-list').style.display    = 'none';
    return;
  }

  var html = '<div class="frl">';
  past.forEach(function(f) {
    var d = fmtDate(f.date);
    var r = (f.result || '').toLowerCase();
    var badgeClass = r === 'won' || r === 'win' ? 'badge-win'
                   : r === 'lost' || r === 'loss' ? 'badge-loss' : 'badge-result';
    var badgeLabel = r === 'won' || r === 'win' ? 'Won'
                   : r === 'lost' || r === 'loss' ? 'Lost' : f.result;

    html += '<div class="frl-row">';
    html += '<div class="frl-date"><div class="frl-day">' + d.day + '</div><div class="frl-mon">' + d.month + '</div></div>';
    html += '<div class="frl-team">' + (f.team || '') + '</div>';
    html += '<div class="frl-match">';
    html += '<div class="frl-opp">' + (f.opponent || 'TBC') + '</div>';
    html += '<div class="frl-meta">' + (f.venue ? '<span>📍 ' + f.venue + '</span>' : '') + (f.division ? '<span>' + f.division + '</span>' : '') + '</div>';
    html += '</div>';
    html += '<div class="frl-score"></div>';
    html += '<div class="frl-badge-wrap"><span class="badge ' + badgeClass + '">' + badgeLabel + '</span></div>';
    html += '</div>';
  });
  html += '</div>';

  document.getElementById('results-list').innerHTML = html;
  document.getElementById('results-loading').style.display = 'none';
  document.getElementById('results-list').style.display    = 'block';
}

function loadResults() {
  if (allFixturesCache.length) {
    renderResults(allFixturesCache);
    return;
  }
  document.getElementById('results-loading').style.display = 'flex';
  document.getElementById('results-empty').style.display   = 'none';
  document.getElementById('results-list').style.display    = 'none';

  var url = SUPABASE_URL + '/rest/v1/' + FIXTURES_TABLE + '?select=*&order=date.desc';
  fetch(url, { headers: supabaseHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(data) { allFixturesCache = data; renderResults(data); })
    .catch(function() {
      document.getElementById('results-loading').style.display = 'none';
      document.getElementById('results-empty').style.display   = 'flex';
    });
}

/* Patch loadFixtures to cache results too */
var _origRenderNextFixtures = renderNextFixtures;
renderNextFixtures = function(data) {
  allFixturesCache = data;
  _origRenderNextFixtures(data);
};

/* ══════════════════════════════════════════════════════
   HOME LIVE BANNER — prominent strip above fixtures
══════════════════════════════════════════════════════ */
(function() {
  function renderHomeLiveBanner(scores) {
    var banner  = document.getElementById('home-live-banner');
    var matchEl = document.getElementById('hlb-matches');
    if (!banner || !matchEl) return;

    if (!scores || !scores.length) { banner.style.display = 'none'; return; }

    var html = '';
    scores.forEach(function(ls) {
      var overs = ls.overs + (ls.balls ? '.' + ls.balls : '');
      var need  = ls.target ? (ls.target - ls.runs) + ' to win' : null;
      html += '<a href="live.html" class="hlb-match">';
      html +=   '<div class="hlb-match-info">';
      html +=     '<div class="hlb-match-team">' + (ls.batting_team || 'TCC') + '</div>';
      html +=     '<div class="hlb-match-opp">vs ' + (ls.fielding_team || 'Opponent') + '</div>';
      html +=     '<div class="hlb-match-over">Over ' + overs + (ls.run_rate ? ' · RR ' + ls.run_rate : '') + '</div>';
      html +=   '</div>';
      html +=   '<div>';
      html +=     '<div class="hlb-match-score">' + ls.runs + '/' + ls.wickets + '</div>';
      if (need) html += '<div class="hlb-match-need">' + need + '</div>';
      html +=   '</div>';
      html += '</a>';
    });

    matchEl.innerHTML = html;
    banner.style.display = 'block';
  }

  function fetchLiveBanner() {
    fetch(SUPABASE_URL + '/rest/v1/live_scores?select=*&status=eq.live', {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
    })
    .then(function(r) { return r.json(); })
    .then(renderHomeLiveBanner)
    .catch(function() {});
  }

  fetchLiveBanner();

  /* Supabase Realtime for banner */
  try {
    var ws2 = new WebSocket(
      SUPABASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')
      + '/realtime/v1/websocket?apikey=' + SUPABASE_ANON_KEY + '&vsn=1.0.0'
    );
    ws2.onopen = function() {
      ws2.send(JSON.stringify({ topic:'realtime:public:live_scores', event:'phx_join', payload:{}, ref:'banner' }));
    };
    ws2.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.event === 'INSERT' || msg.event === 'UPDATE' || msg.event === 'DELETE') {
          fetchLiveBanner();
        }
      } catch(ex) {}
    };
  } catch(ex) {}

  setInterval(fetchLiveBanner, 60000);
})();

/* ══════════════════════════════════════════════════════
   FANTASY HOMEPAGE WIDGET
══════════════════════════════════════════════════════ */
(function() {
  function loadFantasyHomeWidget() {
    var FANTASY_URL = SUPABASE_URL + '/rest/v1/';
    var headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY };

    /* Participant count */
    fetch(FANTASY_URL + 'fantasy_participants?select=id&status=eq.approved', { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var el = document.getElementById('hf-stat-players');
        if (el) el.textContent = d.length || '—';
      }).catch(function() {});

    /* Rounds played */
    fetch(FANTASY_URL + 'fantasy_scores?select=round_id', { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var el = document.getElementById('hf-stat-rounds');
        if (el) {
          var unique = new Set((d || []).map(function(r) { return r.round_id; }));
          el.textContent = unique.size || '—';
        }
      }).catch(function() {});

    /* Next deadline */
    fetch(FANTASY_URL + 'fantasy_rounds?select=name,deadline&locked=eq.false&order=deadline.asc&limit=1', { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var el = document.getElementById('hf-stat-deadline');
        if (el && d.length) {
          var dl = new Date(d[0].deadline);
          el.textContent = dl.toLocaleDateString('en-ZA', { weekday: 'short', month: 'short', day: 'numeric' });
        } else if (el) {
          el.textContent = 'TBC';
        }
      }).catch(function() {});

    /* Leaderboard top 5 — reads from the fantasy_leaderboard_summary view
       which computes live points from fantasy_picks + fantasy_scores       */
    fetch(FANTASY_URL + 'fantasy_leaderboard_summary?select=team_name,name,total_points&limit=5', { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var el = document.getElementById('hf-lb-rows');
        if (!el || !Array.isArray(d) || !d.length) return;
        var html = '';
        d.forEach(function(p, i) {
          html += '<div class="hf-lb-row' + (i === 0 ? ' hf-lb-top' : '') + '">';
          html += '<div class="hf-lb-rank' + (i === 0 ? ' gold' : '') + '">' + (i + 1) + '</div>';
          html += '<div><div class="hf-lb-name">' + (p.team_name || p.name || 'Unknown') + '</div></div>';
          html += '<div class="hf-lb-pts">' + (p.total_points || 0) + '</div>';
          html += '</div>';
        });
        el.innerHTML = html;
      }).catch(function() {});
  }

  /* Only load if the section exists and fantasy is enabled */
  if (FANTASY_ENABLED && document.getElementById('home-fantasy')) {
    loadFantasyHomeWidget();
  } else if (!FANTASY_ENABLED) {
    var fs = document.getElementById('home-fantasy');
    if (fs) fs.style.display = 'none';
  }
})();

/* ══════════════════════════════════════════════════════
   WHAT'S ON — upcoming public club events.
   Served by the Worker's events.publicList action, which returns ONLY
   events an admin has flagged "show on the public website". No birthdays,
   no internal committee events. The whole section stays hidden unless
   there is at least one upcoming event, so the page never shows an
   empty block.
══════════════════════════════════════════════════════ */
/* Shared by the card renderer (inside the IIFE) and the detail modal
   (outside it) — must live at module scope or the modal throws on open. */
function woEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

var woEvents = [];
var _woLastFocus = null;

function woTime(t) { return String(t || '').slice(0, 5); }

function woLongDate(iso) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return '';
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/* Minimal RFC 5545 file so a reader can put the event straight in their phone.
   Local times are written as floating (no TZ) — correct for a single-venue
   club event, and avoids shipping a timezone database. */
function woIcs(ev) {
  var d = String(ev.start_date || '').replace(/-/g, '');
  if (!d) return null;
  var pad = function (s) { return String(s || '').replace(/:/g, '').slice(0, 4) + '00'; };
  var start = ev.start_time ? d + 'T' + pad(ev.start_time) : d;
  var endDate = String(ev.end_date || ev.start_date || '').replace(/-/g, '');
  var end = ev.end_time ? endDate + 'T' + pad(ev.end_time) : null;
  var esc = function (s) { return String(s == null ? '' : s).replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n'); };
  var lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tygerberg Cricket Club//What\u2019s On//EN',
    'BEGIN:VEVENT',
    'UID:tcc-' + (ev.id || d) + '@tygerbergcc.co.za',
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
    ev.start_time ? 'DTSTART:' + start : 'DTSTART;VALUE=DATE:' + start,
    end ? 'DTEND:' + end : (ev.start_time ? '' : 'DTEND;VALUE=DATE:' + endDate),
    'SUMMARY:' + esc(ev.title),
    ev.venue ? 'LOCATION:' + esc(ev.venue) : '',
    ev.description ? 'DESCRIPTION:' + esc(ev.description) : '',
    'END:VEVENT', 'END:VCALENDAR'
  ].filter(Boolean);
  return lines.join('\r\n');
}

function openWoModal(idx) {
  var ev = woEvents[idx];
  var modal = document.getElementById('wo-modal');
  if (!ev || !modal) return;
  _woLastFocus = document.activeElement;

  var TYPE = { social: 'Social', meeting: 'Meeting', training: 'Training', fixture: 'Fixture', other: 'Event' };
  var parts = String(ev.start_date || '').split('-');
  var MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  document.getElementById('wo-m-date').textContent = (parts[2] || '') + ' ' + (MONS[(Number(parts[1]) || 1) - 1] || '');
  document.getElementById('wo-m-type').textContent = TYPE[ev.event_type] || 'Event';
  document.getElementById('wo-m-title').textContent = ev.title || '';
  document.getElementById('wo-m-desc').textContent = ev.description || '';

  // Poster uncropped here — the card shows a 16:9 slice, this shows all of it.
  var posterEl = document.getElementById('wo-m-poster');
  if (/^https:\/\//.test(String(ev.image_url || ''))) {
    var im = document.createElement('img');
    im.src = ev.image_url; im.alt = '';
    posterEl.innerHTML = ''; posterEl.appendChild(im);
    posterEl.style.display = '';
  } else {
    posterEl.innerHTML = ''; posterEl.style.display = 'none';
  }

  var facts = [];
  var when = woLongDate(ev.start_date);
  var times = [woTime(ev.start_time), woTime(ev.end_time)].filter(Boolean).join(' \u2013 ');
  if (when)     facts.push(['When', when + (times ? ', ' + times : '')]);
  if (ev.venue) facts.push(['Where', ev.venue]);
  document.getElementById('wo-m-facts').innerHTML = facts.map(function (f) {
    return '<dt>' + woEsc(f[0]) + '</dt><dd>' + woEsc(f[1]) + '</dd>';
  }).join('');

  var icsBtn = document.getElementById('wo-m-ics');
  icsBtn.onclick = function () {
    var body = woIcs(ev);
    if (!body) return;
    var blob = new Blob([body], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = String(ev.title || 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('wo-m-close').focus();
}

function closeWoModal() {
  var modal = document.getElementById('wo-modal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  if (_woLastFocus && _woLastFocus.focus) _woLastFocus.focus();
}

document.addEventListener('click', function (e) {
  if (e.target.closest('[data-wo-close]') || e.target.closest('#wo-m-close')) closeWoModal();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeWoModal();
});

(function loadWhatsOn() {
  var section = document.getElementById('whats-on');
  var listEl  = document.getElementById('wo-list');
  if (!section || !listEl) return;          // not the home page

  function woISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
                           + '-' + String(d.getDate()).padStart(2, '0');
  }

  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var TYPE_LABEL = { social:'Social', meeting:'Meeting', training:'Training', fixture:'Fixture', other:'Event' };

  var from = new Date();
  var to   = new Date(); to.setMonth(to.getMonth() + 4);   // next ~4 months

  fetch('https://tcc-admin.bydaries.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'events.publicList',
      payload: { from: woISO(from), to: woISO(to) }
    })
  })
  .then(function (r) { return r.ok ? r.json() : []; })
  .then(function (rows) {
    if (!Array.isArray(rows) || !rows.length) return;      // nothing on — stay hidden

    var shown = rows.slice(0, 8);
    woEvents = shown;
    listEl.innerHTML = shown.map(function (ev, evIdx) {
      var parts = String(ev.start_date || '').split('-');
      var day   = parts[2] || '';
      var mon   = MON[(Number(parts[1]) || 1) - 1] || '';
      var label = TYPE_LABEL[ev.event_type] || 'Event';
      var meta  = [];
      if (ev.start_time) meta.push(String(ev.start_time).slice(0, 5));
      if (ev.venue)      meta.push(ev.venue);

      // No poster uploaded -> a deliberate branded panel, never a broken box.
      var hasImg = /^https:\/\//.test(String(ev.image_url || ''));
      var imgPos = /^\d{1,3}% \d{1,3}%$/.test(String(ev.image_pos || '')) ? ev.image_pos : '50% 50%';
      var poster = hasImg
        ? '<img class="wo-poster-img" src="' + woEsc(ev.image_url) + '" alt="" loading="lazy" width="480" height="270" style="object-position:' + woEsc(imgPos) + '">'
        : '<span class="wo-poster-fallback">' + woEsc(label) + '</span>';

      return '<article class="wo-card" data-wo-idx="' + evIdx + '" tabindex="0" role="button" aria-label="Read more about ' + woEsc(ev.title) + '">'
           +   '<div class="wo-poster' + (hasImg ? '' : ' wo-poster-empty') + '">' + poster + '</div>'
           +   '<div class="wo-body">'
           +     '<div class="wo-eyebrow">'
           +       '<span class="wo-date">' + woEsc(day + ' ' + mon) + '</span>'
           +       '<span class="wo-type">' + woEsc(label) + '</span>'
           +     '</div>'
           +     '<h3 class="wo-title">' + woEsc(ev.title) + '</h3>'
           +     (meta.length ? '<div class="wo-meta">' + woEsc(meta.join(' \u00b7 ')) + '</div>' : '')
           +     (ev.description ? '<p class="wo-desc">' + woEsc(ev.description) + '</p>' : '')
           +   '</div>'
           + '</article>';
    }).join('');

    section.style.display = '';
    // The reveal observer has already run by now, so trigger these directly.
    section.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('visible'); });

    // Whole card opens the detail view — people tap the poster instinctively.
    listEl.addEventListener('click', function (e) {
      var card = e.target.closest('.wo-card[data-wo-idx]');
      if (card) openWoModal(Number(card.dataset.woIdx));
    });
    listEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var card = e.target.closest('.wo-card[data-wo-idx]');
      if (!card) return;
      e.preventDefault();
      openWoModal(Number(card.dataset.woIdx));
    });
  })
  .catch(function () { /* stay hidden on failure — never show a broken block */ });
})();
