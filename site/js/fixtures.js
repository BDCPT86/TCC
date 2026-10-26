/* ══════════════════════════════════════════════════════
   CONFIG — shared with main site
══════════════════════════════════════════════════════ */
var SUPABASE_URL      = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var FIXTURES_TABLE    = 'fixtures';
var SENIOR_TEAMS      = ['1st Team', '2nd Team', '3rd Team', '4th Team'];

/* ══════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════ */
var allData        = [];   // club fixtures only — the tournament has its own block
var tournamentData = [];   // fixtures belonging to a tournament
var tournaments    = {};   // id -> tournament record
var activeTeam   = 'all';
var activeResult = 'all';
var activeSeason = '2025/2026';

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
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

var today = new Date().toISOString().slice(0, 10);

function isUpcoming(f) { return !f.result && f.date >= today; }
function isPlayed(f)   { return !!f.result || f.date < today; }

function resultBadge(f) {
  if (f.date >= today && !f.result) return '<span class="badge badge-upcoming">Upcoming</span>';
  if (!f.result) return '<span class="badge badge-result">Played</span>';
  var r = f.result.toLowerCase();
  if (r === 'won'  || r === 'win')  return '<span class="badge badge-win">Won</span>';
  if (r === 'lost' || r === 'loss') return '<span class="badge badge-loss">Lost</span>';
  if (r === 'draw')                 return '<span class="badge badge-result">Draw</span>';
  return '<span class="badge badge-result">' + f.result + '</span>';
}

/* ══════════════════════════════════════════════════════
   FILTER & RENDER
══════════════════════════════════════════════════════ */
function applyFilters() {
  var filtered = allData.filter(function(f) {
    if (f.season !== activeSeason) return false;
    if (activeTeam !== 'all' && f.team !== activeTeam) return false;
    if (activeResult === 'upcoming' && !isUpcoming(f)) return false;
    if (activeResult === 'played'   && !isPlayed(f))   return false;
    return true;
  });
  renderFixtures(filtered);
  updateSummary(filtered);
}

function renderFixtures(fixtures) {
  var output = document.getElementById('fixtures-output');

  document.getElementById('state-loading').style.display = 'none';
  document.getElementById('state-error').style.display   = 'none';

  if (!fixtures || fixtures.length === 0) {
    output.innerHTML = '';
    document.getElementById('state-empty').style.display = 'flex';
    return;
  }
  document.getElementById('state-empty').style.display = 'none';

  // Group by team in defined order, then by date
  var grouped = {};
  SENIOR_TEAMS.forEach(function(t) { grouped[t] = []; });

  fixtures.forEach(function(f) {
    if (grouped[f.team] !== undefined) {
      grouped[f.team].push(f);
    } else {
      // Non-senior teams (youth etc.) — bucket into 'Other'
      if (!grouped['Other']) grouped['Other'] = [];
      grouped['Other'].push(f);
    }
  });

  // If filtering by a single team, skip group headers for cleaner look
  var singleTeam = activeTeam !== 'all';

  var html = '';

  var teamKeys = singleTeam ? [activeTeam] : SENIOR_TEAMS.concat(grouped['Other'] ? ['Other'] : []);

  teamKeys.forEach(function(team) {
    var list = grouped[team];
    if (!list || list.length === 0) return;

    list.sort(function(a, b) { return a.date < b.date ? -1 : 1; });

    var won  = list.filter(function(f){ var r = (f.result||'').toLowerCase(); return r==='won'||r==='win'; }).length;
    var lost = list.filter(function(f){ var r = (f.result||'').toLowerCase(); return r==='lost'||r==='loss'; }).length;
    var draw = list.filter(function(f){ return (f.result||'').toLowerCase()==='draw'; }).length;
    var played = won + lost + draw;

    if (!singleTeam) {
      html += '<div class="team-group">';
      html +=   '<div class="team-group-header">';
      html +=     '<span class="team-group-name">' + team + '</span>';
      if (played > 0) {
        html += '<span class="team-record">P' + played + ' W' + won + ' L' + lost + ' D' + draw + '</span>';
      }
      html +=   '</div>';
      html +=   '<div class="fixtures-grid">';
    } else {
      html += '<div class="fixtures-grid">';
    }

    list.forEach(function(f) {
      var d    = fmtDate(f.date);
      var past = f.date < today;

      // WhatsApp share text
      var waText = '🏏 TCC ' + f.team + ' vs ' + (f.opponent || 'TBC')
        + ' | ' + d.day + ' ' + d.month + ' ' + d.year
        + (f.venue ? ' | ' + f.venue : '')
        + ' | tygerbergcc.co.za/fixtures.html';
      var waHref = 'https://wa.me/?text=' + encodeURIComponent(waText);

      html += '<div class="fixture-card' + (past ? ' past' : '') + '">';
      html +=   '<div class="fixture-date">';
      html +=     '<div class="fixture-day">'   + d.day   + '</div>';
      html +=     '<div class="fixture-month">' + d.month + ' ' + d.year + '</div>';
      html +=   '</div>';
      html +=   '<div class="fixture-meta">';
      html +=     '<div class="fixture-vs">vs</div>';
      html +=     '<div class="fixture-opponent">' + (f.opponent || 'TBC') + '</div>';
      html +=     '<div class="fixture-venue">'    + (f.venue    || 'Venue TBC') + '</div>';
      if (f.division) html += '<div class="fixture-division">' + f.division + '</div>';
      html +=   '</div>';
      html +=   '<div class="fixture-badges">' + resultBadge(f);
      if (!past) html += '<a class="fixture-wa" href="' + waHref + '" target="_blank" rel="noopener noreferrer" title="Share on WhatsApp">'
        + '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.522 5.849L0 24l6.335-1.492A11.934 11.934 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.371l-.36-.214-3.722.876.937-3.62-.235-.374A9.818 9.818 0 012.182 12C2.182 6.578 6.578 2.182 12 2.182S21.818 6.578 21.818 12 17.422 21.818 12 21.818z"/></svg>'
        + '</a>';
      // Scorecard link — only for completed fixtures that have a live_scores record
      if (f.result && f.hasScorecard) {
        html += '<a class="fixture-scorecard" href="scorecard.html?fixture_id=' + f.id + '" title="View Scorecard">📋</a>';
      }
      html +=   '</div>';
      html += '</div>';
    });

    html += '</div>'; // closes fixtures-grid
    if (!singleTeam) html += '</div>'; // closes team-group
  });

  output.innerHTML = html;
}

function updateSummary(fixtures) {
  var bar = document.getElementById('summary-bar');
  if (!fixtures || fixtures.length === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  var won  = fixtures.filter(function(f){ var r=(f.result||'').toLowerCase(); return r==='won'||r==='win'; }).length;
  var lost = fixtures.filter(function(f){ var r=(f.result||'').toLowerCase(); return r==='lost'||r==='loss'; }).length;
  var draw = fixtures.filter(function(f){ return (f.result||'').toLowerCase()==='draw'; }).length;
  var upcoming = fixtures.filter(isUpcoming).length;

  document.getElementById('stat-total').textContent    = fixtures.length;
  document.getElementById('stat-won').textContent      = won;
  document.getElementById('stat-lost').textContent     = lost;
  document.getElementById('stat-draw').textContent     = draw;
  document.getElementById('stat-upcoming').textContent = upcoming;
}

/* ══════════════════════════════════════════════════════
   FETCH
══════════════════════════════════════════════════════ */
function loadAndRender() {
  document.getElementById('state-loading').style.display = 'flex';
  document.getElementById('state-error').style.display   = 'none';
  document.getElementById('state-empty').style.display   = 'none';
  document.getElementById('fixtures-output').innerHTML   = '';

  fetch(SUPABASE_URL + '/rest/v1/' + FIXTURES_TABLE + '?select=*&order=date.asc', {
    headers: supabaseHeaders()
  })
  .then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  })
  .then(function(data) {
    /* A tournament the club hosts has matches between other clubs in it, and
       even the club's own tournament matches are not league cricket. They get
       their own section rather than being mixed into the team groups. */
    allData        = data.filter(function(f) { return !f.tournament_id; });
    tournamentData = data.filter(function(f) { return !!f.tournament_id; });
    renderTournamentSection();
    populateSeasonSelect();
    buildTeamFilterBtns();
    applyFilters();
    // Check which completed fixtures have scorecards — stamp hasScorecard on allData
    checkScorecardAvailability();
  })
  .catch(function(err) {
    console.error('Fixtures error:', err);
    document.getElementById('state-loading').style.display = 'none';
    document.getElementById('state-error').style.display   = 'flex';
  });
}

/* ══════════════════════════════════════════════════════
   TOURNAMENT SECTION
   Its own block, under the club's fixtures: the full schedule of whatever
   tournament the club is running, with results as they land.
══════════════════════════════════════════════════════ */
function renderTournamentSection() {
  var wrap = document.getElementById('tournament-section');
  if (!wrap) return;
  if (!tournamentData.length) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }

  var ids = [...new Set(tournamentData.map(function(f) { return f.tournament_id; }))];
  fetch(SUPABASE_URL + '/rest/v1/tournaments?select=*&id=in.(' + ids.join(',') + ')',
        { headers: supabaseHeaders() })
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(rows) {
      (rows || []).forEach(function(t) { tournaments[t.id] = t; });
      drawTournamentSection();
    })
    .catch(function() { drawTournamentSection(); });
}

function drawTournamentSection() {
  var wrap = document.getElementById('tournament-section');
  var html = '';

  Object.keys(tournaments).length || (tournaments = {});
  var ids = [...new Set(tournamentData.map(function(f) { return f.tournament_id; }))];

  ids.forEach(function(tid) {
    var t = tournaments[tid] || {};
    /* An archived tournament stays off the page — last season's schedule is
       not what someone is looking for here. */
    if (t.status === 'archived') return;

    var list = tournamentData
      .filter(function(f) { return f.tournament_id === tid; })
      .sort(function(a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; });
    if (!list.length) return;

    var played = list.filter(function(f) { return !!f.result || (f.date && f.date < today); }).length;

    html += '<div class="tourn-block" id="tournament">';
    html +=   '<div class="tourn-head">';
    html +=     '<div>';
    html +=       '<span class="tourn-eyebrow">Tournament</span>';
    html +=       '<h2 class="tourn-name">' + (t.name || 'Tournament') + '</h2>';
    html +=       '<div class="tourn-sub">' +
                    list.length + ' match' + (list.length === 1 ? '' : 'es') +
                    (played ? ' · ' + played + ' played' : '') +
                    (t.venue ? ' · ' + t.venue : '') + '</div>';
    html +=     '</div>';
    html +=   '</div>';
    html +=   '<div class="fixtures-grid">';

    list.forEach(function(f) {
      var d    = fmtDate(f.date);
      var past = f.date && f.date < today;
      var stage = f.tournament_stage && f.tournament_stage !== 'group'
        ? f.tournament_stage.replace('semi', 'Semi-final').replace('final', 'Final').replace('3rd', '3rd place')
        : null;

      html += '<div class="fixture-card' + (past ? ' past' : '') + '" data-fixture-id="' + f.id + '">';
      html +=   '<div class="fixture-date">';
      html +=     '<div class="fixture-day">'   + d.day   + '</div>';
      html +=     '<div class="fixture-month">' + d.month + ' ' + d.year + '</div>';
      html +=   '</div>';
      html +=   '<div class="fixture-meta">';
      html +=     '<div class="fixture-opponent">' + (f.team || 'TBC') + ' <span class="tourn-v">v</span> ' + (f.opponent || 'TBC') + '</div>';
      html +=     '<div class="fixture-venue">' + (f.venue || 'Venue TBC') + '</div>';
      if (stage) html += '<div class="fixture-division">' + stage + '</div>';
      html +=   '</div>';
      html +=   '<div class="fixture-badges">' + resultBadge(f);
      if (f.result && f.hasScorecard) {
        html += '<a class="fixture-scorecard" href="scorecard.html?fixture_id=' + f.id + '" title="View Scorecard">📋</a>';
      }
      html +=   '</div>';
      html += '</div>';
    });

    html +=   '</div>';
    html += '</div>';
  });

  wrap.innerHTML = html;
  wrap.style.display = html ? 'block' : 'none';
}

/* ══════════════════════════════════════════════════════
   SCORECARD AVAILABILITY CHECK
══════════════════════════════════════════════════════ */
function checkScorecardAvailability() {
  var everything = allData.concat(tournamentData);
  var completedIds = everything.filter(function(f) { return !!f.result; }).map(function(f) { return f.id; });
  if (!completedIds.length) return;
  fetch(
    SUPABASE_URL + '/rest/v1/live_scores?select=fixture_id&status=eq.completed&fixture_id=in.(' + completedIds.join(',') + ')',
    { headers: supabaseHeaders() }
  ).then(function(r) { return r.json(); })
  .then(function(rows) {
    var ids = rows.map(function(r) { return r.fixture_id; });
    var changed = false;
    allData.concat(tournamentData).forEach(function(f) {
      var has = ids.indexOf(f.id) !== -1;
      if (f.hasScorecard !== has) { f.hasScorecard = has; changed = true; }
    });
    if (changed) { applyFilters(); drawTournamentSection(); }   // show the scorecard links
  }).catch(function() {});
}

/* ══════════════════════════════════════════════════════
   POPULATE SEASON SELECT from data
══════════════════════════════════════════════════════ */
function populateSeasonSelect() {
  var seasons = [...new Set(allData.map(function(f){ return f.season; }).filter(Boolean))]
    .sort(function(a,b){ return b.localeCompare(a); }); // newest first

  if (!seasons.length) return;

  var sel = document.getElementById('season-select');
  var current = sel.value;

  sel.innerHTML = seasons.map(function(s) {
    return '<option value="' + s + '"' + (s === current ? ' selected' : '') + '>' + s + '</option>';
  }).join('');

  // If current season not in data, default to newest
  if (!seasons.includes(activeSeason)) {
    activeSeason = seasons[0];
    sel.value = activeSeason;
  }

  // Sync hero tag
  var tag = document.getElementById('fixtures-season-tag');
  if (tag) tag.textContent = activeSeason.replace('/', ' / ');
}

/* ══════════════════════════════════════════════════════
   BUILD DYNAMIC TEAM FILTERS from data
══════════════════════════════════════════════════════ */
function buildTeamFilterBtns() {
  // Use defined senior team order, only show teams that have data for this season
  var teamsInData = new Set(
    allData.filter(function(f){ return f.season === activeSeason; }).map(function(f){ return f.team; })
  );

  var bar = document.getElementById('team-filters');
  var html = '<button class="filter-btn' + (activeTeam==='all'?' active':'') + '" data-team="all">All Teams</button>';
  SENIOR_TEAMS.forEach(function(t) {
    if (teamsInData.has(t)) {
      html += '<button class="filter-btn' + (activeTeam===t?' active':'') + '" data-team="' + t + '">' + t + '</button>';
    }
  });
  bar.innerHTML = html;

  bar.querySelectorAll('.filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      bar.querySelectorAll('.filter-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      activeTeam = btn.dataset.team;
      applyFilters();
    });
  });
}

/* ══════════════════════════════════════════════════════
   RESULT FILTERS
══════════════════════════════════════════════════════ */
document.getElementById('result-filters').querySelectorAll('.filter-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.getElementById('result-filters').querySelectorAll('.filter-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    activeResult = btn.dataset.result;
    applyFilters();
  });
});

/* ══════════════════════════════════════════════════════
   SEASON SWITCHER
══════════════════════════════════════════════════════ */
document.getElementById('season-select').addEventListener('change', function() {
  activeSeason = this.value;
  document.querySelector('.section-tag').textContent = 'Season ' + activeSeason;
  var tag = document.getElementById('fixtures-season-tag');
  if (tag) tag.textContent = activeSeason.replace('/', ' / ');
  activeTeam   = 'all';
  activeResult = 'all';
  document.getElementById('result-filters').querySelectorAll('.filter-btn').forEach(function(b,i){ b.classList.toggle('active', i===0); });
  loadAndRender();
});

/* ══════════════════════════════════════════════════════
   HAMBURGER
══════════════════════════════════════════════════════ */
var hamburger  = document.getElementById('hamburger');
var navLinksEl = document.getElementById('nav-links');
hamburger.addEventListener('click', function() { hamburger.classList.toggle('open'); navLinksEl.classList.toggle('open'); });
navLinksEl.querySelectorAll('a').forEach(function(a) {
  a.addEventListener('click', function() { hamburger.classList.remove('open'); navLinksEl.classList.remove('open'); });
});

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */
loadAndRender();

/* Set hero season tag on load */
(function() {
  var tag = document.getElementById('fixtures-season-tag');
  var sel = document.getElementById('season-select');
  if (tag && sel) tag.textContent = sel.value.replace('/', ' / ');
})();

/* Copyright year */
(function(){ var els = document.querySelectorAll(".copy-year"); els.forEach(function(el){ el.textContent = new Date().getFullYear(); }); })();

/* ══════════════════════════════════════════════════════
   LIVE SCORES — Supabase Realtime WebSocket
   Adaptive fallback poll: 20s when live, 2min when idle
══════════════════════════════════════════════════════ */
var liveScores        = [];
var liveFallbackTimer = null;
var liveRealtimeWs    = null;

async function fetchLiveScores() {
  try {
    var r = await fetch(
      SUPABASE_URL + '/rest/v1/live_scores?select=*&status=eq.live',
      { headers: supabaseHeaders() }
    );
    liveScores = await r.json();
    overlayLiveScores();
    // Adaptive poll: 20s when live, 2min when idle
    restartFallbackPoll(liveScores.length > 0 ? 20000 : 120000);
  } catch(e) {
    console.warn('Live scores fetch failed:', e);
  }
}

function restartFallbackPoll(interval) {
  clearInterval(liveFallbackTimer);
  liveFallbackTimer = setInterval(fetchLiveScores, interval);
}

function overlayLiveScores() {
  document.querySelectorAll('.fixture-live-overlay').forEach(function(el) { el.remove(); });
  document.querySelectorAll('.fixture-card').forEach(function(card) { card.classList.remove('fixture-live'); });

  liveScores.forEach(function(ls) {
    var card = document.querySelector('[data-fixture-id="' + ls.fixture_id + '"]');
    if (!card) return;
    card.classList.add('fixture-live');

    var overs = ls.overs + '.' + (ls.balls || 0);
    var need  = ls.target ? (ls.target - ls.runs) + ' needed from ' + ((ls.max_overs - ls.overs) * 6 - (ls.balls||0)) + ' balls' : null;

    var overlay = document.createElement('div');
    overlay.className = 'fixture-live-overlay';
    overlay.innerHTML =
      '<div class="flo-badge"><span class="flo-dot"></span>LIVE</div>' +
      '<div class="flo-score">' + ls.runs + '/' + ls.wickets + '</div>' +
      '<div class="flo-detail">' + ls.batting_team + ' · ' + overs + ' ov' + (need ? ' · ' + need : '') + '</div>';
    card.appendChild(overlay);
  });

  var liveSection = document.getElementById('live-now-heading');
  if (liveSection) liveSection.style.display = liveScores.length ? 'block' : 'none';
}

function startLiveRealtime() {
  if (liveRealtimeWs) return;
  var wsUrl = 'wss://cgjannvzpqecwzjdzwso.supabase.co/realtime/v1/websocket'
            + '?apikey=' + SUPABASE_ANON_KEY + '&vsn=1.0.0';
  var ws  = new WebSocket(wsUrl);
  var ref = 0;
  liveRealtimeWs = ws;

  ws.addEventListener('open', function() {
    ws.send(JSON.stringify({
      topic:   'realtime:live_scores_fixtures',
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
        fetchLiveScores();
      }
    } catch(err) {}
  });

  ws.addEventListener('close', function() {
    clearInterval(ws._hb);
    liveRealtimeWs = null;
    setTimeout(startLiveRealtime, 5000);
  });

  ws.addEventListener('error', function() {
    clearInterval(ws._hb);
    liveRealtimeWs = null;
  });
}

// Init once after first render — hook into renderFixtures not applyFilters
var _origRenderFixtures = renderFixtures;
renderFixtures = function(fixtures) {
  _origRenderFixtures.apply(this, arguments);
  if (!liveFallbackTimer) {
    fetchLiveScores();
    startLiveRealtime();
  }
};
