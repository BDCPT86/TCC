/* Format-aware ball/over rendering — mirrors the scorer's 100-ball support. */
function lsIsHundred(ls){ return (ls && ls.format) === 'hundred'; }
function lsBallsPerSet(ls){ return lsIsHundred(ls) ? 5 : 6; }
function lsOversText(ls){
  var ov = ls.overs || 0, bl = ls.balls || 0;
  if (lsIsHundred(ls)) return (ov * 5 + bl) + '/' + (ls.total_balls || 100);
  return ov + '.' + bl;
}
/* Rate denominator — balls for the Hundred (official), overs otherwise. */
function lsRateUnits(balls, ls){ return lsIsHundred(ls) ? balls : balls / 6; }
function lsRateSuffix(ls){ return lsIsHundred(ls) ? '/b' : ''; }
function lsBowlerOvers(b, ls){
  if (lsIsHundred(ls)) return ((b.overs||0)*5 + (b.balls||0)) + 'b';
  return (b.overs||0) + (b.balls > 0 ? '.' + b.balls : '');
}
/* ══════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════ */
var SUPABASE_URL = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var H = { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY };

/* ══════════════════════════════════════════════════════
   CLOCK
══════════════════════════════════════════════════════ */
function updateClock() {
  var now = new Date();
  var hh  = String(now.getHours()).padStart(2,'0');
  var mm  = String(now.getMinutes()).padStart(2,'0');
  document.getElementById('clock').textContent = hh + ':' + mm;
  document.getElementById('dateline').textContent = now.toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}
updateClock();
setInterval(updateClock, 10000);

/* ══════════════════════════════════════════════════════
   FULLSCREEN
══════════════════════════════════════════════════════ */
document.getElementById('fullscreen-btn').addEventListener('click', function() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function(){});
  } else {
    document.exitFullscreen();
  }
});
document.addEventListener('fullscreenchange', function() {
  document.getElementById('fullscreen-btn').textContent =
    document.fullscreenElement ? '✕ Exit Full Screen' : '⛶ Full Screen';
});

/* ══════════════════════════════════════════════════════
   DATA FETCH
══════════════════════════════════════════════════════ */
var liveScores  = [];
var todayFix    = [];
var upcomingFix = [];

function setStatus(state) {
  var dot  = document.getElementById('status-dot');
  var text = document.getElementById('status-text');
  if (state === 'live')        { dot.className = 'status-dot live'; text.textContent = 'Live'; }
  else if (state === 'online') { dot.className = 'status-dot'; dot.style.background = 'rgba(255,255,255,0.2)'; text.textContent = 'Connected'; }
  else                         { dot.className = 'status-dot'; dot.style.background = ''; text.textContent = 'Offline'; }
}

var fetching      = false;   // in-flight guard — realtime can fire fetchAll per message
var refetchQueued = false;   // coalesce bursts into one trailing refetch

async function fetchAll() {
  if (fetching) { refetchQueued = true; return; }
  fetching = true;
  var today = new Date().toISOString().slice(0,10);
  var in7   = new Date(Date.now() + 7*24*3600*1000).toISOString().slice(0,10);
  try {
    var [lsRes, fixRes] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/live_scores?select=*,first_innings_batting,first_innings_bowling,first_innings_score,over_history,current_over_balls&status=eq.live', { headers: H }),
      fetch(SUPABASE_URL + '/rest/v1/fixtures?select=*&date=gte.' + today + '&date=lte.' + in7 + '&order=date.asc', { headers: H })
    ]);
    var snap = {};
    liveScores.forEach(function(ls) { snap[ls.id] = ls; });
    liveScores  = await lsRes.json();
    var allFix  = await fixRes.json();
    todayFix    = allFix.filter(function(f) { return f.date === today; });
    upcomingFix = allFix.filter(function(f) { return f.date > today; });
    setStatus(liveScores.length ? 'live' : 'online');
    var events = detectEvents(snap, liveScores);
    render();
    if (evActive) paintOverlay(evActive, false);   // render() wiped the DOM — restore the live overlay
    if (events.length) applyEvents(events);
  } catch(e) {
    setStatus('offline');
    console.warn('Fetch failed:', e);
  } finally {
    fetching = false;
    if (refetchQueued) { refetchQueued = false; fetchAll(); }
  }
}

/* ══════════════════════════════════════════════════════
   SUPABASE REALTIME
   Fixed: correct postgres_changes subscription format.
   Falls back to 60s polling if Realtime fails.
   Includes stale-data watchdog for silent disconnects.
══════════════════════════════════════════════════════ */
var realtimeConnected = false;
var fallbackTimer     = null;

function startRealtime() {
  var wsUrl = 'wss://cgjannvzpqecwzjdzwso.supabase.co/realtime/v1/websocket'
            + '?apikey=' + ANON_KEY + '&vsn=1.0.0';
  var ws  = new WebSocket(wsUrl);
  var ref = 0;
  function nextRef() { return String(++ref); }

  ws.addEventListener('open', function() {
    realtimeConnected = true;
    clearInterval(fallbackTimer);
    fallbackTimer = null;

    ws.send(JSON.stringify({
      topic:   'realtime:live_scores_tv',
      event:   'phx_join',
      payload: {
        config: {
          postgres_changes: [
            { event: '*', schema: 'public', table: 'live_scores' }
          ]
        }
      },
      ref: nextRef()
    }));
  });

  ws.addEventListener('message', function(e) {
    try {
      var msg = JSON.parse(e.data);

      // Ignore phoenix system messages (heartbeat acks etc.)
      if (msg.topic === 'phoenix') return;

      // Direct postgres_changes event
      var type = msg.payload && (
        msg.payload.type ||
        (msg.payload.data && msg.payload.data.type)
      );

      if (msg.event === 'postgres_changes' || type === 'INSERT' || type === 'UPDATE' || type === 'DELETE') {
        fetchAll();
        return;
      }

      // Changes can also arrive wrapped in phx_reply
      if (msg.event === 'phx_reply') {
        var r = msg.payload && msg.payload.response;
        if (r && r.data && (r.data.type === 'INSERT' || r.data.type === 'UPDATE' || r.data.type === 'DELETE')) {
          fetchAll();
        }
      }
    } catch(err) {}
  });

  // Heartbeat every 25s to keep connection alive
  var hbInterval = setInterval(function() {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() }));
    }
  }, 25000);

  // Stale-data watchdog — if live data is >90s old, force a refetch
  var watchdog = setInterval(function() {
    if (!liveScores.length) return;
    var latest = liveScores.reduce(function(d, s) {
      var t = new Date(s.updated_at);
      return t > d ? t : d;
    }, new Date(0));
    if (Date.now() - latest.getTime() > 90000) fetchAll();
  }, 30000);

  ws.addEventListener('close', function() {
    realtimeConnected = false;
    clearInterval(hbInterval);
    clearInterval(watchdog);
    startFallbackPoll();
    setTimeout(startRealtime, 5000);
  });

  ws.addEventListener('error', function() {
    realtimeConnected = false;
    clearInterval(hbInterval);
    clearInterval(watchdog);
    startFallbackPoll();
  });
}

function startFallbackPoll() {
  if (fallbackTimer) return;
  fallbackTimer = setInterval(fetchAll, 60000);
}

// Boot
fetchAll();
startRealtime();

/* ══════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════ */
function fmtDate(d) {
  if (!d) return { day:'—', mon:'', year:'' };
  var p = d.split('-');
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return { day: parseInt(p[2]), mon: months[parseInt(p[1])-1], year: p[0] };
}

function timeSince(iso) {
  if (!iso) return '';
  var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)  return 'Updated just now';
  if (s < 120) return 'Updated 1 min ago';
  return 'Updated ' + Math.floor(s/60) + ' mins ago';
}

function calcPar(target, overs, balls, maxOvers) {
  var total  = maxOvers * 6;
  var bowled = overs * 6 + balls;
  if (bowled <= 0 || total <= 0) return 0;
  return Math.round(target * (bowled / total));
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ══════════════════════════════════════════════════════
   RENDER
══════════════════════════════════════════════════════ */
function render() {
  var main = document.getElementById('main');
  if (liveScores.length > 0) renderLive(main);
  else renderFixtures(main);
  renderTicker();
}

/* ── LIVE GAMES ── */
function renderLive(main) {
  var count = liveScores.length;
  var html  = '';

  html += '<div class="section-tag"><span class="dot"></span>'
       + (count === 1 ? '1 match in progress' : count + ' matches in progress')
       + '</div>';

  html += '<div class="live-grid count-' + Math.min(count,4) + '">';

  liveScores.slice(0,4).forEach(function(ls) {
    var overs     = lsOversText(ls);
    // Parse player state
    var batting = {};
    var bowling = {};
    try { batting = JSON.parse(ls.batting_state || '{}'); } catch(e) {}
    try { bowling = JSON.parse(ls.bowling_state || '{}'); } catch(e) {}
    var striker    = batting.striker    || null;
    var nonStriker = batting.nonStriker || null;
    var bowler     = bowling.current    || null;

    var effMax    = ls.revised_overs || ls.max_overs;
    var isDLS     = !!ls.revised_overs;
    var need      = ls.target !== null ? ls.target - ls.runs : null;
    var ballsLeft = effMax && need !== null ? (effMax - ls.overs)*lsBallsPerSet(ls) - (ls.balls||0) : null;
    var rrr       = ballsLeft > 0 && need !== null ? (need/lsRateUnits(ballsLeft, ls)).toFixed(2) : null;
    var rr        = ls.run_rate || null;
    var innLabel  = ls.innings === 2 ? '2nd Innings' : '1st Innings';
    var par       = ls.innings===2 && ls.target && effMax ? calcPar(ls.target, ls.overs, ls.balls||0, effMax) : null;
    var ahead     = par !== null ? ls.runs - par : null;
    // 1st innings DLS projection — estimate par score at current run rate over revised overs
    var dlsProjected = null;
    if (isDLS && ls.innings === 1 && effMax && rr) {
      dlsProjected = Math.round(parseFloat(rr) * effMax);
    }
    var fx        = todayFix.find(function(f){ return f.id === ls.fixture_id; }) || {};
    var sf        = count===1 ? '3.8rem' : count===2 ? '3.2rem' : '2.6rem';

    html += '<div class="match-card">';

    /* Header */
    html += '<div class="card-header">';
    html +=   '<div>';
    html +=     '<div class="card-teams">' + esc(ls.batting_team) + '<em>vs</em>' + esc(ls.bowling_team) + '</div>';
    html +=     '<div class="card-meta">';
    if (fx.venue)    html += '<span>📍 ' + esc(fx.venue) + '</span>';
    if (fx.division) html += '<span>' + esc(fx.division) + '</span>';
    if (fx.team)     html += '<span>' + esc(fx.team) + '</span>';
    html +=     '</div>';
    html +=   '</div>';
    html +=   '<div style="text-align:right;flex-shrink:0">';
    html +=     '<div class="live-pill"><span class="live-pill-dot"></span>Live</div>';
    if (isDLS) html += '<div class="dls-pill">🌧 DLS</div>';
    html +=     '<div class="inn-label">' + innLabel + '</div>';
    html +=   '</div>';
    html += '</div>';

    /* Body — score row */
    html += '<div class="card-body">';
    html +=   '<div class="score-col">';
    html +=     '<div class="score-batting">' + esc(ls.batting_team) + ' Batting</div>';
    html +=     '<div class="score-num" style="font-size:' + sf + '">' + ls.runs + '/' + ls.wickets + '</div>';
    html +=     '<div class="score-detail">';
    html +=       '<span>' + overs + ' overs</span>';
    if (rr) html += '<span class="score-rr">RR ' + rr + '</span>';
    if (ls.revised_overs) html += '<span class="score-revised">Rev. ' + ls.revised_overs + ' ov</span>';
    html +=     '</div>';
    html +=   '</div>';

    /* Target panel */
    if (need !== null && need > 0) {
      html += '<div class="target-panel">';
      html +=   '<div class="target-lbl">Target</div>';
      html +=   '<div class="target-need">' + need + ' to win</div>';
      html +=   '<div class="target-sub">';
      if (ballsLeft !== null) html += ballsLeft + ' balls';
      if (rrr) html += ' · RRR ' + rrr + lsRateSuffix(ls);
      html +=   '</div>';
      if (par !== null && ahead !== null) {
        var cls  = ahead >= 0 ? 'ahead' : 'behind';
        var sign = ahead >= 0 ? '+' : '';
        html += '<div class="target-par ' + cls + '">🌧 Par ' + par + ' (' + sign + ahead + ')</div>';
      }
      html += '</div>';
    } else if (need !== null && need <= 0) {
      html += '<div class="target-panel"><div class="target-won">Target<br>Reached!</div></div>';
    } else if (dlsProjected !== null) {
      // 1st innings, DLS in play — show projected score panel
      html += '<div class="target-panel dls-proj-panel">';
      html +=   '<div class="target-lbl">🌧 DLS</div>';
      html +=   '<div class="target-need">' + effMax + ' ov</div>';
      html +=   '<div class="target-sub">Proj. ' + dlsProjected + ' at curr. RR</div>';
      html += '</div>';
    }

    html += '</div>'; /* card-body */

    /* Player strip — full width below score, only if names available */
    if (striker || nonStriker || bowler) {
      html += '<div class="player-strip">';

      /* Batters side */
      html += '<div class="ps-batters">';
      if (striker) {
        html += '<div class="ps-batter-row striker">';
        html +=   '<span class="ps-indicator">▶</span>';
        html +=   '<span class="ps-bname">' + esc(striker.name) + '</span>';
        html +=   '<span class="ps-runs">' + striker.runs + '</span>';
        html +=   '<span class="ps-b">(' + striker.balls + ')</span>';
        if (striker.fours)  html += '<span class="ps-stat">' + striker.fours + '×4</span>';
        if (striker.sixes)  html += '<span class="ps-stat">' + striker.sixes + '×6</span>';
        html += '</div>';
      }
      if (nonStriker) {
        html += '<div class="ps-batter-row">';
        html +=   '<span class="ps-indicator"></span>';
        html +=   '<span class="ps-bname">' + esc(nonStriker.name) + '</span>';
        html +=   '<span class="ps-runs">' + nonStriker.runs + '</span>';
        html +=   '<span class="ps-b">(' + nonStriker.balls + ')</span>';
        if (nonStriker.fours) html += '<span class="ps-stat">' + nonStriker.fours + '×4</span>';
        if (nonStriker.sixes) html += '<span class="ps-stat">' + nonStriker.sixes + '×6</span>';
        html += '</div>';
      }
      html += '</div>';

      /* Bowler side */
      if (bowler) {
        var bov = lsBowlerOvers(bowler, ls);
        html += '<div class="ps-bowler-col">';
        html +=   '<div class="ps-bowler-lbl">Bowling</div>';
        html +=   '<div class="ps-bowler-name">' + esc(bowler.name) + '</div>';
        var bmaidens = bowler.maidens || 0;
        html +=   '<div class="ps-bowler-fig">' + bov + '-' + bmaidens + '-' + bowler.runs + '-' + bowler.wickets + '</div>';
        html += '</div>';
      }

      html += '</div>'; /* player-strip */
    }
    html += '<div class="card-footer">';
    html +=   '<span>' + timeSince(ls.updated_at) + '</span>';
    html +=   '<button class="sc-link" onclick="openScorecard(' + ls.id + ')">📋 Scorecard</button>';
    html += '</div>';
    html += '<div class="ev-overlay" id="ev-' + ls.id + '"></div>';
    html += '</div>'; /* match-card */
  });

  html += '</div>';
  main.innerHTML = html;
}

/* ── FIXTURES ── */
/* ══════════════════════════════════════════════════════
   MATCH EVENT DETECTION + ANIMATION
══════════════════════════════════════════════════════ */
function detectEvents(prevMap, newScores) {
  var events = [];
  newScores.forEach(function(ls) {
    var prev = prevMap[ls.id];
    if (!prev) return;
    var newBat = {}, newBowl = {}, prevBat = {}, prevBowl = {};
    try { newBat   = JSON.parse(ls.batting_state   || '{}'); } catch(e) {}
    try { newBowl  = JSON.parse(ls.bowling_state   || '{}'); } catch(e) {}
    try { prevBat  = JSON.parse(prev.batting_state || '{}'); } catch(e) {}
    try { prevBowl = JSON.parse(prev.bowling_state || '{}'); } catch(e) {}
    var newBowler   = newBowl.current  || null;
    var prevBowler  = prevBowl.current || null;
    var overs       = lsOversText(ls);

    // Wicket — TWO-STAGE announcement.
    // Stage 1 (instant): wickets count rises the moment the scorer
    // records the ball, so the overlay fires WITH the moment — not
    // seconds later when the dismissal modal is completed.
    // Stage 2 (enrich): when the fow entry lands with the batter's
    // name, the on-screen/queued overlay is updated in place. If
    // it has already expired, stay silent — never double-notify.
    var newFow  = newBat.fow  || [];
    var prevFow = prevBat.fow || [];
    if (!(ls.id in announcedWkts)) announcedWkts[ls.id] = prev.wickets || 0;
    if ((ls.wickets || 0) < announcedWkts[ls.id]) {
      announcedWkts[ls.id] = ls.wickets || 0;          // scorer undo — allow re-announce
    }
    if ((ls.wickets || 0) > announcedWkts[ls.id]) {
      // details may already be present if both updates landed in one fetch
      var lastFow = (newFow.length > prevFow.length) ? newFow[newFow.length - 1] : null;
      var bName   = lastFow ? lastFow.batter : '';
      events.push({
        id: ls.id, type: 'wicket', badge: '\uD83C\uDFAF',
        label: 'Wicket!',
        wkt: ls.wickets || 0,
        detailed: !!bName,
        title: bName ? bName + ' \u2014 out' : 'Wicket!',
        sub:   ls.batting_team + ' ' + ls.runs + '/' + ls.wickets + ' (' + overs + ' ov)'
      });
      announcedWkts[ls.id] = ls.wickets || 0;
    } else if (newFow.length > prevFow.length) {
      // dismissal details for an already-announced wicket
      var lf = newFow[newFow.length - 1];
      if (lf && lf.batter) enrichWicket(ls.id, lf.wicket, lf.batter + ' \u2014 out');
    }

    // Team milestone (every 50 runs)
    if (Math.floor(ls.runs / 50) > Math.floor((prev.runs || 0) / 50)) {
      var m  = Math.floor(ls.runs / 50) * 50;
      var rr = ls.run_rate ? ' \u00b7 RR ' + ls.run_rate + lsRateSuffix(ls) : '';
      events.push({
        id: ls.id, type: 'milestone', badge: '\uD83C\uDFCF',
        label: 'Team milestone',
        title: ls.batting_team + ' \u2014 ' + m + ' up',
        sub:   overs + ' overs' + rr
      });
    }

    // Batter milestone (50 / 100) — check BOTH batters by name.
    // A batter who reaches the mark with a single is at the
    // non-striker end by the time this update lands, so a
    // striker-only comparison misses most milestones.
    var prevBatters = {};
    [prevBat.striker, prevBat.nonStriker].forEach(function(b) {
      if (b && b.name) prevBatters[b.name] = b;
    });
    [newBat.striker, newBat.nonStriker].forEach(function(b) {
      if (!b || !b.name) return;
      var pb = prevBatters[b.name];
      if (!pb) return;
      var nR = b.runs || 0, pR = pb.runs || 0;
      if (Math.floor(nR / 50) > Math.floor(pR / 50)) {
        var pm    = Math.floor(nR / 50) * 50;
        var fours = b.fours ? ' \u00b7 ' + b.fours + 'x4' : '';
        var sixes = b.sixes ? ' \u00b7 ' + b.sixes + 'x6' : '';
        events.push({
          id: ls.id, type: 'player', badge: pm >= 100 ? '\uD83D\uDCAF' : '\u2B50',
          label: 'Player milestone',
          title: b.name + (pm >= 100 ? ' \u2014 Century!' : ' \u2014 Fifty!'),
          sub:   nR + ' runs off ' + (b.balls || 0) + ' balls' + fours + sixes
        });
      }
    });

    // Bowler 5-fer
    if (newBowler && prevBowler && newBowler.name === prevBowler.name) {
      var nW = newBowler.wickets || 0, pW = prevBowler.wickets || 0;
      if (nW >= 5 && pW < 5) {
        var bov = lsBowlerOvers(newBowler, ls);
        events.push({
          id: ls.id, type: 'player', badge: '\uD83C\uDFB3',
          label: 'Bowling milestone',
          title: newBowler.name + ' \u2014 Five-fer!',
          sub:   bov + '-' + (newBowler.maidens || 0) + '-' + newBowler.runs + '-' + nW
        });
      }
    }
  });
  return events;
}

/* Event display queue — one overlay at a time, each gets its
   full display window. paintOverlay() is re-callable so
   fetchAll() can restore the active overlay after render()
   rebuilds the DOM mid-animation (the old code lost the
   notification whenever the next ball arrived within 4s). */
var evQueue   = [];
var evActive  = null;
var announcedWkts = {};   // per-match count of wickets already announced (stage-1 ledger)
var EV_SHOW_MS = 3600;
var EV_GAP_MS  = 350;

/* Stage-2 enrichment: dismissal details arrived after the instant
   announcement. Update the overlay if it's still on screen or
   waiting in the queue; if it's gone, do nothing. */
function enrichWicket(matchId, wktNo, title) {
  function matches(ev) {
    return ev && ev.type === 'wicket' && ev.id === matchId &&
           !ev.detailed && (!wktNo || ev.wkt === wktNo);
  }
  var target = null;
  if (matches(evActive)) {
    target = evActive;
  } else {
    for (var i = 0; i < evQueue.length; i++) {
      if (matches(evQueue[i])) { target = evQueue[i]; break; }
    }
  }
  if (!target) return;
  target.title    = title;
  target.detailed = true;
  if (target === evActive) paintOverlay(evActive, false);
}

function applyEvents(events) {
  events.forEach(function(ev) { evQueue.push(ev); });
  if (!evActive) nextEvent();
}

function nextEvent() {
  var ev = evQueue.shift();
  if (!ev) { evActive = null; return; }
  evActive = ev;
  paintOverlay(ev, true);
  setTimeout(function() {
    var el   = document.getElementById('ev-' + ev.id);
    var card = el ? el.closest('.match-card') : null;
    if (el)   el.classList.remove('ev-visible');
    if (card) setTimeout(function() { card.classList.remove('ev-flash-' + ev.type); }, 400);
    evActive = null;
    setTimeout(nextEvent, EV_GAP_MS);
  }, EV_SHOW_MS);
}

function paintOverlay(ev, animate) {
  var el   = document.getElementById('ev-' + ev.id);
  var card = el ? el.closest('.match-card') : null;
  if (!el || !card) return;
  el.innerHTML =
    '<div class="ev-inner">'
    + '<div class="ev-badge">' + ev.badge + '</div>'
    + '<div>'
    + '<div class="ev-label">' + esc(ev.label) + '</div>'
    + '<div class="ev-title">' + esc(ev.title) + '</div>'
    + '<div class="ev-sub">'   + esc(ev.sub)   + '</div>'
    + '</div>'
    + '</div>';
  el.className = 'ev-overlay ev-' + ev.type;
  card.classList.add('ev-flash-' + ev.type);
  if (animate) {
    requestAnimationFrame(function() { el.classList.add('ev-visible'); });
  } else {
    el.classList.add('ev-visible');   // restore mid-display: no entrance replay
  }
}

function renderFixtures(main) {
  if (!todayFix.length && !upcomingFix.length) {
    main.innerHTML = '<div class="fix-table"><div class="empty-state"><div class="empty-icon">🏏</div><div class="empty-title">No Games Today</div><div class="empty-sub">Check back on match day</div></div></div>';
    return;
  }

  var source = todayFix.length ? todayFix : upcomingFix.slice(0,8);
  var label  = todayFix.length ? 'Today\'s fixtures — no live games yet' : 'Upcoming fixtures this week';
  var html   = '';

  html += '<div class="section-tag dim"><span class="dot"></span>' + label + '</div>';
  html += '<div class="fix-table">';
  html += '<div class="fix-head"><div>Date</div><div>Team</div><div>Match</div><div>Venue</div><div>Status</div></div>';
  source.forEach(function(f) {
    var d = fmtDate(f.date);
    html += '<div class="fix-row">';
    html +=   '<div><div class="fix-day">' + d.day + '</div><div class="fix-mon">' + d.mon + '</div></div>';
    html +=   '<div class="fix-team-col">' + esc(f.team||'') + '</div>';
    html +=   '<div class="fix-match-col"><div class="fix-opp">vs ' + esc(f.opponent||'TBC') + '</div></div>';
    html +=   '<div class="fix-venue-col">' + esc(f.venue||'—') + '</div>';
    html +=   '<div><span class="fix-badge">' + esc(f.result||'Upcoming') + '</span></div>';
    html += '</div>';
  });
  html += '</div>';
  main.innerHTML = html;
}

/* ══════════════════════════════════════════════════════
   SCORECARD MODAL
══════════════════════════════════════════════════════ */

function openScorecard(lsId) {
  var ls = liveScores.find(function(s) { return s.id === lsId; });
  if (!ls) return;

  var batting = {}, bowling = {};
  var fi_batting = {}, fi_bowling = {}, fi_score = {};
  try { batting    = JSON.parse(ls.batting_state          || '{}'); } catch(e) {}
  try { bowling    = JSON.parse(ls.bowling_state          || '{}'); } catch(e) {}
  try { fi_batting = JSON.parse(ls.first_innings_batting  || '{}'); } catch(e) {}
  try { fi_bowling = JSON.parse(ls.first_innings_bowling  || '{}'); } catch(e) {}
  try { fi_score   = JSON.parse(ls.first_innings_score    || '{}'); } catch(e) {}
  var fx = todayFix.find(function(f) { return f.id === ls.fixture_id; }) || {};

  var html = '';

  // 1st innings — show if we have the snapshot (i.e. currently in 2nd innings)
  var hasFirstInn = fi_score && fi_score.runs !== undefined;
  if (hasFirstInn) {
    var fi_ls = {
      batting_team:    ls.bowling_team, // teams are flipped in 2nd innings
      bowling_team:    ls.batting_team,
      runs:            fi_score.runs,
      wickets:         fi_score.wickets,
      overs:           fi_score.overs,
      balls:           fi_score.balls,
      extras_wides:    fi_score.extras ? fi_score.extras.wides   : 0,
      extras_noballs:  fi_score.extras ? fi_score.extras.noballs : 0,
      extras_byes:     fi_score.extras ? fi_score.extras.byes    : 0,
      extras_legbyes:  fi_score.extras ? fi_score.extras.legbyes : 0,
      target:          null,
      innings:         1,
    };
    html += '<div class="scm-inn-divider">1st Innings</div>';
    html += buildScorecardModal(fi_ls, fx, fi_batting, fi_bowling);
    html += '<div class="scm-inn-divider">2nd Innings</div>';
  }

  html += buildScorecardModal(ls, fx, batting, bowling);

  // Build ball-by-ball commentary
  var overHistory    = [];
  var currentOvBalls = [];
  try { overHistory    = JSON.parse(ls.over_history        || '[]'); } catch(e) {}
  try { currentOvBalls = JSON.parse(ls.current_over_balls  || '[]'); } catch(e) {}
  var ballsHtml = buildBallsTab(ls, batting, overHistory, currentOvBalls);

  // Wrap both in tabbed layout
  var tabHtml = '<div class="scm-tabs">'
    + '<button class="scm-tab active" data-pane="scorecard">Scorecard</button>'
    + '<button class="scm-tab" data-pane="balls">Balls</button>'
    + '</div>'
    + '<div id="scm-pane-scorecard" class="scm-pane">' + html + '</div>'
    + '<div id="scm-pane-balls" class="scm-pane" style="display:none">' + ballsHtml + '</div>';

  document.getElementById('scorecard-modal-body').innerHTML = tabHtml;

  // Bind tab buttons after injection
  document.querySelectorAll('#scorecard-modal-body .scm-tab').forEach(function(btn) {
    btn.addEventListener('click', function() { switchScmTab(this, this.dataset.pane); });
  });
  document.getElementById('scorecard-modal').style.display = 'flex';
}

function switchScmTab(btn, pane) {
  document.querySelectorAll('.scm-tab').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  document.querySelectorAll('.scm-pane').forEach(function(p) { p.style.display = 'none'; });
  var el = document.getElementById('scm-pane-' + pane);
  if (el) el.style.display = 'block';
}

function autoCommentary(ball, bowler, striker) {
  var bow = bowler || 'Bowler';
  var bat = striker || 'Batter';
  var runs = ball.runs || 0;
  var disp = ball.displayRuns !== undefined ? ball.displayRuns : runs;

  if (ball.wicket) {
    var how = ball.how || '';
    if (how === 'Bowled')         return 'OUT! Bowled. ' + bow + ' finds the stumps.';
    if (how === 'Caught' || how === 'Caught & Bowled') return 'OUT! Caught. ' + bat + ' gets a top edge.';
    if (how === 'LBW')            return 'OUT! LBW. Struck on the pad.';
    if (how === 'Run Out')        return 'OUT! Run out. Brilliant fielding.';
    if (how === 'Stumped')        return 'OUT! Stumped. Down the wicket and missed.';
    if (how === 'Hit Wicket')     return 'OUT! Hit wicket.';
    if (how === 'Retired Hurt')   return bat + ' retires hurt.';
    return 'OUT! ' + (how || 'Wicket');
  }
  if (ball.extra === 'wide')   return 'Wide. ' + (runs > 1 ? (runs - 1) + ' extra run' + (runs > 2 ? 's' : '') + '.' : '');
  if (ball.extra === 'noball') {
    var nbExtra = ball.nbExtra;
    if (nbExtra === 'bye')    return 'No-ball, bye. ' + (ball.nbExtraRuns || 1) + ' run' + (ball.nbExtraRuns > 1 ? 's' : '') + '.';
    if (nbExtra === 'legbye') return 'No-ball, leg-bye.';
    if (nbExtra === 'penalty') return 'No-ball. ' + (ball.nbExtraRuns || 0) + ' penalty run' + (ball.nbExtraRuns > 1 ? 's' : '') + ' awarded.';
    if (disp === 0) return 'No-ball. Free hit to follow.';
    return 'No-ball. ' + disp + ' run' + (disp > 1 ? 's' : '') + ' off the bat. Free hit to follow.';
  }
  if (ball.extra === 'bye')    return disp + ' bye' + (disp > 1 ? 's' : '') + '.';
  if (ball.extra === 'legbye') return disp + ' leg-bye' + (disp > 1 ? 's' : '') + '.';
  if (ball.type === 'overthrow') return disp + ' overthrow run' + (disp > 1 ? 's' : '') + '.';
  if (ball.type === 'penalty')   return disp + ' penalty run' + (disp > 1 ? 's' : '') + ' awarded.';

  if (runs === 0) return 'Dot ball.';
  if (runs === 1) return 'Single.';
  if (runs === 2) return 'Two runs.';
  if (runs === 3) return 'Three runs.';
  if (runs === 4) return "FOUR! It's a boundary.";
  if (runs === 5) return 'Five runs.';
  if (runs === 6) return "SIX! Huge hit. Maximum.";
  return runs + ' runs.';
}

function buildBallsTab(ls, batting, overHistory, currentOvBalls) {
  var html = '';
  var allOvers = overHistory.slice().reverse(); // most recent first

  // Add current over if it has balls
  if (currentOvBalls && currentOvBalls.length) {
    allOvers.unshift({
      over: (ls.overs || 0) + 1,
      balls: currentOvBalls,
      bowler: ls.bowling_state ? (function() {
        try { var b = JSON.parse(ls.bowling_state); return b.current ? b.current.name : ''; } catch(e) { return ''; }
      })() : '',
      current: true
    });
  }

  if (!allOvers.length) {
    return '<div style="text-align:center;padding:40px 0;color:rgba(255,255,255,0.3);font-size:0.85rem">No balls recorded yet</div>';
  }

  // ── SUMMARY CARD ──
  html += '<div class="scm-summary-card">';

  // Current over chips row
  if (currentOvBalls && currentOvBalls.length) {
    html += '<div class="scm-summary-chips">';
    currentOvBalls.forEach(function(b) {
      var label = b.wicket ? 'W' : b.extra === 'wide' ? 'Wd' : b.extra === 'noball' ? 'Nb' : b.extra === 'bye' ? 'B' : b.extra === 'legbye' ? 'Lb' : String(b.runs || 0);
      var cls = b.wicket ? 'scm-chip wkt' : (b.runs === 4) ? 'scm-chip four' : (b.runs === 6) ? 'scm-chip six' : b.extra ? 'scm-chip extra' : 'scm-chip';
      html += '<div class="' + cls + '">' + label + '</div>';
    });
    html += '</div>';
  }

  // Batter + bowler summary row
  html += '<div class="scm-summary-players">';
  // Batters
  html += '<div class="scm-summary-batters">';
  [batting.striker, batting.nonStriker].forEach(function(b) {
    if (!b) return;
    var sr = b.balls > 0 ? '(' + b.balls + ')' : '';
    html += '<div class="scm-summary-batter">'
      + '<span class="scm-summary-bname">' + esc(b.name) + '</span>'
      + '<span class="scm-summary-bscore">' + b.runs + sr + '</span>'
      + '</div>';
  });
  html += '</div>';
  // Bowler
  var curBowler = null;
  try { var bst = JSON.parse(ls.bowling_state || '{}'); curBowler = bst.current; } catch(e) {}
  if (curBowler) {
    var bovDisp = curBowler.overs + (curBowler.balls > 0 ? '.' + curBowler.balls : '');
    html += '<div class="scm-summary-bowler">'
      + '<div class="scm-summary-bname">' + esc(curBowler.name) + '</div>'
      + '<div class="scm-summary-bfig">' + bovDisp + ' - ' + (curBowler.maidens||0) + ' - ' + curBowler.runs + ' - ' + curBowler.wickets + '</div>'
      + '</div>';
  }
  html += '</div>';

  // Overs / Runs this over / Score footer row
  var thisOverRuns = (currentOvBalls || []).reduce(function(s, b) { return s + (b.runs || 0); }, 0);
  html += '<div class="scm-summary-footer">'
    + '<span><span class="scm-summary-foot-lbl">Overs</span> <strong>' + (ls.overs || 0) + (ls.balls > 0 ? '.' + ls.balls : '') + '</strong></span>'
    + '<span><span class="scm-summary-foot-lbl">This over</span> <strong>' + thisOverRuns + '</strong></span>'
    + '<span><span class="scm-summary-foot-lbl">Score</span> <strong>' + (ls.runs || 0) + '-' + (ls.wickets || 0) + '</strong></span>'
    + '</div>';

  html += '</div>'; // end summary card

  allOvers.forEach(function(ov) {
    var bowlerName = (ov.split && ov.splitBowlers) ? ov.splitBowlers.join(' / ') : (ov.bowler || '');
    var balls = (ov.balls || []).slice().reverse(); // latest ball first in over
    if (!balls.length) return;

    // Over summary stats (completed overs only)
    var ovRuns = (ov.balls || []).reduce(function(s, b) { return s + (b.runs || 0); }, 0);
    var ovWkts = (ov.balls || []).filter(function(b) { return b.wicket; }).length;
    var ovSummary = 'End of over ' + ov.over
      + (bowlerName ? ' — ' + bowlerName : '')
      + ' — ' + ovRuns + ' run' + (ovRuns !== 1 ? 's' : '')
      + (ovWkts ? ', ' + ovWkts + ' wkt' + (ovWkts > 1 ? 's' : '') : '');

    // Chips strip (chronological order)
    var chipsHtml = '<div class="scm-over-chips-row">';
    (ov.balls || []).forEach(function(b) {
      var lbl = b.wicket ? 'W' : b.extra === 'wide' ? 'Wd' : b.extra === 'noball' ? 'Nb' : b.extra === 'bye' ? 'B' : b.extra === 'legbye' ? 'Lb' : String(b.runs || 0);
      var cls = b.wicket ? 'scm-chip wkt' : (b.runs === 4) ? 'scm-chip four' : (b.runs === 6) ? 'scm-chip six' : b.extra ? 'scm-chip extra' : 'scm-chip';
      chipsHtml += '<div class="' + cls + '">' + lbl + '</div>';
    });
    chipsHtml += '</div>';

    html += '<div class="scm-over-block">';

    // Completed overs: summary + chips appear at TOP of block (newest content first)
    if (!ov.current) {
      html += '<div class="scm-over-header">';
      html +=   '<div class="scm-over-summary">' + esc(ovSummary) + '</div>';
      html +=   chipsHtml;
      html += '</div>';
    }

    balls.forEach(function(ball, bi) {
      var ballNum = ov.over + '.' + (balls.length - bi);
      var striker = batting.striker ? batting.striker.name : '';
      // For split overs use the bowler stamped on each ball, fall back to over bowler
      var thisBowler = ball.bowler || bowlerName;
      var auto    = autoCommentary(ball, thisBowler, striker);
      var note    = ball.commentary || '';

      var runs = ball.runs || 0;
      var label, chipCls;
      if (ball.wicket)             { label = 'W';  chipCls = 'scm-chip wkt'; }
      else if (ball.extra === 'wide')   { label = 'Wd'; chipCls = 'scm-chip extra'; }
      else if (ball.extra === 'noball') { label = 'Nb'; chipCls = 'scm-chip extra'; }
      else if (ball.extra === 'bye')    { label = 'B';  chipCls = 'scm-chip extra'; }
      else if (ball.extra === 'legbye') { label = 'Lb'; chipCls = 'scm-chip extra'; }
      else if (runs === 4)         { label = '4';  chipCls = 'scm-chip four'; }
      else if (runs === 6)         { label = '6';  chipCls = 'scm-chip six'; }
      else                         { label = String(runs); chipCls = 'scm-chip'; }

      html += '<div class="scm-ball-row">';
      html +=   '<div class="scm-ball-meta">' + ballNum + '</div>';
      html +=   '<div class="' + chipCls + '">' + label + '</div>';
      html +=   '<div class="scm-ball-text">';
      if (thisBowler) html += '<div class="scm-ball-delivery">' + esc(thisBowler) + (striker ? ' to ' + esc(striker) : '') + '</div>';
      html +=     '<div class="scm-ball-comment">' + esc(auto) + '</div>';
      if (note)   html += '<div class="scm-ball-note">' + esc(note) + '</div>';
      html +=   '</div>';
      html += '</div>';
    });
    html += '</div>';
  });

  return html;
}

function buildScorecardModal(ls, fx, batting, bowling) {
  var innLabel = ls.innings === 2 ? '2nd Innings' : '1st Innings';
  var totalExtras = (ls.extras_wides||0) + (ls.extras_noballs||0) + (ls.extras_byes||0) + (ls.extras_legbyes||0);
  var html = '';

  /* Match header */
  html += '<div class="scm-header">';
  html +=   '<div class="scm-teams">' + esc(ls.batting_team) + ' <span>vs</span> ' + esc(ls.bowling_team) + '</div>';
  html +=   '<div class="scm-meta">';
  if (fx.venue)    html += '<span>📍 ' + esc(fx.venue) + '</span>';
  if (fx.division) html += '<span>' + esc(fx.division) + '</span>';
  if (fx.team)     html += '<span>' + esc(fx.team) + '</span>';
  html +=   '</div>';
  html +=   '<div class="scm-inn">' + innLabel + '</div>';
  html += '</div>';

  /* Batting table */
  html += '<div class="scm-section-title">🏏 Batting — ' + esc(ls.batting_team) + '</div>';
  html += '<div class="scm-table">';
  html +=   '<div class="scm-row scm-th">';
  html +=     '<div class="scm-col-name">Batter</div>';
  html +=     '<div class="scm-col-how">Dismissal</div>';
  html +=     '<div class="scm-col-num">R</div>';
  html +=     '<div class="scm-col-num">B</div>';
  html +=     '<div class="scm-col-num">4s</div>';
  html +=     '<div class="scm-col-num">6s</div>';
  html +=     '<div class="scm-col-num">SR</div>';
  html +=   '</div>';

  /* Dismissed batters */
  var dismissed = batting.dismissed || [];
  dismissed.forEach(function(b) {
    var sr = b.balls > 0 ? (b.runs / b.balls * 100).toFixed(1) : '0.0';
    var howText = '';
    if (!b.how || b.how === 'Bowled')      howText = b.bowler ? 'b ' + b.bowler : 'Bowled';
    else if (b.how === 'Caught')           howText = b.bowler ? 'caught b ' + b.bowler : 'Caught';
    else if (b.how === 'Caught & Bowled')  howText = b.bowler ? 'c & b ' + b.bowler : 'Caught & Bowled';
    else if (b.how === 'LBW')             howText = b.bowler ? 'lbw b ' + b.bowler : 'LBW';
    else if (b.how === 'Stumped')         howText = b.bowler ? 'st b ' + b.bowler : 'Stumped';
    else if (b.how === 'Hit Wicket')      howText = b.bowler ? 'hit wkt b ' + b.bowler : 'Hit Wicket';
    else if (b.how === 'Run Out')         howText = 'run out';
    else if (b.how === 'Retired')         howText = 'retired';
    else                                   howText = b.how || '';
    html += '<div class="scm-row">';
    html +=   '<div class="scm-col-name">' + esc(b.name) + '</div>';
    html +=   '<div class="scm-col-how">' + esc(howText) + '</div>';
    html +=   '<div class="scm-col-num scm-bold">' + b.runs + '</div>';
    html +=   '<div class="scm-col-num">' + b.balls + '</div>';
    html +=   '<div class="scm-col-num">' + (b.fours || 0) + '</div>';
    html +=   '<div class="scm-col-num">' + (b.sixes || 0) + '</div>';
    html +=   '<div class="scm-col-num scm-muted">' + sr + '</div>';
    html += '</div>';
  });

  /* Not out batters */
  [batting.striker, batting.nonStriker].forEach(function(b) {
    if (!b) return;
    var sr = b.balls > 0 ? (b.runs / b.balls * 100).toFixed(1) : '0.0';
    html += '<div class="scm-row scm-notout">';
    html +=   '<div class="scm-col-name">' + esc(b.name) + ' <span class="scm-notout-tag">not out</span></div>';
    html +=   '<div class="scm-col-how"></div>';
    html +=   '<div class="scm-col-num scm-bold scm-gold">' + b.runs + '</div>';
    html +=   '<div class="scm-col-num">' + b.balls + '</div>';
    html +=   '<div class="scm-col-num">' + (b.fours || 0) + '</div>';
    html +=   '<div class="scm-col-num">' + (b.sixes || 0) + '</div>';
    html +=   '<div class="scm-col-num scm-muted">' + sr + '</div>';
    html += '</div>';
  });

  /* Extras + Total */
  html += '<div class="scm-row scm-extras">';
  html +=   '<div class="scm-col-name">Extras</div>';
  html +=   '<div class="scm-col-how scm-extras-detail">W:' + (ls.extras_wides||0) + ' NB:' + (ls.extras_noballs||0) + ' B:' + (ls.extras_byes||0) + ' LB:' + (ls.extras_legbyes||0) + '</div>';
  html +=   '<div class="scm-col-num scm-bold">' + totalExtras + '</div>';
  html +=   '<div class="scm-col-num"></div><div class="scm-col-num"></div><div class="scm-col-num"></div><div class="scm-col-num"></div>';
  html += '</div>';

  html += '<div class="scm-row scm-total">';
  html +=   '<div class="scm-col-name">Total</div>';
  html +=   '<div class="scm-col-how scm-muted">' + ls.overs + '.' + (ls.balls||0) + ' overs';
  if (ls.target) html += ' · Target: ' + ls.target;
  html +=   '</div>';
  html +=   '<div class="scm-col-num scm-total-score">' + ls.runs + '/' + ls.wickets + '</div>';
  html +=   '<div class="scm-col-num"></div><div class="scm-col-num"></div><div class="scm-col-num"></div><div class="scm-col-num"></div>';
  html += '</div>';

  html += '</div>'; /* scm-table */

  /* Fall of Wickets */
  var fow = batting.fow || [];
  if (fow.length) {
    html += '<div class="scm-section-title">Fall of Wickets</div>';
    html += '<div style="font-size:0.72rem;color:var(--muted);line-height:2;padding:4px 0">';
    fow.forEach(function(f) {
      html += '<span style="margin-right:14px">' + f.score + '-' + f.wicket + ' <span style="color:rgba(255,255,255,0.4)">(' + esc(f.batter) + ', ' + f.overs + ' ov)</span></span>';
    });
    html += '</div>';
  }

  /* Bowling table */
  var bowlers = (bowling.bowlers || []);
  if (bowlers.length) {
    html += '<div class="scm-section-title">🎳 Bowling — ' + esc(ls.bowling_team) + '</div>';
    html += '<div class="scm-table">';
    html +=   '<div class="scm-row scm-th scm-bowl-row">';
    html +=     '<div class="scm-col-name">Bowler</div>';
    html +=     '<div class="scm-col-num">O</div>';
    html +=     '<div class="scm-col-num">M</div>';
    html +=     '<div class="scm-col-num">R</div>';
    html +=     '<div class="scm-col-num">W</div>';
    html +=     '<div class="scm-col-num">Wd</div>';
    html +=     '<div class="scm-col-num">NB</div>';
    html +=     '<div class="scm-col-num">Econ</div>';
    html +=   '</div>';

    bowlers.forEach(function(b) {
      var bBalls  = (b.overs||0) * lsBallsPerSet(ls) + (b.balls||0);
      var econ    = bBalls > 0 ? (b.runs / lsRateUnits(bBalls, ls)).toFixed(lsIsHundred(ls) ? 2 : 1) : '—';
      var ovDisp  = b.overs + (b.balls > 0 ? '.' + b.balls : '');
      html += '<div class="scm-row scm-bowl-row">';
      html +=   '<div class="scm-col-name">' + esc(b.name) + '</div>';
      html +=   '<div class="scm-col-num">' + ovDisp + '</div>';
      html +=   '<div class="scm-col-num">' + (b.maidens||0) + '</div>';
      html +=   '<div class="scm-col-num">' + b.runs + '</div>';
      html +=   '<div class="scm-col-num scm-bold' + (b.wickets > 0 ? ' scm-green' : '') + '">' + b.wickets + '</div>';
      html +=   '<div class="scm-col-num scm-muted">' + (b.wides||0) + '</div>';
      html +=   '<div class="scm-col-num scm-muted">' + (b.noballs||0) + '</div>';
      html +=   '<div class="scm-col-num scm-muted">' + econ + '</div>';
      html += '</div>';
    });

    html += '</div>'; /* scm-table */
  }

  return html;
}

document.getElementById('scorecard-modal-close').addEventListener('click', function() {
  document.getElementById('scorecard-modal').style.display = 'none';
});
document.getElementById('scorecard-modal').addEventListener('click', function(e) {
  if (e.target === this) this.style.display = 'none';
});

/* ── TICKER ── */
function renderTicker() {
  var items = upcomingFix.slice(0,12);
  var bar   = document.getElementById('ticker-bar');
  var track = document.getElementById('ticker-track');
  if (!items.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  var html = '';
  [items, items].forEach(function(list) {
    list.forEach(function(f) {
      var d = fmtDate(f.date);
      html += '<div class="ticker-item">';
      html += '<span class="ti-team">' + esc(f.team||'') + '</span>';
      html += '<span style="opacity:0.4">vs</span>';
      html += '<span class="ti-opp">' + esc(f.opponent||'TBC') + '</span>';
      html += '<span>' + d.day + ' ' + d.mon + '</span>';
      if (f.venue) html += '<span>📍 ' + esc(f.venue) + '</span>';
      html += '</div>';
    });
  });
  track.innerHTML = html;
  track.style.animationDuration = (items.length * 5) + 's';
}

/* ══════════════════════════════════════════════════════
   SHAREABLE MATCH LINK — ?match= query param handler
   When live.html is opened with ?match=ID, fetch that
   specific match from Supabase and open its scorecard
   modal automatically. Works for both live and completed
   matches (any status).
══════════════════════════════════════════════════════ */
(function() {
  var params  = new URLSearchParams(window.location.search);
  var matchId = params.get('match');
  if (!matchId) return;

  // Wait for fetchAll() to complete so todayFix is populated,
  // then fetch the specific match by ID regardless of status.
  async function openSharedMatch() {
    try {
      var res  = await fetch(
        SUPABASE_URL + '/rest/v1/live_scores?select=*,first_innings_batting,first_innings_bowling,first_innings_score,over_history,current_over_balls&id=eq.' + matchId,
        { headers: H }
      );
      var rows = await res.json();
      if (!rows || !rows.length) {
        console.warn('Shared match not found:', matchId);
        return;
      }
      var ls = rows[0];

      // Make sure todayFix contains this fixture if it isn't already
      if (ls.fixture_id && !todayFix.find(function(f) { return f.id === ls.fixture_id; })) {
        try {
          var fxRes  = await fetch(
            SUPABASE_URL + '/rest/v1/fixtures?select=*&id=eq.' + ls.fixture_id,
            { headers: H }
          );
          var fxRows = await fxRes.json();
          if (fxRows && fxRows.length) todayFix.push(fxRows[0]);
        } catch(e) {}
      }

      // Inject into liveScores array so openScorecard() can find it
      if (!liveScores.find(function(s) { return s.id === ls.id; })) {
        liveScores.push(ls);
      }

      openScorecard(ls.id);
    } catch(e) {
      console.warn('Could not open shared match:', e);
    }
  }

  // Give fetchAll() time to run first, then open
  setTimeout(openSharedMatch, 1200);
})();

/* ══════════════════════════════════════════════════════
   PUSH NOTIFICATIONS
   Spectators tap the bell on the live score page to
   subscribe to match event notifications (wickets,
   milestones, match end). Subscriptions are stored in
   Supabase via the Cloudflare Worker. The VAPID public
   key is public and safe to include here.
══════════════════════════════════════════════════════ */
var WORKER_URL    = 'https://tcc-admin.bydaries.workers.dev';
var VAPID_PUBLIC  = 'BKu9YMCDYKnL8itqaPORCYhRWG_d9uv8jKPi1Mx-X-sHmQOpMKVHPni3fxXihpWHrShLxaukcxazvlzzs1UvX9w';
var PUSH_SW_URL   = '/push-sw.js';
var LS_PUSH_KEY   = 'tcc_push_subscribed';

function initPushNotifications() {
  var btn = document.getElementById('bell-btn');
  if (!btn) return;

  // Show bell only if Push + ServiceWorker are supported
  if (!('PushManager' in window) || !('serviceWorker' in navigator)) return;
  btn.style.display = 'inline-flex';

  // Restore subscribed state from localStorage
  var subscribed = localStorage.getItem(LS_PUSH_KEY) === '1';
  updateBellUI(subscribed);

  btn.addEventListener('click', function() {
    var isSubscribed = localStorage.getItem(LS_PUSH_KEY) === '1';
    if (isSubscribed) {
      unsubscribeFromPush();
    } else {
      subscribeToPush();
    }
  });
}

function updateBellUI(subscribed) {
  var btn  = document.getElementById('bell-btn');
  var icon = document.getElementById('bell-icon');
  if (!btn) return;
  btn.classList.toggle('subscribed', subscribed);
  btn.title = subscribed ? 'Notifications on — tap to turn off' : 'Tap to get match notifications';
  if (icon) icon.textContent = subscribed ? '🔔' : '🔕';
}

/* ──────────────────────────────────────────────────────
   Push subscription helpers.
   Three service workers (/sw.js, /fantasy-sw.js, /push-sw.js) were all
   registering at scope '/', so each replaced the last and took the push
   subscription with it. The push SW now gets a dedicated scope — push events
   are delivered to the registration, so scope has no effect on delivery.
────────────────────────────────────────────────────── */
var PUSH_SW_SCOPE = '/push/';

function pushKeysMatch(existingKey, wantedBytes) {
  if (!existingKey) return false;
  var a = new Uint8Array(existingKey);
  if (a.length !== wantedBytes.length) return false;
  for (var i = 0; i < a.length; i++) { if (a[i] !== wantedBytes[i]) return false; }
  return true;
}

/* Wait for this specific registration to activate. navigator.serviceWorker.ready
   resolves for whichever SW controls the page, which may be a different one. */
function pushSwActive(reg) {
  if (reg.active) return Promise.resolve(reg);
  return new Promise(function(resolve) {
    var sw = reg.installing || reg.waiting;
    var done = false;
    var finish = function() { if (!done) { done = true; resolve(reg); } };
    if (!sw) return finish();
    sw.addEventListener('statechange', function() {
      if (sw.state === 'activated' || sw.state === 'redundant') finish();
    });
    setTimeout(finish, 8000); // never hang the button
  });
}

/* Reuse an existing subscription when the VAPID key matches; otherwise clear it.
   Calling subscribe() over a stale subscription is what produces
   "Registration failed - push service error". */
async function pushGetSubscription(reg, appServerKey) {
  var existing = await reg.pushManager.getSubscription();
  if (existing) {
    var opts = existing.options || {};
    if (pushKeysMatch(opts.applicationServerKey, appServerKey)) return existing;
    try { await existing.unsubscribe(); } catch (e) { /* carry on and re-subscribe */ }
  }
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: appServerKey
  });
}

function pushErrorText(e) {
  var name = e && e.name ? e.name : '';
  if (name === 'NotAllowedError')  return 'Notifications are blocked for this site. Allow them in your browser settings.';
  if (name === 'AbortError')       return 'The browser could not reach the push service. Check your connection, or try a different browser.';
  if (name === 'NotSupportedError')return 'This browser does not support push notifications.';
  return (e && e.message) || 'unknown error';
}

async function subscribeToPush() {
  try {
    // Ask permission BEFORE touching the push service — a denied prompt
    // otherwise surfaces as an opaque push-service error.
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      showPushToast('Notifications blocked. Allow in browser settings.');
      return;
    }

    // Dedicated scope so this registration is never replaced by /sw.js
    var reg = await navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SW_SCOPE });
    await pushSwActive(reg);

    var appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC);
    var sub = await pushGetSubscription(reg, appServerKey);

    // Save to Supabase via worker
    var subJson = sub.toJSON();
    var res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'push.subscribe',
        payload: {
          endpoint: subJson.endpoint,
          p256dh:   subJson.keys.p256dh,
          auth:     subJson.keys.auth
        }
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error('Server rejected subscription (' + res.status + '): ' + errBody);
    }

    localStorage.setItem(LS_PUSH_KEY, '1');
    updateBellUI(true);
    showPushToast('🔔 Notifications on — you\'ll get wickets and match updates');
  } catch(e) {
    console.warn('Push subscribe error:', e);
    showPushToast('Could not enable notifications: ' + pushErrorText(e));
  }
}

async function unsubscribeFromPush() {
  try {
    var reg = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
    if (reg) {
      var sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Delete from Supabase
        await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'push.unsubscribe',
            payload: { endpoint: sub.endpoint }
          })
        });
        await sub.unsubscribe();
      }
    }
    localStorage.removeItem(LS_PUSH_KEY);
    updateBellUI(false);
    showPushToast('🔕 Notifications off');
  } catch(e) {
    console.warn('Push unsubscribe error:', e);
    localStorage.removeItem(LS_PUSH_KEY);
    updateBellUI(false);
  }
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; i++) { outputArray[i] = rawData.charCodeAt(i); }
  return outputArray;
}

function showPushToast(msg) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e1e1e;color:#f2ede3;padding:10px 18px;border-radius:8px;font-size:0.82rem;z-index:9999;border:1px solid rgba(201,168,76,0.25);max-width:90vw;text-align:center';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, 3500);
}

// Boot
initPushNotifications();
