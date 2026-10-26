/* ════════════════════════════════════════════════════
   TCC FANTASY — PICK YOUR XI
   Visual pitch dashboard. Dark. Game-like.
════════════════════════════════════════════════════ */
var SB_URL  = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var WORKER  = 'https://tcc-admin.bydaries.workers.dev';
var BUDGET  = 100;
var H = { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON };

/* STATE */
var currentParticipant = null;

function sessionExpired() {
  try { localStorage.removeItem('tcc_fantasy_participant'); } catch(e) {}
  alert('Your session has expired — please verify your email again.');
  window.location.href = 'fantasy.html';
}
var currentRound       = null;
var allPlayers         = [];
var allPicksData       = [];
var allScoresData      = [];
var recentRounds       = [];
var roundNames         = {};  // roundId → name
var selectedIds        = [];
var captainId          = null;
var viceCaptainId      = null;
var existingPickId     = null;
var activeRole         = 'all';
var searchQuery        = '';
var selectedChip       = null;   // chip chosen for THIS round (null = none)
var usedChips          = {};     // chip → round_id where already consumed
var CHIP_META = {
  triple_captain: { icon: '🚀', name: 'Triple Captain', desc: 'Captain scores ×3 instead of ×2.' },
  bench_boost:    { icon: '💪', name: 'Bench Boost',    desc: 'Flat +25pt safety net this round.' },
  budget_boost:   { icon: '💰', name: 'Budget Boost',   desc: '+R25 budget this round — fit an extra star.' },
  captain_safety: { icon: '🛡️', name: 'Captain Safety Net', desc: 'Captain under 10? Your VC is promoted to captain (×2).' }
};
var BUDGET_BOOST_AMOUNT = 25;

/* ── AUTH CHECK ── */
(function() {
  var saved = localStorage.getItem('tcc_fantasy_participant');
  if (!saved) { showAuthGate(); return; }
  try {
    currentParticipant = JSON.parse(saved);
    if (!currentParticipant || !currentParticipant.token) {
      // Pre-token session (before the security upgrade) — managers
      // re-verify once via OTP to get a signed participant token.
      localStorage.removeItem('tcc_fantasy_participant');
      window.location.href = 'fantasy.html';
      return;
    }
    if (!currentParticipant || !currentParticipant.id) { showAuthGate(); return; }
    // Verify participant still exists and is approved in DB before proceeding
    fetch(SB_URL+'/rest/v1/fantasy_participants?id=eq.'+currentParticipant.id+'&select=id,name,team_name,status', {headers:H})
      .then(function(r){ return r.json(); })
      .then(function(rows) {
        if (!rows || !rows.length) {
          // Record gone — clear stale localStorage and show auth gate
          localStorage.removeItem('tcc_fantasy_participant');
          showAuthGate();
          return;
        }
        if (rows[0].status !== 'approved') {
          localStorage.removeItem('tcc_fantasy_participant');
          showAuthGate();
          return;
        }
        // Sync latest name/team from DB in case admin updated it
        currentParticipant.name      = rows[0].name;
        currentParticipant.team_name = rows[0].team_name;
        localStorage.setItem('tcc_fantasy_participant', JSON.stringify(currentParticipant));
        init();
      })
      .catch(function(){ init(); }); // On network error, proceed anyway
  } catch(e) { localStorage.removeItem('tcc_fantasy_participant'); showAuthGate(); }
})();

function showAuthGate() {
  var overlay = document.getElementById('pk-auth-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function hideAuthGate() {
  var overlay = document.getElementById('pk-auth-overlay');
  if (overlay) overlay.style.display = 'none';
}

/* ── INIT ── */
async function init() {
  hideAuthGate();
  try {
    var [roundR, allPicksR, scoresR, roundsR] = await Promise.all([
      fetch(SB_URL+'/rest/v1/fantasy_rounds?locked=eq.false&order=created_at.desc&limit=1', {headers:H}).then(function(r){return r.json();}),
      fetch(SB_URL+'/rest/v1/fantasy_picks?select=participant_id,player_ids&order=created_at.desc', {headers:H}).then(function(r){return r.json();}),
      fetch(SB_URL+'/rest/v1/fantasy_scores?select=*&order=created_at.desc', {headers:H}).then(function(r){return r.json();}),
      fetch(SB_URL+'/rest/v1/fantasy_rounds?select=id,name,wildcard&order=created_at.desc&limit=5', {headers:H}).then(function(r){return r.json();})
    ]);

    if (!roundR || !roundR.length) {
      document.getElementById('pk-round-name').textContent = 'No Active Round';
      document.getElementById('pk-pool-loading').innerHTML = '<div style="padding:20px;color:var(--muted);font-size:0.78rem;text-align:center">No round open right now</div>';
      return;
    }

    currentRound   = roundR[0];
    allPicksData   = allPicksR  || [];
    allScoresData  = scoresR    || [];
    recentRounds   = (roundsR   || []).map(function(r){ roundNames[r.id] = r.name || 'Round'; return r.id; });

    document.getElementById('pk-round-name').textContent = currentRound.name + (currentRound.wildcard ? ' ⭐' : '') + (currentRound.h2h ? ' ⚔' : '');

    // Deadline
    var dl = new Date(currentRound.deadline);
    document.getElementById('pk-deadline').textContent = 'Deadline: ' + dl.toLocaleDateString('en-ZA',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

    // H2H opponent banner
    if (currentRound.h2h) {
      showH2HOpponentBanner(currentRound.id);
    }

    // Load players (public) and own pick + chip ledger (token-gated:
    // pre-lock picks are no longer readable with the anon key)
    /* fantasy_players, not players. The view IS the eligibility rule — active,
       playing member, not youth squad, and 18 or over — applied in the
       database. This query used to read players and filter on member_type
       alone, which let juniors onto the pick screen: squad records which side
       someone plays for, not their age, so a 16-year-old in the senior side
       came through. The age test needs dob, and dob is revoked from the anon
       key this page uses, so the page cannot do it and should not try. */
    var [pr, mine] = await Promise.all([
      fetch(SB_URL+'/rest/v1/fantasy_players?select=id,name,role,fantasy_value&order=fantasy_value.desc,name.asc', {headers:H}).then(function(r){return r.json();}),
      fetch(WORKER, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action:'fantasy.getMyPicks', token: currentParticipant.token,
                               payload:{ round_id: currentRound.id } })
      }).then(function(r){
        if (r.status === 401) { sessionExpired(); throw new Error('session'); }
        return r.ok ? r.json() : { pick: null, chips: [] };
      })
    ]);

    /* PostgREST answers an error with an object, not an array. Taking it as
       the squad put a non-array into allPlayers and the pool rendered empty
       with nothing on screen to say why — so say why. */
    if (!Array.isArray(pr)) {
      document.getElementById('pk-pool-loading').innerHTML =
        '<div style="padding:20px;color:#cc4444;font-size:0.78rem;text-align:center">'
        + 'Could not load the squad list.<br>Please tell the club.</div>';
      console.error('Squad list did not come back as a list:', pr);
      return;
    }
    allPlayers = pr;
    var pickR = mine && mine.pick ? [mine.pick] : [];
    ((mine && mine.chips) || []).forEach(function(row){ usedChips[row.chip] = row.round_id; });

    if (pickR && pickR.length) {
      // Existing pick for this round
      existingPickId = pickR[0].id;
      selectedIds    = pickR[0].player_ids || [];
      captainId      = pickR[0].captain_id;
      viceCaptainId  = pickR[0].vice_captain_id || null;
      selectedChip   = pickR[0].chip || null;
      var notice = document.getElementById('pk-xi-notice');
      if (notice) { notice.textContent = 'Editing existing team — submit to update'; notice.style.display = 'block'; }
      document.querySelectorAll('.pk-submit-btn').forEach(function(b){ b.textContent = 'Update XI'; });

    } else {
      // No pick for this round — silently carry over from most recent previous round
      try {
        var prevR = await fetch(
          SB_URL + '/rest/v1/fantasy_picks'
          + '?participant_id=eq.' + currentParticipant.id
          + '&round_id=neq.' + currentRound.id
          + '&select=player_ids,captain_id,vice_captain_id'
          + '&order=created_at.desc&limit=1',
          { headers: H }
        ).then(function(r) { return r.json(); });

        if (prevR && prevR.length) {
          var prev      = prevR[0];
          var activeIds = new Set((allPlayers || []).map(function(p) { return p.id; }));

          selectedIds   = (prev.player_ids || []).filter(function(id) { return activeIds.has(id); });
          captainId     = activeIds.has(prev.captain_id)      ? prev.captain_id      : null;
          viceCaptainId = activeIds.has(prev.vice_captain_id) ? prev.vice_captain_id : null;

          /* Trim the carried team to THIS round's budget.

             A chip is played for one round. An XI that cost R118 last week
             only fitted because Budget Boost lifted the cap to R125 — this
             week the cap is R100 again and that chip is spent for the
             season. Copying the team across regardless left managers over
             budget with a dead Submit button, no explanation, and no way
             back: re-playing the boost is refused because it was used in a
             previous round.

             So the dearest players come off until it fits, and whoever is
             left is pre-filled for the manager to complete. */
          /* Cheapest player not already in the team — what an empty slot
             will cost at minimum. */
          var cheapestFree = function () {
            var min = null;
            allPlayers.forEach(function (p) {
              if (selectedIds.indexOf(p.id) !== -1) return;
              var v = p.fantasy_value || 0;
              if (min === null || v < min) min = v;
            });
            return min === null ? 0 : min;
          };
          /* Room for an ELEVEN, not just for what is left. Trimming only
             until the current ten fit leaves a manager on R96 of R100 with
             one empty slot and nobody under R4 to put in it — stuck again,
             just more subtly. */
          var needsTrim = function () {
            var slots = 11 - selectedIds.length;
            return getSpent() + (slots > 0 ? slots * cheapestFree() : 0) > effectiveBudget();
          };

          var droppedForBudget = [];
          var guard = 0;
          while (selectedIds.length && needsTrim() && guard++ < 20) {
            var dearest = null, dearestVal = -1;
            selectedIds.forEach(function(id) {
              var pl = allPlayers.find(function(x){ return x.id === id; });
              var v  = (pl && pl.fantasy_value) || 0;
              if (v > dearestVal) { dearestVal = v; dearest = id; }
            });
            if (dearest === null) break;
            var dp = allPlayers.find(function(x){ return x.id === dearest; });
            droppedForBudget.push(dp ? dp.name : 'a player');
            selectedIds = selectedIds.filter(function(id){ return id !== dearest; });
            if (captainId === dearest)     captainId = null;
            if (viceCaptainId === dearest) viceCaptainId = null;
          }

          // Only auto-save if we have a complete valid team
          if (selectedIds.length === 11 && captainId && viceCaptainId) {
            /* Through the Worker, not straight into the table. This used to
               POST to /rest/v1/fantasy_picks with the public key, which
               skipped every rule the Worker enforces — budget, eligibility,
               the chip ledger — and wrote whatever the previous round held. */
            var coRes = await fetch(WORKER, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'fantasy.submitPicks', token: currentParticipant.token,
                payload: { round_id: currentRound.id, player_ids: selectedIds,
                           captain_id: captainId, vice_captain_id: viceCaptainId, chip: null }
              })
            });
            var coData = await coRes.json().catch(function() { return null; });
            if (coRes.ok && coData && coData.pick_id) {
              existingPickId = coData.pick_id;
              document.querySelectorAll('.pk-submit-btn').forEach(function(b){ b.textContent = 'Update XI'; });
            }
            /* If the Worker refuses, say nothing and leave the team on
               screen unsaved — the manager can see it and fix it. Carrying
               over is a convenience, not something to fail loudly over. */
          } else if (droppedForBudget.length) {
            var n2 = document.getElementById('pk-xi-notice');
            if (n2) {
              n2.textContent = 'Last round’s team is over this round’s budget — '
                + droppedForBudget.join(', ') + ' removed. Pick replacements.';
              n2.style.display = 'block';
            }
            document.querySelectorAll('.pk-submit-btn').forEach(function(b){ b.textContent = 'Submit XI'; });
          } else {
            // Incomplete carryover (inactive captain etc.) — pre-fill what we can, let them complete
            document.querySelectorAll('.pk-submit-btn').forEach(function(b){ b.textContent = 'Submit XI'; });
          }
        }
      } catch(e) {
        // Carryover failed silently — player starts with blank team
      }
    }

    document.getElementById('pk-pool-loading').style.display = 'none';
    renderPool();
    renderPitch();
    renderXIList();
    renderChips();
    updateChipSummary();
    updateHUD();
    watchDeadline();
  } catch(e) {
    console.error('Init error:', e);
    document.getElementById('pk-pool-loading').innerHTML = '<div style="padding:20px;color:#cc4444;font-size:0.78rem;text-align:center">Error loading — try refreshing</div>';
  }
}

/* ── POOL RENDER ── */
function renderPool() {
  var list = document.getElementById('pk-pool-list');
  if (!list) return;
  var spent = getSpent();
  list.innerHTML = '';
  allPlayers.forEach(function(p, i) {
    var val       = p.fantasy_value || 5;
    var isSel     = selectedIds.includes(p.id);
    var isCap     = captainId === p.id;
    var isVC      = viceCaptainId === p.id;
    var wouldOver = !isSel && (spent + val > effectiveBudget());
    var roleMatch = activeRole === 'all' || p.role.toLowerCase().replace(/-/g,' ').trim() === activeRole.toLowerCase().replace(/-/g,' ').trim();
    var nameMatch = !searchQuery || p.name.toLowerCase().includes(searchQuery);
    if (!roleMatch || !nameMatch) return;

    var pct  = getSelectionPct(p.id);
    var form = getPlayerForm(p.id);

    var card = document.createElement('div');
    card.className = 'pk-player-card' + (isCap?' captain':isVC?' vc':isSel?' selected':'') + (wouldOver?' over-budget':'');
    card.dataset.id = p.id;

    var formHtml = form.some(function(f){return f!==null;})
      ? form.map(function(f){
          if(f===null) return '<span class="pk-form-dot empty">·</span>';
          var pts = f.pts !== undefined ? f.pts : f;
          return '<span class="pk-form-dot '+(pts>=40?'hot':pts>=20?'ok':'cold')+'">'+pts+'</span>';
        }).join('')
      : '<span class="pk-form-dot empty" style="font-size:0.55rem;font-style:italic">—</span>';

    var career  = getCareerStats(p.id);
    var avgBadge = career ? '<span class="pk-pc-avg">' + career.avgPts + ' avg</span>' : '';
    var hasForm  = form.some(function(f){ return f !== null; });

    card.innerHTML =
      '<div class="pk-pc-left">'
      + '<div class="pk-pc-name">'+p.name+'</div>'
      + '<div class="pk-pc-meta"><span class="pk-pc-role">'+p.role+'</span><div class="pk-pc-form">'+formHtml+'</div>'+avgBadge+'</div>'
      + '</div>'
      + '<div class="pk-pc-right">'
      + '<div class="pk-pc-val">R'+val+'</div>'
      + (pct !== null ? '<div class="pk-pc-pct">'+pct+'% picked</div>' : '')
      + '</div>'
      + (hasForm ? '<button class="pk-form-toggle" title="Form guide" aria-label="Show form guide">▾</button>' : '');

    if (!wouldOver) {
      card.addEventListener('click', function(e){
        // Don\'t select when tapping the form toggle button
        if (e.target.closest('.pk-form-toggle') || e.target.closest('.pk-form-panel')) return;
        togglePlayer(p.id, val, p.name, p.role);
      });
    }

    // Form toggle button
    if (hasForm) {
      card.querySelector('.pk-form-toggle').addEventListener('click', function(e) {
        e.stopPropagation();
        var existing = card.querySelector('.pk-form-panel');
        if (existing) {
          existing.remove();
          this.textContent = '▾';
          card.classList.remove('form-open');
        } else {
          var panel = buildFormPanel(p.id, career);
          card.appendChild(panel);
          this.textContent = '▴';
          card.classList.add('form-open');
        }
      });
    }

    list.appendChild(card);
  });
  if (!list.children.length) {
    list.innerHTML = '<div style="padding:20px;color:var(--muted);font-size:0.78rem;text-align:center">No players match</div>';
  }
}

/* ── TOGGLE PLAYER ── */
/* Selection and the armbands used to be one overloaded tap:
   select → captain → vice-captain → remove. Two things were wrong with it.
   Tapping any already-selected player made them captain unconditionally, so
   the player who had the armband lost it silently and nobody was told. And
   taking someone out of the XI meant tapping through captain and VC first,
   wiping both on the way past.

   They are separate now. A tap puts a player in or takes them out, and
   nothing else. The armbands are given explicitly from the menu on the
   pitch, where you can see who holds them before you move one. */
function togglePlayer(id, val) {
  if (selectedIds.includes(id)) {
    removePlayer(id);
    return;
  }
  if (selectedIds.length >= 11) return;
  if (getSpent() + (val || 0) > effectiveBudget()) return;
  selectedIds.push(id);
  repaint();
  hidePitchTip();
}

function removePlayer(id) {
  selectedIds = selectedIds.filter(function(i){ return i !== id; });
  if (captainId === id)     captainId = null;
  if (viceCaptainId === id) viceCaptainId = null;
  repaint();
}

/* Captain and vice-captain are one each, and never the same person. Giving
   one to whoever holds the other simply moves them across. */
function setCaptain(id) {
  if (!selectedIds.includes(id)) return;
  captainId = (captainId === id) ? null : id;
  if (captainId !== null && viceCaptainId === captainId) viceCaptainId = null;
  repaint();
}

function setViceCaptain(id) {
  if (!selectedIds.includes(id)) return;
  viceCaptainId = (viceCaptainId === id) ? null : id;
  if (viceCaptainId !== null && captainId === viceCaptainId) captainId = null;
  repaint();
}

function repaint() {
  renderPool();
  renderPitch();
  renderXIList();
  updateHUD();
}

/* ── PITCH RENDER ── */
var ROLE_ZONES = {
  'wicketkeeper': 'keeper',
  'batter':       'batters',
  'batsman':      'batters',
  'all-rounder':  'allrounders',
  'allrounder':   'allrounders',
  'all rounder':  'allrounders',
  'bowling allrounder': 'allrounders',
  'batting allrounder': 'allrounders',
  'bowler':       'bowlers'
};

function getRoleZone(role) {
  if (!role) return 'batters';
  return ROLE_ZONES[role.toLowerCase().replace(/-/g,' ').trim()] || 'batters';
}

function renderPitch() {
  ['keeper','batters','allrounders','bowlers'].forEach(function(zone) {
    var el = document.getElementById('slots-'+zone);
    if (el) el.innerHTML = '';
  });

  selectedIds.forEach(function(id) {
    var p = allPlayers.find(function(pl){ return pl.id === id; });
    if (!p) return;
    var zone = getRoleZone(p.role);
    var slotEl = document.getElementById('slots-'+zone);
    if (!slotEl) return;
    var isCap = captainId === id;
    var isVC  = viceCaptainId === id;
    var initials = p.name.split(' ').map(function(w){ return w[0]; }).join('').slice(0,2).toUpperCase();
    var val = p.fantasy_value || 5;

    var chip = document.createElement('div');
    chip.className = 'pk-pitch-chip' + (isCap ? ' is-captain' : isVC ? ' is-vc' : '');
    chip.dataset.id = id;
    chip.innerHTML =
      '<div class="pk-chip-avatar">'
      + initials
      + (isCap ? '<div class="pk-chip-captain-badge">⭐</div>' : '')
      + (isVC  ? '<div class="pk-chip-captain-badge">🌟</div>' : '')
      + '</div>'
      + '<div class="pk-chip-name">'+p.name.split(' ')[0]+'</div>'
      + '<div class="pk-chip-val">R'+val+'</div>';

    /* The ✕ that used to sit on the corner is gone: it only ever appeared on
       hover, so it was unreachable on a phone, and the menu below now holds
       Remove along with everything else. One way to do each thing. */
    chip.addEventListener('click', function() { openPlayerMenu(id, chip); });
    slotEl.appendChild(chip);
  });
}

/* ── XI LIST ── */
function renderXIList() {
  var list = document.getElementById('pk-xi-list');
  if (!list) return;
  if (!selectedIds.length) { list.innerHTML = '<div class="pk-xi-empty">No players selected yet</div>'; return; }
  list.innerHTML = '';
  selectedIds.forEach(function(id) {
    var p = allPlayers.find(function(pl){ return pl.id === id; });
    if (!p) return;
    var isCap = captainId === id;
    var isVC  = viceCaptainId === id;
    var initials = p.name.split(' ').map(function(w){ return w[0]; }).join('').slice(0,2).toUpperCase();
    var val = p.fantasy_value || 5;

    var row = document.createElement('div');
    row.className = 'pk-xi-player' + (isCap ? ' is-captain' : isVC ? ' is-vc' : '');
    var capLabel = isCap ? '<div class="pk-xi-cap">Captain ×'+(currentRound&&currentRound.wildcard?'3':'2')+'</div>'
                 : isVC  ? '<div class="pk-xi-cap" style="color:#a0c0ff">VC ×1.5</div>'
                 : '';
    row.innerHTML =
      '<div class="pk-xi-avatar">'+initials+'</div>'
      + '<div class="pk-xi-info"><div class="pk-xi-name">'+p.name+'</div><div class="pk-xi-role">'+p.role+'</div></div>'
      + '<div class="pk-xi-right"><div class="pk-xi-val">R'+val+'</div>'+capLabel+'</div>'
      + '<button class="pk-xi-remove" data-id="'+id+'">✕</button>';

    row.addEventListener('click', function() { openPlayerMenu(id, row); });
    row.querySelector('.pk-xi-remove').addEventListener('click', function(e) {
      e.stopPropagation();
      removePlayer(id);
    });
    list.appendChild(row);
  });
}

/* ── HUD UPDATE ── */
function updateHUD() {
  var count     = selectedIds.length;
  var spent     = getSpent();
  var budget    = effectiveBudget();
  var remaining = budget - spent;
  var pct       = (spent / budget) * 100;

  function set(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

  set('pk-selected', count);
  var selEl = document.getElementById('pk-selected');
  if (selEl) { selEl.innerHTML = count + '<span>/11</span>'; }

  set('pk-budget', 'R'+remaining);
  set('pk-xi-spent', 'R'+spent);
  set('pk-xi-left', 'R'+remaining + (selectedChip === 'budget_boost' ? ' 💰' : ''));
  var leftEl = document.getElementById('pk-xi-left');
  if (leftEl) leftEl.className = remaining < 10 ? '' : 'green';

  set('pk-captain', captainId ? (allPlayers.find(function(p){return p.id===captainId;})||{name:'?'}).name : '—');
  set('pk-vc',      viceCaptainId ? (allPlayers.find(function(p){return p.id===viceCaptainId;})||{name:'?'}).name : '—');

  var fill = document.getElementById('pk-budget-fill');
  if (fill) { fill.style.width = Math.min(pct,100)+'%'; fill.className = 'pk-budget-fill' + (remaining < 10 ? ' danger' : ''); }

  var ready = count === 11 && captainId !== null && viceCaptainId !== null
              && remaining >= 0 && !deadlinePassed();
  document.querySelectorAll('.pk-submit-btn, .pk-submit-btn-lg').forEach(function(b){ b.disabled = !ready; });

  /* The phone's squad-sheet trigger carries the count, so it is useful to
     look at without opening the sheet. */
  var tc = document.getElementById('pk-pool-trigger-count');
  if (tc) {
    tc.textContent = count + '/11';
    tc.className = 'pk-pt-count' + (count === 11 ? ' complete' : '');
  }
  var tl = document.getElementById('pk-pool-trigger');
  if (tl) {
    var lab = tl.querySelector('.pk-pt-label');
    if (lab) lab.textContent = count === 11 ? 'Change players' : 'Add players';
  }
  /* The moment the eleventh is picked, get out of the way so the pitch is
     visible and the captain can be chosen by tapping a player there. Only on
     that 10→11 step: once eleven are in, tapping in the sheet is how a
     captain is named, and closing it under them every time would be
     maddening. */
  if (count === 11 && _hudCount === 10 && typeof closePoolSheet === 'function') {
    closePoolSheet();
  }
  _hudCount = count;
}
var _hudCount = -1;

/* ── HELPERS ── */
function effectiveBudget() {
  // Budget Boost chip adds R25 to the cap for this round only.
  return BUDGET + (selectedChip === 'budget_boost' ? BUDGET_BOOST_AMOUNT : 0);
}
function getSpent() {
  return selectedIds.reduce(function(sum, id) {
    var p = allPlayers.find(function(pl){ return pl.id === id; });
    return sum + (p ? (p.fantasy_value || 5) : 0);
  }, 0);
}
function getSelectionPct(playerId) {
  if (!allPicksData.length) return null;
  var count = allPicksData.filter(function(p){ return (p.player_ids||[]).includes(playerId); }).length;
  var total = allPicksData.length;
  return total ? Math.round((count/total)*100) : 0;
}
function calcPts(score) {
  var pts = 0, runs = score.runs||0, wkts = score.wickets||0;
  pts += runs; if(runs>=50)pts+=10; if(runs>=100)pts+=25;
  pts += wkts*15; if(wkts>=5)pts+=20;
  if (score.economy != null && score.economy > 0) {
    var e = score.economy;
    pts += e<=5?10:e<=6?6:e<=7?2:e<=8?0:e<=9?-2:-4;
  }
  pts += (score.maidens||0)*10 + (score.catches||0)*10 + (score.stumpings||0)*10 + (score.runouts||0)*10;
  if (score.player_of_match) pts += 25;
  return pts;
}
function getPlayerForm(playerId) {
  // Returns array of {pts, roundName} for recent rounds, null if not scored
  return recentRounds.map(function(roundId) {
    var score = allScoresData.find(function(s){ return s.player_id===playerId && s.round_id===roundId; });
    if (!score) return null;
    return { pts: calcPts(score), name: roundNames[roundId] || 'Round' };
  });
}
function getCareerStats(playerId) {
  var scores = allScoresData.filter(function(s){ return s.player_id === playerId; });
  if (!scores.length) return null;
  var totalPts = scores.reduce(function(s,x){ return s + calcPts(x); }, 0);
  return {
    rounds:   scores.length,
    runs:     scores.reduce(function(s,x){ return s+(x.runs||0); }, 0),
    wickets:  scores.reduce(function(s,x){ return s+(x.wickets||0); }, 0),
    avgPts:   Math.round(totalPts / scores.length),
  };
}
function buildFormPanel(playerId, career) {
  var panel = document.createElement('div');
  panel.className = 'pk-form-panel';

  var form = getPlayerForm(playerId);
  var scores = allScoresData.filter(function(s){ return s.player_id === playerId; });
  var maxPts = Math.max.apply(null, form.map(function(f){ return f ? f.pts : 0; }).concat([1]));

  // Bar chart rows
  var bars = form.map(function(f) {
    if (!f) return '<div class="pk-fp-row pk-fp-empty"><span class="pk-fp-label">—</span></div>';
    var pct  = Math.round((f.pts / maxPts) * 100);
    var cls  = f.pts >= 40 ? 'hot' : f.pts >= 20 ? 'ok' : 'cold';
    // Build detail string from the score
    var score = allScoresData.find(function(s){ return s.player_id === playerId && s.round_id === recentRounds[form.indexOf(f)]; });
    var detail = [];
    if (score) {
      if (score.runs)    detail.push(score.runs + 'r');
      if (score.wickets) detail.push(score.wickets + 'w');
      if (score.catches) detail.push(score.catches + 'c');
      if (score.maidens) detail.push(score.maidens + 'md');
      if (score.economy && score.economy > 0) detail.push('eco ' + parseFloat(score.economy).toFixed(1));
      if (score.player_of_match) detail.push('★');
    }
    return '<div class="pk-fp-row">'
      + '<span class="pk-fp-label">' + f.name + '</span>'
      + '<div class="pk-fp-bar-wrap"><div class="pk-fp-bar pk-fp-bar-'+cls+'" style="width:'+pct+'%"></div></div>'
      + '<span class="pk-fp-pts pk-fp-pts-'+cls+'">' + f.pts + 'pt</span>'
      + (detail.length ? '<span class="pk-fp-detail">' + detail.join('·') + '</span>' : '')
      + '</div>';
  }).join('');

  // Career summary line
  var careerHtml = '';
  if (career) {
    var items = [career.rounds + ' round' + (career.rounds!==1?'s':''), career.avgPts + ' avg'];
    if (career.runs)    items.push(career.runs + ' runs');
    if (career.wickets) items.push(career.wickets + ' wkt' + (career.wickets!==1?'s':''));
    careerHtml = '<div class="pk-fp-career">' + items.join(' · ') + '</div>';
  }

  panel.innerHTML =
    '<div class="pk-fp-heading">Form — Last ' + form.length + ' rounds</div>'
    + bars
    + careerHtml;
  return panel;
}

function hidePitchTip() {
  if (selectedIds.length > 0) {
    var tip = document.getElementById('pk-pitch-tip');
    if (tip) tip.style.opacity = '0';
  }
}

/* ── FILTERS ── */
document.querySelectorAll('.pk-filter').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.pk-filter').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    activeRole = btn.dataset.role;
    renderPool();
  });
});

var searchEl = document.getElementById('pk-search');
if (searchEl) searchEl.addEventListener('input', function() {
  searchQuery = this.value.trim().toLowerCase();
  renderPool();
});

/* ══════════════════════════════════════════════════════
   H2H OPPONENT BANNER
   Shows who you're facing this round below the deadline.
══════════════════════════════════════════════════════ */
async function showH2HOpponentBanner(roundId) {
  if (!currentParticipant) return;

  try {
    // Fetch fixtures for this round
    var r        = await fetch(SB_URL+'/rest/v1/fantasy_h2h_fixtures?round_id=eq.'+roundId+'&select=*', {headers:H});
    var fixtures = await r.json();
    if (!fixtures || !fixtures.length) return;

    // Find the fixture involving this participant
    var myFixture = fixtures.find(function(f) {
      return f.participant_a === currentParticipant.id || f.participant_b === currentParticipant.id;
    });
    if (!myFixture) return;

    var opponentId = myFixture.participant_a === currentParticipant.id
      ? myFixture.participant_b
      : myFixture.participant_a;

    var opponentName = 'Mr. Average';
    if (opponentId) {
      var oR   = await fetch(SB_URL+'/rest/v1/fantasy_participants?id=eq.'+opponentId+'&select=name,team_name', {headers:H});
      var oRow = await oR.json();
      if (oRow && oRow.length) opponentName = oRow[0].team_name || oRow[0].name;
    }

    // Inject banner after pk-deadline
    var banner = document.createElement('div');
    banner.className = 'pk-h2h-banner';
    banner.innerHTML = '⚔ H2H Round · You vs <strong>' + opponentName + '</strong>';

    var deadlineEl = document.getElementById('pk-deadline');
    if (deadlineEl && deadlineEl.parentNode) {
      deadlineEl.parentNode.insertBefore(banner, deadlineEl.nextSibling);
    }
  } catch(e) {
    console.warn('H2H banner error:', e);
  }
}

/* ── CHIPS / POWER-UPS ──
   Renders the chip selector. Each chip is once-per-season; a chip already
   spent in another round is shown locked. A chip spent in THIS round can be
   toggled off (until the round locks). */
function renderChips() {
  var wrap = document.getElementById('pk-chips');
  if (!wrap) return;

  /* All four. These names must match CHIP_META in leaderboard.js, which is
     what actually scores them (calcPoints / resolveCaptaincy /
     pickRoundPoints), and the chip values the Worker accepts. The three
     that are not budget_boost were briefly rejected at submit as "Unknown
     chip" because the Worker's allowlist had fallen behind this list. */
  var order = ['triple_captain','bench_boost','budget_boost','captain_safety'];
  var html = '';
  order.forEach(function(key) {
    var meta = CHIP_META[key];
    var spentRound = usedChips[key];
    var spentElse  = spentRound && (!currentRound || spentRound !== currentRound.id);
    /* Deliberately no "spent in THIS round" state. Whether a chip is on for
       the round being edited is exactly `active`, which is loaded from the
       saved pick — and a chip can now be taken off again, so a second
       "played here" flag could only ever contradict it. */
    var active     = selectedChip === key;

    var cls = 'pk-chip-card';
    if (active)         cls += ' active';
    if (spentElse)      cls += ' spent';

    html += '<button type="button" class="' + cls + '" data-chip="' + key + '"'
          + (spentElse ? ' disabled' : '') + '>'
          + '<span class="pk-chip-ic">' + meta.icon + '</span>'
          + '<span class="pk-chip-nm">' + meta.name + '</span>'
          + '<span class="pk-chip-ds">' + meta.desc + '</span>'
          + '<span class="pk-chip-state">'
          + (spentElse ? 'Used in another round'
             : active   ? 'Active this round ✓ — tap to remove'
             : 'Tap to play')
          + '</span>'
          + '</button>';
  });

  wrap.innerHTML = html;

  wrap.querySelectorAll('.pk-chip-card').forEach(function(btn) {
    if (btn.disabled) return;
    btn.addEventListener('click', function(e) {
      /* renderChips() below replaces this button's own DOM node. By the time
         the click reaches the document-level "tap outside to close" handler,
         e.target is detached, so popover.contains(e.target) is false and the
         popover shuts itself the instant a power-up is chosen. Stop the
         click here and it stays open. */
      e.stopPropagation();
      var key = btn.dataset.chip;
      // Toggle: tapping the active chip turns it off
      selectedChip = (selectedChip === key) ? null : key;
      renderChips();
      updateChipSummary();
      // Budget Boost changes the effective cap, so refresh pool + HUD.
      renderPool();
      updateHUD();
    });
  });
}

function updateChipSummary() {
  var el = document.getElementById('pk-chip-active');
  if (!el) return;
  if (selectedChip) {
    el.innerHTML = CHIP_META[selectedChip].icon + ' ' + CHIP_META[selectedChip].name;
    el.style.display = '';
  } else {
    el.textContent = '—';
  }
}

function showBoostBanner(round) {
  if (!round || !round.boost_modifier) return;
  var labels = {
    bowlers_double:    '🎯 Bowlers Double — bowling points ×2 this round',
    batters_double:    '🏏 Batters Double — batting points ×2 this round',
    allrounders_boost: '⚡ All-Rounders Boost — AR points ×1.5 this round',
    bonus_economy:     '📉 Economy Bonus Weekend — economy bonuses ×2 this round',
    potm_double:       '🏆 POTM Double — Player of Match bonus ×2 this round'
  };
  var text = labels[round.boost_modifier];
  if (!text) return;
  var banner = document.createElement('div');
  banner.className = 'pk-boost-banner';
  banner.innerHTML = '<span class="pk-boost-icon">🚀</span> <strong>Round Boost:</strong> ' + text;
  var deadlineEl = document.getElementById('pk-deadline');
  if (deadlineEl && deadlineEl.parentNode) {
    deadlineEl.parentNode.insertBefore(banner, deadlineEl.nextSibling);
  }
}

/* ── THE DEADLINE ──────────────────────────────────────────────────
   The server is the authority — validatePickSubmission refuses anything
   sent after the deadline. This is so a manager finds out from the page
   rather than from a red error after tapping Submit, and so a screen
   left open through the deadline stops offering to save. */
function deadlinePassed() {
  if (!currentRound || !currentRound.deadline) return false;
  var t = new Date(currentRound.deadline).getTime();
  return isFinite(t) && Date.now() >= t;
}

function closePicks() {
  document.querySelectorAll('.pk-submit-btn, .pk-submit-btn-lg').forEach(function(b) {
    b.disabled = true;
  });
  var big = document.getElementById('pk-submit-btn-lg');
  if (big) big.textContent = 'Picks closed';
  var n = document.getElementById('pk-xi-notice');
  if (n) {
    n.textContent = 'The deadline has passed — picks are closed for this round.';
    n.style.display = 'block';
  }
  var dl = document.getElementById('pk-deadline');
  if (dl) dl.textContent = 'Deadline passed';
}

/* Watch for it arriving while the page is open. Someone who opens the
   screen two minutes before the deadline should see it close, not keep
   a live Submit button that the server will refuse. */
function watchDeadline() {
  if (!currentRound || !currentRound.deadline) return;
  var t = new Date(currentRound.deadline).getTime();
  if (!isFinite(t)) return;
  var handle = setInterval(function() {
    if (Date.now() < t) return;
    clearInterval(handle);
    closePicks();
    updateHUD();
  }, 1000);
  if (Date.now() >= t) { clearInterval(handle); closePicks(); }
}

/* ── SUBMIT ── */
function handleSubmit() {
  if (deadlinePassed()) { closePicks(); return; }
  if (selectedIds.length !== 11 || !captainId || !viceCaptainId) return;
  var errEl = document.getElementById('pk-error');
  if (errEl) errEl.textContent = '';
  document.querySelectorAll('.pk-submit-btn, .pk-submit-btn-lg').forEach(function(b){ b.disabled = true; });

  // The worker validates everything server-side: round lock, squad
  // size, budget (incl. Budget Boost), captain/VC, chip rules — and
  // writes the pick + chip ledger together.
  fetch(WORKER, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      action: 'fantasy.submitPicks',
      token:  currentParticipant.token,
      payload: { round_id: currentRound.id, player_ids: selectedIds,
                 captain_id: captainId, vice_captain_id: viceCaptainId, chip: selectedChip }
    })
  })
    .then(function(r) {
      if (r.status === 401) { sessionExpired(); throw new Error('session'); }
      return r.json().catch(function(){ return {}; }).then(function(d) {
        if (!r.ok) throw new Error(d.error || ('Failed ' + r.status));
        return d;
      });
    })
    .then(function(d) {
      if (d.pick_id) existingPickId = d.pick_id;
      /* Rebuild this round's entry rather than only adding to it. Taking a
         power-up off returns chip:null, and the old code just skipped the
         update — so the chip stayed in usedChips and the card went on
         saying it had been played until the page was reloaded. */
      Object.keys(usedChips).forEach(function(k) {
        if (usedChips[k] === currentRound.id) delete usedChips[k];
      });
      if (d.chip) usedChips[d.chip] = currentRound.id;
      selectedChip = d.chip || null;
      renderChips();
      updateChipSummary();
      showSuccess();
    })
    .catch(function(e) {
      if (e.message === 'session') return;
      if (errEl) errEl.textContent = '❌ ' + (e.message && e.message !== 'Failed undefined' ? e.message : 'Could not save. Please try again.');
      document.querySelectorAll('.pk-submit-btn, .pk-submit-btn-lg').forEach(function(b){ b.disabled = false; });
    });
}

document.querySelectorAll('.pk-submit-btn, .pk-submit-btn-lg').forEach(function(btn) {
  btn.addEventListener('click', handleSubmit);
});

/* ── SUCCESS ── */
function showSuccess() {
  var overlay = document.getElementById('pk-success-overlay');
  var msg     = document.getElementById('pk-success-msg');
  var ring    = document.getElementById('pk-success-ring-circle');
  if (overlay) overlay.style.display = 'flex';
  var teamLabel = currentParticipant.team_name ? '"'+currentParticipant.team_name+'"' : currentParticipant.name+"'s team";
  if (msg) msg.textContent = teamLabel + ' is locked in for "' + currentRound.name + '". Good luck!';
  if (ring) setTimeout(function(){ ring.style.strokeDashoffset = '0'; }, 300);
}

document.getElementById('pk-edit-team-btn').addEventListener('click', function() {
  var overlay = document.getElementById('pk-success-overlay');
  if (overlay) overlay.style.display = 'none';
  var notice = document.getElementById('pk-xi-notice');
  if (notice) { notice.textContent = 'Editing your team — submit to update'; notice.style.display = 'block'; }
});

/* ── PROFILE / SIGN OUT / DEREGISTER ── */
var editProfileBtn = document.getElementById('pk-edit-profile-btn');
if (editProfileBtn) editProfileBtn.addEventListener('click', function() {
  window.location.href = 'fantasy.html?edit=1';
});

var signoutBtn = document.getElementById('pk-signout-btn');
if (signoutBtn) signoutBtn.addEventListener('click', function() {
  localStorage.removeItem('tcc_fantasy_participant');
  window.location.href = 'fantasy.html';
});

var deregBtn = document.getElementById('pk-deregister-btn');
if (deregBtn) deregBtn.addEventListener('click', async function() {
  if (!currentParticipant) return;
  if (!confirm('Remove your account? This deletes all your picks and cannot be undone.')) return;
  this.disabled = true; this.textContent = 'Removing…';
  try {
    await fetch(WORKER, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action:'fantasy.deleteParticipant', payload:{ id:currentParticipant.id } })
    });
    localStorage.removeItem('tcc_fantasy_participant');
    window.location.href = 'fantasy.html';
  } catch(e) { alert('Could not remove account.'); this.disabled=false; this.textContent='Remove account'; }
});

/* ══════════════════════════════════════════════════════
   DEADLINE PUSH NOTIFICATIONS
   Bell button on the pick page. Reuses the same VAPID
   key and Cloudflare Worker as the live score push.
   Stores subscription in push_subscriptions with
   source='fantasy' so the cron job targets it separately.
══════════════════════════════════════════════════════ */
var VAPID_PUBLIC_F = 'BKu9YMCDYKnL8itqaPORCYhRWG_d9uv8jKPi1Mx-X-sHmQOpMKVHPni3fxXihpWHrShLxaukcxazvlzzs1UvX9w';
var PUSH_SW_URL_F  = '/push-sw.js';
var LS_FANTASY_PUSH = 'tcc_fantasy_push_subscribed';

function initFantasyPush() {
  var btn = document.getElementById('pk-bell-btn');
  if (!btn) return;
  if (!('PushManager' in window) || !('serviceWorker' in navigator)) return;
  btn.style.display = 'inline-flex';
  var subbed = localStorage.getItem(LS_FANTASY_PUSH) === '1';
  updateBellUI_F(subbed);
  btn.addEventListener('click', function() {
    if (localStorage.getItem(LS_FANTASY_PUSH) === '1') {
      unsubscribeFantasyPush();
    } else {
      subscribeFantasyPush();
    }
  });
}

function updateBellUI_F(subbed) {
  var btn = document.getElementById('pk-bell-btn');
  if (!btn) return;
  btn.textContent = subbed ? '🔔' : '🔕';
  btn.title = subbed ? 'Deadline reminders on — tap to turn off' : 'Tap for deadline reminders';
  btn.classList.toggle('subscribed', subbed);
}

function urlBase64ToUint8Array_F(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  var out = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

/* ──────────────────────────────────────────────────────
   Push subscription helpers.
   Three service workers (/sw.js, /fantasy-sw.js, /push-sw.js) were all
   registering at scope '/', so each replaced the last and took the push
   subscription with it. The push SW now gets a dedicated scope — push events
   are delivered to the registration, so scope has no effect on delivery.
────────────────────────────────────────────────────── */
var PUSH_SW_SCOPE_F = '/push/';

function pushKeysMatch_F(existingKey, wantedBytes) {
  if (!existingKey) return false;
  var a = new Uint8Array(existingKey);
  if (a.length !== wantedBytes.length) return false;
  for (var i = 0; i < a.length; i++) { if (a[i] !== wantedBytes[i]) return false; }
  return true;
}

/* Wait for this specific registration to activate. navigator.serviceWorker.ready
   resolves for whichever SW controls the page, which may be a different one. */
function pushSwActive_F(reg) {
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
async function pushGetSubscription_F(reg, appServerKey) {
  var existing = await reg.pushManager.getSubscription();
  if (existing) {
    var opts = existing.options || {};
    if (pushKeysMatch_F(opts.applicationServerKey, appServerKey)) return existing;
    try { await existing.unsubscribe(); } catch (e) { /* carry on and re-subscribe */ }
  }
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: appServerKey
  });
}

function pushErrorText_F(e) {
  var name = e && e.name ? e.name : '';
  if (name === 'NotAllowedError')  return 'Notifications are blocked for this site. Allow them in your browser settings.';
  if (name === 'AbortError')       return 'The browser could not reach the push service. Check your connection, or try a different browser.';
  if (name === 'NotSupportedError')return 'This browser does not support push notifications.';
  return (e && e.message) || 'unknown error';
}

async function subscribeFantasyPush() {
  try {
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') { alert('Notifications blocked. Please allow in browser settings.'); return; }
    var reg  = await navigator.serviceWorker.register(PUSH_SW_URL_F, { scope: PUSH_SW_SCOPE_F });
    await pushSwActive_F(reg);
    var sub  = await pushGetSubscription_F(reg, urlBase64ToUint8Array_F(VAPID_PUBLIC_F));
    var subJson = sub.toJSON();
    await fetch(WORKER, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'fantasy.subscribePush',
        payload: {
          endpoint:       subJson.endpoint,
          p256dh:         subJson.keys.p256dh,
          auth:           subJson.keys.auth,
          participant_id: currentParticipant ? currentParticipant.id : null,
        }
      })
    });
    localStorage.setItem(LS_FANTASY_PUSH, '1');
    updateBellUI_F(true);
  } catch(e) {
    console.warn('Fantasy push subscribe error:', e);
    alert('Could not enable notifications: ' + pushErrorText_F(e));
  }
}

async function unsubscribeFantasyPush() {
  try {
    var reg = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE_F);
    if (reg) {
      var sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(WORKER, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'push.unsubscribe', payload: { endpoint: sub.endpoint } })
        });
        await sub.unsubscribe();
      }
    }
  } catch(e) { console.warn('Fantasy push unsubscribe error:', e); }
  localStorage.removeItem(LS_FANTASY_PUSH);
  updateBellUI_F(false);
}

// Init push after players load
var _origInit = init;
init = async function() {
  await _origInit();
  initFantasyPush();
};

/* ══════════════════════════════════════════════════════
   SHARE TEAM GRAPHIC
   640×640 canvas card. Shows team name, pitch layout
   with player names per zone, captain ⭐ / VC 🌟,
   budget used, round name. Web Share API on mobile,
   clipboard/download fallback on desktop.
══════════════════════════════════════════════════════ */
document.getElementById('pk-share-team-btn').addEventListener('click', function() {
  shareTeamGraphic();
});

function shareTeamGraphic() {
  var W = 640, H = 900;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');

  var GOLD  = '#C9A84C';
  var GOLD2 = '#f5d060';
  var GOLD3 = '#fff0a0';
  var BLUE  = '#3a7ef0';
  var BLUE2 = '#90c0ff';

  var teamName  = currentParticipant ? (currentParticipant.team_name || currentParticipant.name || 'My XI') : 'My XI';
  var roundName = currentRound ? currentRound.name : '';
  var opponent  = currentRound ? (currentRound.opponent || '') : '';
  var isWildcard = currentRound && currentRound.wildcard;
  var spent     = getSpent();

  // Build zone lists from current selection
  var zones = { keeper: [], batters: [], allrounders: [], bowlers: [] };
  selectedIds.forEach(function(id) {
    var p = allPlayers.find(function(pl) { return pl.id === id; });
    if (!p) return;
    var r = (p.role || '').toLowerCase().replace(/-/g, ' ').trim();
    var z = r === 'wicketkeeper' ? 'keeper'
          : r.includes('rounder') ? 'allrounders'
          : r === 'bowler' ? 'bowlers'
          : 'batters';
    zones[z].push({ id: p.id, name: p.name, cap: captainId === id, vc: viceCaptainId === id });
  });

  // ── CARD CLIP
  ctx.save();
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(0, 0, W, H, 20) : ctx.rect(0, 0, W, H);
  ctx.clip();

  // ── BACKGROUND
  ctx.fillStyle = '#030b08';
  ctx.fillRect(0, 0, W, H);

  var g1 = ctx.createRadialGradient(80, 60, 0, 80, 60, 320);
  g1.addColorStop(0, 'rgba(180,110,20,0.22)');
  g1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);

  var g2 = ctx.createRadialGradient(580, 580, 0, 580, 580, 360);
  g2.addColorStop(0, 'rgba(10,80,60,0.28)');
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

  var g3 = ctx.createRadialGradient(0, 340, 0, 0, 340, 240);
  g3.addColorStop(0, 'rgba(30,60,160,0.12)');
  g3.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g3; ctx.fillRect(0, 0, W, H);

  // Scanlines
  ctx.save();
  ctx.globalAlpha = 0.025;
  for (var sl = 0; sl < H; sl += 3) {
    ctx.fillStyle = sl % 6 === 0 ? '#ffffff' : '#000000';
    ctx.fillRect(0, sl, W, 1);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // Hexagon texture
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  var hexR = 28;
  for (var hrow = -1; hrow < H / hexR / 1.5 + 2; hrow++) {
    for (var hcol = -1; hcol < W / hexR / 1.73 + 2; hcol++) {
      var ox = hcol * hexR * 1.73 + (hrow % 2) * hexR * 0.87;
      var oy = hrow * hexR * 1.5;
      ctx.beginPath();
      for (var k = 0; k < 6; k++) {
        var a = (k * 60 - 30) * Math.PI / 180;
        if (k === 0) ctx.moveTo(ox + hexR * Math.cos(a), oy + hexR * Math.sin(a));
        else         ctx.lineTo(ox + hexR * Math.cos(a), oy + hexR * Math.sin(a));
      }
      ctx.closePath(); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // Bottom vignette
  var vig = ctx.createLinearGradient(0, 500, 0, H);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

  // ── PITCH AREA
  // Turf with mowing stripes
  ctx.save();
  var turf = ctx.createRadialGradient(320, 480, 10, 320, 480, 295);
  turf.addColorStop(0,   'rgba(18,60,28,0.55)');
  turf.addColorStop(0.6, 'rgba(8,30,14,0.35)');
  turf.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = turf;
  ctx.beginPath(); ctx.ellipse(320, 480, 268, 298, 0, 0, Math.PI * 2); ctx.fill();

  ctx.beginPath(); ctx.ellipse(320, 480, 268, 298, 0, 0, Math.PI * 2); ctx.clip();
  ctx.globalAlpha = 0.07;
  for (var mx = 0; mx < W; mx += 26) {
    ctx.fillStyle = Math.floor(mx / 26) % 2 === 0 ? '#90ff90' : '#003000';
    ctx.fillRect(mx, 100, 26, H);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // Boundary ring
  ctx.strokeStyle = 'rgba(201,168,76,0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(320, 480, 264, 295, 0, 0, Math.PI * 2); ctx.stroke();

  // 30-yard circle
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.ellipse(320, 480, 155, 175, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // Pitch strip
  ctx.fillStyle = 'rgba(201,168,76,0.07)';
  ctx.strokeStyle = 'rgba(201,168,76,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(300, 352, 40, 256, 3) : ctx.rect(300, 352, 40, 256);
  ctx.fill(); ctx.stroke();

  // Crease lines
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(294, 410); ctx.lineTo(346, 410);
  ctx.moveTo(294, 550); ctx.lineTo(346, 550);
  ctx.stroke();

  // Stumps
  ctx.strokeStyle = GOLD + 'cc';
  ctx.lineWidth = 2.5;
  [-5, 0, 5].forEach(function(x) {
    ctx.beginPath(); ctx.moveTo(320+x, 394); ctx.lineTo(320+x, 410); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(320+x, 550); ctx.lineTo(320+x, 566); ctx.stroke();
  });
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(315, 394); ctx.lineTo(325, 394); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(315, 566); ctx.lineTo(325, 566); ctx.stroke();

  // ── FOIL BORDER
  var shimmer = ctx.createLinearGradient(0, 0, W, H);
  shimmer.addColorStop(0,   '#f5d060');
  shimmer.addColorStop(0.2, '#a0f0c0');
  shimmer.addColorStop(0.4, '#80b0ff');
  shimmer.addColorStop(0.6, '#f5d060');
  shimmer.addColorStop(0.8, '#ff90b0');
  shimmer.addColorStop(1,   '#f5d060');
  ctx.strokeStyle = shimmer;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(2, 2, W-4, H-4, 18) : ctx.rect(2, 2, W-4, H-4);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(201,168,76,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(8, 8, W-16, H-16, 14) : ctx.rect(8, 8, W-16, H-16);
  ctx.stroke();

  // ── HEADER
  var headerBg = ctx.createLinearGradient(0, 12, 0, 105);
  headerBg.addColorStop(0, 'rgba(0,0,0,0.7)');
  headerBg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = headerBg; ctx.fillRect(0, 12, W, 93);

  // TCC pill
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(18, 22, 44, 16, 8) : ctx.rect(18, 22, 44, 16);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.font = '800 7px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center'; ctx.letterSpacing = '2px';
  ctx.fillText('TCC', 40, 33);
  ctx.letterSpacing = '0px'; ctx.textAlign = 'left';

  // FANTASY XI pill
  ctx.fillStyle = 'rgba(201,168,76,0.18)';
  ctx.strokeStyle = 'rgba(201,168,76,0.5)'; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(68, 22, 68, 16, 8) : ctx.rect(68, 22, 68, 16);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.font = '700 7.5px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center'; ctx.letterSpacing = '2px';
  ctx.fillText('FANTASY XI', 102, 33);
  ctx.letterSpacing = '0px'; ctx.textAlign = 'left';

  // Round + wildcard label top right
  ctx.textAlign = 'right';
  ctx.fillStyle = isWildcard ? GOLD : 'rgba(255,255,255,0.4)';
  ctx.font = '600 9px "Barlow Condensed", sans-serif';
  ctx.fillText((isWildcard ? 'WILDCARD · ' : '') + roundName.toUpperCase(), 622, 30);
  if (opponent) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '400 8px sans-serif';
    ctx.fillText(opponent, 622, 42);
  }
  ctx.textAlign = 'left';

  // Team name hero
  ctx.save();
  ctx.shadowColor = 'rgba(201,168,76,0.35)';
  ctx.shadowBlur = 30; ctx.shadowOffsetY = 4;
  var tname = teamName.toUpperCase();
  var tfs = 76;
  ctx.font = '900 ' + tfs + 'px "Barlow Condensed", sans-serif';
  while (ctx.measureText(tname).width > 596 && tfs > 32) {
    tfs -= 2;
    ctx.font = '900 ' + tfs + 'px "Barlow Condensed", sans-serif';
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
  ctx.strokeText(tname, 20, 95);
  var nameGrad = ctx.createLinearGradient(0, 50, 0, 100);
  nameGrad.addColorStop(0, GOLD3); nameGrad.addColorStop(0.4, GOLD2); nameGrad.addColorStop(1, GOLD);
  ctx.fillStyle = nameGrad;
  ctx.fillText(tname, 20, 95);
  ctx.restore();

  // Gold underline
  var ul = ctx.createLinearGradient(18, 0, 620, 0);
  ul.addColorStop(0, 'rgba(201,168,76,0.7)');
  ul.addColorStop(0.5, 'rgba(201,168,76,0.3)');
  ul.addColorStop(1, 'rgba(201,168,76,0)');
  ctx.fillStyle = ul; ctx.fillRect(18, 100, 600, 1.5);

  // ── PLAYERS
  var zoneConfig = [
    { key: 'keeper',      y: 295, label: 'WICKET-KEEPER' },
    { key: 'batters',     y: 408, label: 'BATTERS'       },
    { key: 'allrounders', y: 528, label: 'ALL-ROUNDERS'  },
    { key: 'bowlers',     y: 642, label: 'BOWLERS'       },
  ];

  zoneConfig.forEach(function(zone) {
    var players = zones[zone.key];
    if (!players.length) return;
    var n = players.length;
    var spacing = Math.min(116, 570 / (n + 1));
    var startX  = 320 - spacing * (n - 1) / 2;

    // Zone label
    ctx.textAlign = 'center';
    ctx.font = '600 7px "Barlow Condensed", sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillText(zone.label, 320, zone.y - 30);
    ctx.letterSpacing = '0px';

    // Zone divider
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(40, zone.y - 24); ctx.lineTo(600, zone.y - 24); ctx.stroke();

    players.forEach(function(pl, i) {
      var x = startX + i * spacing;
      var y = zone.y;
      var isCap = pl.cap;
      var isVC  = pl.vc;
      var r = isCap ? 30 : isVC ? 27 : 22;

      ctx.save();
      if (isCap) { ctx.shadowColor = GOLD2; ctx.shadowBlur = 35; }
      else if (isVC) { ctx.shadowColor = BLUE2; ctx.shadowBlur = 28; }

      // Outer pulse ring
      if (isCap || isVC) {
        ctx.strokeStyle = isCap ? 'rgba(245,208,96,0.2)' : 'rgba(144,192,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, r + 9, 0, Math.PI * 2); ctx.stroke();
      }

      // Inner ring
      ctx.strokeStyle = isCap ? GOLD2 : isVC ? BLUE2 : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = isCap ? 2.5 : isVC ? 2 : 1;
      ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;

      // Avatar fill
      var ag;
      if (isCap) {
        ag = ctx.createRadialGradient(x-8, y-8, 0, x, y, r);
        ag.addColorStop(0, '#fff0a0'); ag.addColorStop(0.5, GOLD2); ag.addColorStop(1, '#7a5008');
        ctx.fillStyle = ag;
      } else if (isVC) {
        ag = ctx.createRadialGradient(x-6, y-6, 0, x, y, r);
        ag.addColorStop(0, '#c0d8ff'); ag.addColorStop(0.5, BLUE); ag.addColorStop(1, '#0a1a60');
        ctx.fillStyle = ag;
      } else {
        ag = ctx.createRadialGradient(x-4, y-4, 0, x, y, r);
        ag.addColorStop(0, 'rgba(60,130,80,0.7)'); ag.addColorStop(1, 'rgba(10,40,20,0.8)');
        ctx.fillStyle = ag;
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Initials
      var initials = pl.name.split(' ').map(function(w) { return w[0] || ''; }).join('').slice(0,2).toUpperCase();
      ctx.fillStyle = isCap ? '#1a0e00' : '#ffffff';
      ctx.font = '800 ' + (r > 26 ? 14 : r > 22 ? 12 : 10) + 'px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(initials, x, y + 5);

      // C / VC badge pill
      if (isCap || isVC) {
        var bw = isCap ? 18 : 22;
        var bx = x + r - 4, by = y - r - 7;
        ctx.fillStyle = isCap ? GOLD2 : BLUE2;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(bx, by, bw, 12, 6) : ctx.rect(bx, by, bw, 12);
        ctx.fill();
        ctx.fillStyle = isCap ? '#1a0e00' : '#0a1540';
        ctx.font = '800 7px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(isCap ? 'C' : 'VC', bx + bw/2, by + 9);
      }

      // Nameplate pill
      var surname = pl.name.trim().split(' ').filter(function(w) { return w.indexOf('.') === -1; }).join(' ') || pl.name.split(' ').pop();
      var display = surname.toUpperCase().length > 9 ? surname.toUpperCase().slice(0,8) + '.' : surname.toUpperCase();
      ctx.font = (isCap || isVC ? '700' : '500') + ' ' + (n > 4 ? 7.5 : 8.5) + 'px "Barlow Condensed", sans-serif';
      var nw = Math.max(ctx.measureText(display).width + 14, 34);
      ctx.fillStyle = isCap ? 'rgba(201,168,76,0.2)' : isVC ? 'rgba(58,126,240,0.2)' : 'rgba(255,255,255,0.07)';
      ctx.textAlign = 'center';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x - nw/2, y + r + 4, nw, 13, 6) : ctx.rect(x - nw/2, y + r + 4, nw, 13);
      ctx.fill();
      ctx.fillStyle = isCap ? GOLD2 : isVC ? BLUE2 : 'rgba(255,255,255,0.65)';
      ctx.fillText(display, x, y + r + 14);
      ctx.textAlign = 'left';
    });
  });

  // ── FOOTER
  var footerFade = ctx.createLinearGradient(0, 720, 0, H);
  footerFade.addColorStop(0, 'rgba(3,12,6,0)');
  footerFade.addColorStop(0.3, 'rgba(3,12,6,0.97)');
  footerFade.addColorStop(1, '#020906');
  ctx.fillStyle = footerFade; ctx.fillRect(0, 720, W, H - 720);

  // Footer divider
  var fdg = ctx.createLinearGradient(0, 0, W, 0);
  fdg.addColorStop(0, 'rgba(201,168,76,0)');
  fdg.addColorStop(0.3, 'rgba(201,168,76,0.5)');
  fdg.addColorStop(0.7, 'rgba(201,168,76,0.5)');
  fdg.addColorStop(1, 'rgba(201,168,76,0)');
  ctx.strokeStyle = fdg; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(20, 754); ctx.lineTo(620, 754); ctx.stroke();

  // Legend
  [[GOLD2, '#1a0e00', 'C',  'x2  CAPTAIN',        20 ],
   [BLUE2, '#0a1540', 'VC', 'x1.5  VICE-CAPTAIN', 130]].forEach(function(item) {
    var col = item[0], tc = item[1], code = item[2], label = item[3], lx = item[4];
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(lx, 763, code === 'C' ? 16 : 20, 13, 6) : ctx.rect(lx, 763, code === 'C' ? 16 : 20, 13);
    ctx.fill();
    ctx.fillStyle = tc;
    ctx.font = '800 7px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(code, lx + (code === 'C' ? 8 : 10), 773);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '500 8.5px "Barlow Condensed", sans-serif';
    ctx.fillText(label, lx + (code === 'C' ? 20 : 24), 773);
  });

  // Budget
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '600 7px "Barlow Condensed", sans-serif';
  ctx.letterSpacing = '2px';
  ctx.fillText('BUDGET USED', 622, 762);
  ctx.letterSpacing = '0px';
  var budgGrad = ctx.createLinearGradient(500, 0, 622, 0);
  budgGrad.addColorStop(0, GOLD); budgGrad.addColorStop(1, GOLD2);
  ctx.fillStyle = budgGrad;
  ctx.font = '800 20px "Barlow Condensed", sans-serif';
  ctx.fillText('R' + spent + ' / R100', 622, 782);

  // Centre branding
  ctx.textAlign = 'center';
  ctx.fillStyle = GOLD;
  ctx.save(); ctx.translate(320, 812); ctx.rotate(Math.PI / 4);
  ctx.fillRect(-5, -5, 10, 10); ctx.restore();
  ctx.fillStyle = 'rgba(201,168,76,0.45)';
  ctx.font = '700 9px "Barlow Condensed", sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('TCC FANTASY CRICKET', 320, 832);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = '400 7.5px sans-serif';
  ctx.fillText('tygerbergcc.co.za/fantasy', 320, 846);

  // Edition
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.font = '400 7px sans-serif';
  ctx.fillText('2025/26 SEASON', 622, 880);
  ctx.textAlign = 'left';

  // ── GRAIN OVERLAY
  var imgData = ctx.getImageData(0, 0, W, H);
  var d = imgData.data;
  for (var gi = 0; gi < d.length; gi += 4) {
    var gn = (Math.random() - 0.5) * 22;
    d[gi]   = Math.max(0, Math.min(255, d[gi]   + gn));
    d[gi+1] = Math.max(0, Math.min(255, d[gi+1] + gn));
    d[gi+2] = Math.max(0, Math.min(255, d[gi+2] + gn));
  }
  ctx.putImageData(imgData, 0, 0);
  ctx.restore();

  // ── SHARE
  canvas.toBlob(function(blob) {
    var file = new File([blob], 'tcc-fantasy-xi.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: teamName + ' — TCC Fantasy XI' })
        .catch(function(e) { if (e.name !== 'AbortError') downloadCanvas(canvas); });
    } else {
      downloadCanvas(canvas);
    }
  }, 'image/png');
}

function downloadCanvas(canvas) {
  var a = document.createElement('a');
  a.download = 'tcc-fantasy-xi.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
}

/* ── POWER-UPS POPOVER (pure UI toggle — no game logic) ── */
(function() {
  var toggle  = document.getElementById('pk-powerups-toggle');
  var popover = document.getElementById('pk-pu-popover');
  var closeBtn = document.getElementById('pk-pu-close');
  if (!toggle || !popover) return;

  function open()  { popover.hidden = false; toggle.setAttribute('aria-expanded', 'true');  toggle.classList.add('open'); }
  function close() { popover.hidden = true;  toggle.setAttribute('aria-expanded', 'false'); toggle.classList.remove('open'); }

  toggle.addEventListener('click', function(e) {
    e.stopPropagation();
    popover.hidden ? open() : close();
  });
  if (closeBtn) closeBtn.addEventListener('click', close);

  // Close when tapping outside the popover or the toggle
  document.addEventListener('click', function(e) {
    if (popover.hidden) return;
    if (popover.contains(e.target) || toggle.contains(e.target)) return;
    close();
  });
  // Close on Escape
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') close(); });
})();

/* ── ACCOUNT MENU (pure UI toggle — no logic change) ── */
(function() {
  var toggle = document.getElementById('pk-account-toggle');
  var menu   = document.getElementById('pk-account-menu');
  if (!toggle || !menu) return;

  function open()  { menu.hidden = false; toggle.setAttribute('aria-expanded', 'true');  toggle.classList.add('open'); }
  function close() { menu.hidden = true;  toggle.setAttribute('aria-expanded', 'false'); toggle.classList.remove('open'); }

  toggle.addEventListener('click', function(e) {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  document.addEventListener('click', function(e) {
    if (menu.hidden) return;
    if (menu.contains(e.target) || toggle.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') close(); });
})();

/* ══════════════════════════════════════════════════════
   SQUAD SHEET (phones)
   The pool is a left-hand column on a desktop and a bottom sheet under
   760px. Everything in it — search, filters, player rows — is the same
   markup either way; this only slides it in and out, and does nothing at
   all on a wide screen, where the pool is simply always there.
══════════════════════════════════════════════════════ */
function openPoolSheet()  {}
function closePoolSheet() {}

(function() {
  /* Build whatever is missing rather than depending on pick.html being the
     newest one. This is a PWA behind a CDN: the stylesheet and the script
     carry ?v= and update together, but the page itself can be served from a
     service worker or an edge cache for a good while after a deploy. An
     earlier version of this bailed out when the markup was absent, which
     left the pool as a sheet with nothing to open it — a worse page than
     before the fix, from nothing worse than a stale HTML file. */
  var pool = document.getElementById('pk-pool') || document.querySelector('.pk-pool');
  if (!pool) return;
  if (!pool.id) pool.id = 'pk-pool';

  function make(tag, id, cls, html, parent, before) {
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement(tag);
    el.id = id;
    el.className = cls;
    if (html) el.innerHTML = html;
    if (before) parent.insertBefore(el, before);
    else parent.appendChild(el);
    return el;
  }

  var budgetBar = document.querySelector('.pk-budget-bar');
  var trigger = make('button', 'pk-pool-trigger', 'pk-pool-trigger',
      '<span class="pk-pt-icon" aria-hidden="true">＋</span>'
    + '<span class="pk-pt-label">Add players</span>'
    + '<span class="pk-pt-count" id="pk-pool-trigger-count">0/11</span>',
    budgetBar ? budgetBar.parentNode : document.body,
    budgetBar ? budgetBar.nextSibling : null);
  trigger.setAttribute('aria-controls', 'pk-pool');
  trigger.setAttribute('aria-expanded', 'false');
  if (trigger.tagName === 'BUTTON') trigger.type = 'button';

  var scrim = make('div', 'pk-pool-scrim', 'pk-pool-scrim', '', document.body);
  if (!scrim.hasAttribute('hidden')) scrim.hidden = true;

  var closeBt = document.getElementById('pk-pool-close');
  if (!closeBt) {
    closeBt = document.createElement('button');
    closeBt.id = 'pk-pool-close';
    closeBt.className = 'pk-pool-close';
    closeBt.type = 'button';
    closeBt.setAttribute('aria-label', 'Close squad list');
    closeBt.innerHTML = '✕';
    pool.insertBefore(closeBt, pool.firstChild);
  }

  /* Only now do the sheet styles switch on. Until this class is set, the CSS
     leaves the pool stacked above the pitch, which is usable on its own. */
  document.body.classList.add('pk-sheet-ready');

  var lastFocus = null;

  openPoolSheet = function() {
    lastFocus = document.activeElement;
    pool.classList.add('pk-pool-open');
    scrim.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    /* The page scrolls behind an open sheet otherwise. */
    document.body.style.overflow = 'hidden';
    var search = document.getElementById('pk-search');
    /* Deliberately not focusing the search box: on a phone that throws the
       keyboard up over the list the moment the sheet opens. */
    if (search) search.blur();
  };

  closePoolSheet = function() {
    if (!pool.classList.contains('pk-pool-open')) return;
    pool.classList.remove('pk-pool-open');
    scrim.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch(e) {} }
  };

  trigger.addEventListener('click', function() {
    if (pool.classList.contains('pk-pool-open')) closePoolSheet();
    else openPoolSheet();
  });
  scrim.addEventListener('click', closePoolSheet);
  if (closeBt) closeBt.addEventListener('click', closePoolSheet);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closePoolSheet();
  });

  /* Rotating to landscape, or resizing a desktop window down and back up,
     can leave the sheet "open" while the pool is a plain column again. The
     class is harmless there, but body overflow is not. */
  window.addEventListener('resize', function() {
    if (window.innerWidth > 760) {
      pool.classList.remove('pk-pool-open');
      scrim.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }
  });
})();

/* ══════════════════════════════════════════════════════
   PLAYER MENU — captain, vice-captain, remove
   Tapping a player on the pitch opens this. It exists because the armbands
   used to be assigned by tapping a player repeatedly, which meant the
   captaincy moved silently whenever anyone touched a selected player, and
   taking a player out meant cycling through both armbands first.

   Here the choice is named before it is made, and the menu says who holds
   each armband now, so moving one is a decision rather than a side effect.
══════════════════════════════════════════════════════ */
function closePlayerMenu() {}

function openPlayerMenu(id, anchor) {
  var p = allPlayers.find(function(pl){ return pl.id === id; });
  if (!p) return;
  if (!selectedIds.includes(id)) return;

  closePlayerMenu();

  var menu  = document.createElement('div');
  var scrim = document.createElement('div');
  menu.className  = 'pk-pmenu';
  scrim.className = 'pk-pmenu-scrim';
  menu.id = 'pk-pmenu';
  menu.setAttribute('role', 'menu');

  var isCap = captainId === id;
  var isVC  = viceCaptainId === id;
  var capHolder = captainId     && captainId     !== id
    ? (allPlayers.find(function(x){ return x.id === captainId; })     || {}).name : null;
  var vcHolder  = viceCaptainId && viceCaptainId !== id
    ? (allPlayers.find(function(x){ return x.id === viceCaptainId; }) || {}).name : null;

  var capMult = (currentRound && currentRound.wildcard) ? '3' : '2';

  function note(text) {
    return text ? '<span class="pk-pmenu-note">' + text + '</span>' : '';
  }

  menu.innerHTML =
      '<div class="pk-pmenu-head">'
    +   '<span class="pk-pmenu-name">' + p.name + '</span>'
    +   '<span class="pk-pmenu-val">R' + (p.fantasy_value || 5) + '</span>'
    + '</div>'
    + '<button type="button" class="pk-pmenu-item' + (isCap ? ' on' : '') + '" data-act="cap">'
    +   '<span class="pk-pmenu-ic">⭐</span>'
    +   '<span class="pk-pmenu-lbl">' + (isCap ? 'Captain ×' + capMult : 'Make captain')
    +     note(isCap ? 'tap to take the armband off' : capHolder ? 'currently ' + capHolder : '')
    +   '</span>'
    +   (isCap ? '<span class="pk-pmenu-tick">✓</span>' : '')
    + '</button>'
    + '<button type="button" class="pk-pmenu-item' + (isVC ? ' on' : '') + '" data-act="vc">'
    +   '<span class="pk-pmenu-ic">🌟</span>'
    +   '<span class="pk-pmenu-lbl">' + (isVC ? 'Vice-captain ×1.5' : 'Make vice-captain')
    +     note(isVC ? 'tap to take the armband off' : vcHolder ? 'currently ' + vcHolder : '')
    +   '</span>'
    +   (isVC ? '<span class="pk-pmenu-tick">✓</span>' : '')
    + '</button>'
    + '<div class="pk-pmenu-sep"></div>'
    + '<button type="button" class="pk-pmenu-item danger" data-act="remove">'
    +   '<span class="pk-pmenu-ic">✕</span>'
    +   '<span class="pk-pmenu-lbl">Remove from XI</span>'
    + '</button>';

  document.body.appendChild(scrim);
  document.body.appendChild(menu);

  /* Position against the player, then pull it back inside the screen. A
     chip near the touchline would otherwise open half off the edge. */
  var r  = anchor.getBoundingClientRect();
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  var pad = 10;
  var left = r.left + (r.width / 2) - (mw / 2);
  left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad));
  var above = r.top - mh - 8;
  var below = r.bottom + 8;
  var top   = (below + mh + pad <= window.innerHeight) ? below
            : (above >= pad) ? above
            : Math.max(pad, (window.innerHeight - mh) / 2);
  menu.style.left = Math.round(left) + 'px';
  menu.style.top  = Math.round(top) + 'px';
  menu.classList.add('open');

  closePlayerMenu = function() {
    if (menu.parentNode) menu.parentNode.removeChild(menu);
    if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
    document.removeEventListener('keydown', onKey);
    closePlayerMenu = function() {};
  };

  function onKey(e) { if (e.key === 'Escape') closePlayerMenu(); }
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', closePlayerMenu);

  menu.addEventListener('click', function(e) {
    var btn = e.target.closest('.pk-pmenu-item');
    if (!btn) return;
    var act = btn.dataset.act;
    closePlayerMenu();
    if (act === 'cap')         setCaptain(id);
    else if (act === 'vc')     setViceCaptain(id);
    else if (act === 'remove') removePlayer(id);
  });

  var first = menu.querySelector('.pk-pmenu-item');
  if (first && window.innerWidth > 760) first.focus();
}
