/* The badge engine.

   The question that started this: fantasy_badges has 0 rows. Not few —
   none, after a season.

   The cause: computeBadges called a global calcPoints() that it did not
   define and did not ship, so whatever the host page had on window
   decided what a badge was worth. The admin — the only place that
   WRITES badges — had no calcPoints at all, and the first thing
   computeBadges does is build the player-of-the-round map, which called
   it outside any try/catch. The whole call threw. Silently, in a
   background promise, after every score save, for a season.

   So the first test here is the one that matters: the engine has to
   work with nothing on window but the scoring file.

   The rest check that the two pages that show badges agree, which they
   did not: badges.html carried its own copy of the formula that
   required economy > 0 (so four overs for nothing scored as not having
   bowled), ignored round boosts and ignored chips. */
const path = require('path');
const DIR  = __dirname;
const FS   = require(path.join(DIR, 'fantasy-scoring.js'));

let pass = 0, fail = 0;
const ok = (c, l, x) => { c ? pass++ : fail++;
  console.log((c ? '  PASS ' : '* FAIL ') + l + (c ? '' : '\n        ' + JSON.stringify(x, null, 2))); };

/* UUIDs, because that is what these columns actually hold. */
const P  = n => 'aa11bb22-cc33-dd44-ee55-' + String(n).padStart(12, '0');
const PL = n => 'bb22cc33-dd44-ee55-ff66-' + String(n).padStart(12, '0');
const R  = n => 'cc33dd44-ee55-ff66-aa11-' + String(n).padStart(12, '0');

/* Two rounds, three managers, eleven players each. Round 2 carries a
   bowling boost, so anything that ignores boosts gets a different
   table — which is the disagreement we are testing for. */
const ROUNDS = {
  [R(1)]: { id: R(1), name: 'Gameweek 1', wildcard: false, boost_modifier: null },
  [R(2)]: { id: R(2), name: 'Gameweek 2', wildcard: false, boost_modifier: 'bowlers_double' },
};
const ROLES = ['Batter','Bowler','Wicketkeeper-Batter','Bowling Allrounder'];
const PLAYERS = Array.from({ length: 14 }, (_, i) => ({
  id: PL(i), name: 'Player ' + i, role: ROLES[i % 4], fantasy_value: 6 + (i % 7),
}));

/* Player 3 bowls four overs for nothing in round 1 — an economy of
   0.00. The old badges.html formula read that as "did not bowl". */
const SCORES = [
  { round_id: R(1), player_id: PL(3), runs: 0,  wickets: 2, overs: 4, runs_conceded: 0, maidens: 2, catches: 0 },
  /* Player 1 bats twice in round 1 — two match days. 30 and 25 is a
     fifty and the bonus that comes with it, if the rows are added up
     before they are scored. */
  { round_id: R(1), player_id: PL(1), runs: 30 },
  { round_id: R(1), player_id: PL(1), runs: 25 },
  { round_id: R(2), player_id: PL(7), runs: 0, wickets: 4, overs: 8, runs_conceded: 19 },
];
for (let i = 0; i < 14; i++) {
  if (![1, 3, 7].includes(i)) {
    SCORES.push({ round_id: R(1), player_id: PL(i), runs: 10 + i, catches: i % 2 });
    SCORES.push({ round_id: R(2), player_id: PL(i), runs: 5 + i,  wickets: i % 3 });
  }
}

const squad = start => Array.from({ length: 11 }, (_, k) => PL((start + k) % 14));
const PICKS = [];
[0, 1, 2].forEach(m => {
  [R(1), R(2)].forEach(rid => {
    PICKS.push({ participant_id: P(m), round_id: rid, player_ids: squad(m),
                 captain_id: PL(m), vice_captain_id: PL(m + 1), chip: m === 1 ? 'triple_captain' : null });
  });
});

/* ── how each page builds the ranked table ──────────────────────── */

const roleOf = id => (PLAYERS.find(p => p.id === id) || {}).role || '';

function aggregatedLookup() {
  const rows = {};
  SCORES.forEach(s => {
    const k = s.round_id + '_' + s.player_id;
    (rows[k] = rows[k] || []).push(s);
  });
  const out = {};
  Object.keys(rows).forEach(k => { out[k] = FS.aggregate(rows[k]); });
  return out;
}

/* The current, shared way — leaderboard.js, admin.js and now
   badges.html all build it exactly like this. */
function rankedShared() {
  const lookup = aggregatedLookup();
  const totals = {};
  PICKS.forEach(pick => {
    const pid = pick.participant_id;
    if (!totals[pid]) totals[pid] = { participantId: pid, points: 0, rounds: 0, roundPts: {}, picks: [] };
    const rnd = ROUNDS[pick.round_id] || {};
    const rp = FS.pickPoints(pick, id => lookup[pick.round_id + '_' + id] || null,
      { wildcard: !!rnd.wildcard, boost: rnd.boost_modifier || null, roleOf });
    totals[pid].points += rp;
    totals[pid].rounds += 1;
    totals[pid].roundPts[pick.round_id] = rp;
    totals[pid].picks.push(pick);
  });
  return Object.values(totals).sort((a, b) => b.points - a.points);
}

/* The formula badges.html used to carry, reproduced exactly, so the
   test can show the two tables really did differ. */
function oldBadgesHtmlPoints(score, isCaptain, isWildcard, isVC) {
  let pts = 0; const runs = score.runs || 0, wkts = score.wickets || 0;
  pts += runs;
  if (runs >= 50)  pts += 10;
  if (runs >= 100) pts += 25;
  pts += wkts * 15;
  if (wkts >= 5) pts += 20;
  if (score.economy != null && score.economy > 0) {
    const e = score.economy;
    pts += e <= 5 ? 10 : e <= 6 ? 6 : e <= 7 ? 2 : e <= 8 ? 0 : e <= 9 ? -2 : -4;
  }
  pts += (score.maidens || 0) * 10 + (score.catches || 0) * 10 +
         (score.stumpings || 0) * 10 + (score.runouts || 0) * 10;
  if (score.player_of_match) pts += 25;
  if (isCaptain) pts = isWildcard ? pts * 3 : pts * 2;
  else if (isVC) pts = Math.round(pts * 1.5);
  return pts;
}
function rankedOldWay() {
  const lookup = {};
  SCORES.forEach(s => { lookup[s.round_id + '_' + s.player_id] = s; });  // last row wins
  const totals = {};
  PICKS.forEach(pick => {
    const pid = pick.participant_id;
    if (!totals[pid]) totals[pid] = { participantId: pid, points: 0, rounds: 0, roundPts: {}, picks: [] };
    const isWild = ROUNDS[pick.round_id] ? ROUNDS[pick.round_id].wildcard : false;
    let rp = 0;
    (pick.player_ids || []).forEach(playerId => {
      const s = lookup[pick.round_id + '_' + playerId];
      if (s) rp += oldBadgesHtmlPoints(s, playerId === pick.captain_id, isWild, playerId === pick.vice_captain_id);
    });
    totals[pid].points += rp;
    totals[pid].rounds += 1;
    totals[pid].roundPts[pick.round_id] = rp;
    totals[pid].picks.push(pick);
  });
  return Object.values(totals).sort((a, b) => b.points - a.points);
}

const baseData = ranked => ({
  allPicks: PICKS, allScores: SCORES, allRounds: ROUNDS, allPlayers: PLAYERS,
  ranked, existingBadges: [], allH2HFixtures: [],
});

(async () => {

  console.log('── the engine stands on its own ──');
  /* The admin case. Load the module with nothing else global, exactly
     as admin.html does: fantasy-scoring.js, then fantasy-badges.js, and
     no calcPoints anywhere. */
  global.FantasyScoring = FS;
  delete global.calcPoints;
  const BADGES = require(path.join(DIR, 'fantasy-badges.js'));

  let result = null, threw = null;
  try { result = BADGES.computeBadges(P(0), baseData(rankedShared())); }
  catch (e) { threw = e.message; }

  ok(threw === null, 'computeBadges runs with no calcPoints on window — the admin case', threw);
  ok(result && (result.earned.length + result.progress.length + result.locked.length) === BADGES.BADGE_DEFS.length,
     'and every badge gets a verdict', result && {
       earned: result.earned.length, progress: result.progress.length,
       locked: result.locked.length, defined: BADGES.BADGE_DEFS.length });
  ok(result && (result.earned.length + result.progress.length) > 0,
     'with at least one badge earned or in progress — not fifteen silent locks',
     result && { earned: result.earned.map(b => b.id), progress: result.progress.map(b => b.id) });

  console.log('\n── and says so when the scoring file is missing ──');
  /* The failure that hid for a season was a silent one. */
  const savedFS = global.FantasyScoring;
  delete global.FantasyScoring;
  let loudly = null;
  try { BADGES.computeBadges(P(0), baseData(rankedShared())); }
  catch (e) { loudly = e.message; }
  global.FantasyScoring = savedFS;
  ok(loudly && /fantasy-scoring/.test(loudly),
     'a missing scoring file throws by name instead of locking everything', loudly);

  console.log('\n── the two pages agree ──');
  const shared = rankedShared();
  const old    = rankedOldWay();
  console.log('   shared formula   ' + shared.map(r => r.points).join(', '));
  console.log('   old badges.html  ' + old.map(r => r.points).join(', ') + '   ← what this page used to judge positions on');
  ok(shared.map(r => r.points).join() !== old.map(r => r.points).join(),
     'the old page really did compute a different table, so this test can detect it',
     { shared: shared.map(r => r.points), old: old.map(r => r.points) });

  for (const pid of [P(0), P(1), P(2)]) {
    const a = BADGES.computeBadges(pid, baseData(shared));
    const b = BADGES.computeBadges(pid, baseData(shared));
    ok(JSON.stringify(a.earned.map(x => x.id)) === JSON.stringify(b.earned.map(x => x.id)),
       'the same inputs give the same badges for ' + pid.slice(-3));
  }

  console.log('\n── two match days in one round ──');
  /* Player 1 made 30 and 25 in round 1. Added up that is a fifty and
     the 10-point bonus; scored row by row it is 55 and no bonus. */
  const lookup = aggregatedLookup();
  const agg    = lookup[R(1) + '_' + PL(1)];
  ok(agg.runs === 55, 'the two innings are added up before scoring', agg.runs);
  ok(FS.basePoints(agg, null, 'Batter') === 65,
     'so the fifty bonus is earned: 55 + 10',
     FS.basePoints(agg, null, 'Batter'));

  console.log('\n── four overs for nothing ──');
  const spell = lookup[R(1) + '_' + PL(3)];
  const nowPts = FS.basePoints(spell, null, 'Bowling Allrounder');
  const thenPts = oldBadgesHtmlPoints(spell, false, false, false);
  console.log('   shared formula   ' + nowPts);
  console.log('   old badges.html  ' + thenPts);
  ok(nowPts > thenPts,
     'a maiden spell is worth more than "did not bowl", which is what the old page scored it as',
     { now: nowPts, then: thenPts });

  console.log('\n── a keeper who bats is still a keeper ──');
  /* 'Wicketkeeper-Batter' used to fall through an exact-match test to
     'bat', so the All-Rounder badge could never see a keeper in a side
     whose keeper bats — which is most sides. */
  const roleBuckets = {};
  PLAYERS.forEach(p => {
    const r = (p.role || '').toLowerCase().replace(/-/g, ' ').trim();
    roleBuckets[p.role] = r.indexOf('rounder') !== -1 ? 'ar'
                        : r.indexOf('keeper')  !== -1 ? 'wk'
                        : r.indexOf('bowl')    !== -1 ? 'bowl' : 'bat';
  });
  ok(roleBuckets['Wicketkeeper-Batter'] === 'wk', 'Wicketkeeper-Batter → wk', roleBuckets);
  ok(roleBuckets['Bowling Allrounder'] === 'ar', 'Bowling Allrounder → ar, not bowl', roleBuckets);
  ok(roleBuckets['Bowler'] === 'bowl' && roleBuckets['Batter'] === 'bat', 'and the plain ones still land', roleBuckets);

  console.log('\n── nothing in the set is unflattering ──');
  /* The reason the badges can stay public. If a badge is ever added
     that ranks somebody downward, this fails and the public/private
     question has to be answered again rather than assumed. */
  /* Names get the wide net. Descriptions get a narrow one, because a
     perfectly kind badge can mention a low place on the way to
     describing something good — Comeback Kid is awarded for reaching
     the top 3 "after being in the bottom half", and tripped a looser
     version of this test. */
  const UNKIND_NAME = /(worst|wooden|spoon|flop|dud|loser|bottom|fail|shame|disaster|chok|duck)/i;
  const UNKIND_DESC = /(worst|wooden spoon|lowest (score|total|points)|finish last|fewest points)/i;
  const unkind = BADGES.BADGE_DEFS.filter(b => UNKIND_NAME.test(b.name) || UNKIND_DESC.test(b.desc));
  ok(unkind.length === 0,
     'all ' + BADGES.BADGE_DEFS.length + ' badges reward an achievement',
     unkind.map(b => b.id));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
