/* ══════════════════════════════════════════════════════════════════
   TCC COACHING ANALYTICS — js/coaching-analytics.js
   Depends on admin.js globals: SUPABASE_URL, H, SESSION_TOKEN,
   SESSION_ROLE, SESSION_NAME, adminAPI
   Chart.js must be loaded before this file.
   ══════════════════════════════════════════════════════════════════ */

(function () {
'use strict';

/* ── State ───────────────────────────────────────────────────── */
var caInited  = false;   // guard against double-bind on repeat tab clicks
var caFilter  = { team: '', month: '' };
var caCharts  = {};      // Chart.js instances keyed by canvas id

/* ── Row data registries (avoids JSON.stringify in onclick) ──── */
var caMatchRows   = {};
var caSessionRows = {};
var caDevRows     = {};

/* ── Roles that can write coaching data ──────────────────────── */
function canWrite() {
  return ['super', 'scores', 'coach'].includes(SESSION_ROLE);
}

/* ── Team list ───────────────────────────────────────────────── */
var CA_TEAMS = ['1st Team','2nd Team','3rd Team','4th Team',
                'U13','U12','U11','U10','Mini Cricket',
                'All Senior Teams','All Junior Teams','All Teams'];

/* ── Supabase anon read ──────────────────────────────────────── */
function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

/* ── Win % calculation (cricket convention) ──────────────────────
   No Results are excluded from the denominator; only completed
   matches (Win/Loss/Draw) count toward win percentage.
   Returns a number rounded to 1 decimal place. */
function calcWinPct(matches) {
  var completed = matches.filter(function (m) { return m.result !== 'No Result'; }).length;
  var wins      = matches.filter(function (m) { return m.result === 'Win'; }).length;
  return completed > 0 ? Math.round(wins / completed * 1000) / 10 : 0;
}

function sbGet(table, params) {
  var qs = new URLSearchParams();
  if (Array.isArray(params)) {
    params.forEach(function(pair) { qs.append(pair[0], pair[1]); });
  } else {
    Object.keys(params || {}).forEach(function(k) { qs.append(k, params[k]); });
  }
  var url = SUPABASE_URL + '/rest/v1/' + table + '?' + qs.toString();
  return fetch(url, { headers: H })
    .then(function (r) {
      if (!r.ok) return [];
      return r.json();
    })
    .then(function (v) { return safeArr(v); })
    .catch(function () { return []; });
}

/* ═══════════════════════════════════════════════════════════════
   INIT — called by admin.js switchTab handler
   ═══════════════════════════════════════════════════════════════ */
function initCoachingAnalytics() {

  if (!caInited) {
    // Default month filter to current month
    var now = new Date();
    var ym  = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    el('ca-month-filter').value  = ym;
    el('ca-report-month').value  = ym;
    el('ca-dev-month').value     = ym;
    caFilter.month               = ym;

    bindSubTabs();
    bindFilterBar();
    bindMatchForm();
    bindSessionForm();
    bindDevForm();
    bindKpiForm();
    bindReportForm();
    bindSkillMatrix();

    // Disable write buttons for read-only roles
    if (!canWrite()) {
      qsa('#ca-match-save-btn,#ca-session-save-btn,#ca-dev-save-btn,' +
          '#ca-kpi-save-btn,#ca-report-save-btn,#ca-report-save-btn-2,' +
          '#ca-sk-save-btn,#ca-sk-add-def-btn,#ca-sk-add-player-btn')
        .forEach(function (b) {
          b.disabled = true;
          b.title    = 'Requires coach, scores or super role';
        });
    }

    caInited = true;
  }

  loadDashboard();
  loadMatches();
  loadSessions();
  loadDevelopment();
  loadKpiPanel();
  loadSavedTargets();
}

/* ── DOM helpers ─────────────────────────────────────────────── */
function el(id)       { return document.getElementById(id); }
function qsa(sel)     { return Array.from(document.querySelectorAll(sel)); }
function setText(id, v){ var e=el(id); if(e) e.textContent=v; }
function esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function showSuccess(id) {
  var e=el(id); if(!e) return;
  e.style.display='';
  setTimeout(function(){ e.style.display='none'; }, 3500);
}
function showError(id, msg) {
  var e=el(id); if(!e) return;
  e.textContent=msg; e.style.display='';
}
function hideMsg(id) { var e=el(id); if(e) e.style.display='none'; }

/* ═══════════════════════════════════════════════════════════════
   SUB-TAB SWITCHING
   ═══════════════════════════════════════════════════════════════ */
function bindSubTabs() {
  qsa('.ca-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      qsa('.ca-tab').forEach(function (t) { t.classList.remove('active'); });
      qsa('.ca-panel').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      var panel = el('ca-panel-' + btn.dataset.caTab);
      if (panel) panel.classList.add('active');
      if (btn.dataset.caTab === 'charts') loadCharts();
      if (btn.dataset.caTab === 'skills') loadSkillMatrix();
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   FILTER BAR
   ═══════════════════════════════════════════════════════════════ */
function bindFilterBar() {
  el('ca-filter-btn').addEventListener('click', applyFilter);
  el('ca-filter-clear-btn').addEventListener('click', function () {
    caFilter.team  = '';
    caFilter.month = '';
    el('ca-team-filter').value  = '';
    el('ca-month-filter').value = '';
    applyFilter();
  });
}
function applyFilter() {
  caFilter.team  = el('ca-team-filter').value;
  caFilter.month = el('ca-month-filter').value;
  loadDashboard();
  loadMatches();
  loadSessions();
  loadDevelopment();
  loadKpiPanel();
  loadSavedTargets();
  // Re-render charts if visible
  if (el('ca-panel-charts') && el('ca-panel-charts').classList.contains('active')) loadCharts();
  if (el('ca-panel-skills') && el('ca-panel-skills').classList.contains('active')) loadSkillMatrix();
}

/* ═══════════════════════════════════════════════════════════════
   DATE RANGE PARAMS helper
   Returns array of [key,value] pairs so sbGet can append() them,
   allowing the same column key twice (gte + lte).
   ═══════════════════════════════════════════════════════════════ */
function monthRange(dateField) {
  if (!caFilter.month) return [];
  var parts  = caFilter.month.split('-');
  var y      = parseInt(parts[0], 10);
  var m      = parseInt(parts[1], 10);
  var lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this month
  return [
    [dateField, 'gte.' + caFilter.month + '-01'],
    [dateField, 'lte.' + caFilter.month + '-' + String(lastDay).padStart(2, '0')],
  ];
}

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════════ */
function loadDashboard() {
  var mp = [['select','*'],['order','match_date.desc'],['limit','100']].concat(monthRange('match_date'));
  var sp = [['select','*'],['order','session_date.desc'],['limit','200']].concat(monthRange('session_date'));
  var dp = Object.assign({ select:'*' });
  if (caFilter.team) { mp.push(['team_name','eq.'+caFilter.team]); dp.team_name = 'eq.' + caFilter.team; }
  if (caFilter.month) { dp.month = 'eq.' + caFilter.month; }

  Promise.all([
    sbGet('coach_matches',            mp),
    sbGet('coach_training_sessions',  sp),
    sbGet('coach_player_development', dp),
    sbGet('coach_kpi_targets', { order:'effective_from.desc', limit:20 })
  ]).then(function (res) {
    var matches  = safeArr(res[0]);
    var sessions = safeArr(res[1]);
    var devs     = safeArr(res[2]);
    var targets  = safeArr(res[3]);

    // Filter sessions client-side to include joint group sessions
    if (caFilter.team) {
      var seniors = ['1st Team','2nd Team','3rd Team','4th Team'];
      var juniors = ['U13','U12','U11','U10','Mini Cricket'];
      sessions = sessions.filter(function(s) {
        if (!s.team_name || s.team_name === 'All Teams') return true;
        if (s.team_name === caFilter.team) return true;
        if (s.team_name === 'All Senior Teams' && seniors.indexOf(caFilter.team) !== -1) return true;
        if (s.team_name === 'All Junior Teams' && juniors.indexOf(caFilter.team) !== -1) return true;
        return false;
      });
    }

    var played       = matches.length;
    var wins         = matches.filter(function(m){ return m.result==='Win'; }).length;
    var losses       = matches.filter(function(m){ return m.result==='Loss'; }).length;
    var winPct       = calcWinPct(matches);
    var runsScored   = matches.reduce(function(s,m){ return s+(m.runs_scored||0); }, 0);
    var runsConceded = matches.reduce(function(s,m){ return s+(m.runs_conceded||0); }, 0);
    var wktsTaken    = matches.reduce(function(s,m){ return s+(m.wickets_taken||0); }, 0);
    var wktsLost     = matches.reduce(function(s,m){ return s+(m.wickets_lost||0); }, 0);

    var sessCount = sessions.length;
    var avgAttend = sessCount > 0
      ? Math.round(sessions.reduce(function(s,t){ return s+(parseFloat(t.attendance_pct)||0); }, 0) / sessCount * 10) / 10
      : 0;
    var promoted  = devs.filter(function(d){ return d.promoted; }).length;

    var teamTarget = caFilter.team
      ? targets.find(function(t){ return t.team_name===caFilter.team; })
      : targets.find(function(t){ return t.team_name==='1st Team'; });
    var winTarget     = teamTarget ? teamTarget.win_pct_target              : 60;
    var sessTarget    = teamTarget ? teamTarget.training_sessions_target    : 8;
    var attendTarget  = teamTarget ? teamTarget.attendance_pct_target       : 80;

    setText('kpi-played',        played);
    setText('kpi-wins',          wins);
    setText('kpi-losses',        losses);
    setText('kpi-winpct',        winPct + '%');
    setText('kpi-winpct-target', winTarget);
    setText('kpi-runs-scored',   runsScored);
    setText('kpi-runs-conceded', runsConceded);
    setText('kpi-wkts-taken',    wktsTaken);
    setText('kpi-wkts-lost',     wktsLost);
    setText('kpi-sessions',      sessCount);
    setText('kpi-sessions-target', sessTarget);
    setText('kpi-attendance',    avgAttend + '%');
    setText('kpi-attend-target', attendTarget);
    setText('kpi-promotions',    promoted);

    setHealthBadge(winPct, winTarget, avgAttend, attendTarget, sessCount, sessTarget);
    renderDashMatches(matches.slice(0, 8));
  }).catch(function (e) { console.error('CA dashboard:', e); });
}

function setHealthBadge(winPct, winT, attend, attendT, sess, sessT) {
  var score = (winPct >= winT ? 1 : 0) + (attend >= attendT ? 1 : 0) + (sess >= sessT ? 1 : 0);
  var badge = el('ca-health-badge');
  var label = el('ca-health-label');
  var desc  = el('ca-health-desc');
  badge.className = 'ca-health';
  if (score === 3) {
    badge.classList.add('green');
    label.textContent = 'PERFORMING ABOVE TARGET';
    desc.textContent  = 'All tracked KPIs are meeting or exceeding targets.';
  } else if (score >= 1) {
    badge.classList.add('amber');
    label.textContent = 'CLOSE TO TARGET';
    desc.textContent  = score + ' of 3 KPIs on track. Review the KPI tab for details.';
  } else {
    badge.classList.add('red');
    label.textContent = 'BELOW TARGET';
    desc.textContent  = 'Performance is below targets across key areas. Review the KPI tab.';
  }
}

function renderDashMatches(matches) {
  var tbody = el('ca-dash-matches-body');
  if (!matches.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="ca-empty">No matches in this period.</td></tr>';
    return;
  }
  tbody.innerHTML = matches.map(function (m) {
    return '<tr>' +
      '<td class="muted">' + fmtDate(m.match_date) + '</td>' +
      '<td class="gold">'  + esc(m.team_name)  + '</td>' +
      '<td>'               + esc(m.opponent)   + '</td>' +
      '<td>'               + resultBadge(m.result) + '</td>' +
      '<td>'               + (m.runs_scored||0)   + '</td>' +
      '<td>'               + (m.runs_conceded||0) + '</td>' +
      '<td>'               + (m.wickets_taken||0) + '</td>' +
      '<td>'               + (m.wickets_lost||0)  + '</td>' +
      '</tr>';
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════
   MATCHES
   ═══════════════════════════════════════════════════════════════ */
function loadMatches() {
  var p = [['select','*'],['order','match_date.desc'],['limit','200']].concat(monthRange('match_date'));
  if (caFilter.team) p.push(['team_name','eq.'+caFilter.team]);
  sbGet('coach_matches', p).then(function (rows) {
    rows = safeArr(rows);
    caMatchRows = {};
    setText('ca-match-count', rows.length + ' matches');
    var tbody = el('ca-matches-body');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="ca-empty">No matches found.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (m) {
      caMatchRows[m.id] = m;
      return '<tr>' +
        '<td class="muted">' + fmtDate(m.match_date) + '</td>' +
        '<td class="gold">'  + esc(m.team_name) + '</td>' +
        '<td>'               + esc(m.opponent)  + '</td>' +
        '<td>'               + resultBadge(m.result) + '</td>' +
        '<td>'               + (m.runs_scored||0) + ' / ' + (m.runs_conceded||0) + '</td>' +
        '<td>'               + (m.wickets_taken||0) + ' / ' + (m.wickets_lost||0) + '</td>' +
        '<td class="ca-table-actions">' +
          (canWrite()
            ? '<button class="btn-sm" data-ca-edit-match="' + m.id + '">Edit</button>' +
              '<button class="btn-sm danger" data-ca-del-match="' + m.id + '">Del</button>'
            : '—') +
        '</td></tr>';
    }).join('');
  });
}

function bindMatchForm() {
  el('ca-match-save-btn').addEventListener('click', saveMatch);
  el('ca-match-clear-btn').addEventListener('click', clearMatchForm);
  // Delegated edit/delete clicks
  el('ca-matches-body').addEventListener('click', function (e) {
    var editId = e.target.dataset.caEditMatch;
    var delId  = e.target.dataset.caDelMatch;
    if (editId && caMatchRows[editId]) populateMatchForm(caMatchRows[editId]);
    if (delId)  deleteMatch(delId);
  });
}

function clearMatchForm() {
  el('ca-match-id').value            = '';
  el('ca-match-date').value          = '';
  el('ca-match-team').value          = '';
  el('ca-match-opponent').value      = '';
  el('ca-match-venue').value         = '';
  el('ca-match-result').value        = 'Win';
  el('ca-match-runs-scored').value   = '';
  el('ca-match-runs-conceded').value = '';
  el('ca-match-wkts-taken').value    = '';
  el('ca-match-wkts-lost').value     = '';
  el('ca-match-notes').value         = '';
  hideMsg('ca-match-success'); hideMsg('ca-match-error');
}

function populateMatchForm(m) {
  el('ca-match-id').value            = m.id;
  el('ca-match-date').value          = m.match_date;
  el('ca-match-team').value          = m.team_name;
  el('ca-match-opponent').value      = m.opponent;
  el('ca-match-venue').value         = m.venue         || '';
  el('ca-match-result').value        = m.result;
  el('ca-match-runs-scored').value   = m.runs_scored   || '';
  el('ca-match-runs-conceded').value = m.runs_conceded || '';
  el('ca-match-wkts-taken').value    = m.wickets_taken || '';
  el('ca-match-wkts-lost').value     = m.wickets_lost  || '';
  el('ca-match-notes').value         = m.coach_notes   || '';
  el('ca-match-date').scrollIntoView({ behavior:'smooth', block:'center' });
}

function saveMatch() {
  var id = el('ca-match-id').value;
  var payload = {
    match_date:    el('ca-match-date').value,
    team_name:     el('ca-match-team').value,
    opponent:      el('ca-match-opponent').value.trim(),
    venue:         el('ca-match-venue').value.trim(),
    result:        el('ca-match-result').value,
    runs_scored:   parseInt(el('ca-match-runs-scored').value)   || 0,
    runs_conceded: parseInt(el('ca-match-runs-conceded').value) || 0,
    wickets_taken: parseInt(el('ca-match-wkts-taken').value)    || 0,
    wickets_lost:  parseInt(el('ca-match-wkts-lost').value)     || 0,
    coach_notes:   el('ca-match-notes').value.trim(),
    created_by:    SESSION_NAME
  };
  if (!payload.match_date || !payload.team_name || !payload.opponent) {
    showError('ca-match-error', 'Date, team and opponent are required.'); return;
  }
  if (id) payload.id = id;
  adminAPI(id ? 'coaching.updateMatch' : 'coaching.insertMatch', payload)
    .then(function () {
      showSuccess('ca-match-success');
      clearMatchForm();
      loadMatches();
      loadDashboard();
    }).catch(function (e) { showError('ca-match-error', e.message); });
}

function deleteMatch(id) {
  if (!confirm('Delete this match? This cannot be undone.')) return;
  adminAPI('coaching.deleteMatch', { id: id })
    .then(function () { loadMatches(); loadDashboard(); })
    .catch(function (e) { alert('Delete failed: ' + e.message); });
}

/* ═══════════════════════════════════════════════════════════════
   TRAINING SESSIONS
   ═══════════════════════════════════════════════════════════════ */
function loadSessions() {
  var p = [['select','*'],['order','session_date.desc'],['limit','200']].concat(monthRange('session_date'));
  // Don't push a team filter to the DB — fetch all and filter client-side
  // so joint sessions (All Senior Teams, All Teams etc) appear under each team
  sbGet('coach_training_sessions', p).then(function (rows) {
    rows = safeArr(rows);
    // Client-side team filter: include exact match + applicable joint groups
    if (caFilter.team) {
      var seniors = ['1st Team','2nd Team','3rd Team','4th Team'];
      var juniors = ['U13','U12','U11','U10','Mini Cricket'];
      rows = rows.filter(function(s) {
        if (!s.team_name) return true; // untagged sessions always show
        if (s.team_name === caFilter.team) return true;
        if (s.team_name === 'All Teams') return true;
        if (s.team_name === 'All Senior Teams' && seniors.indexOf(caFilter.team) !== -1) return true;
        if (s.team_name === 'All Junior Teams' && juniors.indexOf(caFilter.team) !== -1) return true;
        return false;
      });
    }
    caSessionRows = {};
    setText('ca-session-count', rows.length + ' sessions');
    var tbody = el('ca-sessions-body');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="ca-empty">No sessions found.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (s) {
      caSessionRows[s.id] = s;
      return '<tr>' +
        '<td class="muted">' + fmtDate(s.session_date) + '</td>' +
        '<td class="gold">'  + esc(s.team_name || 'Unspecified')    + '</td>' +
        '<td>'               + esc(s.session_type) + '</td>' +
        '<td class="muted">' + esc(s.focus_area||'—') + '</td>' +
        '<td>'               + (s.player_count||0) + '</td>' +
        '<td>'               + (parseFloat(s.attendance_pct)||0).toFixed(0) + '%</td>' +
        '<td class="ca-table-actions">' +
          (canWrite()
            ? '<button class="btn-sm" data-ca-edit-sess="' + s.id + '">Edit</button>' +
              '<button class="btn-sm danger" data-ca-del-sess="' + s.id + '">Del</button>'
            : '—') +
        '</td></tr>';
    }).join('');
  });
}

function bindSessionForm() {
  el('ca-session-save-btn').addEventListener('click', saveSession);
  el('ca-session-clear-btn').addEventListener('click', clearSessionForm);
  el('ca-session-team').addEventListener('change', function () {
    loadAttendancePicker(this.value);
  });
  el('ca-sessions-body').addEventListener('click', function (e) {
    var editId = e.target.dataset.caEditSess;
    var delId  = e.target.dataset.caDelSess;
    if (editId && caSessionRows[editId]) populateSessionForm(caSessionRows[editId]);
    if (delId)  deleteSession(delId);
  });
}

function loadAttendancePicker(teamName) {
  var picker = el('ca-attend-picker');
  if (!teamName) {
    picker.innerHTML = '<div class="ca-empty" style="padding:16px">Select a team to see players.</div>';
    updateAttendSummary();
    return;
  }
  picker.innerHTML = '<div class="ca-empty" style="padding:12px">Loading…</div>';
  // Players table has no team column — load all active players and let
  // the coach tick whoever attended this session.
  sbGet('players', { active:'not.eq.false', select:'id,name', order:'name.asc' })
    .then(function (players) {
      if (!players || !players.length) {
        picker.innerHTML = '<div class="ca-empty" style="padding:12px">No active players found.</div>';
        return;
      }
      picker.innerHTML = players.map(function (p) {
        return '<div class="ca-player-pick-item">' +
          '<input type="checkbox" id="ca-att-' + p.id + '" value="' + p.id +
            '" data-pname="' + esc(p.name) + '">' +
          '<label for="ca-att-' + p.id + '">' + esc(p.name) + '</label>' +
          '</div>';
      }).join('');
      picker.querySelectorAll('input').forEach(function (cb) {
        cb.addEventListener('change', updateAttendSummary);
      });
      updateAttendSummary();
    }).catch(function () {
      picker.innerHTML = '<div class="ca-empty" style="padding:12px;color:#e07070">Could not load players.</div>';
    });
}

function updateAttendSummary() {
  var all     = el('ca-attend-picker').querySelectorAll('input[type=checkbox]');
  var checked = el('ca-attend-picker').querySelectorAll('input[type=checkbox]:checked');
  var pct     = all.length > 0 ? Math.round(checked.length / all.length * 100) : 0;
  el('ca-attend-summary').textContent = checked.length + ' of ' + all.length + ' players (' + pct + '%)';
}

function getAttendanceData() {
  var checked = el('ca-attend-picker').querySelectorAll('input[type=checkbox]:checked');
  var all     = el('ca-attend-picker').querySelectorAll('input[type=checkbox]');
  var players = [];
  checked.forEach(function (cb) { players.push({ player_name: cb.dataset.pname, player_id: cb.value }); });
  var pct = all.length > 0 ? Math.round(checked.length / all.length * 1000) / 10 : 0;
  return { players: players, player_count: players.length, attendance_pct: pct };
}

function clearSessionForm() {
  el('ca-session-id').value    = '';
  el('ca-session-date').value  = '';
  el('ca-session-team').value  = '';
  el('ca-session-type').value  = 'Mixed';
  el('ca-session-focus').value = '';
  el('ca-session-notes').value = '';
  el('ca-attend-picker').innerHTML =
    '<div class="ca-empty" style="padding:16px">Select a team to see players.</div>';
  el('ca-attend-summary').textContent = '0 of 0 players (0%)';
  hideMsg('ca-session-success'); hideMsg('ca-session-error');
}

function populateSessionForm(s) {
  el('ca-session-id').value    = s.id;
  el('ca-session-date').value  = s.session_date;
  el('ca-session-team').value  = s.team_name;
  el('ca-session-type').value  = s.session_type;
  el('ca-session-focus').value = s.focus_area  || '';
  el('ca-session-notes').value = s.coach_notes || '';
  loadAttendancePicker(s.team_name);
  el('ca-session-date').scrollIntoView({ behavior:'smooth', block:'center' });
}

function saveSession() {
  var id     = el('ca-session-id').value;
  var attend = getAttendanceData();
  var payload = {
    session_date:   el('ca-session-date').value,
    team_name:      el('ca-session-team').value,
    session_type:   el('ca-session-type').value,
    focus_area:     el('ca-session-focus').value.trim(),
    coach_notes:    el('ca-session-notes').value.trim(),
    player_count:   attend.player_count,
    attendance_pct: attend.attendance_pct,
    attendance:     attend.players,
    created_by:     SESSION_NAME
  };
  if (!payload.session_date) {
    showError('ca-session-error', 'Session date is required.'); return;
  }
  if (id) payload.id = id;
  adminAPI(id ? 'coaching.updateSession' : 'coaching.insertSession', payload)
    .then(function () {
      showSuccess('ca-session-success');
      clearSessionForm();
      loadSessions();
      loadDashboard();
    }).catch(function (e) { showError('ca-session-error', e.message); });
}

function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  adminAPI('coaching.deleteSession', { id: id })
    .then(function () { loadSessions(); loadDashboard(); })
    .catch(function (e) { alert('Delete failed: ' + e.message); });
}

/* ═══════════════════════════════════════════════════════════════
   PLAYER DEVELOPMENT
   ═══════════════════════════════════════════════════════════════ */
function loadDevelopment() {
  var p = [['select','*'],['order','month.desc'],['order','player_name.asc'],['limit','300']];
  if (caFilter.team)  p.push(['team_name','eq.'+caFilter.team]);
  if (caFilter.month) p.push(['month','eq.'+caFilter.month]);
  sbGet('coach_player_development', p).then(function (rows) {
    rows = safeArr(rows);
    caDevRows = {};
    setText('dev-kpi-promo',      rows.filter(function(r){ return r.promoted; }).length);
    setText('dev-kpi-junior',     rows.filter(function(r){ return r.junior_integrated; }).length);
    setText('dev-kpi-milestone',  rows.filter(function(r){ return r.milestone_achieved; }).length);
    setText('dev-kpi-candidates', rows.filter(function(r){ return r.promotion_candidate; }).length);
    var tbody = el('ca-dev-body');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="ca-empty">No development records found.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (d) {
      caDevRows[d.id] = d;
      return '<tr>' +
        '<td><strong>' + esc(d.player_name) + '</strong></td>' +
        '<td class="gold">'  + esc(d.team_name) + '</td>' +
        '<td class="muted">' + (d.month||'—')   + '</td>' +
        '<td>' + yesNoBadge(d.promotion_candidate) + '</td>' +
        '<td>' + yesNoBadge(d.promoted)            + '</td>' +
        '<td class="muted">' + esc(d.promoted_to_team||'—') + '</td>' +
        '<td class="muted">' + esc(d.milestone_achieved||'—') + '</td>' +
        '<td class="ca-table-actions">' +
          (canWrite()
            ? '<button class="btn-sm" data-ca-edit-dev="' + d.id + '">Edit</button>' +
              '<button class="btn-sm danger" data-ca-del-dev="' + d.id + '">Del</button>'
            : '—') +
        '</td></tr>';
    }).join('');
  });
}

function bindDevForm() {
  el('ca-dev-save-btn').addEventListener('click', saveDev);
  el('ca-dev-clear-btn').addEventListener('click', clearDevForm);
  el('ca-dev-promoted').addEventListener('change', function () {
    el('ca-dev-promoted-to-wrap').style.display = this.value === 'true' ? '' : 'none';
  });
  el('ca-dev-body').addEventListener('click', function (e) {
    var editId = e.target.dataset.caEditDev;
    var delId  = e.target.dataset.caDelDev;
    if (editId && caDevRows[editId]) populateDevForm(caDevRows[editId]);
    if (delId)  deleteDev(delId);
  });
}

function clearDevForm() {
  el('ca-dev-id').value          = '';
  el('ca-dev-player').value      = '';
  el('ca-dev-team').value        = '';
  el('ca-dev-notes').value       = '';
  el('ca-dev-milestone').value   = '';
  el('ca-dev-promoted-to').value = '';
  el('ca-dev-candidate').value   = 'false';
  el('ca-dev-promoted').value    = 'false';
  el('ca-dev-junior').value      = 'false';
  el('ca-dev-promoted-to-wrap').style.display = 'none';
  var now = new Date();
  el('ca-dev-month').value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  hideMsg('ca-dev-success'); hideMsg('ca-dev-error');
}

function populateDevForm(d) {
  el('ca-dev-id').value          = d.id;
  el('ca-dev-player').value      = d.player_name;
  el('ca-dev-team').value        = d.team_name;
  el('ca-dev-month').value       = d.month;
  el('ca-dev-notes').value       = d.development_notes  || '';
  el('ca-dev-milestone').value   = d.milestone_achieved || '';
  el('ca-dev-candidate').value   = d.promotion_candidate ? 'true' : 'false';
  el('ca-dev-promoted').value    = d.promoted            ? 'true' : 'false';
  el('ca-dev-promoted-to').value = d.promoted_to_team   || '';
  el('ca-dev-junior').value      = d.junior_integrated   ? 'true' : 'false';
  el('ca-dev-promoted-to-wrap').style.display = d.promoted ? '' : 'none';
  el('ca-dev-player').scrollIntoView({ behavior:'smooth', block:'center' });
}

function saveDev() {
  var id = el('ca-dev-id').value;
  var payload = {
    player_name:         el('ca-dev-player').value.trim(),
    team_name:           el('ca-dev-team').value,
    month:               el('ca-dev-month').value,
    development_notes:   el('ca-dev-notes').value.trim(),
    milestone_achieved:  el('ca-dev-milestone').value.trim(),
    promotion_candidate: el('ca-dev-candidate').value === 'true',
    promoted:            el('ca-dev-promoted').value  === 'true',
    promoted_to_team:    el('ca-dev-promoted-to').value,
    junior_integrated:   el('ca-dev-junior').value    === 'true',
    created_by:          SESSION_NAME
  };
  if (!payload.player_name || !payload.team_name) {
    showError('ca-dev-error', 'Player name and team are required.'); return;
  }
  if (id) payload.id = id;
  adminAPI(id ? 'coaching.updateDev' : 'coaching.insertDev', payload)
    .then(function () {
      showSuccess('ca-dev-success');
      clearDevForm();
      loadDevelopment();
    }).catch(function (e) { showError('ca-dev-error', e.message); });
}

function deleteDev(id) {
  if (!confirm('Delete this development record?')) return;
  adminAPI('coaching.deleteDev', { id: id })
    .then(function () { loadDevelopment(); })
    .catch(function (e) { alert('Delete failed: ' + e.message); });
}

/* ═══════════════════════════════════════════════════════════════
   KPI TARGETS
   ═══════════════════════════════════════════════════════════════ */
var caKpiRows = {};   // saved-target registry keyed by id

function loadSavedTargets() {
  var tbody = el('ca-kpi-saved-body');
  if (!tbody) return;  // table not in DOM (older admin.html cached)
  sbGet('coach_kpi_targets', { select:'*', order:'team_name.asc' })
    .then(function (rows) {
      rows = safeArr(rows);
      // Keep only one target per team+season (upsert already dedupes, this is a safety net)
      var seen = {};
      var latest = [];
      rows.forEach(function (r) {
        var key = r.team_name + '|' + r.season;
        if (!seen[key]) { seen[key] = true; latest.push(r); }
      });
      caKpiRows = {};
      if (!latest.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="ca-empty">No targets configured yet. Set some using the form above.</td></tr>';
        return;
      }
      tbody.innerHTML = latest.map(function (t) {
        caKpiRows[t.id] = t;
        return '<tr>' +
          '<td class="gold">' + esc(t.team_name) + '</td>' +
          '<td class="muted">' + esc(t.season) + '</td>' +
          '<td>' + (t.win_pct_target != null ? t.win_pct_target + '%' : '—') + '</td>' +
          '<td>' + (t.training_sessions_target != null ? t.training_sessions_target : '—') + '</td>' +
          '<td>' + (t.attendance_pct_target != null ? t.attendance_pct_target + '%' : '—') + '</td>' +
          '<td>' + (t.promotions_target != null ? t.promotions_target : '—') + '</td>' +
          '<td class="ca-table-actions">' +
            (canWrite()
              ? '<button class="btn-sm" data-ca-load-kpi="' + t.id + '">Load</button>' +
                '<button class="btn-sm danger" data-ca-del-kpi="' + t.id + '">Del</button>'
              : '—') +
          '</td></tr>';
      }).join('');
    })
    .catch(function () {
      tbody.innerHTML = '<tr><td colspan="7" class="ca-empty" style="color:#e07070">Could not load targets.</td></tr>';
    });
}

function loadKpiPanel() {
  var mp = [['select','*'],['limit','500']].concat(monthRange('match_date'));
  var sp = [['select','*'],['limit','500']].concat(monthRange('session_date'));
  var dp = { select:'*', limit:500 };
  if (caFilter.team) { mp.push(['team_name','eq.'+caFilter.team]); dp.team_name='eq.'+caFilter.team; }
  if (caFilter.month) dp.month = 'eq.' + caFilter.month;

  Promise.all([
    sbGet('coach_matches',            mp),
    sbGet('coach_training_sessions',  sp),
    sbGet('coach_player_development', dp),
    sbGet('coach_kpi_targets', { order:'effective_from.desc', limit:50 })
  ]).then(function (res) {
    var matches  = safeArr(res[0]);
    var sessions = safeArr(res[1]);
    var devs     = safeArr(res[2]);
    var targets  = safeArr(res[3]);
    var teams    = caFilter.team ? [caFilter.team] : CA_TEAMS;
    var rows     = [];

    teams.forEach(function (team) {
      var seniors = ['1st Team','2nd Team','3rd Team','4th Team'];
      var juniors = ['U13','U12','U11','U10','Mini Cricket'];
      var tm = matches.filter(function(m){ return m.team_name===team; });
      var ts = sessions.filter(function(s){
        if (!s.team_name || s.team_name === 'All Teams') return true;
        if (s.team_name === team) return true;
        if (s.team_name === 'All Senior Teams' && seniors.indexOf(team) !== -1) return true;
        if (s.team_name === 'All Junior Teams' && juniors.indexOf(team) !== -1) return true;
        return false;
      });
      var td = devs.filter(function(d){ return d.team_name===team; });
      if (!tm.length && !ts.length) return;
      var tgt = targets.find(function(t){ return t.team_name===team; }) ||
        { win_pct_target:60, training_sessions_target:8, attendance_pct_target:80, promotions_target:1 };

      var played   = tm.length;
      var wins     = tm.filter(function(m){ return m.result==='Win'; }).length;
      var winPct   = calcWinPct(tm);
      var sc       = ts.length;
      var avgAtt   = sc > 0
        ? Math.round(ts.reduce(function(a,s){ return a+(parseFloat(s.attendance_pct)||0); },0)/sc*10)/10
        : 0;
      var promo = td.filter(function(d){ return d.promoted; }).length;

      rows.push({ team:team, kpi:'Win %',             target:tgt.win_pct_target,              actual:winPct,  unit:'%' });
      rows.push({ team:team, kpi:'Training Sessions', target:tgt.training_sessions_target,     actual:sc,      unit:'' });
      rows.push({ team:team, kpi:'Avg Attendance',    target:tgt.attendance_pct_target,        actual:avgAtt,  unit:'%' });
      rows.push({ team:team, kpi:'Promotions',        target:tgt.promotions_target,            actual:promo,   unit:'' });
    });

    var tbody = el('ca-kpi-body');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="ca-empty">No data for selected filter. Add matches or sessions first.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      var v   = Math.round((r.actual - r.target) * 10) / 10;
      var pct = r.target > 0 ? Math.abs(v) / r.target : 0;
      var s   = v >= 0 ? 'Green' : (pct < 0.15 ? 'Amber' : 'Red');
      return '<tr>' +
        '<td class="gold">' + esc(r.team) + '</td>' +
        '<td>' + r.kpi + '</td>' +
        '<td>' + r.target + (r.unit?' '+r.unit:'') + '</td>' +
        '<td><strong>' + r.actual + (r.unit?' '+r.unit:'') + '</strong></td>' +
        '<td class="' + (v>=0?'variance-pos':'variance-neg') + '">' + (v>=0?'+':'') + v + (r.unit?' '+r.unit:'') + '</td>' +
        '<td>' + statusBadge(s) + '</td></tr>';
    }).join('');
  });
}

function bindKpiForm() {
  var saveBtn  = el('ca-kpi-save-btn');
  var clearBtn = el('ca-kpi-clear-btn');
  var savedBody = el('ca-kpi-saved-body');
  if (saveBtn)  saveBtn.addEventListener('click', saveKpiTargets);
  if (clearBtn) clearBtn.addEventListener('click', clearKpiForm);
  if (savedBody) savedBody.addEventListener('click', function (e) {
    var loadId = e.target.dataset.caLoadKpi;
    var delId  = e.target.dataset.caDelKpi;
    if (loadId && caKpiRows[loadId]) populateKpiForm(caKpiRows[loadId]);
    if (delId)  deleteKpiTarget(delId);
  });
}

function clearKpiForm() {
  el('ca-kpi-team-select').value     = '';
  el('ca-kpi-season').value          = '2025/26';
  el('ca-kpi-win-target').value      = '';
  el('ca-kpi-sessions-target').value = '';
  el('ca-kpi-attend-target').value   = '';
  el('ca-kpi-promo-target').value    = '';
  hideMsg('ca-kpi-success'); hideMsg('ca-kpi-error');
}

function populateKpiForm(t) {
  el('ca-kpi-team-select').value     = t.team_name;
  el('ca-kpi-season').value          = t.season || '2025/26';
  el('ca-kpi-win-target').value      = t.win_pct_target           != null ? t.win_pct_target           : '';
  el('ca-kpi-sessions-target').value = t.training_sessions_target != null ? t.training_sessions_target : '';
  el('ca-kpi-attend-target').value   = t.attendance_pct_target    != null ? t.attendance_pct_target    : '';
  el('ca-kpi-promo-target').value    = t.promotions_target        != null ? t.promotions_target        : '';
  el('ca-kpi-team-select').scrollIntoView({ behavior:'smooth', block:'center' });
}

function deleteKpiTarget(id) {
  if (!confirm('Delete these targets? The team will fall back to default targets.')) return;
  adminAPI('coaching.deleteKpi', { id: id })
    .then(function () { loadSavedTargets(); loadKpiPanel(); loadDashboard(); })
    .catch(function (e) { alert('Delete failed: ' + e.message); });
}

function saveKpiTargets() {
  var payload = {
    team_name:                el('ca-kpi-team-select').value,
    season:                   el('ca-kpi-season').value || '2025/26',
    win_pct_target:           parseFloat(el('ca-kpi-win-target').value)      || 60,
    training_sessions_target: parseInt(el('ca-kpi-sessions-target').value)   || 8,
    attendance_pct_target:    parseFloat(el('ca-kpi-attend-target').value)   || 80,
    promotions_target:        parseInt(el('ca-kpi-promo-target').value)      || 1,
    effective_from:           new Date().toISOString().split('T')[0]
  };
  if (!payload.team_name) { showError('ca-kpi-error', 'Select a team.'); return; }
  adminAPI('coaching.upsertKpi', payload)
    .then(function () { showSuccess('ca-kpi-success'); loadSavedTargets(); loadKpiPanel(); loadDashboard(); })
    .catch(function (e) { showError('ca-kpi-error', e.message); });
}

/* ═══════════════════════════════════════════════════════════════
   CHARTS
   ═══════════════════════════════════════════════════════════════ */
function loadCharts() {
  if (typeof Chart === 'undefined') {
    showError('ca-charts-error', 'Chart.js not loaded. Check the CDN script tag.');
    return;
  }
  var sixAgo = pastMonthStr(6);
  var mp = [['select','match_date,result,runs_scored,team_name'],['order','match_date.asc'],['match_date','gte.'+sixAgo]];
  var sp = [['select','session_date,attendance_pct,team_name'],  ['order','session_date.asc'],['session_date','gte.'+sixAgo]];
  if (caFilter.team) { mp.push(['team_name','eq.'+caFilter.team]); }
  // Sessions: fetch all, filter client-side to include joint groups

  Promise.all([sbGet('coach_matches', mp), sbGet('coach_training_sessions', sp)])
    .then(function (res) {
      var matches  = safeArr(res[0]);
      var sessions = safeArr(res[1]);

      // Client-side session filter for joint groups
      if (caFilter.team) {
        var seniors = ['1st Team','2nd Team','3rd Team','4th Team'];
        var juniors = ['U13','U12','U11','U10','Mini Cricket'];
        sessions = sessions.filter(function(s) {
          if (!s.team_name || s.team_name === 'All Teams') return true;
          if (s.team_name === caFilter.team) return true;
          if (s.team_name === 'All Senior Teams' && seniors.indexOf(caFilter.team) !== -1) return true;
          if (s.team_name === 'All Junior Teams' && juniors.indexOf(caFilter.team) !== -1) return true;
          return false;
        });
      }

      var months = last6Months();

      var wins={}, losses={}, runs={}, attend={}, attendN={}, sess={};
      months.forEach(function(m){ wins[m]=losses[m]=runs[m]=attend[m]=attendN[m]=sess[m]=0; });

      matches.forEach(function (m) {
        var mo = (m.match_date||'').substring(0,7);
        if (!wins.hasOwnProperty(mo)) return;
        if (m.result==='Win')  wins[mo]++;
        if (m.result==='Loss') losses[mo]++;
        runs[mo] += (m.runs_scored||0);
      });
      sessions.forEach(function (s) {
        var mo = (s.session_date||'').substring(0,7);
        if (!sess.hasOwnProperty(mo)) return;
        sess[mo]++;
        attend[mo]  += (parseFloat(s.attendance_pct)||0);
        attendN[mo] += 1;
      });

      var labels   = months;
      var winsD    = months.map(function(m){ return wins[m]; });
      var lossesD  = months.map(function(m){ return losses[m]; });
      var runsD    = months.map(function(m){ return runs[m]; });
      var attendD  = months.map(function(m){ return attendN[m]>0 ? Math.round(attend[m]/attendN[m]*10)/10 : 0; });
      var sessD    = months.map(function(m){ return sess[m]; });

      drawChart('ca-chart-results',    'bar',  labels,
        [{ label:'Wins',   data:winsD,   backgroundColor:'rgba(58,140,92,0.7)',  borderColor:'#5ec98a', borderWidth:1 },
         { label:'Losses', data:lossesD, backgroundColor:'rgba(180,60,60,0.7)',  borderColor:'#e07070', borderWidth:1 }]);
      drawChart('ca-chart-runs',       'line', labels,
        [{ label:'Runs Scored', data:runsD, borderColor:'#c9a84c', backgroundColor:'rgba(201,168,76,0.1)',
           tension:0.3, fill:true, pointBackgroundColor:'#c9a84c' }]);
      drawChart('ca-chart-attendance', 'line', labels,
        [{ label:'Avg Attendance %', data:attendD, borderColor:'#5ec98a', backgroundColor:'rgba(58,140,92,0.1)',
           tension:0.3, fill:true, pointBackgroundColor:'#5ec98a' }]);
      drawChart('ca-chart-sessions',   'bar',  labels,
        [{ label:'Sessions', data:sessD, backgroundColor:'rgba(201,168,76,0.55)', borderColor:'#c9a84c', borderWidth:1 }]);

      hideMsg('ca-charts-error');
    }).catch(function (e) { showError('ca-charts-error', 'Chart error: ' + e.message); });
}

function drawChart(canvasId, type, labels, datasets) {
  var canvas = el(canvasId);
  if (!canvas) return;
  if (caCharts[canvasId]) { caCharts[canvasId].destroy(); }
  caCharts[canvasId] = new Chart(canvas, {
    type: type,
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color:'#9a9da5', font:{ size:11 } } } },
      scales: {
        x: { ticks:{ color:'#6e737f', font:{ size:10 } }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y: { ticks:{ color:'#6e737f', font:{ size:10 } }, grid:{ color:'rgba(255,255,255,0.07)' }, beginAtZero:true }
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   MONTHLY REPORT
   ═══════════════════════════════════════════════════════════════ */
var reportData = {};

function bindReportForm() {
  el('ca-report-generate-btn').addEventListener('click', generateReport);
  el('ca-report-print-btn').addEventListener('click', function () { window.print(); });
  el('ca-report-save-btn').addEventListener('click', saveReport);
  el('ca-report-save-btn-2').addEventListener('click', saveReport);
}

function generateReport() {
  var month = el('ca-report-month').value;
  var team  = el('ca-report-team').value;
  if (!month) { showError('ca-report-error', 'Select a month.'); return; }
  hideMsg('ca-report-error');

  var lastDayRpt = new Date(parseInt(month.split('-')[0],10), parseInt(month.split('-')[1],10), 0).getDate();
  var lastRpt    = month + '-' + String(lastDayRpt).padStart(2,'0');
  var mp = [['select','*'],['match_date','gte.'+month+'-01'],['match_date','lte.'+lastRpt]];
  var sp = [['select','*'],['session_date','gte.'+month+'-01'],['session_date','lte.'+lastRpt]];
  var dp = { select:'*', month:'eq.'+month };
  if (team) { mp.push(['team_name','eq.'+team]); sp.push(['team_name','eq.'+team]); dp.team_name='eq.'+team; }

  Promise.all([
    sbGet('coach_matches',            mp),
    sbGet('coach_training_sessions',  sp),
    sbGet('coach_player_development', dp)
  ]).then(function (res) {
    var matches  = safeArr(res[0]);
    var sessions = safeArr(res[1]);
    var devs     = safeArr(res[2]);

    var played       = matches.length;
    var wins         = matches.filter(function(m){ return m.result==='Win'; }).length;
    var losses       = matches.filter(function(m){ return m.result==='Loss'; }).length;
    var draws        = matches.filter(function(m){ return m.result==='Draw'||m.result==='No Result'; }).length;
    var winPct       = calcWinPct(matches).toFixed(1);
    var runsScored   = matches.reduce(function(s,m){ return s+(m.runs_scored||0);   },0);
    var runsConceded = matches.reduce(function(s,m){ return s+(m.runs_conceded||0); },0);
    var wktsTaken    = matches.reduce(function(s,m){ return s+(m.wickets_taken||0); },0);
    var wktsLost     = matches.reduce(function(s,m){ return s+(m.wickets_lost||0);  },0);
    var sc           = sessions.length;
    var avgAtt       = sc>0
      ? (sessions.reduce(function(s,t){ return s+(parseFloat(t.attendance_pct)||0); },0)/sc).toFixed(1)
      : '0.0';
    var promoted   = devs.filter(function(d){ return d.promoted; }).length;
    var juniors    = devs.filter(function(d){ return d.junior_integrated; }).length;
    var milestones = devs.filter(function(d){ return d.milestone_achieved; }).length;

    el('ca-report-meta').innerHTML =
      'Period: '    + formatMonthLabel(month) + '<br>' +
      'Team: '      + (team||'All Teams')     + '<br>' +
      'Generated: ' + new Date().toLocaleDateString('en-ZA');

    setText('rpt-played',       played);
    setText('rpt-wins',         wins);
    setText('rpt-losses',       losses);
    setText('rpt-draws',        draws);
    setText('rpt-winpct',       winPct + '%');
    setText('rpt-runs-scored',  runsScored);
    setText('rpt-runs-conceded',runsConceded);
    setText('rpt-wkts-taken',   wktsTaken);
    setText('rpt-wkts-lost',    wktsLost);
    setText('rpt-sessions',     sc);
    setText('rpt-attendance',   avgAtt + '%');
    setText('rpt-promoted',     promoted);
    setText('rpt-juniors',      juniors);
    setText('rpt-milestones',   milestones);

    var commentary = el('ca-report-commentary').value.trim() || 'No commentary provided.';
    el('rpt-commentary').textContent = commentary;

    el('ca-report-preview').style.display = '';
    el('ca-report-print-btn').disabled    = false;
    el('ca-report-save-btn').disabled     = false;
    el('ca-report-preview').scrollIntoView({ behavior:'smooth', block:'start' });

    reportData = {
      month: month, team_name: team || 'All Teams',
      played, wins, losses, draws,
      win_pct: parseFloat(winPct),
      runs_scored: runsScored, runs_conceded: runsConceded,
      wickets_taken: wktsTaken, wickets_lost: wktsLost,
      training_sessions: sc, avg_attendance_pct: parseFloat(avgAtt),
      players_promoted: promoted, juniors_integrated: juniors,
      coach_commentary: commentary, generated_by: SESSION_NAME
    };
  }).catch(function (e) { showError('ca-report-error', 'Report error: ' + e.message); });
}

function saveReport() {
  if (!reportData.month) { alert('Generate a report first.'); return; }
  adminAPI('coaching.saveReport', reportData)
    .then(function () { alert('✅ Report saved.'); })
    .catch(function (e) { alert('Save failed: ' + e.message); });
}

/* ═══════════════════════════════════════════════════════════════
   FORMATTERS / BADGE HELPERS
   ═══════════════════════════════════════════════════════════════ */
function fmtDate(d) {
  if (!d) return '—';
  var p = d.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}
function formatMonthLabel(ym) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var p = ym.split('-');
  return months[parseInt(p[1],10)-1] + ' ' + p[0];
}
function resultBadge(r) {
  var cls = { Win:'ca-badge-win', Loss:'ca-badge-loss', Draw:'ca-badge-draw', 'No Result':'ca-badge-nr' };
  return '<span class="ca-badge ' + (cls[r]||'ca-badge-nr') + '">' + esc(r||'—') + '</span>';
}
function statusBadge(s) {
  var cls = { Green:'ca-badge-green', Amber:'ca-badge-amber', Red:'ca-badge-red' };
  return '<span class="ca-badge ' + (cls[s]||'') + '">' + s + '</span>';
}
function yesNoBadge(v) {
  return v
    ? '<span class="ca-badge ca-badge-yes">Yes</span>'
    : '<span class="ca-badge ca-badge-no">No</span>';
}
function last6Months() {
  var out = [], d = new Date();
  for (var i=5; i>=0; i--) {
    var m = new Date(d.getFullYear(), d.getMonth()-i, 1);
    out.push(m.getFullYear() + '-' + String(m.getMonth()+1).padStart(2,'0'));
  }
  return out;
}
function pastMonthStr(n) {
  var d = new Date();
  d.setMonth(d.getMonth() - n + 1);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01';
}

/* ═══════════════════════════════════════════════════════════════
   SKILL MATRIX  (flat / club-wide — no team scoping)
   Editable grid: skills across the top, player rows, 1–10 cells.
   Autosave (debounced) + Save button. Only changed cells are written,
   each as a dated record (assessment_month) feeding the trend chart.
   Players come from the club players table via an autocomplete search.
   ═══════════════════════════════════════════════════════════════ */
var skState = {
  month: '',          // YYYY-MM derived from filter month
  skills: [],         // [{id, skill_name, skill_group, sort_order}]
  players: [],        // [{name, scores:{skill_name:rating}}]
  saved: {},          // saved snapshot: "player|skill" -> rating
  pending: {},        // dirty cells: "player|skill" -> {player, skill, from, to}
  pool: [],           // all active club player names (for search)
  poolLoaded: false,
  timer: null,
  radar: null,
  trend: null,
  selected: null,     // selected player name for detail
  gridCollapsed: false,
};

function skCellColor(v) {
  if (!v || v < 1) return { bg: 'transparent', fg: 'var(--white)' };
  var h = (v - 1) / 9 * 120;               // 0=red .. 120=green
  return { bg: 'hsl(' + h + ',58%,46%)', fg: '#fff' };
}

function bindSkillMatrix() {
  var saveBtn = el('ca-sk-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', function () { clearTimeout(skState.timer); skFlush(); });

  var manageBtn = el('ca-sk-manage-btn');
  if (manageBtn) manageBtn.addEventListener('click', function () {
    var box = el('ca-sk-manage');
    var open = box.style.display === 'none' || !box.style.display;
    box.style.display = open ? 'block' : 'none';
    manageBtn.textContent = open ? '⚙ Hide skills' : '⚙ Manage skills';
  });

  var collapseBtn = el('ca-sk-collapse-btn');
  if (collapseBtn) collapseBtn.addEventListener('click', function () {
    skState.gridCollapsed = !skState.gridCollapsed;
    applyGridCollapsed();
  });

  var addDefBtn = el('ca-sk-add-def-btn');
  if (addDefBtn) addDefBtn.addEventListener('click', skAddSkillDef);

  var addPlayerBtn = el('ca-sk-add-player-btn');
  if (addPlayerBtn) addPlayerBtn.addEventListener('click', skShowPlayerSearch);

  var trendSel = el('ca-sk-trend-skill');
  if (trendSel) trendSel.addEventListener('change', skRenderTrend);

  var searchInput = el('ca-sk-search-input');
  if (searchInput) searchInput.addEventListener('input', function () { renderSearchResults(searchInput.value); });
}

function applyGridCollapsed() {
  var views = el('ca-sk-views');
  var btn = el('ca-sk-collapse-btn');
  var footer = el('ca-sk-grid-footer');
  if (skState.gridCollapsed) {
    if (views) views.style.display = 'none';
    if (footer) footer.style.display = 'none';
    if (btn) btn.textContent = '▸ Show grid';
  } else {
    if (views) views.style.display = '';
    if (footer) footer.style.display = '';
    if (btn) btn.textContent = '▾ Hide grid';
  }
}

function loadSkillMatrix() {
  skState.month = caFilter.month || (new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0'));

  el('ca-sk-empty').style.display = 'none';
  el('ca-sk-add-player-btn').style.display = canWrite() ? '' : 'none';

  // Lazy-load the club player pool once for the search box
  if (!skState.poolLoaded) {
    sbGet('players', [['select','name'],['active','eq.true'],['order','name.asc']])
      .then(function (rows) {
        skState.pool = safeArr(rows).map(function (r) { return r.name; }).filter(Boolean);
        skState.poolLoaded = true;
      });
  }

  // Load skill definitions + this month's ratings together (no team filter).
  // Use a raw fetch for definitions so a missing table (migration not run)
  // reports clearly instead of silently showing an empty grid.
  fetch(SUPABASE_URL + '/rest/v1/coach_skill_definitions?select=*&active=eq.true&order=sort_order.asc', { headers: H })
    .then(function (r) {
      if (r.status === 404 || r.status === 400) {
        return r.text().then(function (t) { throw new Error('The skill tables are not set up yet. Run coaching_skills_migration.sql in Supabase. (' + t.slice(0, 120) + ')'); });
      }
      return r.json();
    })
    .then(function (defs) {
      skState.skills = safeArr(defs);
      return sbGet('coach_player_skills', [['select','*'],['assessment_month','eq.'+skState.month]]);
    })
    .then(function (ratings) {
      ratings = safeArr(ratings);
      var pmap = {};
      skState.saved = {};
      ratings.forEach(function (r) {
        if (!pmap[r.player_name]) pmap[r.player_name] = { name: r.player_name, scores: {} };
        pmap[r.player_name].scores[r.skill_name] = r.rating;
        skState.saved[r.player_name + '|' + r.skill_name] = r.rating;
      });
      skState.players = Object.keys(pmap).sort().map(function (n) { return pmap[n]; });
      skState.pending = {};

      renderSkillGrid();
      renderSkillManage();
      populateTrendSkillSelect();
      skSetStatus();
      applyGridCollapsed();
      hideMsg('ca-sk-error');

      if (skState.players.length) { skState.selected = skState.players[0].name; skRenderDetail(); el('ca-sk-detail').style.display = ''; }
      else { el('ca-sk-detail').style.display = 'none'; }
    }).catch(function (e) {
      showError('ca-sk-error', e.message || 'Could not load skill matrix.');
    });
}

function renderSkillGrid() {
  // Desktop table head
  var head = el('ca-sk-head');
  head.innerHTML = '<th class="ca-sk-namecol">Player</th>' +
    skState.skills.map(function (s) {
      return '<th class="ca-sk-skillhead"><span class="ca-sk-grp">' + esc(s.skill_group || '') + '</span>' + esc(s.skill_name) + '</th>';
    }).join('') + '<th class="ca-sk-actcol"></th>';

  var body = el('ca-sk-body');
  var cards = el('ca-sk-cards');

  if (!skState.skills.length) {
    body.innerHTML = '<tr><td class="ca-empty" colspan="3">No skills defined yet. Use “Manage skills” to add some.</td></tr>';
    if (cards) cards.innerHTML = '<div class="ca-empty" style="padding:20px">No skills defined yet. Use “Manage skills” to add some.</div>';
    return;
  }
  if (!skState.players.length) {
    body.innerHTML = '<tr><td class="ca-sk-namecell" style="color:var(--muted)">No assessments yet</td>' +
      skState.skills.map(function(){ return '<td style="color:var(--muted)">—</td>'; }).join('') + '<td></td></tr>';
    if (cards) cards.innerHTML = '<div class="ca-empty" style="padding:20px">No players added yet. Tap “Add player” to start.</div>';
    return;
  }
  // Desktop rows
  body.innerHTML = '';
  skState.players.forEach(function (p) { body.appendChild(skBuildRow(p)); });
  // Mobile cards
  if (cards) {
    cards.innerHTML = '';
    skState.players.forEach(function (p) { cards.appendChild(skBuildCard(p)); });
  }
}

/* One score input shared by both views — keeps colour + dirty logic identical */
function skMakeInput(player, skill) {
  var inp = document.createElement('input');
  inp.type = 'number'; inp.min = 1; inp.max = 10;
  inp.inputMode = 'numeric';
  inp.className = 'ca-sk-cell';
  inp.disabled = !canWrite();
  var cur = player.scores[skill];
  if (cur) { inp.value = cur; var c = skCellColor(cur); inp.style.background = c.bg; inp.style.color = c.fg; }
  inp.addEventListener('input', function () {
    var v = parseInt(inp.value, 10);
    if (isNaN(v) || v < 1) { v = 0; } if (v > 10) { v = 10; inp.value = 10; }
    player.scores[skill] = v || undefined;
    var cc = skCellColor(v);
    inp.style.background = cc.bg; inp.style.color = cc.fg;
    // keep the matching input in the other view in sync
    syncSiblingInputs(player.name, skill, inp);
    skMarkDirty(player, skill, inp);
  });
  inp.setAttribute('data-sk-player', player.name);
  inp.setAttribute('data-sk-skill', skill);
  return inp;
}

// Mirror a value change to the same player+skill input in the other layout
function syncSiblingInputs(player, skill, sourceInp) {
  qsa('.ca-sk-cell[data-sk-player="' + (window.CSS && CSS.escape ? CSS.escape(player) : player) + '"]').forEach(function (other) {
    if (other === sourceInp) return;
    if (other.getAttribute('data-sk-skill') !== skill) return;
    other.value = sourceInp.value;
    other.style.background = sourceInp.style.background;
    other.style.color = sourceInp.style.color;
    if (sourceInp.classList.contains('dirty')) other.classList.add('dirty'); else other.classList.remove('dirty');
  });
}

/* Mobile card: one collapsible card per player, skills listed vertically */
function skBuildCard(player) {
  var card = document.createElement('div');
  card.className = 'ca-sk-card';

  var header = document.createElement('button');
  header.type = 'button';
  header.className = 'ca-sk-card-head';
  header.innerHTML = '<span class="ca-sk-card-name">' + esc(player.name) + '</span>' +
                     '<span class="ca-sk-card-meta"><span class="ca-sk-card-count"></span><span class="ca-sk-card-chev">▾</span></span>';

  var bodyEl = document.createElement('div');
  bodyEl.className = 'ca-sk-card-body';

  function ratedCount() {
    var n = 0; skState.skills.forEach(function (s) { if (player.scores[s.skill_name]) n++; });
    return n;
  }
  function refreshCount() {
    var span = header.querySelector('.ca-sk-card-count');
    if (span) span.textContent = ratedCount() + '/' + skState.skills.length + ' rated';
  }

  skState.skills.forEach(function (s) {
    var row = document.createElement('div');
    row.className = 'ca-sk-card-row';
    var lbl = document.createElement('div');
    lbl.className = 'ca-sk-card-skill';
    lbl.innerHTML = '<span class="ca-sk-card-grp">' + esc(s.skill_group || '') + '</span>' + esc(s.skill_name);
    var inp = skMakeInput(player, s.skill_name);
    inp.classList.add('ca-sk-card-input');
    inp.addEventListener('input', refreshCount);
    row.appendChild(lbl);
    row.appendChild(inp);
    bodyEl.appendChild(row);
  });

  // Footer: view profile + delete
  var footer = document.createElement('div');
  footer.className = 'ca-sk-card-footer';
  var profBtn = document.createElement('button');
  profBtn.type = 'button'; profBtn.className = 'ca-sk-card-prof';
  profBtn.textContent = 'View profile';
  profBtn.addEventListener('click', function () {
    skState.selected = player.name; skRenderDetail();
    el('ca-sk-detail').style.display = '';
    el('ca-sk-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  footer.appendChild(profBtn);
  if (canWrite()) {
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'ca-sk-card-del';
    del.textContent = 'Delete row';
    del.addEventListener('click', function () { skDeleteRow(player); });
    footer.appendChild(del);
  }
  bodyEl.appendChild(footer);

  header.addEventListener('click', function () {
    card.classList.toggle('open');
  });

  card.appendChild(header);
  card.appendChild(bodyEl);
  refreshCount();
  return card;
}

function skBuildRow(player) {
  var tr = document.createElement('tr');

  // Name cell
  var nameTd = document.createElement('td');
  nameTd.className = 'ca-sk-namecell';
  nameTd.textContent = player.name;
  nameTd.style.cursor = 'pointer';
  nameTd.title = 'View profile';
  nameTd.addEventListener('click', function () { skState.selected = player.name; skRenderDetail(); el('ca-sk-detail').style.display = ''; });
  tr.appendChild(nameTd);

  // Skill cells
  skState.skills.forEach(function (s) {
    var td = document.createElement('td');
    td.appendChild(skMakeInput(player, s.skill_name));
    tr.appendChild(td);
  });

  // Delete row action
  var actTd = document.createElement('td');
  actTd.className = 'ca-sk-actcell';
  if (canWrite()) {
    var del = document.createElement('button');
    del.className = 'ca-sk-row-del';
    del.title = 'Delete this player\'s ratings for ' + skState.month;
    del.innerHTML = '✕';
    del.addEventListener('click', function () { skDeleteRow(player); });
    actTd.appendChild(del);
  }
  tr.appendChild(actTd);
  return tr;
}

function skMarkDirty(player, skill, inp) {
  var key = player.name + '|' + skill;
  var prev = skState.saved[key];
  var now = player.scores[skill];
  if (now === prev || (!now && !prev)) {
    delete skState.pending[key];
    inp.classList.remove('dirty');
  } else {
    skState.pending[key] = { player: player.name, skill: skill, from: prev || null, to: now };
    inp.classList.add('dirty');
  }
  skSetStatus();
  clearTimeout(skState.timer);
  skState.timer = setTimeout(skFlush, 1100);
}

function skSetStatus() {
  var n = Object.keys(skState.pending).length;
  var dot = el('ca-sk-dot'), txt = el('ca-sk-status-text');
  if (!dot) return;
  if (n === 0) { dot.style.background = '#5DCAA5'; txt.textContent = 'All changes saved'; }
  else { dot.style.background = '#e0bc5a'; txt.textContent = n + ' unsaved change' + (n > 1 ? 's' : ''); }
}

function skFlush() {
  var keys = Object.keys(skState.pending);
  if (!keys.length) return;
  if (!canWrite()) return;
  var dot = el('ca-sk-dot'), txt = el('ca-sk-status-text');
  dot.style.background = '#7ab0ff'; txt.textContent = 'Saving…';

  var cells = keys.map(function (k) {
    var c = skState.pending[k];
    return { player_name: c.player, skill_name: c.skill, rating: c.to, assessment_month: skState.month };
  }).filter(function (c) { return c.rating >= 1 && c.rating <= 10; });

  if (!cells.length) {
    skState.pending = {}; skSetStatus();
    qsa('.ca-sk-cell.dirty').forEach(function (i) { i.classList.remove('dirty'); });
    return;
  }

  adminAPI('coaching.saveSkills', { cells: cells }).then(function () {
    cells.forEach(function (c) { skState.saved[c.player_name + '|' + c.skill_name] = c.rating; });
    skState.pending = {};
    qsa('.ca-sk-cell.dirty').forEach(function (i) { i.classList.remove('dirty'); });
    skSetStatus();
    if (skState.selected) skRenderDetail();
  }).catch(function (e) {
    dot.style.background = '#e07070'; txt.textContent = 'Save failed';
    showError('ca-sk-error', 'Save failed: ' + e.message);
  });
}

/* ── Delete a player's row for the selected month ───────────────── */
function skDeleteRow(player) {
  if (!canWrite()) return;
  var hasSaved = skState.skills.some(function (s) { return skState.saved[player.name + '|' + s.skill_name] != null; });
  var msg = hasSaved
    ? 'Delete ' + player.name + '\'s ratings for ' + skState.month + '? Other months are kept.'
    : 'Remove ' + player.name + ' from this month\'s grid?';
  if (!confirm(msg)) return;

  function removeLocally() {
    skState.skills.forEach(function (s) { delete skState.saved[player.name + '|' + s.skill_name]; delete skState.pending[player.name + '|' + s.skill_name]; });
    skState.players = skState.players.filter(function (p) { return p.name !== player.name; });
    if (skState.selected === player.name) {
      skState.selected = skState.players.length ? skState.players[0].name : null;
    }
    renderSkillGrid();
    skSetStatus();
    if (skState.selected) { skRenderDetail(); el('ca-sk-detail').style.display = ''; }
    else el('ca-sk-detail').style.display = 'none';
  }

  if (!hasSaved) { removeLocally(); return; }   // nothing persisted yet

  adminAPI('coaching.deletePlayerSkills', { player_name: player.name, assessment_month: skState.month })
    .then(removeLocally)
    .catch(function (e) { showError('ca-sk-error', 'Delete failed: ' + e.message); });
}

/* ── Add a player via search against the club player pool ───────── */
function skShowPlayerSearch() {
  if (!canWrite()) return;
  var box = el('ca-sk-search-box');
  if (!box) return;
  box.style.display = '';
  var inp = el('ca-sk-search-input');
  inp.value = '';
  renderSearchResults('');
  inp.focus();
}

function renderSearchResults(q) {
  var list = el('ca-sk-search-results');
  if (!list) return;
  var already = {};
  skState.players.forEach(function (p) { already[p.name] = true; });
  q = (q || '').toLowerCase();
  var matches = skState.pool.filter(function (n) {
    return !already[n] && (!q || n.toLowerCase().indexOf(q) !== -1);
  }).slice(0, 8);

  if (!skState.pool.length) {
    list.innerHTML = '<div class="ca-sk-search-empty">Loading players…</div>';
    return;
  }
  if (!matches.length) {
    list.innerHTML = '<div class="ca-sk-search-empty">No matching players' + (q ? ' for “' + esc(q) + '”' : '') + '.</div>';
    return;
  }
  list.innerHTML = matches.map(function (n) {
    return '<button type="button" class="ca-sk-search-item" data-name="' + esc(n) + '">' + esc(n) + '</button>';
  }).join('');
  qsa('#ca-sk-search-results .ca-sk-search-item').forEach(function (btn) {
    btn.addEventListener('click', function () { skAddPlayer(btn.dataset.name); });
  });
}

function skAddPlayer(name) {
  if (!name) return;
  if (skState.players.some(function (p) { return p.name === name; })) return;
  skState.players.push({ name: name, scores: {} });
  skState.players.sort(function (a, b) { return a.name.localeCompare(b.name); });
  renderSkillGrid();
  el('ca-sk-search-box').style.display = 'none';
  // focus first cell of the new row
  var rows = qsa('#ca-sk-body tr');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].querySelector('.ca-sk-namecell') && rows[i].querySelector('.ca-sk-namecell').textContent === name) {
      var firstCell = rows[i].querySelector('.ca-sk-cell');
      if (firstCell) firstCell.focus();
      break;
    }
  }
}

/* ── Manage skills (flat / club-wide) ───────────────────────────── */
function renderSkillManage() {
  var box = el('ca-sk-deflist');
  if (!skState.skills.length) { box.innerHTML = '<div class="ca-empty" style="padding:14px">No skills yet — add the first one below.</div>'; return; }
  box.innerHTML = '';
  skState.skills.forEach(function (s) {
    var row = document.createElement('div');
    row.className = 'ca-sk-def-row';
    var grp = document.createElement('span'); grp.className = 'ca-sk-def-grp'; grp.textContent = s.skill_group || 'General';
    var nameInp = document.createElement('input'); nameInp.className = 'ca-sk-def-name'; nameInp.value = s.skill_name;
    nameInp.disabled = !canWrite();
    nameInp.addEventListener('change', function () {
      if (!nameInp.value.trim() || nameInp.value === s.skill_name) return;
      adminAPI('coaching.upsertSkillDef', { id: s.id, skill_name: nameInp.value.trim() })
        .then(function () { loadSkillMatrix(); })
        .catch(function (e) { showError('ca-sk-manage-error', e.message); });
    });
    row.appendChild(grp); row.appendChild(nameInp);
    if (canWrite()) {
      var del = document.createElement('button'); del.className = 'ca-sk-def-del'; del.textContent = 'Remove';
      del.addEventListener('click', function () {
        if (!confirm('Remove “' + s.skill_name + '” from the matrix? Past ratings are kept.')) return;
        adminAPI('coaching.deleteSkillDef', { id: s.id })
          .then(function () { loadSkillMatrix(); })
          .catch(function (e) { showError('ca-sk-manage-error', e.message); });
      });
      row.appendChild(del);
    }
    box.appendChild(row);
  });
}

function skAddSkillDef() {
  if (!canWrite()) { showError('ca-sk-manage-error', 'Your role can view skills but not change them. A coach, scores or super account is needed.'); return; }
  var name = el('ca-sk-new-name').value.trim();
  var group = el('ca-sk-new-group').value;
  if (!name) { showError('ca-sk-manage-error', 'Enter a skill name.'); return; }
  var maxOrder = skState.skills.reduce(function (m, s) { return Math.max(m, s.sort_order || 0); }, 0);
  adminAPI('coaching.upsertSkillDef', {
    skill_name: name, skill_group: group, sort_order: maxOrder + 10, active: true
  }).then(function () {
    el('ca-sk-new-name').value = '';
    hideMsg('ca-sk-manage-error');
    loadSkillMatrix();
  }).catch(function (e) { showError('ca-sk-manage-error', e.message); });
}

/* ── Detail: radar + trend ──────────────────────────────────────── */
function populateTrendSkillSelect() {
  var sel = el('ca-sk-trend-skill');
  if (!sel) return;
  sel.innerHTML = skState.skills.map(function (s) {
    return '<option value="' + esc(s.skill_name) + '">' + esc(s.skill_name) + '</option>';
  }).join('');
}

function skRenderDetail() {
  var p = skState.players.filter(function (x) { return x.name === skState.selected; })[0];
  if (!p) { el('ca-sk-detail').style.display = 'none'; return; }
  el('ca-sk-detail-name').textContent = p.name;

  var labels = skState.skills.map(function (s) { return s.skill_name; });
  var data   = skState.skills.map(function (s) { return p.scores[s.skill_name] || 0; });
  if (skState.radar) skState.radar.destroy();
  var rc = el('ca-sk-radar');
  if (rc && window.Chart) {
    skState.radar = new Chart(rc, {
      type: 'radar',
      data: { labels: labels, datasets: [{ data: data, fill: true,
        backgroundColor: 'rgba(201,168,76,0.18)', borderColor: '#c9a84c',
        pointBackgroundColor: '#c9a84c', borderWidth: 2, pointRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { r: { min: 0, max: 10, ticks: { stepSize: 2, display: false, color:'#6e737f' },
          grid: { color: 'rgba(255,255,255,0.08)' }, angleLines: { color: 'rgba(255,255,255,0.08)' },
          pointLabels: { color: '#9a9da5', font: { size: 10 } } } } }
    });
  }
  skRenderTrend();
}

function skRenderTrend() {
  var p = skState.players.filter(function (x) { return x.name === skState.selected; })[0];
  if (!p) return;
  var sel = el('ca-sk-trend-skill');
  var skill = sel ? sel.value : (skState.skills[0] && skState.skills[0].skill_name);
  if (!skill) return;

  sbGet('coach_player_skills', [
    ['select','rating,assessment_month'],
    ['player_name','eq.'+p.name],
    ['skill_name','eq.'+skill],
    ['order','assessment_month.asc']
  ]).then(function (rows) {
    rows = safeArr(rows);
    var labels = rows.map(function (r) { return r.assessment_month; });
    var data   = rows.map(function (r) { return r.rating; });
    if (skState.trend) skState.trend.destroy();
    var tc = el('ca-sk-trend');
    if (tc && window.Chart) {
      skState.trend = new Chart(tc, {
        type: 'line',
        data: { labels: labels, datasets: [{ data: data, borderColor: '#c9a84c',
          backgroundColor: 'rgba(201,168,76,0.12)', fill: true, tension: 0.3,
          pointBackgroundColor: '#c9a84c', pointRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { min: 0, max: 10, ticks: { stepSize: 2, color: '#6e737f', font:{size:10} }, grid: { color: 'rgba(255,255,255,0.07)' } },
            x: { ticks: { color: '#6e737f', font:{size:10} }, grid: { display: false } } } }
      });
    }
  });
}

/* ── Expose init for admin.js ────────────────────────────────── */
window.initCoachingAnalytics = initCoachingAnalytics;

})(); // end IIFE
