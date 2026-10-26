/* =====================================================================
   Tygerberg Last Over Hero — player.js
   Batter, Bowler and Stumps. Simple vector silhouettes in SCENE space.
   ===================================================================== */
(function (LOH) {
  "use strict";
  const GOLD = "#C9A227", GOLD_HI = "#E8C24A", SILH = "#0c0f0c", SILH_HI = "#1a221a";

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath(); ctx.fill();
  }
  LOH.rrect = rrect;

  class Stumps {
    constructor(x, y, scale) { this.x = x; this.y = y; this.s = scale; }
    draw(ctx, knocked) {
      const s = this.s, h = 46 * s, w = 4.4 * s, gap = 9 * s, lean = knocked || 0;
      ctx.save(); ctx.translate(this.x, this.y);
      for (let i = -1; i <= 1; i++) {
        ctx.save(); ctx.translate(i * gap, 0);
        ctx.rotate(lean * (i * 0.5 + (i === 0 ? 0.2 : 0)) * 0.9);
        const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
        g.addColorStop(0, "#d9c9a0"); g.addColorStop(.5, "#f3ead0"); g.addColorStop(1, "#b8a578");
        ctx.fillStyle = g; ctx.fillRect(-w / 2, -h, w, h); ctx.restore();
      }
      if (lean < 0.05) { ctx.fillStyle = "#efe3c4"; ctx.fillRect(-gap - w / 2, -h - 2 * s, gap + w, 2.4 * s); ctx.fillRect(-w / 2, -h - 2 * s, gap + w, 2.4 * s); }
      ctx.restore();
    }
  }

  class Batter {
    constructor() { const S = LOH.SCENE; this.x = S.cx; this.y = S.batterY; this.sw = 0; this.swinging = false; this.swDir = -1; this.power = 1; this.idle = 0; }
    swing(power, dir) { this.swinging = true; this.sw = 0; this.power = power || 1; this.swDir = (dir === undefined) ? (Math.random() < .5 ? -1 : 1) : dir; }
    update(dt) { this.idle += dt; if (this.swinging) { this.sw += dt * 6.5; if (this.sw >= 1) { this.sw = 0; this.swinging = false; } } }
    draw(ctx) {
      const S = LOH.SCENE, bob = Math.sin(this.idle * 2) * 0.6;
      ctx.save(); ctx.translate(this.x, this.y + bob);
      ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(0, 6, 30, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ece6d4"; rrect(ctx, -15, -44, 12, 46, 5); rrect(ctx, 3, -44, 12, 46, 5);
      ctx.fillStyle = "rgba(0,0,0,.12)"; ctx.fillRect(-15, -44, 12, 4); ctx.fillRect(3, -44, 12, 4);
      const tg = ctx.createLinearGradient(0, -86, 0, -40); tg.addColorStop(0, SILH_HI); tg.addColorStop(1, SILH);
      ctx.fillStyle = tg; rrect(ctx, -17, -88, 34, 48, 12);
      ctx.fillStyle = GOLD; ctx.fillRect(-17, -88, 34, 4);
      ctx.fillStyle = SILH; ctx.beginPath(); ctx.arc(0, -98, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#23301f"; rrect(ctx, -12, -104, 24, 7, 3);
      ctx.fillStyle = "#0a0a0a"; rrect(ctx, -10, -98, 6, 9, 2);
      const ease = this.swinging ? Math.sin(this.sw * Math.PI) : 0;
      const ang = 1.15 - this.swDir * ease * 2.4 * this.power, lift = ease * 10;
      ctx.strokeStyle = SILH; ctx.lineWidth = 9; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-9, -78); ctx.lineTo(-2 + Math.cos(ang) * 6, -64 - lift);
      ctx.moveTo(9, -78); ctx.lineTo(2 + Math.cos(ang) * 6, -64 - lift); ctx.stroke();
      ctx.save(); ctx.translate(0, -62 - lift); ctx.rotate(ang);
      if (ease > 0.1) { ctx.shadowColor = "rgba(232,194,74," + (ease * 0.7) + ")"; ctx.shadowBlur = 10 * ease; }
      ctx.fillStyle = "#2b2b2b"; rrect(ctx, -3, -2, 6, 22, 3);
      const bg = ctx.createLinearGradient(-6, 0, 6, 0); bg.addColorStop(0, "#c9a86a"); bg.addColorStop(1, "#e6cf98");
      ctx.fillStyle = bg; rrect(ctx, -6.5, 18, 13, 40, 4); ctx.shadowBlur = 0; ctx.restore();
      ctx.restore();
      if (this.swinging && ease > 0.75) { ctx.save(); ctx.globalAlpha = (ease - 0.75) * 4; ctx.fillStyle = GOLD_HI; ctx.beginPath(); ctx.arc(S.cx, S.ballHitY, 16, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    }
  }

  class Bowler {
    constructor() { const S = LOH.SCENE; this.x = S.cx; this.y0 = 188; this.y = this.y0; this.phase = "wait"; this.t = 0; this.cycle = 0; }
    runup() { this.phase = "run"; this.t = 0; }
    release() { this.phase = "deliver"; this.t = 0; }
    reset() { this.phase = "wait"; this.t = 0; this.y = this.y0; }
    update(dt) {
      this.cycle += dt;
      if (this.phase === "run") { this.t = Math.min(1, this.t + dt / 0.5); this.y = this.y0 + this.t * (LOH.SCENE.bowlerY - this.y0); }
      else if (this.phase === "deliver") { this.t += dt / 0.35; if (this.t >= 1) { this.phase = "follow"; this.t = 1; } }
    }
    draw(ctx) {
      const s = 0.6, run = this.phase === "run", leg = run ? Math.sin(this.cycle * 22) * 6 : 0;
      let arm = -2.3; if (this.phase === "deliver") arm = -2.3 + this.t * 3.4; else if (this.phase === "follow") arm = 1.1;
      ctx.save(); ctx.translate(this.x, this.y); ctx.scale(s, s);
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(0, 4, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ece6d4"; ctx.lineWidth = 7; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-3, -22); ctx.lineTo(-6 - leg, 2); ctx.moveTo(3, -22); ctx.lineTo(6 + leg, 2); ctx.stroke();
      ctx.fillStyle = SILH; rrect(ctx, -10, -52, 20, 32, 8); ctx.fillStyle = GOLD; ctx.fillRect(-10, -52, 20, 3);
      ctx.fillStyle = SILH; ctx.beginPath(); ctx.arc(0, -60, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = SILH; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, -48); ctx.lineTo(Math.cos(arm) * 22, -48 + Math.sin(arm) * 22); ctx.stroke();
      ctx.restore();
    }
  }

  LOH.Batter = Batter; LOH.Bowler = Bowler; LOH.Stumps = Stumps;
})(window.LOH || (window.LOH = {}));
