/* =====================================================================
   Tygerberg Last Over Hero — ui.js
   Storage, stats, leaderboard, Web Audio SFX, commentary, scenarios, crest.
   Exposes ONE global: LOH  (keeps the embed from polluting the host page).
   ===================================================================== */
(function (global) {
  "use strict";
  const LOH = global.LOH || {};

  /* ---------------------------------------------------------- storage ----*/
  const mem = {};
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v === null ? (mem[k] ?? null) : v; } catch (e) { return mem[k] ?? null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} mem[k] = v; }
  };
  LOH.store = store;

  /* ------------------------------------------------------------ stats ----*/
  const STATS_KEY = "loh_stats_v1";
  LOH.Stats = {
    load() { try { return Object.assign({ played: 0, won: 0, highest: 0 }, JSON.parse(store.get(STATS_KEY) || "{}")); } catch (e) { return { played: 0, won: 0, highest: 0 }; } },
    record(win, target) {
      const s = this.load();
      s.played++; if (win) { s.won++; if (target > s.highest) s.highest = target; }
      store.set(STATS_KEY, JSON.stringify(s));
      return s;
    },
    winPct() { const s = this.load(); return s.played ? Math.round((s.won / s.played) * 100) : 0; }
  };

  /* ------------------------------------------------------- leaderboard ---
     This was localStorage, so every phone had its own private
     "Clubhouse Leaderboard" and no two players ever saw each other.
     It now reads from Supabase and writes through the Worker.

     NOTE: this is the same shape as the board client in Six & Out's
     ui.js, adapted to a chase. The two games are separate widgets with
     separate script tags and no shared file between them, so the queue
     logic genuinely exists twice. If a third game arrives, pull it out
     into one file rather than copying it a third time.

     What stays local:
       CACHE_KEY  the last board fetched, so the screen is never blank
       QUEUE_KEY  chases that could not be sent — the whole complaint
                  was that nothing was saved, and losing an over to a
                  dropped connection is that same failure
       CLIENT_KEY a random id this browser made for itself, which the
                  Worker rate-limits against. A browser, not a person,
                  and never shown. */
  const BOARD_KEY  = "loh_board_v1";      // legacy local board, migrated once
  const CACHE_KEY  = "loh_board_cache";
  const QUEUE_KEY  = "loh_board_queue";
  const CLIENT_KEY = "tcc_client_id";     // shared with the other game on purpose
  const GAME_ID    = "last_over_hero";

  LOH.config = {
    SUPABASE_URL: "https://cgjannvzpqecwzjdzwso.supabase.co",
    /* Public credential — already in every deployed asset on the club
       site. RLS and the grants in 1-game-scores.sql decide what it can
       reach: the leaderboard views, read only. */
    ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8",
    WORKER_URL: "https://tcc-admin.bydaries.workers.dev",
    timeout: 7000
  };

  function uuid() {
    try { if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID(); } catch (e) {}
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  function clientId() {
    let id = store.get(CLIENT_KEY);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "")) {
      id = uuid(); store.set(CLIENT_KEY, id);
    }
    return id;
  }
  function fetchT(url, opts) {
    const o = opts || {};
    if (!global.AbortController) return fetch(url, o);
    const ac = new AbortController();
    const timer = setTimeout(function () { ac.abort(); }, LOH.config.timeout);
    o.signal = ac.signal;
    return fetch(url, o).then(
      function (r) { clearTimeout(timer); return r; },
      function (e) { clearTimeout(timer); throw e; });
  }
  function readJSON(key, fallback) {
    try { const v = JSON.parse(store.get(key) || "null"); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }

  LOH.Board = {
    clientId: clientId,
    cached() { return readJSON(CACHE_KEY, []); },
    queue() { return readJSON(QUEUE_KEY, []); },

    /* Winning chases, best per player, hardest difficulty first. The
       ordering is the view's business, not this file's. */
    async top() {
      const c = LOH.config;
      try {
        const r = await fetchT(
          c.SUPABASE_URL + "/rest/v1/loh_leaderboard" +
          "?select=name,difficulty,target,balls_left" +
          "&order=tier.desc,target.desc,balls_left.desc&limit=10",
          { headers: { apikey: c.ANON_KEY, Authorization: "Bearer " + c.ANON_KEY } });
        if (!r.ok) throw new Error("board " + r.status);
        const rows = await r.json();
        if (!Array.isArray(rows)) throw new Error("board shape");
        store.set(CACHE_KEY, JSON.stringify(rows));
        return { rows: rows, live: true };
      } catch (e) {
        return { rows: this.cached(), live: false, error: e.message };
      }
    },

    /* Every attempt, won or lost. A failed chase is not a leaderboard
       entry — the view filters those out — but it is recorded, so the
       club can see how often the over is survived and nobody is
       dropped for having had a bad over. */
    async submit(entry) {
      const rec = {
        game: GAME_ID,
        name: String(entry.name || "Player").slice(0, 14),
        score: entry.score | 0,
        balls: entry.balls | 0,
        best_shot: entry.best_shot | 0,
        target: entry.target | 0,
        balls_left: entry.balls_left | 0,
        difficulty: String(entry.difficulty || "club"),
        won: entry.won === true,
        client_id: clientId(),
        ts: Date.now()
      };
      const res = await this._send(rec);
      if (res.ok) {
        if (Array.isArray(res.board)) store.set(CACHE_KEY, JSON.stringify(res.board));
        return res;
      }
      /* 4xx will never be accepted, so queueing it would retry for
         ever. Anything else is the network and is worth keeping. */
      if (res.permanent) return { ok: false, queued: false, error: res.error };
      const q = this.queue();
      q.push(rec);
      store.set(QUEUE_KEY, JSON.stringify(q.slice(-20)));
      return { ok: false, queued: true, error: res.error };
    },

    async _send(rec) {
      try {
        const r = await fetchT(LOH.config.WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "game.submitScore", payload: rec })
        });
        const data = await r.json().catch(function () { return {}; });
        if (r.ok && data && data.ok) return { ok: true, rank: data.rank, board: data.board || [] };
        return {
          ok: false,
          permanent: r.status >= 400 && r.status < 500 && r.status !== 429,
          error: (data && data.error) || ("HTTP " + r.status)
        };
      } catch (e) {
        return { ok: false, permanent: false, error: e.message || "offline" };
      }
    },

    async flush() {
      const pending = this.queue().concat(this._legacy());
      if (!pending.length) return 0;
      store.set(QUEUE_KEY, "[]");
      let sent = 0; const stuck = [];
      for (const rec of pending) {
        const res = await this._send(rec);
        if (res.ok) sent++;
        else if (!res.permanent) stuck.push(rec);
      }
      if (stuck.length) store.set(QUEUE_KEY, JSON.stringify(stuck.slice(-20)));
      return sent;
    },

    /* The old private board, read once. Those rows only ever held a
       name, a target and balls to spare — no difficulty, because it
       was never recorded. The target itself says which pool it came
       from wherever the pools do not overlap; where they do, the
       easier one is assumed, so a migration can only ever understate
       an old result rather than inflate it. */
    _legacy() {
      if (store.get("loh_board_migrated") === "1") return [];
      store.set("loh_board_migrated", "1");
      const old = readJSON(BOARD_KEY, []);
      if (!Array.isArray(old) || !old.length) return [];
      const id = clientId();
      const out = [];
      old.forEach(function (e) {
        const target = e && e.target | 0;
        if (!target) return;
        let difficulty = null;
        if (LOH.POOLS.club.indexOf(target) >= 0) difficulty = "club";
        else if (LOH.POOLS.first.indexOf(target) >= 0) difficulty = "first";
        else if (LOH.POOLS.legend.indexOf(target) >= 0) difficulty = "legend";
        if (!difficulty) return;                       // not a legal target; leave it behind
        const ballsLeft = Math.max(0, Math.min(5, e.balls | 0));
        const ballsFaced = Math.max(1, 6 - ballsLeft);
        /* The old row never stored runs made. A win means the target
           was reached, so that is what is recorded — the smallest
           honest number, and one the plausibility check accepts. */
        if (target > ballsFaced * 12) return;
        out.push({
          game: GAME_ID, name: String(e.name || "Player").slice(0, 14),
          score: target, balls: ballsFaced, best_shot: 0,
          target: target, balls_left: ballsLeft, difficulty: difficulty,
          won: true, client_id: id, ts: e.ts || Date.now()
        });
      });
      return out;
    }
  };

  /* -------------------------------------------------------- scenarios ----*/
  LOH.POOLS = {
    club:   [6, 8, 10, 12, 14, 16],
    first:  [12, 15, 18, 20, 22, 24],
    legend: [24, 27, 30, 33, 36, 40]
  };
  LOH.DIFF_LABEL = { club: "Club Cricketer", first: "First Team", legend: "Tyger Legend" };
  /* target ramps up with each win this session (level), capped at the hardest */
  LOH.scenarioFor = function (diff, level) {
    const pool = LOH.POOLS[diff] || LOH.POOLS.club;
    return pool[Math.min(level, pool.length - 1)];
  };

  /* ------------------------------------------------------- commentary ----*/
  const C = {
    six:  ["SIX! The crowd erupts!", "Into the stands — what a hit!", "MAXIMUM! Tygerberg roars!", "That's gone miles!", "Clean as you like — SIX!"],
    four: ["FOUR! Races to the rope!", "Beautifully timed — four!", "Threads the gap, four runs!", "Cracking shot for four!"],
    one:  ["Tucked away, good running.", "Quick single taken.", "Works it into the gap.", "Smart cricket, keeps the strike."],
    dot:  ["Dot ball! Pressure mounts.", "No run — the bowler holds nerve.", "Beaten! Big moment.", "Dug out — but no run."],
    out:  ["GONE! The dream dies.", "Bowled him! Heartbreak.", "Caught! The chase is over.", "That's the wicket — silence falls."],
    win:  ["TYGERBERG WINS IT!", "Hero of the last over!", "Chased down — Facta Non Verba!", "The clubhouse erupts!"],
    lose: ["So close, yet so far.", "Not this time. Better luck next over.", "The chase falls short.", "Heartbreak at Florida Park."]
  };
  LOH.commentary = {
    pool: C,
    rand(arr) { return arr[(Math.random() * arr.length) | 0]; },
    /* situational line based on what's left */
    situation(runsReq, ballsLeft) {
      if (ballsLeft <= 0) return "";
      if (ballsLeft === 1) {
        if (runsReq <= 0) return "";
        if (runsReq === 1) return "One needed from the last ball!";
        if (runsReq === 2) return "Two needed from one!";
        if (runsReq <= 6) return runsReq + " to win off the final ball!";
        return "Needs a miracle: " + runsReq + " off 1!";
      }
      if (runsReq <= ballsLeft) return "Tygerberg believes!";
      if (runsReq <= ballsLeft * 2) return "Game on — " + runsReq + " off " + ballsLeft + ".";
      if (runsReq >= ballsLeft * 5) return "Pressure is on! Boundaries only.";
      return runsReq + " needed off " + ballsLeft + ".";
    }
  };

  /* ------------------------------------------------------------ audio ----*/
  const SFX = {
    ctx: null, master: null, muted: store.get("loh_muted") === "1",
    init() {
      if (this.ctx) return;
      try {
        const AC = global.AudioContext || global.webkitAudioContext;
        this.ctx = new AC(); this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; }
    },
    resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
    setMuted(m) { this.muted = m; store.set("loh_muted", m ? "1" : "0"); if (this.master) this.master.gain.value = m ? 0 : 0.9; },
    toggle() { this.setMuted(!this.muted); return this.muted; },
    _noise(d) { const n = Math.floor(this.ctx.sampleRate * d), b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), c = b.getChannelData(0); for (let i = 0; i < n; i++) c[i] = Math.random() * 2 - 1; const s = this.ctx.createBufferSource(); s.buffer = b; return s; },
    _env(g, t, a, p, d) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); },
    bat() { if (!this.ctx || this.muted) return; this.resume(); const t = this.ctx.currentTime; const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "triangle"; o.frequency.setValueAtTime(430, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08); this._env(g, t, 0.004, 0.5, 0.09); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.12); const nz = this._noise(0.05), ng = this.ctx.createGain(), bp = this.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; this._env(ng, t, 0.001, 0.35, 0.04); nz.connect(bp).connect(ng).connect(this.master); nz.start(t); nz.stop(t + 0.05); },
    cheer(l) { if (!this.ctx || this.muted) return; this.resume(); const t = this.ctx.currentTime, d = 0.55 + l * 0.3; const nz = this._noise(d), g = this.ctx.createGain(), bp = this.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(1400, t + d * 0.5); bp.Q.value = 0.7; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18 + l * 0.12, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + d); nz.connect(bp).connect(g).connect(this.master); nz.start(t); nz.stop(t + d); },
    horn() { if (!this.ctx || this.muted) return; this.resume(); const t = this.ctx.currentTime;[196, 262, 330].forEach((f, i) => { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "sawtooth"; o.frequency.value = f; this._env(g, t + i * 0.005, 0.02, 0.16, 0.5); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.6); }); },
    four() { this.bat(); this.cheer(0.4); },
    six() { this.bat(); this.horn(); this.cheer(1); },
    gold() { if (!this.ctx || this.muted) return; this.resume(); const t = this.ctx.currentTime;[880, 1320, 1760].forEach((f, i) => { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "sine"; o.frequency.value = f; this._env(g, t + i * 0.04, 0.005, 0.18, 0.55); o.connect(g).connect(this.master); o.start(t + i * 0.04); o.stop(t + i * 0.04 + 0.6); }); },
    appeal() { if (!this.ctx || this.muted) return; this.resume(); const t = this.ctx.currentTime, d = 0.5; const nz = this._noise(d), g = this.ctx.createGain(), bp = this.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1700, t + d); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + d * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + d); nz.connect(bp).connect(g).connect(this.master); nz.start(t); nz.stop(t + d); },
    wicket() { if (!this.ctx || this.muted) return; this.resume(); const t = this.ctx.currentTime; const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "sine"; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.25); this._env(g, t, 0.004, 0.6, 0.28); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.35); const nz = this._noise(0.22), ng = this.ctx.createGain(), hp = this.ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900; this._env(ng, t, 0.002, 0.4, 0.2); nz.connect(hp).connect(ng).connect(this.master); nz.start(t); nz.stop(t + 0.22); },
    win() { if (!this.ctx || this.muted) return; this.resume(); const t = this.ctx.currentTime;[523, 659, 784, 1047].forEach((f, i) => { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "triangle"; o.frequency.value = f; this._env(g, t + i * 0.12, 0.01, 0.2, 0.4); o.connect(g).connect(this.master); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.45); }); this.cheer(1); },
    lose() { if (!this.ctx || this.muted) return; this.resume(); const t = this.ctx.currentTime;[330, 262, 196].forEach((f, i) => { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "sine"; o.frequency.value = f; this._env(g, t + i * 0.16, 0.01, 0.18, 0.5); o.connect(g).connect(this.master); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.55); }); },
    ui() { if (!this.ctx || this.muted) return; this.resume(); const t = this.ctx.currentTime; const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = "square"; o.frequency.value = 660; this._env(g, t, 0.003, 0.12, 0.08); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.1); }
  };
  LOH.SFX = SFX;

  /* ------------------------------------------------------------ crest ----*/
  LOH.crestSVG = function () {
    return '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-label="Tygerberg Cricket Club crest">' +
      '<defs><radialGradient id="lohcg" cx="50%" cy="38%" r="65%"><stop offset="0%" stop-color="#1c1810"/><stop offset="100%" stop-color="#070707"/></radialGradient></defs>' +
      '<circle cx="50" cy="50" r="48" fill="url(#lohcg)" stroke="#C9A227" stroke-width="3"/>' +
      '<circle cx="50" cy="50" r="41" fill="none" stroke="#C9A227" stroke-width="1" opacity="0.5"/>' +
      '<g stroke="#C9A227" stroke-width="3.4" stroke-linecap="round" opacity="0.92"><line x1="30" y1="70" x2="58" y2="34"/><line x1="70" y1="70" x2="42" y2="34"/></g>' +
      '<circle cx="50" cy="74" r="5.4" fill="#C9A227"/><path d="M45.2 74 a5 6 0 0 0 9.6 0" fill="none" stroke="#070707" stroke-width="0.9"/>' +
      '<text x="50" y="49" text-anchor="middle" font-family="Bebas Neue, Impact, sans-serif" font-size="26" fill="#F5F2E8" letter-spacing="1">TCC</text>' +
      '<text x="50" y="22" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-size="6.5" fill="#C9A227" letter-spacing="2">EST&#8226;1957</text>' +
      '</svg>';
  };

  global.LOH = LOH;
})(window);
