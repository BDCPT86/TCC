/* ══════════════════════════════════════════════════════════════════
   TCC FANTASY — SCORING
   The one client-side implementation. Load it before any page script
   that needs a points figure:

     <script src="js/fantasy-scoring.js?v=1"></script>

   ──────────────────────────────────────────────────────────────────
   There were seven copies of this arithmetic, and no two agreed:

     leaderboard.js  calcPoints      chips, no round boost
     leaderboard.js  calcLivePts     round boost, no chips
     leaderboard.js  calcBreakdown   the explanation — no round boost,
                                     so it could not add up to the
                                     total it was explaining
     live-worker.js  calcPtsWorker   H2H seeding (deleted)
     live-worker.js  calcPtsResolve  H2H results (deleted)
     admin.js        _calcPts        badges — no economy, no maidens,
                                     no boosts, no chips
     live-worker.js  fantasyPickPoints   the canonical one

   A manager could watch one number on the live view, find another on
   the standings, have their head-to-head decided on a third and their
   badges on a fourth. None of that was a rule anyone chose; each gap
   was an accident of which file a feature happened to be added to.

   The rule here is the union: every feature that exists applies, every
   time. Economy and maidens count. Round boost modifiers count. Chips
   count. Nothing scores differently depending on which screen asks.

   ──────────────────────────────────────────────────────────────────
   TWO implementations remain and that is the floor: this one, for the
   browser, and fantasyPickPoints() in live-worker.js, for the server —
   which needs its own because it validates and resolves head-to-heads
   without a browser in the loop. They are kept honest by
   fantasy/scoring-audit.mjs, which runs both over the same fixtures and
   fails on any disagreement. Change one, run that, change the other.
   ══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* A score, however it arrived. The live view carries overs and runs
     conceded; a filed scorecard now does too. Both normalise to the same
     thing here, so they cannot score differently.

     OVERS IS THE SIGNAL. "Did this player bowl?" used to be answered by
     `economy > 0`, which quietly excluded the best figure there is: a
     bowler who conceded nothing has an economy of 0.00 and was scored as
     though they had never bowled — no economy points at all. It could
     not simply be honoured either, because the score template told
     people to type 0 for a player who did NOT bowl, and then not bowling
     would have earned +10.

     Overs settles it as a fact rather than an inference. Bowled, and the
     rate counts whatever it is. Did not bowl, and nothing counts.

     Rows filed before the overs column existed keep the old rule, so
     their numbers do not move. */
  function normalise(s) {
    if (!s) return null;

    var overs    = (s.overs != null && s.overs !== '') ? Number(s.overs) : null;
    var conceded = (s.runs_conceded != null && s.runs_conceded !== '') ? Number(s.runs_conceded)
                 : (s.runsBowled   != null && s.runsBowled   !== '') ? Number(s.runsBowled)
                 : null;
    var economy = null;

    if (overs != null && overs > 0) {
      /* They bowled. A rate of 0.00 is real and worth the top tier. */
      if (conceded != null)          economy = conceded / overs;
      else if (s.economy != null)    economy = Number(s.economy);
    } else if (overs == null && s.economy != null && Number(s.economy) > 0) {
      /* Legacy row: no overs recorded, so infer from the rate as before.
         A stored 0 stays ambiguous and is left out. */
      economy = Number(s.economy);
    }

    return {
      overs:           overs,
      runs_conceded:   conceded,
      runs:            Number(s.runs      || 0),
      wickets:         Number(s.wickets   || 0),
      maidens:         Number(s.maidens   || 0),
      catches:         Number(s.catches   || 0),
      stumpings:       Number(s.stumpings || 0),
      runouts:         Number(s.runouts   || 0),
      economy:         (economy != null && isFinite(economy)) ? economy : null,
      player_of_match: !!s.player_of_match
    };
  }

  /* 'rounder' rather than an exact list, so "Bowling Allrounder" counts
     as an all-rounder. The strict version silently left those players
     out of the all-rounder boost. */
  function roleBucket(role) {
    var r = String(role || '').toLowerCase().replace(/-/g, ' ').trim();
    if (r.indexOf('rounder') !== -1) return 'allrounder';
    if (r === 'bowler') return 'bowler';
    if (r === 'wicketkeeper' || r === 'batter' || r === 'batsman') return 'batter';
    return 'other';
  }

  function economyPoints(e) {
    return e <= 5 ? 10 : e <= 6 ? 6 : e <= 7 ? 2 : e <= 8 ? 0 : e <= 9 ? -2 : -4;
  }

  /* Combine several fantasy_scores rows for one player in one round.

     This lives here because the formula is only half the story. The
     season leaderboard built its own lookup carrying runs, wickets,
     catches, stumpings and player-of-the-match — and silently dropped
     maidens, run-outs and economy. calcPoints could score all three;
     the data never reached it. So the standings disagreed with the
     head-to-head on every round, not only boosted ones.

     Counting stats add up. Economy is a rate, so it cannot: where the
     rows carry overs it is recomputed from the totals, and otherwise
     the non-null figures are averaged. Either way both sides now do
     the same thing with the same rows. */
  function aggregate(rows) {
    var out = { runs: 0, wickets: 0, maidens: 0, catches: 0, stumpings: 0,
                runouts: 0, overs: null, runs_conceded: null,
                economy: null, player_of_match: false };
    var overs = 0, conceded = 0, bowled = false;
    var econSum = 0, econN = 0, any = false;

    (rows || []).forEach(function (s) {
      if (!s) return;
      any = true;
      out.runs      += Number(s.runs      || 0);
      out.wickets   += Number(s.wickets   || 0);
      out.maidens   += Number(s.maidens   || 0);
      out.catches   += Number(s.catches   || 0);
      out.stumpings += Number(s.stumpings || 0);
      out.runouts   += Number(s.runouts   || 0);
      if (s.player_of_match) out.player_of_match = true;

      var o = (s.overs != null && s.overs !== '') ? Number(s.overs) : null;
      var c = (s.runs_conceded != null && s.runs_conceded !== '') ? Number(s.runs_conceded)
            : (s.runsBowled   != null && s.runsBowled   !== '') ? Number(s.runsBowled)
            : null;
      if (o != null && o > 0) {
        bowled = true;
        overs += o;
        /* Runs conceded unknown for this spell: fall back to its rate so
           the over count still contributes honestly. */
        conceded += (c != null) ? c
                  : (s.economy != null ? Number(s.economy) * o : 0);
      } else if (o == null && s.economy != null && Number(s.economy) > 0) {
        /* Legacy row. Averaged, since there are no overs to weight by. */
        econSum += Number(s.economy); econN++;
      }
    });

    if (!any) return null;
    if (bowled) {
      out.overs         = overs;
      out.runs_conceded = conceded;
      out.economy       = conceded / overs;
    } else if (econN > 0) {
      out.economy = econSum / econN;
    }
    return out;
  }

  /* One player's points before the armband.

     `lines`, when an array, collects a plain-English itemisation as the
     total is built. The number and its explanation come out of the same
     pass on purpose — the old breakdown was computed separately and so
     could disagree with the figure it was explaining. */
  function basePoints(score, boost, role, lines) {
    var s = normalise(score);
    if (!s) return 0;
    var say = function (t) { if (lines) lines.push(t); };

    var batPts = s.runs;
    if (s.runs) say(s.runs + ' run' + (s.runs !== 1 ? 's' : '') + ' = ' + s.runs + 'pt');
    if (s.runs >= 100)     { batPts += 35; say('Century bonus = +35pt'); }
    else if (s.runs >= 50) { batPts += 10; say('50+ bonus = +10pt'); }

    var bowlPts = s.wickets * 15;
    if (s.wickets) say(s.wickets + ' wicket' + (s.wickets !== 1 ? 's' : '') + ' = ' + (s.wickets * 15) + 'pt');
    if (s.wickets >= 5) { bowlPts += 20; say('5-wicket haul = +20pt'); }

    var econPts = 0;
    if (s.economy != null) {
      econPts = economyPoints(s.economy);
      if (boost === 'bonus_economy') econPts *= 2;
      if (econPts !== 0) {
        say('Economy ' + s.economy.toFixed(2) + ' = ' + (econPts > 0 ? '+' : '') + econPts + 'pt'
            + (boost === 'bonus_economy' ? ' (doubled this round)' : ''));
      }
    }

    var fieldPts = 0;
    function field(n, word, pts) {
      if (!n) return;
      fieldPts += n * pts;
      say(n + ' ' + word + (n !== 1 ? 's' : '') + ' = +' + (n * pts) + 'pt');
    }
    field(s.maidens,   'maiden',  10);
    field(s.catches,   'catch',   10);
    field(s.stumpings, 'stumping',10);
    field(s.runouts,   'run-out', 10);

    var potmPts = 0;
    if (s.player_of_match) {
      potmPts = boost === 'potm_double' ? 50 : 25;
      say('Player of the Match = +' + potmPts + 'pt' + (boost === 'potm_double' ? ' (doubled this round)' : ''));
    }

    var bucket = roleBucket(role);
    if (boost === 'bowlers_double' && bucket === 'bowler') {
      bowlPts *= 2; econPts *= 2;
      say('Bowlers’ round: bowling doubled');
    }
    if (boost === 'batters_double' && bucket === 'batter') {
      batPts *= 2;
      say('Batters’ round: batting doubled');
    }
    if (boost === 'allrounders_boost' && bucket === 'allrounder') {
      batPts  = Math.round(batPts  * 1.5);
      bowlPts = Math.round(bowlPts * 1.5);
      say('All-rounders’ round: batting and bowling ×1.5');
    }

    return batPts + bowlPts + econPts + fieldPts + potmPts;
  }

  /* One player's points with the armband applied.
     opts: { isCaptain, isVice, captainMultiplier, boost, role }        */
  function playerPoints(score, opts) {
    opts = opts || {};
    var pts = basePoints(score, opts.boost, opts.role);
    if (opts.isCaptain) return pts * (opts.captainMultiplier || 2);
    if (opts.isVice)    return Math.round(pts * 1.5);
    return pts;
  }

  /* The itemised version of the same thing, for the "why?" panel.
     Returns { lines, base, total }.                                    */
  function breakdown(score, opts) {
    opts = opts || {};
    var lines = [];
    var base  = basePoints(score, opts.boost, opts.role, lines);
    var total = base;
    if (opts.isCaptain) {
      var mult = opts.captainMultiplier || 2;
      total = base * mult;
      if (base !== 0) {
        lines.push('Captain ×' + mult
          + (mult === 3 && opts.tripleCaptain ? ' (Triple Captain)' : '')
          + ' = ' + total + 'pt total');
      }
    } else if (opts.isVice) {
      total = Math.round(base * 1.5);
      if (base !== 0) lines.push('Vice-Captain ×1.5 = ' + total + 'pt total');
    }
    return { lines: lines, base: base, total: total };
  }

  /* Captain Safety Net: when the chip is on and the chosen captain's
     BASE score (no multipliers, no round boost) is under 10, the
     vice-captain is promoted and the old captain reverts to ×1. */
  function resolveCaptaincy(pick, baseOf) {
    var capId = pick && pick.captain_id;
    var vcId  = pick && pick.vice_captain_id;
    var triggered = false;
    if (pick && pick.chip === 'captain_safety' && capId && vcId) {
      if (baseOf(capId) < 10) { capId = vcId; vcId = null; triggered = true; }
    }
    return { capId: capId, vcId: vcId, safetyTriggered: triggered };
  }

  /* A whole pick: eleven players, the armbands, and the chips.
       pick    — { player_ids, captain_id, vice_captain_id, chip }
       scoreOf — playerId → a score object (or null)
       opts    — { wildcard, boost, roleOf }                            */
  function pickPoints(pick, scoreOf, opts) {
    opts = opts || {};
    var roleOf = opts.roleOf || function () { return ''; };
    var chip   = (pick && pick.chip) || null;

    var eff = resolveCaptaincy(pick || {}, function (id) {
      return basePoints(scoreOf(id), null, '');
    });
    var captainMultiplier = (opts.wildcard || chip === 'triple_captain') ? 3 : 2;

    var total = 0;
    ((pick && pick.player_ids) || []).forEach(function (id) {
      var score = scoreOf(id);
      if (!score) return;
      total += playerPoints(score, {
        isCaptain: id === eff.capId,
        isVice:    id === eff.vcId,
        captainMultiplier: captainMultiplier,
        boost: opts.boost || null,
        role:  roleOf(id)
      });
    });

    if (chip === 'bench_boost') total += 25;
    return total;
  }

  root.FantasyScoring = {
    aggregate:         aggregate,
    normalise:         normalise,
    roleBucket:        roleBucket,
    basePoints:        basePoints,
    playerPoints:      playerPoints,
    breakdown:         breakdown,
    resolveCaptaincy:  resolveCaptaincy,
    pickPoints:        pickPoints
  };
})(typeof window !== 'undefined' ? window : this);

/* Node can require this too, so the parity test runs the real file
   rather than a copy of it. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : this).FantasyScoring;
}
