/* ══════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════ */
var SUPABASE_URL      = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';

/* ══ PHOTO GATE ══
   A minor's photo only shows with media consent on file, whichever squad
   they are in. That rule now lives in the database, in the public_players
   view, and this page simply gets no photo_url for a player who may not be
   shown.

   It used to be decided here, from is_minor and media_consent read over the
   API. Two things were wrong with that:

     * the API handed photo_url to every caller regardless, and the page
       merely declined to render it. Anyone reading the network tab, or
       calling the endpoint with the anon key that ships in this file,
       could get a non-consented minor's photo URL and open it. A gate in
       the client is not a gate.

     * the comment above this function used to say minor status must be
       derived from dob because a stored flag goes stale — and then the
       query did not select dob, so it fell back to exactly that flag.

   The view derives it from dob on every read, so it self-corrects on a
   birthday, and dob never leaves the database. */
function photoAllowedFor(p) {
  return !!p.photo_url;
}

/* ══ NAV ══ */
var hamburger  = document.getElementById('hamburger');
var navLinksEl = document.getElementById('nav-links');
hamburger.addEventListener('click', function() { hamburger.classList.toggle('open'); navLinksEl.classList.toggle('open'); });
navLinksEl.querySelectorAll('a').forEach(function(a) {
  a.addEventListener('click', function() { hamburger.classList.remove('open'); navLinksEl.classList.remove('open'); });
});

/* ══ COPYRIGHT ══ */
document.querySelectorAll('.copy-year').forEach(function(el) { el.textContent = new Date().getFullYear(); });

/* ══════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════ */
function setState(state) {
  document.getElementById('players-loading').style.display = state === 'loading' ? 'block' : 'none';
  document.getElementById('players-error').style.display   = state === 'error'   ? 'block' : 'none';
  document.getElementById('players-empty').style.display   = state === 'empty'   ? 'block' : 'none';
  document.getElementById('players-grid').style.display    = state === 'grid'    ? 'grid'  : 'none';
  document.getElementById('players-controls').style.display= state === 'grid'    ? 'flex'  : 'none';
}

/* ══════════════════════════════════════════════════════
   RENDER CARD
══════════════════════════════════════════════════════ */
var allPlayersData = [];

function renderCard(p) {
  // Squad = which side they play for (admin decision), NOT their age.
  // Null squad → senior, so existing players don't vanish before the backfill.
  var squad = (p.squad === 'youth') ? 'youth' : 'senior';
  var photoAllowed = photoAllowedFor(p);

  var avatar = photoAllowed
    ? '<img src="' + p.photo_url + '" alt="' + p.name + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
      + '<div class="player-avatar-fallback" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>'
    : '<div class="player-avatar-fallback"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>';

  var badges = '';
  if (squad === 'youth') badges += '<span class="player-badge badge-youth">Youth</span>';
  if (p.captain)      badges += '<span class="player-badge badge-captain">Captain</span>';
  if (p.vice_captain) badges += '<span class="player-badge badge-vc">Vice Captain</span>';

  var roleDetail = p.batting_hand ? p.batting_hand : '';
  if (p.bowling_style && p.bowling_style !== "Don't bowl") roleDetail += (roleDetail ? ' · ' : '') + p.bowling_style;

  var letter = p.name.trim().charAt(0).toUpperCase();

  return '<div class="player-card" data-id="' + p.id + '" data-name="' + p.name.toLowerCase() + '" data-letter="' + letter + '" data-role="' + (p.role||'') + '" data-squad="' + squad + '">'
    + '<div class="player-avatar">' + avatar + '</div>'
    + (badges ? '<div class="player-badges">' + badges + '</div>' : '')
    + '<div class="player-info">'
    +   '<div class="player-name">' + p.name + '</div>'
    +   '<div class="player-role">' + p.role + '</div>'
    +   (roleDetail ? '<div class="player-detail">' + roleDetail + '</div>' : '')
    +   (p.bio
          ? '<div class="player-bio-peek">' + p.bio.substring(0, 80) + (p.bio.length > 80 ? '…' : '') + '</div>'
          : '<div class="player-bio-soon">Bio coming soon</div>')
    +   '<div class="player-card-hint">View profile →</div>'
    + '</div>'
    + '</div>';
}

/* ══════════════════════════════════════════════════════
   PLAYER MODAL
══════════════════════════════════════════════════════ */
function openPlayerModal(id) {
  var p = allPlayersData.find(function(pl){ return pl.id === id; });
  if (!p) return;

  var modal   = document.getElementById('player-modal');
  var content = document.getElementById('player-modal-content');

  var squad = (p.squad === 'youth') ? 'youth' : 'senior';
  var photoAllowed = photoAllowedFor(p);

  var badgesHtml = '';
  if (squad === 'youth') badgesHtml += '<span class="player-badge badge-youth">Youth</span>';
  if (p.captain)      badgesHtml += '<span class="player-badge badge-captain">Captain</span>';
  if (p.vice_captain) badgesHtml += '<span class="player-badge badge-vc">Vice Captain</span>';

  // Stats grid — batting, bowling, years
  var stats = [];
  if (p.batting_hand)                                        stats.push({ label: 'Batting',     val: p.batting_hand });
  if (p.bowling_style && p.bowling_style !== "Don't bowl")  stats.push({ label: 'Bowling',     val: p.bowling_style });
  if (p.years_at_tcc)                                        stats.push({ label: 'Years at TCC', val: p.years_at_tcc + (p.years_at_tcc === 1 ? ' yr' : ' yrs') });

  var statsHtml = stats.length
    ? '<div class="pm-stats">' + stats.map(function(s) {
        return '<div class="pm-stat"><span class="pm-stat-label">' + s.label + '</span><span class="pm-stat-val">' + s.val + '</span></div>';
      }).join('') + '</div>'
    : '';

  // Extras — favourite shot and cricket hero
  var extras = [];
  if (p.favourite_shot) extras.push({ icon: '🏏', label: 'Favourite shot', val: p.favourite_shot });
  if (p.cricket_hero)   extras.push({ icon: '⭐', label: 'Cricket hero',   val: p.cricket_hero });

  var extrasHtml = extras.length
    ? '<div class="pm-extras">' + extras.map(function(e) {
        return '<div class="pm-extra"><span class="pm-extra-icon">' + e.icon + '</span>'
          + '<div><span class="pm-extra-label">' + e.label + '</span>'
          + '<span class="pm-extra-val">' + e.val + '</span></div></div>';
      }).join('') + '</div>'
    : '';

  var photoHtml = photoAllowed
    ? '<div class="pm-photo"><img src="' + p.photo_url + '" alt="' + p.name + '" loading="lazy"></div>'
    : '<div class="pm-photo pm-photo-fallback"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="12" cy="8" r="5"/><path d="M3 21c0-5 4-9 9-9s9 4 9 9"/></svg></div>';

  content.innerHTML =
    photoHtml
    + '<div class="pm-body">'
    +   '<div class="pm-header">'
    +     '<div class="pm-name">' + p.name + '</div>'
    +     (p.nickname ? '<div class="pm-nickname">"' + p.nickname + '"</div>' : '')
    +     '<div class="pm-role">' + p.role + '</div>'
    +     (badgesHtml ? '<div class="pm-badges">' + badgesHtml + '</div>' : '')
    +   '</div>'
    +   statsHtml
    +   extrasHtml
    +   (p.bio
        ? '<div class="pm-bio">' + p.bio + '</div>'
        : '<div class="pm-bio-soon">Bio coming soon — <a href="player-bio.html" style="color:var(--gold)">submit yours</a></div>')
    + '</div>';

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePlayerModal() {
  var modal = document.getElementById('player-modal');
  if (modal) { modal.classList.remove('open'); }
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════════════════════
   ALPHABET BAR
══════════════════════════════════════════════════════ */
var activeLetter = null;
var activeRole   = 'all';
var activeSquad  = 'senior';   // tabs: always one squad or the other

function buildAlphaBar(players) {
  var letters = new Set(players.map(function(p) { return p.name.trim().charAt(0).toUpperCase(); }));
  var bar = document.getElementById('alpha-bar');
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  bar.innerHTML = alphabet.map(function(l) {
    var has = letters.has(l);
    return '<button class="alpha-btn" data-letter="' + l + '"' + (has ? '' : ' disabled') + '>' + l + '</button>';
  }).join('');

  bar.querySelectorAll('.alpha-btn:not(:disabled)').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var letter = btn.dataset.letter;
      if (activeLetter === letter) {
        // Deselect
        activeLetter = null;
        btn.classList.remove('active');
        applyFilters();
      } else {
        activeLetter = letter;
        bar.querySelectorAll('.alpha-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        // Clear search when selecting a letter
        document.getElementById('player-search').value = '';
        document.getElementById('player-search-clear').style.display = 'none';
        applyFilters();
      }
    });
  });
}

/* ══════════════════════════════════════════════════════
   SEARCH
══════════════════════════════════════════════════════ */
var searchInput = document.getElementById('player-search');
var clearBtn    = document.getElementById('player-search-clear');

searchInput.addEventListener('input', function() {
  var val = searchInput.value.trim();
  clearBtn.style.display = val ? 'block' : 'none';
  // Clear letter filter when typing
  if (val && activeLetter) {
    activeLetter = null;
    document.querySelectorAll('.alpha-btn').forEach(function(b) { b.classList.remove('active'); });
  }
  applyFilters();
});

clearBtn.addEventListener('click', function() {
  searchInput.value = '';
  clearBtn.style.display = 'none';
  applyFilters();
  searchInput.focus();
});

/* ══════════════════════════════════════════════════════
   FILTER LOGIC
══════════════════════════════════════════════════════ */
function applyFilters() {
  var term   = searchInput.value.trim().toLowerCase();
  var cards  = document.querySelectorAll('.player-card');
  var visible = 0;

  cards.forEach(function(card) {
    var name   = card.dataset.name;
    var letter = card.dataset.letter;
    var role   = card.dataset.role || '';
    var squad  = card.dataset.squad || 'senior';
    var show   = true;

    if (term)                          show = name.indexOf(term) !== -1;
    if (activeLetter)                  show = letter === activeLetter;
    if (activeRole !== 'all') {
      // Wicketkeeper-Batter should match both 'Wicketkeeper' and the WK filter
      var roleMatch = role === activeRole || role.indexOf(activeRole) !== -1;
      show = show && roleMatch;
    }
    // Squad tab always applies — juniors and seniors are kept separate.
    show = show && (squad === activeSquad);

    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  // No results message
  var noResults = document.getElementById('no-results');
  var noTerm    = document.getElementById('no-results-term');
  if (visible === 0) {
    noTerm.textContent = term || activeLetter
      || (activeSquad === 'youth' ? 'the Youth squad' : 'the Senior squad');
    noResults.style.display = 'block';
    document.getElementById('players-grid').style.display = 'none';
  } else {
    noResults.style.display = 'none';
    document.getElementById('players-grid').style.display = 'grid';
  }
}

/* ══════════════════════════════════════════════════════
   FETCH
══════════════════════════════════════════════════════ */
function loadPlayers() {
  setState('loading');

  fetch(SUPABASE_URL + '/rest/v1/public_players?select=id,name,nickname,role,squad,active,captain,vice_captain,fantasy_value,batting_hand,bowling_style,bio,cricket_hero,favourite_shot,years_at_tcc,photo_url,member_type&active=not.eq.false&member_type=eq.player&order=name.asc', {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
  })
  .then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  })
  .then(function(players) {
    if (!players || players.length === 0) { setState('empty'); return; }
    var grid = document.getElementById('players-grid');
    grid.innerHTML = players.map(renderCard).join('');
    buildAlphaBar(players);
    setState('grid');
    // Store for modal and attach click handlers
    allPlayersData = players;
    document.querySelectorAll('.player-card[data-id]').forEach(function(card) {
      card.addEventListener('click', function() { openPlayerModal(card.dataset.id); });
    });
    // Apply the default squad tab (Senior) immediately — otherwise youth
    // players would show in the senior view on first load.
    applyFilters();
  })
  .catch(function(err) {
    console.error('Players fetch error:', err);
    setState('error');
  });
}

loadPlayers();

/* ══ Modal close handlers ══ */
document.getElementById('player-modal-close').addEventListener('click', closePlayerModal);
document.getElementById('player-modal').addEventListener('click', function(e) {
  if (e.target === this) closePlayerModal();
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closePlayerModal();
});

/* ══════════════════════════════════════════════════════
   ROLE FILTER
══════════════════════════════════════════════════════ */
document.getElementById('player-role-filters').querySelectorAll('.prf-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.getElementById('player-role-filters').querySelectorAll('.prf-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    activeRole = btn.dataset.role;
    // Clear letter + search when filtering by role
    activeLetter = null;
    document.querySelectorAll('.alpha-btn').forEach(function(b) { b.classList.remove('active'); });
    searchInput.value = '';
    clearBtn.style.display = 'none';
    applyFilters();
  });
});

/* ══════════════════════════════════════════════════════
   SQUAD FILTER (Seniors / Youth)
══════════════════════════════════════════════════════ */
document.getElementById('player-squad-filters').querySelectorAll('.pst-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.getElementById('player-squad-filters').querySelectorAll('.pst-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    activeSquad = btn.dataset.squad;

    // Reset the other filters so the squad view starts clean
    activeRole = 'all';
    document.getElementById('player-role-filters').querySelectorAll('.prf-btn').forEach(function(b) { b.classList.remove('active'); });
    var allRoleBtn = document.querySelector('#player-role-filters .prf-btn[data-role="all"]');
    if (allRoleBtn) allRoleBtn.classList.add('active');

    activeLetter = null;
    document.querySelectorAll('.alpha-btn').forEach(function(b) { b.classList.remove('active'); });
    searchInput.value = '';
    clearBtn.style.display = 'none';

    applyFilters();
  });
});
