/* ══════════════════════════════════════════════════════
   TCC Fantasy League — Badge Engine
   Computes earned + in-progress badges for a participant
   from their picks, scores, leaderboard positions and H2H.

   Usage:
     var result = computeBadges(participantId, allData);
     // result.earned   = [{id, name, icon, color, desc}, ...]
     // result.progress = [{...current, target, detail}, ...]
     // result.locked   = [{id, name, icon, color, desc}, ...]

   allData shape:
     allPicks        all fantasy_picks rows
     allScores       all fantasy_scores rows (RAW — several rows for one
                     player in one round is normal and is handled here)
     allRounds       {round_id: {id, name, wildcard, boost_modifier}}
     allPlayers      [{id, name, role, fantasy_value}]
     ranked          [{participantId, roundPts:{round_id:pts}}] sorted by season total
     existingBadges  [{badge_id, round_id}] already in DB for this participant
     allH2HFixtures  [{participant_a, participant_b, winner_id, round_id, resolved}]

   Add new badges in BADGE_DEFS only — no other files need changing.

   ── WHY THIS FILE CHANGED ──────────────────────────────

   It used to call a global calcPoints(score, isCaptain, isWildcard,
   isVC) that it did not define and did not ship. Whatever the host page
   happened to have on window decided what a badge was worth:

     leaderboard.html   leaderboard.js's calcPoints  — the real formula
     badges.html        a local copy in a <script>   — missing overs,
                                                       boosts and chips
     admin.html         NOTHING

   In the admin there is no calcPoints at all, so the first thing
   computeBadges does — building the player-of-the-round map, which
   calls it outside any try/catch — threw a ReferenceError and took the
   whole call with it. The admin is the only place that WRITES badges,
   via computeAndNotifyBadges after a score save. So no badge has ever
   been written and no badge push has ever been sent, which is exactly
   what the database shows: fantasy_badges, 0 rows.

   It now takes its arithmetic from js/fantasy-scoring.js like every
   other surface, so a badge means the same thing wherever it is worked
   out, and it no longer depends on what the host page left lying
   around. Three consequences worth knowing:

     · Several score rows for one player in one round (two match days)
       are aggregated before scoring, instead of the second row
       overwriting the first. A 30 and a 25 is a fifty, with the bonus.
     · A round's boost modifier and the player's role now apply, so a
       player's badge-facing score equals their leaderboard score.
     · "Wicketkeeper-Batter" counts as a keeper. It used to fall through
       to 'bat', so the All-Rounder badge could never see a keeper in a
       side whose keeper bats.

   The badge definitions themselves are untouched. Nothing about what
   earns a badge has changed — only whether the number it is judged on
   is the same number the rest of the site shows.
══════════════════════════════════════════════════════ */

var BADGE_DEFS = [

  /* ── Season / streak ────────────────────────────────── */

  {
    id:    'hot_streak',
    name:  'Hot Streak',
    icon:  '🔥',
    color: 'gold',
    desc:  'Score above the season average in 5 consecutive rounds',
    check: function(d) {
      var avg = d.seasonAvg;
      var rounds = d.myRoundPts;
      if (!rounds.length) return { state: 'locked' };
      var best = 0, cur = 0;
      rounds.forEach(function(pts) {
        if (pts > avg) { cur++; best = Math.max(best, cur); }
        else cur = 0;
      });
      if (best >= 5) return { state: 'earned' };
      return { state: 'progress', current: Math.max(best, cur), target: 5,
               detail: 'Best run: ' + best + ' rounds above avg' };
    }
  },

  {
    id:    'season_survivor',
    name:  'Season Survivor',
    icon:  '🦁',
    color: 'muted',
    desc:  'Submit a team in every round of the season without missing one',
    check: function(d) {
      var total  = d.totalRounds;
      /* Picks the manager actually submitted. A round the lock job
         carried forward for them is a row in fantasy_picks like any
         other, and counting it would hand this badge to everyone who
         ever entered once — which is the opposite of what it is for.
         auto_carried is only ever set by carryForwardRound in the
         Worker; a human submission cannot set it. */
      var played = d.myPicks.filter(function(p) {
        return !(p && p.auto_carried);
      }).length;
      if (!total) return { state: 'locked' };
      if (played >= total) return { state: 'earned' };
      return { state: 'progress', current: played, target: total,
               detail: played + ' of ' + total + ' rounds entered' };
    }
  },

  {
    id:    'comeback_kid',
    name:  'Comeback Kid',
    icon:  '📈',
    color: 'green',
    desc:  'Finish the season in the top 3 after being in the bottom half at any earlier point',
    check: function(d) {
      var totalParticipants = d.ranked.length;
      if (totalParticipants < 4 || d.myPositions.length < 2) return { state: 'locked' };
      var midpoint = Math.ceil(totalParticipants / 2);
      var currentSeasonRank = d.ranked.findIndex(function(r) {
        return r.participantId === d.participantId;
      }) + 1;
      // Check if at any earlier round (not the current last) we were in the bottom half
      var wasBottomHalf = false;
      d.myPositions.slice(0, -1).forEach(function(pos) {
        if (pos.position > midpoint) wasBottomHalf = true;
      });
      if (wasBottomHalf && currentSeasonRank >= 1 && currentSeasonRank <= 3) return { state: 'earned' };
      if (wasBottomHalf) return {
        state: 'progress', current: currentSeasonRank, target: 3,
        detail: 'Currently ranked ' + currentSeasonRank + ' — reach top 3'
      };
      return { state: 'locked' };
    }
  },

  /* ── Podium / positions ─────────────────────────────── */

  {
    id:    'podium_hat_trick',
    name:  'Podium Hat-Trick',
    icon:  '🏆',
    color: 'gold',
    desc:  'Finish in the top 3 in 3 consecutive rounds',
    check: function(d) {
      var positions = d.myPositions;
      if (!positions.length) return { state: 'locked' };
      var best = 0, cur = 0;
      positions.forEach(function(p) {
        if (p.position <= 3) { cur++; best = Math.max(best, cur); }
        else cur = 0;
      });
      if (best >= 3) return { state: 'earned' };
      return { state: 'progress', current: Math.max(best, cur), target: 3,
               detail: Math.max(best, cur) + ' consecutive podiums' };
    }
  },

  {
    id:    'wildcard_winner',
    name:  'Wildcard Winner',
    icon:  '🌟',
    color: 'gold',
    desc:  'Finish in the top 3 in a Wildcard round (captain scores ×3)',
    check: function(d) {
      var wildcardRoundIds = Object.keys(d.allRounds).filter(function(rid) {
        return d.allRounds[rid].wildcard;
      });
      if (!wildcardRoundIds.length) return { state: 'locked' };
      var bestPos = 999;
      var found   = false;
      wildcardRoundIds.forEach(function(rid) {
        var pos = d.myPositions.find(function(p) { return p.round_id === rid; });
        if (pos) {
          bestPos = Math.min(bestPos, pos.position);
          if (pos.position <= 3) found = true;
        }
      });
      if (found) return { state: 'earned' };
      if (bestPos < 999) return { state: 'progress', current: bestPos, target: 3,
                                   detail: 'Best wildcard finish: ' + bestPos };
      return { state: 'locked' };
    }
  },

  /* ── Captaincy ──────────────────────────────────────── */

  {
    id:    'century_captain',
    name:  'Century Captain',
    icon:  '⭐',
    color: 'red',
    desc:  'Your captain scores 100+ fantasy points in a single round',
    check: function(d) {
      var best = 0;
      d.myPicks.forEach(function(pick) {
        var capPts = d.getPlayerRoundPts(pick.captain_id, pick.round_id);
        if (capPts !== null) best = Math.max(best, capPts);
      });
      if (best >= 100) return { state: 'earned' };
      return { state: 'progress', current: best, target: 100,
               detail: 'Best captain: ' + best + 'pt — need 100' };
    }
  },

  /* ── Picks ──────────────────────────────────────────── */

  {
    id:    'sharp_eye',
    name:  'Sharp Eye',
    icon:  '🎯',
    color: 'blue',
    desc:  'Pick the Player of the Round 3 times across the season',
    check: function(d) {
      var count = 0;
      d.myPicks.forEach(function(pick) {
        var potr = d.getPotrId(pick.round_id);
        if (potr && (pick.player_ids || []).indexOf(potr) !== -1) count++;
      });
      if (count >= 3) return { state: 'earned' };
      return { state: 'progress', current: count, target: 3,
               detail: 'Picked POTR ' + count + ' time' + (count !== 1 ? 's' : '') };
    }
  },

  {
    id:    'diamond_pick',
    name:  'Diamond Pick',
    icon:  '💎',
    color: 'green',
    desc:  'Pick a player who scores 100+ fantasy points in a single round',
    check: function(d) {
      var found = false;
      var best  = 0;
      d.myPicks.forEach(function(pick) {
        (pick.player_ids || []).forEach(function(pid) {
          var pts = d.getPlayerRoundPts(pid, pick.round_id);
          if (pts !== null) {
            best = Math.max(best, pts);
            if (pts >= 100) found = true;
          }
        });
      });
      if (found) return { state: 'earned' };
      return { state: 'progress', current: best, target: 100,
               detail: 'Best player in your squad: ' + best + 'pt' };
    }
  },

  {
    id:    'clean_sheet',
    name:  'Clean Sheet',
    icon:  '✨',
    color: 'blue',
    desc:  'Every player in your XI scores at least 1 point in the same round',
    check: function(d) {
      var found     = false;
      var bestCount = 0;
      d.myPicks.forEach(function(pick) {
        if (!pick.player_ids || pick.player_ids.length < 11) return;
        var scored = 0, positive = 0;
        pick.player_ids.forEach(function(pid) {
          var pts = d.getPlayerRoundPts(pid, pick.round_id);
          if (pts !== null) { scored++; if (pts > 0) positive++; }
        });
        // Only count rounds where all 11 players had scores entered
        if (scored === 11) {
          bestCount = Math.max(bestCount, positive);
          if (positive === 11) found = true;
        }
      });
      if (found) return { state: 'earned' };
      if (bestCount === 0) return { state: 'locked' };
      return { state: 'progress', current: bestCount, target: 11,
               detail: 'Best round: ' + bestCount + ' of 11 scored' };
    }
  },

  {
    id:    'value_hunter',
    name:  'Value Hunter',
    icon:  '💡',
    color: 'green',
    desc:  'Win a round with an average player value of R8 or less in your XI',
    check: function(d) {
      var found = false;
      d.myPicks.forEach(function(pick) {
        if (!pick.player_ids || pick.player_ids.length < 11) return;
        // Must have won the round
        var pos = d.myPositions.find(function(p) { return p.round_id === pick.round_id; });
        if (!pos || pos.position !== 1) return;
        var totalVal = 0, count = 0;
        pick.player_ids.forEach(function(pid) {
          var val = d.getPlayerValue(pid);
          if (val) { totalVal += val; count++; }
        });
        if (count > 0 && (totalVal / count) <= 8) found = true;
      });
      if (found) return { state: 'earned' };
      // Progress: best (lowest) avg value seen in any pick
      var bestAvg = null;
      d.myPicks.forEach(function(pick) {
        if (!pick.player_ids) return;
        var totalVal = 0, count = 0;
        pick.player_ids.forEach(function(pid) {
          var val = d.getPlayerValue(pid);
          if (val) { totalVal += val; count++; }
        });
        if (count > 0) {
          var avg = parseFloat((totalVal / count).toFixed(1));
          if (bestAvg === null || avg < bestAvg) bestAvg = avg;
        }
      });
      if (bestAvg === null) return { state: 'locked' };
      return { state: 'progress', current: bestAvg, target: 8,
               detail: 'Lowest squad avg: R' + bestAvg + ' — win a round to unlock' };
    }
  },

  /* ── Round performance ──────────────────────────────── */

  {
    id:    'boom_round',
    name:  'Boom Round',
    icon:  '💥',
    color: 'red',
    desc:  'Score 300 or more points in a single round',
    check: function(d) {
      var best = d.myRoundPts.length ? Math.max.apply(null, d.myRoundPts) : 0;
      if (best >= 300) return { state: 'earned' };
      if (!d.myRoundPts.length) return { state: 'locked' };
      return { state: 'progress', current: best, target: 300,
               detail: 'Best round: ' + best + 'pt' };
    }
  },

  {
    id:    'all_rounder_round',
    name:  'All-Rounder',
    icon:  '⚡',
    color: 'blue',
    desc:  'Have a player from all 4 roles (Bat/Bowl/AR/WK) score 20+ pts in the same round',
    check: function(d) {
      var found = false;
      var bestRolesCount = 0;
      d.myPicks.forEach(function(pick) {
        var roles = { bat: false, bowl: false, ar: false, wk: false };
        (pick.player_ids || []).forEach(function(pid) {
          var pts  = d.getPlayerRoundPts(pid, pick.round_id);
          var role = d.getPlayerRole(pid);
          if (pts >= 20 && role) roles[role] = true;
        });
        var count = Object.values(roles).filter(Boolean).length;
        bestRolesCount = Math.max(bestRolesCount, count);
        if (count === 4) found = true;
      });
      if (found) return { state: 'earned' };
      return { state: 'progress', current: bestRolesCount, target: 4,
               detail: 'Best round: ' + bestRolesCount + ' of 4 roles scored 20+' };
    }
  },

  {
    id:    'wicket_machine',
    name:  'Wicket Machine',
    icon:  '🏏',
    color: 'green',
    desc:  'Have 3 or more bowlers take wickets in the same round',
    check: function(d) {
      var best = 0;
      d.myPicks.forEach(function(pick) {
        var bowlersWithWickets = 0;
        (pick.player_ids || []).forEach(function(pid) {
          var score = d.getRawScore(pid, pick.round_id);
          var role  = d.getPlayerRole(pid);
          if (score && (score.wickets || 0) > 0 && (role === 'bowl' || role === 'ar')) {
            bowlersWithWickets++;
          }
        });
        best = Math.max(best, bowlersWithWickets);
      });
      if (best >= 3) return { state: 'earned' };
      return { state: 'progress', current: best, target: 3,
               detail: 'Best round: ' + best + ' bowlers took wickets' };
    }
  },

  /* ── Head to Head ───────────────────────────────────── */

  {
    id:    'h2h_warrior',
    name:  'H2H Warrior',
    icon:  '⚔️',
    color: 'blue',
    desc:  'Win 3 Head-to-Head fixtures across the season',
    check: function(d) {
      if (!d.myH2HFixtures.length) return { state: 'locked' };
      var wins = d.myH2HFixtures.filter(function(f) {
        return f.resolved && f.winner_id === d.participantId;
      }).length;
      if (wins >= 3) return { state: 'earned' };
      return { state: 'progress', current: wins, target: 3,
               detail: wins + ' H2H win' + (wins !== 1 ? 's' : '') + ' so far' };
    }
  },

  {
    id:    'giant_killer',
    name:  'Giant Killer',
    icon:  '🗡️',
    color: 'red',
    desc:  'Win a Head-to-Head fixture against someone ranked above you',
    check: function(d) {
      if (!d.myH2HFixtures.length) return { state: 'locked' };
      var myRank = d.ranked.findIndex(function(r) {
        return r.participantId === d.participantId;
      }) + 1;
      var found = false;
      d.myH2HFixtures.forEach(function(f) {
        if (!f.resolved || f.winner_id !== d.participantId) return;
        var oppId   = f.participant_a === d.participantId ? f.participant_b : f.participant_a;
        var oppRank = d.ranked.findIndex(function(r) { return r.participantId === oppId; }) + 1;
        if (oppRank > 0 && oppRank < myRank) found = true;
      });
      if (found) return { state: 'earned' };
      return { state: 'locked' };
    }
  },

];

/* ── Scoring ───────────────────────────────────────────────────────
   One source, js/fantasy-scoring.js, same as the leaderboard, the
   admin, the live view and the Worker. Load it before this file.    */
function badgeScoring() {
  var FS = (typeof FantasyScoring !== 'undefined' && FantasyScoring) ? FantasyScoring
         : (typeof window !== 'undefined' ? window.FantasyScoring : null);
  if (!FS) {
    /* Loudly, once. The previous version of this file failed silently
       into "every badge locked", which is indistinguishable from a
       player who has not earned anything — and that is why nobody
       noticed for a season. */
    throw new Error('fantasy-badges.js needs js/fantasy-scoring.js loaded first');
  }
  return FS;
}

/* ── Main compute function ─────────────────────────────────────── */
function computeBadges(participantId, allData) {
  var FS          = badgeScoring();
  var myPicks     = allData.allPicks.filter(function(p) { return p.participant_id === participantId; });
  var totalRounds = Object.keys(allData.allRounds).length;

  // Per-round positions for this participant
  var roundIds = Object.keys(allData.allRounds);
  var myPositions = roundIds.map(function(rid) {
    var sorted = allData.ranked.slice().sort(function(a,b) {
      return (b.roundPts[rid]||0) - (a.roundPts[rid]||0);
    });
    var pos = sorted.findIndex(function(r) { return r.participantId === participantId; });
    return { round_id: rid, position: pos + 1 };
  }).filter(function(p) { return p.position > 0; });

  var myRoundPts = myPositions.map(function(p) {
    var me = allData.ranked.find(function(r) { return r.participantId === participantId; });
    return me ? (me.roundPts[p.round_id] || 0) : 0;
  });

  // Season average across ALL participants
  var seasonAvgPts = (function() {
    if (!allData.ranked.length) return 0;
    var total = 0, count = 0;
    allData.ranked.forEach(function(r) {
      myRoundPts.forEach(function(_, ri) {
        var rid = myPositions[ri] && myPositions[ri].round_id;
        if (rid && r.roundPts[rid]) { total += r.roundPts[rid]; count++; }
      });
    });
    return count ? total / count : 0;
  })();

  /* Score lookup, AGGREGATED. A round can hold more than one match —
     two sides out on the same weekend — so a player can have several
     rows in it. Keying straight onto the row let the second innings
     overwrite the first, which quietly lost runs, wickets and the
     fifty bonus that 30 and 25 together earn. */
  var scoreRows = {};
  (allData.allScores || []).forEach(function(s) {
    var key = s.round_id + '_' + s.player_id;
    (scoreRows[key] = scoreRows[key] || []).push(s);
  });
  var scoreMap = {};
  Object.keys(scoreRows).forEach(function(key) {
    scoreMap[key] = FS.aggregate(scoreRows[key]);
  });

  // Player role + value lookup — handle both array and object map shapes
  var playerRoleMap  = {};      // 'wk' | 'ar' | 'bowl' | 'bat', for badge logic
  var playerRoleRaw  = {};      // the role as written, for the boost modifiers
  var playerValueMap = {};
  var playersArray   = Array.isArray(allData.allPlayers)
    ? allData.allPlayers
    : Object.values(allData.allPlayers || {});
  playersArray.forEach(function(p) {
    var r = (p.role||'').toLowerCase().replace(/-/g,' ').trim();
    /* Substring tests, in this order. An exact 'wicketkeeper' test sent
       "Wicketkeeper-Batter" to 'bat', so a side whose keeper bats had no
       keeper as far as the All-Rounder badge was concerned. All-rounder
       is checked first so a "Bowling Allrounder" is an all-rounder
       rather than a bowler. */
    playerRoleMap[p.id]  = r.indexOf('rounder') !== -1 ? 'ar'
                         : r.indexOf('keeper')  !== -1 ? 'wk'
                         : r.indexOf('bowl')    !== -1 ? 'bowl'
                         : 'bat';
    playerRoleRaw[p.id]  = p.role || '';
    playerValueMap[p.id] = p.fantasy_value || null;
  });

  function boostOf(roundId) {
    var r = allData.allRounds[roundId];
    return (r && r.boost_modifier) || null;
  }

  /* A player's points for a round, before any captain or vice-captain
     multiplier: the same figure the leaderboard prints next to them,
     round boost and role included. */
  function playerRoundPts(playerId, roundId) {
    var s = scoreMap[roundId + '_' + playerId];
    if (!s) return null;
    return FS.basePoints(s, boostOf(roundId), playerRoleRaw[playerId] || '');
  }

  // POTR per round — highest-scoring player across all scores in that round
  var potrMap = {};
  roundIds.forEach(function(rid) {
    var best = 0, bestId = null;
    Object.keys(scoreMap).forEach(function(key) {
      if (key.indexOf(rid + '_') !== 0) return;
      var pid = key.slice(rid.length + 1);
      var pts = playerRoundPts(pid, rid);
      if (pts !== null && pts > best) { best = pts; bestId = pid; }
    });
    potrMap[rid] = bestId;
  });

  // H2H fixtures for this participant
  var myH2HFixtures = (allData.allH2HFixtures || []).filter(function(f) {
    return f.participant_a === participantId || f.participant_b === participantId;
  });

  var ctx = {
    participantId:  participantId,
    myPicks:        myPicks,
    myRoundPts:     myRoundPts,
    myPositions:    myPositions,
    seasonAvg:      seasonAvgPts,
    totalRounds:    totalRounds,
    ranked:         allData.ranked,
    allRounds:      allData.allRounds,
    myH2HFixtures:  myH2HFixtures,
    getPlayerRoundPts: playerRoundPts,
    getRawScore: function(playerId, roundId) {
      return scoreMap[roundId + '_' + playerId] || null;
    },
    getPlayerRole: function(playerId) {
      return playerRoleMap[playerId] || null;
    },
    getPlayerValue: function(playerId) {
      return playerValueMap[playerId] || null;
    },
    getPotrId: function(roundId) {
      return potrMap[roundId] || null;
    },
  };

  var earned = [], progress = [], locked = [];
  var earnedIds = (allData.existingBadges || []).map(function(b) { return b.badge_id; });

  BADGE_DEFS.forEach(function(def) {
    var result;
    /* A badge whose own check throws is locked, and says so in the
       console. The catch is deliberately narrow — a missing scoring
       file throws above, before any of this runs, rather than being
       swallowed fifteen times over. */
    try {
      result = def.check(ctx);
    } catch(e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('badge "' + def.id + '" could not be evaluated:', e && e.message);
      }
      result = { state: 'locked' };
    }

    // If already stored as earned in DB, keep it
    if (earnedIds.indexOf(def.id) !== -1) result = { state: 'earned' };

    var item = { id: def.id, name: def.name, icon: def.icon, color: def.color, desc: def.desc };
    if (result.state === 'earned') {
      earned.push(item);
    } else if (result.state === 'progress') {
      progress.push(Object.assign({}, item, {
        current: result.current || 0,
        target:  result.target  || 1,
        detail:  result.detail  || ''
      }));
    } else {
      locked.push(item);
    }
  });

  return { earned: earned, progress: progress, locked: locked };
}

/* ── Mini badge HTML for leaderboard rows ─────────────────────── */
function renderMiniBadges(earned) {
  if (!earned.length) return '';
  return earned.map(function(b) {
    return '<span class="lb-mini-badge lb-badge-' + b.color + '" title="' + b.name + '">' + b.icon + '</span>';
  }).join('');
}

/* Node-side tests require this file directly. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BADGE_DEFS: BADGE_DEFS, computeBadges: computeBadges, renderMiniBadges: renderMiniBadges };
}
