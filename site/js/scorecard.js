/* Format-aware ball/over rendering — mirrors the scorer's 100-ball support. */
function scIsHundred(ls){ return (ls && ls.format) === 'hundred'; }
function scOversText(ls){
  var ov = ls.overs || 0, bl = ls.balls || 0;
  if (scIsHundred(ls)) return (ov * 5 + bl) + '/' + (ls.total_balls || 100) + ' balls';
  return ov + '.' + bl + ' overs';
}
var SUPABASE_URL = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var H = { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY };

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* FOW overs are stored already formatted by the scorer ("17.2 ov"); very old
   entries may be a bare number. Adding " ov" unconditionally doubled it. */
function fowOvers(v) {
  var t = String(v == null ? '' : v).trim();
  return /[a-z]/i.test(t) ? t : (t ? t + ' ov' : '');
}

function fmtOvers(overs, balls) {
  return balls > 0 ? overs + '.' + balls : overs + '';
}

/* Header scoreline — balls in the Hundred, overs otherwise. */
function scScoreLine(ls) {
  var sc = ls.runs + '/' + ls.wickets;
  if (scIsHundred(ls)) return sc + ' (' + ((ls.overs || 0) * 5 + (ls.balls || 0)) + ' b)';
  return sc + ' (' + fmtOvers(ls.overs, ls.balls) + ' ov)';
}

/* Every batter in an innings, in the order they came to the crease — not the
   order they were out. The scorer stamps each batter with `order`; matches
   scored before that have none and keep the order they were stored in. */
function battingCard(batting) {
  if (!batting) return [];
  var rows = [], seq = 0;
  (batting.dismissed || []).forEach(function(b) {
    if (b) rows.push({ bat: b, notOut: false, retiredHurt: false, seq: seq++ });
  });
  ['striker', 'nonStriker'].forEach(function(k) {
    if (batting[k]) rows.push({ bat: batting[k], notOut: true, retiredHurt: false, seq: seq++ });
  });
  (batting.retiredHurt || []).forEach(function(b) {
    if (b) rows.push({ bat: b, notOut: false, retiredHurt: true, seq: seq++ });
  });
  var known = rows.filter(function(r) { return typeof r.bat.order === 'number'; });
  if (!known.length) return rows;
  var maxOrd = known.reduce(function(m, r) { return Math.max(m, r.bat.order); }, 0);
  rows.forEach(function(r) {
    r._ord = typeof r.bat.order === 'number' ? r.bat.order : maxOrd + 1 + r.seq;
  });
  rows.sort(function(a, b) { return a._ord - b._ord || a.seq - b.seq; });
  return rows;
}

/* Standard scorecard notation — kept in step with dismissalText() in the scorer. */
function dismissalText(b) {
  var bw = b.bowler || '', f = b.fielder || '';
  var same = f && bw && f.trim().toLowerCase() === bw.trim().toLowerCase();
  switch (b.how || 'Bowled') {
    case 'Bowled':          return bw ? 'b ' + bw : 'bowled';
    case 'Caught':
      if (same)    return 'c & b ' + bw;
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
    case 'Obstructing the Field': return 'obstructing the field';
    case 'Hit the Ball Twice':    return 'hit the ball twice';
    case 'Timed Out':             return 'timed out';
    default:                return b.how || '';
  }
}

function resultClass(r) {
  if (!r) return 'default';
  var rl = r.toLowerCase();
  if (rl === 'won' || rl === 'win') return 'won';
  if (rl === 'lost' || rl === 'loss') return 'lost';
  return 'draw';
}

function buildBattingTable(batting, ls) {
  var totalExt  = (ls.extras_wides||0) + (ls.extras_noballs||0) + (ls.extras_byes||0) + (ls.extras_legbyes||0) + (ls.extras_penalty||0);
  var html = '';

  html += '<table class="sc-table">';
  html += '<thead><tr>';
  html += '<th>Batter</th><th>Dismissal</th>';
  html += '<th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th>';
  html += '</tr></thead><tbody>';

  battingCard(batting).forEach(function(row) {
    var b  = row.bat;
    var sr = b.balls > 0 ? (b.runs / b.balls * 100).toFixed(1) : '0.0';
    if (row.notOut) {
      html += '<tr class="notout">';
      html += '<td>' + esc(b.name) + '<span class="sc-notout-tag">not out</span></td>';
      html += '<td></td>';
      html += '<td class="sc-bold sc-green">' + b.runs + '</td>';
    } else {
      html += '<tr>';
      html += '<td>' + esc(b.name) + '</td>';
      html += '<td>' + esc(row.retiredHurt ? 'retired hurt' : dismissalText(b)) + '</td>';
      html += '<td class="sc-bold">' + b.runs + '</td>';
    }
    html += '<td>' + b.balls + '</td>';
    html += '<td>' + (b.fours||0) + '</td>';
    html += '<td>' + (b.sixes||0) + '</td>';
    html += '<td>' + sr + '</td>';
    html += '</tr>';
  });

  html += '<tr class="extras-row"><td>Extras</td>';
  html += '<td class="extras-detail">W:' + (ls.extras_wides||0) + ' NB:' + (ls.extras_noballs||0) + ' B:' + (ls.extras_byes||0) + ' LB:' + (ls.extras_legbyes||0) + ((ls.extras_penalty||0) ? ' P:' + ls.extras_penalty : '') + '</td>';
  html += '<td class="sc-bold">' + totalExt + '</td><td></td><td></td><td></td><td></td></tr>';

  html += '<tr class="total-row"><td>Total</td>';
  html += '<td style="color:var(--muted);font-size:0.8rem;font-family:\'Crimson Pro\',serif;font-weight:400">'
        + scOversText(ls)
        + (ls.target ? ' &nbsp;·&nbsp; Target: ' + ls.target : '') + '</td>';
  html += '<td>' + ls.runs + '/' + ls.wickets + '</td>';
  html += '<td></td><td></td><td></td><td></td></tr>';

  html += '</tbody></table>';
  return html;
}

/* `ls` is the innings this table belongs to. It used to be read from load()'s
   local scope, which this function cannot see — so any innings with at least
   one bowler threw "ls is not defined" and the whole page failed. */
function buildBowlingTable(bowling, ls) {
  var bowlers = (bowling && bowling.bowlers) || [];
  if (!bowlers.length) return '';
  var html = '<table class="sc-table"><thead><tr>';
  html += '<th>Bowler</th><th></th>';
  html += '<th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th>';
  html += '</tr></thead><tbody>';
  bowlers.forEach(function(b) {
    var bBalls  = (b.overs||0) * (scIsHundred(ls) ? 5 : 6) + (b.balls||0);
    var econDiv = scIsHundred(ls) ? bBalls : bBalls / 6;   // official: runs per ball
    var econ    = bBalls > 0 ? (b.runs / econDiv).toFixed(scIsHundred(ls) ? 2 : 1) : '—';
    var ovDisp  = (scIsHundred(ls) ? ((b.overs||0)*5+(b.balls||0)) + 'b' : b.overs + (b.balls > 0 ? '.' + b.balls : ''));
    html += '<tr>';
    html += '<td>' + esc(b.name) + '</td><td></td>';
    html += '<td>' + ovDisp + '</td>';
    html += '<td>' + (b.maidens||0) + '</td>';
    html += '<td>' + b.runs + '</td>';
    html += '<td class="' + (b.wickets > 0 ? 'sc-bold sc-green' : '') + '">' + b.wickets + '</td>';
    html += '<td>' + econ + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function buildInnings(label, ls, batting, bowling, defaultOpen) {
  batting = batting || {};   // a stored "null" parses to null, not {}
  bowling = bowling || {};
  var scoreStr = scScoreLine(ls);

  function panel(title, meta, body, open) {
    return '<details class="sc-panel"' + (open !== false ? ' open' : '') + '>' +
      '<summary>' +
        '<span class="sc-panel-title">' + title + '</span>' +
        (meta ? '<span class="sc-panel-meta">' + meta + '</span>' : '') +
        '<span class="sc-panel-chevron">▼</span>' +
      '</summary>' +
      '<div class="sc-panel-body">' + body + '</div>' +
    '</details>';
  }

  var inner = '';

  inner += panel(
    '🏏 ' + esc(ls.batting_team) + ' — Batting',
    scoreStr,
    buildBattingTable(batting, ls),
    true
  );

  var bowlingHtml = buildBowlingTable(bowling, ls);
  if (bowlingHtml) {
    inner += panel('🎳 ' + esc(ls.bowling_team) + ' — Bowling', '', bowlingHtml, true);
  }

  var fow = (batting && batting.fow) || [];
  if (fow.length) {
    var fowBody = '<div style="font-size:0.88rem;color:var(--muted);line-height:2;padding:4px 0">';
    fow.forEach(function(f) {
      fowBody += '<span style="margin-right:16px">' + f.score + '-' + f.wicket +
        ' <span style="color:var(--white)">' + esc(f.batter) + '</span> (' + fowOvers(f.overs) + ')</span>';
    });
    fowBody += '</div>';
    inner += panel('Fall of Wickets', '', fowBody, false);
  }

  // Outer innings wrapper panel
  return '<details class="sc-innings-panel"' + (defaultOpen !== false ? ' open' : '') + '>' +
    '<summary>' +
      '<span class="sc-innings-label">' + esc(label) + '</span>' +
      '<span class="sc-innings-score">' + scoreStr + '</span>' +
      '<span class="sc-panel-chevron">▼</span>' +
    '</summary>' +
    '<div class="sc-innings-body">' + inner + '</div>' +
  '</details>';
}

function buildBallsPane(overHistory, batting, label) {
  if (!overHistory || !overHistory.length) {
    return '<div style="text-align:center;padding:40px 0;color:var(--muted);font-size:0.9rem">No ball-by-ball data for ' + esc(label) + '</div>';
  }

  function autoCommentarySC(ball, bowler, striker) {
    var bow = bowler || 'Bowler'; var bat = striker || 'Batter';
    var runs = ball.runs || 0; var disp = ball.displayRuns !== undefined ? ball.displayRuns : runs;
    if (ball.wicket) {
      var how = ball.how || '';
      if (how === 'Bowled') return 'OUT! Bowled. ' + bow + ' finds the stumps.';
      if (how === 'Caught' || how === 'Caught & Bowled') return 'OUT! Caught.';
      if (how === 'LBW') return 'OUT! LBW.';
      if (how === 'Run Out') return 'OUT! Run out.';
      if (how === 'Stumped') return 'OUT! Stumped.';
      return 'OUT! ' + (how || 'Wicket');
    }
    if (ball.extra === 'wide') return 'Wide.';
    if (ball.extra === 'noball') return disp > 0 ? 'No-ball. ' + disp + ' run' + (disp > 1 ? 's' : '') + ' off bat. Free hit.' : 'No-ball. Free hit.';
    if (ball.extra === 'bye')    return disp + ' bye' + (disp > 1 ? 's' : '') + '.';
    if (ball.extra === 'legbye') return disp + ' leg-bye' + (disp > 1 ? 's' : '') + '.';
    if (runs === 0) return 'Dot ball.'; if (runs === 1) return 'Single.';
    if (runs === 2) return 'Two runs.'; if (runs === 3) return 'Three runs.';
    if (runs === 4) return 'FOUR! Boundary.'; if (runs === 6) return 'SIX! Maximum.';
    return runs + ' runs.';
  }

  var html = '';
  var allOversRev = overHistory.slice().reverse();

  allOversRev.forEach(function(ov) {
    var bowlerName = (ov.split && ov.splitBowlers) ? ov.splitBowlers.join(' / ') : (ov.bowler || '');
    var balls = (ov.balls || []).slice().reverse();
    if (!balls.length) return;

    var ovRuns = (ov.balls || []).reduce(function(s,b){ return s+(b.runs||0); }, 0);
    var ovWkts = (ov.balls || []).filter(function(b){ return b.wicket; }).length;
    var ovSummary = 'End of over ' + ov.over
      + (bowlerName ? ' — ' + bowlerName : '')
      + ' — ' + ovRuns + ' run' + (ovRuns !== 1 ? 's' : '')
      + (ovWkts ? ', ' + ovWkts + ' wkt' + (ovWkts > 1 ? 's' : '') : '');

    var chipsHtml = '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px">';
    (ov.balls || []).forEach(function(b) {
      var lbl = b.wicket?'W':b.extra==='wide'?'Wd':b.extra==='noball'?'Nb':b.extra==='bye'?'B':b.extra==='legbye'?'Lb':String(b.runs||0);
      var bg  = b.wicket?'rgba(192,48,48,0.2)':b.runs===4?'rgba(201,168,76,0.15)':b.runs===6?'rgba(201,168,76,0.25)':b.extra?'rgba(110,115,127,0.12)':'rgba(255,255,255,0.06)';
      var col = b.wicket?'#e07070':b.runs===4||b.runs===6?'var(--gold)':b.extra?'var(--muted)':'var(--muted)';
      chipsHtml += '<div style="width:28px;height:28px;border-radius:50%;background:'+bg+';display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;color:'+col+'">'+lbl+'</div>';
    });
    chipsHtml += '</div>';

    html += '<div style="padding:10px 0 8px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:2px">';
    html +=   '<div style="font-size:0.68rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold)">▸ ' + esc(ovSummary) + '</div>';
    html +=   chipsHtml;
    html += '</div>';

    balls.forEach(function(ball, bi) {
      var ballNum = ov.over + '.' + (balls.length - bi);
      var striker = batting && batting.striker ? batting.striker.name : '';
      var thisBowler = ball.bowler || bowlerName;
      var auto = autoCommentarySC(ball, thisBowler, striker);
      var note = ball.commentary || '';
      var runs = ball.runs || 0;
      var lbl, bg, col;
      if (ball.wicket)               { lbl='W';  bg='rgba(192,48,48,0.2)';     col='#e07070'; }
      else if (ball.extra==='wide')  { lbl='Wd'; bg='rgba(110,115,127,0.12)'; col='var(--muted)'; }
      else if (ball.extra==='noball'){ lbl='Nb'; bg='rgba(110,115,127,0.12)'; col='var(--muted)'; }
      else if (ball.extra==='bye')   { lbl='B';  bg='rgba(110,115,127,0.12)'; col='var(--muted)'; }
      else if (ball.extra==='legbye'){ lbl='Lb'; bg='rgba(110,115,127,0.12)'; col='var(--muted)'; }
      else if (runs===4)             { lbl='4';  bg='rgba(201,168,76,0.15)';  col='var(--gold)'; }
      else if (runs===6)             { lbl='6';  bg='rgba(201,168,76,0.25)';  col='var(--gold2)'; }
      else                           { lbl=String(runs); bg='rgba(255,255,255,0.06)'; col='var(--muted)'; }
      html += '<div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04)">';
      html +=   '<div style="font-size:0.72rem;color:var(--muted);min-width:30px;padding-top:3px">' + ballNum + '</div>';
      html +=   '<div style="width:32px;height:32px;border-radius:50%;flex-shrink:0;background:' + bg + ';display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;color:' + col + '">' + lbl + '</div>';
      html +=   '<div style="flex:1;min-width:0">';
      if (thisBowler) html += '<div style="font-size:0.82rem;font-weight:600;color:var(--white);margin-bottom:2px">' + esc(thisBowler) + (striker ? ' to ' + esc(striker) : '') + '</div>';
      html +=     '<div style="font-size:0.78rem;color:var(--muted)">' + esc(auto) + '</div>';
      if (note) html += '<div style="font-size:0.73rem;color:rgba(201,168,76,0.7);font-style:italic;margin-top:2px">' + esc(note) + '</div>';
      html +=   '</div>';
      html += '</div>';
    });
  });

  return html;
}

async function load() {
  var params    = new URLSearchParams(window.location.search);
  var fixtureId = params.get('fixture_id');
  var content   = document.getElementById('content');

  if (!fixtureId) {
    content.innerHTML = '<div class="state-error"><div class="state-icon">❌</div><div class="state-title">No Fixture</div><div class="state-sub">No fixture_id specified in URL.</div></div>';
    return;
  }

  try {
    var [lsRes, fxRes] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/live_scores?select=*,over_history,current_over_balls&fixture_id=eq.' + fixtureId + '&status=eq.completed&order=created_at.desc&limit=1', { headers: H }),
      fetch(SUPABASE_URL + '/rest/v1/fixtures?select=*&id=eq.' + fixtureId, { headers: H })
    ]);

    var lsData = await lsRes.json();
    var fxData = await fxRes.json();
    var ls     = lsData[0];
    var fx     = fxData[0];

    if (!ls) {
      content.innerHTML = '<div class="state-error"><div class="state-icon">🏏</div><div class="state-title">Scorecard Not Available</div><div class="state-sub">No completed scorecard found for this fixture.</div></div>';
      return;
    }

    // Parse player state
    var batting    = {}, bowling    = {};
    var fi_batting = {}, fi_bowling = {};
    var fi_score   = null;
    try { batting    = JSON.parse(ls.batting_state         || '{}'); } catch(e) {}
    try { bowling    = JSON.parse(ls.bowling_state         || '{}'); } catch(e) {}
    try { fi_batting = JSON.parse(ls.first_innings_batting || '{}'); } catch(e) {}
    try { fi_bowling = JSON.parse(ls.first_innings_bowling || '{}'); } catch(e) {}
    try { fi_score   = JSON.parse(ls.first_innings_score   || '{}'); } catch(e) {}

    var hasFirstInn = fi_score && fi_score.runs !== undefined;

    // Build match title
    document.title = (fx ? fx.team + ' vs ' + fx.opponent : ls.batting_team + ' vs ' + ls.bowling_team) + ' — Scorecard';

    var rClass = resultClass(ls.result);
    var html   = '';

    html += '<div class="match-title">';
    if (fx) {
      html += '<div class="match-versus">' + esc(fx.team) + '<em>vs</em>' + esc(fx.opponent || 'Opponents') + '</div>';
      html += '<div class="match-meta">';
      if (fx.date)     html += '<span>📅 ' + new Date(fx.date).toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) + '</span>';
      if (fx.venue)    html += '<span>📍 ' + esc(fx.venue) + '</span>';
      if (fx.division) html += '<span>🏆 ' + esc(fx.division) + '</span>';
      html += '</div>';
    } else {
      html += '<div class="match-versus">' + esc(ls.batting_team) + '<em>vs</em>' + esc(ls.bowling_team) + '</div>';
    }
    if (ls.result) html += '<div class="match-result ' + rClass + '">' + esc(ls.result) + '</div>';
    // Player of the match — picked by the scorer, stored with the lineup
    var potm = null;
    try { var lu = JSON.parse(ls.lineup_state || '{}'); potm = lu && lu.potm && lu.potm.name ? lu.potm : null; } catch(e) {}
    if (potm) {
      var potmTeam = potm.side === 'tcc' ? (fx ? fx.team : 'TCC') : potm.side === 'opp' ? (fx ? fx.opponent : '') : '';
      html += '<div class="match-potm" style="margin-top:10px;display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;justify-content:center;' +
              'padding:8px 14px;border-radius:8px;background:rgba(201,162,39,0.12);border:1px solid rgba(201,162,39,0.45)">' +
              '<span style="font-size:0.68rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#b8922a">\ud83c\udfc5 Player of the match</span>' +
              '<strong>' + esc(potm.name) + '</strong>' +
              (potmTeam || potm.note ? '<span style="opacity:0.75;font-size:0.85em">' + esc([potmTeam, potm.note].filter(Boolean).join(' \u00b7 ')) + '</span>' : '') +
              '</div>';
    }
    html += '</div>';

    // Innings
    if (hasFirstInn) {
      var fi_ls = {
        batting_team:   ls.bowling_team,
        bowling_team:   ls.batting_team,
        runs:           fi_score.runs,
        wickets:        fi_score.wickets,
        overs:          fi_score.overs,
        balls:          fi_score.balls,
        extras_wides:   fi_score.extras ? fi_score.extras.wides   : 0,
        extras_noballs: fi_score.extras ? fi_score.extras.noballs : 0,
        extras_byes:    fi_score.extras ? fi_score.extras.byes    : 0,
        extras_legbyes: fi_score.extras ? fi_score.extras.legbyes : 0,
        extras_penalty: fi_score.extras ? (fi_score.extras.penalty || 0) : 0,
        target:         null,
        // Without these the 1st innings of a 100-ball match rendered as overs
        format:         ls.format,
        total_balls:    ls.total_balls,
      };
      html += buildInnings('1st Innings', fi_ls, fi_batting, fi_bowling, false);
      html += buildInnings('2nd Innings', ls, batting, bowling, true);
    } else {
      html += buildInnings('Innings', ls, batting, bowling, true);
    }

    // Build balls tab
    var overHistory2 = [], currentOvBalls = [];
    try { overHistory2   = JSON.parse(ls.over_history       || '[]'); } catch(e2) {}
    try { currentOvBalls = JSON.parse(ls.current_over_balls || '[]'); } catch(e2) {}

    // Append any in-progress over balls to 2nd innings history
    if (currentOvBalls.length) {
      overHistory2 = overHistory2.concat([{ over: (ls.overs||0)+1, balls: currentOvBalls, bowler: '', current: true }]);
    }

    // 1st innings over history piggybacked in fi_score.overHistory
    var overHistory1 = (hasFirstInn && fi_score && fi_score.overHistory) ? fi_score.overHistory : [];

    var ballsHtml;
    if (hasFirstInn && (overHistory1.length || overHistory2.length)) {
      var inn2Html = buildBallsPane(overHistory2, batting, '2nd Innings');
      var inn1Html = buildBallsPane(overHistory1, fi_batting, '1st Innings');
      var bTabStyle = 'display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:16px';
      var bTabBtn   = 'flex:1;padding:10px;background:none;border:none;border-bottom:2px solid transparent;font-family:inherit;font-size:0.75rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;transition:all 0.15s;';
      ballsHtml = '<div style="' + bTabStyle + '">'
        + '<button style="' + bTabBtn + 'color:var(--gold);border-bottom-color:var(--gold)" onclick="ballsTab(this,\'inn2\')" id="btab-inn2">2nd Innings</button>'
        + '<button style="' + bTabBtn + 'color:var(--muted)" onclick="ballsTab(this,\'inn1\')" id="btab-inn1">1st Innings</button>'
        + '</div>'
        + '<div id="bpane-inn2">' + inn2Html + '</div>'
        + '<div id="bpane-inn1" style="display:none">' + inn1Html + '</div>';
    } else {
      ballsHtml = buildBallsPane(overHistory2.length ? overHistory2 : overHistory1, batting, 'Innings');
    }

    // Top-level Scorecard / Balls tabs
    var tabStyle = 'display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:16px';
    var tabBtnBase = 'flex:1;padding:10px;background:none;border:none;border-bottom:2px solid transparent;font-family:inherit;font-size:0.75rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;transition:all 0.15s;';
    var tabFull = '<div style="' + tabStyle + '">'
      + '<button style="' + tabBtnBase + 'color:var(--gold);border-bottom-color:var(--gold)" onclick="scTab(this,\'sc\')" id="sc-tab-sc">Scorecard</button>'
      + '<button style="' + tabBtnBase + 'color:var(--muted)" onclick="scTab(this,\'balls\')" id="sc-tab-balls">Balls</button>'
      + '</div>'
      + '<div id="sc-pane-sc">' + html + '</div>'
      + '<div id="sc-pane-balls" style="display:none">' + ballsHtml + '</div>';

    content.innerHTML = tabFull;
    // Render worm chart for the scorecard page
    renderRunTimeline(overHistory1, overHistory2, hasFirstInn);
    renderManhattanPublic(overHistory1, overHistory2, hasFirstInn);

  } catch(e) {
    content.innerHTML = '<div class="state-error"><div class="state-icon">⚠️</div><div class="state-title">Error Loading Scorecard</div><div class="state-sub">' + esc(e.message) + '</div></div>';
  }
}

function scTab(btn, pane) {
  ['sc','balls'].forEach(function(p) {
    document.getElementById('sc-pane-' + p).style.display = p === pane ? 'block' : 'none';
    var b = document.getElementById('sc-tab-' + p);
    if (b) { b.style.color = p === pane ? 'var(--gold)' : 'var(--muted)'; b.style.borderBottomColor = p === pane ? 'var(--gold)' : 'transparent'; }
  });
}

function ballsTab(btn, pane) {
  ['inn1','inn2'].forEach(function(p) {
    var el = document.getElementById('bpane-' + p);
    var b  = document.getElementById('btab-' + p);
    if (el) el.style.display = p === pane ? 'block' : 'none';
    if (b)  { b.style.color = p === pane ? 'var(--gold)' : 'var(--muted)'; b.style.borderBottomColor = p === pane ? 'var(--gold)' : 'transparent'; }
  });
}

function renderRunTimeline(overHistory1, overHistory2, hasBothInn) {
  var wrap   = document.getElementById('sc-chart-wrap');
  var canvas = document.getElementById('sc-run-timeline');
  var legend = document.getElementById('sc-chart-legend');
  if (!wrap || !canvas) return;

  var h1 = overHistory1 || [];
  var h2 = overHistory2 || [];
  if (!h1.length && !h2.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  var W = canvas.offsetWidth || 340;
  var H = 100;
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  var padL=28, padR=8, padT=8, padB=18;
  var cW=W-padL-padR, cH=H-padT-padB;

  function cum(hist) {
    var a=[0]; hist.forEach(function(ov){ a.push(a[a.length-1]+(ov.runs||0)); }); return a;
  }

  var c1=h1.length?cum(h1):[], c2=h2.length?cum(h2):[];
  var maxV=Math.max(c1.length?c1[c1.length-1]:0, c2.length?c2[c2.length-1]:0, 1);
  maxV=Math.ceil(maxV*1.1);
  var maxO=Math.max(h1.length, h2.length, 1);

  var mc='rgba(255,255,255,0.06)', tc='rgba(255,255,255,0.28)';
  [0, Math.round(maxV/2), maxV].forEach(function(v){
    var y=padT+cH-(v/maxV)*cH;
    ctx.strokeStyle=mc; ctx.lineWidth=0.5;
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(W-padR,y); ctx.stroke();
    ctx.fillStyle=tc; ctx.font='9px sans-serif'; ctx.textAlign='right';
    ctx.fillText(v, padL-3, y+3);
  });

  function drawLine(cums, color, dashed) {
    if (cums.length<2) return;
    ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.lineJoin='round';
    ctx.setLineDash(dashed?[5,3]:[]);
    ctx.beginPath();
    cums.forEach(function(v,i){
      var x=padL+(i/maxO)*cW, y=padT+cH-(v/maxV)*cH;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke(); ctx.setLineDash([]);
    var lx=padL+((cums.length-1)/maxO)*cW;
    var ly=padT+cH-(cums[cums.length-1]/maxV)*cH;
    ctx.fillStyle=color; ctx.beginPath(); ctx.arc(lx,ly,4,0,Math.PI*2); ctx.fill();
    // Score label at end
    ctx.fillStyle=color; ctx.font='bold 10px sans-serif'; ctx.textAlign='left';
    ctx.fillText(cums[cums.length-1], lx+7, ly+4);
  }

  if (c1.length) drawLine(c1, 'rgba(201,168,76,0.9)', hasBothInn && !!c2.length);
  if (c2.length) drawLine(c2, 'rgba(74,144,217,0.95)', false);

  // X-axis
  ctx.fillStyle=tc; ctx.font='8px sans-serif'; ctx.textAlign='center';
  for(var i=0;i<=maxO;i++){
    if(i===0||i%5===0||i===maxO){
      ctx.fillText(i, padL+(i/maxO)*cW, H-3);
    }
  }

  // Legend
  if (legend) {
    legend.innerHTML = '';
    if (c1.length) {
      legend.innerHTML += '<span style="color:rgba(201,168,76,0.9);font-weight:700">— 1st Innings</span>';
    }
    if (c2.length) {
      legend.innerHTML += '<span style="color:rgba(74,144,217,0.95);font-weight:700">— 2nd Innings</span>';
    }
  }
}

load();

/* ══════════════════════════════════════════════════════
   MANHATTAN CHART — public scorecard page
   Renders one canvas per innings side-by-side or stacked.
   Gold bars = 1st innings, Blue bars = 2nd innings.
══════════════════════════════════════════════════════ */
function renderManhattanPublic(overHistory1, overHistory2, hasBothInn) {
  var wrap    = document.getElementById('sc-manhattan-wrap');
  var canvas1 = document.getElementById('sc-manhattan-1');
  var canvas2 = document.getElementById('sc-manhattan-2');
  var wrap2   = document.getElementById('sc-manhattan-2-wrap');
  var legend  = document.getElementById('sc-manhattan-legend');
  if (!wrap || !canvas1) return;

  var h1 = overHistory1 || [];
  var h2 = overHistory2 || [];
  if (!h1.length && !h2.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  function drawBars(canvas, history, color) {
    if (!history.length) return;
    var W = canvas.offsetWidth || 340;
    var H = 90;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    var maxRuns = Math.max.apply(null, history.map(function(o) { return o.runs || 0; }));
    maxRuns = Math.max(maxRuns, 6);

    var padL = 22, padR = 4, padT = 4, padB = 16;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;
    var n      = history.length;
    var barW   = Math.max(2, chartW / n - 2);
    var gap    = (chartW - barW * n) / (n + 1);

    var mutedC = 'rgba(255,255,255,0.1)';
    var textC  = 'rgba(255,255,255,0.35)';

    // Y gridlines
    [0, Math.round(maxRuns / 2), maxRuns].forEach(function(v) {
      var y = padT + chartH - (v / maxRuns) * chartH;
      ctx.strokeStyle = mutedC; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillStyle = textC; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(v, padL - 3, y + 3);
    });

    // Bars
    history.forEach(function(ov, i) {
      var runs = ov.runs || 0;
      var x    = padL + gap + i * (barW + gap);
      var barH = (runs / maxRuns) * chartH;
      var y    = padT + chartH - barH;

      ctx.fillStyle = color.replace('1)', (ov.wickets ? '1)' : '0.75)'));
      if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(x, y, barW, Math.max(barH, 1), [2,2,0,0]); ctx.fill();
      } else {
        ctx.fillRect(x, y, barW, Math.max(barH, 1));
      }

      if (barH > 12) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(runs, x + barW / 2, y + 10);
      }

      if (ov.wickets) {
        ctx.fillStyle = '#E53935';
        ctx.beginPath(); ctx.arc(x + barW / 2, padT + chartH - barH - 5, 3, 0, Math.PI * 2); ctx.fill();
      }

      if (n <= 30 || i % 5 === 0 || i === n - 1) {
        ctx.fillStyle = textC; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(ov.over || i + 1, x + barW / 2, H - 3);
      }
    });
  }

  // Build legend
  if (legend) {
    legend.innerHTML = '';
    if (h1.length) legend.innerHTML += '<span style="color:rgba(201,168,76,0.95);font-weight:700">■ 1st Innings</span>';
    if (h2.length) legend.innerHTML += '<span style="color:rgba(74,144,217,0.95);font-weight:700">■ 2nd Innings</span>';
  }

  drawBars(canvas1, h1.length ? h1 : h2, h1.length ? 'rgba(201,168,76,1)' : 'rgba(74,144,217,1)');

  if (hasBothInn && h1.length && h2.length) {
    wrap2.style.display = 'block';
    drawBars(canvas2, h2, 'rgba(74,144,217,1)');
  } else {
    wrap2.style.display = 'none';
  }
}
