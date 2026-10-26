var SUPABASE_URL      = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var H = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY };

/* Chip metadata — shared across leaderboard, pick screen, stats.
   Keep in sync with chips_migration.sql CHECK constraint. */
var CHIP_META = {
  triple_captain: { icon: '🚀', short: 'Triple Captain', name: 'Triple Captain', desc: 'Your captain scores ×3 instead of ×2 for this round.' },
  bench_boost:    { icon: '💪', short: 'Bench Boost',    name: 'Bench Boost',    desc: 'A flat +25pt safety net added to your round total.' },
  budget_boost:   { icon: '💰', short: 'Budget Boost',   name: 'Budget Boost',   desc: '+R25 to your budget for one round — fit in an extra star.' },
  captain_safety: { icon: '🛡️', short: 'Safety Net',     name: 'Captain Safety Net', desc: 'If your captain scores under 10, your VC is promoted to captain (×2).' }
};

document.querySelectorAll('.copy-year').forEach(function(el){ el.textContent = new Date().getFullYear(); });

/* Nav pill scroll shadow */
var navPill = document.getElementById('nav-pill');
window.addEventListener('scroll', function() {
  if (navPill) navPill.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

/* Hamburger — mobile drawer */
var hamburger   = document.getElementById('hamburger');
var mobileDrawer = document.getElementById('mobile-drawer');
if (hamburger && mobileDrawer) {
  hamburger.addEventListener('click', function() {
    hamburger.classList.toggle('open');
    mobileDrawer.classList.toggle('open');
  });
}

/* Nav CTA */
var navEnterBtn = document.getElementById('nav-enter-btn');
if (navEnterBtn) navEnterBtn.addEventListener('click', function() { window.location.href = 'fantasy.html'; });

/* Hero parallax */
(function() {
  var heroImg   = document.getElementById('lb-hero-img');
  var footerImg = document.getElementById('lb-footer-img');
  var ticking   = false;
  window.addEventListener('scroll', function() {
    if (ticking) return;
    requestAnimationFrame(function() {
      var sy = window.scrollY, wh = window.innerHeight;
      if (heroImg) heroImg.style.transform = 'translate(-50%,-50%) translateY(' + (sy * 0.25) + 'px)';
      if (footerImg) {
        var r = footerImg.closest('.lb-footer-img-section').getBoundingClientRect();
        footerImg.style.transform = 'translateY(' + (((wh - r.top) / (wh + r.height) - 0.5) * -60) + 'px)';
      }
      ticking = false;
    });
    ticking = true;
  }, { passive: true });
})();

/* ══════════════════════════════════════
   POINTS CALCULATION
   All of it now lives in js/fantasy-scoring.js, which the Worker's
   fantasyPickPoints() is held to by fantasy/scoring-parity.mjs. What
   follows are thin wrappers that keep this file's existing call
   signatures working.

   There used to be three separate implementations in THIS file alone —
   calcPoints for the standings, calcLivePts for the live view, and
   calcBreakdown for the explanation — and they disagreed. calcPoints
   ignored round boost modifiers; calcLivePts ignored chips; and
   calcBreakdown, which tells a manager WHY they scored what they did,
   ignored boosts too, so with a boost on it could not add up to the
   total it was explaining.
══════════════════════════════════════ */
var FS = window.FantasyScoring;

/* May this player's NAME appear in a public fantasy graphic?

   Not "did they score" — the admin score grid deliberately keeps
   anyone already scored, so that flagging a player a minor does not
   delete the rows they have already earned. That is right for the
   data and wrong for a poster, so the two questions are asked
   separately. Unknown counts as no: if the view could not be read we
   hide the graphic rather than guess, because the cost of guessing
   wrong is a child's name on a public page. */
function fantasyShowable(playerId) {
  return !!(fantasyEligibleIds && fantasyEligibleIds[playerId]);
}

/* Role for a player id, for the round boost modifiers. */
function roleOfPlayer(playerId) {
  return (allPlayerMeta && allPlayerMeta[playerId] && allPlayerMeta[playerId].role) || '';
}

function calcPoints(score, isCaptain, isWildcard, isVC, chip, boost, role) {
  return FS.playerPoints(score, {
    isCaptain: isCaptain, isVice: isVC,
    captainMultiplier: (isWildcard || chip === 'triple_captain') ? 3 : 2,
    boost: boost || null, role: role || ''
  });
}

function calcBreakdown(score, isCaptain, isWildcard, isVC, chip, boost, role) {
  var triple = (isWildcard || chip === 'triple_captain');
  return FS.breakdown(score, {
    isCaptain: isCaptain, isVice: isVC,
    captainMultiplier: triple ? 3 : 2,
    tripleCaptain: chip === 'triple_captain' && !isWildcard,
    boost: boost || null, role: role || ''
  });
}

/* Raw base points for one player (no captain/VC multiplier, no boost).
   Used by the Captain Safety Net to inspect the captain's base score. */
function basePoints(score) { return FS.basePoints(score, null, ''); }

function resolveCaptaincy(pick, scoreLookup) {
  return FS.resolveCaptaincy(pick, function (id) {
    return FS.basePoints(scoreLookup[pick.round_id + '_' + id], null, '');
  });
}

/* Total points for one pick. `round` carries the boost modifier, which
   the standings used to ignore entirely. */
function pickRoundPoints(pick, scoreLookup, isWildcard, round) {
  return FS.pickPoints(pick, function (id) {
    return scoreLookup[pick.round_id + '_' + id] || null;
  }, {
    wildcard: isWildcard,
    boost:    (round && round.boost_modifier) || null,
    roleOf:   roleOfPlayer
  });
}

/* Live view: stats arrive as overs and runs conceded rather than an
   economy rate. The shared file normalises both, so a live number and
   the filed one agree. */
function calcLivePts(playerStats, isCap, isWC, isVC, boost, role) {
  if (!playerStats) return 0;
  return FS.playerPoints(playerStats, {
    isCaptain: isCap, isVice: isVC,
    captainMultiplier: isWC ? 3 : 2,
    boost: boost || null, role: role || ''
  });
}

/* ══════════════════════════════════════
   GLOBALS
══════════════════════════════════════ */
var allPicks    = [];
var allScores   = [];
var allPlayers  = {};
var allPlayerMeta = {};   // id -> { name, role } for Team of the Week
/* Ids the fantasy_players view will serve: adults, playing members,
   not youth squad. null means we could not find out.

   Team of the Week and Player of the Round are built from
   fantasy_scores and resolve names from `players`, which carries
   everybody — so without this they will print the name of anyone with
   a score row, including a 16-year-old who plays senior cricket. The
   admin score grid will not normally create such a row, but it keeps
   anyone ALREADY scored in the grid so that flagging someone a minor
   does not silently delete their existing rows. That is the right call
   for the data and it is exactly how an ineligible row comes to exist. */
var fantasyEligibleIds = null;
var allRounds   = {};
var scoreLookup = {};
var currentRoundId = 'season';

/* ══════════════════════════════════════
   LOAD ROUNDS
══════════════════════════════════════ */
async function loadRounds() {
  var r      = await fetch(SUPABASE_URL+'/rest/v1/fantasy_rounds?select=id,name,wildcard&order=created_at.asc', {headers:H});
  var rounds = await r.json();
  var bar    = document.getElementById('round-filter');

  if (!bar) return;

  (rounds||[]).forEach(function(round) {
    allRounds[round.id] = round;
    var btn = document.createElement('button');
    btn.className     = 'filter-btn';
    btn.dataset.round = round.id;
    btn.textContent   = round.name + (round.wildcard ? ' ⭐' : '');
    bar.appendChild(btn);
  });

  /* One handler on the bar, not one per pill.

     The Season pill is written into leaderboard.html; the round pills
     are built above. The old code attached a listener inside this
     loop, so only the pills it built could be clicked — pick a round
     and there was no way back to the season table short of reloading
     the page.

     Delegating fixes the one that is broken and makes the next one
     impossible: a pill works because it sits in this bar carrying a
     data-round, not because whoever added it remembered to wire it. */
  bar.addEventListener('click', function(e) {
    var btn = e.target && e.target.closest && e.target.closest('.filter-btn');
    if (!btn || !bar.contains(btn)) return;

    var id = btn.dataset.round;
    if (!id) return;
    /* Clicking the pill you are already on should do nothing, rather
       than re-running every query behind it. */
    if (id === currentRoundId) return;

    bar.querySelectorAll('.filter-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    currentRoundId = id;
    loadLeaderboard(id);
  });
}

/* ══════════════════════════════════════
   LOAD LEADERBOARD
══════════════════════════════════════ */
async function loadLeaderboard(roundId) {
  document.getElementById('lb-loading').style.display   = 'flex';
  document.getElementById('lb-podium').style.display     = 'none';
  document.getElementById('lb-cards-wrap').style.display = 'none';
  document.getElementById('lb-empty').style.display      = 'none';
  document.getElementById('potr-wrap').style.display     = 'none';

  try {
    var picksUrl   = SUPABASE_URL+'/rest/v1/fantasy_picks?select=*,fantasy_participants(name,team_name)';
    var scoresUrl  = SUPABASE_URL+'/rest/v1/fantasy_scores?select=*';
    var playersUrl = SUPABASE_URL+'/rest/v1/players?select=id,name,role,fantasy_value,captain&active=not.eq.false';
    if (roundId !== 'season') { picksUrl += '&round_id=eq.'+roundId; scoresUrl += '&round_id=eq.'+roundId; }

    var [pr, sr, plr, h2hFixtures, elig] = await Promise.all([
      fetch(picksUrl,   {headers:H}).then(function(r){return r.json();}),
      fetch(scoresUrl,  {headers:H}).then(function(r){return r.json();}),
      fetch(playersUrl, {headers:H}).then(function(r){return r.json();}),
      fetch(SUPABASE_URL+'/rest/v1/fantasy_h2h_fixtures?resolved=eq.true&select=participant_a,participant_b,winner_id,round_id', {headers:H}).then(function(r){return r.ok?r.json():[];}),
      /* Who may be shown by name in the fantasy graphics. The view is
         the authority on this, not `players`. */
      fetch(SUPABASE_URL+'/rest/v1/fantasy_players?select=id', {headers:H})
        .then(function(r){ return r.ok ? r.json() : null; })
        .catch(function(){ return null; }),
    ]);
    h2hFixtures = Array.isArray(h2hFixtures) ? h2hFixtures : [];

    /* null, not {}, when the view could not be read. The two states
       mean different things and the graphics below treat them
       differently: an empty set means nobody is eligible, an unknown
       set means do not guess. */
    if (Array.isArray(elig)) {
      fantasyEligibleIds = {};
      elig.forEach(function(p){ fantasyEligibleIds[p.id] = true; });
    } else {
      fantasyEligibleIds = null;
      console.warn('fantasy_players could not be read — Team of the Week and '
                 + 'Player of the Round are hidden rather than risk naming '
                 + 'someone who should not be in them.');
    }

    allPicks  = pr  || [];
    allScores = sr  || [];
    allPlayers = {}; allPlayerMeta = {};
    (plr||[]).forEach(function(p){
      allPlayers[p.id] = p.name;
      allPlayerMeta[p.id] = { name: p.name, role: p.role || '', captain: !!p.captain };
    });

    // Aggregate multiple match rows per player per round
    /* Through the shared aggregator. The hand-rolled version here
       carried runs, wickets, catches, stumpings and player-of-the-match
       and silently dropped maidens, run-outs and economy — so the
       formula could score them but never saw them, and the standings
       disagreed with the head-to-head on every round. */
    var rowsByKey = {};
    allScores.forEach(function(s) {
      var key = s.round_id + '_' + s.player_id;
      (rowsByKey[key] = rowsByKey[key] || []).push(s);
    });
    scoreLookup = {};
    Object.keys(rowsByKey).forEach(function(key) {
      scoreLookup[key] = FS.aggregate(rowsByKey[key]);
    });

    // Calculate totals per participant
    var totals = {};
    allPicks.forEach(function(pick) {
      var pid       = pick.participant_id;
      var pData     = pick.fantasy_participants || {};
      var name      = pData.team_name || pData.name || 'Unknown';
      var subName   = pData.team_name ? pData.name : null;
      var isWildcard = allRounds[pick.round_id] ? allRounds[pick.round_id].wildcard : false;

      if (!totals[pid]) totals[pid] = { participantId:pid, name:name, subName:subName, points:0, rounds:0, picks:[], roundPts:{} };

      var roundPts = pickRoundPoints(pick, scoreLookup, isWildcard, allRounds[pick.round_id]);
      totals[pid].points += roundPts;
      totals[pid].rounds += 1;
      totals[pid].picks.push(pick);
      totals[pid].roundPts[pick.round_id] = roundPts;
    });

    var ranked = Object.values(totals).sort(function(a,b){ return b.points - a.points; });

    // ── Rank movement (season view only) ────────────────────────────────────
    // Compare current season rank vs rank after excluding the most recent round.
    if (roundId === 'season') {
      var roundIdsSorted = Object.keys(allRounds); // asc by created_at from loadRounds
      if (roundIdsSorted.length >= 2) {
        var latestRid = roundIdsSorted[roundIdsSorted.length - 1];
        var prevEntries = ranked
          .map(function(p) { return { pid: p.participantId, pts: p.points - (p.roundPts[latestRid] || 0) }; })
          .sort(function(a, b) { return b.pts - a.pts; });
        var prevRankMap = {};
        prevEntries.forEach(function(item, i) { prevRankMap[item.pid] = i + 1; });
        ranked.forEach(function(p, i) {
          var prev = prevRankMap[p.participantId];
          // Only show movement if participant had picks in the latest round
          p.rankMovement = (prev != null && p.roundPts[latestRid] != null)
            ? prev - (i + 1)   // positive = moved up, negative = moved down
            : null;
        });
      }
    }

    // Load existing earned badges and attach to each participant
    var allBadges = [];
    try {
      var br = await fetch(SUPABASE_URL+'/rest/v1/fantasy_badges?select=*', {headers:H});
      if (br.ok) allBadges = await br.json();
    } catch(e) {}
    if (!Array.isArray(allBadges)) allBadges = [];

    /* Badges are decoration on this page — a row of small icons beside
       a team name. The standings are not. So a badge failure must cost
       the badges and nothing else; before this, computeBadges throwing
       would have fallen through to the outer catch and shown "No
       standings yet" on a page with a perfectly good table behind it. */
    ranked.forEach(function(p) {
      p.badges = [];
      if (typeof computeBadges !== 'function') return;
      try {
        var result = computeBadges(p.participantId, {
          allPicks: allPicks, allScores: allScores, allRounds: allRounds,
          allPlayers: (plr || []), ranked: ranked,
          existingBadges: allBadges.filter(function(b){ return b.participant_id === p.participantId; }),
          allH2HFixtures: h2hFixtures || [],
        });
        p.badges = result.earned;
      } catch (e) {
        console.warn('badges unavailable:', e && e.message);
      }
    });

    document.getElementById('lb-loading').style.display = 'none';

    if (!ranked.length) { document.getElementById('lb-empty').style.display = 'flex'; return; }

    // Render Player of the Round (only for specific round views)
    if (roundId !== 'season') renderPlayerOfRound(roundId);
    renderTeamOfWeek();

    // Render podium + cards

    renderPodiumAndCards(ranked, allRounds);
  } catch(e) {
    console.error(e);
    document.getElementById('lb-loading').style.display = 'none';
    document.getElementById('lb-empty').style.display   = 'flex';
  }
}

/* ══════════════════════════════════════
   BREAKDOWN + ROUND HISTORY
══════════════════════════════════════ */
function renderBreakdown(containerId, participant) {
  var el = document.getElementById(containerId);
  if (!el) return;

  var html = '';

  // Round-by-round score history bar
  var roundIds = Object.keys(participant.roundPts);
  if (roundIds.length > 1) {
    html += '<div class="bd-history">';
    html += '<div class="bd-history-label">Round-by-round</div>';
    html += '<div class="bd-history-bars">';
    var max = Math.max.apply(null, Object.values(participant.roundPts).concat([1]));
    roundIds.forEach(function(rid) {
      var pts   = participant.roundPts[rid] || 0;
      var pct   = Math.round((pts/max)*100);
      var rname = allRounds[rid] ? allRounds[rid].name : 'Round';
      var wc    = allRounds[rid] && allRounds[rid].wildcard ? ' ⭐' : '';
      html += '<div class="bd-bar-wrap" title="'+rname+wc+': '+pts+'pt">'
        + '<div class="bd-bar" style="height:'+Math.max(pct,4)+'%"></div>'
        + '<div class="bd-bar-pts">'+pts+'</div>'
        + '<div class="bd-bar-label">'+rname.split(' ')[0]+wc+'</div>'
        + '</div>';
    });
    html += '</div></div>';
  }

  // Per-round player breakdown
  participant.picks.forEach(function(pick) {
    var round     = allRounds[pick.round_id] || {};
    var isWildcard = round.wildcard || false;
    var chip      = pick.chip || null;
    var chipTag   = chip ? ' ' + CHIP_META[chip].icon + ' ' + CHIP_META[chip].short : '';
    var eff       = resolveCaptaincy(pick, scoreLookup);
    if (eff.safetyTriggered) chipTag += ' (VC promoted)';
    html += '<div class="bd-round-title">'+(round.name||'Round')+(isWildcard?' ⭐ Wildcard':'')+chipTag+'</div>';
    html += '<div class="bd-player-list">';
    (pick.player_ids||[]).forEach(function(playerId) {
      var isCap  = playerId === eff.capId;
      var isVC   = playerId === eff.vcId;
      var name   = allPlayers[playerId] || 'Unknown';
      var score  = scoreLookup[pick.round_id+'_'+playerId];
      var bd     = score ? calcBreakdown(score, isCap, isWildcard, isVC, chip, round.boost_modifier, roleOfPlayer(playerId)) : null;
      var isTripCap = isCap && (isWildcard || chip === 'triple_captain');
      var pts    = bd ? bd.total : null;
      html += '<div class="bd-player-row">'
        + '<div class="bd-player-left">'
        + '<span class="bd-player-name">'+name+(isCap?' '+(isTripCap?'⭐×3':'⭐×2'):isVC?' 🌟×1.5':'')+'</span>'
        + (bd && bd.lines.length ? '<span class="bd-player-detail">'+bd.lines.join(' · ')+'</span>'
           : '<span class="bd-player-detail no-score">'+(score?'Did not contribute':'No score recorded')+'</span>')
        + '</div>'
        + '<span class="bd-player-pts">'+(pts!==null?pts+'pt':'—')+'</span>'
        + '</div>';
    });
    html += '</div>';
  });

  el.innerHTML = html || '<div style="color:var(--muted);font-size:0.82rem;padding:12px 0">No score data yet.</div>';
}

/* ══════════════════════════════════════
   PLAYER OF THE ROUND
══════════════════════════════════════ */
function renderPlayerOfRound(roundId) {
  var isWildcard = allRounds[roundId] ? allRounds[roundId].wildcard : false;
  var best = null; var bestPts = 0;

  // Aggregate per-player for this round
  var potrRows = {};
  allScores.forEach(function(score) {
    if (score.round_id !== roundId) return;
    if (!fantasyShowable(score.player_id)) return;   // see fantasyEligibleIds
    (potrRows[score.player_id] = potrRows[score.player_id] || []).push(score);
  });
  var roundAgg = {};
  Object.keys(potrRows).forEach(function(pid) {
    var agg = FS.aggregate(potrRows[pid]);
    /* The id as it came — these are UUIDs, and Number() on one is NaN. */
    if (agg) { agg.player_id = pid; roundAgg[pid] = agg; }
  });
  Object.values(roundAgg).forEach(function(score) {
    var pts = calcPoints(score, false, false, false, null, (allRounds[roundId]||{}).boost_modifier, roleOfPlayer(score.player_id));
    if (pts > bestPts) { bestPts = pts; best = score; }
  });

  if (!best || bestPts === 0) return;

  var playerName = allPlayers[best.player_id] || 'Unknown';
  var wrap = document.getElementById('potr-wrap');
  var card = document.getElementById('potr-card');
  card.innerHTML =
    '<div class="potr-eyebrow">Player of the Round</div>'
    + '<div class="potr-name">'+playerName+'</div>'
    + '<div class="potr-pts">'+bestPts+'<span class="potr-pts-label">pts</span></div>'
    + '<div class="potr-stats">'
    + (best.runs    ? '<span>'+best.runs+' runs</span>' : '')
    + (best.wickets ? '<span>'+best.wickets+' wkts</span>' : '')
    + (best.catches ? '<span>'+best.catches+' catches</span>' : '')
    + (best.player_of_match ? '<span>POTM 🏏</span>' : '')
    + '</div>';
  wrap.style.display = 'block';
}

/* ══════════════════════════════════════
   TEAM OF THE WEEK
   A balanced XI from the round's scores: 5 batters, 1 keeper,
   2 all-rounders, 3 bowlers, plus a 12th man. Ranked on the same
   basePoints() the league uses, so nothing needs re-weighting.
   Anyone appearing in fantasy_scores has already passed the
   eligibility check applied when scores were entered.
══════════════════════════════════════ */
/* ── TEAM OF THE WEEK ──────────────────────────────────────────────
   The eleven best performances of the round, with one place held for a
   wicketkeeper so the graphic is not keeperless.

   It used to pick a fixed 5-1-2-3 formation. That is defensible for a
   league with deep squads in every role, and wrong for club cricket:
   in a week where eight batters scored and three bowlers struggled, a
   71-point batter sat as twelfth man behind a 9-point all-rounder,
   because the all-rounder slots had to be filled by all-rounders. The
   shape was doing its job and the result still read as nonsense.

   Points decide now. The only exception is the keeper, and the dagger
   beside their name says why they are there.
   ────────────────────────────────────────────────────────────────── */

/* Matched on 'rounder' and 'keeper' appearing anywhere, so every
   spelling in the player list — "All-Rounder", "Bowling Allrounder",
   "Wicketkeeper-Batter" — lands somewhere rather than nowhere. */
function totwBucket(pid) {
  var m = allPlayerMeta[pid];
  var r = (m && m.role ? m.role : '').toLowerCase().replace(/-/g, ' ').trim();
  if (r.indexOf('rounder') !== -1) return 'ar';
  if (r.indexOf('keeper')  !== -1) return 'wk';
  if (r === 'bowler')              return 'bowl';
  if (r === 'batter' || r === 'batsman') return 'bat';
  return 'other';
}

var TOTW_SIZE = 11;

/* A player's round, written the way a scorecard writes it:
     73 · 10–3–24–3 · 2 ct
   Only what happened appears. Overs and runs conceded are what make
   real bowling figures possible — before those columns existed the
   best a card could say was "2 wkts". */
function totwFigures(e) {
  var bits = [];
  if (e.runs) bits.push(String(e.runs));
  if (e.overs > 0) {
    bits.push([e.overs, e.maidens || 0,
               (e.conceded == null ? '?' : e.conceded),
               e.wickets || 0].join('\u2013'));
  } else if (e.wickets) {
    bits.push(e.wickets + ' wkt' + (e.wickets === 1 ? '' : 's'));
  }
  if (e.catches)   bits.push(e.catches   + ' ct');
  if (e.stumpings) bits.push(e.stumpings + ' st');
  if (e.runouts)   bits.push(e.runouts   + ' ro');
  if (e.potm)      bits.push('Player of the Match');
  return bits.join(' \u00b7 ');
}

function buildTeamOfWeek(scores, round) {
  var boost = (round && round.boost_modifier) || null;

  /* One entry per player, aggregated the way the standings do it — two
     matches in a round make one innings and one spell, rather than
     being scored separately and added together. */
  var rowsBy = {};
  (scores || []).forEach(function (s) {
    if (!s.player_id) return;
    /* A score row exists for anyone the admin entered. Being in this
       graphic means having your name on a public page, so the test is
       the fantasy_players view, not merely having scored. */
    if (!fantasyShowable(s.player_id)) return;
    (rowsBy[s.player_id] = rowsBy[s.player_id] || []).push(s);
  });

  var pool = [];
  Object.keys(rowsBy).forEach(function (pid) {
    var agg = FS.aggregate(rowsBy[pid]);
    if (!agg) return;
    pool.push({
      /* The id exactly as it came. These are UUIDs. */
      pid:       pid,
      pts:       FS.basePoints(agg, boost, roleOfPlayer(pid)),
      runs:      agg.runs,
      wickets:   agg.wickets,
      catches:   agg.catches,
      stumpings: agg.stumpings,
      runouts:   agg.runouts,
      maidens:   agg.maidens,
      overs:     agg.overs,
      conceded:  agg.runs_conceded,
      potm:      agg.player_of_match
    });
  });

  pool = pool.filter(function (e) { return e.pts > 0; })
             .sort(function (a, b) { return b.pts - a.pts; });
  if (pool.length < 5) return null;   // not enough of a round to bother

  var taken = {}, xi = [];

  /* The keeper's place, held before anything else. If no keeper played,
     nothing is held and the XI is simply the best eleven. */
  var keeper = null;
  for (var k = 0; k < pool.length; k++) {
    if (totwBucket(pool[k].pid) === 'wk') { keeper = pool[k]; break; }
  }
  var keeperWouldMakeItAnyway = false;
  if (keeper) {
    /* Only tag the keeper as held if they would not have got in on
       points — otherwise the tag is noise. */
    keeperWouldMakeItAnyway = pool.indexOf(keeper) < TOTW_SIZE;
    taken[keeper.pid] = true;
    xi.push({ entry: keeper, tag: keeperWouldMakeItAnyway ? null : 'keeper' });
  }

  /* Then simply the best of the rest. */
  for (var i = 0; i < pool.length && xi.length < TOTW_SIZE; i++) {
    if (taken[pool[i].pid]) continue;
    taken[pool[i].pid] = true;
    xi.push({ entry: pool[i], tag: null });
  }

  xi.sort(function (a, b) { return b.entry.pts - a.entry.pts; });

  var twelfth = null;
  for (var j = 0; j < pool.length; j++) {
    if (!taken[pool[j].pid]) { twelfth = pool[j]; break; }
  }
  return { xi: xi, twelfth: twelfth };
}

function renderTeamOfWeek() {
  var wrap = document.getElementById('totw-wrap');
  if (!wrap) return;
  var scores = allScores || [];
  var roundName = '';
  var latestRoundId = null;
  if (currentRoundId === 'season') {
    var rids = Object.keys(allRounds || {});
    var latest = rids.length ? rids[rids.length - 1] : null;
    latestRoundId = latest;
    if (latest) {
      scores = scores.filter(function (s) { return s.round_id === latest; });
      roundName = (allRounds[latest] && allRounds[latest].name) || '';
    }
  } else {
    roundName = (allRounds[currentRoundId] && allRounds[currentRoundId].name) || '';
  }

  var totwRound = (currentRoundId === 'season')
    ? (allRounds[latestRoundId] || null)
    : (allRounds[currentRoundId] || null);
  var team = buildTeamOfWeek(scores, totwRound);
  if (!team) { wrap.style.display = 'none'; return; }

  document.getElementById('totw-round').textContent = roundName || 'Latest round';

  /* Keeper and captain get the marks a cricketer already reads. */
  function marks(pid) {
    var m = allPlayerMeta[pid] || {};
    var out = '';
    if ((m.role || '').toLowerCase().indexOf('wicketkeeper') === 0) out += '†';
    if (m.captain) out += (out ? ' ' : '') + '(c)';
    return out;
  }

  var starPid = team.xi.reduce(function (best, it) {
    return (!best || it.entry.pts > best.pts) ? it.entry : best;
  }, null);
  starPid = starPid ? starPid.pid : null;

  document.getElementById('totw-list').innerHTML = team.xi.map(function (it, i) {
    var e = it.entry, m = allPlayerMeta[e.pid] || {}, mk = marks(e.pid);
    var isStar = e.pid === starPid;
    var fig = totwFigures(e);
    return '<li class="ln' + (isStar ? ' is-star' : '') + '">'
      + '<span class="ln-n">' + (i + 1) + '</span>'
      + '<span class="ln-who">'
      +   (isStar ? '<span class="totw-star-lbl">Star of the week</span>' : '')
      +   '<span class="ln-name">' + (m.name || 'Unknown')
      +     (mk ? '<i class="mk">' + mk + '</i>' : '')
      +     (it.tag ? '<i class="fill" title="A place is held for a wicketkeeper">' + it.tag + '</i>' : '')
      +   '</span>'
      +   (fig ? '<span class="ln-fig">' + fig + '</span>' : '')
      + '</span>'
      + '<span class="ln-p">' + Math.round(e.pts) + '</span>'
      + '</li>';
  }).join('');

  var t12 = document.getElementById('totw-12');
  if (team.twelfth) {
    var tm = allPlayerMeta[team.twelfth.pid] || {};
    t12.innerHTML = '12th man \u00b7 <b>' + (tm.name || 'Unknown') + '</b> '
      + Math.round(team.twelfth.pts);
    t12.style.display = '';
  } else { t12.style.display = 'none'; }

  wrap.style.display = 'block';
}


/* ══════════════════════════════════════
   MOST PICKED PLAYERS
══════════════════════════════════════ */
function renderMostPicked() {
  if (!allPicks.length) return;
  var counts = {};
  var total  = allPicks.length;
  allPicks.forEach(function(pick) {
    (pick.player_ids||[]).forEach(function(pid) {
      counts[pid] = (counts[pid]||0) + 1;
    });
  });

  var sorted = Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; }).slice(0,6);
  if (!sorted.length) return;

  var grid = document.getElementById('most-picked-grid');
  grid.innerHTML = sorted.map(function(pid) {
    var pct = Math.round((counts[pid]/total)*100);
    return '<div class="mp-item">'
      + '<div class="mp-name">'+(allPlayers[pid]||'Unknown')+'</div>'
      + '<div class="mp-bar-wrap"><div class="mp-bar" style="width:'+pct+'%"></div></div>'
      + '<div class="mp-pct">'+pct+'%</div>'
      + '</div>';
  }).join('');

  document.getElementById('most-picked-wrap').style.display = 'block';
}

/* ══════════════════════════════════════
   VIEW TOGGLE — Points ↔ H2H
══════════════════════════════════════ */
var currentView = 'points';

function switchView(view) {
  currentView = view;
  var isH2H  = view === 'h2h';
  var isLive = view === 'live';
  var pvEl = document.getElementById('lb-points-view');
  var hvEl = document.getElementById('lb-h2h-view');
  var lvEl = document.getElementById('lb-live-view');
  if (pvEl) pvEl.style.display = (!isH2H && !isLive) ? 'block' : 'none';
  if (hvEl) hvEl.style.display = isH2H  ? 'block' : 'none';
  if (lvEl) lvEl.style.display = isLive ? 'block' : 'none';
  ['view-points-btn','view-h2h-btn','view-live-btn'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  var activeId = isH2H ? 'view-h2h-btn' : isLive ? 'view-live-btn' : 'view-points-btn';
  var activeEl = document.getElementById(activeId);
  if (activeEl) activeEl.classList.add('active');
  if (isH2H)  loadH2HView();
  if (isLive) loadLiveView();
}

/* ══════════════════════════════════════
   H2H: load all data and render
══════════════════════════════════════ */
async function loadH2HView() {
  document.getElementById('lb-h2h-loading').style.display = 'flex';
  document.getElementById('lb-h2h-empty').style.display   = 'none';
  document.getElementById('lb-h2h-content').style.display = 'none';

  try {
    var [fixturesR, roundsR, participantsR] = await Promise.all([
      fetch(SUPABASE_URL+'/rest/v1/fantasy_h2h_fixtures?select=*&order=created_at.asc', {headers:H}).then(function(r){return r.json();}),
      fetch(SUPABASE_URL+'/rest/v1/fantasy_rounds?h2h=eq.true&select=id,name,wildcard&order=created_at.asc', {headers:H}).then(function(r){return r.json();}),
      fetch(SUPABASE_URL+'/rest/v1/fantasy_participants?select=id,name,team_name', {headers:H}).then(function(r){return r.json();})
    ]);

    var fixtures     = fixturesR     || [];
    var h2hRounds    = roundsR       || [];
    var participants = participantsR || [];

    // Build participant name map
    var pMap = {};
    participants.forEach(function(p){ pMap[p.id] = p.team_name || p.name; });

    // Only keep resolved fixtures (pts_a set)
    var resolved = fixtures.filter(function(f){ return f.pts_a !== null && f.pts_a !== undefined; });

    document.getElementById('lb-h2h-loading').style.display = 'none';

    if (!resolved.length) {
      document.getElementById('lb-h2h-empty').style.display = 'flex';
      return;
    }

    document.getElementById('lb-h2h-content').style.display = 'block';

    // Build standings
    var standings = buildH2HStandings(resolved, pMap);
    renderH2HStandings(standings);

    // Build round-by-round section
    renderH2HRounds(fixtures, h2hRounds, pMap);

  } catch(e) {
    console.error('H2H load error:', e);
    document.getElementById('lb-h2h-loading').style.display = 'none';
    document.getElementById('lb-h2h-empty').style.display   = 'flex';
  }
}

/* ── Build standings from resolved fixtures ── */
function buildH2HStandings(resolved, pMap) {
  var standings = {};

  function ensure(id) {
    if (!standings[id]) standings[id] = { id:id, name: pMap[id]||'Unknown', w:0, d:0, l:0, h2hPts:0, fantasyPts:0 };
  }

  resolved.forEach(function(f) {
    ensure(f.participant_a);
    standings[f.participant_a].fantasyPts += f.pts_a || 0;

    var winnerA = f.winner_id === f.participant_a;
    var winnerB = f.participant_b && f.winner_id === f.participant_b;
    var isDraw  = f.winner_id === null;

    if      (winnerA) { standings[f.participant_a].w++; standings[f.participant_a].h2hPts += 3; }
    else if (isDraw)  { standings[f.participant_a].d++; standings[f.participant_a].h2hPts += 1; }
    else              { standings[f.participant_a].l++; }

    // Real opponent only (not Mr. Average ghost)
    if (f.participant_b) {
      ensure(f.participant_b);
      standings[f.participant_b].fantasyPts += f.pts_b || 0;
      if      (winnerB) { standings[f.participant_b].w++; standings[f.participant_b].h2hPts += 3; }
      else if (isDraw)  { standings[f.participant_b].d++; standings[f.participant_b].h2hPts += 1; }
      else              { standings[f.participant_b].l++; }
    }
  });

  return Object.values(standings).sort(function(a, b) {
    return (b.h2hPts - a.h2hPts) || (b.fantasyPts - a.fantasyPts);
  });
}

/* ── Render H2H standings table ── */
function renderH2HStandings(standings) {
  var tbody = document.getElementById('h2h-tbody');
  if (!tbody) return;
  var rankLabels = ['gold','silver','bronze'];
  tbody.innerHTML = standings.map(function(p, i) {
    var played = p.w + p.d + p.l;
    return '<tr class="lb-row">'
      + '<td><span class="lb-rank '+(rankLabels[i]||'')+'">'+(i+1)+'</span></td>'
      + '<td class="lb-name">'+p.name+'</td>'
      + '<td class="h2h-stat h2h-win">'+p.w+'</td>'
      + '<td class="h2h-stat h2h-draw">'+p.d+'</td>'
      + '<td class="h2h-stat h2h-loss">'+p.l+'</td>'
      + '<td><span class="lb-points">'+p.h2hPts+'</span></td>'
      + '<td style="color:var(--muted);font-size:0.8rem">'+p.fantasyPts+'</td>'
      + '</tr>';
  }).join('');
}

/* ── Render round-by-round H2H fixtures ── */
function renderH2HRounds(allFixtures, h2hRounds, pMap) {
  var wrap = document.getElementById('h2h-rounds-wrap');
  if (!wrap) return;

  // Build round lookup
  var roundMap = {};
  h2hRounds.forEach(function(r){ roundMap[r.id] = r; });

  // Group fixtures by round
  var byRound = {};
  allFixtures.forEach(function(f) {
    if (!byRound[f.round_id]) byRound[f.round_id] = [];
    byRound[f.round_id].push(f);
  });

  var roundIds = Object.keys(byRound).filter(function(id){ return roundMap[id]; });

  if (!roundIds.length) { wrap.innerHTML = ''; return; }

  wrap.innerHTML = roundIds.map(function(roundId) {
    var round    = roundMap[roundId];
    var fixtures = byRound[roundId];
    var isWc     = round.wildcard;
    var resolved = fixtures.some(function(f){ return f.pts_a !== null; });

    var fixtureHtml = fixtures.map(function(f) {
      var nameA = pMap[f.participant_a] || 'Unknown';
      var nameB = f.participant_b ? (pMap[f.participant_b] || 'Unknown') : 'Mr. Average';
      var isResolved = f.pts_a !== null;

      if (!isResolved) {
        return '<div class="h2h-match-card pending">'
          + '<span class="h2h-mc-name-a">'+nameA+'</span>'
          + '<span class="h2h-mc-vs">vs</span>'
          + '<span class="h2h-mc-name-b">'+nameB+'</span>'
          + '</div>';
      }

      var winA   = f.winner_id === f.participant_a;
      var winB   = f.participant_b && f.winner_id === f.participant_b;
      var isDraw = f.winner_id === null;

      return '<div class="h2h-match-card resolved">'
        + '<span class="h2h-mc-name-a'+(winA?' h2h-mc-winner':'')+'">'+nameA+'</span>'
        + '<span class="h2h-mc-score">'+f.pts_a+'<span class="h2h-mc-sep">–</span>'+f.pts_b+'</span>'
        + '<span class="h2h-mc-name-b'+(winB?' h2h-mc-winner':'')+'">'+nameB+'</span>'
        + (isDraw ? '<span class="h2h-result-draw">DRAW</span>'
          : winA  ? '<span class="h2h-result-a">◀ WIN</span>'
          :         '<span class="h2h-result-b">WIN ▶</span>')
        + '</div>';
    }).join('');

    return '<div class="h2h-round-block">'
      + '<div class="h2h-round-title">'+round.name+(isWc?' ⭐':'')+(!resolved?' <span class="h2h-pending-tag">Pending</span>':'')+'</div>'
      + '<div class="h2h-match-grid">'+fixtureHtml+'</div>'
      + '</div>';
  }).join('');
}

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
loadRounds();
loadLeaderboard('season');


/* ══════════════════════════════════════════════════════
   LIVE FANTASY POINTS
   Reads live_scores batting_state + bowling_state,
   maps player names via fantasy_player_name_map,
   calculates running points per participant
══════════════════════════════════════════════════════ */
var liveRefreshTimer = null;
var liveChannel      = null;

async function loadLiveView() {
  document.getElementById('lb-live-loading').style.display  = 'flex';
  document.getElementById('lb-live-empty').style.display    = 'none';
  document.getElementById('lb-live-content').style.display  = 'none';

  try {
    // Get active round first, then filter live matches to linked fixtures
    var roundR = await fetch(SUPABASE_URL + '/rest/v1/fantasy_rounds?locked=eq.false&order=deadline.asc&limit=1&select=id,name,wildcard,boost_modifier', {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
    });
    var rounds = await roundR.json();
    if (!rounds || !rounds.length) {
      var sR = await fetch(SUPABASE_URL + '/rest/v1/fantasy_rounds?scored=eq.false&locked=eq.true&order=deadline.desc&limit=1&select=id,name,wildcard,boost_modifier', {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
      });
      rounds = await sR.json();
    }

    // Build live_scores query — filter to round-linked fixtures if any are set
    var liveSelect = 'id,fixture_id,batting_team,bowling_team,runs,wickets,overs,innings,batting_state,bowling_state,lineup_state,fixtures(team,opponent,division)';
    var liveBase   = SUPABASE_URL + '/rest/v1/live_scores?status=eq.live&select=' + liveSelect;
    var liveUrl    = liveBase;

    if (rounds && rounds.length) {
      var rfR = await fetch(SUPABASE_URL + '/rest/v1/fantasy_round_fixtures?round_id=eq.' + rounds[0].id + '&select=fixture_id', {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
      });
      var linkedFx = await rfR.json();
      if (linkedFx && linkedFx.length) {
        var fids = linkedFx.map(function(f){ return f.fixture_id; }).join(',');
        liveUrl = liveBase + '&fixture_id=in.(' + fids + ')';
      }
    }

    var lsR = await fetch(liveUrl, { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY } });
    var liveMatches = await lsR.json();

    if (!liveMatches || !liveMatches.length) {
      document.getElementById('lb-live-loading').style.display = 'none';
      document.getElementById('lb-live-empty').style.display   = 'flex';
      return;
    }

    if (!rounds || !rounds.length) {
      var emptyEl = document.getElementById('lb-live-empty');
      emptyEl.innerHTML = '<span style="font-size:2rem">🏏</span><span>A match is live but there\'s no active fantasy round. Live points will appear once a round is created and locked.</span>';
      document.getElementById('lb-live-loading').style.display = 'none';
      emptyEl.style.display = 'flex';
      return;
    }
    var round = rounds[0];

    // Fetch picks, participants, name map, player roles in parallel
    var [picksData, participantsData, nameMapData, playersData] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/fantasy_picks?round_id=eq.' + round.id + '&select=participant_id,player_ids,captain_id,vice_captain_id', {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
      }).then(function(r){ return r.json(); }),
      fetch(SUPABASE_URL + '/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name', {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
      }).then(function(r){ return r.json(); }),
      fetch(SUPABASE_URL + '/rest/v1/fantasy_player_name_map?select=scorer_name,player_id', {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
      }).then(function(r){ return r.json(); }),
      fetch(SUPABASE_URL + '/rest/v1/players?select=id,role,name&active=not.eq.false', {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
      }).then(function(r){ return r.json(); }),
    ]);

    renderLiveView(liveMatches, round, picksData, participantsData, nameMapData, playersData);
    startLiveRefresh(round);

  } catch(e) {
    document.getElementById('lb-live-loading').style.display = 'none';
    document.getElementById('lb-live-empty').style.display   = 'flex';
    console.warn('Live view error:', e);
  }
}

function renderLiveView(liveMatches, round, picks, participants, nameMap, players) {
  // Build name → player_id lookup (case-insensitive).
  // Exact DB player names first; alias map overwrites so admin
  // mappings always win for name variations.
  var nameToId = {};
  (players||[]).forEach(function(p){ if (p.name) nameToId[p.name.toLowerCase()] = p.id; });
  (nameMap||[]).forEach(function(m){ nameToId[m.scorer_name.toLowerCase()] = m.player_id; });

  // Build player_id → role lookup
  var roleMap = {};
  (players||[]).forEach(function(p){ roleMap[p.id] = p.role||''; });

  // Build participant map
  var partMap = {};
  (participants||[]).forEach(function(p){ partMap[p.id] = p; });

  // Extract per-player stats from all live matches
  var playerStats = {}; // player_id → { runs, wickets, maidens, overs, runsBowled }
  var unlinked    = [];

  liveMatches.forEach(function(match) {
    var batting = {};
    var bowling = {};
    try { batting = JSON.parse(match.batting_state || '{}'); } catch(e) {}
    try { bowling = JSON.parse(match.bowling_state || '{}'); } catch(e) {}

    // Batting — striker, non-striker, dismissed
    var batters = [];
    if (batting.striker)    batters.push(batting.striker);
    if (batting.nonStriker) batters.push(batting.nonStriker);
    if (batting.dismissed)  batters = batters.concat(batting.dismissed);
    if (batting.retiredHurt)batters = batters.concat(batting.retiredHurt);
    if (batting.firstInningsBatting) batters = batters.concat(batting.firstInningsBatting.dismissed||[]);

    batters.forEach(function(b) {
      if (!b || !b.name) return;
      var pid = nameToId[b.name.toLowerCase()];
      if (!pid) { if (unlinked.indexOf(b.name) === -1) unlinked.push(b.name); return; }
      if (!playerStats[pid]) playerStats[pid] = { runs:0, wickets:0, maidens:0, overs:0, runsBowled:0, catches:0, stumpings:0 };
      playerStats[pid].runs += b.runs || 0;
    });

    // Catches and stumpings from lineup_state
    var lineup = {};
    try { lineup = JSON.parse(match.lineup_state || '{}'); } catch(e) {}
    if (lineup.catches) {
      Object.keys(lineup.catches).forEach(function(name) {
        var pid = nameToId[name.toLowerCase()];
        if (!pid) return;
        if (!playerStats[pid]) playerStats[pid] = { runs:0, wickets:0, maidens:0, overs:0, runsBowled:0, catches:0, stumpings:0 };
        playerStats[pid].catches += lineup.catches[name] || 0;
      });
    }
    if (lineup.stumpings) {
      Object.keys(lineup.stumpings).forEach(function(name) {
        var pid = nameToId[name.toLowerCase()];
        if (!pid) return;
        if (!playerStats[pid]) playerStats[pid] = { runs:0, wickets:0, maidens:0, overs:0, runsBowled:0, catches:0, stumpings:0 };
        playerStats[pid].stumpings += lineup.stumpings[name] || 0;
      });
    }

    // Bowling — current + all bowlers
    var bowlers = (bowling.bowlers || []).slice();
    if (bowling.current && bowling.current.name) {
      var existing = bowlers.find(function(bw){ return bw.name === bowling.current.name; });
      if (!existing) bowlers.push(bowling.current);
    }
    // First innings bowling if available
    if (bowling.firstInningsBowling) bowlers = bowlers.concat(bowling.firstInningsBowling);

    bowlers.forEach(function(b) {
      if (!b || !b.name) return;
      var pid = nameToId[b.name.toLowerCase()];
      if (!pid) { if (unlinked.indexOf(b.name) === -1) unlinked.push(b.name); return; }
      if (!playerStats[pid]) playerStats[pid] = { runs:0, wickets:0, maidens:0, overs:0, runsBowled:0, catches:0, stumpings:0 };
      playerStats[pid].wickets    += b.wickets || 0;
      playerStats[pid].maidens    += b.maidens || 0;
      playerStats[pid].overs      += b.overs   || 0;
      playerStats[pid].runsBowled += b.runs    || 0;
    });
  });

  // Calculate points per participant
  var participantPts = {};
  var participantLive = {}; // how many of their XI are live
  (picks||[]).forEach(function(pick) {
    var total = 0;
    var liveCount = 0;
    (pick.player_ids||[]).forEach(function(pid) {
      var stats = playerStats[pid];
      if (stats) {
        total += calcLivePts(stats, pid===pick.captain_id, round.wildcard, pid===pick.vice_captain_id, round.boost_modifier, roleMap[pid]);
        liveCount++;
      }
    });
    participantPts[pick.participant_id]  = total;
    participantLive[pick.participant_id] = liveCount;
  });

  // Sort by points — include all participants, even those with 0 live pts
  var ranked = (participants||[])
    .filter(function(p){ return (picks||[]).find(function(pk){ return pk.participant_id === p.id; }); })
    .sort(function(a,b){ return (participantPts[b.id]||0) - (participantPts[a.id]||0); });

  if (!ranked.length) {
    document.getElementById('lb-live-loading').style.display = 'none';
    var emptyEl = document.getElementById('lb-live-empty');
    emptyEl.innerHTML = '<span style="font-size:2rem">🏏</span><span>Match is live but no picks have been submitted for this round yet.</span>';
    emptyEl.style.display = 'flex';
    return;
  }

  // Match header
  var matchInfoEl = document.getElementById('lb-live-match-info');
  if (matchInfoEl) {
    matchInfoEl.innerHTML = liveMatches.map(function(m) {
      var fx = m.fixtures || {};
      return '<div class="lb-live-match-pill"><span class="lb-live-dot"></span><strong>' + (fx.team||'TCC') + '</strong> vs ' + (fx.opponent||'Opponent') + ' &mdash; ' + m.runs + '/' + m.wickets + ' (' + m.overs + ' ov)</div>';
    }).join('');
  }

  // Render table
  var tbody = document.getElementById('lb-live-rows');
  if (tbody) {
    tbody.innerHTML = ranked.map(function(p, i) {
      var pts   = participantPts[p.id] || 0;
      var live  = participantLive[p.id] || 0;
      var name  = p.team_name || p.name;
      return '<tr>'
        + '<td class="lb-rank">' + (i+1) + '</td>'
        + '<td class="lb-name">' + name + '</td>'
        + '<td class="lb-pts" style="text-align:right">' + pts + '</td>'
        + '<td class="lb-meta" style="text-align:right;font-size:0.7rem;color:var(--muted)">' + live + ' active</td>'
        + '</tr>';
    }).join('');
  }

  // Unlinked names warning
  var unlinkedEl  = document.getElementById('lb-live-unlinked');
  var unlinkedTxt = document.getElementById('lb-live-unlinked-names');
  if (unlinked.length && unlinkedEl && unlinkedTxt) {
    unlinkedTxt.textContent = '⚠ Unlinked players (not counting): ' + unlinked.join(', ');
    unlinkedEl.style.display = 'block';
  } else if (unlinkedEl) {
    unlinkedEl.style.display = 'none';
  }

  document.getElementById('lb-live-loading').style.display  = 'none';
  document.getElementById('lb-live-content').style.display  = 'block';
}

function startLiveRefresh(round) {
  // Clear any existing timer/channel
  if (liveRefreshTimer) clearInterval(liveRefreshTimer);
  if (liveChannel) { try { liveChannel.unsubscribe(); } catch(e){} }

  // Refresh every 30s
  liveRefreshTimer = setInterval(function() {
    if (currentView === 'live') loadLiveView();
  }, 30000);

  // Realtime channel on live_scores
  try {
    var ws = new WebSocket(
      SUPABASE_URL.replace('https://','wss://') + '/realtime/v1/websocket?apikey=' + SUPABASE_ANON_KEY + '&vsn=1.0.0'
    );
    liveChannel = ws;
    ws.onopen = function() {
      ws.send(JSON.stringify({ topic:'realtime:public:live_scores', event:'phx_join', payload:{}, ref:'live-fantasy' }));
    };
    ws.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if ((msg.event==='UPDATE'||msg.event==='INSERT') && currentView==='live') loadLiveView();
      } catch(ex){}
    };
  } catch(e) {}
}

function checkForLiveMatch() {
  fetch(SUPABASE_URL + '/rest/v1/live_scores?status=eq.live&select=id&limit=1', {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
  }).then(function(r){ return r.json(); }).then(function(rows) {
    var btn = document.getElementById('view-live-btn');
    if (btn) btn.style.display = (rows && rows.length) ? 'inline-flex' : 'none';
  }).catch(function(){});
}

// Check on load and every 2 minutes
checkForLiveMatch();
setInterval(checkForLiveMatch, 120000);

/* buildSparklineSVG and getTrend were deleted with the sparkline
   columns they fed. Nothing else called them. The round-by-round story
   they were trying to tell in 72 pixels is told properly by the bar
   chart inside an expanded row, which has room for the numbers. */

function lbInitials(name) {
  var p = (name||'').split(' ');
  return ((p[0]||'')[0]||'').toUpperCase() + ((p[p.length-1]||'')[0]||'').toUpperCase();
}

/* ══════════════════════════════════════
   PODIUM + CARDS RENDER
══════════════════════════════════════ */
function rankMovementHtml(p) {
  if (p.rankMovement == null) return '';
  if (p.rankMovement > 0) return '<span class="lb-rank-arrow lb-rank-up">\u25b2' + p.rankMovement + '</span>';
  if (p.rankMovement < 0) return '<span class="lb-rank-arrow lb-rank-down">\u25bc' + Math.abs(p.rankMovement) + '</span>';
  return '<span class="lb-rank-arrow lb-rank-same">\u2014</span>';
}

function renderPodiumAndCards(ranked, rounds) {
  var maxPts    = ranked.length ? ranked[0].points : 1;
  var podiumEl  = document.getElementById('lb-podium');
  var podiumRow = document.getElementById('lb-podium-row');
  var cardsWrap = document.getElementById('lb-cards-wrap');
  var cardsEl   = document.getElementById('lb-cards');
  if (!podiumEl || !cardsEl) return;
  /* Added with the podium expand. A cached leaderboard.html without the
     container must not take the podium down with it, so fall back to
     building one rather than throwing on appendChild. */
  var podiumExpand = document.getElementById('lb-podium-expand');
  if (!podiumExpand) {
    podiumExpand = document.createElement('div');
    podiumExpand.id = 'lb-podium-expand';
    podiumEl.appendChild(podiumExpand);
  }
  podiumExpand.innerHTML = '';

  // Podium order: [2nd, 1st, 3rd] visually
  var podiumSet = [];
  if (ranked.length >= 3)      podiumSet = [ranked[1], ranked[0], ranked[2]];
  else if (ranked.length === 2) podiumSet = [ranked[1], ranked[0]];
  else if (ranked.length === 1) podiumSet = [ranked[0]];

  /* The podium used to say first place five times over \u2014 a green card,
     a green glow behind it, a green ring, a green number, and a 36px
     ghost "1ST" on a block below \u2014 in three colours that meant nothing
     (green, blue, gold) across three different card widths. It now
     says it twice, with the position and the step, in the three
     colours everyone already reads as first, second and third.

     The crown emoji went with the glow: it was the only emoji left in
     the standings, floating above a card it was not attached to. */
  var POS_LABEL = {1:'1st', 2:'2nd', 3:'3rd'};

  /* Early in a season there may be one or two teams, not three. The
     row is a three-column grid, so without this a lone leader sat in
     the left-hand third of the page. */
  podiumRow.className = 'lb-podium-row n-' + podiumSet.length;
  podiumRow.innerHTML = '';
  podiumSet.forEach(function(p) {
    if (!p) return;
    var realRank = ranked.indexOf(p) + 1;

    var slot = document.createElement('div');
    slot.className = 'lb-podium-slot rank-'+realRank;
    slot.setAttribute('role', 'button');
    slot.setAttribute('tabindex', '0');
    slot.setAttribute('aria-expanded', 'false');
    slot.innerHTML =
      '<div class="lb-podium-card">'
      +   '<div class="lb-podium-pos">'+(POS_LABEL[realRank]||realRank)+'</div>'
      +   '<div class="lb-podium-avatar">'+lbInitials(p.name)+'</div>'
      +   '<div class="lb-podium-names">'
      +     '<div class="lb-podium-team">'+p.name+'</div>'
      +     (p.subName ? '<div class="lb-podium-player">'+p.subName+'</div>' : '')
      +   '</div>'
      +   '<div class="lb-podium-pts">'
      +     '<span class="lb-podium-pts-val">'+p.points+'</span>'
      +     '<span class="lb-podium-pts-lbl">pts</span>'
      +   '</div>'
      +   '<div class="lb-podium-move">'+rankMovementHtml(p)+'</div>'
      + '</div>';

    /* Same behaviour as a rank row, drawn by the same function, just
       landing in a panel under the row instead of after the card.
       Only one team is ever open on the page, podium or not, so
       opening one here closes anything open below. */
    var openSlot = function() {
      var wasOpen = slot.classList.contains('expanded');

      podiumRow.querySelectorAll('.lb-podium-slot.expanded').forEach(function(el) {
        el.classList.remove('expanded');
        el.setAttribute('aria-expanded', 'false');
      });
      podiumExpand.innerHTML = '';
      if (cardsEl) {
        cardsEl.querySelectorAll('.lb-card-expand').forEach(function(el) { el.remove(); });
        cardsEl.querySelectorAll('.lb-card.expanded').forEach(function(el) { el.classList.remove('expanded'); });
      }
      if (wasOpen) return;   // a second click closes it

      slot.classList.add('expanded');
      slot.setAttribute('aria-expanded', 'true');
      /* The accent follows whichever place is open, so the panel reads
         as belonging to that card and not to first place by default. */
      podiumExpand.style.setProperty('--pod-accent',
        realRank === 1 ? 'var(--gold)' : realRank === 2 ? 'var(--silver)' : 'var(--bronze)');
      var head = document.createElement('div');
      head.className = 'lb-podium-expand-who';
      head.innerHTML = '<span class="lb-podium-expand-rank">'+(POS_LABEL[realRank]||realRank)+'</span>'
                     + '<span class="lb-podium-expand-team">'+p.name+'</span>';
      podiumExpand.appendChild(head);
      var body = document.createElement('div');
      podiumExpand.appendChild(body);
      renderExpandedCard(body, p);
    };

    slot.addEventListener('click', openSlot);
    /* Reachable without a mouse, since it is a real control now. */
    slot.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); openSlot(); }
    });

    podiumRow.appendChild(slot);
  });

  podiumEl.style.display = ranked.length ? 'block' : 'none';

  /* Rank 4+. Two columns have gone:

     The sparkline drew a season trend from one data point for most of
     the season, which is a dot, and it held its place in the grid even
     when there was nothing at all to draw — the empty gutter in the
     middle of every row.

     The gap bar drew a rail whose length restated the points total
     printed beside it, and put the gap in red underneath, so a healthy
     fifth place looked like an error. The gap is a number; it is
     printed as one, under a heading that says what it is. */
  var rest = ranked.slice(3);
  Array.prototype.slice.call(cardsEl.children).forEach(function (el) {
    if (!el.classList.contains('lb-cards-head')) el.remove();   // keep the header row
  });
  rest.forEach(function(p, i) {
    var realRank  = i + 4;
    var gap       = maxPts - p.points;
    var badgeHtml = (p.badges && p.badges.length) ? '<span class="lb-badges-row">'+renderMiniBadges(p.badges)+'</span>' : '';

    var card = document.createElement('div');
    card.className = 'lb-card';
    card.innerHTML =
      '<div class="lb-card-rank">'
      +   '<span class="lb-card-rank-num">'+realRank+'</span>'
      +   rankMovementHtml(p)
      + '</div>'
      + '<div class="lb-card-info">'
      +   '<div class="lb-card-avatar">'+lbInitials(p.name)+'</div>'
      +   '<div class="lb-card-names">'
      +     '<div class="lb-card-team">'+p.name+badgeHtml+'</div>'
      +     (p.subName ? '<div class="lb-card-player">'+p.subName+'</div>' : '')
      +   '</div>'
      + '</div>'
      + '<div class="lb-card-rounds">'+p.rounds+'</div>'
      + '<div class="lb-card-gap">−'+gap+'</div>'
      + '<div class="lb-card-pts">'
      +   '<span class="lb-card-pts-val">'+p.points+'</span>'
      +   '<span class="lb-card-pts-lbl">pts</span>'
      + '</div>';

    card.addEventListener('click', function() {
      var existing = card.nextElementSibling;
      var isOpen   = existing && existing.classList.contains('lb-card-expand');
      cardsEl.querySelectorAll('.lb-card-expand').forEach(function(el){ el.remove(); });
      cardsEl.querySelectorAll('.lb-card.expanded').forEach(function(el){ el.classList.remove('expanded'); });
      /* ...and close the podium, so two teams are never open at once. */
      podiumRow.querySelectorAll('.lb-podium-slot.expanded').forEach(function(el) {
        el.classList.remove('expanded');
        el.setAttribute('aria-expanded', 'false');
      });
      podiumExpand.innerHTML = '';
      if (!isOpen) {
        card.classList.add('expanded');
        var exp = document.createElement('div');
        exp.className = 'lb-card-expand';
        card.after(exp);
        renderExpandedCard(exp, p);
      }
    });

    cardsEl.appendChild(card);
  });

  cardsWrap.style.display = rest.length ? 'block' : 'none';
}

/* "Gameweek 4" in a pill, in a row of ten, is mostly the word
   "Gameweek" ten times over; the number is what tells them apart.

   The bar chart used to shorten by taking the first word, which turned
   every one of "Gameweek 1", "Gameweek 2", "Gameweek 3" into the same
   label — a row of identical captions under different bars. Anything
   that is not a Gameweek/Round N keeps its own name rather than being
   truncated into something meaningless. */
function shortRoundName(round) {
  var full = (round && round.name) || 'Round';
  var m = full.match(/^(?:game\s*week|gameweek|round|week|gw|rnd)\s*([0-9]+[a-z]?)$/i);
  return m ? 'GW' + m[1] : full;
}

function renderExpandedCard(el, participant) {
  var roundIds = Object.keys(participant.roundPts);
  var html = '';
  if (roundIds.length) {
    var maxVal = Math.max.apply(null, Object.values(participant.roundPts).concat([1]));
    html += '<div class="lb-expand-rnds-label">Round by round</div><div class="lb-expand-bars">';
    roundIds.forEach(function(rid) {
      var pts   = participant.roundPts[rid] || 0;
      var rname = allRounds[rid] ? shortRoundName(allRounds[rid]) : 'Rnd';
      var wc    = allRounds[rid] && allRounds[rid].wildcard ? '\u2B50' : '';
      var h     = pts===0 ? 4 : Math.max(8, Math.round((pts/maxVal)*56));
      var isMax = pts===maxVal;
      var col   = isMax ? 'linear-gradient(to top,var(--gold),var(--gold2))' : 'rgba(255,255,255,0.15)';
      html += '<div class="lb-expand-bar-col" data-round="'+rid+'">'
        + '<span class="lb-expand-bar-pts" style="color:'+(isMax?'var(--gold)':'rgba(255,255,255,0.5)')+'">'+pts+'</span>'
        + '<div class="lb-expand-bar" style="height:'+h+'px;background:'+col+'"></div>'
        + '<span class="lb-expand-bar-rnd">'+rname+wc+'</span>'
        + '</div>';
    });
    html += '</div>';
  }
  /* One round at a time. Every pick used to print its own heading and
     its own eleven players one under another, so a team opened late in
     the season was a hundred rows deep and you scrolled past nine
     gameweeks to reach the one you wanted. */
  /* Chronological, so "the latest round" means the latest round.
     allRounds is filled from a query ordered by created_at, and string
     keys keep insertion order, so its key order is the season's order.
     A pick whose round is unknown sorts last rather than vanishing. */
  var order = Object.keys(allRounds);
  var picks = (participant.picks || []).slice().sort(function(a, b) {
    var ai = order.indexOf(a.round_id), bi = order.indexOf(b.round_id);
    return (ai < 0 ? 1e9 : ai) - (bi < 0 ? 1e9 : bi);
  });

  if (!roundIds.length && !picks.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;padding:12px 0">No score data yet.</div>';
    return;
  }

  if (picks.length) {
    html += '<div class="bd-rnd-pills" role="tablist"></div><div class="bd-rnd-panel"></div>';
  }
  el.innerHTML = html;
  if (!picks.length) return;

  var pillsEl = el.querySelector('.bd-rnd-pills');
  var panelEl = el.querySelector('.bd-rnd-panel');

  function renderRound(pick) {
    var round = allRounds[pick.round_id] || {};
    var isWC  = round.wildcard || false;
    var chip2 = pick.chip || null;
    var chip2Tag = chip2 && CHIP_META[chip2] ? ' ' + CHIP_META[chip2].icon + ' ' + CHIP_META[chip2].short : '';
    var eff2 = resolveCaptaincy(pick, scoreLookup);
    if (eff2.safetyTriggered) chip2Tag += ' (VC promoted)';

    /* The heading stays. The pill says which round is selected; this
       says what was special about it \u2014 wildcard, a chip, a promoted
       vice-captain \u2014 and none of that fits on a pill. */
    var out = '<div class="bd-round-title">'+(round.name||'Round')+(isWC?' \u2B50 Wildcard':'')+chip2Tag+'</div>'
            + '<div class="bd-player-list">';
    (pick.player_ids||[]).forEach(function(playerId) {
      var isCap = playerId === eff2.capId;
      var isVC  = playerId === eff2.vcId;
      var name  = allPlayers[playerId] || 'Unknown';
      var score = scoreLookup[pick.round_id+'_'+playerId];
      var bd    = score ? calcBreakdown(score, isCap, isWC, isVC, chip2, round.boost_modifier, roleOfPlayer(playerId)) : null;
      var isTC2 = isCap && (isWC || chip2 === 'triple_captain');
      var pts   = bd ? bd.total : null;
      out += '<div class="bd-player-row">'
        + '<div class="bd-player-left"><span class="bd-player-name">'+name+(isCap?' \u2B50\xd7'+(isTC2?'3':'2'):isVC?' \uD83C\uDF1F\xd71.5':'')+'</span>'
        + (bd&&bd.lines.length ? '<span class="bd-player-detail">'+bd.lines.join(' \xb7 ')+'</span>'
          : '<span class="bd-player-detail no-score">'+(score?'Did not contribute':'No score recorded')+'</span>')
        + '</div>'
        + '<span class="bd-player-pts">'+(pts!==null?pts+'pt':'\u2014')+'</span></div>';
    });
    panelEl.innerHTML = out + '</div>';
  }

  function select(i) {
    pillsEl.querySelectorAll('.bd-rnd-pill').forEach(function(b, n) {
      var on = n === i;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    /* Keep the chart and the pills reading as one list. */
    el.querySelectorAll('.lb-expand-bar-col').forEach(function(c) {
      c.classList.toggle('sel', c.dataset.round === picks[i].round_id);
    });
    renderRound(picks[i]);
  }

  picks.forEach(function(pick, i) {
    var round = allRounds[pick.round_id] || {};
    var b = document.createElement('button');
    b.className = 'bd-rnd-pill';
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.round = pick.round_id;
    var short = shortRoundName(round);
    var pts = participant.roundPts ? participant.roundPts[pick.round_id] : null;
    b.innerHTML = short + (round.wildcard ? ' \u2B50' : '')
                + (pts != null ? '<span class="bd-rnd-pill-pts">'+pts+'</span>' : '');
    b.addEventListener('click', function(e) {
      /* The card underneath collapses on click, so this must not
         reach it \u2014 selecting a gameweek would close the card. */
      e.stopPropagation();
      select(i);
    });
    pillsEl.appendChild(b);
  });

  /* Open on the latest round, which is the one people are looking
     for; the season's first gameweek is rarely the question. */
  select(picks.length - 1);
}
