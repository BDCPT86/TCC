/* ════════════════════════════════════════════════════
   TCC FANTASY — LEAGUE INSIGHTS
   Global ownership, captaincy, transfers, differentials,
   chips and Manager of the Week. All derived client-side
   from fantasy_picks + fantasy_scores + fantasy_chip_usage.
════════════════════════════════════════════════════ */
var SUPABASE_URL      = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var H = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY };

var CHIP_META = {
  triple_captain: { icon: '🚀', name: 'Triple Captain' },
  bench_boost:    { icon: '💪', name: 'Bench Boost' },
  budget_boost:   { icon: '💰', name: 'Budget Boost' },
  captain_safety: { icon: '🛡️', name: 'Captain Safety Net' }
};

/* Nav pill scroll shadow */
var navPill = document.getElementById('nav-pill');
window.addEventListener('scroll', function() {
  if (navPill) navPill.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

/* Hamburger drawer */
var hamburger = document.getElementById('hamburger');
var drawer    = document.getElementById('mobile-drawer');
if (hamburger && drawer) {
  hamburger.addEventListener('click', function() {
    hamburger.classList.toggle('open');
    drawer.classList.toggle('open');
  });
}
/* Enter / pick button */
var enterBtn = document.getElementById('nav-enter-btn');
if (enterBtn) enterBtn.addEventListener('click', function(){ location.href = 'pick.html'; });
/* Show My Team link if logged in */
(function(){
  try {
    if (localStorage.getItem('tcc_fantasy_participant')) {
      ['nav-profile-link','drawer-profile-link'].forEach(function(id){
        var el = document.getElementById(id); if (el) el.style.display = '';
      });
    }
  } catch(e){}
})();

/* ── Scoring (mirrors leaderboard.js) ── */
function calcPoints(score, isCaptain, isWildcard, isVC, chip) {
  var pts = 0, runs = score.runs || 0, wkts = score.wickets || 0;
  pts += runs;
  if (runs >= 50)  pts += 10;
  if (runs >= 100) pts += 25;
  pts += wkts * 15;
  if (wkts >= 5) pts += 20;
  if (score.economy != null && score.economy > 0) {
    var e = score.economy;
    pts += e <= 5 ? 10 : e <= 6 ? 6 : e <= 7 ? 2 : e <= 8 ? 0 : e <= 9 ? -2 : -4;
  }
  pts += (score.maidens || 0) * 10;
  pts += (score.catches || 0) * 10;
  pts += (score.stumpings || 0) * 10;
  pts += (score.runouts || 0) * 10;
  if (score.player_of_match) pts += 25;
  if (isCaptain) pts *= (isWildcard || chip === 'triple_captain') ? 3 : 2;
  else if (isVC) pts = Math.round(pts * 1.5);
  return pts;
}

/* Base points (no multipliers) — used by Captain Safety Net check. */
function basePoints(score) {
  return score ? calcPoints(score, false, false, false, null) : 0;
}

/* Resolve effective captain/VC honouring Captain Safety Net. */
function resolveCaptaincy(pick, lookup) {
  var capId = pick.captain_id, vcId = pick.vice_captain_id;
  if (pick.chip === 'captain_safety' && capId && vcId) {
    if (basePoints(lookup[pick.round_id + '_' + capId]) < 10) { capId = pick.vice_captain_id; vcId = null; }
  }
  return { capId: capId, vcId: vcId };
}

/* Total points for one pick, applying all chips. */
function scorePick(pick, lookup, isWildcard) {
  var eff = resolveCaptaincy(pick, lookup);
  var total = 0;
  (pick.player_ids || []).forEach(function(pid) {
    var s = lookup[pick.round_id + '_' + pid];
    if (s) total += calcPoints(s, pid === eff.capId, isWildcard, pid === eff.vcId, pick.chip);
  });
  if (pick.chip === 'bench_boost') total += 25;
  return total;
}

/* ── State ── */
var allRounds = [];      // chronological
var roundsById = {};
var allPicks = [];
var allScores = [];
var allPlayers = {};
var playerMeta = {};     // id → {name, role}
var chipUsage = [];
var currentView = 'season';   // 'season' or a round id

/* ── Load everything ── */
async function load() {
  try {
    var [rounds, picks, scores, players, chips] = await Promise.all([
      fetch(SUPABASE_URL+'/rest/v1/fantasy_rounds?select=id,name,wildcard&order=created_at.asc', {headers:H}).then(function(r){return r.ok?r.json():[];}),
      fetch(SUPABASE_URL+'/rest/v1/fantasy_picks?select=participant_id,round_id,player_ids,captain_id,vice_captain_id,chip,created_at&order=created_at.asc', {headers:H}).then(function(r){return r.ok?r.json():[];}),
      fetch(SUPABASE_URL+'/rest/v1/fantasy_scores?select=*', {headers:H}).then(function(r){return r.ok?r.json():[];}),
      fetch(SUPABASE_URL+'/rest/v1/players?select=id,name,role&active=not.eq.false', {headers:H}).then(function(r){return r.ok?r.json():[];}),
      fetch(SUPABASE_URL+'/rest/v1/fantasy_chip_usage?select=chip,round_id,participant_id', {headers:H}).then(function(r){return r.ok?r.json():[];})
    ]);

    allRounds  = rounds || [];
    allPicks   = picks || [];
    allScores  = scores || [];
    chipUsage  = chips || [];
    (players||[]).forEach(function(p){ allPlayers[p.id] = p.name; playerMeta[p.id] = p; });
    allRounds.forEach(function(r){ roundsById[r.id] = r; });

    buildRoundFilter();
    render();
  } catch (e) {
    console.error('Insights load error', e);
  }
}

/* ── Round filter pills ── */
function buildRoundFilter() {
  var bar = document.getElementById('fs-round-filter');
  if (!bar) return;
  var html = '<button class="fs-rf-btn active" data-view="season">Season</button>';
  // Most recent rounds first for quick access
  allRounds.slice().reverse().forEach(function(r){
    html += '<button class="fs-rf-btn" data-view="'+r.id+'">'+r.name+(r.wildcard?' ⭐':'')+'</button>';
  });
  bar.innerHTML = html;
  bar.querySelectorAll('.fs-rf-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      bar.querySelectorAll('.fs-rf-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      currentView = btn.dataset.view;
      render();
    });
  });
}

/* ── Aggregate a score lookup: roundId_playerId → merged score ── */
function buildScoreLookup() {
  var lookup = {};
  allScores.forEach(function(s){
    var key = s.round_id + '_' + s.player_id;
    if (!lookup[key]) lookup[key] = { runs:0, wickets:0, catches:0, stumpings:0, runouts:0, maidens:0, economy:null, player_of_match:false };
    lookup[key].runs      += s.runs      || 0;
    lookup[key].wickets   += s.wickets   || 0;
    lookup[key].catches   += s.catches   || 0;
    lookup[key].stumpings += s.stumpings || 0;
    lookup[key].runouts   += s.runouts   || 0;
    lookup[key].maidens   += s.maidens   || 0;
    if (s.economy != null && s.economy > 0) lookup[key].economy = s.economy;
    if (s.player_of_match) lookup[key].player_of_match = true;
  });
  return lookup;
}

/* ── Picks in scope (a round or the latest pick per manager for season) ── */
function picksInScope() {
  if (currentView !== 'season') {
    return allPicks.filter(function(p){ return p.round_id === currentView; });
  }
  // Season ownership = most recent pick per participant
  var latest = {};
  allPicks.forEach(function(p){
    if (!latest[p.participant_id]) latest[p.participant_id] = p;
    else {
      var prev = latest[p.participant_id];
      if (new Date(p.created_at) > new Date(prev.created_at)) latest[p.participant_id] = p;
    }
  });
  return Object.keys(latest).map(function(k){ return latest[k]; });
}

/* ── MAIN RENDER ── */
function render() {
  var picks = picksInScope();
  var nManagers = picks.length;

  // Ownership + captaincy counts
  var ownCount = {}, capCount = {};
  picks.forEach(function(pick){
    (pick.player_ids||[]).forEach(function(pid){ ownCount[pid] = (ownCount[pid]||0) + 1; });
    if (pick.captain_id) capCount[pick.captain_id] = (capCount[pick.captain_id]||0) + 1;
  });

  renderBars('fs-owned', ownCount, nManagers, 'own');
  renderBars('fs-captained', capCount, nManagers, 'cap');

  // Transfers — compare currentView round to the previous round.
  renderTransfers();

  // Differentials — low ownership but high points (needs scores)
  renderDifferentials(ownCount, nManagers);

  // Chips
  renderChips();

  // Manager of the week + strip
  renderManagerOfWeek();
  renderStrip(nManagers);
}

/* ── Bar list renderer ── */
function renderBars(elId, counts, total, kind) {
  var el = document.getElementById(elId);
  if (!el) return;
  var arr = Object.keys(counts).map(function(pid){
    return { pid: pid, count: counts[pid], pct: total ? Math.round(counts[pid]/total*100) : 0 };
  }).sort(function(a,b){ return b.count - a.count; }).slice(0, 8);

  if (!arr.length) { el.innerHTML = '<div class="fs-empty">No picks yet</div>'; return; }

  var max = arr[0].pct || 1;
  el.innerHTML = arr.map(function(row){
    var name = allPlayers[row.pid] || 'Unknown';
    var meta = playerMeta[row.pid] || {};
    var w = Math.max(6, Math.round(row.pct / max * 100));
    return '<div class="fs-bar-row">'
      + '<div class="fs-bar-name">'+name+'<span class="fs-bar-role">'+(meta.role||'')+'</span></div>'
      + '<div class="fs-bar-track"><div class="fs-bar-fill '+kind+'" style="width:'+w+'%"></div></div>'
      + '<div class="fs-bar-pct">'+row.pct+'%</div>'
      + '</div>';
  }).join('');
}

/* ── Transfers in/out: diff current round vs previous round ── */
function renderTransfers() {
  var inEl = document.getElementById('fs-in');
  var outEl = document.getElementById('fs-out');

  // Determine target + previous round
  var targetRoundId, prevRoundId;
  if (currentView === 'season') {
    // Use the latest two rounds
    if (allRounds.length < 2) {
      inEl.innerHTML = outEl.innerHTML = '<div class="fs-empty">Need 2+ rounds</div>';
      return;
    }
    targetRoundId = allRounds[allRounds.length-1].id;
    prevRoundId   = allRounds[allRounds.length-2].id;
  } else {
    var idx = allRounds.findIndex(function(r){ return r.id === currentView; });
    if (idx <= 0) {
      inEl.innerHTML = outEl.innerHTML = '<div class="fs-empty">No previous round to compare</div>';
      return;
    }
    targetRoundId = currentView;
    prevRoundId   = allRounds[idx-1].id;
  }

  // Count ownership in each round
  function ownIn(roundId) {
    var c = {};
    allPicks.filter(function(p){ return p.round_id === roundId; })
      .forEach(function(p){ (p.player_ids||[]).forEach(function(pid){ c[pid] = (c[pid]||0)+1; }); });
    return c;
  }
  var cur = ownIn(targetRoundId), prev = ownIn(prevRoundId);
  var diffs = {};
  Object.keys(cur).forEach(function(pid){ diffs[pid] = (cur[pid]||0) - (prev[pid]||0); });
  Object.keys(prev).forEach(function(pid){ if (!(pid in diffs)) diffs[pid] = -(prev[pid]); });

  var ins  = Object.keys(diffs).filter(function(p){return diffs[p]>0;})
              .map(function(p){return {pid:p,d:diffs[p]};}).sort(function(a,b){return b.d-a.d;}).slice(0,6);
  var outs = Object.keys(diffs).filter(function(p){return diffs[p]<0;})
              .map(function(p){return {pid:p,d:diffs[p]};}).sort(function(a,b){return a.d-b.d;}).slice(0,6);

  function paint(el, arr, dir) {
    if (!arr.length) { el.innerHTML = '<div class="fs-empty">No movement</div>'; return; }
    var max = Math.abs(arr[0].d) || 1;
    el.innerHTML = arr.map(function(row){
      var name = allPlayers[row.pid] || 'Unknown';
      var w = Math.max(8, Math.round(Math.abs(row.d)/max*100));
      return '<div class="fs-bar-row">'
        + '<div class="fs-bar-name">'+name+'</div>'
        + '<div class="fs-bar-track"><div class="fs-bar-fill '+(dir==='in'?'tin':'tout')+'" style="width:'+w+'%"></div></div>'
        + '<div class="fs-bar-pct">'+(dir==='in'?'+':'')+row.d+'</div>'
        + '</div>';
    }).join('');
  }
  paint(inEl, ins, 'in');
  paint(outEl, outs, 'out');
}

/* ── Differentials: <15% owned, ranked by points scored in scope ── */
function renderDifferentials(ownCount, nManagers) {
  var el = document.getElementById('fs-diff');
  if (!el) return;
  if (!nManagers) { el.innerHTML = '<div class="fs-empty">No data yet</div>'; return; }

  var lookup = buildScoreLookup();
  // Points per player across scope rounds
  var roundIds = (currentView === 'season') ? allRounds.map(function(r){return r.id;}) : [currentView];
  var ptsByPlayer = {};
  roundIds.forEach(function(rid){
    var wc = roundsById[rid] ? roundsById[rid].wildcard : false;
    Object.keys(allPlayers).forEach(function(pid){
      var s = lookup[rid+'_'+pid];
      if (s) ptsByPlayer[pid] = (ptsByPlayer[pid]||0) + calcPoints(s, false, wc, false, null);
    });
  });

  var arr = Object.keys(ptsByPlayer).map(function(pid){
    var pct = nManagers ? Math.round((ownCount[pid]||0)/nManagers*100) : 0;
    return { pid: pid, pts: ptsByPlayer[pid], pct: pct };
  }).filter(function(r){ return r.pct < 15 && r.pts > 0; })
    .sort(function(a,b){ return b.pts - a.pts; }).slice(0, 6);

  if (!arr.length) { el.innerHTML = '<div class="fs-empty">No standout differentials</div>'; return; }
  var max = arr[0].pts || 1;
  el.innerHTML = arr.map(function(row){
    var name = allPlayers[row.pid] || 'Unknown';
    var w = Math.max(8, Math.round(row.pts/max*100));
    return '<div class="fs-bar-row">'
      + '<div class="fs-bar-name">'+name+'<span class="fs-bar-role">'+row.pct+'% owned</span></div>'
      + '<div class="fs-bar-track"><div class="fs-bar-fill diff" style="width:'+w+'%"></div></div>'
      + '<div class="fs-bar-pct">'+row.pts+'</div>'
      + '</div>';
  }).join('');
}

/* ── Chips played ── */
function renderChips() {
  var el = document.getElementById('fs-chips');
  if (!el) return;
  var scope = (currentView === 'season') ? chipUsage : chipUsage.filter(function(c){ return c.round_id === currentView; });
  var counts = {};
  scope.forEach(function(c){ counts[c.chip] = (counts[c.chip]||0)+1; });

  var keys = Object.keys(CHIP_META);
  var any = keys.some(function(k){ return counts[k]; });
  if (!any) { el.innerHTML = '<div class="fs-empty">No chips played yet</div>'; return; }

  el.innerHTML = keys.map(function(k){
    var meta = CHIP_META[k];
    var n = counts[k] || 0;
    return '<div class="fs-chip-stat'+(n?'':' zero')+'">'
      + '<span class="fs-chip-ic">'+meta.icon+'</span>'
      + '<span class="fs-chip-n">'+n+'</span>'
      + '<span class="fs-chip-nm">'+meta.name+'</span>'
      + '</div>';
  }).join('');
}

/* ── Manager of the Week (highest single-round score) ── */
function renderManagerOfWeek() {
  var box = document.getElementById('fs-motw');
  if (!box) return;

  // Determine which round to evaluate
  var roundId = (currentView === 'season')
    ? (allRounds.length ? allRounds[allRounds.length-1].id : null)
    : currentView;
  if (!roundId) { box.style.display = 'none'; return; }

  var lookup = buildScoreLookup();
  var wc = roundsById[roundId] ? roundsById[roundId].wildcard : false;
  var roundPicks = allPicks.filter(function(p){ return p.round_id === roundId; });
  if (!roundPicks.length) { box.style.display = 'none'; return; }

  // Need participant names
  var best = null;
  roundPicks.forEach(function(pick){
    var total = scorePick(pick, lookup, wc);
    if (!best || total > best.total) best = { pid: pick.participant_id, total: total, chip: pick.chip };
  });

  if (!best || best.total <= 0) { box.style.display = 'none'; return; }

  // Fetch participant name
  fetch(SUPABASE_URL+'/rest/v1/fantasy_participants?id=eq.'+best.pid+'&select=name,team_name', {headers:H})
    .then(function(r){ return r.ok ? r.json() : []; })
    .then(function(rows){
      var p = rows && rows[0] ? rows[0] : {};
      var rn = roundsById[roundId] ? roundsById[roundId].name : 'Latest round';
      document.getElementById('fs-motw-name').textContent = p.team_name || p.name || 'Unknown';
      document.getElementById('fs-motw-sub').textContent  = (p.team_name && p.name ? p.name + ' · ' : '') + rn
        + (best.chip ? ' · ' + CHIP_META[best.chip].icon + ' ' + CHIP_META[best.chip].name : '');
      document.getElementById('fs-motw-pts').textContent  = best.total;
      box.style.display = '';
    }).catch(function(){ box.style.display = 'none'; });
}

/* ── Top-line strip ── */
function renderStrip(nManagers) {
  document.getElementById('fs-stat-managers').textContent = nManagers || '—';

  // Average + highest round score across the scope
  var lookup = buildScoreLookup();
  var roundIds = (currentView === 'season') ? allRounds.map(function(r){return r.id;}) : [currentView];
  var roundTotals = [];
  roundIds.forEach(function(rid){
    var wc = roundsById[rid] ? roundsById[rid].wildcard : false;
    allPicks.filter(function(p){return p.round_id===rid;}).forEach(function(pick){
      roundTotals.push(scorePick(pick, lookup, wc));
    });
  });
  var scored = roundTotals.filter(function(t){ return t > 0; });
  var avg = scored.length ? Math.round(scored.reduce(function(a,b){return a+b;},0)/scored.length) : 0;
  var high = scored.length ? Math.max.apply(null, scored) : 0;

  document.getElementById('fs-stat-avg').textContent  = avg || '—';
  document.getElementById('fs-stat-high').textContent = high || '—';

  var chipScope = (currentView === 'season') ? chipUsage : chipUsage.filter(function(c){ return c.round_id === currentView; });
  document.getElementById('fs-stat-chips').textContent = chipScope.length;
}

load();
