/* =====================================================================
   ball.js  —  the cricket ball: delivery flight + shot result flight
   Also defines the shared SCENE geometry used by every renderer.
   Plain global classes (no modules) so file:// opening works.
   ===================================================================== */

/* Logical play-field coordinates. Everything draws in this space and the
   canvas is scaled to fit. Behind-the-batter view: bowler far (top),
   batter near (bottom). */
window.SCENE = {
  W: 480, H: 760,
  cx: 240,
  horizon: 244,
  pitchTopY: 270, pitchTopHalf: 30,
  pitchBotY: 656, pitchBotHalf: 152,
  bowlerY: 252,
  strikerStumpsY: 600,
  batterY: 636,
  ballStartY: 286, ballStartR: 3,
  ballHitY: 598, ballHitR: 12
};

class Ball {
  constructor() { this.reset(); }

  reset() {
    const S = window.SCENE;
    this.phase = "idle";       // idle | delivery | flight | done
    this.t = 0;                // 0..1 along delivery
    this.x = S.cx; this.y = S.ballStartY; this.r = S.ballStartR;
    this.line = 0;             // small lateral offset at the bat
    this.golden = false;
    this.dur = 1.25;           // seconds of delivery travel
    this.vx = 0; this.vy = 0;
    this.gravity = 0;
    this.spin = 0; this.rot = 0;
    this.kind = null;
    this.done = false;
    this.trail = [];
  }

  deliver(opts) {
    this.reset();
    this.phase = "delivery";
    this.golden = !!opts.golden;
    this.dur = opts.dur || 1.25;
    this.line = (Math.random() * 2 - 1) * 22;
  }

  /* progress 0..1 of the delivery (used by the swing meter sync) */
  progress() { return this.t; }

  /* launch the ball after contact */
  hit(kind) {
    const S = window.SCENE;
    this.phase = "flight";
    this.kind = kind;
    this.t = 1;
    this.x = S.cx + this.line * 0.5;
    this.y = S.ballHitY;
    this.r = S.ballHitR;
    this.life = 0;
    this.spin = 0.5;
    const side = Math.random() < 0.5 ? -1 : 1;
    if (kind === "six") {
      this.vx = side * (60 + Math.random() * 70);
      this.vy = -640 - Math.random() * 120;
      this.gravity = 380;
    } else if (kind === "four") {
      this.vx = side * (260 + Math.random() * 120);
      this.vy = -150 - Math.random() * 60;
      this.gravity = 320;
    } else if (kind === "single") {
      this.vx = side * (90 + Math.random() * 60);
      this.vy = 120 + Math.random() * 60;
      this.gravity = 120;
    } else if (kind === "dot") {
      this.vx = side * 26; this.vy = 40; this.gravity = 260;
    } else if (kind === "wicket") {
      // drive straight on into the stumps
      this.vx = (S.cx - this.x) * 4;
      this.vy = (S.strikerStumpsY - this.y) * 6;
      this.gravity = 0;
    }
  }

  update(dt) {
    const S = window.SCENE;
    if (this.phase === "delivery") {
      this.t += dt / this.dur;
      if (this.t >= 1) { this.t = 1; }
      const e = this.t;
      this.y = S.ballStartY + (S.ballHitY - S.ballStartY) * e;
      this.x = S.cx + this.line * e;
      this.r = S.ballStartR + (S.ballHitR - S.ballStartR) * Math.pow(e, 1.4);
      this.rot += dt * 12;
      this._trail();
    } else if (this.phase === "flight") {
      this.life += dt;
      this.vy += this.gravity * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.rot += dt * 18;
      if (this.kind === "six" || this.kind === "four") this.r = Math.max(4, this.r - dt * 6);
      this._trail();
      const off = this.y < -40 || this.y > S.H + 60 || this.x < -60 || this.x > S.W + 60;
      const timeUp = this.life > (this.kind === "wicket" ? 0.18 : 1.2);
      if (off || timeUp) { this.phase = "done"; this.done = true; }
    }
  }

  _trail() {
    this.trail.push({ x: this.x, y: this.y, r: this.r });
    if (this.trail.length > 7) this.trail.shift();
  }

  draw(ctx) {
    if (this.phase === "idle" || this.phase === "done") return;
    // motion trail
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i], a = (i / this.trail.length) * 0.35;
      ctx.beginPath();
      ctx.fillStyle = this.golden ? "rgba(232,194,74," + a + ")" : "rgba(190,40,40," + a + ")";
      ctx.arc(p.x, p.y, p.r * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    // golden glow
    if (this.golden) {
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r * 3.4);
      g.addColorStop(0, "rgba(232,194,74,.55)");
      g.addColorStop(1, "rgba(232,194,74,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r * 3.4, 0, Math.PI * 2); ctx.fill();
    }
    // body
    ctx.save();
    ctx.translate(this.x, this.y); ctx.rotate(this.rot);
    const grad = ctx.createRadialGradient(-this.r * 0.4, -this.r * 0.4, this.r * 0.2, 0, 0, this.r);
    if (this.golden) { grad.addColorStop(0, "#fff3c4"); grad.addColorStop(1, "#C9A227"); }
    else { grad.addColorStop(0, "#e8595a"); grad.addColorStop(1, "#8e1d1d"); }
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.fill();
    // seam
    ctx.strokeStyle = this.golden ? "rgba(90,70,10,.7)" : "rgba(255,255,255,.85)";
    ctx.lineWidth = Math.max(0.6, this.r * 0.12);
    ctx.beginPath(); ctx.ellipse(0, 0, this.r * 0.55, this.r, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

window.Ball = Ball;
