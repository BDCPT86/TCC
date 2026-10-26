/* =====================================================================
   Tygerberg Last Over Hero — game.js
   Mounts entirely inside #cricket-game. One global (LOH). Never touches
   the rest of the host page. Loads last; uses LOH.{Ball,Batter,Bowler,
   Stumps,SCENE,SFX,Stats,Board,commentary,scenarioFor,crestSVG}.
   ===================================================================== */
(function (LOH) {
  "use strict";
  const S = LOH.SCENE, TAU = Math.PI * 2;

  const host = document.getElementById("cricket-game");
  if (!host) { console.warn("[Last Over Hero] #cricket-game not found."); return; }

  /* --------------------------------------------------------- build DOM */
  host.innerHTML =
    '<div class="loh-root" tabindex="0" role="application" aria-label="Last Over Hero cricket game">' +
      '<div class="loh-stage">' +
        '<canvas class="loh-canvas"></canvas>' +
        '<div class="loh-hud loh-hidden">' +
          '<div class="loh-hud-top">' +
            '<div class="loh-chase"><span class="loh-need" data-need>6</span>' +
              '<span class="loh-need-lbl">runs needed · <b data-bl>6</b> balls</span></div>' +
            '<button class="loh-mute" data-mute aria-label="Mute"><span class="loh-ico"></span></button>' +
          '</div>' +
          '<div class="loh-hud-meta">' +
            '<div class="loh-stat"><span>Score</span><b data-score>0</b></div>' +
            '<div class="loh-stat"><span>Req. rate</span><b data-rrr>0.0</b></div>' +
            '<div class="loh-pips" data-pips></div>' +
          '</div>' +
          '<div class="loh-special" data-special></div>' +
        '</div>' +
        '<div class="loh-prompt" data-prompt>Tap / Click / Space to play the ball</div>' +

        '<section class="loh-screen" data-screen="start">' +
          '<div class="loh-crest" data-crest></div>' +
          '<h1 class="loh-title">Last Over<span>Hero</span></h1>' +
          '<p class="loh-club">Tygerberg Cricket Club</p>' +
          '<p class="loh-tag">Chase the target. Six balls. Be the hero.</p>' +
          '<div class="loh-diff" data-diff>' +
            '<button data-d="club">Club Cricketer</button>' +
            '<button data-d="first">First Team</button>' +
            '<button data-d="legend">Tyger Legend</button>' +
          '</div>' +
          /* The name is asked for BEFORE the over, so every chase
             records itself. It used to be asked afterwards, only on a
             win, and only if the target would make the top ten. */
          '<div class="loh-name"><label>Who\'s batting?</label>' +
            '<input data-start-name maxlength="14" placeholder="Your name" autocomplete="off"></div>' +
          '<button class="loh-btn loh-btn-go" data-play>Start the Chase</button>' +
          '<div class="loh-statline" data-statline></div>' +
          '<button class="loh-btn loh-btn-ghost" data-board-open>Leaderboard</button>' +
          '<div class="loh-motto">Facta Non Verba</div>' +
        '</section>' +

        '<section class="loh-screen loh-hidden" data-screen="result">' +
          '<div class="loh-crest sm" data-crest2></div>' +
          '<h2 class="loh-result" data-result>VICTORY</h2>' +
          '<p class="loh-result-sub" data-result-sub>Target chased</p>' +
          '<div class="loh-result-score"><span data-final-score>0</span></div>' +
          '<p class="loh-result-line" data-result-line></p>' +
          /* The over is already on its way to the board by the time
             this is read. This says what happened to it. */
          '<div class="loh-save" data-save-state>' +
            '<span data-save-msg></span>' +
            '<button class="loh-btn loh-btn-ghost loh-btn-sm loh-hidden" data-retry>Try again</button>' +
          '</div>' +
          '<button class="loh-btn loh-btn-go" data-again>Play Again</button>' +
          '<div class="loh-result-actions"><button class="loh-btn loh-btn-ghost" data-board-open2>Leaderboard</button>' +
          '<button class="loh-btn loh-btn-ghost" data-menu>Change level</button></div>' +
          '<div class="loh-motto">Facta Non Verba</div>' +
        '</section>' +

        '<section class="loh-screen loh-hidden" data-screen="board">' +
          '<h2 class="loh-board-title">Clubhouse Leaderboard</h2>' +
          '<ol class="loh-board" data-board-list></ol>' +
          '<p class="loh-board-empty loh-hidden" data-board-empty>No chases yet. Be the first.</p>' +
          /* A stale board presented as the live one is worse than no
             board, so it says which it is. */
          '<p class="loh-board-stale loh-hidden" data-board-stale>Offline — showing the last board this device saw.</p>' +
          '<button class="loh-btn loh-btn-go" data-board-back>Back</button>' +
        '</section>' +
      '</div>' +
    '</div>';

  const root = host.querySelector(".loh-root");
  const stage = host.querySelector(".loh-stage");
  const canvas = host.querySelector(".loh-canvas");
  const ctx = canvas.getContext("2d");
  const q = (sel) => root.querySelector(sel);
  q("[data-crest]").innerHTML = LOH.crestSVG();
  q("[data-crest2]").innerHTML = LOH.crestSVG();

  /* --------------------------------------------------------- entities */
  const ball = new LOH.Ball(), batter = new LOH.Batter(), bowler = new LOH.Bowler();
  const nearStumps = new LOH.Stumps(S.cx, S.strikerStumpsY, 1);
  const farStumps = new LOH.Stumps(S.cx, S.bowlerY + 4, 0.34);

  /* ------------------------------------------------------------ state */
  const G = {
    state: "menu", phase: "idle", phaseT: 0,
    diff: LOH.store.get("loh_diff") || "club",
    level: 0, target: 0, score: 0, ballsTotal: 6, ballsLeft: 6,
    out: false, won: false, knock: 0, ballsLog: [],
    /* Biggest single ball of the over. The server checks it against
       the per-ball ceiling, and it is worth showing one day. */
    bestShot: 0
  };

  /* ------------------------------------------------------------ meter */
  const meter = {
    active: false, pos: 0, dir: 1, speed: 0.85, locked: false, lockPos: 0.5, flash: 0,
    bands: { perfect: 0.05, great: 0.13, good: 0.23, poor: 0.34 },
    slowChangeAt: -1, slowDone: true,
    reset(speed, bands, slowAt) {
      this.active = false; this.pos = 0; this.dir = 1; this.speed = speed; this.locked = false; this.flash = 0;
      this.bands = bands; this.slowChangeAt = (slowAt === undefined ? -1 : slowAt); this.slowDone = (slowAt === undefined);
    },
    update(dt, elapsed) {
      if (!this.active || this.locked) return;
      if (!this.slowDone && elapsed >= this.slowChangeAt) { this.speed *= (Math.random() < 0.5 ? 0.45 : 1.7); this.slowDone = true; this.flash = 0.25; }
      this.pos += this.dir * this.speed * dt * 2;
      if (this.pos >= 1) { this.pos = 1; this.dir = -1; } else if (this.pos <= 0) { this.pos = 0; this.dir = 1; }
      if (this.flash > 0) this.flash -= dt;
    },
    grade(pos) {
      const d = Math.abs(pos - 0.5), b = this.bands;
      if (d <= b.perfect) return "perfect";
      if (d <= b.great) return "great";
      if (d <= b.good) return "good";
      if (d <= b.poor) return "poor";
      return "edge";
    }
  };

  /* ----------------------------------------------------------- effects */
  let particles = [], floats = [], banner = null, shake = 0, flash = 0, cheer = 0;
  function addFloat(t, x, y, c, sz, vy) { floats.push({ text: t, x, y, color: c || "#fff", size: sz || 30, vy: vy || -46, life: 0, ttl: 1.1 }); }
  function setBanner(t, sub, c) { banner = { text: t, sub: sub || "", color: c || "#C9A227", life: 0, ttl: 2.0 }; }
  function burst(x, y, c, n, spd, grav, sz) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = spd * (0.4 + Math.random()); particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, grav, life: 0, ttl: 0.7 + Math.random() * 0.6, size: sz * (0.6 + Math.random() * 0.8), color: c }); } }
  function fireworks(x, y) { burst(x, y, "#E8C24A", 24, 260, 240, 3.2); burst(x, y, "#fff7d6", 12, 200, 220, 2.4); burst(x, y, "#C9A227", 16, 320, 260, 3); }
  function confetti() {
    const cols = ["#C9A227", "#E8C24A", "#f5f2e8", "#2e9e4f", "#fff"];
    for (let i = 0; i < 90; i++) particles.push({ x: Math.random() * S.W, y: -10 - Math.random() * 60, vx: (Math.random() - 0.5) * 60, vy: 80 + Math.random() * 160, grav: 60, life: 0, ttl: 2.2 + Math.random() * 1.2, size: 3 + Math.random() * 4, color: cols[i % cols.length], confetti: true, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 10, sway: Math.random() * TAU });
  }
  function stumpShatter() { for (let i = 0; i < 16; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, s = 120 + Math.random() * 220; particles.push({ x: S.cx + (Math.random() - 0.5) * 20, y: S.strikerStumpsY - 20, vx: Math.cos(a) * s, vy: Math.sin(a) * s, grav: 520, life: 0, ttl: 0.9 + Math.random() * 0.5, size: 2 + Math.random() * 3, color: Math.random() < 0.5 ? "#efe3c4" : "#cdbb8e", wood: true, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 16 }); } }

  /* ------------------------------------------------- crowd dots (stands) */
  const crowd = [];
  for (let i = 0; i < 140; i++) { const tone = Math.random(); crowd.push({ x: 10 + Math.random() * (S.W - 20), y: 140 + Math.random() * 90, base: tone < 0.18 ? "#C9A227" : tone < 0.4 ? "#e9e2cf" : "#3a3f3a", ph: Math.random() * TAU, r: 1.4 + Math.random() * 1.4 }); }

  /* ------------------------------------------------------- HUD plumbing */
  function runsReq() { return Math.max(0, G.target - G.score); }
  function rrr() { return G.ballsLeft > 0 ? (runsReq() / G.ballsLeft) * 6 : 0; }
  function syncHUD() {
    q("[data-need]").textContent = runsReq();
    q("[data-bl]").textContent = G.ballsLeft;
    q("[data-score]").textContent = G.score;
    q("[data-rrr]").textContent = runsReq() === 0 ? "—" : rrr().toFixed(1);
  }
  function buildPips() {
    const wrap = q("[data-pips]"); wrap.innerHTML = "";
    for (let i = 0; i < G.ballsTotal; i++) { const d = document.createElement("span"); d.className = "loh-pip"; wrap.appendChild(d); }
  }
  function markPip(idx, kind) {
    const pips = q("[data-pips]").children; if (!pips[idx]) return;
    pips[idx].className = "loh-pip done loh-pip-" + kind;
  }

  /* ------------------------------------------------------ screen helpers */
  function show(name) { root.querySelectorAll(".loh-screen").forEach((s) => s.classList.toggle("loh-hidden", s.getAttribute("data-screen") !== name)); }
  function hideScreens() { root.querySelectorAll(".loh-screen").forEach((s) => s.classList.add("loh-hidden")); }
  function refreshMenu() {
    q("[data-diff]").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.getAttribute("data-d") === G.diff));
    const st = LOH.Stats.load();
    q("[data-statline]").innerHTML =
      '<span><b>' + st.played + '</b> played</span><span><b>' + st.won + '</b> won</span>' +
      '<span><b>' + LOH.Stats.winPct() + '%</b> win rate</span><span>best chase <b>' + st.highest + '</b></span>';
  }
  /* The board comes from the server. The cached copy is painted first
     so the screen is never blank while the network answers.

     Difficulty is on every row now. The old board showed the target
     alone, and because the pools overlap — Club tops out at 16 where
     First Team starts at 12, and First tops out at 24 where Tyger
     Legend starts — two 24s could be the easiest chase one player has
     faced and the hardest the other has, printed identically. */
  function paintBoard(rows, live) {
    const me = (playerName() || "").toLowerCase();
    const ol = q("[data-board-list]"); ol.innerHTML = "";
    q("[data-board-empty]").classList.toggle("loh-hidden", rows.length > 0);
    q("[data-board-stale]").classList.toggle("loh-hidden", live !== false || rows.length === 0);
    rows.forEach((e, i) => {
      const li = document.createElement("li");
      if (String(e.name || "").toLowerCase() === me) li.className = "me";
      const lvl = LOH.DIFF_LABEL[e.difficulty] || "";
      li.innerHTML = '<span class="r">' + (i + 1) + '</span>' +
        '<span class="n">' + esc(e.name) +
          (lvl ? '<em class="lvl lvl-' + esc(e.difficulty) + '">' + esc(lvl) + '</em>' : '') + '</span>' +
        '<span class="s">' + (e.target | 0) +
          '<small> · ' + (e.balls_left | 0) + 'b left</small></span>';
      ol.appendChild(li);
    });
  }

  async function renderBoard() {
    paintBoard(LOH.Board.cached(), true);
    const res = await LOH.Board.top();
    paintBoard(res.rows, res.live);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  /* ----------------------------------------------------------- the over */
  let promptShown = false;
  function startOver() {
    G.state = "playing";
    G.target = LOH.scenarioFor(G.diff, G.level);
    G.ballsTotal = 6; G.ballsLeft = 6; G.score = 0; G.out = false; G.won = false; G.knock = 0; G.ballsLog = [];
    G.bestShot = 0;
    particles = []; floats = []; banner = null; shake = 0; flash = 0; cheer = 0;
    q("[data-hud]"); root.querySelector(".loh-hud").classList.remove("loh-hidden");
    buildPips(); hideScreens(); syncHUD();
    promptShown = false; nextBall();
  }

  function rollSpecial(ballNo) {
    if (ballNo === 0) return "normal";          // ease in on ball 1
    if (Math.random() > 0.52) return "normal";
    const r = Math.random();
    if (r < 0.22) return "golden";
    if (r < 0.5) return "yorker";
    if (r < 0.75) return "bouncer";
    return "slower";
  }

  function nextBall() {
    ball.reset(); bowler.reset(); G.knock = 0;
    G.special = rollSpecial(G.ballsTotal - G.ballsLeft);
    G.phase = "runup"; G.phaseT = 0; bowler.runup();
    const tag = q("[data-special]");
    const labels = { golden: "GOLDEN BALL · DOUBLE RUNS", yorker: "YORKER", bouncer: "BOUNCER", slower: "SLOWER BALL", normal: "" };
    tag.textContent = labels[G.special] || "";
    tag.className = "loh-special" + (G.special !== "normal" ? " on loh-special-" + G.special : "");
    if (!promptShown) q("[data-prompt]").classList.add("show");
  }

  function beginDelivery() {
    const lvlBump = G.level * 0.03;
    let speed = ({ club: 0.78, first: 0.95, legend: 1.15 }[G.diff]) + lvlBump;
    let bands = { perfect: 0.05, great: 0.13, good: 0.23, poor: 0.34 };
    let dur = 1.2, slowAt;
    if (G.special === "yorker") { bands = { perfect: 0.035, great: 0.09, good: 0.17, poor: 0.30 }; dur = 1.0; }
    else if (G.special === "bouncer") { bands = { perfect: 0.03, great: 0.085, good: 0.16, poor: 0.30 }; speed *= 1.35; }
    else if (G.special === "slower") { dur = 1.55; slowAt = 0.45 + Math.random() * 0.35; }
    speed = Math.min(speed, 1.75);
    bowler.release();
    ball.deliver({ golden: G.special === "golden", special: G.special, dur });
    meter.reset(speed, bands, slowAt);
    meter.active = true;
    G.phase = "delivery"; G.phaseT = 0;
  }

  function handleSwing() {
    if (G.state !== "playing" || G.phase !== "delivery" || !meter.active || meter.locked) return;
    meter.locked = true; meter.lockPos = meter.pos; meter.flash = 0.4; meter.active = false;
    if (!promptShown) { promptShown = true; q("[data-prompt]").classList.remove("show"); }
    resolveShot(meter.grade(meter.pos), false);
  }

  function resolveShot(grade, isLeave) {
    const idx = G.ballsTotal - G.ballsLeft;     // pip index for this ball
    let kind, runs = 0, dismissal = null, swPow = 1;
    if (isLeave) { kind = "dot"; swPow = 0.25; }
    else if (grade === "perfect") { kind = "six"; runs = 6; swPow = 1.25; }
    else if (grade === "great") { kind = "four"; runs = 4; swPow = 1.05; }
    else if (grade === "good") { const d = Math.abs(meter.lockPos - 0.5); runs = d < 0.15 ? 3 : d < 0.19 ? 2 : 1; kind = "single"; swPow = 0.7; }
    else if (grade === "poor") { kind = "dot"; swPow = 0.5; }
    else { if (Math.random() < 0.65) { kind = "wicket"; dismissal = ["BOWLED", "CAUGHT", "LBW"][Math.random() * 3 | 0]; swPow = 1.1; } else { kind = "dot"; swPow = 0.9; } }

    if (G.special === "golden" && runs > 0) runs *= 2;     // double runs

    batter.swing(swPow, meter.lockPos < 0.5 ? -1 : 1);
    if (kind === "wicket") LOH.SFX.appeal();
    ball.hit(kind);

    G.ballsLeft--;
    const c = LOH.commentary;

    if (kind === "wicket") {
      markPip(idx, "out"); G.out = true; G.outType = dismissal;
      shake = 16; stumpShatter(); G.knock = 0.001;
      setBanner("OUT", c.rand(c.pool.out), "#d7263d");
      LOH.SFX.wicket();
      syncHUD(); G.phase = "out"; G.phaseT = 0; return;
    }

    G.score += runs;
    if (runs > G.bestShot) G.bestShot = runs;
    if (kind === "six") {
      markPip(idx, "six"); cheer = 1; flash = 0.5; shake = 7;
      fireworks(S.cx, 210 + Math.random() * 30);
      setBanner(G.special === "golden" ? "GOLDEN SIX" : "SIX", c.rand(c.pool.six), "#E8C24A");
      addFloat("+" + runs, S.cx, S.ballHitY - 36, "#E8C24A", 42, -64);
      G.special === "golden" ? (LOH.SFX.gold(), LOH.SFX.six()) : LOH.SFX.six();
    } else if (kind === "four") {
      markPip(idx, "four"); cheer = 0.7; flash = 0.3; shake = 4;
      burst(S.cx, S.ballHitY, "#C9A227", 12, 200, 220, 2.6);
      setBanner(G.special === "golden" ? "GOLDEN FOUR" : "FOUR", c.rand(c.pool.four), "#C9A227");
      addFloat("+" + runs, S.cx, S.ballHitY - 30, "#C9A227", 38, -58);
      G.special === "golden" ? (LOH.SFX.gold(), LOH.SFX.four()) : LOH.SFX.four();
    } else if (kind === "single") {
      markPip(idx, "run");
      setBanner("+" + runs, c.rand(c.pool.one), "#f5f2e8");
      addFloat("+" + runs, S.cx + (meter.lockPos < .5 ? -1 : 1) * 24, S.ballHitY - 18, "#f5f2e8", 26);
      LOH.SFX.bat();
    } else {
      markPip(idx, "dot");
      setBanner("DOT", c.rand(c.pool.dot), "rgba(245,242,232,.85)");
      if (!isLeave) LOH.SFX.bat();
    }

    syncHUD();

    if (G.score >= G.target) { winChase(); return; }
    if (G.ballsLeft <= 0) { loseChase(false); return; }
    // tension line between balls
    const sit = c.situation(runsReq(), G.ballsLeft);
    if (sit && banner) banner.sub = sit;
    G.phase = "shot"; G.phaseT = 0;
  }

  function winChase() { G.won = true; G.phase = "celebrate"; G.phaseT = 0; confetti(); fireworks(S.cx, 200); flash = 0.6; cheer = 1; setBanner("VICTORY", LOH.commentary.rand(LOH.commentary.pool.win), "#E8C24A"); LOH.SFX.win(); }
  function loseChase(out) { G.phase = out ? "out" : "short"; G.phaseT = 0; if (!out) { setBanner("OVER COMPLETE", LOH.commentary.rand(LOH.commentary.pool.lose), "#d7263d"); LOH.SFX.lose(); } }

  function finish() {
    G.state = "result";
    root.querySelector(".loh-hud").classList.add("loh-hidden");
    LOH.Stats.record(G.won, G.target);
    const ballsLeft = G.ballsLeft;
    q("[data-result]").textContent = G.won ? "VICTORY" : "DEFEAT";
    q("[data-result]").className = "loh-result " + (G.won ? "win" : "loss");
    q("[data-result-sub]").textContent = G.won ? "Target chased!" : (G.out ? "Wicket — the chase is over." : "Better luck next over.");
    q("[data-final-score]").textContent = G.score + (G.out ? "/1" : "");
    let line;
    if (G.won) line = "Chased " + G.target + " with " + ballsLeft + " ball" + (ballsLeft === 1 ? "" : "s") + " to spare.";
    else if (G.out) line = "Out for " + G.score + " — needed " + (G.target - G.score) + " more.";
    else line = "Finished on " + G.score + " — " + (G.target - G.score) + " run" + ((G.target - G.score) === 1 ? "" : "s") + " short.";
    q("[data-result-line]").textContent = line;

    // progression: harder next chase on a win, reset on a loss
    if (G.won) G.level++; else G.level = 0;

    show("result");
    submitChase(ballsLeft);
  }

  /* ------------------------------------------------ saving the chase
     Every over goes to the board, automatically, won or lost. It used
     to need a Save button that appeared only on a win and only if the
     target would make the top ten — so a member who lost, or who won
     a modest chase, played and nothing happened at all.

     A lost chase is not a leaderboard entry, because the board is for
     chases completed. It is still recorded, so the club can see how
     often the last over is survived.

     `sending` guards the double tap: two clicks used to write two
     identical rows. */
  let sending = false, lastChase = null;

  function setSaveState(msg, kind, retry) {
    const box = q("[data-save-state]"), m = q("[data-save-msg]"), r = q("[data-retry]");
    if (!box || !m) return;
    m.textContent = msg;
    box.className = "loh-save" + (kind ? " " + kind : "");
    if (r) r.classList.toggle("loh-hidden", !retry);
  }

  function playerName() {
    const el = q("[data-start-name]");
    const typed = el && el.value ? el.value.trim() : "";
    return (typed || LOH.store.get("loh_lastname") || "Player").slice(0, 14);
  }

  function submitChase(ballsLeft) {
    lastChase = {
      name: playerName(),
      score: G.score,
      /* Deliveries actually faced. The server checks this against the
         runs made and against the balls to spare, so it has to be the
         real number and not six. */
      balls: Math.max(1, G.ballsTotal - ballsLeft),
      best_shot: G.bestShot || 0,
      target: G.target,
      balls_left: Math.max(0, ballsLeft),
      difficulty: G.diff,
      won: !!G.won
    };
    sendChase();
  }

  async function sendChase() {
    if (sending || !lastChase) return;
    sending = true;
    setSaveState("Signing the board…", "", false);
    try {
      const res = await LOH.Board.submit(lastChase);
      if (res.ok) {
        const won = lastChase.won;
        lastChase = null;
        setSaveState(
          !won ? "Over recorded."
          : res.rank === 0 ? "Top of the clubhouse board!"
          : res.rank > 0 ? "Signed — " + ordinal(res.rank + 1) + " on the board"
          : "Signed the board", won ? "ok" : "", false);
      } else if (res.queued) {
        setSaveState("Saved on this device — the board is offline", "pending", true);
      } else {
        setSaveState(res.error || "The board would not take that over", "", true);
      }
    } catch (e) {
      setSaveState("Saved on this device — the board is offline", "pending", true);
    } finally { sending = false; }
  }

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* ------------------------------------------------------------ update */
  function update(dt) {
    bowler.update(dt); batter.update(dt); ball.update(dt); meter.update(dt, G.phaseT);
    if (cheer > 0) cheer -= dt * 0.8;
    if (shake > 0) shake = Math.max(0, shake - dt * 36);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (G.knock > 0 && G.knock < 1) G.knock = Math.min(1, G.knock + dt * 4);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life += dt; p.vy += p.grav * dt;
      if (p.confetti) { p.sway += dt * 4; p.x += p.vx * dt + Math.sin(p.sway) * 14 * dt; } else p.x += p.vx * dt;
      p.y += p.vy * dt; if (p.wood || p.confetti) p.rot += p.vr * dt;
      if (p.life >= p.ttl) particles.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.life += dt; f.y += f.vy * dt; f.vy *= 0.96; if (f.life >= f.ttl) floats.splice(i, 1); }
    if (banner) { banner.life += dt; if (banner.life >= banner.ttl) banner = null; }

    if (G.state !== "playing") return;
    G.phaseT += dt;
    if (G.phase === "runup") { if (G.phaseT >= 0.5) beginDelivery(); }
    else if (G.phase === "delivery") { if (ball.progress() >= 1 && !meter.locked) resolveShot("poor", true); }
    else if (G.phase === "shot") { if (ball.done || G.phaseT > 1.2) nextBall(); }
    else if (G.phase === "celebrate") { if (G.phaseT >= 1.7) finish(); }
    else if (G.phase === "out") { if (G.phaseT >= 1.5) finish(); }
    else if (G.phase === "short") { if (G.phaseT >= 1.3) finish(); }
  }

  /* ------------------------------------------------------------ render */
  let view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const scale = Math.min(w / S.W, h / S.H);
    view = { scale, ox: (w - S.W * scale) / 2, oy: (h - S.H * scale) / 2, dpr };
  }

  function buildSegs(b) {
    const c = 0.5;
    return [
      [0, c - b.poor, "#7a1f1f"], [c - b.poor, c - b.good, "#c8631f"], [c - b.good, c - b.great, "#9aa024"],
      [c - b.great, c - b.perfect, "#2e9e4f"], [c - b.perfect, c + b.perfect, "#C9A227"],
      [c + b.perfect, c + b.great, "#2e9e4f"], [c + b.great, c + b.good, "#9aa024"],
      [c + b.good, c + b.poor, "#c8631f"], [c + b.poor, 1, "#7a1f1f"]
    ];
  }
  function rrectPath(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawMeter() {
    if (G.state !== "playing") return;
    if (G.phase !== "delivery" && G.phase !== "shot") return;
    const x = 64, w = S.W - 128, y = 664, h = 24;
    rrectPath(x - 4, y - 6, w + 8, h + 12, 9); ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fill();
    buildSegs(meter.bands).forEach((sg) => { ctx.fillStyle = sg[2]; ctx.fillRect(x + w * sg[0], y, w * (sg[1] - sg[0]), h); });
    ctx.strokeStyle = "rgba(255,255,255,.65)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + w / 2, y - 3); ctx.lineTo(x + w / 2, y + h + 3); ctx.stroke();
    rrectPath(x, y, w, h, 5); ctx.strokeStyle = "rgba(245,242,232,.25)"; ctx.lineWidth = 2; ctx.stroke();
    const px = x + w * (meter.locked ? meter.lockPos : meter.pos);
    ctx.fillStyle = meter.flash > 0 ? "#fff" : "#f5f2e8";
    if (meter.flash > 0) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 14; }
    ctx.beginPath(); ctx.moveTo(px, y - 9); ctx.lineTo(px - 7, y - 19); ctx.lineTo(px + 7, y - 19); ctx.closePath(); ctx.fill();
    ctx.fillRect(px - 1.5, y - 9, 3, h + 9); ctx.shadowBlur = 0;
  }

  function drawScene() {
    let g = ctx.createLinearGradient(0, 0, 0, S.horizon); g.addColorStop(0, "#06120c"); g.addColorStop(1, "#0c2417");
    ctx.fillStyle = g; ctx.fillRect(0, 0, S.W, S.horizon + 2);
    const fl = ctx.createRadialGradient(S.cx, 60, 10, S.cx, 60, 250); fl.addColorStop(0, "rgba(201,162,39,.10)"); fl.addColorStop(1, "rgba(201,162,39,0)"); ctx.fillStyle = fl; ctx.fillRect(0, 0, S.W, S.horizon);
    ctx.fillStyle = "#0a0f0a"; ctx.fillRect(0, 136, S.W, S.horizon - 136);
    for (let i = 0; i < crowd.length; i++) { const c = crowd[i], tw = 0.6 + 0.4 * Math.sin(c.ph + perfT * 4 + i), jit = cheer > 0 ? (Math.random() - 0.5) * cheer * 2 : 0; ctx.globalAlpha = 0.5 + 0.5 * tw + cheer * 0.4; ctx.fillStyle = cheer > 0.2 && Math.random() < cheer * 0.5 ? "#E8C24A" : c.base; ctx.beginPath(); ctx.arc(c.x, c.y + jit, c.r, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1;
    g = ctx.createLinearGradient(0, S.horizon - 10, 0, S.H); g.addColorStop(0, "#1c5a30"); g.addColorStop(.5, "#216b39"); g.addColorStop(1, "#184f2a"); ctx.fillStyle = g; ctx.fillRect(0, S.horizon - 8, S.W, S.H - S.horizon + 8);
    ctx.strokeStyle = "rgba(245,242,232,.45)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(S.cx, S.H - 4, S.W * 0.62, 64, 0, Math.PI, TAU); ctx.stroke();
    g = ctx.createLinearGradient(0, S.pitchTopY, 0, S.pitchBotY); g.addColorStop(0, "#b89a63"); g.addColorStop(1, "#caa86b"); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(S.cx - S.pitchTopHalf, S.pitchTopY); ctx.lineTo(S.cx + S.pitchTopHalf, S.pitchTopY); ctx.lineTo(S.cx + S.pitchBotHalf, S.pitchBotY); ctx.lineTo(S.cx - S.pitchBotHalf, S.pitchBotY); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(S.cx - S.pitchTopHalf, S.pitchTopY + 10); ctx.lineTo(S.cx + S.pitchTopHalf, S.pitchTopY + 10); ctx.moveTo(S.cx - S.pitchBotHalf + 18, S.pitchBotY - 28); ctx.lineTo(S.cx + S.pitchBotHalf - 18, S.pitchBotY - 28); ctx.stroke();
    farStumps.draw(ctx, 0); bowler.draw(ctx);
    if (ball.phase === "delivery") ball.draw(ctx);
    nearStumps.draw(ctx, G.knock); batter.draw(ctx);
    if (ball.phase === "flight") ball.draw(ctx);
    drawMeter();

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i], a = 1 - p.life / p.ttl; ctx.globalAlpha = Math.max(0, a);
      if (p.wood || p.confetti) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0); ctx.fillStyle = p.color; const ww = p.confetti ? p.size * 1.6 : p.size, hh = p.confetti ? p.size * 0.7 : p.size * 2.8; ctx.fillRect(-ww / 2, -hh / 2, ww, hh); ctx.restore(); }
      else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < floats.length; i++) { const f = floats[i], a = 1 - f.life / f.ttl; ctx.globalAlpha = Math.max(0, a); ctx.font = "700 " + f.size + 'px "Bebas Neue", Impact, sans-serif'; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y); }
    ctx.globalAlpha = 1;
    if (banner) {
      const p = banner.life / banner.ttl, sc = p < 0.16 ? p / 0.16 : 1, a = p > 0.78 ? (1 - (p - 0.78) / 0.22) : 1;
      ctx.save(); ctx.globalAlpha = a; ctx.textAlign = "center"; ctx.translate(S.cx, 320); ctx.scale(0.82 + sc * 0.18, 0.82 + sc * 0.18);
      ctx.font = '700 58px "Bebas Neue", Impact, sans-serif'; ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.strokeText(banner.text, 0, 0); ctx.fillStyle = banner.color; ctx.fillText(banner.text, 0, 0);
      if (banner.sub) { ctx.font = '600 19px "Barlow Condensed", sans-serif'; ctx.fillStyle = "rgba(245,242,232,.95)"; ctx.fillText(banner.sub, 0, 28); }
      ctx.restore();
    }
    if (flash > 0) { ctx.fillStyle = "rgba(232,194,74," + flash * 0.5 + ")"; ctx.fillRect(0, 0, S.W, S.H); }
  }

  let last = performance.now(), perfT = 0;
  function frame(now) {
    let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05; perfT += dt;
    update(dt);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    ctx.translate(view.ox + sx, view.oy + sy); ctx.scale(view.scale, view.scale);
    ctx.beginPath(); ctx.rect(0, 0, S.W, S.H); ctx.clip();
    drawScene(); ctx.restore();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------- input */
  let gestured = false;
  function firstGesture() { if (!gestured) { gestured = true; LOH.SFX.init(); } root.focus({ preventScroll: true }); }
  function isUI(e) { return e.target.closest && e.target.closest("button,input,.loh-screen"); }
  root.addEventListener("pointerdown", (e) => {
    firstGesture();
    if (isUI(e)) return;
    if (G.state === "playing") handleSwing();
  });
  root.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.key === " ") {
      if (document.activeElement && document.activeElement.tagName === "INPUT") return;
      e.preventDefault(); firstGesture();
      if (G.state === "playing") handleSwing();
      else if (G.state === "menu") startOver();
    }
  });

  /* ----------------------------------------------------------- buttons */
  q("[data-diff]").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; G.diff = b.getAttribute("data-d"); LOH.store.set("loh_diff", G.diff); LOH.SFX.ui(); refreshMenu(); });
  q("[data-play]").addEventListener("click", () => { firstGesture(); LOH.SFX.ui(); G.level = 0; startOver(); });
  q("[data-again]").addEventListener("click", () => { firstGesture(); LOH.SFX.ui(); startOver(); });
  q("[data-menu]").addEventListener("click", () => { LOH.SFX.ui(); G.state = "menu"; G.level = 0; refreshMenu(); show("start"); });
  q("[data-board-open]").addEventListener("click", () => { LOH.SFX.ui(); show("board"); renderBoard(); });
  q("[data-board-open2]").addEventListener("click", () => { LOH.SFX.ui(); show("board"); renderBoard(); });
  q("[data-board-back]").addEventListener("click", () => { LOH.SFX.ui(); show(G.state === "result" ? "result" : "start"); });
  q("[data-retry]").addEventListener("click", () => { LOH.SFX.ui(); sendChase(); });

  /* Remember the name between overs and between visits, so a queue at
     the clubhouse is one tap per go. */
  q("[data-start-name]").addEventListener("input", (e) => {
    const v = e.target.value.trim();
    if (v) LOH.store.set("loh_lastname", v.slice(0, 14));
  });
  q("[data-start-name]").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); firstGesture(); LOH.SFX.ui(); G.level = 0; startOver(); }
  });
  q("[data-mute]").addEventListener("click", () => { firstGesture(); const m = LOH.SFX.toggle(); q("[data-mute]").classList.toggle("muted", m); });

  /* ---------------------------------------------- test seam (guarded)
     Six & Out has one and it is the only reason its save path could be
     tested at all. Nothing here runs unless a test sets the flag. */
  if (window.__LOH_TEST__) {
    window.__loh = { G, meter, ball, startOver, resolveShot, finish, LOH,
                     sendChase, submitChase, renderBoard, playerName };
  }

  /* -------------------------------------------------------------- boot */
  refreshMenu();
  q("[data-start-name]").value = LOH.store.get("loh_lastname") || "";
  q("[data-mute]").classList.toggle("muted", LOH.SFX.muted);

  /* Overs stranded by a dropped connection last time, and the old
     private board migrated once, go up now. Failing here must never
     stop the game loading. */
  Promise.resolve()
    .then(() => LOH.Board.flush())
    .then(() => LOH.Board.top())
    .catch(() => {});
  if (window.ResizeObserver) { new ResizeObserver(resize).observe(stage); } else { window.addEventListener("resize", resize); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  resize();
  requestAnimationFrame(frame);
})(window.LOH || (window.LOH = {}));
