/* ══════════════════════════════════════════════════════
   CONFIG — update WORKER_URL when you have access
══════════════════════════════════════════════════════ */
var SUPABASE_URL  = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var ANON_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var WORKER_URL    = 'https://tcc-admin.bydaries.workers.dev';
// The scorer PIN now lives ONLY in the worker env (SCORER_PIN var) and
// is exchanged for a 24h scorer token via scoring.auth. The PIN entered
// here is cached locally so the token can be silently renewed mid-match.
var _scorerToken = localStorage.getItem('tcc_scorer_token') || null;
var _cachedPin   = localStorage.getItem('tcc_scorer_pin')   || null;

async function scorerAuth(pin) {
  // → 'ok' | 'bad' | 'offline'
  try {
    var r = await fetch(WORKER_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'scoring.auth', payload: { pin: pin } })
    });
    if (r.status === 401) return 'bad';
    if (!r.ok) return 'offline';
    var d = await r.json();
    if (!d.token) return 'offline';
    _scorerToken = d.token; _cachedPin = pin;
    try {
      localStorage.setItem('tcc_scorer_token', d.token);
      localStorage.setItem('tcc_scorer_pin', pin);
    } catch(e) {}
    return 'ok';
  } catch(e) { return 'offline'; }
}

async function ensureScorerToken() {
  if (_scorerToken) return true;
  if (_cachedPin && navigator.onLine) {
    return (await scorerAuth(_cachedPin)) === 'ok';
  }
  return false;
}

async function workerCall(action, payload) {
  var r = await fetch(WORKER_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action, token: _scorerToken, payload: payload })
  });
  if (r.status === 401) {
    // token expired — renew once with the cached PIN and retry
    _scorerToken = null;
    if (await ensureScorerToken()) {
      r = await fetch(WORKER_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, token: _scorerToken, payload: payload })
      });
    }
  }
  return r;
}

/* ══════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════
   MATCH FORMATS
   'overs'   — conventional cricket (6-ball overs)
   'hundred' — ECB 100-ball format: 5-ball sets, ends change every 10 balls,
               20-ball cap per bowler, 25-ball powerplay, 2-run no-balls.
   Internally a "set" reuses the existing over counter: 20 sets x 5 = 100.
══════════════════════════════════════════════════════ */
var FORMATS = {
  overs: {
    key: 'overs', label: 'Overs',
    ballsPerSet: 6, endChangeBalls: 6,
    totalBalls: null, maxBallsPerBowler: null, powerplayBalls: 0,
    noBallRuns: 1, maxConsecutiveSets: 1,
    setLabel: 'over', setLabelPlural: 'overs'
  },
  hundred: {
    key: 'hundred', label: 'The Hundred (100 balls)',
    ballsPerSet: 5, endChangeBalls: 10,
    totalBalls: 100, maxBallsPerBowler: 20, powerplayBalls: 25,
    noBallRuns: 2, maxConsecutiveSets: 2,
    setLabel: 'set', setLabelPlural: 'sets'
  }
};
function fmt()            { return FORMATS[state.format] || FORMATS.overs; }
function isHundred()      { return fmt().key === 'hundred'; }
function ballsPerSet()    { return fmt().ballsPerSet; }
/* Penalty runs for an illegal delivery. Competitions differ: 2 in the
   100-ball game, 1 almost everywhere else. Set at match setup; falls back to
   the format's own figure for a match scored before the setting existed. */
function extraPen()       { return state.extraPenalty || fmt().noBallRuns || 1; }
/* The penalty in force when THIS ball was bowled. Stamped on every extra as
   it is recorded, so changing the setting mid-match cannot rewrite what has
   already been scored. Balls from before this existed fall back to the
   current setting, which is what they were scored under. */
function penOf(ball)      { return (ball && ball.pen) || extraPen(); }
function nbPen()          { return extraPen(); }
function widePen()        { return extraPen(); }

/* Restored state must have the shape the rest of the app assumes.

   Every restore path parses stored JSON with `|| '{}'` as the fallback, so a
   row saved before its players were set comes back as `{}` — an object with
   no dismissed, fow, retiredHurt or bowlers arrays. The first wicket then
   threw "Cannot read properties of undefined (reading 'push')". Filling the
   shape in once here is safer than guarding every push site, because a missed
   one only shows up mid-match, after real scoring has happened. */
function normaliseState() {
  var b = state.batting;
  if (!b || typeof b !== 'object') b = state.batting = {};
  if (!('striker' in b))    b.striker = null;
  if (!('nonStriker' in b)) b.nonStriker = null;
  if (!Array.isArray(b.dismissed))   b.dismissed = [];
  if (!Array.isArray(b.fow))         b.fow = [];
  if (!Array.isArray(b.retiredHurt)) b.retiredHurt = [];

  var w = state.bowling;
  if (!w || typeof w !== 'object') w = state.bowling = {};
  if (!('current' in w)) w.current = null;
  if (!Array.isArray(w.bowlers)) w.bowlers = [];

  if (!Array.isArray(state.currentOverBalls)) state.currentOverBalls = [];
  if (!Array.isArray(state.overHistory))      state.overHistory = [];
  if (!state.extras || typeof state.extras !== 'object') state.extras = {};
  ['wides','noballs','byes','legbyes','penalty'].forEach(function (k) {
    if (typeof state.extras[k] !== 'number') state.extras[k] = 0;
  });
  if (!state.partnership || typeof state.partnership !== 'object') state.partnership = { runs: 0, balls: 0 };
  if (typeof state.partnership.runs  !== 'number') state.partnership.runs = 0;
  if (typeof state.partnership.balls !== 'number') state.partnership.balls = 0;

  /* A restored current bowler must BE the object in the list, not a copy of
     it, or his runs would accumulate on a detached object and vanish. */
  if (w.current && w.current.id != null) {
    var match = w.bowlers.filter(function (x) { return x && x.id === w.current.id; })[0];
    if (match) w.current = match;
    else w.bowlers.push(w.current);
  }
}

/* A first innings snapshot, or null if there isn't a real one.

   Two places produce an empty object rather than null: a takeover does
   JSON.parse(row.first_innings_score || '{}'), and the save writes
   Object.assign({}, state.firstInningsScore || {}, { overHistory: [] }).
   Both give {}, which is truthy — so code that checked for the snapshot
   found one and then read undefined off it. That showed as
   "undefined/undefined" in the leave sheet, and undoing an innings change
   would have written undefined straight into the score. */
function firstInnings(v) {
  var f = arguments.length ? v : state.firstInningsScore;
  return (f && typeof f.runs === 'number') ? f : null;
}

/* How a delivery is split between batter, bowler and extras. Defined once
   because the live path, undo and recalculateBowlerStats each used to work
   this out themselves and drifted apart.

   Runs off the bat for a no-ball live in displayRuns; the penalty belongs to
   extras and NEVER to the batter. Overthrows go to the striker (and so to the
   bowler); byes, leg-byes and penalty runs off a no-ball go to their own
   extras bucket and are charged to nobody. */
function batRunsFor(ball) {
  if (!ball) return 0;
  if (ball.extra === 'wide' || ball.extra === 'bye' || ball.extra === 'legbye') return 0;
  if (ball.extra === 'noball') {
    var bat = (typeof ball.displayRuns === 'number')
      ? ball.displayRuns
      : Math.max(0, (ball.runs || 0) - penOf(ball));
    return bat + (ball.nbExtra === 'overthrow' ? (ball.nbExtraRuns || 0) : 0);
  }
  return ball.runs || 0;
}

/* Runs the batters physically ran — what decides whether strike rotates.
   Byes and leg-byes are run too, off a no-ball or a legal ball alike. */
function ranRunsFor(ball) {
  if (!ball) return 0;
  if (ball.extra === 'wide') return Math.max(0, (ball.runs || 0) - penOf(ball));
  if (ball.extra === 'bye' || ball.extra === 'legbye') return ball.runs || 0;
  if (ball.extra === 'noball') {
    return batRunsFor(ball) +
      ((ball.nbExtra === 'bye' || ball.nbExtra === 'legbye') ? (ball.nbExtraRuns || 0) : 0);
  }
  return ball.runs || 0;
}

/* Runs charged against the bowler's analysis. */
function bowlerChargeFor(ball) {
  if (!ball) return 0;
  if (ball.extra === 'wide')   return ball.runs || penOf(ball); // penalty + overthrows
  if (ball.extra === 'noball') return penOf(ball) + batRunsFor(ball);
  return batRunsFor(ball);                                      // byes/leg-byes: nothing
}
function totalBallsBowled(){ return (state.overs || 0) * ballsPerSet() + (state.balls || 0); }
function bowlerBalls(b)   { return b ? ((b.overs || 0) * ballsPerSet() + (b.balls || 0)) : 0; }
function inPowerplay()    { var pp = fmt().powerplayBalls; return pp > 0 && totalBallsBowled() < pp; }
/* Rate denominator: balls in the Hundred (official standard), overs otherwise. */
function rateUnits(balls)  { return isHundred() ? balls : balls / 6; }
function rateSuffix()      { return isHundred() ? '/b' : ''; }
function maxSets()        { return state.revisedOvers !== null ? state.revisedOvers : state.maxOvers; }
function ballsAllowed()   { var m = maxSets(); return m > 0 ? m * ballsPerSet() : 0; }

/* ══════════════════════════════════════════════════════
   TOURNAMENT RULE — "extras use up a ball"
   Some short-format competitions (the 100-ball tournament among them) do not
   re-bowl a wide or a no-ball: the run is conceded and the delivery still
   counts, so an innings is exactly its allotted number of balls. The one
   exception is the LAST delivery of the innings, which must be legal — an
   innings cannot end on a wide, so that one is re-bowled until it is.
   Off (the Laws), every wide and no-ball is re-bowled as usual.
══════════════════════════════════════════════════════ */
function extrasUseBall() { return !!state.extrasCountBall; }
function illegalCountsNow() {
  if (!state.extrasCountBall) return false;
  var allowed = ballsAllowed();
  if (!allowed) return true;                 // no limit — nothing to protect
  return (totalBallsBowled() + 1) < allowed; // not the final delivery
}
/* Does a delivery of this kind count as one of the innings' balls? */
function deliveryCounts(extra) {
  if (extra === 'wide' || extra === 'noball') return illegalCountsNow();
  return true;
}

/* ── Minimum balls for a result ────────────────────────────────────────
   ECB 100-ball rules: at least 25 balls must be bowled to the side batting
   second for the match to count — UNLESS a result was already achieved.
   Chasing the target down or being bowled out both count as achieved, so
   only a stoppage inside the first 25 balls forces a No Result. */
function minBallsForResult() { return isHundred() ? 25 : 0; }
function resultAchieved() {
  if (state.target !== null && state.runs >= state.target) return true;  // chased down
  if (state.wickets >= 10) return true;                                  // all out
  if (ballsAllowed() && totalBallsBowled() >= ballsAllowed()) return true; // full innings
  return false;
}
function canDeclareResult() {
  if (state.innings !== 2) return true;
  var min = minBallsForResult();
  if (!min || resultAchieved()) return true;
  return totalBallsBowled() >= min;
}

var state = {
  format:        'overs', // 'overs' | 'hundred'
  /* Tournament rule: a wide or no-ball uses up one of the innings' balls
     (the last delivery excepted). Off = the Laws. Set at match setup. */
  extrasCountBall: false,
  extraPenalty:    1,     // runs for a wide or a no-ball (2 in the 100-ball game)
  awaitingOverConfirm: false,
  fixture:       null,   // selected fixture object
  maxOvers:      40,     // original overs agreed at toss
  revisedOvers:  null,   // set if overs are reduced mid-match (weather etc.)
  innings:       1,
  battingTeam: 'tcc',  // 'tcc' | 'opp'
  runs:        0,
  wickets:     0,
  overs:       0,       // completed overs
  balls:       0,       // balls in current over
  extras:      { wides: 0, noballs: 0, byes: 0, legbyes: 0 },
  target:      null,
  currentOverBalls: [],  // array of ball events this over
  overExtended: false,   // true after scorer cancels end-of-over once
  matchPin:     null,     // 4-digit PIN set when match starts
  freeHit:      false,    // next ball is a free hit
  freeHitsEnabled: true,  // whether free hits are used in this match
  isSuperOver:  false,    // currently in a super over
  superOverNum: 0,        // which super over (1, 2...)
  mainMatch:    null,     // snapshot of main match state for result display
  toss:         null,     // { winner: 'tcc'|'opp', decision: 'bat'|'field' }
  partnership:  { runs: 0, balls: 0 }, // current partnership
  firstInningsBatting: null,
  firstInningsBowling: null,
  firstInningsScore:   null,
  overHistory:      [],  // array of {over, balls[], runs, wickets} per completed over
  liveScoreId: null,     // id of live_scores row once created
  _bowlerSeq:  0,         // incrementing ID for bowler uniqueness
  // Team lineup (set pre-match)
  lineup: {
    players: [],   // [{ name, player_id, isKeeper }]
    keeper: null,  // name of designated keeper
  },
  /* Squads build themselves: every name the scorer types is remembered for the
     side it belongs to, so later pickers can offer it instead of asking again.
     Deliberately NOT a pre-match form — an XI picker existed here once and was
     removed for being friction at the toss. */
  squads: { tcc: [], opp: [] },
  // Player tracking
  batting: {
    striker:    null,   // { name, runs, balls, fours, sixes }
    nonStriker: null,   // { name, runs, balls, fours, sixes }
    dismissed:  [],     // [ { name, runs, balls, how } ]
    retiredHurt: [],    // batters who retired hurt and can re-enter
  },
  bowling: {
    current:  null,     // { name, overs, balls, runs, wickets, wides, noballs }
    bowlers:  [],       // all bowlers used
  },
};

/* ══════════════════════════════════════════════════════
   STATE PERSISTENCE — survives device restart
══════════════════════════════════════════════════════ */
var STATE_KEY = 'tcc_scorer_state';

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      state:        state,
      offlineQueue: offlineQueue,
      savedAt:      new Date().toISOString()
    }));
  } catch(e) {
    console.warn('Could not save state:', e);
  }
}

function clearSavedState() {
  try { localStorage.removeItem(STATE_KEY); } catch(e) {}
}

function hasSavedState() {
  try {
    var raw = localStorage.getItem(STATE_KEY);
    if (!raw) return false;
    var saved = JSON.parse(raw);
    // Only restore if it was saved less than 24 hours ago and a match was in progress
    if (!saved.state || !saved.state.fixture) return false;
    var age = Date.now() - new Date(saved.savedAt).getTime();
    return age < 24 * 3600 * 1000;
  } catch(e) { return false; }
}

function restoreState() {
  try {
    var saved = JSON.parse(localStorage.getItem(STATE_KEY));
    if (!saved) return false;
    Object.assign(state, saved.state);
    offlineQueue = saved.offlineQueue || [];
    normaliseState();
    return true;
  } catch(e) { return false; }
}

var offlineQueue = [];

/* ══════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('screen-' + id).classList.add('active');
  // Keep the phone awake while scoring; let it sleep elsewhere
  if (id === 'scoring') acquireWakeLock(); else releaseWakeLock();
}

function showToast(msg, dur) {
  var t = document.getElementById('toast');
  if (!t) { console.warn('Toast:', msg); return; }
  t.textContent = msg; t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, dur || 2200);
}

function fmtOvers(overs, balls) {
  if (isHundred()) {
    var bowled = (overs || 0) * 5 + (balls || 0);
    var tot    = ballsAllowed() || 100;
    return bowled + '/' + tot + ' balls';
  }
  return overs + '.' + balls + ' ov';
}
/* Bowler figures: "3.2" in overs cricket, "12 balls" in the Hundred. */
function fmtBowlerOvers(b) {
  if (!b) return '0';
  if (isHundred()) return bowlerBalls(b) + ' balls';
  return (b.overs || 0) + (b.balls > 0 ? '.' + b.balls : '');
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtDate(d) {
  if (!d) return '';
  var p = d.split('-');
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return parseInt(p[2]) + ' ' + months[parseInt(p[1])-1];
}

/* ══════════════════════════════════════════════════════
   ONLINE / OFFLINE DETECTION
══════════════════════════════════════════════════════ */
/* Connectivity = navigator.onLine AND the write endpoint responding.
   Writes now flow through the worker (scoring.push), so the health
   check pings the worker. Supabase reads degrade independently. */
var apiReachable = false;
var _wasOffline  = false;

async function checkApiReachable() {
  if (!navigator.onLine) { setStatus('offline'); return; }
  try {
    var r = await fetch(WORKER_URL, { method: 'OPTIONS' });
    apiReachable = r.ok || r.status === 204;
    if (apiReachable) ensureScorerToken();   // silently renew the token on reconnect
  } catch(e) {
    apiReachable = false;
  }
  setStatus(apiReachable ? 'online' : 'error');
}

/* Shown on the device that has been taken over. Scoring is locked here
   because anything entered now would not reach the match. */
function showHandedOverNotice() {
  if (document.getElementById('handed-over-notice')) return;
  var n = document.createElement('div');
  n.id = 'handed-over-notice';
  n.setAttribute('role', 'alert');
  n.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(10,10,8,0.92);' +
    'display:flex;align-items:center;justify-content:center;padding:24px;text-align:center';
  n.innerHTML = '<div style="max-width:380px;color:#f7f6f3">' +
    '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:1.6rem;letter-spacing:2px;margin-bottom:10px">' +
      'Another device is scoring' +
    '</div>' +
    '<p style="font-size:0.9rem;line-height:1.6;margin-bottom:8px">' +
      'Someone has taken this match over, so scoring is locked on this phone. ' +
      'Anything entered here would not reach the match.' +
    '</p>' +
    '<p style="font-size:0.82rem;line-height:1.6;color:#b9b5a8;margin-bottom:18px">' +
      'Your copy up to this point is still saved on this device.' +
    '</p>' +
    '<button id="handed-over-ok" style="padding:12px 22px;border:none;border-radius:8px;' +
      'background:#8a6d28;color:#fff;font-family:inherit;font-size:0.95rem;font-weight:600">Back to fixtures</button>' +
    '</div>';
  document.body.appendChild(n);
  document.getElementById('handed-over-ok').addEventListener('click', function () {
    n.remove();
    showScreen('fixtures');
    loadFixtures();
  });
}

function setStatus(state) {
  var dot  = document.getElementById('status-dot');
  var text = document.getElementById('status-text');
  if (state === 'online') {
    dot.className    = 'status-dot online';
    text.textContent = 'Live';
    // Only flush on explicit reconnect, not on every successful sync
    if (_wasOffline) { _wasOffline = false; flushOfflineQueue(); }
  } else if (state === 'syncing') {
    dot.className    = 'status-dot syncing';
    text.textContent = 'Syncing…';
  } else if (state === 'error') {
    dot.className    = 'status-dot error';
    text.textContent = 'Server unreachable';
  } else {
    dot.className    = 'status-dot';
    text.textContent = 'Offline';
  }
}

// Debounce the online event — mobile signal fluctuates and fires repeatedly
var _onlineDebounce = null;
window.addEventListener('online', function() {
  clearTimeout(_onlineDebounce);
  _onlineDebounce = setTimeout(checkApiReachable, 2000);
});
window.addEventListener('offline', function() {
  clearTimeout(_onlineDebounce);
  apiReachable = false; _wasOffline = true; setStatus('offline');
});

// Check on load and every 60s
// Check once on load — no repeated pinging
setTimeout(checkApiReachable, 800);
setTimeout(loadPlayerNameSuggestions, 1200);

/* ══════════════════════════════════════════════════════
   OFFLINE QUEUE
══════════════════════════════════════════════════════ */
function queueUpdate(payload) {
  offlineQueue.push(payload);
  _wasOffline = true; // mark so flush runs when we next get online
  document.getElementById('queue-count').textContent = offlineQueue.length;
  document.getElementById('queue-banner').classList.add('show');
}

async function flushOfflineQueue() {
  if (!offlineQueue.length) return;
  /* Queued snapshots from before a handover must never reach the row. */
  if (state._handedOver) {
    offlineQueue = [];
    document.getElementById('queue-banner').classList.remove('show');
    saveState();
    return;
  }
  // Every queued payload is a FULL state snapshot (buildScorePayload),
  // and one device scores one match — so only the newest matters.
  // An hour offline becomes one PATCH, not eighty.
  var toFlush = [offlineQueue[offlineQueue.length - 1]];
  offlineQueue = [];
  var failed = [];
  for (var i = 0; i < toFlush.length; i++) {
    try {
      await pushScore(toFlush[i]);
    } catch(e) {
      // Drop 4xx errors — bad data won't succeed on retry
      var is4xx = e.message && (e.message.includes('23514') || /API error 4/.test(e.message));
      if (!is4xx) failed.push(toFlush[i]);
      else console.warn('Dropping queued item with constraint error:', e.message);
    }
  }
  offlineQueue = failed; // keep only actually-failed items
  if (!failed.length) {
    document.getElementById('queue-banner').classList.remove('show');
    showToast('✓ All updates synced');
  } else {
    document.getElementById('queue-count').textContent = failed.length;
    document.getElementById('queue-banner').classList.add('show');
  }
  // Reset status without triggering another flush
  var dot  = document.getElementById('status-dot');
  var text = document.getElementById('status-text');
  dot.className    = apiReachable ? 'status-dot online' : 'status-dot error';
  text.textContent = apiReachable ? 'Live' : 'Server unreachable';
}

/* ══════════════════════════════════════════════════════
   SCREEN WAKE LOCK — phone stays awake while scoring
══════════════════════════════════════════════════════ */
var _wakeLock = null;
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { _wakeLock = await navigator.wakeLock.request('screen'); }
  catch(e) { _wakeLock = null; }
}
function releaseWakeLock() {
  if (_wakeLock) { try { _wakeLock.release(); } catch(e) {} _wakeLock = null; }
}
// The OS releases the lock when the app is backgrounded — re-acquire
// when the scorer comes back mid-match
document.addEventListener('visibilitychange', function() {
  var scoring = document.getElementById('screen-scoring');
  if (document.visibilityState === 'visible' && scoring && scoring.classList.contains('active')) {
    acquireWakeLock();
  }
});

/* ══════════════════════════════════════════════════════
   PLAYER NAME SUGGESTIONS — non-blocking datalist
   Typing still works exactly as before; suggestions give
   the exact site spelling of TCC names, which keeps the
   fantasy auto-score name matching healthy now that the
   lineup selection step is gone. Only attached to inputs
   that take a TCC player — never the opposition's — so a
   stray tap can't put a TCC name in an opposition innings.
══════════════════════════════════════════════════════ */
var _namesReady = false;
async function loadPlayerNameSuggestions() {
  if (_namesReady) return;
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/public_players?select=name&active=not.eq.false&order=name.asc', {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    });
    var rows = (await r.json()) || [];
    if (!rows.length) return;
    var dl = document.getElementById('tcc-player-names');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'tcc-player-names';
      document.body.appendChild(dl);
    }
    dl.innerHTML = rows.map(function(p){ return '<option value="' + esc(p.name) + '">'; }).join('');
    _namesReady = true;
  } catch(e) { /* offline — plain typing still works */ }
}
function setNameSuggest(inputId, enabled) {
  var el = document.getElementById(inputId);
  if (!el) return;
  if (enabled && _namesReady) el.setAttribute('list', 'tcc-player-names');
  else el.removeAttribute('list');
}

/* ══════════════════════════════════════════════════════
   API — stubbed until DB/Worker access restored
   These write to live_scores table via Worker
══════════════════════════════════════════════════════ */
async function setFixtureResult(fixtureId, result) {
  if (!fixtureId || !result) return;
  try {
    await ensureScorerToken();
    var res = await workerCall('scoring.setResult', { fixtureId: fixtureId, result: result });
    if (!res.ok) {
      var txt = await res.text().catch(function() { return ''; });
      console.warn('setFixtureResult failed:', res.status, txt.slice(0, 120));
    }
  } catch(e) {
    console.warn('setFixtureResult error:', e.message);
  }
}

async function pushScore(data) {
  // All writes go through the worker (scoring.push) with the scorer
  // token — RLS has closed direct anon writes to live_scores.
  await ensureScorerToken();
  var res = await workerCall('scoring.push', {
    id:   state.liveScoreId || null,
    data: data
  });
  if (res.status === 409) {
    var tOver = await res.text().catch(function(){ return ''; });
    if (tOver.indexOf('taken_over') !== -1) {
      /* Another device now holds this match. Stop syncing, drop anything
         queued, and keep the local copy — it is still readable here and via
         recover.html, it just must not be pushed. */
      state._handedOver = true;
      offlineQueue = [];
      document.getElementById('queue-banner').classList.remove('show');
      saveState();
      showHandedOverNotice();
      throw new Error('Another device has taken over scoring this match.');
    }
  }
  if (!res.ok) {
    var txt = await res.text().catch(function(){ return ''; });
    throw new Error('API error ' + res.status + (txt ? ': ' + txt.slice(0,120) : ''));
  }
  var d = await res.json().catch(function(){ return {}; });
  if (!state.liveScoreId && d && d.id) state.liveScoreId = d.id;
  return { ok: true };
}

var _syncInFlight = false;
var _syncQueued   = false;

async function syncScore() {
  // In-flight guard: rapid ball entry must not overlap PATCHes —
  // out-of-order arrival would let an older snapshot land last and
  // regress the DB. Coalesce: re-run once at the end; the payload is
  // rebuilt from current state, so the trailing sync carries everything.
  if (_syncInFlight) { _syncQueued = true; return; }
  _syncInFlight = true;
  try {
    await _doSyncScore();
  } finally {
    _syncInFlight = false;
    if (_syncQueued) { _syncQueued = false; syncScore(); }
  }
}

async function _doSyncScore() {
  /* Once another device has taken this match over, this one must stop
     pushing. Both devices used to send a full snapshot of their own state to
     the same row, so whichever synced last won — and the old device's stale
     snapshot would wipe out the new scorer's overs, either on its next tap or
     when its offline queue flushed on regaining signal. */
  if (state._handedOver) return;

  var scoreData = buildScorePayload();

  if (!navigator.onLine || !apiReachable) {
    queueUpdate(scoreData);
    return;
  }

  setStatus('syncing');
  try {
    await pushScore(scoreData);
    setStatus('online');
  } catch(e) {
    console.warn('Score push failed:', e.message);

    // If the error mentions an unknown column (run_rate not yet added),
    // retry without it rather than blocking the whole sync
    if (e.message.includes('42703') || e.message.includes('run_rate') || e.message.includes('column')) {
      var fallback = Object.assign({}, scoreData);
      delete fallback.run_rate;
      try {
        await pushScore(fallback);
        setStatus('online');
        console.warn('Synced without run_rate — run add_run_rate.sql in Supabase to fix');
        return;
      } catch(e2) {
        console.warn('Fallback sync also failed:', e2.message);
      }
    }

    var dot  = document.getElementById('status-dot');
    var text = document.getElementById('status-text');
    dot.className = 'status-dot error';

    // 4xx = bad data / schema mismatch — re-queuing will never fix it, don't queue
    var is4xx = /API error 4\d\d/.test(e.message) || e.message.includes('23514') || e.message.includes('42703');
    text.textContent = e.message.includes('401') ? 'Auth error' :
                       e.message.includes('404') ? 'Table not found — check Supabase setup' :
                       e.message.includes('23514') ? 'Constraint error — check Supabase schema' :
                       e.message.includes('500') ? 'DB error' :
                       e.message.includes('42703') ? 'Column missing — run add_run_rate.sql' : 'Save failed';

    // Only queue for transient errors (network/5xx) — not for data errors (4xx)
    if (!is4xx) queueUpdate(scoreData);
    // Don't retry here — flushOfflineQueue handles retry when connection returns
  }
}

function buildScorePayload() {
  var battingName  = state.battingTeam === 'tcc' ? 'TCC' : (state.fixture ? state.fixture.opponent : 'Opponents');
  var bowlingName  = state.battingTeam === 'tcc' ? (state.fixture ? state.fixture.opponent : 'Opponents') : 'TCC';
  return {
    fixture_id:   state.fixture ? state.fixture.id : null,
    innings:      state.innings,
    batting_team: battingName,
    bowling_team: bowlingName,
    runs:         state.runs,
    wickets:      state.wickets,
    format:       state.format || 'overs',
    total_balls:  isHundred() ? (ballsAllowed() || 100) : null,
    /* The overs limit was read back on takeover (`row.max_overs || 0`) but
       never saved here, so it always restored as 0 — and 0 legitimately means
       "no limit" (a timed or declaration match), so nothing objected. The
       innings then never ended and scoring ran past the agreed overs. */
    max_overs:     state.maxOvers || 0,
    revised_overs: state.revisedOvers,
    overs:        state.overs,
    balls:        Math.min(state.balls, 5), // clamp — constraint is 0-5, over resets immediately after
    extras_wides:   state.extras.wides,
    extras_noballs: state.extras.noballs,
    extras_byes:    state.extras.byes,
    extras_legbyes: state.extras.legbyes,
    extras_penalty:  state.extras.penalty  || 0,
    target:       state.target,
    run_rate:     totalBallsBowled() > 0
      ? parseFloat((state.runs / rateUnits(totalBallsBowled())).toFixed(2))
      : 0,
    /* Sticky: once the match has ended, EVERY save says completed. The final
       save used to go out on its own while the normal after-each-ball save
       (always "live") was still in the queue — that one landed last and put
       the match back to live, so it vanished from Results and the website. */
    status:            state._finalResult ? 'completed' : 'live',
    result:            state._finalResult || undefined,
    updated_at:        new Date().toISOString(),
    scorer_pin:        state.matchPin || null,
    /* Which device holds the match. The Worker refuses a push from any other,
       so a superseded phone cannot overwrite the new scorer's overs. */
    scorer_session:    state._scorerSession || null,
    toss_winner:       state.toss ? state.toss.winner : null,
    toss_decision:     state.toss ? state.toss.decision : null,
    current_over_balls: JSON.stringify(state.currentOverBalls || []),
    over_history:       JSON.stringify(state.overHistory || []),
    batting_state:           JSON.stringify(state.batting              || {}),
    bowling_state:           JSON.stringify(state.bowling              || {}),
    lineup_state:            JSON.stringify(state.lineup               || {}),
    first_innings_batting:   JSON.stringify(state.firstInningsBatting || {}),
    first_innings_bowling:   JSON.stringify(state.firstInningsBowling || {}),
    /* null rather than {} when there is no first innings, so a later restore
       doesn't get a truthy empty object back. */
    first_innings_score:     firstInnings()
                               ? JSON.stringify(Object.assign(
                                   {}, state.firstInningsScore,
                                   { overHistory: state.firstInningsOverHistory || [] }))
                               : null,
  };
}

/* ══════════════════════════════════════════════════════
   FIXTURES FETCH
══════════════════════════════════════════════════════ */
async function loadFixtures() {
  var today = new Date().toISOString().slice(0,10);
  var in7   = new Date(Date.now() + 7*24*3600*1000).toISOString().slice(0,10);
  /* Fixtures from the last fortnight too. A match played on a date that has
     since passed — a wrong date, a rained-off game played later, a Sunday
     match opened on Monday — was unreachable: the list started at today. */
  var back14 = new Date(Date.now() - 14*24*3600*1000).toISOString().slice(0,10);

  try {
    var res = await fetch(
      SUPABASE_URL + '/rest/v1/fixtures?select=*&date=gte.' + back14 + '&date=lte.' + in7 + '&result=is.null&order=date.asc',
      { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY } }
    );
    var fixtures = await res.json();
    renderFixtureList(fixtures);
  } catch(e) {
    document.getElementById('fixture-list').innerHTML =
      '<div class="fixture-loading">Could not load fixtures.<br>Check connection.</div>';
    document.getElementById('fixture-list-upcoming').innerHTML = '';
    /* A head still reading "3 today" over a list that failed to load would
       be a lie, so both heads say what actually happened. */
    var tm = document.getElementById('fx-today-meta');
    if (tm) tm.textContent = 'could not load';
    var um = document.getElementById('fx-upcoming-meta');
    if (um) um.textContent = 'could not load';
  }
  loadLiveMatches();
  loadCompletedMatches();
}

/* ══════════════════════════════════════════════════════
   MATCHES STILL BEING SCORED
   Any row still marked live, whatever date its fixture carries, and even
   with no fixture behind it at all. Tapping one picks it up with the usual
   PIN takeover, so a match can never be stranded.
══════════════════════════════════════════════════════ */
var LIVE_COLS = 'id,fixture_id,current_over_balls,over_history,lineup_state,batting_state,bowling_state,' +
  'first_innings_batting,first_innings_bowling,first_innings_score,toss_winner,toss_decision,runs,wickets,' +
  'overs,balls,innings,batting_team,bowling_team,extras_wides,extras_noballs,extras_byes,extras_legbyes,' +
  'extras_penalty,target,max_overs,revised_overs,format,total_balls,updated_at,' +
  'fixtures(id,team,opponent,division,date,venue,tournament_id,tournament_stage)';

async function loadLiveMatches() {
  var wrap = document.getElementById('fixture-live-wrap');
  var el   = document.getElementById('fixture-list-live');
  if (!wrap || !el) return;
  try {
    var res = await fetch(
      SUPABASE_URL + '/rest/v1/live_scores?select=' + LIVE_COLS + '&status=eq.live&order=updated_at.desc&limit=20',
      { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY } }
    );
    var rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) { wrap.style.display = 'none'; return; }
    _liveRows = rows;
    wrap.style.display = '';
    /* A match to rejoin is never presented folded away. */
    wrap.open = true;
    fxPanelMeta('fx-live-meta', rows.length, 'match', 'matches');
    el.innerHTML = rows.map(function (r) {
      var fx = r.fixtures || {};
      var opp = fx.opponent || (isTccTeamName(r.batting_team, fx, r.bowling_team) ? r.bowling_team : r.batting_team) || 'Opponents';
      var when = matchDateOf(r);
      var stale = when && when < new Date().toISOString().slice(0, 10);
      return '<div class="fixture-item fixture-item-live" data-ls-id="' + r.id + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
          '<div class="fixture-item-team">' + esc(fx.team || 'TCC') + ' vs ' + esc(opp) + '</div>' +
          '<div style="font-size:0.72rem;color:var(--gold);font-weight:700;white-space:nowrap">' +
            r.runs + '/' + r.wickets + ' (' + fmtOvers(r.overs, r.balls) + ')</div>' +
        '</div>' +
        '<div class="fixture-item-meta">' +
          '<span>' + (when ? fmtDate(when) : 'No date') + '</span>' +
          (fx.division ? '<span>' + esc(fx.division) + '</span>' : '') +
          '<span>Innings ' + (r.innings || 1) + '</span>' +
        '</div>' +
        '<div style="font-size:0.7rem;color:var(--gold);margin-top:4px;opacity:0.85">▶ Carry on scoring' +
          (stale ? ' · dated ' + fmtDate(when) : '') + '</div>' +
      '</div>';
    }).join('');
    el.querySelectorAll('.fixture-item-live').forEach(function (item) {
      item.addEventListener('click', function () {
        var id = parseInt(this.dataset.lsId, 10);
        var row = _liveRows.filter(function (r) { return r.id === id; })[0];
        if (row) resumeLiveMatch(row);
      });
    });
  } catch (e) {
    wrap.style.display = 'none';
  }
}
var _liveRows = [];

/* Pick up a live match straight from its own record — no fixture lookup, so
   it works for a past-dated fixture and for a match with no fixture at all. */
function resumeLiveMatch(row) {
  var fx = row.fixtures || {};
  var opp = fx.opponent || (isTccTeamName(row.batting_team, fx, row.bowling_team) ? row.bowling_team : row.batting_team) || 'Opponents';
  state.fixture = {
    id:       fx.id || row.fixture_id || null,
    team:     fx.team || 'TCC',
    opponent: opp,
    division: fx.division || '',
    venue:    fx.venue || '',
    date:     matchDateOf(row),
    tournament_id:    fx.tournament_id || null,
    tournament_stage: fx.tournament_stage || null
  };
  window._takeoverRow = row;
  document.getElementById('takeover-match-label').textContent =
    state.fixture.team + ' vs ' + state.fixture.opponent;
  openTakeoverPinModal();
}

async function loadCompletedMatches(fromDate, toDate) {
  var el = document.getElementById('fixture-list-completed');
  el.innerHTML = '<div class="fixture-loading">Loading…</div>';
  try {
    var from = fromDate || new Date(Date.now() - 30*24*3600*1000).toISOString().slice(0,10);
    var to   = toDate   || new Date().toISOString().slice(0,10);
    var url  = SUPABASE_URL + '/rest/v1/live_scores?select=id,fixture_id,batting_team,bowling_team,runs,wickets,overs,balls,innings,result,revised_overs,updated_at,batting_state,bowling_state,first_innings_batting,first_innings_bowling,first_innings_score,extras_wides,extras_noballs,extras_byes,extras_legbyes,extras_penalty,toss_winner,toss_decision,over_history,current_over_balls,lineup_state,target,max_overs,format,total_balls,fixtures(team,opponent,division,date,venue)&status=eq.completed&updated_at=gte.' + from + 'T00:00:00&updated_at=lte.' + to + 'T23:59:59&order=updated_at.desc&limit=50';
    var res = await fetch(url,
      { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY } }
    );
    var rows = await res.json();
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="fixture-loading">No recent results</div>';
      fxPanelMeta('fx-results-meta', 0, 'match', 'matches', 'none in that range');
      return;
    }
    fxPanelMeta('fx-results-meta', rows.length, 'match', 'matches');
    // Newest match first by the date it was played, not the date last edited
    rows.sort(function(a, b) {
      return matchDateOf(b).localeCompare(matchDateOf(a)) || String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
    el.innerHTML = rows.map(function(r) {
      var scoreStr = r.runs + '/' + r.wickets + ' (' + r.overs + ' ov)';
      // The match date is the fixture's. updated_at moves on every save
      // (end of match, later corrections), so it drifted to the edit date.
      var date = matchDateOf(r);
      var fx = r.fixtures || {};
      var tccName  = fx.team     || 'TCC';
      var opponent = fx.opponent || ((r.batting_team === 'TCC') ? (r.bowling_team || 'Opponents') : (r.batting_team || 'Opponents'));
      var division = fx.division || '';
      return '<div class="fixture-item fixture-item-completed" data-ls-id="' + r.id + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div class="fixture-item-team">' + tccName + ' vs ' + opponent + '</div>' +
          '<div style="font-size:0.72rem;color:var(--gold);font-weight:700">' + scoreStr + '</div>' +
        '</div>' +
        '<div class="fixture-item-meta">' +
          '<span>' + fmtDate(date) + '</span>' +
          (division ? '<span>' + division + '</span>' : '') +
          (r.result ? '<span style="color:var(--green2)">' + r.result + '</span>' : '') +
        '</div>' +
        '<div style="font-size:0.7rem;color:var(--gold);margin-top:4px;opacity:0.7">📋 View Scorecard</div>' +
      '</div>';
    }).join('');
    el.querySelectorAll('.fixture-item-completed').forEach(function(item) {
      item.addEventListener('click', function() {
        var lsId = parseInt(this.dataset.lsId);
        var row = rows.find(function(r) { return r.id === lsId; });
        if (row) openCompletedScorecard(row);
      });
    });
  } catch(e) {
    el.innerHTML = '<div class="fixture-loading">Could not load results</div>';
  }
}

/* Is this stored team name TCC's side? `other` is the opposing name in the
   same row, used when the name alone can't tell. */
function isTccTeamName(name, fx, other) {
  var n = String(name || '').trim();
  if (!n) return false;
  if (n === 'TCC') return true;
  if (fx && fx.opponent && samePlayer(n, fx.opponent)) return false;
  if (fx && fx.team && samePlayer(n, fx.team)) return true;
  if (/tygerberg|\btcc\b/i.test(n)) return true;
  if (other && (other === 'TCC' || /tygerberg|\btcc\b/i.test(other))) return false;
  return false;
}

/* The date a match was played: the fixture's date, falling back to when the
   record was last saved only for a match with no fixture linked. */
function matchDateOf(row) {
  var f = (row && row.fixtures) || {};
  if (f.date) return String(f.date).slice(0, 10);
  return row && row.updated_at ? String(row.updated_at).slice(0, 10) : '';
}

function openCompletedScorecard(ls) {
  // Temporarily swap state data to render scorecard, then restore
  var savedState = JSON.parse(JSON.stringify({
    runs:    state.runs,    wickets: state.wickets, overs: state.overs, balls: state.balls,
    format:  state.format,  extras:  state.extras,  matchResult: state._matchResult,
    maxOvers: state.maxOvers, revisedOvers: state.revisedOvers,  batting: state.batting,  bowling: state.bowling,
    fixture: state.fixture, innings: state.innings,  battingTeam: state.battingTeam,
    firstInningsBatting: state.firstInningsBatting,
    firstInningsBowling: state.firstInningsBowling,
    firstInningsScore:   state.firstInningsScore,
  }));

  try {
    var batting  = JSON.parse(ls.batting_state  || '{}');
    var bowling  = JSON.parse(ls.bowling_state  || '{}');
    var fi_bat   = JSON.parse(ls.first_innings_batting || 'null');
    var fi_bowl  = JSON.parse(ls.first_innings_bowling || 'null');
    var fi_score = JSON.parse(ls.first_innings_score   || 'null');

    state.runs    = ls.runs    || 0;
    state.wickets = ls.wickets || 0;
    state.overs   = ls.overs   || 0;
    state.balls   = ls.balls   || 0;   // was never copied — totals showed the live match's balls
    if (ls.format) state.format = ls.format;
    // Its own limit, or "x/100 balls" and par figures use the live match's
    state.maxOvers     = ls.max_overs != null ? ls.max_overs : 0;
    state.revisedOvers = ls.revised_overs != null ? ls.revised_overs : null;
    state.innings = ls.innings || 1;
    state.extras  = {
      wides: ls.extras_wides || 0, noballs: ls.extras_noballs || 0,
      byes:  ls.extras_byes  || 0, legbyes: ls.extras_legbyes || 0,
      penalty: ls.extras_penalty || 0
    };
    /* The live scorer stores TCC's side as "TCC"; the manual scorecard page
       stores the real team names ("Tygerberg CC"). Testing only for "TCC"
       made a typed-up match where TCC batted second read as the other way
       round — players listed under the wrong club. */
    state.battingTeam          = isTccTeamName(ls.batting_team, ls.fixtures || {}, ls.bowling_team) ? 'tcc' : 'opp';
    state.batting              = batting;
    state.bowling              = bowling;
    state.firstInningsBatting  = fi_bat;
    state.firstInningsBowling  = fi_bowl;
    state.firstInningsScore    = firstInnings(fi_score);
    normaliseState();
    var lsFx = ls.fixtures || {};
    state.fixture = {
      team:     lsFx.team     || 'TCC',
      opponent: lsFx.opponent || (state.battingTeam === 'tcc' ? ls.bowling_team : ls.batting_team) || 'Opponents',
      division: lsFx.division || '',
      venue:    lsFx.venue    || '',
      date:     matchDateOf(ls)
    };

    /* Keep the row and its ball-by-ball so a name can be corrected on a
       finished match — written back to THIS row, never the live match. */
    _viewingCompleted = {
      row:       ls,
      overs:     parseMaybe(ls.over_history, []),
      curBalls:  parseMaybe(ls.current_over_balls, [])
    };
    document.getElementById('scorer-scorecard-body').innerHTML = buildScorerScorecardHTML();
    document.getElementById('scorer-scorecard-modal').style.display = 'flex';
    // Store result for social graphic
    state._matchResult = ls.result || '';
    // Show social card button and render charts
    var socialBtn = document.getElementById('scorer-scorecard-social');
    if (socialBtn) socialBtn.style.display = 'inline-flex';
    var shareBtn = document.getElementById('scorer-scorecard-share');
    if (shareBtn) shareBtn.style.display = 'none'; // no live link for completed matches
    setTimeout(function() { renderManhattan(); if (typeof renderWorm === 'function') renderWorm(); }, 80);
  } catch(e) {
    showToast('Could not load scorecard');
  }

  // Restore state after modal closes
  var closeBtn = document.getElementById('scorer-scorecard-close');
  function restoreOnClose() {
    state.runs    = savedState.runs;    state.wickets = savedState.wickets;
    state.overs   = savedState.overs;   state.extras  = savedState.extras;
    state.balls   = savedState.balls;   state.format  = savedState.format;
    state._matchResult = savedState.matchResult;   // viewing an old match overwrote it
    state.maxOvers     = savedState.maxOvers;  state.revisedOvers = savedState.revisedOvers;
    state.batting = savedState.batting; state.bowling = savedState.bowling;
    state.fixture = savedState.fixture; state.innings = savedState.innings;
    state.battingTeam           = savedState.battingTeam;
    state.firstInningsBatting   = savedState.firstInningsBatting;
    state.firstInningsBowling   = savedState.firstInningsBowling;
    state.firstInningsScore     = savedState.firstInningsScore;
    _viewingCompleted = null;
    closeBtn.removeEventListener('click', restoreOnClose);
  }
  closeBtn.addEventListener('click', restoreOnClose);
}

function renderFixtureList(fixtures) {
  var today    = new Date().toISOString().slice(0,10);
  /* Today's first, then anything from the past fortnight that was never
     scored — newest first, so a mis-dated or postponed match is still one
     tap away instead of lost. */
  var todayFix = fixtures.filter(function(f) { return f.date === today; });
  var past     = fixtures.filter(function(f) { return f.date <  today; })
                         .sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
  var upcoming = fixtures.filter(function(f) { return f.date >  today; });

  renderList('fixture-list', todayFix.concat(past), 'No fixtures today');
  renderUpcomingList('fixture-list-upcoming', upcoming, 'No upcoming fixtures this week');

  /* "Today" also carries the last fortnight's unscored fixtures, so the head
     says so rather than claiming they are today's. */
  var bits = [];
  if (todayFix.length) bits.push(todayFix.length + ' today');
  if (past.length) bits.push(past.length + ' earlier');
  var th = document.getElementById('fx-today-meta');
  if (th) th.textContent = bits.length ? bits.join(' · ') : 'nothing today';
  fxPanelMeta('fx-upcoming-meta', upcoming.length, 'fixture', 'fixtures', 'none this week');
}

function renderList(id, fixtures, emptyMsg) {
  var el = document.getElementById(id);
  if (!fixtures.length) { el.innerHTML = '<div class="fixture-loading">' + emptyMsg + '</div>'; return; }
  el.innerHTML = fixtures.map(function(f) {
    return '<div class="fixture-item" data-id="' + f.id + '">' +
      '<div class="fixture-item-team">' + (f.team || 'TCC') + '</div>' +
      '<div class="fixture-item-vs">vs ' + (f.opponent || 'TBC') + '</div>' +
      '<div class="fixture-item-meta">' +
        '<span>' + fmtDate(f.date) + '</span>' +
        (f.venue    ? '<span>📍 ' + f.venue + '</span>' : '') +
        (f.division ? '<span>' + f.division + '</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  el.querySelectorAll('.fixture-item').forEach(function(item) {
    item.addEventListener('click', function() {
      selectFixture(parseInt(this.dataset.id));
    });
  });
}

function renderUpcomingList(id, fixtures, emptyMsg) {
  var el = document.getElementById(id);
  if (!fixtures.length) { el.innerHTML = '<div class="fixture-loading">' + emptyMsg + '</div>'; return; }
  el.innerHTML = fixtures.map(function(f) {
    return '<div class="fixture-item fixture-item-upcoming">' +
      '<div class="fixture-item-team">' + (f.team || 'TCC') + '</div>' +
      '<div class="fixture-item-vs">vs ' + (f.opponent || 'TBC') + '</div>' +
      '<div class="fixture-item-meta">' +
        '<span>' + fmtDate(f.date) + '</span>' +
        (f.venue    ? '<span>📍 ' + f.venue + '</span>' : '') +
        (f.division ? '<span>' + f.division + '</span>' : '') +
      '</div>' +
      '<div style="font-size:0.68rem;color:var(--muted);margin-top:4px;font-style:italic">Not yet available to score</div>' +
    '</div>';
  }).join('');
  // No click listeners — upcoming fixtures are read-only
}

var lastFixtures = [];
async function selectFixture(id) {
  try {
    var res = await fetch(
      SUPABASE_URL + '/rest/v1/fixtures?select=*&id=eq.' + id,
      { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY } }
    );
    var data = await res.json();
    state.fixture = data[0] || null;
  } catch(e) {
    showToast('Could not load fixture details');
    return;
  }

  // Check if this fixture is already being scored
  try {
    var lsRes = await fetch(
      SUPABASE_URL + '/rest/v1/live_scores?select=id,current_over_balls,over_history,lineup_state,batting_state,bowling_state,first_innings_batting,first_innings_bowling,first_innings_score,toss_winner,toss_decision,runs,wickets,overs,balls,innings,batting_team,bowling_team,extras_wides,extras_noballs,extras_byes,extras_legbyes,target,max_overs,revised_overs,format,total_balls&fixture_id=eq.' + id + '&status=eq.live&limit=1',
      { headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY } }
    );
    var lsData = await lsRes.json();
    if (lsData && lsData.length > 0) {
      // Match already in progress — show takeover PIN modal
      window._takeoverRow = lsData[0];
      var f = state.fixture;
      document.getElementById('takeover-match-label').textContent =
        (f.team || 'TCC') + ' vs ' + (f.opponent || 'Opponents');
      openTakeoverPinModal();
      return;
    }
  } catch(e) {
    // If check fails, proceed normally
  }

  renderSetupScreen();
  showScreen('setup');
}

/* ══════════════════════════════════════════════════════
   SETUP SCREEN
══════════════════════════════════════════════════════ */
function renderSetupScreen() {
  var f = state.fixture;
  if (!f) return;
  document.getElementById('setup-fixture-summary').textContent =
    (f.team || 'TCC') + ' vs ' + (f.opponent || 'Opponents') +
    (f.venue ? ' · ' + f.venue : '') +
    (f.date  ? ' · ' + fmtDate(f.date) : '');
  document.getElementById('toss-away').textContent = f.opponent || 'Opponents';
  if (typeof setupPanelMetas === 'function') setupPanelMetas();
}

/* Toss toggles */
['toss-home','toss-away'].forEach(function(id) {
  document.getElementById(id).addEventListener('click', function() {
    document.getElementById('toss-home').classList.toggle('active', id === 'toss-home');
    document.getElementById('toss-away').classList.toggle('active', id === 'toss-away');
  });
});
['decision-bat','decision-field'].forEach(function(id) {
  document.getElementById(id).addEventListener('click', function() {
    document.getElementById('decision-bat').classList.toggle('active',   id === 'decision-bat');
    document.getElementById('decision-field').classList.toggle('active', id === 'decision-field');
    // Auto-set batting team
    var tossWon   = document.getElementById('toss-home').classList.contains('active') ? 'tcc' : 'opp';
    var batFirst  = id === 'decision-bat';
    document.getElementById('setup-bat-first').value = batFirst ? tossWon : (tossWon === 'tcc' ? 'opp' : 'tcc');
  });
});

(function initFormatToggle(){
  var sel = document.getElementById('setup-format');
  if (!sel) return;
  function apply() {
    var hundred = sel.value === 'hundred';
    var oversInput = document.getElementById('setup-overs');
    var note = document.getElementById('setup-format-note');
    if (oversInput && oversInput.parentNode) {
      oversInput.parentNode.style.display = hundred ? 'none' : '';
    }
    if (note) note.style.display = hundred ? '' : 'none';
    // The Hundred has its own fixed 20-ball limit
    var bl = document.getElementById('setup-bowler-limit-wrap');
    if (bl) bl.style.display = hundred ? 'none' : '';
    /* The 100-ball competitions this app is used for score extras this way,
       so the toggle starts on there — the scorer can still turn it off. */
    var eb = document.getElementById('setup-extras-ball');
    if (eb && !eb.dataset.touched) { eb.checked = hundred; syncExtrasBallLabel(); }
    var ep = document.getElementById('setup-extra-penalty');
    if (ep && !ep.dataset.touched) ep.value = hundred ? '2' : '1';
  }
  function syncExtrasBallLabel() {
    var eb = document.getElementById('setup-extras-ball');
    var lb = document.getElementById('setup-extras-ball-label');
    if (eb && lb) lb.textContent = eb.checked ? 'On' : 'Off';
  }
  var ebox = document.getElementById('setup-extras-ball');
  if (ebox) ebox.addEventListener('change', function () { this.dataset.touched = '1'; syncExtrasBallLabel(); });
  var epen = document.getElementById('setup-extra-penalty');
  if (epen) epen.addEventListener('change', function () { this.dataset.touched = '1'; });
  sel.addEventListener('change', apply);
  sel.addEventListener('change', function () { setupPanelMetas(); });
  apply();
  setupPanelMetas();
})();

/* ── SETUP PANELS ─────────────────────────────────────────
   Most of setup is a rule you set once a season, so it is folded away.
   The heads carry a summary of what is folded — otherwise a shut panel is
   just a thing to tap before you can check whether wides are worth 2. */
function setupPanelMetas() {
  var el = function (id) { return document.getElementById(id); };
  var fmt = el('setup-format');
  var hundred = fmt && fmt.value === 'hundred';

  var m = el('setup-match-meta');
  if (m) {
    var bits = [];
    if (hundred) {
      bits.push('100 balls');
    } else {
      var ov = (el('setup-overs') || {}).value;
      bits.push(ov ? ov + ' ov' : 'overs not set');
    }
    var bf = el('setup-bat-first');
    if (bf) {
      var opp = (el('toss-away') || {}).textContent || 'Opponents';
      bits.push((bf.value === 'tcc' ? 'TCC' : opp) + ' bat first');
    }
    m.textContent = bits.join(' · ');
  }

  var r = el('setup-rules-meta');
  if (r) {
    var out = [];
    var pen = (el('setup-extra-penalty') || {}).value;
    if (pen) out.push('wd/nb ' + pen + (pen === '1' ? ' run' : ' runs'));
    var eb = el('setup-extras-ball');
    if (eb && eb.checked) out.push('extras use a ball');
    /* Only what differs from the ordinary game earns a place on the head —
       a line listing every default is a line nobody reads. */
    var fh = el('setup-free-hits');
    if (fh && !fh.checked) out.push('no free hits');
    if (!hundred) {
      var bl = (el('setup-bowler-limit') || {}).value;
      if (bl) out.push('max ' + bl + '/bowler');
    }
    r.textContent = out.join(' · ');
  }
}

/* Remember which panels a scorer keeps open, per device. The live-match
   panel is left out on purpose: it is only on screen when there is a match
   to rejoin, and it should never come back shut. */
function rememberPanels(ids) {
  ids.forEach(function (id) {
    var d = document.getElementById(id);
    if (!d) return;
    var saved = null;
    try { saved = localStorage.getItem('tcc_panel_' + id); } catch (e) {}
    if (saved === '1') d.open = true; else if (saved === '0') d.open = false;
    d.addEventListener('toggle', function () {
      try { localStorage.setItem('tcc_panel_' + id, d.open ? '1' : '0'); } catch (e) {}
    });
  });
}

/* ── FIXTURE SCREEN PANELS ────────────────────────────────
   Four lists stacked up meant scrolling past three to reach the one you
   wanted. Folded, with the count on each head so the screen still tells
   you at a glance whether there is anything to score. */
function fxPanelMeta(id, n, one, many, empty) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = n ? (n + ' ' + (n === 1 ? one : many)) : (empty || 'none');
}

(function initFixturePanels() {
  rememberPanels(['fx-today-panel', 'fx-upcoming-panel', 'fx-results-panel']);
})();

(function initSetupPanels() {
  rememberPanels(['setup-match-panel', 'setup-rules-panel']);
  /* Anything that changes what a head says, re-writes the heads. */
  ['setup-overs', 'setup-bat-first', 'setup-extra-penalty', 'setup-extras-ball',
   'setup-free-hits', 'setup-bowler-limit'].forEach(function (id) {
    var n = document.getElementById(id);
    if (!n) return;
    n.addEventListener('change', setupPanelMetas);
    n.addEventListener('input', setupPanelMetas);
  });
  var fb = document.getElementById('format-btns');
  if (fb) fb.addEventListener('click', function () { setTimeout(setupPanelMetas, 0); });
  ['toss-home', 'toss-away', 'decision-bat', 'decision-field'].forEach(function (id) {
    var n = document.getElementById(id);
    if (n) n.addEventListener('click', function () { setTimeout(setupPanelMetas, 0); });
  });
  setupPanelMetas();
})();

document.getElementById('start-match-btn').addEventListener('click', function() {
  // Show set-PIN modal before starting
  openSetPinModal();
});

function doStartMatch() {
  var fmtSel = document.getElementById('setup-format');
  state.format = fmtSel && FORMATS[fmtSel.value] ? fmtSel.value : 'overs';

  if (isHundred()) {
    // 100 balls / 5 per set = 20 sets. No overs input needed.
    state.maxOvers = FORMATS.hundred.totalBalls / FORMATS.hundred.ballsPerSet;
  } else {
    var oversRaw = document.getElementById('setup-overs').value.trim();
    if (oversRaw === '') {
      showToast('Please set the overs per innings', 2500);
      document.getElementById('setup-overs').focus();
      return;
    }
    state.maxOvers = parseInt(oversRaw) || 0;
  }
  state.freeHitsEnabled = document.getElementById('setup-free-hits').checked;
  var ebEl = document.getElementById('setup-extras-ball');
  state.extrasCountBall = !!(ebEl && ebEl.checked);
  var epEl = document.getElementById('setup-extra-penalty');
  state.extraPenalty = epEl ? (parseInt(epEl.value, 10) || 1) : (isHundred() ? 2 : 1);
  // Save toss result
  var tossWinner   = document.getElementById('toss-home').classList.contains('active') ? 'tcc' : 'opp';
  var tossDecision = document.getElementById('decision-bat').classList.contains('active') ? 'bat' : 'field';
  state.toss = { winner: tossWinner, decision: tossDecision };
  state.revisedOvers  = null;
  state.battingTeam   = document.getElementById('setup-bat-first').value;
  state.runs = 0; state.wickets = 0; state.overs = 0; state.balls = 0;
  state.extras = { wides: 0, noballs: 0, byes: 0, legbyes: 0, penalty: 0 };
  state.target = null; state.innings = 1; state._matchResult = null; state._finalResult = null;
  state.currentOverBalls = []; state.overHistory = []; state.overExtended = false;
  state.liveScoreId = null;
  state._scorerSession = 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  state._handedOver = false;
  state.batting = { striker: null, nonStriker: null, dismissed: [], fow: [] };
  state.freeHit = false;
  state.bowling = { current: null, bowlers: [] };
  state.lineup  = { players: [], keeper: null,
    extrasCountBall: state.extrasCountBall, extraPenalty: state.extraPenalty };
  var bolEl = document.getElementById('setup-bowler-limit');
  var bol = bolEl ? parseInt(bolEl.value, 10) : NaN;
  if (isFinite(bol) && bol > 0) state.lineup.bowlerOverLimit = bol;   // blank = one-fifth of the innings
  state.firstInningsBatting = null;
  state.firstInningsBowling = null;
  state.firstInningsOverHistory = null;
  state.firstInningsScore   = null;
  clearSavedState();
  // Don't saveState here — save only after opening players are confirmed
  // so a crash before the modal is filled doesn't create a null-player resume state
  showScreen('scoring');
  updateScoringUI();
  // Lineup selection removed (was cumbersome pre-match friction) —
  // all players are entered manually as they appear, same as the
  // opposition flow. openLineupModal() kept dormant for rollback.
  loadSquads();
  openOpeningPlayersModal();
}

document.getElementById('setup-free-hits').addEventListener('change', function() {
  document.getElementById('setup-free-hits-label').textContent = this.checked ? 'On' : 'Off';
});

document.getElementById('back-to-fixtures-btn').addEventListener('click', function() {
  showScreen('fixtures');
});


/* ══════════════════════════════════════════════════════
   RETIRE A BATTER — between deliveries
   A retirement is not a delivery outcome. Routing it through the W
   button consumed a legal ball: the innings count advanced, the batter
   was credited a ball never faced, and the bowler a delivery never sent
   down (which also eats their 20-ball cap in the Hundred).
   This path records NO ball. If the batter was struck BY a delivery,
   the W button remains correct — that ball really was bowled.
══════════════════════════════════════════════════════ */
var _retireWho  = null;   // 'striker' | 'nonStriker'
var _retireMode = null;   // 'hurt' | 'out'

function openRetireModal(which) {
  var b = state.batting[which];
  if (!b) return;
  if (state.awaitingOverConfirm) { showToast('Finish the ' + fmt().setLabel + ' first', 2200); return; }
  _retireWho  = which;
  _retireMode = null;
  document.getElementById('retire-batter-name').textContent = b.name;
  document.getElementById('input-retire-replacement').value = '';
  document.getElementById('retire-error').textContent = '';
  document.querySelectorAll('#retire-modal .dismissal-btn').forEach(function (x) { x.classList.remove('selected'); });

  // Offer the squad, minus anyone already used
  var prev = document.getElementById('retire-replacement-select');
  if (prev) prev.remove();
  var avail = availableBatters();
  if (avail.length) {
    var sel = document.createElement('select');
    sel.id = 'retire-replacement-select';
    sel.className = 'player-input-field';
    sel.style.cssText = 'margin-bottom:6px';
    sel.innerHTML = '<option value="">— Select from squad —</option>' +
      avail.map(function (n) { return '<option value="' + n.replace(/"/g, '&quot;') + '">' + n + '</option>'; }).join('');
    sel.addEventListener('change', function () {
      if (this.value) document.getElementById('input-retire-replacement').value = this.value;
    });
    var inp = document.getElementById('input-retire-replacement');
    inp.parentNode.insertBefore(sel, inp);
  }
  document.getElementById('retire-modal').style.display = 'flex';
}

document.querySelectorAll('#retire-modal .dismissal-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('#retire-modal .dismissal-btn').forEach(function (x) { x.classList.remove('selected'); });
    this.classList.add('selected');
    _retireMode = this.dataset.mode;
  });
});

document.getElementById('retire-cancel-btn').addEventListener('click', function () {
  document.getElementById('retire-modal').style.display = 'none';
  _retireWho = null; _retireMode = null;
});

document.getElementById('retire-ok-btn').addEventListener('click', function () {
  var err = document.getElementById('retire-error');
  if (!_retireMode) { err.textContent = 'Choose retired hurt, retired out or timed out.'; return; }
  var newName = (document.getElementById('input-retire-replacement').value || '').trim();
  /* Retired out and timed out are wickets. If this one ends the innings
     (all out), nobody comes in — so don't demand a name. */
  var isWkt = _retireMode === 'out' || _retireMode === 'timed';
  var lastOne = isWkt && state.wickets + 1 >= wicketsAllowed();
  if (!newName && !lastOne) { err.textContent = 'Enter the new batter.'; return; }

  var out = state.batting[_retireWho];
  if (!out) return;
  if (newName) rememberPlayer(state.battingTeam, newName);

  if (_retireMode === 'hurt') {
    // May return: park the innings so far, and it is NOT a wicket.
    state.batting.retiredHurt = state.batting.retiredHurt || [];
    state.batting.retiredHurt.push({ order: out.order, name: out.name, runs: out.runs, balls: out.balls,
                                     fours: out.fours, sixes: out.sixes });
  } else {
    // Retired out / timed out: a wicket for the team, credited to no bowler,
    // and no ball is bowled.
    var how = _retireMode === 'timed' ? 'Timed Out' : 'Retired Out';
    state.batting.dismissed = state.batting.dismissed || [];
    state.batting.dismissed.push({ order: out.order, name: out.name, runs: out.runs, balls: out.balls,
                                   fours: out.fours, sixes: out.sixes,
                                   how: how, bowler: null, fielder: null });
    state.wickets++;
    // It is a fall of wicket like any other — it was missing from the FOW list
    state.batting.fow = state.batting.fow || [];
    state.batting.fow.push({ wicket: state.wickets, score: state.runs,
                             overs: fmtOvers(state.overs, state.balls), batter: out.name });
    state.partnership = { runs: 0, balls: 0 };
  }

  if (lastOne) {
    // All out: nobody comes in; end the innings / match as usual.
    state.batting[_retireWho] = null;
    document.getElementById('retire-modal').style.display = 'none';
    _retireWho = null; _retireMode = null;
    saveState(); syncScore(); updateScoringUI(); updatePlayerBar();
    checkInningsOrMatchEnd();
    return;
  }

  var replacement = newBatter(newName);
  var retiredBack = (state.batting.retiredHurt || []).filter(function (b) { return samePlayer(b.name, newName); })[0];
  if (retiredBack) {
    // The replacement is a previously retired batter resuming their innings.
    // Keep their original place in the order — they are not a new batter.
    replacement.runs  = retiredBack.runs;  replacement.balls = retiredBack.balls;
    replacement.fours = retiredBack.fours; replacement.sixes = retiredBack.sixes;
    if (typeof retiredBack.order === 'number') replacement.order = retiredBack.order;
    state.batting.retiredHurt = state.batting.retiredHurt.filter(function (b) { return !samePlayer(b.name, newName); });
  }
  state.batting[_retireWho] = replacement;

  document.getElementById('retire-modal').style.display = 'none';
  _retireWho = null; _retireMode = null;

  saveState(); syncScore(); updateScoringUI(); updatePlayerBar();
  showToast(isWkt ? 'Out — no ball recorded' : 'Retired — no ball recorded', 2200);
});

document.getElementById('batter-striker').addEventListener('click', function () { openRetireModal('striker'); });
document.getElementById('batter-non-striker').addEventListener('click', function () { openRetireModal('nonStriker'); });

/* ══════════════════════════════════════════════════════
   MATCH PIN — SET (scorer starting a new match)
══════════════════════════════════════════════════════ */
var _setPinEntry = '';

function openSetPinModal() {
  _setPinEntry = '';
  updateMatchPinDots('set-pin-dots', 0);
  document.getElementById('set-pin-error').textContent = '';
  document.getElementById('set-match-pin-modal').style.display = 'flex';
}

function updateMatchPinDots(dotContainerId, count) {
  var dots = document.getElementById(dotContainerId).querySelectorAll('.match-pin-dot');
  dots.forEach(function(d, i) { d.classList.toggle('filled', i < count); });
}

document.getElementById('set-pin-cancel-btn').addEventListener('click', function() {
  document.getElementById('set-match-pin-modal').style.display = 'none';
  _setPinEntry = '';
});

document.querySelectorAll('#set-match-pin-modal .match-pin-key[data-val]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var val = this.dataset.val;
    if (val === 'del') {
      _setPinEntry = _setPinEntry.slice(0, -1);
    } else if (_setPinEntry.length < 4) {
      _setPinEntry += val;
    }
    updateMatchPinDots('set-pin-dots', _setPinEntry.length);
    document.getElementById('set-pin-error').textContent = '';
    if (_setPinEntry.length === 4) {
      // PIN set — close modal and start match
      state.matchPin = _setPinEntry;
      document.getElementById('set-match-pin-modal').style.display = 'none';
      _setPinEntry = '';
      doStartMatch();
    }
  });
});

/* ══════════════════════════════════════════════════════
   MATCH PIN — TAKEOVER (second scorer joining live match)
══════════════════════════════════════════════════════ */
var _takeoverPinEntry = '';
var _takeoverSession = null;  // token the Worker issues when a takeover is accepted
var _oversLimitUnknown = false;  // set when a restored row carries no overs limit

function openTakeoverPinModal() {
  _takeoverPinEntry = '';
  updateMatchPinDots('takeover-pin-dots', 0);
  document.getElementById('takeover-pin-error').textContent = '';
  document.getElementById('takeover-pin-modal').style.display = 'flex';
}

document.getElementById('takeover-cancel-btn').addEventListener('click', function() {
  document.getElementById('takeover-pin-modal').style.display = 'none';
  _takeoverPinEntry = '';
  window._takeoverRow = null;
});

document.querySelectorAll('#takeover-pin-modal .match-pin-key[data-val]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var val = this.dataset.val;
    if (val === 'del') {
      _takeoverPinEntry = _takeoverPinEntry.slice(0, -1);
    } else if (_takeoverPinEntry.length < 4) {
      _takeoverPinEntry += val;
    }
    updateMatchPinDots('takeover-pin-dots', _takeoverPinEntry.length);
    document.getElementById('takeover-pin-error').textContent = '';

    if (_takeoverPinEntry.length === 4) {
      var row = window._takeoverRow;
      var entered = _takeoverPinEntry;
      /* Set from the Worker's reply below; it is the token the Worker wrote
         to the row, so this device and the row agree on who holds the match. */
      if (!row) return;
      document.getElementById('takeover-pin-error').textContent = 'Checking…';
      (async function() {
        await ensureScorerToken();
        var r = await workerCall('scoring.takeover', { liveScoreId: row.id, pin: entered });
        if (!r.ok) {
          document.getElementById('takeover-pin-error').textContent = 'Incorrect PIN. Get it from the current scorer.';
          _takeoverPinEntry = '';
          updateMatchPinDots('takeover-pin-dots', 0);
          return;
        }
        // PIN correct — restore full state from Supabase row
        var tData = await r.json().catch(function() { return {}; });
        _takeoverSession = tData && tData.scorer_session ? tData.scorer_session : null;
        document.getElementById('takeover-pin-modal').style.display = 'none';
        _takeoverPinEntry = '';
        row.scorer_pin = entered;   // validated server-side; no longer in the select
        doTakeover(row);
      })();
    }
  });
});

function doTakeover(row) {
  // Restore state from Supabase live_scores row
  state.liveScoreId     = row.id;
  state.matchPin        = row.scorer_pin;
  state.innings         = row.innings || 1;
  state.runs            = row.runs || 0;
  state.wickets         = row.wickets || 0;
  state.overs           = row.overs || 0;
  state.balls           = row.balls || 0;
  state.target          = row.target || null;
  state.format          = row.format || 'overs';
  state.awaitingOverConfirm = false;
  /* Distinguish "not stored" from a real 0. A row written before max_overs
     was saved has null here; falling back to 0 silently removed the limit. */
  if (typeof row.max_overs === 'number') {
    state.maxOvers = row.max_overs;
  } else {
    var fxOvers = parseInt((state.fixture || {}).overs, 10);
    state.maxOvers = isFinite(fxOvers) && fxOvers > 0 ? fxOvers : 0;
    _oversLimitUnknown = !state.maxOvers;
  }
  state.revisedOvers = (typeof row.revised_overs === 'number') ? row.revised_overs : null;
  /* The lineup carries the bowler over-limit and TCC's catch/stumping tallies;
     a takeover used to drop it, so both were lost when a phone handed over. */
  try {
    var lu = row.lineup_state ? JSON.parse(row.lineup_state) : null;
    if (lu && typeof lu === 'object') {
      state.lineup = Object.assign({ players: [], keeper: null }, lu);
      // The ball-counting rule travels with the match, not the phone
      if (lu.extrasCountBall !== undefined) state.extrasCountBall = !!lu.extrasCountBall;
      if (lu.extraPenalty !== undefined) state.extraPenalty = parseInt(lu.extraPenalty, 10) || 1;
    }
  } catch (e) { /* keep the local lineup */ }
  state.extras = {
    wides:    row.extras_wides    || 0,
    noballs:  row.extras_noballs  || 0,
    byes:     row.extras_byes     || 0,
    legbyes:  row.extras_legbyes  || 0
  };
  // Restore batting/bowling team names back to 'tcc'/'opp'.
  /* The scorer saves TCC's side as "TCC", but this compared it with the
     fixture's team name ("1st Team") — never equal, so a takeover while TCC
     was batting decided the OPPOSITION was batting. */
  var f = state.fixture || {};
  state.battingTeam = isTccTeamName(row.batting_team, f, row.bowling_team) ? 'tcc' : 'opp';
  if (row.toss_winner) state.toss = { winner: row.toss_winner, decision: row.toss_decision || null };

  // Restore ball-by-ball state
  try { state.currentOverBalls = JSON.parse(row.current_over_balls || '[]'); } catch(e) { state.currentOverBalls = []; }
  try { state.overHistory      = JSON.parse(row.over_history || '[]');       } catch(e) { state.overHistory = []; }
  try { state.batting              = JSON.parse(row.batting_state          || '{}'); } catch(e) { state.batting = { striker: null, nonStriker: null, dismissed: [], fow: [] }; }
  try { state.bowling              = JSON.parse(row.bowling_state          || '{}'); } catch(e) { state.bowling = { current: null, bowlers: [] }; }
  try { state.firstInningsBatting  = JSON.parse(row.first_innings_batting  || '{}'); } catch(e) { state.firstInningsBatting = null; }
  try { state.firstInningsBowling  = JSON.parse(row.first_innings_bowling  || '{}'); } catch(e) { state.firstInningsBowling = null; }
  try { state.firstInningsScore = firstInnings(JSON.parse(row.first_innings_score || '{}')); } catch(e) { state.firstInningsScore = null; }
  state.overExtended = false;
  normaliseState();

  /* The Worker issued this token when it accepted the PIN, and has already
     written it to the row — so the previous device is fenced out from now on. */
  state._scorerSession = _takeoverSession || null;
  state._handedOver = false;
  clearSavedState();
  saveState();
  showScreen('scoring');
  updateScoringUI();
  showToast('✅ Takeover successful — scoring resumed');
  if (_oversLimitUnknown) {
    _oversLimitUnknown = false;
    showToast('Overs per side not stored for this match — set it under Other → Reduce overs', 6000);
  }
  ensurePlayersSet();
}

/* Coming back into a match that has nobody at the crease.

   An innings change clears the batters and the bowler and then prompts for
   them. If the scorer leaves the screen at that point — now possible, since
   leaving no longer deletes the match — the prompt is gone and they come back
   to a scoring screen with no players and no way to set them. Anything they
   tap is then recorded against nobody. */
function ensurePlayersSet() {
  var b = state.batting || {};
  var bowl = state.bowling || {};
  var needBatters = !b.striker || !b.nonStriker;
  var needBowler  = !bowl.current;
  if (!needBatters && !needBowler) return false;

  if (needBatters) {
    openOpeningPlayersModal();
    showToast('Set the batters and bowler to carry on', 3500);
  } else {
    /* Batters are in, only the bowler is missing — the over prompt handles
       that case properly, including who is not allowed to bowl next. */
    if (typeof openNewBowlerModal === 'function') openNewBowlerModal();
    else openOpeningPlayersModal();
    showToast('Choose the bowler to carry on', 3500);
  }
  return true;
}

/* ══════════════════════════════════════════════════════
   SCORING LOGIC
══════════════════════════════════════════════════════ */
function updateScoringUI() {
  var f = state.fixture;
  var battingName = state.battingTeam === 'tcc' ? (f ? f.team || 'TCC' : 'TCC') : (f ? f.opponent || 'Opponents' : 'Opponents');
  var bowlingName = state.battingTeam === 'tcc' ? (f ? f.opponent || 'Opponents' : 'Opponents') : (f ? f.team || 'TCC' : 'TCC');

  document.getElementById('sb-batting-label').textContent = battingName.toUpperCase() + ' BATTING';
  document.getElementById('sb-vs').textContent = 'vs ' + bowlingName;
  var sbScore = document.getElementById('sb-score');
  var scoreStr = state.runs + '/' + state.wickets;
  if (sbScore.textContent !== scoreStr) {
    sbScore.textContent = scoreStr;
    flashScore();
  }

  /* Run rate */
  var totalBalls = totalBallsBowled();
  var rrEl = document.getElementById('sb-rr');
  if (totalBalls > 0) {
    var rr = (state.runs / rateUnits(totalBalls)).toFixed(2);
    var rrText = 'RR ' + rr + rateSuffix();
    /* Par score line — only in 2nd innings with a target */
    if (state.innings === 2 && state.target !== null) {
      var effMax = state.revisedOvers !== null ? state.revisedOvers : state.maxOvers;
      if (effMax > 0) {
        var par = calcPar(state.target, state.overs, state.balls, effMax);
        var ahead = state.runs - par;
        var aheadStr = ahead >= 0
          ? '<span style="color:#5ec98a">+' + ahead + ' ahead</span>'
          : '<span style="color:#ff8f80">' + ahead + ' behind</span>';   // readable on the dark panel
        rrEl.innerHTML = 'RR ' + rr + ' &nbsp;|&nbsp; Par ' + par + ' &nbsp;' + aheadStr;
      } else {
        rrEl.textContent = rrText;
      }
    } else {
      rrEl.textContent = rrText;
    }
    rrEl.style.display = 'block';
  } else {
    rrEl.style.display = 'none';
  }
  document.getElementById('sb-overs').textContent  = fmtOvers(state.overs, state.balls);
  document.getElementById('sb-wides').textContent   = state.extras.wides;
  document.getElementById('sb-noballs').textContent = state.extras.noballs;
  document.getElementById('sb-byes').textContent    = state.extras.byes;
  document.getElementById('sb-legbyes').textContent = state.extras.legbyes;
  // Powerplay indicator (Hundred only)
  var ppEl = document.getElementById('powerplay-indicator');
  if (ppEl) {
    if (inPowerplay()) {
      var ppLeft = fmt().powerplayBalls - totalBallsBowled();
      ppEl.textContent = 'POWERPLAY \u00b7 ' + ppLeft + ' BALL' + (ppLeft === 1 ? '' : 'S') + ' LEFT';
      ppEl.style.display = '';
    } else {
      ppEl.style.display = 'none';
    }
  }

  // Super over indicator
  var soEl = document.getElementById('super-over-indicator');
  if (soEl) soEl.style.display = state.isSuperOver ? 'block' : 'none';
  if (soEl && state.isSuperOver) soEl.textContent = '⚡ SUPER OVER ' + state.superOverNum;
  var pen = state.extras.penalty || 0;
  document.getElementById('sb-penalty').textContent = pen;
  document.getElementById('sb-penalty-wrap').style.display = pen > 0 ? 'flex' : 'none';
  document.getElementById('over-label').textContent = 'Over ' + (state.overs + 1);

  if (state.target !== null) {
    var need = Math.max(0, state.target - state.runs);
    /* Balls left from the format's own set size. This was (overs left) x 6,
       which overstated it in the Hundred (5-ball sets) — 27 instead of 22 at
       15.3 — and gave the required rate per over instead of per ball. */
    var allowed   = ballsAllowed();
    var ballsLeft = allowed > 0 ? Math.max(0, allowed - totalBallsBowled()) : null;
    var rr2 = ballsLeft > 0 ? (need / rateUnits(ballsLeft)).toFixed(2) : null;
    document.getElementById('target-banner').style.display = 'flex';
    document.getElementById('target-need').innerHTML =
      'Need <b>' + need + '</b>' + (ballsLeft !== null ? ' off <b>' + ballsLeft + '</b> ball' + (ballsLeft === 1 ? '' : 's') : '');
    document.getElementById('target-rrr').innerHTML = rr2 ? 'RRR <b>' + rr2 + '</b><span class="unit">' + rateSuffix() + '</span>' : '';
  } else {
    document.getElementById('target-banner').style.display = 'none';
  }

  renderOverBalls();
  renderOverHistory();
}

function recordBall(event) {
  // The end-of-over prompt must be resolved before any further ball is scored.
  // Previously the run buttons stayed live behind it, so an unnoticed prompt let
  // an innings run on inside a single "over" — no bowler change, no over history.
  if (state.awaitingOverConfirm) {
    showToast('Finish the ' + fmt().setLabel + ' first \u2014 tap Confirm', 2200);
    var oc = document.getElementById('over-confirm');
    if (oc) oc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  /*
    event = {
      type: 'run' | 'extra' | 'wicket',
      runs: total runs to add to score,
      displayRuns: runs to show on ball chip (optional, defaults to runs),
      extra: 'wide' | 'noball' | 'bye' | 'legbye',
      wicket: true,
      isBallCounted: bool (optional override)
    }

    Extra runs breakdown:
      wide:   runs = 1 (penalty) + runs off bat. extras.wides += runs. Not a legal ball.
      noball: runs = 1 (penalty) + runs off bat. extras.noballs += 1 (penalty only). Legal runs go to score. Not a legal ball.
      bye:    runs = runs scored. extras.byes += runs. Legal ball.
      legbye: runs = runs scored. extras.legbyes += runs. Legal ball.
  */

  // Haptic tick — confirms the tap registered without looking (sunlight)
  if (navigator.vibrate) { try { navigator.vibrate(event.wicket ? 35 : 10); } catch(e) {} }

  // Determine if this counts as a legal ball
  var isBallCounted;
  if (event.isBallCounted !== undefined) {
    isBallCounted = event.isBallCounted;
  } else {
    isBallCounted = event.type !== 'extra' || deliveryCounts(event.extra);
  }

  state.runs += (event.runs || 0);

  if (event.extra) {
    var extraKey = event.extra + 's'; // 'wides', 'noballs', 'byes', 'legbyes'
    if (event.extra === 'noball') {
      // Only the no-ball penalty counts as a no-ball — bat runs go to the total only
      state.extras.noballs = (state.extras.noballs || 0) + extraPen();
      // Byes, leg-byes or penalty runs taken off that no-ball keep their own bucket
      if (event.nbExtra === 'bye')    state.extras.byes    = (state.extras.byes    || 0) + (event.nbExtraRuns || 0);
      if (event.nbExtra === 'legbye') state.extras.legbyes = (state.extras.legbyes || 0) + (event.nbExtraRuns || 0);
      if (event.nbExtra === 'penalty')state.extras.penalty = (state.extras.penalty || 0) + (event.nbExtraRuns || 0);
    } else {
      state.extras[extraKey] = (state.extras[extraKey] || 0) + (event.runs || 0);
    }
  }
  if (event.wicket) {
    state.wickets++;
  }

  // Stamp isBallCounted, bowler, region, and commentary onto the event
  event.isBallCounted = isBallCounted;
  if (event.extra === 'wide' || event.extra === 'noball') event.pen = extraPen();
  if (state.bowling.current) {
    event.bowler   = state.bowling.current.name;
    event.bowlerId = state.bowling.current.id;
  }
  if (typeof pendingRegion !== 'undefined' && pendingRegion) {
    event.region = pendingRegion;
    clearPendingRegion();
  }
  var commentaryEl = document.getElementById('ball-commentary');
  if (commentaryEl && commentaryEl.value.trim()) {
    event.commentary = commentaryEl.value.trim();
    commentaryEl.value = '';
    // It was for this ball — fold the box away again
    var cw = document.getElementById('commentary-wrap'), ct = document.getElementById('commentary-toggle');
    if (cw) cw.style.display = 'none';
    if (ct) ct.classList.remove('on');
  }

  // Push to current over
  state.currentOverBalls.push(event);

  // Only advance ball count for legal deliveries
  if (isBallCounted) {
    state.balls++;
    /* A no-ball that used up a ball still brings a free hit — clearing it
       here would cancel the free hit the no-ball just earned. */
    if (event.extra !== 'noball') state.freeHit = false;
  }

  // Update batting stats
  updateBattingStats(event);

  saveState();
  syncScore();
  updateScoringUI();

  // A wicket's end checks wait for the dismissal to be confirmed
  if (event.wicket && _wicketDetailsPending) return;
  afterBallChecks();
}

/* Everything that must happen once a ball is fully recorded: end the innings
   or match if it is over, otherwise handle the end of a set. Runs straight
   after recordBall(), or — for a wicket — after the dismissal is confirmed. */
function afterBallChecks() {
  var setComplete = state.balls >= ballsPerSet();

  /* Innings- and match-ending conditions are checked on EVERY ball, including
     the last ball of a set. These checks used to sit BELOW the end-of-set
     branch, which returns early — so the winning runs, or the final wicket,
     falling on the last ball of an over simply opened the end-of-over prompt
     and then the new-bowler modal, and the match never ended by itself.
     Roughly one chase in six finishes on the last ball of an over. */
  if (endingCondition()) {
    // The set is complete, so archive it before ending — otherwise the last
    // over is stored as a part-over.
    if (setComplete) archiveOver();
    checkInningsOrMatchEnd();
    return;
  }

  // Check end of set (6 legal balls in overs cricket, 5 in the Hundred)
  if (setComplete) {
    if (state.overExtended) {
      // Scorer already chose to extend — auto-complete on next legal ball
      completeOver();
    } else {
      showEndOfOver();
    }
    return; // completeOver re-runs the end checks after archiving
  }
}

/* Will the innings be over once this ball is done — all out, target reached,
   or the last ball of the last set? Used by the wicket modal to know that no
   new batter is coming in. */
function inningsWillEnd() {
  if (endingCondition()) return true;
  var m = maxSets();
  return state.balls >= ballsPerSet() && m > 0 && state.overs + 1 >= m;
}

/* inningsWillEnd(), judged as if the pending ball were dismissed `how`.
   recordBall() counted the ball as a wicket before the type was known; for
   Retired Hurt it is not one, so test with that wicket taken back off.
   Leaves state exactly as it found it — the modal may still be re-submitted. */
function inningsEndsWith(how) {
  if (countsAsWicket(how)) return inningsWillEnd();
  state.wickets--;
  try { return inningsWillEnd(); } finally { state.wickets++; }
}

/* ── Result wording ─────────────────────────────────────────────────────
   One place for it, so the end screen, PDF, website, push alert and social
   card all say the same thing, in the standard form:
     "Tygerberg CC won by 6 wickets (7 balls to spare)"
     "Tygerberg CC won by 1 wicket (off the last ball)"
     "Test CC won by 23 runs"
     "… won the Super Over by 4 runs"
   plus "(revised target)" after a rain reduction. */
function _plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
function _revised() { return state.revisedOvers !== null && state.revisedOvers !== undefined; }
function _bracket(parts) { parts = parts.filter(Boolean); return parts.length ? ' (' + parts.join(', ') + ')' : ''; }
function resultChaseWon() {
  var winner = winnerName(autoResult(true) === 'Won');
  var margin = _plural(Math.max(1, wicketsAllowed() - state.wickets), 'wicket');
  if (state.isSuperOver) return winner + ' won the Super Over by ' + margin;
  var spare = '';
  var allowed = ballsAllowed();
  if (allowed > 0) {
    var left = allowed - totalBallsBowled();
    spare = left > 0 ? _plural(left, 'ball') + ' to spare' : 'off the last ball';
  }
  return winner + ' won by ' + margin + _bracket([spare, _revised() ? 'revised target' : '']);
}
function resultDefended() {
  var winner = winnerName(autoResult(false) === 'Won');
  // The chasers needed `target` to win and `target - 1` to tie
  var margin = _plural(Math.max(1, state.target - state.runs - 1), 'run');
  if (state.isSuperOver) return winner + ' won the Super Over by ' + margin;
  return winner + ' won by ' + margin + _bracket([_revised() ? 'revised target' : '']);
}

/* A super over is two wickets a side, not ten. */
function wicketsAllowed() { return state.isSuperOver ? 2 : 10; }

/* Is the innings or match over? Returns a reason, or null.
   Pure — it decides nothing and changes no state. */
function endingCondition() {
  if (state.target !== null && state.runs >= state.target)     return 'chased';
  if (state.wickets >= wicketsAllowed())                        return 'allout';
  var m = maxSets(); // honours a revised (reduced) limit, not just maxOvers
  if (m > 0 && state.overs >= m && state.balls === 0)           return 'overs';
  return null;
}

/* The single place the innings or match is actually ended. Called after
   every ball and again after every completed over, so both paths agree.
   Returns true if it ended something. */
function checkInningsOrMatchEnd() {
  var reason = endingCondition();
  if (!reason) return false;

  if (reason === 'chased') {
    var fullResult = resultChaseWon();
    showToast('🏏 ' + fullResult, 3000);
    endMatch(fullResult);
    return true;
  }

  endInnings(); // all out, or overs exhausted
  return true;
}

function showEndOfOver() {
  var overRuns = state.currentOverBalls.reduce(function(s,b) { return s + (b.runs||0); }, 0);
  document.getElementById('confirm-over-summary').textContent =
    overRuns + ' runs · ' + state.wickets + ' wkts';
  document.getElementById('over-confirm').classList.add('show');
  document.getElementById('scoring-input').scrollTo({ top: 0, behavior: 'smooth' });
  state.awaitingOverConfirm = true;
  setScoringLocked(true);
}

/* Grey out and disable the scoring pad so an unresolved prompt cannot be
   scored past. Purely additive — the recordBall guard is the real safety net. */
function setScoringLocked(locked) {
  /* Undo is a .run-btn too, and was being locked with the rest — so the one
     ball you most need to take back (the one that just ended the set) could
     not be undone without first confirming the over. */
  var sel = '.run-btn:not(#undo-btn), .extra-type-btn, .extra-run-btn, .region-btn, .wicket-btn';
  document.querySelectorAll(sel).forEach(function(el) {
    if (el.closest('.over-confirm')) return;   // never lock the prompt's own buttons
    el.disabled = !!locked;
    el.style.opacity = locked ? '0.4' : '';
    el.style.pointerEvents = locked ? 'none' : '';
  });
}

document.getElementById('confirm-cancel-btn').addEventListener('click', function() {
  // Allow one extra ball — set flag so next legal ball auto-completes over
  if (state.balls >= ballsPerSet()) state.balls = ballsPerSet() - 1;
  state.overExtended = true;
  state.awaitingOverConfirm = false;
  setScoringLocked(false);
  document.getElementById('over-confirm').classList.remove('show');
});

document.getElementById('confirm-ok-btn').addEventListener('click', function() {
  document.getElementById('over-confirm').classList.remove('show');
  state.awaitingOverConfirm = false;
  setScoringLocked(false);
  completeOver();
});

function completeOver() {
  archiveOver();
  if (checkInningsOrMatchEnd()) return;
  openNewBowlerModal();
}

/* Archive the completed set and roll the counters. Split out of completeOver
   so recordBall can archive a set that ended the innings without also
   opening the new-bowler modal. */
function archiveOver() {
  // Archive current over
  var overRuns = state.currentOverBalls.reduce(function(s,b){ return s+(b.runs||0); },0);
  var overWkts = state.currentOverBalls.filter(function(b){ return b.wicket; }).length;

  // Detect split over — multiple distinct bowlerIds in this over
  var bowlerIds = [];
  state.currentOverBalls.forEach(function(b) {
    if (b.bowlerId && bowlerIds.indexOf(b.bowlerId) === -1) bowlerIds.push(b.bowlerId);
  });
  var isSplit = bowlerIds.length > 1;
  var splitBowlers = isSplit ? bowlerIds.map(function(id) {
    var b = state.bowling.bowlers.find(function(x) { return x.id === id; });
    return b ? b.name : null;
  }).filter(Boolean) : null;

  state.overHistory.push({
    over:         state.overs + 1,
    balls:        state.currentOverBalls.slice(),
    runs:         overRuns,
    wickets:      overWkts,
    bowler:       state.bowling.current ? state.bowling.current.name : null,
    bowlerId:     state.bowling.current ? state.bowling.current.id   : null,
    split:        isSplit || false,
    splitBowlers: splitBowlers,
  });
  // Detect maiden — only for non-split overs (split maiden handled by recalculateBowlerStats)
  if (state.bowling.current && !isSplit) {
    var maidenRuns = state.currentOverBalls.reduce(function(sum, b) {
      if (b.extra === 'wide' || b.extra === 'noball') return sum;
      return sum + (b.runs || 0);
    }, 0);
    if (maidenRuns === 0) state.bowling.current.maidens = (state.bowling.current.maidens || 0) + 1;
  }
  state.overs++;
  state.balls = 0;
  state.currentOverBalls = [];
  state.overExtended = false;
  // Ends change every endChangeBalls. In overs cricket that is every over; in
  // the Hundred it is every SECOND set (10 balls), so batters must NOT swap
  // after set 1 of a pair.
  if ((state.overs * ballsPerSet()) % fmt().endChangeBalls === 0) swapBatters();
  // Track consecutive sets for the current bowler (Hundred: max 2 in a row).
  state.bowling.consecutiveSets = (state.bowling.consecutiveSets || 0) + 1;

  // For split overs, recalculate to correctly attribute balls/runs between the two bowlers
  if (isSplit) recalculateBowlerStats();
}

function autoResult(battingTeamWon) {
  var tccIsBatting = state.battingTeam === 'tcc';
  var tccWon = battingTeamWon ? tccIsBatting : !tccIsBatting;
  return tccWon ? 'Won' : 'Lost'; // margin added by caller
}

function winnerName(tccWon) {
  var fx = state.fixture;
  if (tccWon) return fx ? (fx.team || 'TCC') : 'TCC';
  return fx ? (fx.opponent || 'Opponents') : 'Opponents';
}

function endInnings() {
  saveSquads();
  if (state.innings === 1) {
    // Set target and flip batting team
    state.target = state.runs + 1;
    state.innings = 2;
    state.battingTeam = state.battingTeam === 'tcc' ? 'opp' : 'tcc';
    // Snapshot 1st innings before reset
    state.firstInningsBatting = JSON.parse(JSON.stringify(state.batting));
    state.firstInningsBowling = JSON.parse(JSON.stringify(state.bowling));
    /* An innings almost never ends on a completed over — it ends all out, on
       a chase, or on a declaration. Only overHistory was being snapshotted, so
       the balls of the final part-over were discarded: the totals survived in
       firstInningsScore but the ball-by-ball did not. Marked incomplete so
       anything reading the history can tell it apart from a full over. */
    var firstHist = JSON.parse(JSON.stringify(state.overHistory));
    if ((state.currentOverBalls || []).length) {
      firstHist.push({
        over:         state.overs + 1,
        balls:        JSON.parse(JSON.stringify(state.currentOverBalls)),
        runs:         state.currentOverBalls.reduce(function (n, b) { return n + (b.runs || 0); }, 0),
        wickets:      state.currentOverBalls.filter(function (b) { return b.wicket; }).length,
        bowler:       state.bowling.current ? state.bowling.current.name : null,
        bowlerId:     state.bowling.current ? state.bowling.current.id   : null,
        split:        false,
        splitBowlers: null,
        incomplete:   true
      });
    }
    state.firstInningsOverHistory = firstHist;
    state.firstInningsScore   = {
      runs: state.runs, wickets: state.wickets,
      overs: state.overs, balls: state.balls,
      extras: JSON.parse(JSON.stringify(state.extras))
    };

    state.runs = 0; state.wickets = 0; state.overs = 0; state.balls = 0;
    state.extras = { wides:0, noballs:0, byes:0, legbyes:0, penalty:0 };
    state.currentOverBalls = []; state.overHistory = [];
    state.batting = { striker: null, nonStriker: null, dismissed: [], fow: [] };
  state.freeHit = false;
    state.freeHit = false;
    state.bowling = { current: null, bowlers: [] };
    saveState();
    showToast('1st innings over! Target: ' + state.target);
    syncScore();
    updateScoringUI();

    // Push notification for 2nd innings start
    var fx2 = state.fixture || {};
    var chasingTeam = state.battingTeam === 'tcc'
      ? (fx2.team || 'TCC')
      : (fx2.opponent || 'Opponents');
    dispatchPushEvent('innings', {
      title: '🏏 2nd innings',
      body:  chasingTeam + ' need ' + state.target +
             ' to win' +
             (state.maxOvers > 0 ? ' off ' + state.maxOvers + ' overs' : '')
    });

    openOpeningPlayersModal();
  } else {
    // Auto-determine result. The overs-up branch used target - runs, one
    // run too many (chasing 130, 120 all-in is a 9-run loss, not 10), and
    // "all out" was hard-coded to 10 — a super over ends at 2.
    var allOut = state.wickets >= wicketsAllowed();
    var fullResult = state.target !== null ? resultDefended() : winnerName(autoResult(false) === 'Won') + ' won';
    showToast((allOut ? '🎳 All out! ' : '⏱ Overs up! ') + fullResult, 2500);
    endMatch(fullResult);
  }
}

function checkForTie(result) {
  var isTie = (state.innings === 2 && state.target !== null && state.runs === state.target - 1 && (state.wickets >= 10 || (state.maxOvers > 0 && state.overs >= state.maxOvers && state.balls === 0)));
  // Also check if result string indicates a tie (overs up, exactly 0 runs short, or all out at exact target)
  var isExactTie = (state.innings === 2 && state.target !== null && state.runs + 1 === state.target && state.wickets >= 10);
  var isOversExact = (state.innings === 2 && state.target !== null && (state.target - state.runs - 1) === 0);
  return isExactTie || isOversExact;
}

function endMatch(chosenResult) {
  var result = chosenResult || 'Match complete';

  /* Backstop for the 25-ball minimum. Reached only if a win somehow gets this
     far without the innings qualifying — a wrong result can't be undone. */
  if (!canDeclareResult() && !/no result|abandon|forfeit/i.test(result)) {
    showToast('Under ' + minBallsForResult() + ' balls — recorded as No Result', 3500);
    result = 'No Result';
  }

  // Check for a tie — offer super over (limited overs only)
  if (!state.isSuperOver && state.maxOvers > 0) {
    var runDiff = state.innings === 2 && state.target !== null ? state.target - state.runs - 1 : -1;
    if (runDiff === 0 || result === 'Tie' || result === 'Draw') {
      // It is a tie — show super over prompt
      document.getElementById('super-over-tie-text').textContent =
        'The scores are level! Would you like to play Super Over ' + (state.superOverNum + 1) + '?';
      document.getElementById('super-over-modal').style.display = 'flex';
      return; // don't end match yet
    }
  }

  // Push final status to live_scores — through syncScore, so it is ordered
  // after any save already in flight, and sticky for any that follow.
  state._finalResult = result;
  syncScore();

  // Update the fixture's result field directly via Supabase
  // Fixtures only store the short form: Won / Lost / Draw / Tie / No Result / Abandoned / Forfeit
  if (state.fixture && state.fixture.id && result) {
    var SHORT = ['Won','Lost','Draw','Tie','No Result','Abandoned','Forfeit'];
    var fixtureResult;
    if (SHORT.indexOf(result) !== -1) {
      fixtureResult = result; // already short
    } else {
      // Full descriptive string — derive from whether the TCC team name appears first
      var tccName = (state.fixture.team || 'TCC').toLowerCase();
      fixtureResult = result.toLowerCase().indexOf(tccName) === 0 ? 'Won' : 'Lost';
    }
    setFixtureResult(state.fixture.id, fixtureResult);
  }

  clearSavedState();

  // A tournament match files itself, so nobody has to type the score again
  fileTournamentResult();

  // Store result for social graphic
  state._matchResult = result;

  // Push notification for match end
  dispatchPushEvent('result', {
    title: '🏏 Match complete',
    body:  result
  });

  // Show end screen
  var endTitle = state.isSuperOver ? 'Super Over Result' : 'Match Over';
  document.getElementById('end-title').textContent = endTitle;
  document.getElementById('end-result').textContent = result;
  document.getElementById('end-detail').textContent =
    state.fixture ? (state.fixture.team || 'TCC') + ' vs ' + (state.fixture.opponent || 'Opponents') : '';
  document.getElementById('end-scorecard').innerHTML = buildScorecardHTML();
  _viewingCompleted = null;
  var potmBtn = document.getElementById('end-potm-btn');
  if (potmBtn) potmBtn.style.display = /no result|abandon/i.test(result) ? 'none' : '';
  refreshEndPotm();

  showScreen('end');
}

/* ══════════════════════════════════════════════════════
   MOTION — small confirmations that a tap landed.
   Restarting an animation means removing the class, forcing a reflow and
   adding it again; without the reflow the browser sees no change and the
   second four in a row would not animate at all.
══════════════════════════════════════════════════════ */
function restartAnim(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
/* The score bumps on every change, and the board flashes gold for a boundary
   or red for a wicket — read at a glance from the far side of the ground. */
function flashScore() {
  var el = document.getElementById('sb-score');
  var board = document.querySelector('#screen-scoring .scoreboard') || document.querySelector('.scoreboard');
  restartAnim(el, 'bump');
  var last = (state.currentOverBalls || [])[state.currentOverBalls.length - 1];
  if (!board || !last) return;
  board.classList.remove('hit', 'out');
  if (last.wicket)                       restartAnim(board, 'out');
  else if (batRunsFor(last) >= 4)        restartAnim(board, 'hit');
}

/* ══════════════════════════════════════════════════════
   TOURNAMENT — a finished match files its own result
   Only for a fixture that belongs to a tournament. The Worker reads the
   score from the saved match rather than trusting anything sent from here,
   and the result lands in the same table as one typed in by hand.
══════════════════════════════════════════════════════ */
async function fileTournamentResult() {
  var fx = state.fixture || {};
  if (!fx.tournament_id || !state.liveScoreId) return;
  try {
    await ensureScorerToken();
    /* The final score is still on its way up when the match ends, so this
       waits for that push to land before asking the Worker to read it. */
    await syncScore();
    var res = await workerCall('tournament.captureFromMatch', { liveScoreId: state.liveScoreId });
    if (res && res.ok) showToast('\ud83c\udfc6 Result filed to the tournament table', 3000);
    else showToast('Match saved — file it to the tournament table from the admin page', 4500);
  } catch (e) {
    /* Never block the end of a match over this: the match itself is safe, and
       the result can be pulled in from the admin page whenever. */
    showToast('Match saved — file it to the tournament table from the admin page', 4500);
  }
}

/* ── Ball rendering ─────────────────────────────────── */
function ballChipLabel(b) {
  /* Returns the label to show on the ball chip */
  var disp = b.displayRuns !== undefined ? b.displayRuns : (b.runs || 0);
  if (b.wicket) {
    // "W", "1W", "Wd W", "Nb 1W", "B 2W"
    var pre = b.extra === 'wide' ? 'Wd' : b.extra === 'noball' ? 'Nb' : b.extra === 'bye' ? 'B' : b.extra === 'legbye' ? 'Lb' : '';
    return (pre ? pre + ' ' : '') + (disp > 0 ? disp : '') + 'W';
  }
  if (b.extra === 'wide')   return disp > 0 ? 'Wd+' + disp : 'Wd';
  if (b.extra === 'noball') {
    var nbLabel = disp > 0 ? 'Nb+' + disp : 'Nb';
    if (b.nbExtra && b.nbExtra !== 'none' && b.nbExtraRuns) {
      var suffixMap = { bye:'B', legbye:'Lb', overthrow:'Ot', penalty:'P' };
      nbLabel += '+' + b.nbExtraRuns + (suffixMap[b.nbExtra] || b.nbExtra);
    }
    return nbLabel;
  }
  if (b.extra === 'bye')    return disp > 0 ? 'B' + disp : 'B';
  if (b.extra === 'legbye') return disp > 0 ? 'Lb' + disp : 'Lb';
  return String(b.runs || 0);
}

function ballChipClass(b) {
  if (b.wicket)           return 'ball-chip wicket';
  if (b.extra)            return 'ball-chip extra';
  if (b.runs === 4)       return 'ball-chip runs-4';
  if (b.runs === 6)       return 'ball-chip runs-6';
  return 'ball-chip runs-0';
}

var _lastChipCount = 0;
function renderOverBalls() {
  var el = document.getElementById('over-balls');
  var html = '';
  var balls = state.currentOverBalls || [];
  // Only a ball that has just arrived animates — a redraw must not replay them all
  var freshIdx = balls.length > _lastChipCount ? balls.length - 1 : -1;
  _lastChipCount = balls.length;
  /* Every delivery bowled — wides and no-balls included. Only the first six
     used to be drawn, so an over with extras lost its last balls from view. */
  balls.forEach(function (b, i) {
    html += '<div class="' + ballChipClass(b) + (i === freshIdx ? ' fresh' : '') + '">' + ballChipLabel(b) + '</div>';
  });
  // Then an empty slot per legal ball still to come: 6 an over, 5 a set in the Hundred
  var left = Math.max(0, ballsPerSet() - (state.balls || 0));
  for (var i = 0; i < left; i++) {
    html += '<div class="ball-chip pending' + (i === 0 ? ' next' : '') + '"></div>';
  }
  el.innerHTML = html;
  el.classList.toggle('crowded', (state.currentOverBalls || []).length + left > 7);
}

var _ohActiveInn = 2; // which innings is showing in the over history tab (1 or 2)

function renderOverHistory() {
  // Badge count — always shows current innings overs
  var countEl = document.getElementById('over-history-count');
  if (countEl) countEl.textContent = state.overHistory.length ? '(' + state.overHistory.length + ')' : '';
  var actionCount = document.getElementById('action-history-count');
  if (actionCount) actionCount.textContent = state.overHistory.length ? '(' + state.overHistory.length + ')' : '';

  // Show innings tabs only in 2nd innings when 1st innings history exists
  var tabsEl = document.getElementById('over-history-inn-tabs');
  var has1st  = state.innings === 2 && state.firstInningsOverHistory && state.firstInningsOverHistory.length;
  if (tabsEl) {
    tabsEl.classList.toggle('visible', !!has1st);
    if (!has1st) _ohActiveInn = 2; // reset if 1st not available
  }

  // Pick which history to render
  var history = (_ohActiveInn === 1 && has1st)
    ? state.firstInningsOverHistory
    : state.overHistory;

  var el = document.getElementById('over-history-list');
  if (!history || !history.length) { el.innerHTML = ''; return; }

  el.innerHTML = history.slice().reverse().map(function(ov, revIdx) {
    var realIdx = history.length - 1 - revIdx;
    // Only show edit hint for current innings
    var canEdit = (_ohActiveInn === 2 || !has1st);
    var balls = ov.balls.map(function(b) {
      var cls   = b.wicket ? 'history-ball wk'
                : b.extra  ? 'history-ball'
                : b.runs===4 ? 'history-ball b4'
                : b.runs===6 ? 'history-ball b6'
                : 'history-ball';
      return '<span class="' + cls + '">' + ballChipLabel(b) + '</span>';
    }).join('');
    var bowlerLabel = ov.split && ov.splitBowlers
      ? ov.splitBowlers.join(' / ')
      : (ov.bowler || '');
    return '<div class="history-row"' + (canEdit ? ' data-over-idx="' + realIdx + '" title="Tap to edit"' : '') + '>' +
      '<div class="history-over">Ov ' + ov.over + (canEdit ? '<span class="history-edit-hint">✎</span>' : '') + '</div>' +
      '<div class="history-balls">' + balls + (bowlerLabel ? '<span style="font-size:0.6rem;color:var(--muted);margin-left:6px">' + bowlerLabel + '</span>' : '') + '</div>' +
      '<div class="history-runs">' + ov.runs + '</div>' +
    '</div>';
  }).join('');
}

// Innings tab click handler
document.getElementById('over-history-inn-tabs').addEventListener('click', function(e) {
  var btn = e.target.closest('.oh-inn-tab');
  if (!btn) return;
  _ohActiveInn = parseInt(btn.dataset.inn);
  document.querySelectorAll('.oh-inn-tab').forEach(function(b) {
    b.classList.toggle('active', parseInt(b.dataset.inn) === _ohActiveInn);
  });
  renderOverHistory();
});

/* ── Button listeners ────────────────────────────────── */
document.querySelectorAll('.run-btn[data-runs]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    // If an extra type is pending, cancel it first — run buttons record a normal delivery
    if (pendingExtra) {
      pendingExtra = null;
      document.querySelectorAll('.extra-type-btn').forEach(function(b) { b.classList.remove('selected'); });
      document.getElementById('extra-run-picker').style.display = 'none';
    }
    recordBall({ type: 'run', runs: parseInt(this.dataset.runs) });
  });
});

/* ── EXTRAS — two-step: pick type, then pick runs ─── */
var pendingExtra = null;

document.querySelectorAll('.extra-type-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    pendingExtra = this.dataset.extra;

    // Highlight selected type
    document.querySelectorAll('.extra-type-btn').forEach(function(b) { b.classList.remove('selected'); });
    this.classList.add('selected');

    // Update label based on type
    var labels = {
      wide:    'Wide — runs off this delivery (penalty already included):',
      noball:  'No-ball — runs off bat + penalty (e.g. 6 off no-ball = 7 total):',
      bye:     'Bye — runs (no runs to batter, counts as legal ball):',
      legbye:  'Leg-bye — runs (counts as legal ball):'
    };
    document.getElementById('extra-run-label').textContent = labels[pendingExtra] || 'Runs:';
    document.getElementById('extra-run-picker').style.display = 'block';

    // Bye/leg-bye must be at least 1 — disable the 0 button
    var zeroBtn = document.querySelector('.extra-run-btn[data-runs="0"]');
    var isByeType = (pendingExtra === 'bye' || pendingExtra === 'legbye');
    zeroBtn.disabled = isByeType;
    zeroBtn.style.opacity = isByeType ? '0.25' : '';
    zeroBtn.style.cursor  = isByeType ? 'not-allowed' : '';
  });
});

document.querySelectorAll('.extra-run-btn:not(.cancel)').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (!pendingExtra) return;
    var runs = parseInt(this.dataset.runs);

    /* 
      Scoring rules:
      Wide:   +1 penalty + runs. Ball not legal. Extras = wides += (1 + runs), total runs += (1 + runs)
      No-ball: +1 penalty + runs off bat. Ball not legal. Extras = noballs += 1, total runs += (1 + runs)
      Bye:    runs only. Ball IS legal. Extras = byes += runs, total runs += runs
      Leg-bye: runs only. Ball IS legal. Extras = legbyes += runs, total runs += runs
    */
    var totalRuns, extraKey, isBallCounted;

    if (pendingExtra === 'wide') {
      totalRuns     = widePen() + runs;  // penalty + any runs
      extraKey      = 'wide';
      isBallCounted = deliveryCounts('wide');
    } else if (pendingExtra === 'noball') {
      // Intercept — open NB extras modal for step 2
      pendingExtra = null;
      document.querySelectorAll('.extra-type-btn').forEach(function(b) { b.classList.remove('selected'); });
      document.getElementById('extra-run-picker').style.display = 'none';
      var zeroBtn2 = document.querySelector('.extra-run-btn[data-runs="0"]');
      zeroBtn2.disabled = false; zeroBtn2.style.opacity = ''; zeroBtn2.style.cursor = '';
      if (state.freeHitsEnabled) state.freeHit = true;
      openNbExtrasModal(runs);
      return;
    } else if (pendingExtra === 'bye') {
      totalRuns     = runs;
      extraKey      = 'bye';
      isBallCounted = true;
    } else if (pendingExtra === 'legbye') {
      totalRuns     = runs;
      extraKey      = 'legbye';
      isBallCounted = true;
    }

    recordBall({
      type:         'extra',
      extra:        extraKey,
      runs:         totalRuns,
      displayRuns:  runs,        // what to show on the ball chip (runs scored off delivery)
      isBallCounted: isBallCounted
    });

    // Reset picker
    pendingExtra = null;
    document.querySelectorAll('.extra-type-btn').forEach(function(b) { b.classList.remove('selected'); });
    document.getElementById('extra-run-picker').style.display = 'none';
    var zeroBtn = document.querySelector('.extra-run-btn[data-runs="0"]');
    zeroBtn.disabled = false; zeroBtn.style.opacity = ''; zeroBtn.style.cursor = '';
  });
});

document.getElementById('extra-cancel-btn').addEventListener('click', function() {
  pendingExtra = null;
  document.querySelectorAll('.extra-type-btn').forEach(function(b) { b.classList.remove('selected'); });
  document.getElementById('extra-run-picker').style.display = 'none';
  var zeroBtn = document.querySelector('.extra-run-btn[data-runs="0"]');
  zeroBtn.disabled = false; zeroBtn.style.opacity = ''; zeroBtn.style.cursor = '';
});

document.getElementById('wicket-btn').addEventListener('click', function() {
  if (pendingExtra) {
    pendingExtra = null;
    document.querySelectorAll('.extra-type-btn').forEach(function(b) { b.classList.remove('selected'); });
    document.getElementById('extra-run-picker').style.display = 'none';
  }
  recordBall({ type: 'wicket', runs: 0, wicket: true });
});

/* Reopen the most recent completed over so the standard Undo button
   can correct into it — covers the "mistake noticed one ball later"
   case without the full over-edit flow. Reverses what completeOver
   did: pops the history entry back into play, un-rotates strike,
   restores the over's bowler, and prunes a just-picked next-over
   bowler who never actually bowled. */
function reopenLastOver() {
  if (state.isSuperOver) { showToast('Not available in a super over'); return; }
  if (state.currentOverBalls.length) { showToast('Undo the current balls first'); return; }
  if (!state.overHistory.length) { showToast('No completed overs'); return; }

  var last = state.overHistory.pop();
  /* Ends only changed if archiveOver() swapped them — every over in overs
     cricket, but only every second set (10 balls) in the Hundred. Swapping
     back unconditionally put the wrong batter on strike, and the undo that
     follows then took the ball and runs off the batter who didn't face it. */
  var endsChanged = (state.overs * ballsPerSet()) % fmt().endChangeBalls === 0;
  state.overs = Math.max(0, state.overs - 1);
  state.currentOverBalls = (last.balls || []).slice();
  state.balls = state.currentOverBalls.filter(function(b) {
    return b.isBallCounted !== undefined ? b.isBallCounted
         : (!b.extra || b.extra === 'bye' || b.extra === 'legbye');
  }).length;
  // The over was already confirmed once — when it refills to 6 legal
  // balls it auto-completes again without re-asking
  state.overExtended = true;

  // Reverse the end-of-over strike rotation — only if there was one
  if (endsChanged) swapBatters();

  // Restore the over's bowler as current
  var ob = null;
  if (last.bowlerId) ob = state.bowling.bowlers.find(function(b){ return b.id === last.bowlerId; });
  if (!ob && last.bowler) ob = state.bowling.bowlers.find(function(b){ return b.name === last.bowler; });
  if (ob) state.bowling.current = ob;

  // Rebuild figures from history (also re-derives maidens correctly)
  recalculateBowlerStats();

  // Drop a next-over bowler who was picked but never bowled a ball
  state.bowling.bowlers = state.bowling.bowlers.filter(function(b) {
    return b === state.bowling.current || (b.balls||0) > 0 || (b.overs||0) > 0 ||
           (b.runs||0) > 0 || (b.wides||0) > 0 || (b.noballs||0) > 0;
  });

  saveState();
  syncScore();
  updateScoringUI();
  updatePlayerBar();
  showToast('\u21a9 Over ' + (state.overs + 1) + ' reopened \u2014 tap Undo to correct');
}

/* Reverses one completed wicket: the dismissal record, the fall of wicket,
   the partnership, and both batters at the crease. */
function restoreWicket(ball) {
  var u = ball._undo;
  if (!u || !u.outBatter) {
    /* A wicket recorded before this fix, or one where the modal never
       completed. The count and the bowler figures still come back, but the
       batters cannot be restored from what was stored at the time. */
    showToast('Wicket undone — check the batters at the crease', 4000);
    return;
  }

  /* Rebuild the crease as it stood straight after the ball: the dismissed
     batter at the end he was out at, the survivor at the other. Found by name,
     not by end — the "who faces next" choice, a manual ⇄ swap or an end-of-set
     change of ends may all have moved the pair around since the wicket. */
  var end = u.outEnd === 'nonStriker' ? 'nonStriker' : 'striker';
  var other = end === 'striker' ? 'nonStriker' : 'striker';
  var s = state.batting.striker, n = state.batting.nonStriker;
  var incName = u.incoming && u.incoming.name;
  var isInc = function (b) { return !!(b && incName && samePlayer(b.name, incName)); };
  var isSurv = function (b) { return !!(b && u.survivor && samePlayer(b.name, u.survivor)); };
  var incoming = isInc(s) ? s : isInc(n) ? n : null;
  var survivor = isSurv(s) ? s : isSurv(n) ? n : null;
  if (!survivor) {
    // Older record without the survivor's name: he is whoever isn't the new man
    survivor = (s && s !== incoming) ? s : (n && n !== incoming) ? n : null;
  }
  state.batting[other] = survivor;

  // 1. Take the replacement back off the crease
  if (u.incomingWasRetired && u.incoming) {
    /* He had come back from retired hurt — put him back on that list with the
       figures he returned with, not whatever he has now. */
    if (!state.batting.retiredHurt) state.batting.retiredHurt = [];
    if (!state.batting.retiredHurt.some(function (b) { return samePlayer(b.name, u.incoming.name); })) {
      state.batting.retiredHurt.push(u.incoming);
    }
  }

  // 2. Put the dismissed batter back exactly as he was
  state.batting[end] = u.outBatter;

  // 3. Remove the dismissal record
  if (u.how === 'Retired Hurt') {
    var rh = state.batting.retiredHurt || [];
    for (var i = rh.length - 1; i >= 0; i--) {
      if (samePlayer(rh[i].name, u.outBatter.name)) { rh.splice(i, 1); break; }
    }
  } else {
    var dis = state.batting.dismissed || [];
    for (var j = dis.length - 1; j >= 0; j--) {
      if (samePlayer(dis[j].name, u.outBatter.name)) { dis.splice(j, 1); break; }
    }
    // 4. And the fall of wicket
    var fow = state.batting.fow || [];
    if (fow.length && samePlayer(fow[fow.length - 1].batter, u.outBatter.name)) fow.pop();
  }

  // 5. The partnership as it stood before the wicket broke it
  if (u.partnership) state.partnership = { runs: u.partnership.runs, balls: u.partnership.balls };

  showToast(u.outBatter.name + ' is back in — ' + (incoming && incoming.name ? incoming.name + ' removed' : 'replacement removed'), 3500);
}

document.getElementById('undo-btn').addEventListener('click', function() {
  /* Undoing the ball that ended the set: that set is no longer complete, so
     the "end of over" prompt goes and scoring unlocks. */
  if (state.awaitingOverConfirm && state.currentOverBalls.length) {
    state.awaitingOverConfirm = false;
    document.getElementById('over-confirm').classList.remove('show');
    setScoringLocked(false);
  }
  if (!state.currentOverBalls.length) {
    if (state.overHistory.length && !state.isSuperOver) {
      var lastOv = state.overHistory[state.overHistory.length - 1];
      if (confirm('Nothing in this over.\n\nReopen over ' + lastOv.over + ' to undo into it?')) {
        reopenLastOver();
      }
    } else {
      showToast('Nothing to undo');
    }
    return;
  }
  var last = state.currentOverBalls.pop();
  state.runs -= (last.runs || 0);
  if (last.wicket) state.wickets = Math.max(0, state.wickets - 1);
  if (last.extra) {
    if (last.extra === 'noball') {
      /* Was hard-coded to 1 — wrong in the Hundred, where the penalty is 2. */
      state.extras.noballs = Math.max(0, (state.extras.noballs || 0) - nbPen());
      if (last.nbExtra === 'bye')     state.extras.byes    = Math.max(0, (state.extras.byes    || 0) - (last.nbExtraRuns || 0));
      if (last.nbExtra === 'legbye')  state.extras.legbyes = Math.max(0, (state.extras.legbyes || 0) - (last.nbExtraRuns || 0));
      if (last.nbExtra === 'penalty') state.extras.penalty = Math.max(0, (state.extras.penalty || 0) - (last.nbExtraRuns || 0));
    } else {
      var eKey = last.extra + 's';
      state.extras[eKey] = Math.max(0, (state.extras[eKey] || 0) - (last.runs || 0));
    }
  }
  var wasCounted = last.isBallCounted !== undefined ? last.isBallCounted
                 : (!last.extra || last.extra === 'bye' || last.extra === 'legbye');
  if (wasCounted) state.balls = Math.max(0, state.balls - 1);

  /* Put the dismissed batter back BEFORE reversing any figures, so the ball
     faced and its runs come off the batter who actually faced it rather than
     off the replacement standing in his place. */
  if (last.wicket || last.retiredHurt) restoreWicket(last);

  // Reverse batter stats
  var runsOffBat = batRunsFor(last);
  // Reverse swap FIRST so striker is back to who faced the ball, then subtract from them
  if (ranRunsFor(last) % 2 === 1) swapBatters();
  var s = state.batting.striker;
  if (s) {
    /* A no-ball is not a legal ball but IS a ball faced, so it has to come
       back off the batter too — mirror of the forward path. */
    if (wasCounted || last.extra === 'noball') s.balls = Math.max(0, s.balls - 1);
    s.runs  = Math.max(0, s.runs - runsOffBat);
    if (runsOffBat === 4) s.fours = Math.max(0, s.fours - 1);
    if (runsOffBat === 6) s.sixes = Math.max(0, s.sixes - 1);
  }

  /* Undo never reversed the partnership, so undoing any ball used to leave
     the partnership overstated for the rest of the stand. */
  if (state.partnership) {
    state.partnership.runs = Math.max(0, state.partnership.runs - (last.runs || 0));
    if (wasCounted || last.extra === 'noball') {
      state.partnership.balls = Math.max(0, state.partnership.balls - 1);
    }
  }

  // Recalculate bowler stats from scratch — most reliable after any undo
  recalculateBowlerStats();

  saveState();
  syncScore();
  updateScoringUI();
  updatePlayerBar();
  if (!last.wicket && !last.retiredHurt) showToast('Undone');
});

document.getElementById('end-innings-btn').addEventListener('click', function() {
  openEndInningsModal();
});

document.getElementById('end-innings-modal-cancel').addEventListener('click', function() {
  document.getElementById('end-innings-modal').style.display = 'none';
});

function openEndInningsModal() {
  var isFirst = state.innings === 1;
  var title   = isFirst ? 'End 1st Innings' : 'End Match';
  document.getElementById('end-innings-modal-title').textContent = title;

  var options = [];

  if (isFirst) {
    options.push({ label: '🏏 End innings — start 2nd innings', action: function() { endInnings(); } });
  }

  // Match-ending options always available
  options.push({ label: '🚫 No Result',   action: function() { endMatch('No Result'); } });
  options.push({ label: '🌧 Abandoned',   action: function() { endMatch('Abandoned'); } });
  options.push({ label: '🏳 Forfeit',     action: function() { endMatch('Forfeit'); } });
  if (!isFirst) {
    if (canDeclareResult()) {
      options.push({ label: '🤝 Draw',      action: function() { endMatch('Draw'); } });
      options.push({ label: '✅ Won',        action: function() { endMatch('Won'); } });
      options.push({ label: '❌ Lost',       action: function() { endMatch('Lost'); } });
    } else {
      // Under 25 balls with no result achieved — a win cannot be recorded.
      var short = minBallsForResult() - totalBallsBowled();
      options.push({
        note: 'Only ' + totalBallsBowled() + ' of the minimum ' + minBallsForResult() +
              ' balls have been bowled to the side batting second, so a win cannot be ' +
              'recorded yet — ' + short + ' more needed, or the match is a No Result.'
      });
    }
  }

  var list = document.getElementById('end-innings-options');
  list.innerHTML = '';
  options.forEach(function(opt) {
    if (opt.note) {
      var p = document.createElement('p');
      p.className = 'result-block-note';
      p.textContent = opt.note;
      list.appendChild(p);
      return;
    }
    var btn = document.createElement('button');
    btn.className = 'bowler-select-item';
    btn.textContent = opt.label;
    btn.addEventListener('click', function() {
      document.getElementById('end-innings-modal').style.display = 'none';
      opt.action();
    });
    list.appendChild(btn);
  });

  document.getElementById('end-innings-modal').style.display = 'flex';
}

document.getElementById('new-match-btn').addEventListener('click', function() {
  state.fixture = null; state.liveScoreId = null;
  clearSavedState();
  showScreen('fixtures');
  loadFixtures();
});


/* ══════════════════════════════════════════════════════
   PAR SCORE CALCULATION
   Uses proportional resource method — a fair approximation
   for amateur cricket. Not full DLS (which requires the
   licensed ICC resource table) but consistent with what
   most local league apps use as a quick reference.

   Formula: par = target × (resources used / total resources)
   Where resources are approximated by balls remaining.
   This matches the "proportional" method used by many
   amateur scoring apps and gives umpires a reference point.
══════════════════════════════════════════════════════ */
function calcPar(target, overs, balls, maxOvers) {
  var bps           = ballsPerSet();
  var totalBalls    = maxOvers * bps;
  var ballsBowled   = overs * bps + balls;
  var ballsRemain   = totalBalls - ballsBowled;
  if (ballsBowled <= 0)    return 0;
  if (ballsRemain <= 0)    return target;
  /* Proportional par: runs expected at this point */
  var par = Math.round(target * (ballsBowled / totalBalls));
  return par;
}

/* ══════════════════════════════════════════════════════
   REDUCE OVERS MODAL
══════════════════════════════════════════════════════ */
function openReduceModal() {
  var effMax = state.revisedOvers !== null ? state.revisedOvers : state.maxOvers;
  var completed = state.overs;
  var currentEl = document.getElementById('reduce-modal-current');
  currentEl.innerHTML =
    'Current: <strong>' + (state.revisedOvers !== null ? 'Revised to ' + state.revisedOvers : state.maxOvers || 'Unlimited') + ' overs</strong>'
    + (completed > 0 ? ' &nbsp;·&nbsp; Overs bowled: <strong>' + completed + '</strong>' : '');
  document.getElementById('reduce-overs-input').value = effMax || '';
  /* Show target revision only in 2nd innings */
  document.getElementById('reduce-target-wrap').style.display = state.innings === 2 && state.target !== null ? 'block' : 'none';
  document.getElementById('reduce-target-input').value = '';
  document.getElementById('reduce-modal-error').textContent = '';
  document.getElementById('reduce-modal').style.display = 'flex';
  setTimeout(function() { document.getElementById('reduce-overs-input').focus(); }, 300);
}

function closeReduceModal() {
  document.getElementById('reduce-modal').style.display = 'none';
}

document.getElementById('reduce-overs-btn').addEventListener('click', openReduceModal);
document.getElementById('reduce-modal-close').addEventListener('click', closeReduceModal);
document.getElementById('reduce-modal-cancel').addEventListener('click', closeReduceModal);

// Close on overlay tap
document.getElementById('reduce-modal').addEventListener('click', function(e) {
  if (e.target === this) closeReduceModal();
});

document.getElementById('reduce-modal-confirm').addEventListener('click', function() {
  var val = parseInt(document.getElementById('reduce-overs-input').value);
  var errEl = document.getElementById('reduce-modal-error');
  errEl.textContent = '';

  if (!val || val < 1) {
    errEl.textContent = 'Please enter a valid number of overs.'; return;
  }
  if (val < state.overs) {
    errEl.textContent = 'Cannot set revised overs (' + val + ') below overs already bowled (' + state.overs + ').'; return;
  }
  if (state.maxOvers > 0 && val > state.maxOvers) {
    errEl.textContent = 'Cannot exceed original overs (' + state.maxOvers + ').'; return;
  }

  state.revisedOvers = val;

  /* Handle revised target if provided */
  var newTargetEl = document.getElementById('reduce-target-input');
  if (newTargetEl && newTargetEl.value && parseInt(newTargetEl.value) > 0) {
    state.target = parseInt(newTargetEl.value);
  }

  var btn = document.getElementById('reduce-overs-btn');
  btn.textContent = '🌧 Revised: ' + val + ' ov' + (state.target !== null ? ' · Target ' + state.target : '');
  btn.classList.add('revised');

  var msg = 'Overs revised to ' + val + '.';
  if (state.innings === 2 && state.target !== null) {
    msg += ' Target: ' + state.target + '. Par score now showing.';
  }

  syncScore();
  closeReduceModal();
  updateScoringUI();
  showToast(msg, 3500);
});

/* ══════════════════════════════════════════════════════
   PIN ENTRY
══════════════════════════════════════════════════════ */
var pinEntry = '';
function updatePinDots() {
  document.querySelectorAll('.pin-dot').forEach(function(dot, i) {
    dot.classList.toggle('filled', i < pinEntry.length);
  });
}
document.querySelectorAll('.pin-key').forEach(function(key) {
  key.addEventListener('click', function() {
    var val = this.dataset.val;
    if (val === 'del') {
      pinEntry = pinEntry.slice(0,-1);
    } else if (pinEntry.length < 4) {
      pinEntry += val;
    }
    updatePinDots();
    document.getElementById('pin-error').textContent = '';
    if (pinEntry.length === 4) {
      setTimeout(async function() {
        var entered = pinEntry;
        document.getElementById('pin-error').textContent = 'Checking…';
        var res = await scorerAuth(entered);
        if (res === 'bad') {
          document.getElementById('pin-error').textContent = 'Incorrect PIN — try again';
          pinEntry = '';
          updatePinDots();
          return;
        }
        if (res === 'offline') {
          // Can't verify right now — let the scorer in (scoring is
          // local-first); the PIN is cached and the token is acquired
          // on reconnect. A wrong PIN just means pushes 401 + queue.
          _cachedPin = entered;
          try { localStorage.setItem('tcc_scorer_pin', entered); } catch(e) {}
        }
        document.getElementById('pin-error').textContent = '';
        if (hasSavedState()) {
          showResumeModal();
        } else {
          showScreen('fixtures');
          loadFixtures();
        }
      }, 150);
    }
  });
});

/* ══════════════════════════════════════════════════════
   PLAYER TRACKING
══════════════════════════════════════════════════════ */

/* Batters are stamped with the position they came in at. A scorecard lists
   batters in the order they went to the crease, not the order they were out —
   without this the only record of arrival order was the dismissed[] array,
   which is dismissal order. 1 and 2 are the openers. */
function newBatter(name) {
  return { order: nextBattingPosition(), name: name.trim(), runs: 0, balls: 0, fours: 0, sixes: 0 };
}

/* Every batter in an innings, in the order they came to the crease.
   Returns [{ bat, notOut, retiredHurt }]. Matches saved before `order` existed
   have none, so those entries keep the order they were added in — the card is
   no worse than it was, and correct for everything scored from here on. */
function battingCard(batting) {
  if (!batting) return [];
  var rows = [], seq = 0;
  (batting.dismissed || []).forEach(function(b) {
    if (b) rows.push({ bat: b, notOut: false, retiredHurt: false, seq: seq++ });
  });
  ['striker','nonStriker'].forEach(function(k) {
    if (batting[k]) rows.push({ bat: batting[k], notOut: true, retiredHurt: false, seq: seq++ });
  });
  (batting.retiredHurt || []).forEach(function(b) {
    if (b) rows.push({ bat: b, notOut: false, retiredHurt: true, seq: seq++ });
  });
  var known = rows.filter(function(r) { return typeof r.bat.order === 'number'; });
  if (!known.length) return rows;   // legacy innings — leave as-is
  // Park anything without an order after the last known one, keeping its
  // arrival position, then sort. seq breaks ties so the sort stays stable.
  var maxOrd = known.reduce(function(m, r) { return Math.max(m, r.bat.order); }, 0);
  rows.forEach(function(r) {
    r._ord = typeof r.bat.order === 'number' ? r.bat.order : maxOrd + 1 + r.seq;
  });
  rows.sort(function(a, b) { return a._ord - b._ord || a.seq - b.seq; });
  return rows;
}

/* A fall-of-wicket "overs" value is stored already formatted ("17.2 ov",
   or "87/100 balls"); very old entries may be a bare number. */
function fowOvers(v) {
  var t = String(v == null ? '' : v).trim();
  return /[a-z]/i.test(t) ? t : (t ? t + ' ov' : '');
}

/* How a batter's innings ended, in standard scorecard notation. The ONLY
   place this is worked out — the PDF and the wicket notification used to
   carry their own copies, and both printed a plain catch as "c & b".
   Accepts a battingCard() row, or a bare dismissal record. */
function dismissalText(row) {
  if (row && row.bat === undefined) row = { bat: row };
  if (row.notOut)      return 'not out';
  if (row.retiredHurt) return 'retired hurt';
  var b  = row.bat || {};
  var bw = b.bowler  || '';
  var f  = b.fielder || '';
  switch (b.how || 'Bowled') {
    case 'Bowled':          return bw ? 'b ' + bw : 'bowled';
    case 'Caught':
      if (f && bw && samePlayer(f, bw)) return 'c & b ' + bw;   // scored as Caught, but the bowler took it
      if (f && bw) return 'c ' + f + ' b ' + bw;
      return bw ? 'caught b ' + bw : 'caught';
    case 'Caught & Bowled': return bw ? 'c & b ' + bw : 'caught & bowled';
    case 'LBW':             return bw ? 'lbw b ' + bw : 'lbw';
    case 'Stumped':
      if (f && bw) return 'st ' + f + ' b ' + bw;
      return bw ? 'st b ' + bw : 'stumped';
    case 'Hit Wicket':      return bw ? 'hit wkt b ' + bw : 'hit wicket';
    case 'Run Out':         return f ? 'run out (' + f + ')' : 'run out';
    case 'Retired':         return 'retired';
    case 'Retired Out':     return 'retired out';
    case 'Retired Hurt':    return 'retired hurt';
    case 'Obstructing the Field': return 'obstructing the field';
    case 'Hit the Ball Twice':    return 'hit the ball twice';
    case 'Timed Out':             return 'timed out';
    default:                return b.how;
  }
}

/* One row of the .ssc-* scorecard, shared by the 1st and current innings. */
function sscBatRow(row) {
  var b = row.bat;
  return '<div class="ssc-row">' +
    '<div class="ssc-name">' + esc(b.name) + (row.notOut ? '<span class="ssc-notout">*</span>' : '') + '</div>' +
    '<div class="ssc-how">' + esc(dismissalText(row)) + '</div>' +
    '<div class="ssc-num"' + (row.notOut ? ' style="color:var(--green2)"' : '') + '>' + b.runs + '</div>' +
    '<div class="ssc-detail">(' + b.balls + ')</div>' +
  '</div>';
}

/* Derived from the batters already in this innings rather than from a running
   counter, so it survives a handover, a restore from Supabase, the innings
   break and a super over without a counter to keep in step. */
function nextBattingPosition() {
  var b = state.batting || {};
  var seen = [];
  function note(x) { if (x && typeof x.order === 'number') seen.push(x.order); }
  (b.dismissed   || []).forEach(note);
  (b.retiredHurt || []).forEach(note);
  note(b.striker); note(b.nonStriker);
  if (!seen.length) return 1;                     // fresh innings — this is the opener
  return Math.max.apply(null, seen) + 1;
}

function newBowler(name) {
  state._bowlerSeq = (state._bowlerSeq || 0) + 1;
  return { id: state._bowlerSeq, name: name.trim(), overs: 0, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noballs: 0 };
}

/* Shorten a name to fit its box on the scoring screen only — the scorecard,
   PDF and website always carry the full name.
   1. full name  2. initials + surname, keeping "van der"/"de" with the
   surname  3. down to 80% size  4. CSS trims with an ellipsis. */
function shortName(full) {
  var p = String(full || '').trim().split(/\s+/);
  if (p.length < 2) return full;
  var i = p.length - 1;
  while (i > 1 && /^[a-z]/.test(p[i - 1])) i--;   // particles are lower-case
  return p.slice(0, i).map(function (w) { return w.charAt(0).toUpperCase(); }).join(' ') + ' ' + p.slice(i).join(' ');
}
function fitName(el) {
  if (!el) return;
  var full = el.dataset.full && el.textContent === el.dataset.short ? el.dataset.full : el.textContent;
  el.style.fontSize = '';
  el.textContent = full;
  el.dataset.full = full; el.title = full; delete el.dataset.short;
  if (!el.clientWidth || el.scrollWidth <= el.clientWidth + 0.5) return;   // fits (or not on screen yet)
  var sn = shortName(full);
  el.textContent = sn; el.dataset.short = sn;
  var base = parseFloat(getComputedStyle(el).fontSize), f = base;
  while (el.scrollWidth > el.clientWidth + 0.5 && f > base * 0.8) { f -= 0.5; el.style.fontSize = f + 'px'; }
}
window.addEventListener('resize', function () {
  ['striker-name', 'non-striker-name', 'bowler-name'].forEach(function (id) { fitName(document.getElementById(id)); });
});

function fmtBowlerFigures(b) {
  if (!b) return '0-0-0-0';
  var ov = isHundred() ? (bowlerBalls(b) + 'b')
                       : (b.overs + (b.balls > 0 ? '.' + b.balls : ''));
  return ov + '-' + (b.maidens || 0) + '-' + b.runs + '-' + b.wickets;
}
/* Hundred: a bowler is capped at maxBallsPerBowler for the match. */
/* ── Bowler limits ────────────────────────────────────────────────────
   The Hundred caps a bowler at 20 balls. Overs cricket had no limit at all,
   so nothing stopped a bowler going past the league's allowance. The usual
   rule is one-fifth of the innings, rounded up (4 in a T20, 8 in 40 overs,
   10 in 50); a league with a different rule sets it on the setup screen.
   It follows a rain reduction automatically, via maxSets(). */
function bowlerOverLimit() {
  if (isHundred()) return null;
  var custom = state.lineup && state.lineup.bowlerOverLimit;
  if (typeof custom === 'number' && custom > 0) return custom;
  var m = maxSets();
  return m > 0 ? Math.ceil(m / 5) : null;      // no overs limit, no bowler limit
}
function bowlerBallCap() {
  if (fmt().maxBallsPerBowler) return fmt().maxBallsPerBowler;
  var lim = bowlerOverLimit();
  return lim ? lim * ballsPerSet() : null;
}
function bowlerAtCap(b) {
  var cap = bowlerBallCap();
  return !!(cap && bowlerBalls(b) >= cap);
}
/* "3 left" / "12b left" beside a bowler in the picker */
function bowlerAllowanceLeft(b) {
  var cap = bowlerBallCap();
  if (!cap) return '';
  var left = Math.max(0, cap - bowlerBalls(b));
  if (isHundred()) return left + 'b left';
  var o = Math.floor(left / 6), r = left % 6;
  return (r ? o + '.' + r : o) + ' ov left';
}
/* Hundred: a bowler may bowl up to maxConsecutiveSets sets back-to-back
   (5 or 10 consecutive balls), then must be replaced. */
function bowlerMayContinue(b) {
  if (!b || bowlerAtCap(b)) return false;
  return (state.bowling.consecutiveSets || 0) < fmt().maxConsecutiveSets;
}

function swapBatters() {
  if (!state.batting.striker || !state.batting.nonStriker) return;
  var tmp = state.batting.striker;
  state.batting.striker    = state.batting.nonStriker;
  state.batting.nonStriker = tmp;
  markStrikeChange();
}
/* The two cards slide in from each other's side, so a change of ends reads as
   a movement rather than two names quietly swapping. */
function markStrikeChange() {
  var a = document.getElementById('batter-striker');
  var b = document.getElementById('batter-non-striker');
  if (!a || !b) return;
  a.style.setProperty('--strike-from', '8px');
  b.style.setProperty('--strike-from', '-8px');
  restartAnim(a, 'moved');
  restartAnim(b, 'moved');
}

function updateBattingStats(event) {
  var s = state.batting.striker;
  // Always look up bowler by name in the array to avoid stale reference after JSON round-trip
  var b = state.bowling.current
    ? state.bowling.bowlers.find(function(x) { return x.name === state.bowling.current.name; })
    : null;
  // Keep current in sync
  if (b) state.bowling.current = b;
  if (!s || !b) return;

  // Batter stats — runs off the bat only (never a no-ball/wide penalty, byes or leg-byes)
  var runsOffBat = batRunsFor(event);
  /* Balls faced keeps the usual convention whatever the ball-counting rule:
     a no-ball is faced, a wide never is. */
  if (event.extra !== 'wide' && (event.isBallCounted || event.extra === 'noball')) s.balls++;
  s.runs += runsOffBat;
  if (runsOffBat === 4) s.fours++;
  if (runsOffBat === 6) s.sixes++;

  /* Partnership: EVERY run added to the total while this pair is together —
     extras included, as on any scorecard, so the partnerships add up to the
     total. It used to drop the wide/no-ball penalty, and a wide returned
     below before reaching it at all, so extras went missing (22 vs 24). */
  if (!state.partnership) state.partnership = { runs: 0, balls: 0 };
  state.partnership.runs += (event.runs || 0);
  // Balls the batters faced: legal balls and no-balls, never wides
  if (event.extra !== 'wide' && (event.isBallCounted || event.extra === 'noball')) state.partnership.balls++;

  // Bowler stats
  /* Is this wicket the bowler's? The dismissal is known before the ball is
     recorded now, so credit it correctly first time. Wickets off a wide or a
     no-ball were never credited (stumped off a wide is the bowler's), and the
     later correction then took a run out off one away from his earlier
     wickets. A ball with no dismissal type (catch-up, editor) keeps the old
     provisional credit. */
  var bowlerWkt = event.wicket && (event.how ? creditsBowler(event.how) : event.extra !== 'runout_noball');
  if (event.extra === 'wide') {
    b.wides++; b.runs += bowlerChargeFor(event);
    if (bowlerWkt) b.wickets++;
    // Under the "extras use up a ball" rule it is one of his deliveries too
    if (event.isBallCounted) { b.balls++; if (b.balls >= ballsPerSet()) { b.overs++; b.balls = 0; } }
    // Swap on odd runs off a wide (e.g. wide + 2 overthrows = 3 total = swap)
    if (ranRunsFor(event) % 2 === 1) swapBatters();
    return;
  }
  if (event.extra === 'noball') {
    /* Not a legal ball, so no ball count for the bowler — but the batters can
       still run, so the partnership and strike rotation below must run too. */
    b.noballs++; b.runs += bowlerChargeFor(event);
    if (bowlerWkt) b.wickets++;
    if (event.isBallCounted) { b.balls++; if (b.balls >= ballsPerSet()) { b.overs++; b.balls = 0; } }
  } else {
    if (event.isBallCounted) {
      b.balls++;
      if (b.balls >= ballsPerSet()) { b.overs++; b.balls = 0; }
    }
    b.runs += runsOffBat;
    if (bowlerWkt) b.wickets++;
  }
  if (event.how === 'Stumped'  && event.fielder) {
    if (!state.lineup.stumpings) state.lineup.stumpings = {};
    state.lineup.stumpings[event.fielder] = (state.lineup.stumpings[event.fielder] || 0) + 1;
  }
  if ((event.how === 'Caught') && event.fielder) {
    if (!state.lineup.catches) state.lineup.catches = {};
    state.lineup.catches[event.fielder] = (state.lineup.catches[event.fielder] || 0) + 1;
  }


  // Check milestones
  if (s && runsOffBat > 0) {
    var prev = s.runs - runsOffBat;
    [50, 100, 150, 200].forEach(function(m) {
      if (prev < m && s.runs >= m) {
        showToast('🏏 ' + s.name + ' reaches ' + m + '!', 3000);
        // Push notification for milestone
        dispatchPushEvent('milestone', {
          title: '🏏 ' + s.name + ' reaches ' + m + '!',
          body:  (state.fixture ? (state.fixture.team || 'TCC') + ' vs ' + (state.fixture.opponent || 'Opponents') + ' — ' : '') +
                 state.runs + '/' + state.wickets + ' (' + state.overs + '.' + state.balls + ' ov)'
        });
      }
    });
  }

  /* Swap on an odd number of runs RUN — off the bat, or byes/leg-byes, or
     runs taken off a no-ball. Previously only bat runs off a legal ball
     rotated strike, so a single bye or a run off a no-ball left the wrong
     batter facing. */
  if (ranRunsFor(event) % 2 === 1) swapBatters();
}

function updatePlayerBar() {
  var s  = state.batting.striker;
  var ns = state.batting.nonStriker;
  var b  = state.bowling.current;
  var bar = document.getElementById('player-bar');
  var bor = document.getElementById('bowler-over-row');
  if (!s && !ns && !b) { bar.style.display = 'none'; if(bor) bor.style.display='none'; return; }
  bar.style.display = 'grid';
  if (bor) bor.style.display = 'flex';
  document.getElementById('striker-name').textContent     = s  ? s.name  : '—';
  document.getElementById('striker-runs').textContent     = s  ? s.runs  : '0';
  document.getElementById('striker-balls').textContent    = s  ? ' (' + s.balls + ')' : ' (0)';
  document.getElementById('non-striker-name').textContent = ns ? ns.name : '—';
  document.getElementById('non-striker-runs').textContent = ns ? ns.runs : '0';
  document.getElementById('non-striker-balls').textContent = ns ? ' (' + ns.balls + ')' : ' (0)';
  document.getElementById('bowler-name').textContent    = b ? b.name  : '—';
  // Long names: initials + surname, then a slightly smaller size, then "…"
  ['striker-name', 'non-striker-name', 'bowler-name'].forEach(function (id) { fitName(document.getElementById(id)); });
  document.getElementById('bowler-figures').textContent = b ? fmtBowlerFigures(b) : '0-0-0';
  var pCard = document.getElementById('partnership-card');
  if (pCard && s && ns) {
    var p = state.partnership || { runs: 0, balls: 0 };
    document.getElementById('partnership-display').innerHTML = p.runs + '<span>(' + p.balls + ')</span>';
    pCard.style.display = 'flex';
  } else if (pCard) {
    pCard.style.display = 'none';
  }
}

/* ── Opening Players Modal ── */

/* ══════════════════════════════════════════════════════
   PRE-MATCH TEAM LINEUP
   Fetch players from DB, let scorer select XI + keeper
   Store in state.lineup for stumping/catch attribution
══════════════════════════════════════════════════════ */
var _lineupMode = 'first'; // 'first' | 'second'

async function openLineupModal(mode) {
  _lineupMode = mode || 'first';
  var selectedPlayers = [];

  var dropSel  = document.getElementById('lineup-player-select');
  var searchEl = document.getElementById('lineup-search');
  var selList  = document.getElementById('lineup-selected-list');
  var countEl  = document.getElementById('lineup-count');
  var errEl    = document.getElementById('lineup-error');

  errEl.textContent = '';
  selList.innerHTML = '';
  countEl.textContent = '0';
  searchEl.value = '';
  if (dropSel) dropSel.innerHTML = '<option value="">— Select a player —</option>';
  document.getElementById('lineup-modal').style.display = 'flex';

  // Fetch players from DB
  var allPlayers = [];
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/public_players?active=not.eq.false&select=id,name,role&order=name.asc', {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    });
    allPlayers = (await r.json()) || [];
  } catch(e) { allPlayers = []; }

  function populateDropdown() {
    if (!dropSel) return;
    var taken = selectedPlayers.map(function(p){ return p.name.toLowerCase(); });
    dropSel.innerHTML = '<option value="">— Select a player —</option>';
    allPlayers.forEach(function(p) {
      if (taken.indexOf(p.name.toLowerCase()) !== -1) return;
      var opt = document.createElement('option');
      opt.value = p.id + '||' + p.name + '||' + (p.role || '');
      opt.textContent = p.name + (p.role === 'Wicketkeeper' ? ' [K]' : '');
      dropSel.appendChild(opt);
    });
  }

  function renderSelected() {
    countEl.textContent = selectedPlayers.length;
    var okBtn = document.getElementById('lineup-ok');
    if (okBtn) okBtn.disabled = selectedPlayers.length < 11;
    selList.innerHTML = selectedPlayers.map(function(p, i) {
      var keeperBtn = '<button type="button" class="lineup-keeper-btn' + (p.isKeeper ? ' active' : '') + '" data-idx="' + i + '">[K]</button>';
      var removeBtn = '<button type="button" class="lineup-remove-btn" data-idx="' + i + '">\u2715</button>';
      return '<div class="lineup-selected-row">'
        + keeperBtn
        + '<span class="lineup-sel-name">' + p.name + (p.isKeeper ? ' <span style="color:var(--gold);font-size:0.65rem">KEEPER</span>' : '') + '</span>'
        + removeBtn
        + '</div>';
    }).join('');

    selList.querySelectorAll('.lineup-keeper-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(this.dataset.idx);
        selectedPlayers.forEach(function(p, i){ p.isKeeper = (i === idx); });
        state.lineup.keeper = selectedPlayers[idx].name;
        renderSelected();
      });
    });

    selList.querySelectorAll('.lineup-remove-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(this.dataset.idx);
        selectedPlayers.splice(idx, 1);
        populateDropdown();
        renderSelected();
      });
    });
  }

  populateDropdown();

  // Dropdown add
  document.getElementById('lineup-add-btn').onclick = function() {
    var val = dropSel ? dropSel.value : '';
    if (!val) { errEl.textContent = 'Select a player from the list.'; return; }
    if (selectedPlayers.length >= 11) { errEl.textContent = '11 players already selected.'; return; }
    errEl.textContent = '';
    var parts    = val.split('||');
    var pid      = parts[0];
    var pname    = parts[1];
    var prole    = parts[2] || '';
    var isKeeper = prole.toLowerCase() === 'wicketkeeper';
    selectedPlayers.push({ name: pname, player_id: pid, isKeeper: isKeeper });
    if (isKeeper && !state.lineup.keeper) state.lineup.keeper = pname;
    if (dropSel) dropSel.value = '';
    populateDropdown();
    renderSelected();
  };

  // Freehand add
  var freehandBtn = document.getElementById('lineup-add-freehand-btn');
  if (freehandBtn) {
    freehandBtn.onclick = function() {
      var name = searchEl.value.trim();
      if (!name) return;
      if (selectedPlayers.length >= 11) { errEl.textContent = '11 players already selected.'; return; }
      if (selectedPlayers.find(function(p){ return p.name.toLowerCase() === name.toLowerCase(); })) {
        errEl.textContent = name + ' already in lineup.'; return;
      }
      errEl.textContent = '';
      selectedPlayers.push({ name: name, player_id: null, isKeeper: false });
      searchEl.value = '';
      renderSelected();
    };
  }

  // Confirm
  document.getElementById('lineup-ok').onclick = function() {
    if (selectedPlayers.length < 11) { errEl.textContent = 'Select 11 players.'; return; }
    if (!selectedPlayers.find(function(p){ return p.isKeeper; })) {
      errEl.textContent = 'Mark the wicketkeeper (tap [K] next to their name).'; return;
    }
    state.lineup.players = selectedPlayers;
    state.lineup.keeper  = selectedPlayers.find(function(p){ return p.isKeeper; }).name;

    // Auto-link names to fantasy_player_name_map
    selectedPlayers.filter(function(p){ return p.player_id; }).forEach(function(p) {
      fetch(SUPABASE_URL + '/rest/v1/fantasy_player_name_map', {
        method: 'POST',
        headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY,
                   'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ scorer_name: p.name, player_id: p.player_id })
      }).catch(function(){});
    });

    document.getElementById('lineup-modal').style.display = 'none';
    openOpeningPlayersModal();
  };
}

/* Helper: get fielding XI for the current bowling team */
function getFielderList() {
  var lineupPlayers = (state.lineup && state.lineup.players) ? state.lineup.players : [];
  return lineupPlayers.map(function(p){ return p.name; });
}

function openOpeningPlayersModal() {
  document.getElementById('input-striker').value        = '';
  document.getElementById('input-non-striker').value    = '';
  document.getElementById('input-opening-bowler').value = '';
  document.getElementById('opening-players-error').textContent = '';

  var tccBat = state.battingTeam === 'tcc';
  setNameSuggest('input-striker',        tccBat);
  setNameSuggest('input-non-striker',    tccBat);
  setNameSuggest('input-opening-bowler', !tccBat);

  // Inject lineup chips above each input
  ['input-striker-chips','input-non-striker-chips','input-opening-bowler-chips'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.remove();
  });

  var lineup = (state.lineup && state.lineup.players) ? state.lineup.players : [];
  if (lineup.length) {
    var tccIsBatting = state.battingTeam === 'tcc';
    var batterRoles  = ['batter','wicketkeeper','all-rounder','allrounder',''];
    var bowlerRoles  = ['bowler','all-rounder','allrounder',''];
    var batterList   = lineup.filter(function(p){ return batterRoles.indexOf((p.role||'').toLowerCase()) !== -1; });
    var bowlerList   = lineup.filter(function(p){ return bowlerRoles.indexOf((p.role||'').toLowerCase()) !== -1; });

    function injectChips(players, inputId, wrapId) {
      if (!players.length) return;
      var input = document.getElementById(inputId);
      if (!input) return;
      var sel = document.createElement('select');
      sel.id = wrapId;
      sel.className = 'player-input-field';
      sel.style.cssText = 'margin-bottom:6px';
      var placeholder = document.createElement('option');
      placeholder.value = ''; placeholder.textContent = '— Select from lineup —';
      sel.appendChild(placeholder);
      players.forEach(function(p) {
        var opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name + (p.isKeeper ? ' [K]' : '');
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function() {
        if (this.value) input.value = this.value;
      });
      input.parentNode.insertBefore(sel, input);
    }

    if (tccIsBatting) {
      // TCC bats: show TCC batters for striker/non-striker, NO dropdown for bowler (opposition bowls)
      injectChips(batterList, 'input-striker',     'input-striker-chips');
      injectChips(batterList, 'input-non-striker', 'input-non-striker-chips');
      // input-opening-bowler: freehand only — opposition bowler, not in our lineup
    } else {
      // TCC fields: NO dropdown for batters (opposition bats freehand), show TCC bowlers for opening bowler
      injectChips(bowlerList, 'input-opening-bowler', 'input-opening-bowler-chips');
    }
  }

  document.getElementById('opening-players-modal').style.display = 'flex';
  setTimeout(function() { document.getElementById('input-striker').focus(); }, 100);
}

document.getElementById('opening-players-ok').addEventListener('click', function() {
  var s  = document.getElementById('input-striker').value.trim();
  var ns = document.getElementById('input-non-striker').value.trim();
  var b  = document.getElementById('input-opening-bowler').value.trim();
  if (!s || !ns || !b) {
    document.getElementById('opening-players-error').textContent = 'Please enter all three names.';
    return;
  }
  rememberPlayer(state.battingTeam, s);
  rememberPlayer(state.battingTeam, ns);
  rememberPlayer(fieldingSide(), b);
  state.batting.striker    = newBatter(s);
  state.batting.nonStriker = newBatter(ns);
  var bowler = newBowler(b);
  state.bowling.bowlers = [bowler];
  state.bowling.current = state.bowling.bowlers[0]; // same reference
  document.getElementById('opening-players-modal').style.display = 'none';
  saveState();
  syncScore();
  updateScoringUI();
  updatePlayerBar();
});

/* ── New Bowler Modal ── */
function openNewBowlerModal() {
  var list = document.getElementById('bowler-select-list');
  var html = '';
  var prevId = state.bowling.current ? state.bowling.current.id : null;

  var cur = state.bowling.current;
  // The Hundred: the same bowler may deliver a second consecutive set (10 balls
  // in all). Offer that explicitly rather than excluding them.
  if (isHundred() && cur && bowlerMayContinue(cur)) {
    html += '<div class="bowler-select-divider">Same bowler continues</div>';
    html += '<button class="bowler-select-item bsi-continue" data-bowler-id="' + cur.id + '">' +
      '<span>' + esc(cur.name) + ' — bowl 2nd set</span>' +
      '<span class="bsi-figures">' + fmtBowlerFigures(cur) + '</span>' +
      '</button>';
  }
  // Previous bowlers: exclude whoever just bowled, and anyone at the limit.
  var eligible = state.bowling.bowlers.filter(function(b) {
    return b.id !== prevId && !bowlerAtCap(b);
  });
  if (eligible.length) {
    html += '<div class="bowler-select-divider">Previous bowlers</div>';
    eligible.forEach(function(b) {
      var left = bowlerAllowanceLeft(b);
      html += '<button class="bowler-select-item" data-bowler-id="' + b.id + '">' +
        '<span>' + esc(b.name) + '</span>' +
        '<span class="bsi-figures">' + fmtBowlerFigures(b) + (left ? ' \u00b7 ' + left : '') + '</span>' +
        '</button>';
    });
  }
  // Bowled out — shown, not silently missing, so the scorer isn't left hunting
  var spent = state.bowling.bowlers.filter(function (b) { return bowlerAtCap(b); });
  if (spent.length) {
    html += '<div class="bowler-select-divider">Bowled their limit</div>';
    spent.forEach(function (b) {
      html += '<div class="bowler-select-item bsi-spent" aria-disabled="true">' +
        '<span>' + esc(b.name) + '</span>' +
        '<span class="bsi-figures">' + fmtBowlerFigures(b) + '</span></div>';
    });
  }
  html += '<div class="bowler-select-divider">New bowler</div>';
  /* Anyone in the fielding side's squad who hasn't bowled yet — names captured
     while they batted are offered back when their side takes the field. */
  var squadNames = (state.squads && state.squads[fieldingSide()]) || [];
  var usedBowlers = state.bowling.bowlers.map(function(b){ return b.name; });
  var lineupBowlers2 = squadNames.filter(function(n) {
    return !usedBowlers.some(function(u){ return samePlayer(u, n); });
  });
  if (lineupBowlers2.length) {
    html += '<select class="player-input-field" id="lineup-bowler-select" style="margin-bottom:8px">';
    html += '<option value="">— Select from squad —</option>';
    lineupBowlers2.forEach(function(n) {
      html += '<option value="' + n.replace(/"/g,'&quot;') + '">' + n + '</option>';
    });
    html += '</select>';
  }
  html += '<div style="display:flex;gap:6px;align-items:center">' +
    '<input type="text" class="player-input-field" id="input-new-bowler-name" placeholder="Or type name" autocomplete="off" style="margin-bottom:0;flex:1">' +
    '<button class="modal-confirm-btn" id="new-bowler-enter-btn" style="flex-shrink:0;padding:12px 14px">Add</button>' +
    '</div>';

  list.innerHTML = html;
  document.getElementById('new-bowler-error').textContent = '';
  document.getElementById('new-bowler-cancel-wrap').style.display = 'none';
  document.getElementById('new-bowler-modal').style.display = 'flex';

  // Bind existing bowler buttons
  list.querySelectorAll('.bowler-select-item').forEach(function(btn) {
    btn.addEventListener('click', function() {
      selectBowlerById(parseInt(this.dataset.bowlerId));
    });
  });
  // Lineup dropdown — selecting fills the name input
  var lineupSelEl = document.getElementById('lineup-bowler-select');
  if (lineupSelEl) {
    lineupSelEl.addEventListener('change', function() {
      if (this.value) document.getElementById('input-new-bowler-name').value = this.value;
    });
  }

  // Bind new bowler entry
  document.getElementById('new-bowler-enter-btn').addEventListener('click', function() {
    var name = document.getElementById('input-new-bowler-name').value.trim();
    if (!name) { document.getElementById('new-bowler-error').textContent = 'Enter a name.'; return; }
    rememberPlayer(fieldingSide(), name);

    // Find all bowlers with this name (case-insensitive)
    var matches = state.bowling.bowlers.filter(function(b) { return b.name.toLowerCase() === name.toLowerCase(); });

    // Check consecutive over restriction
    var prevBowler = state.bowling.current;
    var isConsecutive = prevBowler && matches.some(function(b) { return b.id === prevBowler.id; });
    if (isConsecutive && matches.length === 1 && !bowlerMayContinue(prevBowler)) {
      document.getElementById('new-bowler-error').textContent = isHundred()
        ? 'This bowler has finished their spell — choose someone else.'
        : 'This bowler just bowled — choose someone else.';
      return;
    }

    if (matches.length === 0) {
      // Brand new bowler — add them
      var created = newBowler(name);
      state.bowling.bowlers.push(created);
      selectBowlerById(created.id);
    } else if (matches.length === 1 && matches[0].id !== (prevBowler ? prevBowler.id : -1)) {
      // One match, not consecutive — use existing
      selectBowlerById(matches[0].id);
    } else {
      // Multiple matches OR name matches prev — show disambiguation
      showBowlerDisambiguation(name, matches, prevBowler ? prevBowler.id : -1);
    }
  });

  setNameSuggest('input-new-bowler-name', state.battingTeam === 'opp');
  document.getElementById('input-new-bowler-name').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('new-bowler-enter-btn').click();
  });
}

function selectBowlerById(id) {
  var bowler = state.bowling.bowlers.find(function(b) { return b.id === id; });
  if (!bowler) return;
  if (bowlerAtCap(bowler) &&
      (!state.bowling.current || state.bowling.current.id !== bowler.id)) {
    showToast(bowler.name + ' has bowled their ' +
      (isHundred() ? fmt().maxBallsPerBowler + ' balls' : bowlerOverLimit() + ' overs') + ' — the limit', 2800);
    return;
  }
  // A different bowler starts a fresh spell; the same bowler continues theirs.
  if (!state.bowling.current || state.bowling.current.id !== bowler.id) {
    state.bowling.consecutiveSets = 0;
  }

  if (_midOverChangeMode === 'correct') {
    // Wrong selection — reassign all balls in current over to new bowler
    state.currentOverBalls.forEach(function(b) {
      b.bowler   = bowler.name;
      b.bowlerId = bowler.id;
    });
    // Recalculate so old bowler loses these balls and new bowler gains them
    recalculateBowlerStats();
  }
  // For 'split', balls already recorded keep their original bowlerId — nothing to change

  _midOverChangeMode = 'correct'; // reset
  state.bowling.current = bowler;
  document.getElementById('new-bowler-modal').style.display = 'none';
  saveState(); syncScore(); updateScoringUI(); updatePlayerBar();
}

function selectBowler(name) {
  var bowler = state.bowling.bowlers.find(function(b) { return b.name === name; });
  if (!bowler) return;
  state.bowling.current = bowler; // points to same array object
  document.getElementById('new-bowler-modal').style.display = 'none';
  saveState();
  syncScore();
  updateScoringUI();
  updatePlayerBar();
}

/* ── Wicket Modal ── */
var _pendingWicketEvent = null;
/* True between tapping W and confirming the dismissal. While it is set,
   recordBall() holds back the end-of-innings and end-of-over checks: the
   innings must not end — and the batting card must not be snapshotted —
   before we know who was out and how. */
var _wicketDetailsPending = false;
/* ── Dismissal credit ────────────────────────────────────────────────
   Only these go on the bowler's figures. A run out, a retirement or an
   obstruction is the fielding side's wicket, not the bowler's — and a
   Retired Hurt is not a wicket at all, since the batter may return. */
var BOWLER_CREDITED = ['Bowled', 'Caught', 'Caught & Bowled', 'LBW', 'Stumped', 'Hit Wicket'];
/* Names are typed by hand, so "J Adams", "J. Adams" and "j  adams" must all be
   treated as the same player — otherwise a returning retired-hurt batter is
   created fresh and loses their runs. */
function samePlayer(a, b) {
  var norm = function (s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[.,'']/g, '').replace(/\s+/g, ' ').trim();
  };
  return norm(a) !== '' && norm(a) === norm(b);
}
function creditsBowler(how) { return BOWLER_CREDITED.indexOf(how) !== -1; }
function countsAsWicket(how) { return how !== 'Retired Hurt'; }

/* ── Squad memory ─────────────────────────────────────────────────────── */
function fieldingSide()  { return state.battingTeam === 'tcc' ? 'opp' : 'tcc'; }
function squadKeyOpp()   {
  var fx = state.fixture || {};
  return String(fx.opponent || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function squadTeamName() {
  var fx = state.fixture || {};
  return String(fx.team || '').trim();
}
/* Remember a name against a side, ignoring duplicates and punctuation drift. */
function rememberPlayer(side, name) {
  var n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (!n) return;
  if (!state.squads) state.squads = { tcc: [], opp: [] };
  var list = state.squads[side] || (state.squads[side] = []);
  if (!list.some(function (x) { return samePlayer(x, n); })) list.push(n);
}
async function loadSquads() {
  try {
    var res = await workerCall('squad.get', {
      tccTeam: squadTeamName(), opponentKey: squadKeyOpp()
    });
    if (res && (Array.isArray(res.tcc) || Array.isArray(res.opp))) {
      state.squads = { tcc: res.tcc || [], opp: res.opp || [] };
    }
  } catch (e) { /* offline or first meeting — carry on with an empty squad */ }
}
async function saveSquads() {
  var team = squadTeamName(), opp = squadKeyOpp();
  try {
    if ((state.squads.tcc || []).length) {
      await workerCall('squad.save', { side: 'tcc', tccTeam: team, players: state.squads.tcc });
    }
    if ((state.squads.opp || []).length && opp) {
      await workerCall('squad.save', { side: 'opp', tccTeam: team, opponentKey: opp, players: state.squads.opp });
    }
  } catch (e) { /* never block the match on this */ }
}
/* Names still available to bat for the side currently in. */
function availableBatters() {
  var squad = (state.squads && state.squads[state.battingTeam]) || [];
  var used  = [];
  if (state.batting.striker)    used.push(state.batting.striker.name);
  if (state.batting.nonStriker) used.push(state.batting.nonStriker.name);
  (state.batting.dismissed || []).forEach(function (d) { used.push(d.name); });
  (state.batting.retiredHurt || []).forEach(function (r) { used.push(r.name); });
  return squad.filter(function (n) {
    return !used.some(function (u) { return samePlayer(u, n); });
  });
}

var _selectedDismissal  = null;
/* 'striker' | 'nonStriker'. A run out can dismiss either end; everything
   else can only be the batter who faced the ball. */
var _wicketWho = 'striker';
/* Either batter can be run out or obstruct the field; every other mode is the striker. */
function canDismissNonStriker(how) { return how === 'Run Out' || how === 'Obstructing the Field'; }
function outBatter() { return state.batting[_wicketWho] || state.batting.striker; }

/* ── Wickets with running ────────────────────────────────────────────── */
var _wkRuns = 0, _wkType = 'bat', _wkNext = null;   // null = the natural default
function wicketRunMode(how) {
  if (how === 'Run Out' || how === 'Obstructing the Field') return 'run';   // runs, any ball
  if (how === 'Stumped') return 'stumped';                                  // legal ball or wide
  return null;
}
/* The delivery exactly as it happened. */
function buildWicketEvent() {
  var how = _selectedDismissal, mode = wicketRunMode(how);
  var c = mode === 'run' ? _wkRuns : 0;
  var t = mode ? _wkType : 'bat';
  if (mode === 'stumped' && t !== 'wide') t = 'bat';
  var ev;
  if (t === 'wide')        ev = { type: 'extra', extra: 'wide',   runs: widePen() + c, displayRuns: c };
  else if (t === 'noball') ev = { type: 'extra', extra: 'noball', runs: nbPen() + c, displayRuns: c };
  else if (t === 'bye' || t === 'legbye') ev = { type: 'extra', extra: t, runs: c, displayRuns: c };
  else                     ev = { type: 'wicket', runs: c };
  ev.wicket = true;
  if (how) ev.how = how;
  return ev;
}
function _isLegal(ev) { return !(ev.extra === 'wide' || ev.extra === 'noball'); }
/* Law 16: a match ends the moment the winning run is completed. If the
   batters complete it and one is then run out going for another, that run
   out never happened — the ball is just the winning runs. */
function winCompletedFirst(ev) {
  return state.innings === 2 && state.target !== null && state.target !== undefined &&
         (ev.runs || 0) > 0 && state.runs + (ev.runs || 0) >= state.target;
}
/* Would the innings be over once this ball is in? (Nothing is changed.) */
function wouldEndWith(ev, how) {
  var save = { runs: state.runs, wickets: state.wickets, balls: state.balls };
  state.runs += ev.runs || 0;
  if (countsAsWicket(how || 'Bowled')) state.wickets++;
  if (_isLegal(ev)) state.balls++;
  try { return inningsWillEnd(); }
  finally { state.runs = save.runs; state.wickets = save.wickets; state.balls = save.balls; }
}
/* Does this ball finish the set AND change the batters' ends? */
function setWillChangeEnds(ev) {
  if (!_isLegal(ev) || (state.balls + 1) < ballsPerSet()) return false;
  return (((state.overs + 1) * ballsPerSet()) % fmt().endChangeBalls) === 0;
}
/* Who faces the next ball if the scorer changes nothing: the new batter takes
   the dismissed batter's end, after the ends the running left them at. */
function defaultNextFacer(ev, outIsStriker) {
  var outAtStriker = outIsStriker;
  if (ranRunsFor(ev) % 2 === 1) outAtStriker = !outAtStriker;
  var next = outAtStriker ? 'new' : 'survivor';
  if (setWillChangeEnds(ev)) next = next === 'new' ? 'survivor' : 'new';
  return next;
}
/* Show/hide the running sections and the new-batter box for the current
   choices. Called whenever anything on the wicket screen changes. */
function refreshWicketExtras() {
  var how  = _selectedDismissal, mode = wicketRunMode(how);
  var sec  = document.getElementById('wicket-run-section');
  sec.style.display = mode ? 'block' : 'none';
  document.getElementById('wicket-runs-wrap').style.display = mode === 'run' ? 'block' : 'none';
  if (mode !== 'run') _wkRuns = 0;
  if (mode === 'stumped' && _wkType !== 'wide') _wkType = 'bat';
  document.querySelectorAll('#wicket-type-chips .wk-chip').forEach(function (b) {
    var t = b.dataset.type;
    b.style.display = (mode === 'stumped' && t !== 'bat' && t !== 'wide') ? 'none' : '';
    if (t === 'bat') b.textContent = mode === 'stumped' ? 'Legal ball' : 'Off the bat';
    b.classList.toggle('selected', t === _wkType);
  });
  document.querySelectorAll('#wicket-runs-chips .wk-chip').forEach(function (b) {
    b.classList.toggle('selected', +b.dataset.runs === _wkRuns);
  });

  var ev   = buildWicketEvent();
  var ends = wouldEndWith(ev, how || 'Bowled');
  // No new batter when this wicket ends the innings
  ['new-batter-label', 'input-new-batter', 'next-batter-chips'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.style.display = ends ? 'none' : '';
  });
  var rh = document.getElementById('retired-hurt-list');
  if (rh) rh.style.display = (!ends && (state.batting.retiredHurt || []).length) ? 'block' : 'none';

  var winFirst = mode === 'run' && winCompletedFirst(ev);
  document.getElementById('wicket-win-note').style.display = winFirst ? 'block' : 'none';
  var sw = document.getElementById('wicket-strike-wrap');
  var showStrike = mode === 'run' && !ends;
  sw.style.display = showStrike ? 'block' : 'none';
  if (showStrike) {
    var outIsStriker = !(_wicketWho === 'nonStriker' && state.batting.nonStriker);
    var survivor = outIsStriker ? state.batting.nonStriker : state.batting.striker;
    document.getElementById('wicket-next-survivor').textContent = survivor ? survivor.name : 'Not-out batter';
    var pick = _wkNext || defaultNextFacer(ev, outIsStriker);
    document.querySelectorAll('#wicket-strike-chips .wk-chip').forEach(function (b) {
      b.classList.toggle('selected', b.dataset.next === pick);
    });
  }
}
document.querySelectorAll('#wicket-runs-chips .wk-chip').forEach(function (b) {
  b.addEventListener('click', function () { _wkRuns = +this.dataset.runs; _wkNext = null; refreshWicketExtras(); });
});
document.querySelectorAll('#wicket-type-chips .wk-chip').forEach(function (b) {
  b.addEventListener('click', function () { _wkType = this.dataset.type; _wkNext = null; refreshWicketExtras(); });
});
document.querySelectorAll('#wicket-strike-chips .wk-chip').forEach(function (b) {
  b.addEventListener('click', function () { _wkNext = this.dataset.next; refreshWicketExtras(); });
});

function openWicketModal(event) {
  _pendingWicketEvent = event;
  _selectedDismissal  = null;
  _wicketWho = 'striker';
  _wkRuns = 0; _wkType = 'bat'; _wkNext = null;
  var name = state.batting.striker ? state.batting.striker.name : 'Batter';
  document.getElementById('wicket-batter-name').textContent = name;
  /* Hidden until Run Out is picked; only end that can differ. */
  document.getElementById('wicket-who-section').style.display = 'none';
  document.querySelectorAll('.wicket-who-btn').forEach(function (b) {
    b.classList.toggle('selected', b.dataset.who === 'striker');
  });
  var wsEl = document.getElementById('wicket-who-striker');
  var wnEl = document.getElementById('wicket-who-nonstriker');
  if (wsEl) wsEl.textContent = name;
  if (wnEl) wnEl.textContent = state.batting.nonStriker ? state.batting.nonStriker.name : '\u2014';
  document.getElementById('input-new-batter').value = '';
  document.getElementById('wicket-error').textContent = '';
  document.querySelectorAll('.dismissal-btn').forEach(function(b) { b.classList.remove('selected'); });
  document.getElementById('fielder-section').style.display = 'none';
  document.getElementById('input-fielder').value = '';
  setNameSuggest('input-new-batter', state.battingTeam === 'tcc');
  setNameSuggest('input-fielder',    state.battingTeam === 'opp');
  // Show retired hurt re-entry options
  var rhList = document.getElementById('retired-hurt-list');
  var retired = state.batting.retiredHurt || [];
  if (retired.length) {
    rhList.style.display = 'block';
    rhList.innerHTML = '<div style="font-size:0.65rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:6px">Retired Hurt — can re-enter</div>' +
      retired.map(function(b) {
        return '<button class="bowler-select-item retired-reentry-btn" data-name="' + b.name.replace(/"/g, '&quot;') + '">' +
          '<span>' + b.name + '</span><span class="bsi-figures">' + b.runs + ' (' + b.balls + ')</span></button>';
      }).join('');
    // Bind click handlers
    rhList.querySelectorAll('.retired-reentry-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { selectRetiredBatter(this.dataset.name); });
    });
  } else {
    rhList.style.display = 'none';
  }
  // No new batter when this wicket ends the innings (all out, or the last ball)
  // Nothing is recorded yet — judge as if this ball were a plain wicket
  var lastWicket = wouldEndWith(buildWicketEvent(), 'Bowled');
  document.getElementById('new-batter-label').style.display = lastWicket ? 'none' : 'block';
  document.getElementById('input-new-batter').style.display = lastWicket ? 'none' : 'block';
  document.getElementById('retired-hurt-list').style.display = (retired.length && !lastWicket) ? 'block' : 'none';

  // Remaining lineup batters as chips
  var nbChips = document.getElementById('next-batter-chips');
  if (nbChips) nbChips.remove();
  /* Was gated on state.lineup.players, which has been empty since the XI
     picker was removed — so this never rendered. Now driven by the squad,
     and for whichever side is batting rather than TCC only. */
  {  // always built; refreshWicketExtras() shows it only when someone is coming in
    var remaining2 = availableBatters().map(function (n) { return { name: n }; });
    if (remaining2.length) {
      var nbSel = document.createElement('select');
      nbSel.id = 'next-batter-chips';
      nbSel.className = 'player-input-field';
      nbSel.style.cssText = 'margin-bottom:6px';
      var nbPlaceholder = document.createElement('option');
      nbPlaceholder.value = ''; nbPlaceholder.textContent = '— Select from squad —';
      nbSel.appendChild(nbPlaceholder);
      remaining2.forEach(function(p) {
        var opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        nbSel.appendChild(opt);
      });
      nbSel.addEventListener('change', function() {
        if (this.value) document.getElementById('input-new-batter').value = this.value;
      });
      var nbInput = document.getElementById('input-new-batter');
      nbInput.parentNode.insertBefore(nbSel, nbInput);
    }
  }

  refreshWicketExtras();
  document.getElementById('wicket-modal').style.display = 'flex';
}

document.querySelectorAll('.dismissal-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    /* The which-end buttons and the retire modal's buttons share this class
       but carry no data-how — without this they would clear the dismissal. */
    if (!this.dataset.how) return;
    document.querySelectorAll('.dismissal-btn:not(.wicket-who-btn)').forEach(function(b) { b.classList.remove('selected'); });
    this.classList.add('selected');
    _selectedDismissal = this.dataset.how;

    /* Only a run out can be the non-striker. Picking anything else resets
       the choice, so a mis-tap can't leave the wrong batter selected. */
    var whoSec = document.getElementById('wicket-who-section');
    var canPickEnd = canDismissNonStriker(_selectedDismissal) && !!state.batting.nonStriker;
    whoSec.style.display = canPickEnd ? 'block' : 'none';
    if (!canPickEnd) {
      _wicketWho = 'striker';
      document.querySelectorAll('.wicket-who-btn').forEach(function (b) {
        b.classList.toggle('selected', b.dataset.who === 'striker');
      });
    }
    refreshWicketWho();
    _wkNext = null;
    refreshWicketExtras();

    // Show fielder section for Caught, Run Out, Stumped
    var fielderSec  = document.getElementById('fielder-section');
    var fielderLabel= document.getElementById('fielder-label');
    var fielderList = document.getElementById('fielder-select-list');
    var fielderInput= document.getElementById('input-fielder');
    var how = this.dataset.how;

    // Only show fielder attribution when TCC is fielding (opp is batting)
    // When TCC is batting, the fielder is an opponent — not in our lineup, not tracked
    var tccIsFielding = state.battingTeam === 'opp';

    if ((how === 'Caught' || how === 'Run Out' || how === 'Stumped') && tccIsFielding) {
      fielderSec.style.display = 'block';
      var fielders = getFielderList();
      var isStumped = how === 'Stumped';
      fielderLabel.textContent = isStumped ? 'Keeper (stumped by)' : 'Fielder (caught/run out by)';

      // Build dropdown — only when a lineup exists (manual-entry
      // matches have none; the freehand input below is the path)
      fielderList.innerHTML = '';
      var fSel = null;
      var fieldersFiltered = fielders.filter(function(n){ var o = outBatter(); return o ? n !== o.name : true; });
      if (fieldersFiltered.length) {
        fSel = document.createElement('select');
        fSel.className = 'player-input-field';
        fSel.style.marginBottom = '6px';
        var fPlaceholder = document.createElement('option');
        fPlaceholder.value = ''; fPlaceholder.textContent = '— Select fielder —';
        fSel.appendChild(fPlaceholder);
        fieldersFiltered.forEach(function(n) {
          var opt = document.createElement('option');
          opt.value = n;
          opt.textContent = n + (state.lineup && state.lineup.keeper === n ? ' [K]' : '');
          fSel.appendChild(opt);
        });
        fSel.addEventListener('change', function() { if (this.value) fielderInput.value = this.value; });
        fielderList.appendChild(fSel);
      }

      // Pre-fill keeper for stumpings
      if (isStumped && state.lineup && state.lineup.keeper) {
        if (fSel) fSel.value = state.lineup.keeper;
        fielderInput.value = state.lineup.keeper;
      } else {
        fielderInput.value = '';
      }
    } else {
      fielderSec.style.display = 'none';
      fielderInput.value = '';
    }
  });
});

function selectRetiredBatter(name) {
  document.getElementById('input-new-batter').value = name;
  // Remove from retired hurt list
  state.batting.retiredHurt = (state.batting.retiredHurt || []).filter(function(b) { return !samePlayer(b.name, name); });
}

/* Keeps the labels and the new-batter list in step with which end is out. */
function refreshWicketWho() {
  var out = outBatter();
  var label = document.getElementById('wicket-batter-label');
  if (label && out) {
    label.innerHTML = 'How was <strong id="wicket-batter-name">' + esc(out.name) + '</strong> out?';
  }
  var nb = document.getElementById('new-batter-label');
  if (nb) {
    nb.textContent = _wicketWho === 'nonStriker'
      ? 'New batter (comes in at the non-striker\'s end)'
      : 'New batter';
  }
}

document.querySelectorAll('.wicket-who-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    if (this.dataset.who === 'nonStriker' && !state.batting.nonStriker) return;
    document.querySelectorAll('.wicket-who-btn').forEach(function (b) { b.classList.remove('selected'); });
    this.classList.add('selected');
    _wicketWho = this.dataset.who;
    refreshWicketWho();
    _wkNext = null;
    refreshWicketExtras();
  });
});

document.getElementById('wicket-ok').addEventListener('click', function() {
  if (!_selectedDismissal) {
    document.getElementById('wicket-error').textContent = 'Select how the batter was out.';
    return;
  }
  var newName = document.getElementById('input-new-batter').value.trim();
  var wkEvent  = buildWicketEvent();
  if (wicketRunMode(_selectedDismissal) === 'run' && winCompletedFirst(wkEvent)) {
    // The match was won before the run out — record the runs, not a wicket
    delete wkEvent.how; wkEvent.wicket = false;
    if (wkEvent.type === 'wicket') wkEvent.type = 'run';
    document.getElementById('wicket-modal').style.display = 'none';
    _selectedDismissal = null; _pendingWicketEvent = null;
    _origRecordBall(wkEvent);   // not pending, so the chase ends as normal
    return;
  }
  /* Decide with this ball applied (its runs, and Retired Hurt not being a
     wicket) — nothing is recorded until every check has passed. */
  var endsInnings = wouldEndWith(wkEvent, _selectedDismissal);
  if (!newName && !endsInnings) {
    document.getElementById('new-batter-label').style.display = 'block';
    document.getElementById('input-new-batter').style.display = 'block';
    document.getElementById('wicket-error').textContent = 'Enter the new batter name.';
    return;
  }
  var outIsStriker = !(_wicketWho === 'nonStriker' && state.batting.nonStriker);
  var outPlayer    = outIsStriker ? state.batting.striker : state.batting.nonStriker;
  var nextFacer    = (wicketRunMode(_selectedDismissal) === 'run' && !endsInnings)
                     ? (_wkNext || defaultNextFacer(wkEvent, outIsStriker)) : null;
  var endsChange   = setWillChangeEnds(wkEvent);

  /* Record the delivery as it happened. The end-of-innings checks wait until
     the dismissal is written (see _wicketDetailsPending). */
  _wicketDetailsPending = true;
  _pendingWicketEvent   = wkEvent;
  _origRecordBall(wkEvent);
  /* Odd runs swapped the batters' ends while the ball was recorded, so find
     the dismissed batter by who he is, not by which end he started at. */
  _wicketWho = state.batting.striker === outPlayer ? 'striker' : 'nonStriker';

  /* The ball went in with its dismissal type, so the bowler's credit is
     already right. Retired Hurt is not a wicket: take it back off the team. */
  (function reconcileWicket() {
    var how = _selectedDismissal;
    var lastBall = state.currentOverBalls[state.currentOverBalls.length - 1];
    if (lastBall && lastBall.wicket) lastBall.how = how;
    if (!countsAsWicket(how)) {
      if (state.wickets > 0) state.wickets--;
      if (lastBall) { lastBall.wicket = false; lastBall.retiredHurt = true; }
    }
  })();

  /* Everything undo needs to put this wicket back, stamped onto the ball
     itself. Undo used to decrement the wicket count and nothing else: the
     dismissed batter stayed dismissed, the replacement stayed at the crease,
     and the ball's runs came off the replacement instead of the batter who
     actually faced it. */
  var _undo = {
    outEnd: null, outBatter: null, how: _selectedDismissal,
    partnership: state.partnership ? { runs: state.partnership.runs, balls: state.partnership.balls } : null,
    incoming: null, incomingWasRetired: false
  };

  // Record dismissal — the striker unless a run out at the other end
  if (outBatter()) {
    var out = outBatter();
    _undo.outEnd = (_wicketWho === 'nonStriker' && state.batting.nonStriker) ? 'nonStriker' : 'striker';
    _undo.outBatter = JSON.parse(JSON.stringify(out));
    // The batter who stays in — undo finds him by name, not by end
    var _other = state.batting[_undo.outEnd === 'striker' ? 'nonStriker' : 'striker'];
    _undo.survivor = _other && _other.name ? _other.name : null;
    var bowlerName = state.bowling.current ? state.bowling.current.name : null;
    if (_selectedDismissal === 'Retired Hurt') {
      // Move to retiredHurt — can re-enter later
      if (!state.batting.retiredHurt) state.batting.retiredHurt = [];
      state.batting.retiredHurt.push({ order: out.order, name: out.name, runs: out.runs, balls: out.balls, fours: out.fours || 0, sixes: out.sixes || 0 });
    } else {
      var fielderName = (document.getElementById('input-fielder').value || '').trim() || null;
      if (!Array.isArray(state.batting.dismissed)) state.batting.dismissed = [];
      state.batting.dismissed.push({
        order:   out.order,
        name:    out.name,
        runs:    out.runs,
        balls:   out.balls,
        fours:   out.fours || 0,
        sixes:   out.sixes || 0,
        how:     _selectedDismissal,
        bowler:  bowlerName,
        fielder: fielderName
      });
    }
    // Reset partnership
    state.partnership = { runs: 0, balls: 0 };

    /* Retired hurt is not a fall of wicket: no wicket has fallen and the
       batter may come back. It was being written into the fall-of-wickets
       list all the same. */
    if (!state.batting.fow) state.batting.fow = [];
    if (countsAsWicket(_selectedDismissal)) state.batting.fow.push({
      wicket: state.wickets,  // already incremented by recordBall
      score:  state.runs,
      overs:  fmtOvers(state.overs, state.balls),
      batter: out.name
    });
  }

  if (newName && !endsInnings) rememberPlayer(state.battingTeam, newName);
  var fielderIn = (document.getElementById('input-fielder').value || '').trim();
  if (fielderIn) rememberPlayer(fieldingSide(), fielderIn);

  // New batter comes in — check if returning retired hurt batter
  var retiredMatch = (state.batting.retiredHurt || []).find(function(b) { return samePlayer(b.name, newName); });
  /* Replaces the end that was out: after a non-striker run out the batter who
     faced the ball keeps the strike, and the new batter comes in at the
     non-striker's end. */
  var outEnd = _wicketWho === 'nonStriker' && state.batting.nonStriker ? 'nonStriker' : 'striker';
  if (endsInnings) {
    // Last wicket of the innings — nobody comes in. The batter stays off the
    // crease so the card shows the survivor as the only one not out.
    state.batting[outEnd] = null;
    retiredMatch = null;
  } else if (retiredMatch) {
    state.batting[outEnd] = retiredMatch;
    state.batting.retiredHurt = state.batting.retiredHurt.filter(function(b) { return !samePlayer(b.name, newName); });
    _undo.incomingWasRetired = true;
    _undo.incoming = JSON.parse(JSON.stringify(retiredMatch));
  } else {
    state.batting[outEnd] = newBatter(newName);
    _undo.incoming = { name: newName };
  }
  /* Who faces next. The scorer chose it (it depends on which end the wicket
     was broken at, which the app can't see). If this ball also ends the set
     with a change of ends, that swap is still to come — allow for it. */
  if (nextFacer && state.batting[outEnd]) {
    var newAtStriker = state.batting.striker === state.batting[outEnd];
    var want = endsChange ? (nextFacer === 'new' ? 'survivor' : 'new') : nextFacer;
    if ((want === 'new') !== newAtStriker) { swapBatters(); _undo.strikeSwapped = true; }
  }
  _wicketWho = 'striker';

  /* The ball in currentOverBalls is the same object, so this rides along
     with it and survives a save/resume. */
  if (_pendingWicketEvent) _pendingWicketEvent._undo = _undo;

  document.getElementById('wicket-modal').style.display = 'none';
  _pendingWicketEvent = null;

  // Push notification — all fields now known
  if (out) {
    var fx = state.fixture || {};
    var matchup = fx.team ? fx.team + ' vs ' + (fx.opponent || 'Opponents') : null;
    // Dismissal description: "b Rogers", "c & b Smith", "lbw b Jones", "run out" etc.
    var howShort = dismissalText({ how: _selectedDismissal, bowler: bowlerName,
                                   fielder: (document.getElementById('input-fielder').value || '').trim() || null });

    dispatchPushEvent('wicket', {
      title: '💥 ' + out.name + ' ' + howShort + ' ' + out.runs + ' (' + out.balls + ')',
      body:  (matchup ? matchup + '  ' : '') +
             state.runs + '/' + state.wickets +
             ' (' + fmtOvers(state.overs, state.balls) + ')'
    });
  }

  _selectedDismissal  = null;
  saveState();
  syncScore();
  updatePlayerBar();

  // Now the dismissal is on the card, let the innings end / the over close
  if (_wicketDetailsPending) {
    _wicketDetailsPending = false;
    afterBallChecks();
  }
});

/* ── Scorecard builder ── */
function buildScorecardHTML() {
  var html = '';
  html += '<div class="scorecard-row"><span class="scorecard-label">Score</span><span class="scorecard-val">' + state.runs + '/' + state.wickets + '</span></div>';
  html += '<div class="scorecard-row"><span class="scorecard-label">Overs</span><span class="scorecard-val">' + fmtOvers(state.overs, state.balls) + '</span></div>';
  if (state.target) html += '<div class="scorecard-row"><span class="scorecard-label">Target</span><span class="scorecard-val">' + state.target + '</span></div>';
  var penStr = (state.extras.penalty||0) > 0 ? ' P:' + state.extras.penalty : '';
html += '<div class="scorecard-row"><span class="scorecard-label">Extras</span><span class="scorecard-val">W:' + state.extras.wides + ' NB:' + state.extras.noballs + ' B:' + state.extras.byes + ' LB:' + state.extras.legbyes + penStr + '</span></div>';

  // Fall of wickets
  var fow = state.batting.fow || [];
  if (fow.length) {
    html += '<div class="scorecard-row" style="flex-direction:column;align-items:flex-start"><span class="scorecard-label">Fall of Wickets</span>';
    html += '<span style="font-size:0.72rem;color:var(--muted);line-height:1.8;margin-top:4px">';
    fow.forEach(function(f) {
      html += f.score + '-' + f.wicket + ' (' + esc(f.batter) + ', ' + fowOvers(f.overs) + ')&nbsp; ';
    });
    html += '</span></div>';
  }

  // Batting scorecard
  if (state.batting.dismissed.length || state.batting.striker) {
    html += '<div class="sc-section-title">Batting</div>';
    battingCard(state.batting).forEach(function(row) {
      var b   = row.bat;
      var how = dismissalText(row);
      html += '<div class="sc-batting-row">' +
        '<div class="sc-name">' + b.name + '<br><span class="sc-how">' + how + '</span></div>' +
        '<div class="sc-num">' + b.runs + '</div>' +
        '<div class="sc-muted">(' + b.balls + ')</div>' +
        '</div>';
    });
  }

  // Bowling scorecard
  if (state.bowling.bowlers.length) {
    html += '<div class="sc-section-title">Bowling</div>';
    state.bowling.bowlers.forEach(function(b) {
      var ov = b.overs + (b.balls > 0 ? '.' + b.balls : '');
      html += '<div class="sc-bowling-row">' +
        '<div class="sc-name">' + b.name + '</div>' +
        '<div class="sc-muted">' + ov + '</div>' +
        '<div class="sc-muted">' + (b.maidens || 0) + '</div>' +
        '<div class="sc-muted">' + b.runs + '</div>' +
        '<div class="sc-num">' + b.wickets + '</div>' +
        '</div>';
    });
  }
  return html;
}

// Wire inline W button to trigger wicket
document.getElementById('wicket-btn-inline').addEventListener('click', function() {
  document.getElementById('wicket-btn').click();
});

/* ── Hook wicket modal into recordBall ── */
// Override recordBall to intercept wickets for player name capture
var _origRecordBall = recordBall;
recordBall = function(event) {
  if (event.type === 'wicket' && state.batting.striker && !state.awaitingOverConfirm) {
    /* Nothing is recorded yet. A wicket ball is not always "0 runs off a
       legal ball": the batters may have completed runs first, or it may be a
       wide, a no-ball, a bye. The wicket screen asks, and Confirm records the
       ball as it actually happened (see wicket-ok). */
    openWicketModal(event);
  } else {
    // Includes a W tapped while the end-of-over prompt is up: recordBall
    // refuses it, and no wicket modal should open for a ball that wasn't recorded.
    _origRecordBall(event);
  }
};

/* ── Hook updateScoringUI to also update player bar ── */
var _origUpdateScoringUI = updateScoringUI;
updateScoringUI = function() {
  _origUpdateScoringUI.apply(this, arguments);
  updatePlayerBar();
};

/* ══════════════════════════════════════════════════════
   BOWLER DISAMBIGUATION
══════════════════════════════════════════════════════ */

function showBowlerDisambiguation(name, matches, prevId) {
  document.getElementById('new-bowler-modal').style.display = 'none';
  var desc = document.getElementById('disambig-desc');
  desc.textContent = 'Multiple players named "' + name + '" exist. Select the correct one or add as a new player.';
  var list = document.getElementById('disambig-list');
  var html = '';
  matches.forEach(function(b) {
    var isConsec = b.id === prevId;
    html += '<button class="bowler-select-item' + (isConsec ? ' disabled" disabled' : '"') +
      '" data-bowler-id="' + b.id + '">' +
      '<span>' + b.name + '</span>' +
      '<span class="bsi-figures">' + fmtBowlerFigures(b) + (isConsec ? ' · just bowled' : '') + '</span>' +
      '</button>';
  });
  html += '<button class="bowler-select-item" data-bowler-id="new">' +
    '<span>Add as new player</span>' +
    '<span class="bsi-figures">New entry</span>' +
    '</button>';
  list.innerHTML = html;
  document.getElementById('disambig-error').textContent = '';
  document.getElementById('bowler-disambig-modal').style.display = 'flex';

  list.querySelectorAll('.bowler-select-item:not([disabled])').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var bid = this.dataset.bowlerId;
      document.getElementById('bowler-disambig-modal').style.display = 'none';
      if (bid === 'new') {
        var created = newBowler(name);
        state.bowling.bowlers.push(created);
        selectBowlerById(created.id);
      } else {
        selectBowlerById(parseInt(bid));
      }
    });
  });
}

document.getElementById('disambig-cancel').addEventListener('click', function() {
  document.getElementById('bowler-disambig-modal').style.display = 'none';
  document.getElementById('new-bowler-modal').style.display = 'flex';
});

/* ══════════════════════════════════════════════════════
   MID-OVER BOWLER CHANGE
══════════════════════════════════════════════════════ */

// Allow tapping the bowler card to change bowler mid-over
document.getElementById('bowler-card').addEventListener('click', function() {
  if (!state.bowling.current) return;
  // If no balls bowled yet this over, no need to ask — just open bowler select
  if (!state.currentOverBalls.length) {
    _midOverChangeMode = 'correct';
    openMidOverBowlerModal();
    return;
  }
  document.getElementById('bowler-change-reason-modal').style.display = 'flex';
});

var _midOverChangeMode = 'correct'; // 'correct' | 'split'

document.getElementById('bcr-wrong-btn').addEventListener('click', function() {
  document.getElementById('bowler-change-reason-modal').style.display = 'none';
  _midOverChangeMode = 'correct';
  openMidOverBowlerModal();
});

document.getElementById('bcr-split-btn').addEventListener('click', function() {
  document.getElementById('bowler-change-reason-modal').style.display = 'none';
  _midOverChangeMode = 'split';
  openMidOverBowlerModal();
});

document.getElementById('bcr-cancel-btn').addEventListener('click', function() {
  document.getElementById('bowler-change-reason-modal').style.display = 'none';
});

function openMidOverBowlerModal() {
  // Reuse the same bowler modal but don't exclude current bowler
  // (mid-over change allows re-selecting same bowler, just correcting)
  var list = document.getElementById('bowler-select-list');
  var html = '';
  var prevId = state.bowling.current ? state.bowling.current.id : null;

  if (state.bowling.bowlers.length > 0) {
    html += '<div class="bowler-select-divider">Select bowler for this over</div>';
    state.bowling.bowlers.forEach(function(b) {
      var isCurrent = b.id === prevId;
      html += '<button class="bowler-select-item' + (isCurrent ? ' selected' : '') + '" data-bowler-id="' + b.id + '">' +
        '<span>' + b.name + (isCurrent ? ' ✓' : '') + '</span>' +
        '<span class="bsi-figures">' + fmtBowlerFigures(b) + '</span>' +
        '</button>';
    });
  }
  html += '<div class="bowler-select-divider">New bowler</div>';
  /* Anyone in the fielding side's squad who hasn't bowled yet — names captured
     while they batted are offered back when their side takes the field. */
  var squadNames = (state.squads && state.squads[fieldingSide()]) || [];
  var usedBowlers = state.bowling.bowlers.map(function(b){ return b.name; });
  var lineupBowlers2 = squadNames.filter(function(n) {
    return !usedBowlers.some(function(u){ return samePlayer(u, n); });
  });
  if (lineupBowlers2.length) {
    html += '<select class="player-input-field" id="lineup-bowler-select" style="margin-bottom:8px">';
    html += '<option value="">— Select from squad —</option>';
    lineupBowlers2.forEach(function(n) {
      html += '<option value="' + n.replace(/"/g,'&quot;') + '">' + n + '</option>';
    });
    html += '</select>';
  }
  html += '<div style="display:flex;gap:6px;align-items:center">' +
    '<input type="text" class="player-input-field" id="input-new-bowler-name" placeholder="Or type name" autocomplete="off" style="margin-bottom:0;flex:1">' +
    '<button class="modal-confirm-btn" id="new-bowler-enter-btn" style="flex-shrink:0;padding:12px 14px">Add</button>' +
    '</div>';

  list.innerHTML = html;
  document.getElementById('new-bowler-error').textContent = '';

  // Add note that this is a mid-over change
  var title = document.querySelector('#new-bowler-modal .modal-title');
  if (title) title.textContent = _midOverChangeMode === 'split' ? '🔄 Split Over — New Bowler' : '🔄 Correct Bowler';

  document.getElementById('new-bowler-cancel-wrap').style.display = 'flex';
  document.getElementById('new-bowler-modal').style.display = 'flex';

  list.querySelectorAll('.bowler-select-item').forEach(function(btn) {
    btn.addEventListener('click', function() {
      selectBowlerById(parseInt(this.dataset.bowlerId));
      document.getElementById('new-bowler-cancel-wrap').style.display = 'none';
      var t = document.querySelector('#new-bowler-modal .modal-title');
      if (t) t.textContent = '🎳 New Over — Select Bowler';
    });
  });

  // Re-bind enter button
  document.getElementById('new-bowler-enter-btn').addEventListener('click', function() {
    var name = document.getElementById('input-new-bowler-name').value.trim();
    if (!name) { document.getElementById('new-bowler-error').textContent = 'Enter a name.'; return; }
    rememberPlayer(fieldingSide(), name);
    var matches = state.bowling.bowlers.filter(function(b) { return b.name.toLowerCase() === name.toLowerCase(); });
    if (matches.length === 0) {
      var created = newBowler(name);
      state.bowling.bowlers.push(created);
      selectBowlerById(created.id);
    } else if (matches.length === 1) {
      selectBowlerById(matches[0].id);
    } else {
      showBowlerDisambiguation(name, matches, -1); // no consecutive restriction mid-over
    }
    var t = document.querySelector('#new-bowler-modal .modal-title');
    if (t) t.textContent = '🎳 New Over — Select Bowler';
  });
}

document.getElementById('new-bowler-cancel-btn').addEventListener('click', function() {
  document.getElementById('new-bowler-modal').style.display = 'none';
  document.getElementById('new-bowler-cancel-wrap').style.display = 'none';
  var t = document.querySelector('#new-bowler-modal .modal-title');
  if (t) t.textContent = '🎳 New Over — Select Bowler';
});

/* ══════════════════════════════════════════════════════
   MANUAL STRIKE SWAP
══════════════════════════════════════════════════════ */
document.getElementById('pb-swap-btn').addEventListener('click', function() {
  swapBatters();
  saveState();
  syncScore();
  updatePlayerBar();
  var name = state.batting.striker ? state.batting.striker.name : '';
  showToast('⇄ Strike to ' + name, 1500);
});

/* ══════════════════════════════════════════════════════
   NB EXTRAS MODAL
══════════════════════════════════════════════════════ */
var _nbBatRuns   = 0;
var _nbExtraType = 'none';
var _nbExtraRuns = 0;

function openNbExtrasModal(batRuns) {
  _nbBatRuns   = batRuns;
  _nbExtraType = 'none';
  _nbExtraRuns = 0;
  document.getElementById('nb-batruns-display').textContent = batRuns;
  document.querySelectorAll('#nb-extras-list .bowler-select-item').forEach(function(b) {
    b.classList.remove('selected');
  });
  document.querySelector('#nb-extras-list [data-nbextra="none"]').classList.add('selected');
  document.getElementById('nb-extra-runs-wrap').style.display = 'none';
  document.getElementById('nb-extras-error').textContent = '';
  document.querySelectorAll('#nb-extra-run-picker .extra-run-btn').forEach(function(b) { b.classList.remove('selected'); });
  document.getElementById('nb-extras-modal').style.display = 'flex';
}

document.querySelectorAll('#nb-extras-list .bowler-select-item').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#nb-extras-list .bowler-select-item').forEach(function(b) { b.classList.remove('selected'); });
    this.classList.add('selected');
    _nbExtraType = this.dataset.nbextra;
    _nbExtraRuns = 0;
    document.querySelectorAll('#nb-extra-run-picker .extra-run-btn').forEach(function(b) { b.classList.remove('selected'); });
    document.getElementById('nb-extras-error').textContent = '';
    var wrap  = document.getElementById('nb-extra-runs-wrap');
    var label = document.getElementById('nb-extra-runs-label');
    if (_nbExtraType === 'none') {
      wrap.style.display = 'none';
    } else if (_nbExtraType === 'penalty') {
      label.textContent  = 'How many penalty runs?';
      wrap.style.display = 'block';
    } else {
      label.textContent  = _nbExtraType.charAt(0).toUpperCase() + _nbExtraType.slice(1) + ' — how many runs?';
      wrap.style.display = 'block';
    }
  });
});

document.querySelectorAll('#nb-extra-run-picker .extra-run-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#nb-extra-run-picker .extra-run-btn').forEach(function(b) { b.classList.remove('selected'); });
    this.classList.add('selected');
    _nbExtraRuns = parseInt(this.dataset.nbr);
    document.getElementById('nb-extras-error').textContent = '';
  });
});

document.getElementById('nb-extras-ok').addEventListener('click', function() {
  if (_nbExtraType !== 'none' && _nbExtraRuns === 0) {
    document.getElementById('nb-extras-error').textContent = 'Please select the number of runs.';
    return;
  }
  document.getElementById('nb-extras-modal').style.display = 'none';
  if (state.freeHitsEnabled) state.freeHit = true; // every no-ball results in a free hit

  // Build the final no-ball event
  var totalRuns = nbPen() + _nbBatRuns; // no-ball penalty + bat runs
  var extraRuns = _nbExtraRuns;

  /* One path for all four, so batter, bowler, extras and the ball chip can
     no longer disagree. recordBall does the bookkeeping; displayRuns carries
     the runs off the bat and nbExtra/nbExtraRuns the rest. */
  if (_nbExtraType === 'none') {
    recordBall({ type: 'extra', extra: 'noball', runs: totalRuns, displayRuns: _nbBatRuns, isBallCounted: deliveryCounts('noball') });
  } else {
    recordBall({
      type: 'extra', extra: 'noball',
      runs: totalRuns + extraRuns,
      displayRuns: _nbBatRuns,
      nbExtra: _nbExtraType, nbExtraRuns: extraRuns,
      isBallCounted: deliveryCounts('noball')
    });
  }
});

document.getElementById('nb-extras-cancel').addEventListener('click', function() {
  document.getElementById('nb-extras-modal').style.display = 'none';
});

// Hook NB button to show extras modal instead of direct record
// We need to intercept after runs are selected — override the noball extra handler
var _pendingNbRuns = null;
var _origExtraRunHandler = null;

// After noball runs selected, open NB extras modal
(function() {
  var origHandler = document.querySelectorAll('.extra-run-btn:not(.cancel)');
  // We'll intercept in the existing extra-run-btn handler by checking pendingExtra
})();

/* ══════════════════════════════════════════════════════
   OTHER RUNS MODAL (Overthrow / Penalty)
══════════════════════════════════════════════════════ */
var _otherType = null;
var _otherRuns = 0;

document.getElementById('commentary-toggle').addEventListener('click', function () {
  var cw = document.getElementById('commentary-wrap');
  var open = cw.style.display === 'none';
  cw.style.display = open ? 'block' : 'none';
  this.classList.toggle('on', open);
  if (open) document.getElementById('ball-commentary').focus();
});

/* 5 moved off the pad (rare, and it sat between 6 and W). It is still the
   same button with the same scoring logic — reached from Other. */
/* Reduce overs and Catch up were only reachable through buttons in a hidden
   block, so neither could be opened — yet the app itself told scorers to use
   "Other → Reduce overs". They now live in Other, under Match tools. */
document.getElementById('other-reduce-btn').addEventListener('click', function () {
  document.getElementById('other-runs-modal').style.display = 'none';
  openReduceModal();
});
document.getElementById('other-catchup-btn').addEventListener('click', function () {
  document.getElementById('other-runs-modal').style.display = 'none';
  document.getElementById('catchup-btn').click();
});

document.getElementById('other-five-btn').addEventListener('click', function () {
  document.getElementById('other-runs-modal').style.display = 'none';
  document.getElementById('run-five-btn').click();
});

document.getElementById('other-runs-btn').addEventListener('click', function() {
  _otherType = null; _otherRuns = 0;
  document.querySelectorAll('#other-type-list .bowler-select-item').forEach(function(b) { b.classList.remove('selected'); });
  document.getElementById('other-runs-wrap').style.display = 'none';
  document.getElementById('other-runs-error').textContent = '';
  document.getElementById('other-runs-ok').disabled = true;
  document.querySelectorAll('#other-run-picker .extra-run-btn').forEach(function(b) { b.classList.remove('selected'); });
  document.getElementById('other-runs-modal').style.display = 'flex';
});

document.querySelectorAll('#other-type-list .bowler-select-item').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#other-type-list .bowler-select-item').forEach(function(b) { b.classList.remove('selected'); });
    this.classList.add('selected');
    _otherType = this.dataset.othertype;
    _otherRuns = 0;
    document.querySelectorAll('#other-run-picker .extra-run-btn').forEach(function(b) { b.classList.remove('selected'); });
    document.getElementById('other-runs-ok').disabled = true;
    document.getElementById('other-runs-error').textContent = '';
    document.getElementById('other-runs-label').textContent = _otherType === 'penalty' ? 'How many penalty runs?' : 'How many overthrow runs?';
    document.getElementById('other-runs-wrap').style.display = 'block';
  });
});

document.querySelectorAll('#other-run-picker .extra-run-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#other-run-picker .extra-run-btn').forEach(function(b) { b.classList.remove('selected'); });
    this.classList.add('selected');
    _otherRuns = parseInt(this.dataset.otr);
    document.getElementById('other-runs-ok').disabled = false;
    document.getElementById('other-runs-error').textContent = '';
  });
});

document.getElementById('other-runs-ok').addEventListener('click', function() {
  if (!_otherType || !_otherRuns) { document.getElementById('other-runs-error').textContent = 'Select type and runs.'; return; }
  document.getElementById('other-runs-modal').style.display = 'none';

  if (_otherType === 'overthrow') {
    // Credited to striker, swap applies on odd runs
    state.runs += _otherRuns;
    var s = state.batting.striker;
    if (s) {
      s.runs += _otherRuns;
      if (_otherRuns % 2 === 1) swapBatters();
    }
    // NOT credited to bowler
    state.currentOverBalls.push({ type: 'overthrow', runs: _otherRuns, isBallCounted: false });
    if (state.partnership) state.partnership.runs += _otherRuns;
  } else {
    // Penalty — extras only
    state.runs += _otherRuns;
    state.extras.penalty = (state.extras.penalty || 0) + _otherRuns;
    state.currentOverBalls.push({ type: 'penalty', runs: _otherRuns, isBallCounted: false });
    if (state.partnership) state.partnership.runs += _otherRuns;
  }
  saveState(); syncScore(); updateScoringUI(); updatePlayerBar();
  showToast(_otherType === 'penalty' ? _otherRuns + ' penalty runs added' : _otherRuns + ' overthrow run' + (_otherRuns !== 1 ? 's' : '') + ' — striker credited', 2000);
});

document.getElementById('other-runs-cancel').addEventListener('click', function() {
  document.getElementById('other-runs-modal').style.display = 'none';
});

/* ══════════════════════════════════════════════════════
   SCORER SCORECARD MODAL
══════════════════════════════════════════════════════ */

document.getElementById('scorer-scorecard-btn').addEventListener('click', function() { openScorerScorecard(); });
document.getElementById('scorer-scorecard-close').addEventListener('click', function() {
  document.getElementById('scorer-scorecard-modal').style.display = 'none';
});

document.getElementById('scorer-scorecard-pdf').addEventListener('click', function() {
  exportScorecardPDF();
});

function exportScorecardPDF() {
  if (typeof window.jspdf === 'undefined') {
    showToast('PDF library not loaded. Check connection.', 2500);
    return;
  }
  var jsPDF = window.jspdf.jsPDF;
  var doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  var fx    = state.fixture || {};
  var y     = 20;
  var lm    = 15; // left margin
  var pw    = 180; // page width

  /* ── Pagination ──────────────────────────────────────
     A4 is 297mm tall. A completed two-innings card needs
     320-390mm, so everything past the first page used to
     be silently clipped. Content now flows onto new pages
     and table headers repeat when a table continues.     */
  var TOP    = 20;   // y at the top of a fresh page
  var BOTTOM = 272;  // last usable y (footer sits at 287)
  var contHdr = null; // header row to repeat if a table breaks
  var runLabel = '';  // e.g. "1st Innings — Cravenby CC", repeated on overflow pages

  function newPage() {
    doc.addPage();
    y = TOP;
    doc.setTextColor(0);
    if (runLabel) {
      doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(150, 100, 30);
      doc.text(runLabel + ' (continued)', lm, y); y += 6;
      doc.setTextColor(0);
    }
    if (contHdr) {
      doc.setFontSize(8.5); doc.setFont('helvetica','bold');
      var x = lm;
      contHdr.cols.forEach(function(c, i) {
        doc.text(String(c || ''), x, y, { maxWidth: contHdr.widths[i] - 1 });
        x += contHdr.widths[i];
      });
      y += 5;
      doc.setDrawColor(180); doc.line(lm, y, lm + pw, y); y += 3;
    }
  }
  // Break to a new page if the next block of `h` mm won't fit
  function need(h) { if (y + (h || 6) > BOTTOM) newPage(); }

  // Header
  doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text('TYGERBERG CRICKET CLUB', 105, y, { align:'center' }); y += 8;
  doc.setFontSize(10); doc.setFont('helvetica','normal');
  doc.text('Match Scorecard', 105, y, { align:'center' }); y += 10;

  // Match info
  var teams = (fx.team || 'TCC') + ' vs ' + (fx.opponent || 'Opponents');
  doc.setFontSize(13); doc.setFont('helvetica','bold');
  doc.text(teams, 105, y, { align:'center' }); y += 6;
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  var meta = [];
  if (fx.date)     meta.push(new Date(fx.date).toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long', year:'numeric' }));
  if (fx.venue)    meta.push(fx.venue);
  if (fx.division) meta.push(fx.division);
  if (meta.length) { doc.text(meta.join('  ·  '), 105, y, { align:'center' }); y += 5; }
  // Small running line at the top of each innings page
  var matchLine = teams + (meta.length ? '  \u00b7  ' + meta[0] : '');
  /* A finished match opened from Results has its own toss — state.toss is
     the match being scored live, and was being printed on every export. */
  var toss = state.toss;
  if (_viewingCompleted) {
    var cr = _viewingCompleted.row;
    toss = cr.toss_winner ? { winner: cr.toss_winner, decision: cr.toss_decision } : null;
  }
  if (toss && toss.winner) {
    // The live scorer stores 'tcc'/'opp'; the manual page stores team names
    var tw = toss.winner === 'tcc' ? (fx.team || 'TCC')
           : toss.winner === 'opp' ? (fx.opponent || 'Opponents')
           : toss.winner;
    doc.text('Toss: ' + tw + ' won' + (toss.decision ? ', chose to ' + toss.decision : ''), 105, y, { align:'center' }); y += 5;
  }
  y += 4;

  function drawLine() { need(4); doc.setDrawColor(180); doc.line(lm, y, lm + pw, y); y += 3; }

  function sectionTitle(t) {
    contHdr = null;
    // Keep the heading with at least its first couple of rows
    need(26);
    doc.setDrawColor(180); doc.line(lm, y, lm + pw, y); y += 3;
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(150, 100, 30);
    doc.text(t, lm, y); y += 5;
    doc.setTextColor(0);
  }

  function tableRow(cols, widths, bold, isHeader) {
    doc.setFontSize(8.5); doc.setFont('helvetica', bold ? 'bold' : 'normal');
    // Work out how tall this row really is — long names and dismissals
    // wrap inside their column and used to overprint the row below.
    var lines = cols.map(function(col, i) {
      return doc.splitTextToSize(String(col == null ? '' : col), widths[i] - 1);
    });
    var maxLines = lines.reduce(function(m, l) { return Math.max(m, l.length); }, 1);
    var h = 5 + (maxLines - 1) * 3.6;
    need(h);
    // need() may have started a new page and reprinted the header in bold —
    // restore this row's own style before drawing it
    doc.setFontSize(8.5); doc.setFont('helvetica', bold ? 'bold' : 'normal');
    var x = lm;
    lines.forEach(function(l, i) { doc.text(l, x, y); x += widths[i]; });
    y += h;
    if (isHeader) contHdr = { cols: cols, widths: widths };
  }

  /* Top of an innings page: label, batting side and score, in one band. */
  function inningsBanner(label, score) {
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(120);
    doc.text(matchLine, lm, y); y += 7;
    doc.setFillColor(28, 28, 28); doc.rect(lm, y - 5, pw, 13, 'F');
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(201, 162, 39);
    doc.text(label.toUpperCase(), lm + 4, y);
    doc.setFontSize(12); doc.setTextColor(255);
    doc.text(score.batting_team || '', lm + 4, y + 5.5);
    doc.setFontSize(15);
    doc.text(score.runs + '/' + score.wickets, lm + pw - 4, y + 1, { align: 'right' });
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(210);
    doc.text(fmtOvers(score.overs, score.balls), lm + pw - 4, y + 5.5, { align: 'right' });
    doc.setTextColor(0);
    y += 14;
  }

  function renderInnings(label, batting, bowling, score) {
    runLabel = label + ' \u2014 ' + (score.batting_team || '');
    inningsBanner(label, score);
    sectionTitle('Batting \u2014 ' + (score.batting_team || ''));

    // Batting header
    tableRow(['Batter','Dismissal','R','B','4s','6s','SR'], [55,55,12,12,10,10,16], true, true);
    drawLine();

    // Batters in the order they came in, not the order they were out
    battingCard(batting).forEach(function(row) {
      var b = row.bat, howText = dismissalText(row);
      var sr   = b.balls > 0 ? (b.runs/b.balls*100).toFixed(0) : '0';
      var name = b.name + (row.notOut ? '*' : '');
      tableRow([name, howText, b.runs, b.balls, b.fours||0, b.sixes||0, sr], [55,55,12,12,10,10,16], false);
    });

    drawLine();
    var totalExt = (score.extras_wides||0)+(score.extras_noballs||0)+(score.extras_byes||0)+(score.extras_legbyes||0)+(score.extras_penalty||0);
    tableRow(['Extras', 'W:' + (score.extras_wides||0) + ' NB:' + (score.extras_noballs||0) + ' B:' + (score.extras_byes||0) + ' LB:' + (score.extras_legbyes||0), totalExt, '', '', '', ''], [55,55,12,12,10,10,16], false);
    tableRow(['TOTAL', fmtOvers(score.overs, score.balls), score.runs + '/' + score.wickets, '', '', '', ''], [55,55,12,12,10,10,16], true);

    // FOW
    var fow = batting.fow || [];
    if (fow.length) {
      contHdr = null;
      y += 2;
      doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(100);
      var fowStr = 'FOW: ' + fow.map(function(f) { return f.score+'-'+f.wicket+' ('+f.batter+', '+fowOvers(f.overs)+')'; }).join('  ');
      // A full ten-wicket list wraps to several lines — advance for all of them
      var fowLines = doc.splitTextToSize(fowStr, pw);
      need(fowLines.length * 3.4 + 2);
      doc.text(fowLines, lm, y); y += fowLines.length * 3.4 + 2;
      doc.setTextColor(0);
    }
    y += 3;

    // Bowling
    sectionTitle('Bowling — ' + (score.bowling_team || ''));
    /* In the Hundred a bowler's "overs" are 5-ball sets, so show balls and
       runs per ball — the old overs/economy maths was wrong for that format. */
    var h100 = isHundred();
    tableRow(['Bowler', h100 ? 'Balls' : 'O','M','R','W','Wd','NB', h100 ? 'R/B' : 'Econ'], [65,14,12,14,12,12,12,19], true, true);
    drawLine();
    (bowling.bowlers || []).forEach(function(b) {
      var bb   = bowlerBalls(b);
      var ov   = h100 ? String(bb) : b.overs + (b.balls > 0 ? '.' + b.balls : '');
      var econ = bb > 0 ? (h100 ? (b.runs / bb).toFixed(2) : (b.runs / (bb / 6)).toFixed(1)) : '-';
      tableRow([b.name, ov, b.maidens||0, b.runs, b.wickets, b.wides||0, b.noballs||0, econ], [65,14,12,14,12,12,12,19], false);
    });
    contHdr = null;
    y += 4;
  }

  // Who batted in which innings. state.battingTeam is the side batting NOW,
  // and it flips at the innings break — so in the 2nd innings the first
  // innings was batted by the other side.
  var tccName = fx.team || 'TCC';
  var oppName = fx.opponent || 'Opponents';
  var curBat  = state.battingTeam === 'tcc' ? tccName : oppName;
  var curBowl = state.battingTeam === 'tcc' ? oppName : tccName;

  var fi_s = state.firstInningsScore;
  var hasFirst = !!(fi_s && fi_s.runs !== undefined);
  var innings = [];
  if (hasFirst) {
    var fx_e = fi_s.extras || {};
    innings.push({ label: '1st Innings', batting: state.firstInningsBatting || {}, bowling: state.firstInningsBowling || {},
      score: { batting_team: curBowl, bowling_team: curBat, overs: fi_s.overs, balls: fi_s.balls, runs: fi_s.runs, wickets: fi_s.wickets,
               extras_wides: fx_e.wides || 0, extras_noballs: fx_e.noballs || 0, extras_byes: fx_e.byes || 0,
               extras_legbyes: fx_e.legbyes || 0, extras_penalty: fx_e.penalty || 0 } });
  }
  innings.push({ label: hasFirst ? '2nd Innings' : '1st Innings', batting: state.batting || {}, bowling: state.bowling || {},
    score: { batting_team: curBat, bowling_team: curBowl, overs: state.overs, balls: state.balls, runs: state.runs, wickets: state.wickets,
             extras_wides: state.extras.wides || 0, extras_noballs: state.extras.noballs || 0, extras_byes: state.extras.byes || 0,
             extras_legbyes: state.extras.legbyes || 0, extras_penalty: state.extras.penalty || 0 } });

  /* The result of THIS match: a finished match opened from Results carries
     its own; the live match only has one once endMatch() has run. The old
     read of the end screen's text could be a previous match's result. */
  var resultText = _viewingCompleted ? (_viewingCompleted.row.result || '') : (state._matchResult || '');

  /* ── PAGE 1: SUMMARY ───────────────────────────────── */
  y += 2;
  doc.setDrawColor(201, 162, 39); doc.setLineWidth(0.6); doc.line(lm, y, lm + pw, y); doc.setLineWidth(0.2);
  y += 8;
  if (resultText) {
    var rl = doc.splitTextToSize(resultText, pw - 16);
    var rh = 8 + rl.length * 6;
    doc.setFillColor(250, 244, 222); doc.setDrawColor(201, 162, 39);
    doc.rect(lm, y - 5, pw, rh, 'FD');
    doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(150, 100, 30);
    doc.text('RESULT', 105, y, { align: 'center' });
    doc.setFontSize(13); doc.setTextColor(20);
    doc.text(rl, 105, y + 6.5, { align: 'center' });
    y += rh + 4;
    var potm = getPotm();
    if (potm) {
      doc.setFillColor(28, 28, 28); doc.rect(lm, y - 5, pw, 15, 'F');
      doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(201, 162, 39);
      doc.text('PLAYER OF THE MATCH', lm + 4, y);
      doc.setFontSize(12); doc.setTextColor(255);
      doc.text(potm.name, lm + 4, y + 6.5);
      doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(210);
      doc.text(potmTeamName(potm.side), lm + pw - 4, y, { align: 'right' });
      if (potm.note) doc.text(potm.note, lm + pw - 4, y + 6.5, { align: 'right' });
      doc.setTextColor(0);
      y += 15;
    }
  } else {
    doc.setFontSize(10); doc.setFont('helvetica','italic'); doc.setTextColor(120);
    doc.text('Match in progress — scorecard as it stands', 105, y, { align: 'center' });
    y += 9;
  }
  doc.setTextColor(0);

  function topBatters(batting) {
    return battingCard(batting)
      .filter(function (r) { return (r.bat.balls || 0) > 0 || (r.bat.runs || 0) > 0; })
      .sort(function (a, b) { return (b.bat.runs || 0) - (a.bat.runs || 0) || (a.bat.balls || 0) - (b.bat.balls || 0); })
      .slice(0, 3)
      .map(function (r) { return [r.bat.name + (r.notOut ? '*' : ''), (r.bat.runs || 0) + ' (' + (r.bat.balls || 0) + ')']; });
  }
  function topBowlers(bowling) {
    return ((bowling && bowling.bowlers) || [])
      .filter(function (b) { return bowlerBalls(b) > 0; })
      .sort(function (a, b) { return (b.wickets || 0) - (a.wickets || 0) || (a.runs || 0) - (b.runs || 0); })
      .slice(0, 3)
      .map(function (b) {
        var spell = isHundred() ? bowlerBalls(b) + 'b' : b.overs + (b.balls > 0 ? '.' + b.balls : '') + ' ov';
        return [b.name, (b.wickets || 0) + '-' + (b.runs || 0) + ' (' + spell + ')'];
      });
  }

  innings.forEach(function (inn) {
    var sc = inn.score;
    var ext = (sc.extras_wides||0)+(sc.extras_noballs||0)+(sc.extras_byes||0)+(sc.extras_legbyes||0)+(sc.extras_penalty||0);
    var bats = topBatters(inn.batting), bowls = topBowlers(inn.bowling);
    var rows = Math.max(bats.length, bowls.length, 1);
    var boxH = 24 + rows * 5.5;

    // Header band of the panel
    doc.setFillColor(28, 28, 28); doc.rect(lm, y, pw, 12, 'F');
    doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(201, 162, 39);
    doc.text(inn.label.toUpperCase(), lm + 4, y + 4.5);
    doc.setFontSize(11); doc.setTextColor(255);
    doc.text(sc.batting_team || '', lm + 4, y + 9.5);
    doc.setFontSize(14);
    doc.text(sc.runs + '/' + sc.wickets, lm + pw - 4, y + 6, { align: 'right' });
    doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(210);
    doc.text(fmtOvers(sc.overs, sc.balls), lm + pw - 4, y + 10, { align: 'right' });

    // Body
    doc.setDrawColor(200); doc.rect(lm, y, pw, boxH);
    var by = y + 17;
    doc.setFontSize(7.5); doc.setTextColor(110);
    var legal = (sc.overs || 0) * ballsPerSet() + (sc.balls || 0);
    var rate = !isHundred() && legal > 0 ? '   ·   Run rate ' + (sc.runs / (legal / 6)).toFixed(2) : '';
    doc.text('Extras ' + ext + ' (W ' + (sc.extras_wides||0) + ', NB ' + (sc.extras_noballs||0) + ', B ' + (sc.extras_byes||0) +
             ', LB ' + (sc.extras_legbyes||0) + ((sc.extras_penalty||0) ? ', P ' + sc.extras_penalty : '') + ')' + rate, lm + 4, by);
    by += 6;
    var col2 = lm + pw / 2 + 2;
    doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(150, 100, 30);
    doc.text('TOP BATTING', lm + 4, by);
    doc.text('TOP BOWLING — ' + (sc.bowling_team || '').toUpperCase(), col2, by);
    by += 5;
    doc.setFontSize(8.5); doc.setTextColor(20);
    for (var i = 0; i < rows; i++) {
      if (bats[i])  { doc.setFont('helvetica','normal'); doc.text(doc.splitTextToSize(bats[i][0], 58)[0], lm + 4, by);
                      doc.setFont('helvetica','bold');   doc.text(bats[i][1], lm + pw / 2 - 4, by, { align: 'right' }); }
      if (bowls[i]) { doc.setFont('helvetica','normal'); doc.text(doc.splitTextToSize(bowls[i][0], 52)[0], col2, by);
                      doc.setFont('helvetica','bold');   doc.text(bowls[i][1], lm + pw - 4, by, { align: 'right' }); }
      if (!bats.length && !bowls.length && i === 0) {
        doc.setFont('helvetica','italic'); doc.setTextColor(140); doc.text('No balls recorded yet', lm + 4, by); doc.setTextColor(20);
      }
      by += 5.5;
    }
    doc.setTextColor(0);
    y += boxH + 7;
  });

  doc.setFontSize(7.5); doc.setFont('helvetica','italic'); doc.setTextColor(130);
  doc.text('Full batting and bowling for each innings follow on the next page' + (innings.length > 1 ? 's' : '') + '.', 105, y, { align: 'center' });
  doc.setTextColor(0);

  /* ── ONE PAGE PER INNINGS ─────────────────────────── */
  innings.forEach(function (inn) {
    contHdr = null; runLabel = '';
    doc.addPage(); y = TOP;
    renderInnings(inn.label, inn.batting, inn.bowling, inn.score);
  });
  runLabel = ''; contHdr = null;

  // Footer — on every page, with page numbering when it runs to more than one
  var pageCount = doc.internal.getNumberOfPages();
  var stamp = 'Tygerberg Cricket Club  ·  tygerbergcc.co.za  ·  Generated ' + new Date().toLocaleDateString('en-ZA');
  for (var p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(150);
    doc.text(stamp, 105, 287, { align:'center' });
    if (pageCount > 1) doc.text('Page ' + p + ' of ' + pageCount, lm + pw, 287, { align:'right' });
  }
  doc.setTextColor(0);

  // Save
  var filename = 'TCC_Scorecard_' + (fx.opponent || 'Match').replace(/[^a-zA-Z0-9]/g,'_') + '_' + (fx.date || new Date().toISOString().slice(0,10)) + '.pdf';
  doc.save(filename);
}


/* ══════════════════════════════════════════════════════
   EDIT A PLAYER'S NAME
   A name is copied into many places as the match is scored: the batting
   card, fall of wickets, bowling figures, each dismissal's bowler and
   fielder, every ball's bowler, split-over bowler lists — and all of it
   again for the first innings. A correction has to reach every copy or the
   scorecard contradicts itself, so it is done here in one pass.

   Side-aware: TCC and the opposition can have players with the same name,
   so only the chosen side's records are touched. In the current innings the
   batting side is state.battingTeam; in the first innings it is the other.
══════════════════════════════════════════════════════ */
var _viewingCompleted = null;   // { row, overs, curBalls } when a finished match is open

function parseMaybe(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { var p = JSON.parse(v); return p == null ? fallback : p; } catch (e) { return fallback; }
}

function _rn(obj, key, oldN, newN) {
  if (obj && obj[key] && samePlayer(obj[key], oldN)) { obj[key] = newN; return 1; }
  return 0;
}

function renameBatters(bat, oldN, newN) {
  if (!bat) return 0;
  var n = _rn(bat.striker, 'name', oldN, newN) + _rn(bat.nonStriker, 'name', oldN, newN);
  (bat.dismissed   || []).forEach(function (d) { n += _rn(d, 'name', oldN, newN); });
  (bat.retiredHurt || []).forEach(function (d) { n += _rn(d, 'name', oldN, newN); });
  (bat.fow         || []).forEach(function (f) { n += _rn(f, 'batter', oldN, newN); });
  return n;
}

/* The fielding side: bowlers, and the bowler/fielder credited on the other
   side's dismissals and on every ball. */
function renameFielders(bat, bowl, overs, oldN, newN) {
  var n = 0;
  if (bowl) {
    (bowl.bowlers || []).forEach(function (b) { n += _rn(b, 'name', oldN, newN); });
    // current may be a detached copy after a restore — never counted twice
    if (bowl.current && (bowl.bowlers || []).indexOf(bowl.current) === -1) _rn(bowl.current, 'name', oldN, newN);
  }
  if (bat) {
    (bat.dismissed || []).forEach(function (d) {
      n += _rn(d, 'bowler', oldN, newN) + _rn(d, 'fielder', oldN, newN);
    });
  }
  (overs || []).forEach(function (ov) {
    if (!ov) return;
    n += _rn(ov, 'bowler', oldN, newN);
    if (Array.isArray(ov.splitBowlers)) {
      ov.splitBowlers = ov.splitBowlers.map(function (x) { if (samePlayer(x, oldN)) { n++; return newN; } return x; });
    }
    (ov.balls || []).forEach(function (b) { n += _rn(b, 'bowler', oldN, newN) + _rn(b, 'fielder', oldN, newN); });
  });
  return n;
}

/* Catches and stumpings are tallied for TCC's fielders across the whole
   match, whichever innings they were taken in. */
function renameTallies(lineup, oldN, newN) {
  var n = 0;
  if (!lineup) return 0;
  ['catches', 'stumpings'].forEach(function (k) {
    var t = lineup[k]; if (!t) return;
    Object.keys(t).forEach(function (who) {
      if (samePlayer(who, oldN) && who !== newN) { t[newN] = (t[newN] || 0) + t[who]; delete t[who]; n++; }
    });
  });
  return n;
}

/* m = { battingTeam, batting, bowling, overs, fiBatting, fiBowling, fiOvers, lineup, squads } */
function renameInMatch(m, side, oldN, newN) {
  var n = 0;
  var cur = m.battingTeam;
  if (side === cur) n += renameBatters(m.batting, oldN, newN);
  else              n += renameFielders(m.batting, m.bowling, m.overs, oldN, newN);
  if (m.fiBatting || m.fiBowling) {
    var fiBattingSide = cur === 'tcc' ? 'opp' : 'tcc';
    if (side === fiBattingSide) n += renameBatters(m.fiBatting, oldN, newN);
    else                        n += renameFielders(m.fiBatting, m.fiBowling, m.fiOvers, oldN, newN);
  }
  if (side === 'tcc') n += renameTallies(m.lineup, oldN, newN);
  if (m.squads && Array.isArray(m.squads[side])) {
    m.squads[side] = m.squads[side].map(function (x) { return samePlayer(x, oldN) ? newN : x; })
      .filter(function (x, i, a) { return a.findIndex(function (y) { return samePlayer(x, y); }) === i; });
  }
  return n;
}

/* Everyone who has appeared in the match, per side. */
function playersInMatch(m) {
  var out = { tcc: [], opp: [] };
  function add(side, name) {
    if (name && !out[side].some(function (x) { return samePlayer(x, name); })) out[side].push(name);
  }
  function battersOf(bat, side) {
    if (!bat) return;
    (bat.dismissed || []).forEach(function (d) { add(side, d.name); });
    add(side, bat.striker && bat.striker.name); add(side, bat.nonStriker && bat.nonStriker.name);
    (bat.retiredHurt || []).forEach(function (d) { add(side, d.name); });
  }
  function fieldersOf(bat, bowl, side) {
    ((bowl && bowl.bowlers) || []).forEach(function (b) { add(side, b.name); });
    ((bat && bat.dismissed) || []).forEach(function (d) { add(side, d.fielder); });
  }
  var cur = m.battingTeam, other = cur === 'tcc' ? 'opp' : 'tcc';
  battersOf(m.batting, cur);       fieldersOf(m.batting, m.bowling, other);
  battersOf(m.fiBatting, other);   fieldersOf(m.fiBatting, m.fiBowling, cur);
  out.tcc.sort(); out.opp.sort();
  return out;
}

/* The match the scorecard modal is showing, as a renameable object. The
   arrays and objects are the real ones, so a rename lands in place. */
function currentRenameTarget() {
  if (_viewingCompleted) {
    return {
      battingTeam: state.battingTeam,
      batting: state.batting, bowling: state.bowling,
      overs: (_viewingCompleted.overs || []).concat([{ balls: _viewingCompleted.curBalls || [] }]),
      fiBatting: state.firstInningsBatting, fiBowling: state.firstInningsBowling,
      fiOvers: (state.firstInningsScore && state.firstInningsScore.overHistory) || [],
      lineup: null, squads: null    // those belong to the live match
    };
  }
  return {
    battingTeam: state.battingTeam,
    batting: state.batting, bowling: state.bowling,
    overs: (state.overHistory || []).concat([{ balls: state.currentOverBalls || [] }]),
    fiBatting: state.firstInningsBatting, fiBowling: state.firstInningsBowling,
    fiOvers: state.firstInningsOverHistory || [],
    lineup: state.lineup, squads: state.squads
  };
}

function openRenameModal() {
  var m = currentRenameTarget();
  var p = playersInMatch(m);
  var fx = state.fixture || {};
  var sel = document.getElementById('rename-player');
  sel.innerHTML = '';
  [['tcc', fx.team || 'TCC'], ['opp', fx.opponent || 'Opposition']].forEach(function (pair) {
    if (!p[pair[0]].length) return;
    var g = document.createElement('optgroup');
    g.label = pair[1];
    p[pair[0]].forEach(function (name) {
      var o = document.createElement('option');
      o.value = pair[0] + '|' + name;
      o.textContent = name;
      g.appendChild(o);
    });
    sel.appendChild(g);
  });
  if (!sel.options.length) { showToast('No players in this match yet'); return; }
  var input = document.getElementById('rename-new');
  input.value = sel.value.split('|').slice(1).join('|');
  document.getElementById('rename-error').textContent = '';
  document.getElementById('rename-modal').style.display = 'flex';
}

document.getElementById('scorer-scorecard-rename').addEventListener('click', openRenameModal);
document.getElementById('rename-player').addEventListener('change', function () {
  document.getElementById('rename-new').value = this.value.split('|').slice(1).join('|');
  document.getElementById('rename-error').textContent = '';
});
document.getElementById('rename-cancel').addEventListener('click', function () {
  document.getElementById('rename-modal').style.display = 'none';
});

document.getElementById('rename-save').addEventListener('click', async function () {
  var err  = document.getElementById('rename-error');
  var raw  = document.getElementById('rename-player').value;
  var side = raw.split('|')[0];
  var oldN = raw.split('|').slice(1).join('|');
  var newN = document.getElementById('rename-new').value.replace(/\s+/g, ' ').trim();

  if (!newN) { err.textContent = 'Enter the correct name.'; return; }
  if (newN === oldN) { document.getElementById('rename-modal').style.display = 'none'; return; }

  var m = currentRenameTarget();
  /* Refuse to rename onto another player on the same side — that would
     silently merge two people's figures. A spelling/case fix of the same
     name is fine. */
  var clash = playersInMatch(m)[side].filter(function (x) {
    return !samePlayer(x, oldN) && samePlayer(x, newN);
  })[0];
  if (clash) { err.textContent = clash + ' is already in this match on that side. Pick a different name.'; return; }

  var btn = this;
  var changed = renameInMatch(m, side, oldN, newN);
  if (!changed) { err.textContent = 'Nothing to change — that name was not found.'; return; }
  // Player of the match follows the correction too
  var potmLu = potmLineup(), potmRenamed = false;
  if (potmLu.potm && potmLu.potm.side === side && samePlayer(potmLu.potm.name, oldN)) {
    potmLu.potm.name = newN; potmRenamed = true;
  }

  if (_viewingCompleted) {
    // A finished match: write straight back to its own row.
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var row = _viewingCompleted.row;
      var data = {
        batting_state:      JSON.stringify(state.batting || {}),
        bowling_state:      JSON.stringify(state.bowling || {}),
        over_history:       JSON.stringify(_viewingCompleted.overs || []),
        current_over_balls: JSON.stringify(_viewingCompleted.curBalls || [])
      };
      if (state.firstInningsBatting) data.first_innings_batting = JSON.stringify(state.firstInningsBatting);
      if (state.firstInningsBowling) data.first_innings_bowling = JSON.stringify(state.firstInningsBowling);
      if (state.firstInningsScore)   data.first_innings_score   = JSON.stringify(state.firstInningsScore);
      if (potmRenamed) data.lineup_state = JSON.stringify(potmLu);
      /* No scorer_session, so the Worker's handover check never fires — this
         is an edit to a finished match, not a scorer taking it over. */
      await ensureScorerToken();
      var res = await workerCall('scoring.push', { id: row.id, data: data });
      if (!res.ok) throw new Error('Save failed (' + res.status + ')');
      Object.assign(row, data);   // reopening shows the corrected name
    } catch (e) {
      renameInMatch(m, side, newN, oldN);   // put it back — nothing was saved
      if (potmRenamed) potmLu.potm.name = oldN;
      err.textContent = 'Could not save: ' + (e.message || e) + '. Check your connection and try again.';
      btn.disabled = false; btn.textContent = 'Save';
      return;
    }
    btn.disabled = false; btn.textContent = 'Save';
  } else {
    // The live match: the normal save and sync carry it everywhere.
    saveState();
    syncScore();
    saveSquads();   // the stored squad is replaced, so the old spelling stops being offered
    updateScoringUI();
    updatePlayerBar();
  }

  document.getElementById('rename-modal').style.display = 'none';
  document.getElementById('scorer-scorecard-body').innerHTML = buildScorerScorecardHTML();
  showToast('✎ ' + oldN + ' → ' + newN, 2500);
});

/* ══════════════════════════════════════════════════════
   PLAYER OF THE MATCH
   Stored in lineup_state.potm = { name, side, note } so no new column is
   needed and it rides along with every save, takeover and resume. A finished
   match opened from Results is written back to its own row.
══════════════════════════════════════════════════════ */

/* The lineup of the match on screen: the live one, or a finished one's own. */
function potmLineup() {
  if (_viewingCompleted) {
    if (!_viewingCompleted.lineup) _viewingCompleted.lineup = parseMaybe(_viewingCompleted.row.lineup_state, {}) || {};
    return _viewingCompleted.lineup;
  }
  if (!state.lineup) state.lineup = { players: [], keeper: null };
  return state.lineup;
}
function getPotm() {
  var p = potmLineup().potm;
  return p && p.name ? p : null;
}
function potmTeamName(side) {
  var fx = state.fixture || {};
  return side === 'tcc' ? (fx.team || 'TCC') : side === 'opp' ? (fx.opponent || 'Opposition') : '';
}

/* Every player's contribution across both innings, with a simple impact score
   to rank a suggested pick: runs, 25 a wicket, 10 a catch/stumping/run out,
   a bonus for quick scoring and for economical spells, and a lift for the
   winning side. The scorer always makes the final call. */
function potmCandidates() {
  var m = currentRenameTarget();
  var cur = m.battingTeam, other = cur === 'tcc' ? 'opp' : 'tcc';
  var rows = {};
  function row(side, name) {
    if (!name) return null;
    var key = side + '|' + String(name).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!rows[key]) rows[key] = { side: side, name: name, bat: null, bowl: null, ct: 0, st: 0, ro: 0 };
    return rows[key];
  }
  function batters(bat, side) {
    if (!bat) return;
    battingCard(bat).forEach(function (r) {
      var b = r.bat; if (!b || !b.name) return;
      if (!(b.balls > 0 || b.runs > 0 || !r.notOut)) return;   // in, but never faced
      var x = row(side, b.name);
      x.bat = { runs: b.runs || 0, balls: b.balls || 0, notOut: !!r.notOut };
    });
  }
  function fielders(bat, bowl, side) {
    ((bowl && bowl.bowlers) || []).forEach(function (b) {
      var bb = bowlerBalls(b); if (!bb) return;
      var x = row(side, b.name);
      x.bowl = { balls: bb, runs: b.runs || 0, wkts: b.wickets || 0, overs: b.overs || 0, part: b.balls || 0 };
    });
    ((bat && bat.dismissed) || []).forEach(function (d) {
      if (d.how === 'Caught & Bowled') { var cb = row(side, d.bowler); if (cb) cb.ct++; return; }
      var f = row(side, d.fielder); if (!f) return;
      if (d.how === 'Caught') f.ct++;
      else if (d.how === 'Stumped') f.st++;
      else if (d.how === 'Run Out') f.ro++;
    });
  }
  batters(m.batting, cur);     fielders(m.batting, m.bowling, other);
  batters(m.fiBatting, other); fielders(m.fiBatting, m.fiBowling, cur);

  var result = _viewingCompleted ? (_viewingCompleted.row.result || '') : (state._matchResult || state._finalResult || '');
  var winner = null, fx = state.fixture || {};
  if (/\bwon\b/i.test(result)) {
    if (fx.team && result.toLowerCase().indexOf(String(fx.team).toLowerCase()) === 0) winner = 'tcc';
    else if (fx.opponent && result.toLowerCase().indexOf(String(fx.opponent).toLowerCase()) === 0) winner = 'opp';
  }
  var h100 = isHundred();
  return Object.keys(rows).map(function (k) {
    var x = rows[k], s = 0;
    if (x.bat) {
      s += x.bat.runs;
      if (x.bat.runs >= 20 && x.bat.balls > 0) s += Math.max(0, (x.bat.runs / x.bat.balls * 100) - 100) * 0.1;
      if (x.bat.notOut && x.bat.runs >= 20) s += 5;
      if (x.bat.runs >= 50) s += x.bat.runs >= 100 ? 20 : 10;   // milestones
    }
    if (x.bowl) {
      s += x.bowl.wkts * 25;
      var perBall = x.bowl.runs / x.bowl.balls, par = h100 ? 1.4 : 7 / 6;
      if (x.bowl.balls >= 12) s += Math.max(0, (par - perBall) * x.bowl.balls * 1.5);
    }
    s += (x.ct + x.st + x.ro) * 10;
    if (winner && x.side === winner) s *= 1.25;
    x.score = Math.round(s * 10) / 10;
    x.note = potmNote(x);
    return x;
  }).filter(function (x) { return x.note; })
    .sort(function (a, b) { return b.score - a.score; });
}

/* "62 (41) · 2/18 · 1 ct" */
function potmNote(x) {
  var bits = [];
  if (x.bat)  bits.push(x.bat.runs + (x.bat.notOut ? '*' : '') + ' (' + x.bat.balls + ')');
  if (x.bowl) bits.push(x.bowl.wkts + '/' + x.bowl.runs);
  var f = [];
  if (x.ct) f.push(x.ct + ' ct');
  if (x.st) f.push(x.st + ' st');
  if (x.ro) f.push(x.ro + ' ro');
  if (f.length) bits.push(f.join(', '));
  return bits.join(' · ');
}

function potmBannerHTML() {
  var p = getPotm(); if (!p) return '';
  return '<div class="potm-banner"><span class="potm-label">🏅 Player of the match</span>' +
    '<span class="potm-name">' + esc(p.name) + '</span>' +
    '<span class="potm-meta">' + esc([potmTeamName(p.side), p.note].filter(Boolean).join(' · ')) + '</span></div>';
}

var _potmCands = [];
function openPotmModal() {
  _potmCands = potmCandidates();
  if (!_potmCands.length) { showToast('No player figures in this match yet'); return; }
  var sel = document.getElementById('potm-player');
  sel.innerHTML = '';
  var cur = getPotm();
  var top = _potmCands.slice(0, 3);
  function opt(parent, x, label) {
    var o = document.createElement('option');
    o.value = x.side + '|' + x.name;
    o.textContent = label || (x.name + ' — ' + x.note);
    parent.appendChild(o);
  }
  var g0 = document.createElement('optgroup'); g0.label = 'Suggested';
  top.forEach(function (x) { opt(g0, x); });
  sel.appendChild(g0);
  ['tcc', 'opp'].forEach(function (side) {
    var list = _potmCands.filter(function (x) { return x.side === side; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!list.length) return;
    var g = document.createElement('optgroup'); g.label = potmTeamName(side);
    list.forEach(function (x) { opt(g, x); });
    sel.appendChild(g);
  });
  // Pre-select the current pick if there is one, else the top suggestion
  if (cur) {
    var want = cur.side + '|' + cur.name;
    for (var i = 0; i < sel.options.length; i++) if (samePlayer(sel.options[i].value, want)) { sel.selectedIndex = i; break; }
  }
  document.getElementById('potm-note').value = cur ? (cur.note || '') : top[0].note;
  document.getElementById('potm-clear').style.display = cur ? '' : 'none';
  document.getElementById('potm-error').textContent = '';
  document.getElementById('potm-modal').style.display = 'flex';
}

function potmSelected() {
  var v = document.getElementById('potm-player').value;
  var side = v.split('|')[0], name = v.split('|').slice(1).join('|');
  return _potmCands.filter(function (x) { return x.side === side && x.name === name; })[0] || null;
}

document.getElementById('potm-player').addEventListener('change', function () {
  var x = potmSelected();
  if (x) document.getElementById('potm-note').value = x.note;
});
document.getElementById('potm-cancel').addEventListener('click', function () {
  document.getElementById('potm-modal').style.display = 'none';
});

async function savePotm(value, btn) {
  var err = document.getElementById('potm-error');
  var lu = potmLineup();
  var before = lu.potm;
  if (value) lu.potm = value; else delete lu.potm;
  if (_viewingCompleted) {
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      var data = { lineup_state: JSON.stringify(lu) };
      await ensureScorerToken();
      var res = await workerCall('scoring.push', { id: _viewingCompleted.row.id, data: data });
      if (!res.ok) throw new Error('Save failed (' + res.status + ')');
      _viewingCompleted.row.lineup_state = data.lineup_state;
    } catch (e) {
      if (before) lu.potm = before; else delete lu.potm;
      err.textContent = 'Could not save: ' + (e.message || e) + '. Check your connection and try again.';
      btn.disabled = false; btn.textContent = label;
      return false;
    }
    btn.disabled = false; btn.textContent = label;
  } else {
    /* After the match has ended the saved copy was cleared on purpose —
       writing it again would offer to "resume" a finished match. */
    if (!state._finalResult) saveState();
    syncScore();
  }
  refreshPotmViews();
  return true;
}

function refreshPotmViews() {
  var m = document.getElementById('scorer-scorecard-modal');
  if (m && m.style.display === 'flex') document.getElementById('scorer-scorecard-body').innerHTML = buildScorerScorecardHTML();
  if (!_viewingCompleted) refreshEndPotm();
}

function refreshEndPotm() {
  var endEl = document.getElementById('end-potm');
  if (endEl) endEl.innerHTML = potmBannerHTML();
  var endBtn = document.getElementById('end-potm-btn');
  if (endBtn) endBtn.textContent = getPotm() ? '🏅 Change player of the match' : '🏅 Pick player of the match';
}

document.getElementById('potm-save').addEventListener('click', async function () {
  var x = potmSelected();
  if (!x) { document.getElementById('potm-error').textContent = 'Pick a player.'; return; }
  var note = document.getElementById('potm-note').value.replace(/\s+/g, ' ').trim();
  if (await savePotm({ name: x.name, side: x.side, note: note }, this)) {
    document.getElementById('potm-modal').style.display = 'none';
    showToast('🏅 ' + x.name + ' — player of the match', 2500);
  }
});
document.getElementById('potm-clear').addEventListener('click', async function () {
  if (await savePotm(null, this)) {
    document.getElementById('potm-modal').style.display = 'none';
    showToast('Player of the match cleared', 2000);
  }
});
document.getElementById('scorer-scorecard-potm').addEventListener('click', openPotmModal);
document.getElementById('end-potm-btn').addEventListener('click', function () {
  _viewingCompleted = null;   // the end screen is always the match just finished
  openPotmModal();
});

/* ══════════════════════════════════════════════════════
   APPEARANCE — the scorer picks the colour theme.
   Each theme is only a block of CSS variables, so nothing else in the app
   knows or cares which one is on. The choice is kept on the phone.
══════════════════════════════════════════════════════ */
var THEMES = [
  { id: 'gold',    name: 'Gold Standard', desc: 'Club gold on white. The default.',        swatch: ['#13120e', '#e8c65a', '#f2f1ec'] },
  { id: 'pitch',   name: 'Pitch',         desc: 'Deep green with gold accents.',           swatch: ['#10301f', '#c9a227', '#f4f6f1'] },
  { id: 'classic', name: 'Classic',       desc: 'Flat and plain — the old look.',          swatch: ['#15140f', '#8a6d28', '#f7f6f3'] },
  { id: 'night',   name: 'Night match',   desc: 'Dark. Best indoors and after dark.',      swatch: ['#05070a', '#e3bb51', '#222932'] },
  { id: 'auto',    name: 'Auto',          desc: 'Gold Standard by day, Night from 6pm.',   swatch: ['#f2f1ec', '#e8c65a', '#05070a'] }
];

function savedTheme() {
  try { return localStorage.getItem('tcc_theme') || 'gold'; } catch (e) { return 'gold'; }
}
/* 'auto' is a choice, not a theme — this is the theme it means right now. */
function resolveTheme(id) {
  if (id !== 'auto') return id;
  var h = new Date().getHours();
  return (h >= 18 || h < 6) ? 'night' : 'gold';
}
function applyTheme(id) {
  var real = resolveTheme(id);
  if (real === 'gold') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', real);
  try { localStorage.setItem('tcc_theme', id); } catch (e) {}
  // The phone's status bar and the PWA splash follow the top of the app
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--topbar-bg').trim() || '#13120e');
  renderThemeList();
}

function renderThemeList() {
  var list = document.getElementById('theme-list');
  if (!list) return;
  var cur = savedTheme();
  list.innerHTML = THEMES.map(function (t) {
    return '<button class="theme-item' + (t.id === cur ? ' selected' : '') + '" data-theme-id="' + t.id + '">' +
      '<span class="theme-swatch">' + t.swatch.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</span>' +
      '<span><span class="theme-item-name">' + t.name + '</span>' +
      '<span class="theme-item-desc">' + t.desc + (t.id === 'auto' ? ' — now: ' + (resolveTheme('auto') === 'night' ? 'Night match' : 'Gold Standard') : '') + '</span></span>' +
      '<span class="theme-item-tick">✓</span></button>';
  }).join('');
}

/* Animations on or off, kept on the phone like the theme. Unset follows the
   phone's own "reduce motion" setting. */
function savedMotion() {
  try { return localStorage.getItem('tcc_motion') || 'auto'; } catch (e) { return 'auto'; }
}
function applyMotion(v) {
  if (v === 'auto') document.documentElement.removeAttribute('data-motion');
  else document.documentElement.setAttribute('data-motion', v);
  try { localStorage.setItem('tcc_motion', v); } catch (e) {}
  var box = document.getElementById('motion-toggle');
  var lbl = document.getElementById('motion-toggle-label');
  if (box) box.checked = v !== 'reduced';
  if (lbl) lbl.textContent = v !== 'reduced' ? 'On' : 'Off';
}
document.getElementById('motion-toggle').addEventListener('change', function () {
  applyMotion(this.checked ? 'full' : 'reduced');
});

function openThemeModal() {
  renderThemeList();
  applyMotion(savedMotion());   // reflect the current choice in the toggle
  document.getElementById('theme-modal').style.display = 'flex';
}
document.getElementById('theme-list').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-theme-id]');
  if (btn) applyTheme(btn.getAttribute('data-theme-id'));   // changes under your finger
});
document.getElementById('theme-close').addEventListener('click', function () {
  document.getElementById('theme-modal').style.display = 'none';
});
document.getElementById('theme-btn').addEventListener('click', openThemeModal);
document.getElementById('other-theme-btn').addEventListener('click', function () {
  document.getElementById('other-runs-modal').style.display = 'none';
  openThemeModal();
});
/* On Auto, a match that runs into the evening changes over by itself when the
   app comes back to the foreground. */
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && savedTheme() === 'auto') applyTheme('auto');
});
applyTheme(savedTheme());
applyMotion(savedMotion());

/* ══════════════════════════════════════════════════════
   MATCH SETTINGS — the rules, changeable mid-match
   Every ball carries the rule it was scored under, so changing one here
   affects the balls still to come and never rewrites the ones already in.
══════════════════════════════════════════════════════ */
function openMatchSettings() {
  var pen = document.getElementById('ms-extra-penalty');
  var eb  = document.getElementById('ms-extras-ball');
  var fh  = document.getElementById('ms-free-hits');
  var bl  = document.getElementById('ms-bowler-limit');
  pen.value = String(extraPen());
  eb.checked = !!state.extrasCountBall;
  fh.checked = state.freeHitsEnabled !== false;
  bl.value = (state.lineup && state.lineup.bowlerOverLimit) ? state.lineup.bowlerOverLimit : '';
  // The Hundred sets its own 20-ball cap, so there is nothing to choose there
  var blWrap = document.getElementById('ms-bowler-limit-wrap');
  if (blWrap) blWrap.style.display = isHundred() ? 'none' : '';
  msLabels();
  document.getElementById('ms-error').textContent = '';
  document.getElementById('match-settings-modal').style.display = 'flex';
}
function msLabels() {
  var eb = document.getElementById('ms-extras-ball'), ebl = document.getElementById('ms-extras-ball-label');
  var fh = document.getElementById('ms-free-hits'),  fhl = document.getElementById('ms-free-hits-label');
  if (eb && ebl) ebl.textContent = eb.checked ? 'On' : 'Off';
  if (fh && fhl) fhl.textContent = fh.checked ? 'On' : 'Off';
}
document.getElementById('ms-extras-ball').addEventListener('change', msLabels);
document.getElementById('ms-free-hits').addEventListener('change', msLabels);
document.getElementById('ms-cancel').addEventListener('click', function () {
  document.getElementById('match-settings-modal').style.display = 'none';
});
document.getElementById('other-settings-btn').addEventListener('click', function () {
  document.getElementById('other-runs-modal').style.display = 'none';
  openMatchSettings();
});
document.getElementById('ms-save').addEventListener('click', function () {
  var err = document.getElementById('ms-error');
  var blRaw = document.getElementById('ms-bowler-limit').value.trim();
  var bl = blRaw === '' ? null : parseInt(blRaw, 10);
  if (blRaw !== '' && (!isFinite(bl) || bl < 1)) { err.textContent = 'Overs per bowler must be a number, or blank for the usual rule.'; return; }

  var changed = [];
  var newPen = parseInt(document.getElementById('ms-extra-penalty').value, 10) || 1;
  if (newPen !== extraPen()) changed.push('wide/no-ball ' + newPen + (newPen === 1 ? ' run' : ' runs'));
  state.extraPenalty = newPen;

  var newEB = document.getElementById('ms-extras-ball').checked;
  if (newEB !== !!state.extrasCountBall) changed.push(newEB ? 'extras use a ball' : 'extras re-bowled');
  state.extrasCountBall = newEB;

  var newFH = document.getElementById('ms-free-hits').checked;
  if (newFH !== (state.freeHitsEnabled !== false)) changed.push(newFH ? 'free hits on' : 'free hits off');
  state.freeHitsEnabled = newFH;
  if (!newFH) state.freeHit = false;

  if (!state.lineup) state.lineup = { players: [], keeper: null };
  var oldBl = state.lineup.bowlerOverLimit || null;
  if (bl) state.lineup.bowlerOverLimit = bl; else delete state.lineup.bowlerOverLimit;
  if ((bl || null) !== oldBl) changed.push(bl ? bl + ' per bowler' : 'bowler limit back to the usual rule');

  // travels with the match, so a takeover carries the same rules
  state.lineup.extrasCountBall = state.extrasCountBall;
  state.lineup.extraPenalty    = state.extraPenalty;

  saveState();
  syncScore();
  updateScoringUI();
  updatePlayerBar();
  document.getElementById('match-settings-modal').style.display = 'none';
  showToast(changed.length ? '⚙ ' + changed.join(' · ') : '⚙ Settings unchanged', 3000);
});

function openScorerScorecard() {
  _viewingCompleted = null;   // this is the live match
  document.getElementById('scorer-scorecard-body').innerHTML = buildScorerScorecardHTML();
  document.getElementById('scorer-scorecard-modal').style.display = 'flex';
}

function buildScorerScorecardHTML() {
  var fi_s = state.innings === 2 ? firstInnings() : null;
  var fi_b = state.innings === 2 ? state.firstInningsBatting : null;
  var fi_w = state.innings === 2 ? state.firstInningsBowling : null;
  var innLabel = state.innings === 2 ? '2nd Innings' : '1st Innings';

  var html = '';

  /* helper — wraps a section body in a collapsible panel */
  function panel(title, meta, body, open) {
    return '<details class="ssc-panel"' + (open !== false ? ' open' : '') + '>' +
      '<summary>' +
        '<span class="ssc-panel-title">' + title + '</span>' +
        (meta ? '<span class="ssc-panel-meta">' + meta + '</span>' : '') +
        '<span class="ssc-panel-chevron">▼</span>' +
      '</summary>' +
      '<div class="ssc-panel-body">' + body + '</div>' +
    '</details>';
  }

  html += potmBannerHTML();
  // Player of the match is picked once there's a result
  var potmBtn = document.getElementById('scorer-scorecard-potm');
  if (potmBtn) {
    var res = _viewingCompleted ? (_viewingCompleted.row.result || '') : (state._matchResult || state._finalResult || '');
    potmBtn.style.display = res && !/no result|abandon/i.test(res) ? '' : 'none';
    potmBtn.textContent = getPotm() ? '🏅 POTM' : '🏅 Pick POTM';
  }

  /* ── 2ND / CURRENT INNINGS ── */
  var totalExtras = (state.extras.wides || 0) + (state.extras.noballs || 0)
                  + (state.extras.byes  || 0) + (state.extras.legbyes || 0)
                  + (state.extras.penalty || 0);

  /* Batting body */
  var batBody = '';
  battingCard(state.batting).forEach(function(row) { batBody += sscBatRow(row); });
  var penPart = (state.extras.penalty||0) > 0 ? '  P ' + state.extras.penalty : '';
  batBody += '<div class="ssc-extras-row">' +
    '<span>Extras: W ' + state.extras.wides + '  NB ' + state.extras.noballs + '  B ' + state.extras.byes + '  LB ' + state.extras.legbyes + penPart + '</span>' +
    '<span>' + totalExtras + '</span>' +
  '</div>';
  batBody += '<div class="ssc-total-row">' +
    '<div class="ssc-total-lbl">Total</div>' +
    '<div class="ssc-total-score">' + state.runs + '/' + state.wickets +
      ' <span style="font-size:0.85rem;letter-spacing:1px">(' + fmtOvers(state.overs, state.balls) + ')</span></div>' +
  '</div>';

  /* Partnership */
  var p = state.partnership || { runs: 0, balls: 0 };
  if (state.batting.striker && state.batting.nonStriker && (p.runs > 0 || p.balls > 0)) {
    batBody += '<div class="ssc-row" style="justify-content:space-between">' +
      '<div class="ssc-name" style="color:var(--muted);font-size:0.72rem">Current Partnership</div>' +
      '<div style="font-size:0.78rem;color:var(--white);font-weight:600">' + p.runs + ' (' + p.balls + ' balls)</div>' +
    '</div>';
  }

  html += panel('🏏 ' + innLabel + ' — Batting', state.runs + '/' + state.wickets, batBody, true);

  /* Bowling body */
  var bowlers = state.bowling.bowlers || [];
  if (bowlers.length) {
    var bowlBody = '';
    bowlers.forEach(function(b) {
      var isCurrent = state.bowling.current && b.name === state.bowling.current.name;
      var ovDisp = b.overs + (b.balls > 0 ? '.' + b.balls : '');
      var fig = ovDisp + '-' + (b.maidens||0) + '-' + b.runs + '-' + b.wickets;
      bowlBody += '<div class="ssc-row">' +
        '<div class="ssc-name">' + esc(b.name) + (isCurrent ? ' <span style="color:var(--gold);font-size:0.6rem">▶</span>' : '') + '</div>' +
        '<div class="ssc-fig">' + fig + '</div>' +
      '</div>';
    });
    html += panel('🎳 ' + innLabel + ' — Bowling', '', bowlBody, true);
  }

  /* Fall of wickets */
  var fow = state.batting.fow || [];
  if (fow.length) {
    var fowBody = '<div style="font-size:0.72rem;color:var(--muted);line-height:1.8;">';
    fow.forEach(function(f) {
      /* f.overs comes from fmtOvers(), which already ends in " ov" — this
         line was adding a second one ("0.5 ov ov"). */
      fowBody += f.score + '-' + f.wicket + ' (' + esc(f.batter) + ', ' + fowOvers(f.overs) + ')&nbsp;&nbsp;';
    });
    fowBody += '</div>';
    html += panel('Fall of Wickets', '', fowBody, false);
  }

  /* ── 1ST INNINGS (if in 2nd) ── */
  if (state.innings === 2 && !fi_s) {
    html += panel('1st Innings', '', '<div style="font-size:0.75rem;color:var(--muted);line-height:1.6">' +
      'No first innings was recorded for this match' +
      (state.target ? ' — the target of ' + state.target + ' is all that was carried over.' : '.') +
      '<br>If it was scored, it did not save. Check the match on another device before it is overwritten.' +
      '</div>', true);
  }
  if (fi_s && fi_s.runs !== undefined) {
    /* 1st innings batting */
    var fi1Body = '';
    battingCard(fi_b).forEach(function(row) { fi1Body += sscBatRow(row); });
    var fi1Extras = (fi_s.extras || {});
    var fi1TotalExtras = (fi1Extras.wides||0) + (fi1Extras.noballs||0) + (fi1Extras.byes||0) + (fi1Extras.legbyes||0) + (fi1Extras.penalty||0);
    fi1Body += '<div class="ssc-extras-row">' +
      '<span>Extras: W ' + (fi1Extras.wides||0) + '  NB ' + (fi1Extras.noballs||0) + '  B ' + (fi1Extras.byes||0) + '  LB ' + (fi1Extras.legbyes||0) + '</span>' +
      '<span>' + fi1TotalExtras + '</span>' +
    '</div>';
    fi1Body += '<div class="ssc-total-row">' +
      '<div class="ssc-total-lbl">Total</div>' +
      '<div class="ssc-total-score">' + fi_s.runs + '/' + fi_s.wickets +
        ' <span style="font-size:0.85rem;letter-spacing:1px">(' + fmtOvers(fi_s.overs, fi_s.balls) + ')</span></div>' +
    '</div>';

    html += panel('🏏 1st Innings — Batting', fi_s.runs + '/' + fi_s.wickets, fi1Body, false);

    /* 1st innings bowling */
    if (fi_w && fi_w.bowlers && fi_w.bowlers.length) {
      var fi1BowlBody = '';
      fi_w.bowlers.forEach(function(b) {
        var ovDisp = b.overs + (b.balls > 0 ? '.' + b.balls : '');
        var fig = ovDisp + '-' + (b.maidens||0) + '-' + b.runs + '-' + b.wickets;
        fi1BowlBody += '<div class="ssc-row">' +
          '<div class="ssc-name">' + esc(b.name) + '</div>' +
          '<div class="ssc-fig">' + fig + '</div>' +
        '</div>';
      });
      html += panel('🎳 1st Innings — Bowling', '', fi1BowlBody, false);
    }

    /* 1st innings FOW */
    if (fi_b && fi_b.fow && fi_b.fow.length) {
      var fi1FowBody = '<div style="font-size:0.72rem;color:var(--muted);line-height:1.8;">';
      fi_b.fow.forEach(function(f) {
        fi1FowBody += f.score + '-' + f.wicket + ' (' + esc(f.batter) + ', ' + fowOvers(f.overs) + ')&nbsp;&nbsp;';
      });
      fi1FowBody += '</div>';
      html += panel('1st Innings — Fall of Wickets', '', fi1FowBody, false);
    }
  }

  return html;
}

/* ══════════════════════════════════════════════════════
   SUPER OVER
══════════════════════════════════════════════════════ */

document.getElementById('super-over-yes').addEventListener('click', function() {
  document.getElementById('super-over-modal').style.display = 'none';
  startSuperOver();
});

document.getElementById('super-over-no').addEventListener('click', function() {
  document.getElementById('super-over-modal').style.display = 'none';
  // End as tie — bypass tie check
  state.isSuperOver = false; // ensure we don't loop
  var tie = state.mainMatch ? 'Super Over tied' : 'Tie';
  finishMatch(tie);
});

function startSuperOver() {
  state.superOverNum++;

  // Snapshot current match state if this is the first super over
  if (!state.mainMatch) {
    state.mainMatch = {
      tccScore:  state.isSuperOver ? null : state.runs + '/' + state.wickets + ' (' + fmtOvers(state.overs, state.balls) + ')',
      oppScore:  null, // will be set after 2nd innings of main match
      fixture:   state.fixture
    };
  }

  // Reset for super over
  state.isSuperOver    = true;
  state.innings        = 1;
  state.runs           = 0;
  state.wickets        = 0;
  state.overs          = 0;
  state.balls          = 0;
  state.target         = null;
  state.maxOvers       = 1; // super over is 1 over per side
  state.revisedOvers   = null;
  state.currentOverBalls = [];
  state.overHistory      = [];
  state.overExtended     = false;
  state.freeHit          = false;
  state.partnership      = { runs: 0, balls: 0 };
  state.batting          = { striker: null, nonStriker: null, dismissed: [], fow: [] };
  state.bowling          = { current: null, bowlers: [] };

  // Flip batting team — team that batted 2nd in main match bats first in super over
  // (opposite of main match)
  state.battingTeam = state.battingTeam === 'tcc' ? 'opp' : 'tcc';

  clearSavedState();
  saveState();
  syncScore();
  showScreen('scoring');
  updateScoringUI();
  showToast('⚡ Super Over ' + state.superOverNum + ' — ' + (state.battingTeam === 'tcc' ? (state.fixture ? state.fixture.team || 'TCC' : 'TCC') : (state.fixture ? state.fixture.opponent || 'Opponents' : 'Opponents')) + ' batting', 3000);
  loadSquads();
  openOpeningPlayersModal();
}

function finishMatch(result) {
  state._finalResult = result;   // sticky — see buildScorePayload
  syncScore();
  if (state.fixture && state.fixture.id && result) {
    var SHORT2 = ['Won','Lost','Draw','Tie','No Result','Abandoned','Forfeit'];
    var fixtureResult2 = SHORT2.indexOf(result) !== -1
      ? result
      : ((state.fixture.team || 'TCC').toLowerCase() === result.toLowerCase().slice(0, (state.fixture.team || 'TCC').length) ? 'Won' : 'Lost');
    setFixtureResult(state.fixture.id, fixtureResult2);
  }
  clearSavedState();
  var title = state.isSuperOver ? 'Super Over Result' : 'Match Over';
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-result').textContent = result;
  document.getElementById('end-detail').textContent =
    state.fixture ? (state.fixture.team || 'TCC') + ' vs ' + (state.fixture.opponent || 'Opponents') : '';
  document.getElementById('end-scorecard').innerHTML = buildScorecardHTML();
  showScreen('end');
}

/* ══════════════════════════════════════════════════════
   SERVICE WORKER
══════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  var _swReg = null;

  function trackInstalling(worker) {
    worker.addEventListener('statechange', function() {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        worker.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  }

  navigator.serviceWorker.register('./sw.js').then(function(reg) {
    _swReg = reg;

    // Already installing when we checked — don't wait for updatefound
    if (reg.installing) trackInstalling(reg.installing);

    // Already waiting — activate immediately
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });

    reg.addEventListener('updatefound', function() {
      if (reg.installing) trackInstalling(reg.installing);
    });

    reg.update();
  }).catch(function(err) {
    console.warn('SW registration failed:', err);
  });

  // Re-check for updates every time the app comes to foreground.
  // This is the main fix for Android PWA resume — the initial reg.update()
  // never runs when Chrome resumes a suspended process.
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && _swReg) {
      _swReg.update();
    }
  });

  // New SW has taken over — reload to pick up new JS/CSS
  var _swReloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (_swReloading) return;
    _swReloading = true;

    var activeScreen = document.querySelector('.screen.active');
    var isMidMatch   = activeScreen && activeScreen.id === 'screen-scoring';
    var ballsScored  = state && state.currentOverBalls && state.currentOverBalls.length > 0;

    if (isMidMatch && ballsScored) {
      showToast('⬆ Update ready — tap here to apply', 6000);
      var toastEl = document.getElementById('toast');
      if (toastEl) {
        toastEl.style.cursor = 'pointer';
        toastEl.addEventListener('click', function() { window.location.reload(); }, { once: true });
      }
    } else {
      window.location.reload();
    }
  });
}

/* ── iOS install hint ── */
var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
var isStandalone = window.navigator.standalone === true;
if (isIOS && !isStandalone) {
  document.getElementById('ios-install-hint').style.display = 'block';
}

/* ── PWA install prompt ── */
var deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('install-banner').style.display = 'flex';
});
window.addEventListener('appinstalled', function() {
  document.getElementById('install-banner').style.display = 'none';
  deferredInstallPrompt = null;
});
document.getElementById('install-btn').addEventListener('click', function() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(function() {
      deferredInstallPrompt = null;
      document.getElementById('install-banner').style.display = 'none';
    });
  }
});
document.getElementById('install-dismiss').addEventListener('click', function() {
  document.getElementById('install-banner').style.display = 'none';
});

/* ══════════════════════════════════════════════════════
   RESUME MODAL
══════════════════════════════════════════════════════ */
function showResumeModal() {
  var saved = JSON.parse(localStorage.getItem('tcc_scorer_state') || '{}');
  var s = saved.state || {};
  var f = s.fixture || {};
  var battingName = s.battingTeam === 'tcc' ? (f.team || 'TCC') : (f.opponent || 'Opponents');
  var age = saved.savedAt ? Math.floor((Date.now() - new Date(saved.savedAt).getTime()) / 60000) : null;

  document.getElementById('resume-summary').innerHTML =
    '<strong>' + (f.team || 'TCC') + ' vs ' + (f.opponent || 'Opponents') + '</strong>'
    + '<br>' + battingName + ' batting · '
    + (s.runs || 0) + '/' + (s.wickets || 0)
    + ' off ' + (s.overs || 0) + '.' + (s.balls || 0) + ' overs'
    + (age !== null ? '<br><span style="color:var(--muted);font-size:0.78rem">Saved ' + age + ' min' + (age !== 1 ? 's' : '') + ' ago</span>' : '');

  document.getElementById('resume-modal').style.display = 'flex';
}

document.getElementById('resume-continue-btn').addEventListener('click', function() {
  document.getElementById('resume-modal').style.display = 'none';
  if (restoreState()) {
    /* This guard only fired when all three were missing, so a match resumed
       with one batter set, or with both batters but no bowler, landed on a
       scoring screen that could not record a ball against anybody. */
    if (!state.batting.striker || !state.batting.nonStriker || !state.bowling.current) {
      showScreen('scoring');
      updateScoringUI();
      ensurePlayersSet();
      return;
    }
    // Restore offline queue count display
    if (offlineQueue.length) {
      document.getElementById('queue-count').textContent = offlineQueue.length;
      document.getElementById('queue-banner').classList.add('show');
    }
    showScreen('scoring');
    updateScoringUI();
    showToast('Match resumed — ' + state.runs + '/' + state.wickets);
    checkApiReachable();
  } else {
    showScreen('fixtures');
    loadFixtures();
  }
});

document.getElementById('resume-discard-btn').addEventListener('click', function() {
  clearSavedState();
  document.getElementById('resume-modal').style.display = 'none';
  showScreen('fixtures');
  loadFixtures();
});

/* Refresh button on fixture select screen */
document.getElementById('fix-refresh-btn').addEventListener('click', function() {
  var btn = this;
  btn.textContent = '↻ Loading…';
  loadFixtures().finally(function() { btn.textContent = '↻ Refresh'; });
});

// Initialise date pickers to last 30 days / today
(function() {
  var today  = new Date().toISOString().slice(0,10);
  var past30 = new Date(Date.now() - 30*24*3600*1000).toISOString().slice(0,10);
  document.getElementById('results-date-from').value = past30;
  document.getElementById('results-date-to').value   = today;
})();

document.getElementById('results-search-btn').addEventListener('click', function() {
  var from = document.getElementById('results-date-from').value;
  var to   = document.getElementById('results-date-to').value;
  if (from && to && from > to) {
    showToast('From date must be before To date');
    return;
  }
  loadCompletedMatches(from || null, to || null);
});

/* ══════════════════════════════════════════════════════
   CATCH-UP MODAL — manual score entry mid-match
══════════════════════════════════════════════════════ */
document.getElementById('catchup-btn').addEventListener('click', function() {
  // Pre-fill with current state
  document.getElementById('catchup-runs').value    = state.runs;
  document.getElementById('catchup-wickets').value = state.wickets;
  document.getElementById('catchup-overs').value   = state.overs;
  document.getElementById('catchup-balls').value   = state.balls;
  document.getElementById('catchup-error').textContent = '';
  document.getElementById('catchup-modal').style.display = 'flex';
  setTimeout(function() { document.getElementById('catchup-runs').focus(); }, 300);
});

document.getElementById('catchup-modal-close').addEventListener('click', closeCatchup);
document.getElementById('catchup-cancel-btn').addEventListener('click', closeCatchup);
document.getElementById('catchup-modal').addEventListener('click', function(e) {
  if (e.target === this) closeCatchup();
});

function closeCatchup() {
  document.getElementById('catchup-modal').style.display = 'none';
}

document.getElementById('catchup-confirm-btn').addEventListener('click', function() {
  var runs    = parseInt(document.getElementById('catchup-runs').value);
  var wickets = parseInt(document.getElementById('catchup-wickets').value);
  var overs   = parseInt(document.getElementById('catchup-overs').value);
  var balls   = parseInt(document.getElementById('catchup-balls').value) || 0;
  var errEl   = document.getElementById('catchup-error');
  errEl.textContent = '';

  if (isNaN(runs) || runs < 0) {
    errEl.textContent = 'Please enter valid runs.'; return;
  }
  if (isNaN(wickets) || wickets < 0 || wickets > 10) {
    errEl.textContent = 'Wickets must be 0–10.'; return;
  }
  if (isNaN(overs) || overs < 0) {
    errEl.textContent = 'Please enter completed overs.'; return;
  }
  if (balls < 0 || balls > 5) {
    errEl.textContent = 'Balls in current over must be 0–5.'; return;
  }
  var effMax = state.revisedOvers || state.maxOvers;
  if (effMax > 0 && overs > effMax) {
    errEl.textContent = 'Overs cannot exceed maximum (' + effMax + ').'; return;
  }

  // Apply the catch-up values
  state.runs    = runs;
  state.wickets = wickets;
  state.overs   = overs;
  state.balls   = balls;

  // Clear current over balls — scorer will enter from this point forward normally
  state.currentOverBalls = [];

  saveState();
  syncScore();
  closeCatchup();
  updateScoringUI();
  showToast('Score updated to ' + runs + '/' + wickets + ' off ' + overs + '.' + balls);
});


/* ══════════════════════════════════════════════════════
   RESULT PICKER
══════════════════════════════════════════════════════ */
function openResultPicker() {
  var f          = state.fixture || {};
  var tccName    = f.team     || 'TCC';
  var oppName    = f.opponent || 'Opponents';

  document.getElementById('result-modal-desc').textContent =
    tccName + ' vs ' + oppName + ' — select the official match result:';

  var options = [
    { cls: 'win',  icon: '🏆', label: tccName + ' won',  sub: 'TCC win — record as Won',    result: 'Won'       },
    { cls: 'loss', icon: '💔', label: oppName + ' won',  sub: 'TCC loss — record as Lost',  result: 'Lost'      },
    { cls: 'draw', icon: '🤝', label: 'Draw',            sub: 'Match drawn',                result: 'Draw'      },
    { cls: 'other',icon: '🌧', label: 'No result',       sub: 'Abandoned / weather',        result: 'No Result' },
    { cls: 'other',icon: '📋', label: 'Forfeit',         sub: 'One team forfeited',         result: 'Forfeit'   },
  ];

  document.getElementById('result-options').innerHTML = options.map(function(o, i) {
    return '<button class="result-option-btn ' + o.cls + '" data-idx="' + i + '">'
      + '<span class="ro-icon">' + o.icon + '</span>'
      + '<span><span class="ro-label">' + o.label + '</span>'
      + '<span class="ro-sub">' + o.sub + '</span></span>'
      + '</button>';
  }).join('');

  document.getElementById('result-options').querySelectorAll('.result-option-btn').forEach(function(btn, i) {
    btn.addEventListener('click', function() {
      document.getElementById('result-modal').style.display = 'none';
      endMatch(options[i].result);
    });
  });

  document.getElementById('result-modal').style.display = 'flex';
}

document.getElementById('result-cancel-btn').addEventListener('click', function() {
  document.getElementById('result-modal').style.display = 'none';
});

/* ══════════════════════════════════════════════════════
   BALL EDIT — tap a ball chip in the current over
══════════════════════════════════════════════════════ */
var editingBallIdx = null;

// Ball chips in over-balls are rendered dynamically — use delegation
document.getElementById('over-balls').addEventListener('click', function(e) {
  var chip = e.target.closest('.ball-chip');
  if (!chip || chip.classList.contains('pending')) return;
  var idx = Array.from(this.children).indexOf(chip);
  if (idx < 0 || idx >= state.currentOverBalls.length) return;
  openBallEdit(idx);
});

function openBallEdit(idx) {
  editingBallIdx = idx;
  var b = state.currentOverBalls[idx];
  document.getElementById('ball-edit-desc').textContent = 'Ball ' + (idx + 1) + ' of over ' + (state.overs + 1);
  document.getElementById('ball-edit-error').textContent = '';

  // Set type
  var typeVal = b.wicket ? 'wicket' : (b.extra || 'run');
  document.getElementById('ball-edit-type').value = typeVal;

  // Set runs — display the bat runs (displayRuns) not the total
  var dispRuns = b.displayRuns !== undefined ? b.displayRuns : (b.runs || 0);
  // For wicket on a normal ball, runs = 0
  document.getElementById('ball-edit-runs').value = b.wicket && !b.extra ? 0 : dispRuns;

  // Wicket toggle
  document.getElementById('ball-edit-wkt-no').classList.toggle('active', !b.wicket);
  document.getElementById('ball-edit-wkt-yes').classList.toggle('active', !!b.wicket);

  // Populate NB extras if noball
  if (typeVal === 'noball' && b.nbExtra) {
    document.getElementById('ball-edit-nb-extra-type').value = b.nbExtra;
    document.getElementById('ball-edit-nb-extra-runs-group').style.display = 'block';
    document.getElementById('ball-edit-nb-extra-runs').value = b.nbExtraRuns || 1;
  } else {
    document.getElementById('ball-edit-nb-extra-type').value = 'none';
    document.getElementById('ball-edit-nb-extra-runs-group').style.display = 'none';
  }
  updateBallEditRunsLabel();
  document.getElementById('ball-edit-modal').style.display = 'flex';
}

function updateBallEditRunsLabel() {
  var type = document.getElementById('ball-edit-type').value;
  var labels = {
    run:     'Runs off bat',
    wide:    'Runs scored off wide (excl. penalty)',
    noball:  'Runs off bat (excl. no-ball penalty)',
    bye:     'Byes scored',
    legbye:  'Leg byes scored',
    wicket:  'Runs off bat (0 if clean bowled/caught)'
  };
  document.getElementById('ball-edit-runs-label').textContent = labels[type] || 'Runs';
  document.getElementById('ball-edit-runs-group').style.display = 'block';
  var nbGroup = document.getElementById('ball-edit-nb-extras-group');
  nbGroup.style.display = type === 'noball' ? 'block' : 'none';
  if (type !== 'noball') {
    document.getElementById('ball-edit-nb-extra-type').value = 'none';
    document.getElementById('ball-edit-nb-extra-runs-group').style.display = 'none';
  }
}

document.getElementById('ball-edit-type').addEventListener('change', updateBallEditRunsLabel);
document.getElementById('ball-edit-nb-extra-type').addEventListener('change', function() {
  var t = this.value;
  var rg = document.getElementById('ball-edit-nb-extra-runs-group');
  rg.style.display = t === 'none' ? 'none' : 'block';
  var rl = document.getElementById('ball-edit-nb-extra-runs-label');
  rl.textContent = t === 'penalty' ? 'Penalty runs' : t === 'overthrow' ? 'Overthrow runs' : t === 'bye' ? 'Bye runs' : 'Leg-bye runs';
});

document.getElementById('ball-edit-wkt-no').addEventListener('click', function() {
  this.classList.add('active');
  document.getElementById('ball-edit-wkt-yes').classList.remove('active');
});
document.getElementById('ball-edit-wkt-yes').addEventListener('click', function() {
  this.classList.add('active');
  document.getElementById('ball-edit-wkt-no').classList.remove('active');
});

/* NOTE: closeBallEdit is defined once, further down (it handles both
   the live ball-edit and the over-edit contexts). A duplicate simpler
   definition used to live here and was silently shadowed by hoisting. */
document.getElementById('ball-edit-close').addEventListener('click', closeBallEdit);
document.getElementById('ball-edit-cancel').addEventListener('click', closeBallEdit);
document.getElementById('ball-edit-modal').addEventListener('click', function(e) { if (e.target === this) closeBallEdit(); });

function saveOverBallEdit() {
  var overIdx = _overBallEdit.overIdx;
  var ballIdx = _overBallEdit.ballIdx;
  var ov  = state.overHistory[overIdx];
  var old = ov.balls[ballIdx];

  var type     = document.getElementById('ball-edit-type').value;
  var dispRuns = parseInt(document.getElementById('ball-edit-runs').value) || 0;
  var isWkt    = document.getElementById('ball-edit-wkt-yes').classList.contains('active');

  // Reverse old ball from score and over totals
  state.runs    -= (old.runs || 0);
  if (old.wicket) state.wickets = Math.max(0, state.wickets - 1);
  if (old.extra) {
    if (old.extra === 'noball') {
      state.extras.noballs = Math.max(0, (state.extras.noballs||0) - 1);
      applyNbExtrasToState(old.nbExtra, old.nbExtraRuns || 0, true);
    } else { var eKey = old.extra + 's'; state.extras[eKey] = Math.max(0, (state.extras[eKey]||0) - (old.runs||0)); }
  }
  ov.runs    -= (old.runs || 0);
  if (old.wicket) ov.wickets = Math.max(0, ov.wickets - 1);

  // Build and apply new ball (with NB extras if applicable)
  var nb2 = getNbExtrasFromModal();
  var newBall = buildBallEventWithNb(type, dispRuns, isWkt, nb2.nbExtra, nb2.nbExtraRuns);
  ov.balls[ballIdx] = newBall;

  // Apply new ball to score and over totals
  state.runs += (newBall.runs || 0);
  if (newBall.wicket) state.wickets++;
  if (newBall.extra) {
    if (newBall.extra === 'noball') {
      state.extras.noballs = (state.extras.noballs||0) + 1;
      applyNbExtrasToState(newBall.nbExtra, newBall.nbExtraRuns || 0, false);
    } else { var eKey2 = newBall.extra + 's'; state.extras[eKey2] = (state.extras[eKey2]||0) + (newBall.runs||0); }
  }
  ov.runs += (newBall.runs || 0);
  if (newBall.wicket) ov.wickets++;

  // Recalculate bowler stats from full ball history
  recalculateBowlerStats();

  saveState();
  syncScore();
  updateScoringUI();
  closeBallEdit();
  showToast('Ball updated');
}

function recalculateBowlerStats() {
  // Reset all bowler counters
  state.bowling.bowlers.forEach(function(b) {
    b.overs = 0; b.balls = 0; b.runs = 0; b.wickets = 0;
    b.maidens = 0; b.wides = 0; b.noballs = 0;
  });

  // Helper to find a bowler by id or name
  function findBowler(id, name) {
    if (id) return state.bowling.bowlers.find(function(x) { return x.id === id; });
    if (name) return state.bowling.bowlers.find(function(x) { return x.name === name; });
    return null;
  }

  // Replay all completed overs — attribute each ball to its own bowler
  state.overHistory.forEach(function(ov) {
    var overRunsByBowler = {};  // bowlerId -> runs this over
    var overBallsByBowler = {}; // bowlerId -> legal balls this over

    ov.balls.forEach(function(ball) {
      // Use ball-level bowlerId first (handles split overs), fall back to over-level
      var b = findBowler(ball.bowlerId || ov.bowlerId, ball.bowler || ov.bowler);
      if (!b) return;

      if (!overRunsByBowler[b.id])  overRunsByBowler[b.id]  = 0;
      if (!overBallsByBowler[b.id]) overBallsByBowler[b.id] = 0;

      // A stumping off a wide is still the bowler's wicket
      if (ball.extra === 'wide' || ball.extra === 'noball') {
        if (ball.extra === 'wide') b.wides++; else b.noballs++;
        b.runs += bowlerChargeFor(ball);
        if (ball.wicket && creditsBowler(ball.how)) b.wickets++;
        // it used up a ball if it was scored under that rule
        if (ball.isBallCounted) { b.balls++; overBallsByBowler[b.id]++; }
        return;
      }
      var runsOffBat = batRunsFor(ball);
      if (ball.isBallCounted) {
        b.balls++;
        overBallsByBowler[b.id]++;
        overRunsByBowler[b.id] += runsOffBat;
      }
      b.runs += runsOffBat;
      if (ball.wicket && creditsBowler(ball.how)) b.wickets++;
    });

    // Resolve overs: only increment overs for bowlers who bowled this over
    Object.keys(overBallsByBowler).forEach(function(bid) {
      var b = state.bowling.bowlers.find(function(x) { return x.id === parseInt(bid); });
      if (!b) return;
      // If bowler completed a full 6 in this over (or their running total hit 6), increment
      if (b.balls >= ballsPerSet()) { b.overs++; b.balls = 0; }
      // Maiden: bowled all 6 legal balls themselves and conceded 0 runs
      if (overBallsByBowler[bid] === 6 && overRunsByBowler[bid] === 0) b.maidens++;
    });
  });

  // Replay current over balls for current bowler
  // Re-resolve current from the array using id (reference may be stale after JSON round-trip)
  if (state.bowling.current) {
    var curId   = state.bowling.current.id;
    var curName = state.bowling.current.name;
    var cur = curId
      ? state.bowling.bowlers.find(function(x) { return x.id === curId; })
      : state.bowling.bowlers.find(function(x) { return x.name === curName; });
    if (cur) {
      state.bowling.current = cur; // re-sync reference
      /* Same split as the completed overs above and as the live path — this
         copy used to charge byes off a no-ball to the bowler. */
      state.currentOverBalls.forEach(function(ball) {
        if (ball.extra === 'wide' || ball.extra === 'noball') {
          if (ball.extra === 'wide') cur.wides++; else cur.noballs++;
          cur.runs += bowlerChargeFor(ball);
          if (ball.isBallCounted) cur.balls++;
          if (ball.wicket && creditsBowler(ball.how)) cur.wickets++;
          return;
        }
        if (ball.isBallCounted) { cur.balls++; }
        cur.runs += batRunsFor(ball);
        if (ball.wicket && creditsBowler(ball.how)) cur.wickets++;
      });
    }
  }
}

function getNbExtrasFromModal() {
  var t = document.getElementById('ball-edit-nb-extra-type').value;
  var r = parseInt(document.getElementById('ball-edit-nb-extra-runs').value) || 0;
  return { nbExtra: t === 'none' ? null : t, nbExtraRuns: t === 'none' ? 0 : r };
}

function buildBallEventWithNb(type, dispRuns, isWkt, nbExtra, nbExtraRuns) {
  if (type !== 'noball' || !nbExtra) return buildBallEvent(type, dispRuns, isWkt);
  var totalRuns = nbPen() + dispRuns + (nbExtraRuns || 0);
  return { type:'extra', extra:'noball', runs:totalRuns, displayRuns:dispRuns, nbExtra:nbExtra, nbExtraRuns:nbExtraRuns, wicket:isWkt, isBallCounted:deliveryCounts('noball') };
}

function applyNbExtrasToState(nbExtra, nbExtraRuns, reverse) {
  var sign = reverse ? -1 : 1;
  if (!nbExtra || nbExtra === 'none') return;
  if (nbExtra === 'bye')     state.extras.byes    = Math.max(0, (state.extras.byes    || 0) + sign * nbExtraRuns);
  if (nbExtra === 'legbye')  state.extras.legbyes = Math.max(0, (state.extras.legbyes || 0) + sign * nbExtraRuns);
  if (nbExtra === 'penalty') state.extras.penalty = Math.max(0, (state.extras.penalty || 0) + sign * nbExtraRuns);
  // overthrow: no separate extras counter, just contributes to total runs
}

function buildBallEvent(type, dispRuns, isWkt) {
  if (type === 'run')     return { type:'run', runs:dispRuns, wicket:isWkt, isBallCounted:true };
  if (type === 'wide')    return { type:'extra', extra:'wide',   runs:widePen()+dispRuns, displayRuns:dispRuns, wicket:isWkt, isBallCounted:deliveryCounts('wide') };
  if (type === 'noball')  return { type:'extra', extra:'noball', runs:nbPen()+dispRuns, displayRuns:dispRuns, wicket:isWkt, isBallCounted:false };
  if (type === 'bye')     return { type:'extra', extra:'bye',    runs:dispRuns,   displayRuns:dispRuns, wicket:isWkt, isBallCounted:true };
  if (type === 'legbye')  return { type:'extra', extra:'legbye', runs:dispRuns,   displayRuns:dispRuns, wicket:isWkt, isBallCounted:true };
  if (type === 'wicket')  return { type:'wicket', runs:dispRuns, wicket:true, isBallCounted:true };
  return { type:'run', runs:0, isBallCounted:true };
}

document.getElementById('ball-edit-confirm').addEventListener('click', function() {
  /* Route to historical over ball edit if in that context */
  if (_overBallEdit !== null) {
    saveOverBallEdit();
    return;
  }
  if (editingBallIdx === null) return;
  var type    = document.getElementById('ball-edit-type').value;
  var dispRuns = parseInt(document.getElementById('ball-edit-runs').value) || 0;
  var isWkt   = document.getElementById('ball-edit-wkt-yes').classList.contains('active');

  var old = state.currentOverBalls[editingBallIdx];

  // Reverse the old ball's contributions
  state.runs    -= (old.runs || 0);
  if (old.wicket) state.wickets = Math.max(0, state.wickets - 1);
  if (old.extra) {
    if (old.extra === 'noball') {
      state.extras.noballs = Math.max(0, (state.extras.noballs || 0) - 1);
      applyNbExtrasToState(old.nbExtra, old.nbExtraRuns || 0, true);
    } else {
      var eKey = old.extra + 's';
      state.extras[eKey] = Math.max(0, (state.extras[eKey] || 0) - (old.runs || 0));
    }
  }
  var wasLegal = old.isBallCounted !== undefined ? old.isBallCounted : (!old.extra || old.extra === 'bye' || old.extra === 'legbye');
  if (wasLegal) state.balls = Math.max(0, state.balls - 1);

  // Build new ball event (same logic as recordBall)
  var newBall = {};
  if (type === 'run') {
    newBall = { type: 'run', runs: dispRuns, wicket: isWkt, isBallCounted: true };
    state.runs    += dispRuns;
    if (isWkt) state.wickets++;
    state.balls++;
  } else if (type === 'wide') {
    newBall = { type: 'extra', extra: 'wide', runs: widePen() + dispRuns, displayRuns: dispRuns, wicket: isWkt, isBallCounted: false };
    state.runs += 1 + dispRuns;
    state.extras.wides = (state.extras.wides || 0) + 1 + dispRuns;
    if (isWkt) state.wickets++;
  } else if (type === 'noball') {
    var nb = getNbExtrasFromModal();
    var totalNbRuns = 1 + dispRuns + (nb.nbExtra ? nb.nbExtraRuns : 0);
    newBall = { type:'extra', extra:'noball', runs:totalNbRuns, displayRuns:dispRuns, nbExtra:nb.nbExtra, nbExtraRuns:nb.nbExtraRuns, wicket:isWkt, isBallCounted:false };
    state.runs += totalNbRuns;
    state.extras.noballs = (state.extras.noballs || 0) + 1;
    applyNbExtrasToState(nb.nbExtra, nb.nbExtraRuns, false);
    if (isWkt) state.wickets++;
  } else if (type === 'bye') {
    newBall = { type: 'extra', extra: 'bye', runs: dispRuns, displayRuns: dispRuns, wicket: isWkt, isBallCounted: true };
    state.runs += dispRuns;
    state.extras.byes = (state.extras.byes || 0) + dispRuns;
    if (isWkt) state.wickets++;
    state.balls++;
  } else if (type === 'legbye') {
    newBall = { type: 'extra', extra: 'legbye', runs: dispRuns, displayRuns: dispRuns, wicket: isWkt, isBallCounted: true };
    state.runs += dispRuns;
    state.extras.legbyes = (state.extras.legbyes || 0) + dispRuns;
    if (isWkt) state.wickets++;
    state.balls++;
  } else if (type === 'wicket') {
    newBall = { type: 'wicket', runs: dispRuns, wicket: true, isBallCounted: true };
    state.runs += dispRuns;
    state.wickets++;
    state.balls++;
  }

  state.currentOverBalls[editingBallIdx] = newBall;
  saveState();
  syncScore();
  updateScoringUI();
  closeBallEdit();
  showToast('Ball updated');
});

/* ══════════════════════════════════════════════════════
   OVER EDIT — tap a completed over row to edit its balls
══════════════════════════════════════════════════════ */
var editingOverIdx = null;

// Over history collapse toggle
(function() {
  var expanded = false;
  function doToggle() {
    expanded = !expanded;
    document.getElementById('over-history-list').classList.toggle('expanded', expanded);
    var ohp = document.getElementById('over-history-panel');
    if (ohp) {
      ohp.classList.toggle('open', expanded);
      // Sit exactly on top of the action bar, whatever its height at this font size
      var bar = document.querySelector('#screen-scoring .scoring-action-bar');
      if (bar) ohp.style.bottom = bar.offsetHeight + 'px';
    }
    document.getElementById('history-chevron').classList.toggle('open', expanded);
    var ab = document.getElementById('action-history-btn');
    if (ab) { var arr = ab.querySelectorAll('span'); if(arr.length) arr[arr.length-1].textContent = expanded ? '▲' : '▼'; }
  }
  document.getElementById('history-heading-btn').addEventListener('click', doToggle);
  var ahb = document.getElementById('action-history-btn');
  if (ahb) ahb.addEventListener('click', doToggle);
})();

document.getElementById('over-history-list').addEventListener('click', function(e) {
  var row = e.target.closest('.history-row');
  if (!row) return;
  var idx = parseInt(row.dataset.overIdx);
  if (isNaN(idx)) return;
  openOverEdit(idx);
});

function openOverEdit(idx) {
  editingOverIdx = idx;
  _postOverEdit.overIdx = idx;  // keep post-over edit in sync
  var ov = state.overHistory[idx];
  document.getElementById('over-edit-title').textContent = '✏️ Over ' + ov.over;
  document.getElementById('over-edit-error').textContent = '';
  renderOverEditBalls(ov);
  document.getElementById('over-edit-modal').style.display = 'flex';
}

function renderOverEditBalls(ov) {
  var overRuns = ov.balls.reduce(function(s,b){ return s+(b.runs||0); },0);
  var overWkts = ov.balls.filter(function(b){ return b.wicket; }).length;

  // Ball chips
  var el = document.getElementById('over-edit-balls');
  el.innerHTML = ov.balls.map(function(b, i) {
    return '<div class="' + ballChipClass(b) + '" data-ball-idx="' + i + '" style="cursor:pointer;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700">' + ballChipLabel(b) + '</div>';
  }).join('');

  // Click on a chip opens ball edit for that position, reusing the existing ball-edit modal
  el.querySelectorAll('[data-ball-idx]').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var ballIdx = parseInt(this.dataset.ballIdx);
      openBallEditForOver(editingOverIdx, ballIdx);
    });
  });

  // Summary
  document.getElementById('over-edit-summary').textContent =
    'Over ' + ov.over + ': ' + overRuns + ' runs · ' + overWkts + ' wicket' + (overWkts !== 1 ? 's' : '');
}

function openBallEditForOver(overIdx, ballIdx) {
  // Temporarily set editingBallIdx and point the ball-edit modal at this over's ball
  var ov = state.overHistory[overIdx];
  var b  = ov.balls[ballIdx];

  // Store context
  editingBallIdx  = null; // current over mode off
  _overBallEdit   = { overIdx: overIdx, ballIdx: ballIdx };

  document.getElementById('ball-edit-desc').textContent = 'Over ' + ov.over + ', ball ' + (ballIdx + 1);
  document.getElementById('ball-edit-error').textContent = '';

  var typeVal = b.wicket ? 'wicket' : (b.extra || 'run');
  document.getElementById('ball-edit-type').value = typeVal;
  var dispRuns = b.displayRuns !== undefined ? b.displayRuns : (b.runs || 0);
  document.getElementById('ball-edit-runs').value = b.wicket && !b.extra ? 0 : dispRuns;
  document.getElementById('ball-edit-wkt-no').classList.toggle('active',  !b.wicket);
  document.getElementById('ball-edit-wkt-yes').classList.toggle('active', !!b.wicket);

  // Populate NB extras
  if (typeVal === 'noball' && b.nbExtra) {
    document.getElementById('ball-edit-nb-extra-type').value = b.nbExtra;
    document.getElementById('ball-edit-nb-extra-runs-group').style.display = 'block';
    document.getElementById('ball-edit-nb-extra-runs').value = b.nbExtraRuns || 1;
  } else {
    document.getElementById('ball-edit-nb-extra-type').value = 'none';
    document.getElementById('ball-edit-nb-extra-runs-group').style.display = 'none';
  }

  updateBallEditRunsLabel();
  document.getElementById('ball-edit-modal').style.display = 'flex';
}

// Patch closeBallEdit to refresh the over-edit modal if editing from history
var _origCloseBallEdit = closeBallEdit;
function closeBallEdit() {
  document.getElementById('ball-edit-modal').style.display = 'none';
  if (_overBallEdit !== null) {
    // Refresh the over-edit balls display
    renderOverEditBalls(state.overHistory[_overBallEdit.overIdx]);
    _overBallEdit = null;
  } else {
    editingBallIdx = null;
  }
}

// Patch ball-edit confirm to handle over-ball edits
var _overBallEdit = null; // { overIdx, ballIdx } when editing a historical over ball

function closeOverEdit() {
  document.getElementById('over-edit-modal').style.display = 'none';
  editingOverIdx = null;
}
document.getElementById('over-edit-close').addEventListener('click', closeOverEdit);
document.getElementById('over-edit-cancel').addEventListener('click', closeOverEdit);
document.getElementById('over-edit-modal').addEventListener('click', function(e) { if (e.target === this) closeOverEdit(); });

/* ══════════════════════════════════════════════════════
   POST-OVER BOWLER CORRECTION
   Allows fixing the wrong bowler on any completed over.
   Two modes:
     'correct' — all balls reassigned to one new bowler
     'split'   — ball-by-ball picker to attribute between two bowlers
══════════════════════════════════════════════════════ */

var _postOverEdit = {
  overIdx:    null,  // which history index we're fixing
  mode:       null,  // 'correct' | 'split'
  bowlerA:    null,  // first (original) bowler for split
  bowlerB:    null,  // second bowler for split
  ballOwners: [],    // parallel array to ov.balls — 'A'|'B' per ball for split
};

/* ── 1. "Edit Bowler" button inside the over-edit modal ── */
document.getElementById('over-edit-bowler-btn').addEventListener('click', function() {
  if (editingOverIdx === null) return;
  var ov = state.overHistory[editingOverIdx];

  // Pre-fill the reason modal label
  var bowlerName = ov.split && ov.splitBowlers
    ? ov.splitBowlers.join(' / ')
    : (ov.bowler || 'Unknown');
  document.getElementById('pobr-over-label').textContent =
    'Over ' + ov.over + ' — currently: ' + bowlerName;

  document.getElementById('post-over-bowler-reason-modal').style.display = 'flex';
});

/* ── 2. Reason step buttons ── */
document.getElementById('pobr-wrong-btn').addEventListener('click', function() {
  document.getElementById('post-over-bowler-reason-modal').style.display = 'none';
  _postOverEdit.mode = 'correct';
  openPostOverBowlerPick();
});

document.getElementById('pobr-split-btn').addEventListener('click', function() {
  document.getElementById('post-over-bowler-reason-modal').style.display = 'none';
  _postOverEdit.mode = 'split';
  // For split we need two bowlers — open picker for bowler A first, then B
  _postOverEdit.bowlerA = null;
  _postOverEdit.bowlerB = null;
  document.getElementById('pobp-title').textContent = '🎳 Bowler A — balls bowled first';
  openPostOverBowlerPick();
});

document.getElementById('pobr-cancel-btn').addEventListener('click', function() {
  document.getElementById('post-over-bowler-reason-modal').style.display = 'none';
});

/* ── 3. Bowler picker ── */
function openPostOverBowlerPick() {
  var ov = state.overHistory[_postOverEdit.overIdx];

  // Build list — all known bowlers
  var html = '';
  if (state.bowling.bowlers.length) {
    html += '<div class="bowler-select-divider">Select from known bowlers</div>';
    state.bowling.bowlers.forEach(function(b) {
      html += '<button class="bowler-select-item" data-pobp-id="' + b.id + '">' +
        '<span>' + esc(b.name) + '</span>' +
        '<span class="bsi-figures">' + fmtBowlerFigures(b) + '</span>' +
        '</button>';
    });
  }
  html += '<div class="bowler-select-divider">New bowler</div>';
  html += '<div style="display:flex;gap:6px;align-items:center">' +
    '<input type="text" class="player-input-field" id="pobp-name-input" placeholder="Enter name" autocomplete="off" style="margin-bottom:0;flex:1">' +
    '<button class="modal-confirm-btn" id="pobp-add-btn" style="flex-shrink:0;padding:12px 14px">Add</button>' +
    '</div>';

  var listEl = document.getElementById('pobp-list');
  listEl.innerHTML = html;
  document.getElementById('pobp-error').textContent = '';

  // Bind list item clicks
  listEl.querySelectorAll('[data-pobp-id]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      postOverPickBowler(parseInt(this.dataset.pobpId), null);
    });
  });

  // Bind add button
  document.getElementById('pobp-add-btn').addEventListener('click', function() {
    var name = (document.getElementById('pobp-name-input').value || '').trim();
    if (!name) { document.getElementById('pobp-error').textContent = 'Enter a name.'; return; }
    // Check if name already exists
    var match = state.bowling.bowlers.find(function(b) { return b.name.toLowerCase() === name.toLowerCase(); });
    if (match) {
      postOverPickBowler(match.id, null);
    } else {
      // Create new bowler
      var created = newBowler(name);
      state.bowling.bowlers.push(created);
      postOverPickBowler(created.id, null);
    }
  });

  document.getElementById('pobp-name-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('pobp-add-btn').click();
  });

  document.getElementById('post-over-bowler-pick-modal').style.display = 'flex';
}

document.getElementById('pobp-close').addEventListener('click', function() {
  document.getElementById('post-over-bowler-pick-modal').style.display = 'none';
  _postOverEdit.mode = null;
});

function postOverPickBowler(bowlerId, bowlerName) {
  // Resolve bowler object
  var bowler = bowlerId
    ? state.bowling.bowlers.find(function(b) { return b.id === bowlerId; })
    : state.bowling.bowlers.find(function(b) { return b.name === bowlerName; });
  if (!bowler) return;

  document.getElementById('post-over-bowler-pick-modal').style.display = 'none';

  if (_postOverEdit.mode === 'correct') {
    // ── Wrong selection: reassign every ball in this over to bowler ──────────
    applyPostOverCorrection(_postOverEdit.overIdx, bowler, null, null);

  } else if (_postOverEdit.mode === 'split') {
    if (!_postOverEdit.bowlerA) {
      // First pick = Bowler A
      _postOverEdit.bowlerA = bowler;
      // Now pick Bowler B
      document.getElementById('pobp-title').textContent = '🎳 Bowler B — balls bowled after change';
      openPostOverBowlerPick();
    } else {
      // Second pick = Bowler B — open ball attribution modal
      _postOverEdit.bowlerB = bowler;
      openPostOverSplitModal();
    }
  }
}

/* ── 4. Split ball-attribution modal ── */
function openPostOverSplitModal() {
  var ov    = state.overHistory[_postOverEdit.overIdx];
  var bA    = _postOverEdit.bowlerA;
  var bB    = _postOverEdit.bowlerB;

  // Default: first half to A, second half to B, seeded from existing bowlerIds if present
  _postOverEdit.ballOwners = ov.balls.map(function(ball) {
    if (ball.bowlerId === bB.id) return 'B';
    if (ball.bowlerId === bA.id) return 'A';
    return 'A'; // default
  });

  document.getElementById('pos-title').textContent = '🔀 Over ' + ov.over + ' — Split Attribution';
  document.getElementById('pos-desc').textContent =
    'Tap each ball to toggle between ' + bA.name + ' (A) and ' + bB.name + ' (B).';

  // Bowler legend
  document.getElementById('pos-bowler-labels').innerHTML =
    '<span style="background:var(--gold);color:#000;padding:3px 8px;border-radius:4px;font-weight:700">A: ' + esc(bA.name) + '</span>' +
    '<span style="background:var(--accent2,#4a90d9);color:#fff;padding:3px 8px;border-radius:4px;font-weight:700">B: ' + esc(bB.name) + '</span>';

  renderPostOverSplitBalls();
  document.getElementById('pos-error').textContent = '';
  document.getElementById('post-over-split-modal').style.display = 'flex';
}

function renderPostOverSplitBalls() {
  var ov = state.overHistory[_postOverEdit.overIdx];
  var bA = _postOverEdit.bowlerA;
  var bB = _postOverEdit.bowlerB;

  var el = document.getElementById('pos-balls');
  el.innerHTML = ov.balls.map(function(ball, i) {
    var owner = _postOverEdit.ballOwners[i];
    var base  = ballChipClass(ball);
    var style = owner === 'B'
      ? 'outline:3px solid #4a90d9;outline-offset:2px'
      : 'outline:3px solid var(--gold);outline-offset:2px';
    var ownerLabel = '<span style="font-size:0.55rem;display:block;line-height:1;margin-top:1px">' + owner + '</span>';
    return '<div class="' + base + '" data-pos-idx="' + i + '" style="cursor:pointer;width:44px;height:44px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;' + style + '">' +
      ballChipLabel(ball) + ownerLabel +
      '</div>';
  }).join('');

  // Summary
  var countA = _postOverEdit.ballOwners.filter(function(o) { return o === 'A'; }).length;
  var countB = _postOverEdit.ballOwners.filter(function(o) { return o === 'B'; }).length;
  document.getElementById('pos-summary').textContent =
    bA.name + ': ' + countA + ' ball' + (countA !== 1 ? 's' : '') +
    '   ·   ' + bB.name + ': ' + countB + ' ball' + (countB !== 1 ? 's' : '');

  // Bind toggle
  el.querySelectorAll('[data-pos-idx]').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var i = parseInt(this.dataset.posIdx);
      _postOverEdit.ballOwners[i] = _postOverEdit.ballOwners[i] === 'A' ? 'B' : 'A';
      renderPostOverSplitBalls();
    });
  });
}

document.getElementById('pos-close').addEventListener('click', function() {
  document.getElementById('post-over-split-modal').style.display = 'none';
});
document.getElementById('pos-cancel').addEventListener('click', function() {
  document.getElementById('post-over-split-modal').style.display = 'none';
});

document.getElementById('pos-confirm').addEventListener('click', function() {
  var bA = _postOverEdit.bowlerA;
  var bB = _postOverEdit.bowlerB;
  var owners = _postOverEdit.ballOwners;
  var hasA = owners.some(function(o) { return o === 'A'; });
  var hasB = owners.some(function(o) { return o === 'B'; });
  if (!hasA || !hasB) {
    document.getElementById('pos-error').textContent = 'Assign at least one ball to each bowler.';
    return;
  }
  document.getElementById('post-over-split-modal').style.display = 'none';
  applyPostOverCorrection(_postOverEdit.overIdx, bA, bB, owners);
});

/* ── 5. Apply correction ── */
function applyPostOverCorrection(overIdx, bowlerA, bowlerB, owners) {
  var ov = state.overHistory[overIdx];

  if (!bowlerB) {
    // ── Simple correction: all balls → bowlerA ────────────────────────────
    ov.balls.forEach(function(ball) {
      ball.bowler   = bowlerA.name;
      ball.bowlerId = bowlerA.id;
    });
    ov.bowler       = bowlerA.name;
    ov.bowlerId     = bowlerA.id;
    ov.split        = false;
    ov.splitBowlers = null;

  } else {
    // ── Split correction: attribute by owners array ───────────────────────
    ov.balls.forEach(function(ball, i) {
      var b = owners[i] === 'B' ? bowlerB : bowlerA;
      ball.bowler   = b.name;
      ball.bowlerId = b.id;
    });
    // Collect names in order of first appearance
    var seenIds = [], splitNames = [];
    ov.balls.forEach(function(ball) {
      if (seenIds.indexOf(ball.bowlerId) === -1) {
        seenIds.push(ball.bowlerId);
        splitNames.push(ball.bowler);
      }
    });
    ov.bowler       = bowlerA.name;  // primary
    ov.bowlerId     = bowlerA.id;
    ov.split        = true;
    ov.splitBowlers = splitNames;
  }

  // Recalculate all stats from scratch
  recalculateBowlerStats();

  // Persist
  saveState();
  syncScore();
  updateScoringUI();

  // Refresh the over-edit modal view if it's still open
  if (editingOverIdx === overIdx) {
    renderOverEditBalls(state.overHistory[overIdx]);
    // Update title to reflect new bowler
    var newLabel = ov.split ? ov.splitBowlers.join(' / ') : ov.bowler;
    document.getElementById('over-edit-title').textContent = '✏️ Over ' + ov.over + ' — ' + newLabel;
  }

  showToast('✅ Over ' + ov.over + ' bowler updated — stats recalculated');
}

/* ══════════════════════════════════════════════════════
   QUICK WIN 1 — FORMAT SELECTOR
   T10 / T20 / 40 ov / Custom buttons set the overs input.
   Input is always visible so the scorer can confirm/edit.
══════════════════════════════════════════════════════ */
(function() {
  var fmtBtns  = document.querySelectorAll('#format-btns .toss-btn');
  var oversInput = document.getElementById('setup-overs');

  fmtBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      fmtBtns.forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      var overs = this.dataset.overs;
      if (overs !== '') {
        oversInput.value = overs;
      } else {
        // Custom — clear and focus so scorer types their value
        oversInput.value = '';
        oversInput.focus();
      }
    });
  });

  // If user edits the input manually, deselect presets unless it matches one
  oversInput.addEventListener('input', function() {
    var val = this.value;
    var matched = false;
    fmtBtns.forEach(function(btn) {
      if (btn.dataset.overs === val) { btn.classList.add('active'); matched = true; }
      else btn.classList.remove('active');
    });
    if (!matched) {
      document.getElementById('fmt-custom').classList.add('active');
    }
  });
})();

/* ══════════════════════════════════════════════════════
   QUICK WIN 2 — UNDO END OF INNINGS
   Adds an "↩ Undo — resume 1st innings" option to the
   end-innings modal (only visible during 2nd innings,
   before any balls have been bowled in it).
══════════════════════════════════════════════════════ */
(function() {
  // Patch openEndInningsModal to inject undo option
  var _origOpen = openEndInningsModal;
  openEndInningsModal = function() {
    _origOpen();

    // Offer undo only if we just started 2nd innings (no balls yet, no wickets, no runs)
    var canUndo = state.innings === 2 &&
                  state.runs === 0 &&
                  state.wickets === 0 &&
                  state.overs === 0 &&
                  state.balls === 0 &&
                  state.firstInningsScore !== null;
    if (!canUndo) return;

    var list = document.getElementById('end-innings-options');
    var divider = document.createElement('div');
    divider.style.cssText = 'font-size:0.6rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted);padding:8px 0 4px;margin-top:4px;border-top:1px solid var(--border)';
    divider.textContent = 'Undo';
    list.appendChild(divider);

    var btn = document.createElement('button');
    btn.className = 'bowler-select-item';
    btn.innerHTML = '↩ Resume 1st innings — undo innings end';
    btn.style.color = 'var(--gold)';
    btn.addEventListener('click', function() {
      document.getElementById('end-innings-modal').style.display = 'none';
      undoEndInnings();
    });
    list.appendChild(btn);
  };
})();

function undoEndInnings() {
  if (!firstInnings()) { showToast('Nothing to undo'); return; }

  // Restore 1st innings state from snapshots
  state.innings     = 1;
  state.runs        = state.firstInningsScore.runs;
  state.wickets     = state.firstInningsScore.wickets;
  state.overs       = state.firstInningsScore.overs;
  state.balls       = state.firstInningsScore.balls;
  state.extras      = JSON.parse(JSON.stringify(state.firstInningsScore.extras || {}));
  state.target      = null;
  state.battingTeam = state.battingTeam === 'tcc' ? 'opp' : 'tcc'; // flip back

  // Restore batting/bowling snapshots
  if (state.firstInningsBatting) state.batting  = JSON.parse(JSON.stringify(state.firstInningsBatting));
  if (state.firstInningsBowling) state.bowling  = JSON.parse(JSON.stringify(state.firstInningsBowling));

  // Clear 2nd innings snapshots
  state.firstInningsScore   = null;
  state.firstInningsBatting = null;
  state.firstInningsBowling = null;
  state.currentOverBalls    = [];
  state.overExtended        = false;

  saveState(); syncScore(); updateScoringUI(); updatePlayerBar();
  showToast('↩ 1st innings resumed', 2500);
}

/* ══════════════════════════════════════════════════════
   QUICK WIN 3 — MANHATTAN CHART
   Renders a canvas bar chart of runs-per-over from
   overHistory. Shown inside the scorecard modal.
   Called by openScorerScorecard().
══════════════════════════════════════════════════════ */
function renderManhattan() {
  var history = state.overHistory || [];
  var wrap    = document.getElementById('scorer-manhattan-wrap');
  var canvas  = document.getElementById('scorer-manhattan-canvas');
  if (!history.length) { wrap.style.display = 'none'; return; }

  wrap.style.display = 'block';

  // Size canvas to actual rendered width
  var W = canvas.offsetWidth || 300;
  var H = 80;
  canvas.width  = W;
  canvas.height = H;

  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  var maxRuns = Math.max.apply(null, history.map(function(o) { return o.runs; }));
  maxRuns     = Math.max(maxRuns, 6); // minimum scale of 6

  var padL    = 22;   // left for y-axis labels
  var padR    = 4;
  var padT    = 4;
  var padB    = 16;   // bottom for over numbers
  var chartW  = W - padL - padR;
  var chartH  = H - padT - padB;
  var n       = history.length;
  var barW    = Math.max(2, chartW / n - 2);
  var gap     = (chartW - barW * n) / (n + 1);

  // Gold colour from CSS var — fall back to literal
  var goldColor  = '#C9A84C';
  var mutedColor = 'rgba(255,255,255,0.15)';
  var textColor  = 'rgba(255,255,255,0.4)';

  // Y gridlines at 0, maxRuns/2, maxRuns
  [0, Math.round(maxRuns / 2), maxRuns].forEach(function(val) {
    var y = padT + chartH - (val / maxRuns) * chartH;
    ctx.strokeStyle = mutedColor;
    ctx.lineWidth   = 0.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle   = textColor;
    ctx.font        = '9px sans-serif';
    ctx.textAlign   = 'right';
    ctx.fillText(val, padL - 3, y + 3);
  });

  // Bars
  history.forEach(function(ov, i) {
    var x    = padL + gap + i * (barW + gap);
    var barH = (ov.runs / maxRuns) * chartH;
    var y    = padT + chartH - barH;

    // Wicket overs slightly darker
    var alpha = ov.wickets ? '0.9' : '0.75';
    ctx.fillStyle = 'rgba(201,168,76,' + alpha + ')';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, barW, barH, [2,2,0,0])
                  : ctx.rect(x, y, barW, barH);
    ctx.fill();

    // Run total above bar (only if bar tall enough)
    if (barH > 12) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.font      = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ov.runs, x + barW / 2, y + 10);
    }

    // Wicket dot
    if (ov.wickets) {
      ctx.fillStyle = '#E53935';
      ctx.beginPath();
      ctx.arc(x + barW / 2, padT + chartH - barH - 5, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Over label below
    if (n <= 30 || i % 5 === 0 || i === n - 1) {
      ctx.fillStyle = textColor;
      ctx.font      = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ov.over, x + barW / 2, H - 3);
    }
  });
}

// Patch openScorerScorecard — Manhattan chart + worm + share/social button visibility
var _origOpenScorecard = openScorerScorecard;
openScorerScorecard = function() {
  _origOpenScorecard();
  // Show/hide share button
  var shareBtn = document.getElementById('scorer-scorecard-share');
  if (shareBtn) shareBtn.style.display = state.liveScoreId ? 'inline-flex' : 'none';
  // Always show social card button when there's scoring data
  var socialBtn = document.getElementById('scorer-scorecard-social');
  if (socialBtn) {
    var hasScoringData = state.runs > 0 || state.overs > 0 || state.firstInningsScore;
    socialBtn.style.display = hasScoringData ? 'inline-flex' : 'none';
  }
  // Show WhatsApp text share whenever there's scoring data
  var waBtn = document.getElementById('scorer-scorecard-whatsapp');
  if (waBtn) {
    var hasScoringData2 = state.runs > 0 || state.overs > 0 || state.firstInningsScore;
    waBtn.style.display = hasScoringData2 ? 'inline-flex' : 'none';
  }
  // Render charts after modal layout settles
  setTimeout(function() {
    renderManhattan();
    renderWorm();
  }, 80);
};

document.getElementById('scorer-scorecard-share').addEventListener('click', function() {
  var id = state.liveScoreId;
  if (!id) { showToast('No live match ID — score at least one ball first'); return; }
  var url = window.location.origin + '/live.html?match=' + id;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function() {
      showToast('🔗 Link copied!', 2500);
    }).catch(function() { prompt('Copy this link:', url); });
  } else {
    prompt('Copy this link:', url);
  }
});

/* ══════════════════════════════════════════════════════
   BACK TO FIXTURES — wrong match recovery
   Shows ← in topbar only while scoring is active.
   Silently goes back if nothing scored yet.
   Asks for confirmation if balls have been bowled,
   then DELETEs the Supabase row and clears state.
══════════════════════════════════════════════════════ */

// Patch showScreen to control back button visibility
var _origShowScreen = showScreen;
showScreen = function(id) {
  _origShowScreen(id);
  var backBtn = document.getElementById('scoring-back-btn');
  if (backBtn) backBtn.style.display = (id === 'scoring') ? 'inline-flex' : 'none';
};

/* Balls recorded in the WHOLE match, both innings.

   This used to count the current innings only. Ending the first innings
   snapshots it into firstInnings* and resets runs, wickets, currentOverBalls
   and overHistory — so at the start of the second innings the match looked
   completely empty, and the back arrow deleted both innings without asking. */
function matchBallCount() {
  var count = function (hist) {
    return (hist || []).reduce(function (n, ov) { return n + ((ov.balls || []).length); }, 0);
  };
  var total = (state.currentOverBalls || []).length + count(state.overHistory) + count(state.firstInningsOverHistory);
  /* Fallback for a match whose first innings was snapshotted by an older
     build, where the final part-over's balls were not kept. */
  if (!total && firstInnings()) {
    total = (state.firstInningsScore.overs || 0) * ballsPerSet() + (state.firstInningsScore.balls || 0);
  }
  return total;
}

/* Anything at all worth keeping? Being past the first innings counts even if
   the second innings has not started, because the first innings is real. */
function matchHasScoring() {
  if (matchBallCount() > 0) return true;
  if (state.runs > 0 || state.wickets > 0) return true;
  if (state.innings > 1 || firstInnings()) return true;
  return false;
}

document.getElementById('scoring-back-btn').addEventListener('click', function() {
  var totalBalls = matchBallCount();

  if (!matchHasScoring()) {
    /* Nothing has been scored. The empty row still has to go, or the fixture
       stays "live" and every future attempt to score it hits the takeover PIN
       prompt with no way past. But say so, rather than appearing to delete a
       match with no warning. */
    if (state.liveScoreId) showToast('Match closed — nothing had been scored yet', 3000);
    doAbandonMatch(false);
  } else {
    /* A scored match is never deleted from the back arrow. Deleting is for
       "wrong fixture", which is a first-ball mistake; by the time balls are
       in, the overwhelmingly likely intent is to leave the screen, not to
       destroy the match. The delete is still available from Menu if it really
       was the wrong fixture. */
    _abandonOfferKeep = true;
    // Balls have been scored — confirm first
    var fx   = state.fixture || {};
    var name = (fx.team || 'TCC') + ' vs ' + (fx.opponent || 'Opponents');
    var inn  = state.innings === 2 ? '2nd innings' : '1st innings';
    var first = firstInnings();
    document.getElementById('abandon-match-summary').textContent =
      name + '\nCurrently: ' + state.runs + '/' + state.wickets +
      ' (' + state.overs + '.' + state.balls + ' ov) — ' + inn +
      (first ? '\n1st innings: ' + first.runs + '/' + first.wickets +
               ' (' + first.overs + '.' + first.balls + ' ov)' : '');
    document.getElementById('abandon-match-warning').textContent =
      'Deleting cannot be undone — there is no backup of a deleted match.';
    document.getElementById('abandon-sub-label').textContent =
      'All ' + totalBalls + ' recorded ball' + (totalBalls !== 1 ? 's' : '') +
      ' will be destroyed, on every device';
    document.getElementById('abandon-match-modal').style.display = 'flex';
  }
});

var _abandonOfferKeep = false;

/* Binds only if the element is there. index.html and scoring.js are separate
   files and can be deployed (or cached) out of step; without this, one missing
   element throws and every listener defined after it silently never binds. */
function on(id, ev, fn) {
  var el = document.getElementById(id);
  if (el) el.addEventListener(ev, fn);
  else console.warn('Missing element: ' + id + ' — is index.html up to date?');
  return !!el;
}

function closeAbandonModal() {
  document.getElementById('abandon-match-modal').style.display = 'none';
  var g = document.getElementById('abandon-type-guard');
  if (g) { g.style.display = 'none'; document.getElementById('abandon-type-input').value = ''; }
  _abandonOfferKeep = false;
}
on('abandon-cancel-btn', 'click', closeAbandonModal);

/* Leave the screen but keep the match — what the back arrow used to make
   impossible once any ball had been scored. */
on('abandon-keep-btn', 'click', function() {
  closeAbandonModal();
  saveState();
  showScreen('fixtures');
  loadFixtures();
  showToast('Match kept — resume it from the fixture list', 3000);
});

/* Deleting now takes a typed confirmation. A sheet that cannot scroll, or a
   mis-tap in the sun, must not be able to destroy a day's scoring. */
on('abandon-confirm-btn', 'click', function() {
  var guard = document.getElementById('abandon-type-guard');
  var input = document.getElementById('abandon-type-input');
  if (guard.style.display === 'none') {
    guard.style.display = 'block';
    input.value = '';
    input.focus();
    return;
  }
  if (input.value.trim().toUpperCase() !== 'DELETE') {
    document.getElementById('abandon-type-error').textContent = 'Type DELETE to confirm, or cancel above.';
    return;
  }
  closeAbandonModal();
  doAbandonMatch(true);
});

async function doAbandonMatch(showFeedback) {
  var idToDelete = state.liveScoreId;

  /* Keep a local copy of anything that was actually scored before wiping.
     The Supabase row is hard-deleted and there is no backup of it, so without
     this a delete is final. Written under its own key so starting the next
     match cannot overwrite it. */
  try {
    var scored = (state.currentOverBalls || []).length +
      (state.overHistory || []).reduce(function (n, ov) { return n + ((ov.balls || []).length); }, 0);
    if (scored > 0 || state.runs > 0 || state.wickets > 0) {
      var bin = [];
      try { bin = JSON.parse(localStorage.getItem('tcc_scorer_deleted') || '[]'); } catch (e) { bin = []; }
      bin.unshift({ deletedAt: new Date().toISOString(), liveScoreId: idToDelete, state: state });
      localStorage.setItem('tcc_scorer_deleted', JSON.stringify(bin.slice(0, 5)));
    }
  } catch (e) { console.warn('Could not keep a copy of the deleted match:', e); }

  // Clear all local state immediately so scorer can start fresh
  clearSavedState();
  state.liveScoreId   = null;
  state.fixture       = null;
  state.runs          = 0; state.wickets    = 0;
  state.overs         = 0; state.balls      = 0;
  state.innings       = 1; state.target     = null;
  state.overHistory   = []; state.currentOverBalls = [];
  state.batting       = { striker: null, nonStriker: null, dismissed: [], fow: [] };
  state.bowling       = { current: null, bowlers: [] };
  state.firstInningsBatting    = null;
  state.firstInningsBowling    = null;
  state.firstInningsScore      = null;
  state.firstInningsOverHistory = null;
  state.matchPin      = null;
  state.isSuperOver   = false;
  state.superOverNum  = 0;
  state.toss          = null;
  state._matchResult  = null;   // a new match must not inherit the last result
  state._finalResult  = null;

  showScreen('fixtures');
  loadFixtures();

  if (showFeedback) showToast('Match removed — select the correct fixture', 3000);

  // Delete the Supabase row — it was a mistake, not a real result.
  // This must go through the worker: live_scores has no anon write policy, so
  // a direct DELETE with the anon key was silently refused, leaving a phantom
  // "live" match showing on the public page.
  if (idToDelete) {
    try {
      await workerCall('scoring.abandon', { id: idToDelete });
    } catch (e) {
      console.warn('Could not delete abandoned match row:', e.message);
      showToast('Match cleared here, but it may still show on the live page', 4000);
    }
  }
}

/* ══════════════════════════════════════════════════════
   HELP / USER GUIDE
══════════════════════════════════════════════════════ */
document.getElementById('help-btn').addEventListener('click', function() {
  window.open('./scorer-user-guide.html', '_blank');
});

/* ══════════════════════════════════════════════════════
   PITCH REGION
   Optional direction input per ball (Off / Cover / Straight
   / Leg / Fine). Stamps a `region` field onto the ball event.
   Resets automatically after each ball. No scoring impact.
══════════════════════════════════════════════════════ */
var pendingRegion = null;

document.querySelectorAll('.region-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var r = this.dataset.region;
    if (pendingRegion === r) {
      pendingRegion = null;
      document.querySelectorAll('.region-btn').forEach(function(b) { b.classList.remove('active'); });
    } else {
      pendingRegion = r;
      document.querySelectorAll('.region-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.region === r);
      });
    }
  });
});

function clearPendingRegion() {
  pendingRegion = null;
  document.querySelectorAll('.region-btn').forEach(function(b) { b.classList.remove('active'); });
}

/* ══════════════════════════════════════════════════════
   WORM CHART
   Cumulative runs per over, both innings if available.
   1st innings = gold dashed, 2nd innings = blue solid.
══════════════════════════════════════════════════════ */
function renderWorm() {
  var inn1History = state.firstInningsOverHistory || [];
  var inn2History = state.overHistory || [];
  var wrap   = document.getElementById('scorer-worm-wrap');
  var canvas = document.getElementById('scorer-worm-canvas');
  if (!wrap || !canvas) return;

  if (!inn1History.length && !inn2History.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  var W = canvas.offsetWidth || 300;
  var H = 80;
  canvas.width  = W;
  canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  var padL = 24, padR = 6, padT = 6, padB = 16;
  var cW = W - padL - padR;
  var cH = H - padT - padB;

  function cumulative(history) {
    var a = [0];
    history.forEach(function(ov) { a.push(a[a.length-1] + (ov.runs || 0)); });
    return a;
  }

  var c1 = inn1History.length ? cumulative(inn1History) : [];
  var c2 = inn2History.length ? cumulative(inn2History) : [];
  var maxVal = Math.max(
    c1.length ? c1[c1.length-1] : 0,
    c2.length ? c2[c2.length-1] : 0, 1
  );
  maxVal = Math.ceil(maxVal * 1.1);
  var maxOv = Math.max(inn1History.length, inn2History.length, 1);

  var mutedC = 'rgba(255,255,255,0.08)';
  var textC  = 'rgba(255,255,255,0.28)';

  // Grid lines
  [0, Math.round(maxVal/2), maxVal].forEach(function(v) {
    var y = padT + cH - (v/maxVal)*cH;
    ctx.strokeStyle = mutedC; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W-padR, y); ctx.stroke();
    ctx.fillStyle = textC; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(v, padL-3, y+3);
  });

  // Draw one line from cumulative array
  function drawLine(cums, color, dashed) {
    if (cums.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.setLineDash(dashed ? [4,3] : []);
    ctx.beginPath();
    cums.forEach(function(v, i) {
      var x = padL + (i/maxOv)*cW;
      var y = padT + cH - (v/maxVal)*cH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    // End dot
    var lx = padL + ((cums.length-1)/maxOv)*cW;
    var ly = padT + cH - (cums[cums.length-1]/maxVal)*cH;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI*2); ctx.fill();
  }

  if (c1.length) drawLine(c1, 'rgba(201,168,76,0.85)', !!c2.length);
  if (c2.length) drawLine(c2, 'rgba(74,144,217,0.9)',  false);

  // X-axis over labels
  ctx.fillStyle = textC; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
  for (var i = 0; i <= maxOv; i++) {
    if (i === 0 || i % 5 === 0 || i === maxOv) {
      ctx.fillText(i, padL + (i/maxOv)*cW, H-3);
    }
  }

  // Legend (only when both innings have data)
  if (c1.length && c2.length) {
    ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(201,168,76,0.85)';
    ctx.fillText('-- 1st Inn', padL+4, padT+10);
    ctx.fillStyle = 'rgba(74,144,217,0.9)';
    ctx.fillText('— 2nd Inn', padL+58, padT+10);
  }
}

/* ══════════════════════════════════════════════════════
   SOCIAL GRAPHIC EXPORT
   640×640 canvas card: TCC branding, result, scores,
   top performers. Web Share API on mobile, download fallback.
══════════════════════════════════════════════════════ */

// Helper — rounded rectangle path
function _rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);   ctx.arcTo(x+w, y,   x+w, y+r,   r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h);   ctx.arcTo(x,   y+h, x,   y+h-r, r);
  ctx.lineTo(x, y+r);     ctx.arcTo(x,   y,   x+r, y,     r);
  ctx.closePath();
}

function exportSocialGraphic() {
  var fx  = state.fixture || {};
  var SZ  = 640;
  var c   = document.createElement('canvas');
  c.width = SZ; c.height = SZ;
  var ctx = c.getContext('2d');

  var NAVY   = '#0B1F3A';
  var NAVY2  = '#0F2647';
  var GOLD   = '#C9A84C';
  var GOLD2  = '#E0BC5A';
  var WHITE  = '#F2EDE3';
  var MUTED  = '#6E737F';
  var GREEN  = '#2E7D4F';
  var RED    = '#8B2020';

  // ── Background ─────────────────────────────────────
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, SZ, SZ);

  // Diagonal accent — large gold triangle bottom-right
  ctx.fillStyle = 'rgba(201,168,76,0.04)';
  ctx.beginPath();
  ctx.moveTo(SZ, SZ*0.45);
  ctx.lineTo(SZ, SZ);
  ctx.lineTo(SZ*0.3, SZ);
  ctx.closePath();
  ctx.fill();

  // ── Gold top bar ────────────────────────────────────
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, SZ, 10);

  // ── Club header ─────────────────────────────────────
  ctx.fillStyle = GOLD;
  ctx.font = 'bold 11px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('TYGERBERG CRICKET CLUB', 24, 36);

  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '11px Arial, sans-serif';
  var metaParts = [];
  if (fx.date)     metaParts.push(fmtDate(fx.date));
  if (fx.venue)    metaParts.push(fx.venue);
  if (fx.division) metaParts.push(fx.division);
  if (metaParts.length) {
    ctx.textAlign = 'right';
    ctx.fillText(metaParts.join('  ·  '), SZ-24, 36);
  }

  // Thin gold rule under header
  ctx.fillStyle = 'rgba(201,168,76,0.35)';
  ctx.fillRect(24, 48, SZ-48, 0.5);

  // ── Result hero (58-190) ────────────────────────────
  var resultText = state._matchResult || '';
  var isWin  = resultText.toLowerCase().indexOf('won')  !== -1;
  var isLoss = resultText.toLowerCase().indexOf('lost') !== -1;
  var isTie  = resultText.toLowerCase().indexOf('tie')  !== -1 ||
               resultText.toLowerCase().indexOf('draw') !== -1;

  // Split result into "X WON" and margin parts
  var resultUpper = resultText.toUpperCase();
  var wonIdx = resultUpper.indexOf(' WON ');
  var lostIdx = resultUpper.indexOf(' WON ') === -1 ? resultUpper.indexOf(' LOST ') : -1;
  var line1 = resultUpper, line2 = '';
  if (wonIdx !== -1) {
    line1 = resultUpper.slice(0, wonIdx + 4);   // e.g. "TCC WON"
    line2 = resultUpper.slice(wonIdx + 5);       // e.g. "BY 34 RUNS"
  } else if (lostIdx !== -1) {
    line1 = resultUpper.slice(0, lostIdx + 5);
    line2 = resultUpper.slice(lostIdx + 6);
  } else if (resultUpper.length > 22) {
    // Long string — break at last space before midpoint
    var mid = Math.floor(resultUpper.length / 2);
    var sp  = resultUpper.lastIndexOf(' ', mid);
    if (sp > 0) { line1 = resultUpper.slice(0, sp); line2 = resultUpper.slice(sp+1); }
  }

  // Accent stripe behind result
  var stripeColor = isWin  ? 'rgba(201,168,76,0.08)' :
                    isLoss ? 'rgba(139,32,32,0.12)' :
                             'rgba(255,255,255,0.04)';
  ctx.fillStyle = stripeColor;
  ctx.fillRect(0, 58, SZ, 138);

  // Left accent bar
  var barColor = isWin ? GOLD : isLoss ? '#8B2020' : MUTED;
  ctx.fillStyle = barColor;
  ctx.fillRect(0, 58, 6, 138);

  var resultColor = isWin ? GOLD2 : isLoss ? '#E07070' : WHITE;
  ctx.fillStyle = resultColor;
  ctx.textAlign = 'left';

  if (line2) {
    ctx.font = 'bold 52px Arial, sans-serif';
    ctx.fillText(line1, 24, 118);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.fillText(line2, 24, 162);
  } else if (resultUpper) {
    ctx.font = 'bold 44px Arial, sans-serif';
    ctx.fillText(resultUpper, 24, 140);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = 'bold 32px Arial, sans-serif';
    ctx.fillText('MATCH SCORECARD', 24, 140);
  }

  // ── Score section (210-360) ─────────────────────────
  var tccName = (fx.team     || 'TCC').toUpperCase();
  var oppName = (fx.opponent || 'OPPONENTS').toUpperCase();
  var fi      = state.firstInningsScore;
  var hasTwoInn = fi && fi.runs !== undefined;

  var tccScore, tccOv, oppScore, oppOv;
  if (hasTwoInn) {
    if (state.battingTeam === 'opp') {
      tccScore = fi.runs + '/' + fi.wickets;          tccOv = fmtOvers(fi.overs, fi.balls);
      oppScore = state.runs + '/' + state.wickets;    oppOv = fmtOvers(state.overs, state.balls);
    } else {
      oppScore = fi.runs + '/' + fi.wickets;          oppOv = fmtOvers(fi.overs, fi.balls);
      tccScore = state.runs + '/' + state.wickets;    tccOv = fmtOvers(state.overs, state.balls);
    }
  } else {
    if (state.battingTeam === 'tcc') {
      tccScore = state.runs + '/' + state.wickets;    tccOv = fmtOvers(state.overs, state.balls);
      oppScore = '—'; oppOv = '';
    } else {
      oppScore = state.runs + '/' + state.wickets;    oppOv = fmtOvers(state.overs, state.balls);
      tccScore = '—'; tccOv = '';
    }
  }

  var scY = 218;

  // TCC score block — left
  ctx.textAlign = 'left';
  ctx.fillStyle = isWin ? GOLD : 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 72px Arial, sans-serif';
  ctx.fillText(tccScore, 24, scY + 72);

  ctx.fillStyle = isWin ? 'rgba(201,168,76,0.65)' : 'rgba(255,255,255,0.35)';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText(tccOv + (tccOv ? ' overs' : ''), 26, scY + 96);

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = 'bold 11px Arial, sans-serif';
  ctx.fillText(tccName, 26, scY + 116);

  // vs — centre
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('vs', SZ/2, scY + 72);

  // Opp score block — right
  ctx.textAlign = 'right';
  ctx.fillStyle = isLoss ? GOLD : 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 72px Arial, sans-serif';
  ctx.fillText(oppScore, SZ-24, scY + 72);

  ctx.fillStyle = isLoss ? 'rgba(201,168,76,0.65)' : 'rgba(255,255,255,0.35)';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText(oppOv + (oppOv ? ' overs' : ''), SZ-26, scY + 96);

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = 'bold 11px Arial, sans-serif';
  ctx.fillText(oppName, SZ-26, scY + 116);

  // Section rule
  ctx.fillStyle = 'rgba(201,168,76,0.25)';
  ctx.fillRect(24, scY + 130, SZ-48, 1);

  // ── Performers (360-560) ────────────────────────────
  var tccBatting = null, tccBowling = null;
  if (hasTwoInn) {
    tccBatting = state.battingTeam === 'opp' ? state.firstInningsBatting : state.batting;
    tccBowling = state.battingTeam === 'opp' ? state.bowling            : state.firstInningsBowling;
  } else {
    if (state.battingTeam === 'tcc') tccBatting = state.batting;
    else                              tccBowling = state.bowling;
  }

  var topBatters = [];
  if (tccBatting) {
    var allBat = (tccBatting.dismissed||[]).concat(
      tccBatting.striker    ? [tccBatting.striker]    : [],
      tccBatting.nonStriker ? [tccBatting.nonStriker] : []
    );
    topBatters = allBat.sort(function(a,b){ return b.runs-a.runs; }).slice(0,3);
  }

  var topBowlers = [];
  if (tccBowling) {
    var allBwl = (tccBowling.bowlers||[]).slice();
    topBowlers = allBwl
      .filter(function(b){ return b.wickets>0; })
      .sort(function(a,b){ return b.wickets-a.wickets || a.runs-b.runs; })
      .slice(0,3);
    if (topBowlers.length < 3) {
      var noWkt = allBwl.filter(function(b){ return b.wickets===0 && b.overs>0; })
        .sort(function(a,b){
          var eA=(a.overs+a.balls/6)>0?a.runs/(a.overs+a.balls/6):99;
          var eB=(b.overs+b.balls/6)>0?b.runs/(b.overs+b.balls/6):99;
          return eA-eB;
        });
      topBowlers = topBowlers.concat(noWkt.slice(0, 3-topBowlers.length));
    }
  }

  var hasBat = topBatters.length > 0;
  var hasBwl = topBowlers.length > 0;

  if (hasBat || hasBwl) {
    var perfStartY = scY + 152;

    // Two-column layout: batting left, bowling right
    var colW = (SZ - 48) / 2 - 10;

    // Column headers
    if (hasBat) {
      ctx.fillStyle = GOLD;
      ctx.font = 'bold 9px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('BATTING', 24, perfStartY);
    }
    if (hasBwl) {
      ctx.fillStyle = GOLD;
      ctx.font = 'bold 9px Arial, sans-serif';
      ctx.textAlign = hasBat ? 'right' : 'left';
      ctx.fillText('BOWLING', hasBat ? SZ-24 : 24, perfStartY);
    }

    var perfRowY = perfStartY + 22;
    var rowH = 36;
    var maxRows = Math.max(topBatters.length, topBowlers.length);

    for (var i = 0; i < maxRows; i++) {
      // Batting row
      if (topBatters[i]) {
        var b = topBatters[i];
        ctx.fillStyle = WHITE;
        ctx.font = '500 15px Arial, sans-serif';
        ctx.textAlign = 'left';
        // Truncate long names
        var bname = b.name.length > 16 ? b.name.slice(0,15)+'.' : b.name;
        ctx.fillText(bname, 24, perfRowY + i*rowH + 16);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '12px Arial, sans-serif';
        ctx.fillText(b.runs + ' (' + b.balls + ')', 24, perfRowY + i*rowH + 32);
      }
      // Bowling row
      if (topBowlers[i]) {
        var bw = topBowlers[i];
        var ov = bw.overs + (bw.balls>0?'.'+bw.balls:'');
        ctx.fillStyle = WHITE;
        ctx.font = '500 15px Arial, sans-serif';
        ctx.textAlign = hasBat ? 'right' : 'left';
        var bwname = bw.name.length > 16 ? bw.name.slice(0,15)+'.' : bw.name;
        ctx.fillText(bwname, hasBat ? SZ-24 : 24, perfRowY + i*rowH + 16);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '12px Arial, sans-serif';
        ctx.fillText(bw.wickets+'/'+bw.runs+' ('+ov+')', hasBat ? SZ-24 : 24, perfRowY + i*rowH + 32);
      }
      // Subtle divider
      if (i < maxRows - 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(24, perfRowY + i*rowH + 38, SZ-48, 0.5);
      }
    }

    // Vertical divider between columns (only if both)
    if (hasBat && hasBwl) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(SZ/2, perfStartY - 8, 1, maxRows*rowH + 20);
    }
  }

  // ── Footer ─────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 604, SZ, 36);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 604, SZ, 1);

  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '11px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('tygerbergcc.co.za', 24, 628);

  ctx.fillStyle = 'rgba(201,168,76,0.5)';
  ctx.font = 'bold 10px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('TCC SCORER', SZ-24, 628);

  // ── Export ─────────────────────────────────────────
  c.toBlob(function(blob) {
    if (!blob) { showToast('Could not generate image'); return; }
    var tccN  = (fx.team||'TCC').replace(/[^a-zA-Z0-9]/g,'_');
    var oppN  = (fx.opponent||'Match').replace(/[^a-zA-Z0-9]/g,'_');
    var date  = fx.date || new Date().toISOString().slice(0,10);
    var fname = 'TCC_' + tccN + '_vs_' + oppN + '_' + date + '.png';
    var file  = new File([blob], fname, {type:'image/png'});

    if (navigator.share && navigator.canShare && navigator.canShare({files:[file]})) {
      navigator.share({ title: 'TCC Match Result', files: [file] })
        .catch(function(e) { if (e.name !== 'AbortError') fallbackDownload(blob, fname); });
    } else {
      fallbackDownload(blob, fname);
    }
  }, 'image/png');
}

function fallbackDownload(blob, fname) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 3000);
  showToast('📸 Match card saved', 2500);
}

document.getElementById('scorer-scorecard-social').addEventListener('click', function() {
  exportSocialGraphic();
});

/* ══════════════════════════════════════════════════════
   PUSH NOTIFICATION DISPATCH
   Fire-and-forget — calls the Cloudflare Worker which
   handles encryption and delivery to all subscribers.
   Never blocks scoring.
══════════════════════════════════════════════════════ */
var PUSH_WORKER_URL = 'https://tcc-admin.bydaries.workers.dev';

function dispatchPushEvent(type, data) {
  if (!navigator.onLine) return;
  var matchId = state.liveScoreId || null;
  var fx = state.fixture || {};
  var liveUrl = matchId
    ? 'https://tygerbergcc.co.za/live.html?match=' + matchId
    : 'https://tygerbergcc.co.za/live.html';

  fetch(PUSH_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'push.dispatch',
      payload: {
        type:    type,
        matchId: matchId,
        title:   data.title || 'TCC Match Update',
        body:    data.body  || '',
        url:     liveUrl
      }
    })
  }).catch(function() {}); // silently ignore network errors
}

/* ══════════════════════════════════════════════════════
   WHATSAPP / PLAIN-TEXT SCORECARD SHARE
   Formats current match state as a shareable text block.
   Uses Web Share API on mobile, clipboard fallback on desktop.
══════════════════════════════════════════════════════ */

function formatTextScorecard() {
  var fx      = state.fixture || {};
  var teamA   = fx.team     || 'TCC';
  var teamB   = fx.opponent || 'Opponents';
  var hasInn2 = state.innings === 2 || (state.firstInningsScore && state.runs > 0);
  var fi      = state.firstInningsScore;
  var isCompleted = !!state._matchResult;

  function oversStr(overs, balls) {
    return balls > 0 ? overs + '.' + balls + ' ov' : overs + ' ov';
  }

  function topBat(batting, bowling, isFirstInn) {
    var dismissed = batting ? (batting.dismissed || []) : [];
    var striker   = batting ? batting.striker   : null;
    var nonStr    = batting ? batting.nonStriker : null;
    var all = dismissed.slice();
    if (striker  && striker.name)  all.push(striker);
    if (nonStr   && nonStr.name)   all.push(nonStr);
    return all
      .filter(function(p) { return p && p.name && (p.runs || 0) >= 10; })
      .sort(function(a,b) { return (b.runs||0) - (a.runs||0); })
      .slice(0, 3)
      .map(function(p) { return p.name + ' ' + (p.runs||0) + '(' + (p.balls||0) + ')'; })
      .join(', ');
  }

  function topBowl(bowling) {
    if (!bowling || !bowling.bowlers) return '';
    return bowling.bowlers
      .filter(function(b) { return b && b.name && ((b.wickets||0) > 0 || (b.overs||0) >= 2); })
      .sort(function(a,b) { return (b.wickets||0) - (a.wickets||0) || (a.runs||0) - (b.runs||0); })
      .slice(0, 3)
      .map(function(b) {
        var o = b.overs || 0;
        return b.name + ' ' + o + '-' + (b.maidens||0) + '-' + (b.runs||0) + '-' + (b.wickets||0);
      })
      .join(', ');
  }

  var lines = [];
  lines.push('🏏 *' + teamA + ' vs ' + teamB + '*');
  if (fx.ground) lines.push('📍 ' + fx.ground);
  lines.push('');

  // 1st innings — TCC bat
  if (fi) {
    var inn1Str = '*' + fi.runs + '/' + fi.wickets + '* (' + oversStr(fi.overs, fi.balls) + ')';
    lines.push('*1st Innings — ' + teamA + '*: ' + inn1Str);
    var bat1 = topBat(state.firstInningsBatting, null, true);
    var bwl1 = topBowl(state.firstInningsBowling);
    if (bat1) lines.push('  🏏 ' + bat1);
    if (bwl1) lines.push('  🎳 ' + bwl1);
    lines.push('');
  }

  // Current / 2nd innings
  var inn2Str = '*' + state.runs + '/' + state.wickets + '* (' + oversStr(state.overs, state.balls) + ')';
  var inn2Label = fi ? '2nd Innings — ' + teamB : '1st Innings — ' + teamA;
  lines.push('*' + inn2Label + '*: ' + inn2Str);
  var bat2 = topBat(state.batting, null, false);
  var bwl2 = topBowl(state.bowling);
  if (bat2) lines.push('  🏏 ' + bat2);
  if (bwl2) lines.push('  🎳 ' + bwl2);
  lines.push('');

  // Target / result
  if (fi && !isCompleted) {
    var target = fi.runs + 1;
    var runsLeft = target - state.runs;
    var maxOvers = state.fixture ? state.fixture.overs : 20;
    var oversLeft = (maxOvers - state.overs) - (state.balls > 0 ? state.balls / 10 : 0);
    lines.push('🎯 *Target:* ' + target + ' · Need ' + Math.max(runsLeft, 0) + ' off ' + (state.fixture ? (maxOvers - state.overs) : '?') + ' ov');
    lines.push('');
  }

  if (isCompleted && state._matchResult) {
    lines.push('🏆 *Result:* ' + state._matchResult);
    var potmT = getPotm();
    if (potmT) lines.push('🏅 *Player of the match:* ' + potmT.name + (potmT.note ? ' (' + potmT.note + ')' : ''));
    lines.push('');
  }

  // Live link
  if (state.liveScoreId) {
    lines.push('📊 ' + window.location.origin + '/live.html?match=' + state.liveScoreId);
  }

  lines.push('_Tygerberg Cricket Club · tygerbergcc.co.za_');
  return lines.join('\n');
}

document.getElementById('scorer-scorecard-whatsapp').addEventListener('click', function() {
  var text = formatTextScorecard();

  if (navigator.share) {
    navigator.share({ text: text })
      .catch(function(err) {
        if (err.name !== 'AbortError') {
          navigator.clipboard && navigator.clipboard.writeText(text).then(function() {
            showToast('📋 Copied to clipboard!', 2500);
          });
        }
      });
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      showToast('📋 Scorecard copied!', 2500);
    }).catch(function() { prompt('Copy this scorecard:', text); });
  } else {
    prompt('Copy this scorecard:', text);
  }
});
