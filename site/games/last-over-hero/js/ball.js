/* =====================================================================
   Tygerberg Last Over Hero — ball.js
   Scene geometry + the cricket ball (delivery + shot flight).
   Special deliveries (yorker / bouncer / slower / golden) get distinct
   trajectories and looks. Everything hangs off the single LOH global.
   ===================================================================== */
(function (LOH) {
  "use strict";

  LOH.SCENE = {
    W: 480, H: 720, cx: 240, horizon: 232,
    pitchTopY: 256, pitchTopHalf: 28,
    pitchBotY: 612, pitchBotHalf: 150,
    bowlerY: 238,
    strikerStumpsY: 560,
    batterY: 592,
    ballStartY: 264, ballStartR: 3,
    ballHitY: 556, ballHitR: 12
  };

  class Ball {
    constructor() { this.reset(); }
    reset() {
      const S = LOH.SCENE;
      this.phase = "idle"; this.t = 0;
      this.x = S.cx; this.y = S.ballStartY; this.r = S.ballStartR;
      this.line = 0; this.golden = false; this.special = "normal";
      this.dur = 1.2; this.vx = 0; this.vy = 0; this.gravity = 0;
      this.rot = 0; this.kind = null; this.done = false; this.trail = [];
      this.bounceY = 460;       // where the delivery pitches
    }
    deliver(opts) {
      this.reset();
      this.phase = "delivery";
      this.golden = !!opts.golden;
      this.special = opts.special || "normal";
      this.dur = opts.dur || 1.2;
      this.line = (Math.random() * 2 - 1) * 20;
      if (this.special === "yorker") this.bounceY = 540;   // pitches up full
      else if (this.special === "bouncer") this.bounceY = 360; // short, climbs
      else this.bounceY = 440 + Math.random() * 60;
    }
    progress() { return this.t; }

    hit(kind) {
      const S = LOH.SCENE;
      this.phase = "flight"; this.kind = kind; this.t = 1;
      this.x = S.cx + this.line * 0.5; this.y = S.ballHitY; this.r = S.ballHitR;
      this.life = 0;
      const side = Math.random() < 0.5 ? -1 : 1;
      if (kind === "six") { this.vx = side * (60 + Math.random() * 70); this.vy = -650 - Math.random() * 120; this.gravity = 380; }
      else if (kind === "four") { this.vx = side * (260 + Math.random() * 120); this.vy = -150 - Math.random() * 60; this.gravity = 320; }
      else if (kind === "single") { this.vx = side * (90 + Math.random() * 60); this.vy = 120 + Math.random() * 60; this.gravity = 120; }
      else if (kind === "dot") { this.vx = side * 26; this.vy = 40; this.gravity = 260; }
      else if (kind === "wicket") { this.vx = (S.cx - this.x) * 4; this.vy = (S.strikerStumpsY - this.y) * 6; this.gravity = 0; }
    }

    update(dt) {
      const S = LOH.SCENE;
      if (this.phase === "delivery") {
        this.t = Math.min(1, this.t + dt / this.dur);
        const e = this.t;
        // two-segment path: pre-bounce (start→bounce) then post-bounce (bounce→bat)
        const by = this.bounceY, bf = (by - S.ballStartY) / (S.ballHitY - S.ballStartY);
        if (e < bf) { const k = e / bf; this.y = S.ballStartY + (by - S.ballStartY) * k; }
        else {
          const k = (e - bf) / (1 - bf);
          this.y = by + (S.ballHitY - by) * k;
          if (this.special === "bouncer") this.y = by + (S.ballHitY - by) * k - Math.sin(k * Math.PI) * 26; // climbs
        }
        this.x = S.cx + this.line * e;
        this.r = S.ballStartR + (S.ballHitR - S.ballStartR) * Math.pow(e, 1.4);
        this.rot += dt * 12; this._trail();
      } else if (this.phase === "flight") {
        this.life += dt; this.vy += this.gravity * dt;
        this.x += this.vx * dt; this.y += this.vy * dt; this.rot += dt * 18;
        if (this.kind === "six" || this.kind === "four") this.r = Math.max(4, this.r - dt * 6);
        this._trail();
        const off = this.y < -40 || this.y > S.H + 60 || this.x < -60 || this.x > S.W + 60;
        if (off || this.life > (this.kind === "wicket" ? 0.18 : 1.2)) { this.phase = "done"; this.done = true; }
      }
    }
    _trail() { this.trail.push({ x: this.x, y: this.y, r: this.r }); if (this.trail.length > 8) this.trail.shift(); }

    draw(ctx) {
      if (this.phase === "idle" || this.phase === "done") return;
      for (let i = 0; i < this.trail.length; i++) {
        const p = this.trail[i], a = (i / this.trail.length) * 0.4;
        ctx.beginPath();
        ctx.fillStyle = this.golden ? "rgba(232,194,74," + a + ")" : "rgba(200,50,50," + a + ")";
        ctx.arc(p.x, p.y, p.r * 0.9, 0, Math.PI * 2); ctx.fill();
      }
      if (this.golden) {
        const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r * 3.4);
        g.addColorStop(0, "rgba(232,194,74,.55)"); g.addColorStop(1, "rgba(232,194,74,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this.x, this.y, this.r * 3.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot);
      const grad = ctx.createRadialGradient(-this.r * 0.4, -this.r * 0.4, this.r * 0.2, 0, 0, this.r);
      if (this.golden) { grad.addColorStop(0, "#fff3c4"); grad.addColorStop(1, "#C9A227"); }
      else { grad.addColorStop(0, "#e8595a"); grad.addColorStop(1, "#8e1d1d"); }
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = this.golden ? "rgba(90,70,10,.7)" : "rgba(255,255,255,.85)";
      ctx.lineWidth = Math.max(0.6, this.r * 0.12);
      ctx.beginPath(); ctx.ellipse(0, 0, this.r * 0.55, this.r, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  LOH.Ball = Ball;
})(window.LOH || (window.LOH = {}));
