/* =====================================================================
   game.js  —  main loop, swing-meter mechanic, scoring, effects, render
   Loads last; uses Ball, Batter, Bowler, Stumps and TCC.* helpers.
   ===================================================================== */
(function () {
  "use strict";
  const S = window.SCENE;
  const TAU = Math.PI * 2;

  /* ---------------------------------------------------------- DOM refs */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);

  // inject crests
  ["crest", "crest2", "crest3"].forEach((id) => { const e = $(id); if (e) e.innerHTML = TCC.crestSVG(); });

  /* --------------------------------------------------------- entities */
  const ball = new Ball();
  const batter = new Batter();
  const bowler = new Bowler();
  const nearStumps = new Stumps(S.cx, S.strikerStumpsY, 1);
  const farStumps = new Stumps(S.cx, S.bowlerY + 4, 0.34);

  /* ------------------------------------------------------------ state */
  const G = {
    state: "menu",     // menu | playing | over
    phase: "idle",     // runup | delivery | shot | between | out
    phaseT: 0,
    runs: 0, balls: 0, best: 0,
    streak: 0, mult: 1,
    fire: false, fireBalls: 0,
    sixesRow: 0,
    nextGolden: 12, goldenThis: false,
    high: parseInt(TCC.store.get("tcc_high") || "0", 10) || 0,
    outType: "BOWLED",
    knock: 0           // stump knock animation 0..1
  };

  /* ------------------------------------------------------------ meter */
  const meter = {
    active: false, pos: 0.5, dir: 1, speed: 0.8, locked: false, lockPos: 0.5, flash: 0,
    reset(speed) { this.active = false; this.pos = 0.0; this.dir = 1; this.speed = speed; this.locked = false; this.flash = 0; },
    update(dt) {
      if (!this.active || this.locked) return;
      this.pos += this.dir * this.speed * dt * 2;   // *2 → full sweep per (1/speed) sec
      if (this.pos >= 1) { this.pos = 1; this.dir = -1; }
      else if (this.pos <= 0) { this.pos = 0; this.dir = 1; }
      if (this.flash > 0) this.flash -= dt;
    }
  };

  /* ----------------------------------------------------------- effects */
  let particles = [], floats = [], banner = null, shake = 0, flash = 0, cheer = 0;

  function addFloat(text, x, y, color, size, vy) {
    floats.push({ text, x, y, color: color || "#fff", size: size || 30, vy: vy || -46, life: 0, ttl: 1.1 });
  }
  function setBanner(text, sub, color) { banner = { text, sub: sub || "", color: color || "#C9A227", life: 0, ttl: 1.3 }; }
  function burst(x, y, color, n, spd, grav, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = spd * (0.4 + Math.random());
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, grav: grav, life: 0,
        ttl: 0.7 + Math.random() * 0.6, size: size * (0.6 + Math.random() * 0.8), color });
    }
  }
  function fireworks(x, y) {
    burst(x, y, "#E8C24A", 26, 260, 240, 3.4);
    burst(x, y, "#fff7d6", 14, 200, 220, 2.6);
    burst(x, y, "#C9A227", 18, 320, 260, 3);
  }
  function stumpShatter() {
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, s = 120 + Math.random() * 220;
      particles.push({ x: S.cx + (Math.random() - 0.5) * 20, y: S.strikerStumpsY - 20,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s, grav: 520, life: 0, ttl: 0.9 + Math.random() * 0.5,
        size: 2 + Math.random() * 3, color: Math.random() < 0.5 ? "#efe3c4" : "#cdbb8e", wood: true,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 16 });
    }
  }

  /* ------------------------------------------------- crowd dots (stands) */
  const crowd = [];
  (function buildCrowd() {
    for (let i = 0; i < 150; i++) {
      const x = 10 + Math.random() * (S.W - 20);
      const y = 150 + Math.random() * 96;
      const tone = Math.random();
      crowd.push({ x, y, base: tone < 0.18 ? "#C9A227" : tone < 0.4 ? "#e9e2cf" : "#3a3f3a",
        ph: Math.random() * TAU, r: 1.4 + Math.random() * 1.4 });
    }
  })();

  /* ----------------------------------------------------- HUD plumbing */
  function fmtSR() { return G.balls ? Math.round((G.runs / G.balls) * 100) : 0; }
  function syncHUD() {
    $("hudRuns").textContent = G.runs;
    $("hudBalls").textContent = G.balls;
    $("hudSR").textContent = fmtSR();
    $("hudHigh").textContent = Math.max(G.high, G.runs);
    $("comboFill").style.width = Math.min(G.streak / 6, 1) * 100 + "%";
    $("comboTag").textContent = "x" + (G.mult % 1 ? G.mult.toFixed(1) : G.mult);
    $("fireTag").classList.toggle("on", G.fire);
    $("goldenTag").classList.toggle("on", G.goldenThis && G.phase === "delivery");
  }

  function multFor(streak) { return streak >= 3 ? 3 : streak === 2 ? 2 : streak === 1 ? 1.5 : 1; }

  function unlock(id) {
    const a = TCC.Achievements.unlock(id);
    if (a) TCC.toast("Achievement", a.name);
  }

  /* ------------------------------------------------------- flow control */
  function startInnings() {
    G.state = "playing";
    G.runs = 0; G.balls = 0; G.best = 0; G.streak = 0; G.mult = 1;
    G.fire = false; G.fireBalls = 0; G.sixesRow = 0; G.knock = 0;
    G.nextGolden = 10 + (Math.random() * 6 | 0);
    particles = []; floats = []; banner = null; shake = 0; flash = 0; cheer = 0;
    $("hud").classList.remove("hidden");
    hideScreens();
    syncHUD();
    promptOnce = false;
    nextBall();
  }

  let promptOnce = false;
  function nextBall() {
    ball.reset(); bowler.reset(); G.knock = 0;
    G.goldenThis = G.balls >= G.nextGolden;
    G.phase = "runup"; G.phaseT = 0;
    bowler.runup();
    if (!promptOnce) { $("prompt").classList.add("show"); }
  }

  function beginDelivery() {
    const dur = Math.max(0.82, 1.28 - G.balls * 0.012);
    const spd = Math.min(1.5, 0.78 + G.balls * 0.014);
    bowler.release();
    ball.deliver({ golden: G.goldenThis, dur: dur });
    meter.reset(spd);
    meter.active = true; meter.pos = 0; meter.dir = 1;
    G.phase = "delivery"; G.phaseT = 0;
    syncHUD();
  }

  function gradeFromPos(pos) {
    const d = Math.abs(pos - 0.5);
    if (d <= 0.045) return "perfect";
    if (d <= 0.12) return "great";
    if (d <= 0.22) return "good";
    if (d <= 0.33) return "poor";
    return "edge";
  }

  function handleSwing() {
    if (G.state !== "playing") return;
    if (G.phase !== "delivery" || !meter.active || meter.locked) return;
    meter.locked = true; meter.lockPos = meter.pos; meter.flash = 0.4; meter.active = false;
    if (!promptOnce) { promptOnce = true; $("prompt").classList.remove("show"); }
    resolveShot(gradeFromPos(meter.pos), false);
  }

  function resolveShot(grade, isLeave) {
    G.balls++;
    let kind, runs = 0, boundary = false, dismissal = null, swPow = 1;

    if (isLeave) {
      if (Math.random() < 0.12) { kind = "wicket"; dismissal = "BOWLED"; }
      else { kind = "dot"; }
      swPow = 0.25;
    } else if (grade === "perfect") {
      boundary = true; kind = "six"; runs = G.goldenThis ? 12 : 6; swPow = 1.25;
    } else if (grade === "great") {
      boundary = true; kind = "four"; runs = G.goldenThis ? 8 : 4; swPow = 1.05;
    } else if (grade === "good") {
      const d = Math.abs(meter.lockPos - 0.5);
      runs = d < 0.15 ? 3 : d < 0.185 ? 2 : 1; kind = "single"; swPow = 0.7;
    } else if (grade === "poor") {
      kind = "dot"; swPow = 0.5;
    } else { // edge
      if (Math.random() < 0.68) { kind = "wicket"; dismissal = ["BOWLED", "CAUGHT", "LBW"][Math.random() * 3 | 0]; swPow = 1.1; }
      else { kind = "dot"; swPow = 0.9; }
    }

    // multiplier + fire applied to boundaries
    let scored = runs;
    if (boundary) {
      scored = Math.round(runs * G.mult) + (G.fire ? 3 : 0);
    }

    // bat + ball animation
    batter.swing(swPow, meter.lockPos < 0.5 ? -1 : 1);
    if (kind === "wicket") TCC.SFX.appeal();
    ball.hit(kind);

    // streak / combo update
    if (boundary) {
      G.streak++;
      G.mult = multFor(G.streak);
      if (kind === "six") { G.sixesRow++; if (G.sixesRow >= 3) unlock("hat_six"); }
      else G.sixesRow = 0;
      if (!G.fire && G.streak >= 5) { triggerFire(); }
    } else if (kind !== "wicket") {
      G.streak = 0; G.mult = 1; G.sixesRow = 0;
    }
    // fire-mode countdown (per ball faced while lit)
    if (G.fire) { G.fireBalls--; if (G.fireBalls <= 0) { G.fire = false; } }

    // apply score + visuals
    if (kind === "wicket") {
      G.outType = dismissal;
      G.streak = 0; G.mult = 1;
      shake = 16; flash = 0;
      stumpShatter();
      G.knock = 0.001;
      setBanner("OUT", dismissal, "#d7263d");
      TCC.SFX.wicket();
      addFloat("0", S.cx, S.ballHitY - 30, "#d7263d", 26);
      G.phase = "out"; G.phaseT = 0;
      syncHUD();
      return;
    }

    G.runs += scored;
    if (scored > G.best) G.best = scored;
    if (G.runs > G.high) { $("hudHigh").textContent = G.runs; }

    if (kind === "six") {
      cheer = 1; flash = 0.5; shake = 7;
      fireworks(S.cx, 220 + Math.random() * 30);
      burst(S.cx, S.ballHitY, G.goldenThis ? "#fff3c4" : "#E8C24A", 18, 240, 200, 3);
      setBanner(G.goldenThis ? "GOLDEN MAXIMUM" : "SIX", "+" + scored, "#E8C24A");
      addFloat("+" + scored, S.cx, S.ballHitY - 36, "#E8C24A", 42, -64);
      addFloat(TCC.crowd.rand(TCC.crowd.six), S.cx, 300, "#f5f2e8", 22, -30);
      G.goldenThis ? (TCC.SFX.gold(), TCC.SFX.six()) : TCC.SFX.six();
      if (G.goldenThis) unlock("golden");
      unlock("first_six");
    } else if (kind === "four") {
      cheer = 0.7; flash = 0.3; shake = 4;
      burst(S.cx, S.ballHitY, G.goldenThis ? "#fff3c4" : "#C9A227", 12, 200, 220, 2.6);
      setBanner(G.goldenThis ? "GOLDEN FOUR" : "FOUR", "+" + scored, "#C9A227");
      addFloat("+" + scored, S.cx, S.ballHitY - 30, "#C9A227", 38, -58);
      addFloat(TCC.crowd.rand(TCC.crowd.four), S.cx, 300, "#f5f2e8", 20, -26);
      G.goldenThis ? (TCC.SFX.gold(), TCC.SFX.four()) : TCC.SFX.four();
      if (G.goldenThis) unlock("golden");
    } else if (kind === "single") {
      addFloat("+" + scored, S.cx + (meter.lockPos < .5 ? -1 : 1) * 24, S.ballHitY - 18, "#f5f2e8", 26);
      TCC.SFX.bat();
    } else { // dot
      addFloat(isLeave ? "•" : "DOT", S.cx, S.ballHitY - 16, "rgba(245,242,232,.65)", 18);
      if (!isLeave) TCC.SFX.bat();
    }

    if (G.runs > 0) unlock("first_run");
    if (G.runs >= 50) unlock("fifty");
    if (G.runs >= 100) unlock("century");

    syncHUD();
    G.phase = "shot"; G.phaseT = 0;
  }

  function triggerFire() {
    G.fire = true; G.fireBalls = 6;
    flash = 0.6; cheer = 1;
    setBanner("FIRE MODE", "boundaries are blazing", "#ff8a00");
    burst(S.cx, S.batterY - 60, "#ff8a00", 24, 240, 180, 3);
    TCC.SFX.fire();
    unlock("on_fire");
  }

  function gameOver() {
    G.state = "over";
    $("hud").classList.add("hidden");
    const isHigh = G.runs > G.high;
    if (isHigh) { G.high = G.runs; TCC.store.set("tcc_high", String(G.high)); }
    $("finalRuns").textContent = G.runs;
    $("finalBalls").textContent = G.balls;
    $("finalSR").textContent = fmtSR();
    $("finalBest").textContent = G.best;
    $("outHow").textContent = G.outType;
    $("newHigh").classList.toggle("hidden", !isHigh);
    $("startHigh").textContent = G.high;
    showScreen("overScreen");
    submitInnings();
  }

  /* ------------------------------------------------- saving the innings
     Every innings goes to the board, automatically. It used to need a
     Save button that only appeared if the score would make the top ten,
     so a member below the cut played, got out, and nothing happened —
     which is what "it doesn't save scores" meant.

     `sending` guards the double tap: two clicks on Try again used to
     write the innings twice. */
  let sending = false;
  let lastInnings = null;

  function setSaveState(msg, kind, showRetry) {
    const box = $("saveState"), m = $("saveMsg"), r = $("retryBtn");
    if (!box || !m) return;
    m.textContent = msg;
    box.classList.remove("ok", "pending");
    if (kind) box.classList.add(kind);
    if (r) r.classList.toggle("hidden", !showRetry);
  }

  async function submitInnings() {
    /* A duck is still an innings, but there is nothing to put on a
       leaderboard and no member wants to see their name against a 0. */
    if (G.runs <= 0) { setSaveState("Not this time. Have another go.", "", false); return; }

    lastInnings = { name: playerName(), score: G.runs, balls: G.balls, best_shot: G.best };
    await sendInnings();
  }

  async function sendInnings() {
    if (sending || !lastInnings) return;
    sending = true;
    setSaveState("Signing the board…", "", false);
    try {
      const res = await TCC.Board.submit(lastInnings);
      if (res.ok) {
        lastInnings = null;
        setSaveState(
          res.rank === 0 ? "Top of the clubhouse board!"
          : res.rank > 0 ? "Signed — " + ordinal(res.rank + 1) + " on the board"
          : "Signed the board", "ok", false);
      } else if (res.queued) {
        /* Kept, not lost. Sent on the next load. */
        setSaveState("Saved on this device — the board is offline", "pending", true);
      } else {
        setSaveState(res.error || "The board would not take that score", "", true);
      }
    } catch (e) {
      setSaveState("Saved on this device — the board is offline", "pending", true);
    } finally {
      sending = false;
    }
  }

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function playerName() {
    const el = $("startName");
    const typed = el && el.value ? el.value.trim() : "";
    return (typed || TCC.store.get("tcc_lastname") || "Player").slice(0, 14);
  }

  /* ---------------------------------------------------- screen helpers */
  function hideScreens() { ["startScreen", "overScreen", "boardScreen"].forEach((s) => $(s).classList.add("hidden")); }
  function showScreen(id) { hideScreens(); $(id).classList.remove("hidden"); }

  /* The board comes from the server now. The cached copy is painted
     first so the screen is never blank while the network answers, and
     a line says so if the cache is all we have. */
  function paintBoard(rows, live) {
    const me = (playerName() || "").toLowerCase();
    const ol = $("boardList"); ol.innerHTML = "";
    $("boardEmpty").classList.toggle("hidden", rows.length > 0);
    $("boardStale").classList.toggle("hidden", live !== false || rows.length === 0);
    rows.forEach((e, i) => {
      const li = document.createElement("li");
      if (String(e.name || "").toLowerCase() === me) li.className = "me";
      li.innerHTML = '<span class="bd-rank">' + (i + 1) + '</span>' +
        '<span class="bd-name">' + escapeHTML(e.name) + '</span>' +
        '<span class="bd-score">' + e.score + '</span>';
      ol.appendChild(li);
    });
  }

  async function renderBoard() {
    paintBoard(TCC.Board.cached(), true);
    const res = await TCC.Board.top();
    paintBoard(res.rows, res.live);
    showClubBest(res.rows);
  }

  /* "Clubhouse best" means the whole club's best now that there is a
     board to read it from. It used to show this device's personal best
     under that label, which was true only while the board was private
     to the device. That number is still shown, as "Yours". */
  function showClubBest(rows) {
    const el = $("clubBest");
    if (!el) return;
    const top = (rows && rows.length) ? rows[0].score : null;
    el.textContent = (top === null || top === undefined) ? "—" : top;
  }
  function escapeHTML(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  /* ------------------------------------------------------------ update */
  function update(dt) {
    bowler.update(dt);
    batter.update(dt);
    ball.update(dt);
    meter.update(dt);

    if (cheer > 0) cheer -= dt * 0.8;
    if (shake > 0) shake = Math.max(0, shake - dt * 36);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (G.knock > 0 && G.knock < 1) G.knock = Math.min(1, G.knock + dt * 4);

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life += dt;
      p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.wood) p.rot += p.vr * dt;
      if (p.life >= p.ttl) particles.splice(i, 1);
    }
    // floats
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.life += dt; f.y += f.vy * dt; f.vy *= 0.96;
      if (f.life >= f.ttl) floats.splice(i, 1);
    }
    if (banner) { banner.life += dt; if (banner.life >= banner.ttl) banner = null; }

    // phase machine
    if (G.state !== "playing") return;
    G.phaseT += dt;
    if (G.phase === "runup") {
      if (G.phaseT >= 0.5) beginDelivery();
    } else if (G.phase === "delivery") {
      if (ball.progress() >= 1 && !meter.locked) resolveShot("poor", true); // left the ball
    } else if (G.phase === "shot") {
      if (ball.done || G.phaseT > 1.3) { G.phase = "between"; G.phaseT = 0; }
    } else if (G.phase === "between") {
      if (G.phaseT >= 0.45) nextBall();
    } else if (G.phase === "out") {
      if (G.phaseT >= 1.5) gameOver();
    }
  }

  /* ------------------------------------------------------------ render */
  let view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const scale = Math.min(w / S.W, h / S.H);
    view = { scale, ox: (w - S.W * scale) / 2, oy: (h - S.H * scale) / 2, dpr };
  }

  function drawScene() {
    // sky
    let g = ctx.createLinearGradient(0, 0, 0, S.horizon);
    g.addColorStop(0, "#06120c"); g.addColorStop(1, "#0c2417");
    ctx.fillStyle = g; ctx.fillRect(0, 0, S.W, S.horizon + 2);

    // floodlight glow
    const fl = ctx.createRadialGradient(S.cx, 70, 10, S.cx, 70, 260);
    fl.addColorStop(0, "rgba(201,162,39,.10)"); fl.addColorStop(1, "rgba(201,162,39,0)");
    ctx.fillStyle = fl; ctx.fillRect(0, 0, S.W, S.horizon);

    // stands base
    ctx.fillStyle = "#0a0f0a"; ctx.fillRect(0, 146, S.W, S.horizon - 146);
    // crowd dots
    const cl = cheer;
    for (let i = 0; i < crowd.length; i++) {
      const c = crowd[i];
      const tw = 0.6 + 0.4 * Math.sin(c.ph + perfT * 4 + i);
      const jit = cl > 0 ? (Math.random() - 0.5) * cl * 2 : 0;
      ctx.globalAlpha = 0.5 + 0.5 * tw + cl * 0.4;
      ctx.fillStyle = cl > 0.2 && Math.random() < cl * 0.5 ? "#E8C24A" : c.base;
      ctx.beginPath(); ctx.arc(c.x, c.y + jit, c.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // field
    g = ctx.createLinearGradient(0, S.horizon - 10, 0, S.H);
    g.addColorStop(0, "#1c5a30"); g.addColorStop(0.5, "#216b39"); g.addColorStop(1, "#184f2a");
    ctx.fillStyle = g; ctx.fillRect(0, S.horizon - 8, S.W, S.H - S.horizon + 8);

    // mow stripes (subtle)
    ctx.save();
    ctx.globalAlpha = 0.06; ctx.fillStyle = "#ffffff";
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(S.cx, S.horizon);
      ctx.lineTo(S.cx + i * 120 - 40, S.H); ctx.lineTo(S.cx + i * 120 + 40, S.H);
      ctx.closePath(); if (i % 2) ctx.fill();
    }
    ctx.restore();

    // boundary rope
    ctx.strokeStyle = "rgba(245,242,232,.5)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(S.cx, S.H - 6, S.W * 0.62, 70, 0, Math.PI, TAU); ctx.stroke();

    // pitch (trapezoid)
    g = ctx.createLinearGradient(0, S.pitchTopY, 0, S.pitchBotY);
    g.addColorStop(0, "#b89a63"); g.addColorStop(1, "#caa86b");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(S.cx - S.pitchTopHalf, S.pitchTopY);
    ctx.lineTo(S.cx + S.pitchTopHalf, S.pitchTopY);
    ctx.lineTo(S.cx + S.pitchBotHalf, S.pitchBotY);
    ctx.lineTo(S.cx - S.pitchBotHalf, S.pitchBotY);
    ctx.closePath(); ctx.fill();
    // crease lines
    ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(S.cx - S.pitchTopHalf, S.pitchTopY + 10); ctx.lineTo(S.cx + S.pitchTopHalf, S.pitchTopY + 10);
    ctx.moveTo(S.cx - S.pitchBotHalf + 18, S.pitchBotY - 30); ctx.lineTo(S.cx + S.pitchBotHalf - 18, S.pitchBotY - 30);
    ctx.stroke();

    // far stumps + bowler
    farStumps.draw(ctx, 0);
    bowler.draw(ctx);

    // delivery ball is behind batter
    if (ball.phase === "delivery") ball.draw(ctx);

    // near stumps + batter
    nearStumps.draw(ctx, G.knock);
    batter.draw(ctx, G.fire);

    // flight ball on top
    if (ball.phase === "flight") ball.draw(ctx);

    // swing meter
    drawMeter();

    // particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i], a = 1 - p.life / p.ttl;
      ctx.globalAlpha = Math.max(0, a);
      if (p.wood) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size * 1.4, p.size, p.size * 2.8); ctx.restore();
      } else {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // floats
    for (let i = 0; i < floats.length; i++) {
      const f = floats[i], a = 1 - f.life / f.ttl;
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = "700 " + f.size + 'px "Bebas Neue", Impact, sans-serif';
      ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.55)";
      ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    // banner
    if (banner) {
      const p = banner.life / banner.ttl;
      const sc = p < 0.18 ? p / 0.18 : 1;
      const a = p > 0.7 ? (1 - (p - 0.7) / 0.3) : 1;
      ctx.save();
      ctx.globalAlpha = a; ctx.textAlign = "center";
      ctx.translate(S.cx, 348); ctx.scale(0.8 + sc * 0.2, 0.8 + sc * 0.2);
      ctx.font = '700 64px "Bebas Neue", Impact, sans-serif';
      ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,.6)";
      ctx.strokeText(banner.text, 0, 0); ctx.fillStyle = banner.color; ctx.fillText(banner.text, 0, 0);
      if (banner.sub) {
        ctx.font = '600 22px "Barlow Condensed", sans-serif';
        ctx.fillStyle = "rgba(245,242,232,.92)";
        ctx.fillText(banner.sub.toUpperCase(), 0, 30);
      }
      ctx.restore();
    }

    // fire vignette
    if (G.fire) {
      const v = ctx.createRadialGradient(S.cx, S.H * 0.6, S.W * 0.3, S.cx, S.H * 0.6, S.W * 0.8);
      v.addColorStop(0, "rgba(255,120,0,0)"); v.addColorStop(1, "rgba(255,90,0,.22)");
      ctx.fillStyle = v; ctx.fillRect(0, 0, S.W, S.H);
    }
    // boundary flash
    if (flash > 0) { ctx.fillStyle = "rgba(232,194,74," + flash * 0.5 + ")"; ctx.fillRect(0, 0, S.W, S.H); }
  }

  function drawMeter() {
    if (G.state !== "playing") return;
    if (G.phase !== "delivery" && G.phase !== "shot") return;
    const x = 70, w = S.W - 140, y = 706, h = 26;
    // bands (mirrored around centre)
    const segs = [
      [0.00, 0.17, "#7a1f1f"], [0.17, 0.28, "#c8631f"], [0.28, 0.38, "#9aa024"],
      [0.38, 0.455, "#2e9e4f"], [0.455, 0.545, "#C9A227"], [0.545, 0.62, "#2e9e4f"],
      [0.62, 0.72, "#9aa024"], [0.72, 0.83, "#c8631f"], [0.83, 1.00, "#7a1f1f"]
    ];
    ctx.save();
    // track frame
    rrectStroke(x - 4, y - 6, w + 8, h + 12, 10, "rgba(0,0,0,.45)", true);
    for (const sgg of segs) {
      ctx.fillStyle = sgg[2];
      ctx.fillRect(x + w * sgg[0], y, w * (sgg[1] - sgg[0]), h);
    }
    // gold-zone glow
    ctx.save();
    ctx.shadowColor = "rgba(232,194,74,.9)"; ctx.shadowBlur = 12;
    ctx.fillStyle = "rgba(232,194,74,.0)";
    ctx.fillRect(x + w * 0.455, y, w * 0.09, h);
    ctx.restore();
    // centre tick
    ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + w / 2, y - 3); ctx.lineTo(x + w / 2, y + h + 3); ctx.stroke();
    // frame outline
    rrectStroke(x, y, w, h, 6, "rgba(245,242,232,.25)", false);

    // pointer
    const px = x + w * (meter.locked ? meter.lockPos : meter.pos);
    ctx.fillStyle = meter.flash > 0 ? "#fff" : "#f5f2e8";
    if (meter.flash > 0) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 14; }
    ctx.beginPath();
    ctx.moveTo(px, y - 9); ctx.lineTo(px - 7, y - 19); ctx.lineTo(px + 7, y - 19); ctx.closePath(); ctx.fill();
    ctx.fillRect(px - 1.5, y - 9, 3, h + 9);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  function rrectStroke(x, y, w, h, r, color, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = color; ctx.fill(); } else { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); }
  }

  /* --------------------------------------------------------- main loop */
  let last = performance.now(), perfT = 0;
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.05) dt = 0.05;           // clamp after tab-out
    perfT += dt;
    update(dt);

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    ctx.translate(view.ox + sx, view.oy + sy);
    ctx.scale(view.scale, view.scale);
    // clip to play field
    ctx.beginPath(); ctx.rect(0, 0, S.W, S.H); ctx.clip();
    drawScene();
    ctx.restore();

    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------- input */
  function isUI(e) { return e.target.closest && e.target.closest("button,input,a,.icon-btn"); }
  canvas.addEventListener("pointerdown", (e) => { firstGesture(); handleSwing(); });
  document.getElementById("stage").addEventListener("pointerdown", (e) => {
    if (isUI(e)) return; firstGesture();
    if (G.state === "playing") handleSwing();
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault(); firstGesture();
      if (G.state === "playing") handleSwing();
      else if (G.state === "menu") startInnings();
      else if (G.state === "over") startInnings();
    }
  }, { passive: false });

  let gestured = false;
  function firstGesture() { if (!gestured) { gestured = true; TCC.SFX.init(); } }

  /* ----------------------------------------------------------- buttons */
  $("playBtn").addEventListener("click", () => { firstGesture(); TCC.SFX.ui(); startInnings(); });
  $("againBtn").addEventListener("click", () => { firstGesture(); TCC.SFX.ui(); startInnings(); });
  $("boardBtn").addEventListener("click", () => { TCC.SFX.ui(); showScreen("boardScreen"); renderBoard(); });
  $("overBoardBtn").addEventListener("click", () => { TCC.SFX.ui(); showScreen("boardScreen"); renderBoard(); });
  $("boardBack").addEventListener("click", () => { TCC.SFX.ui(); showScreen(G.state === "over" ? "overScreen" : "startScreen"); });
  $("retryBtn").addEventListener("click", () => { TCC.SFX.ui(); sendInnings(); });

  /* Remember the name between innings and between visits, so the
     clubhouse queue is one tap per go rather than typing every time. */
  $("startName").addEventListener("input", () => {
    const v = $("startName").value.trim();
    if (v) TCC.store.set("tcc_lastname", v.slice(0, 14));
  });
  $("startName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); firstGesture(); TCC.SFX.ui(); startInnings(); }
  });
  $("muteBtn").addEventListener("click", () => {
    firstGesture();
    const m = TCC.SFX.toggle();
    $("muteBtn").classList.toggle("muted", m);
  });

  /* ---------------------------------------------- test seam (guarded) */
  if (window.__TCC_TEST__) {
    window.__tcc = { G, meter, ball, gradeFromPos, resolveShot, startInnings, multFor,
                     submitInnings, sendInnings, renderBoard, playerName };
  }

  /* -------------------------------------------------------------- boot */
  function boot() {
    $("startHigh").textContent = G.high;
    $("muteBtn").classList.toggle("muted", TCC.SFX.muted);
    $("startName").value = TCC.store.get("tcc_lastname") || "";
    resize();
    requestAnimationFrame(frame);

    /* Anything stranded by a dropped connection last time — and the
       old private localStorage board, migrated once — goes up now.
       Failing here must never stop the game starting, so it is fired
       and forgotten. */
    Promise.resolve()
      .then(() => TCC.Board.flush())
      .then((sent) => { if (sent) TCC.toast("Sent to the board", sent + (sent === 1 ? " innings" : " innings")); })
      .then(() => TCC.Board.top())
      .then((res) => { showClubBest(res.rows); })
      .catch(() => {});
  }
  window.addEventListener("resize", resize);
  // wait a tick for layout + fonts
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  boot();
})();
