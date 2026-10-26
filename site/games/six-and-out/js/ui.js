/* =====================================================================
   ui.js  —  storage, audio, leaderboard, achievements, crest, crowd lines
   No external libraries. Exposes a single global: TCC
   ===================================================================== */
(function (global) {
  "use strict";

  const TCC = {};

  /* ---------------------------------------------------------- storage ----
     localStorage works when the file is opened locally. In sandboxed
     previews it can throw, so we fall back to memory and never crash.    */
  const mem = {};
  const store = {
    get(k) {
      try { const v = localStorage.getItem(k); return v === null ? (mem[k] ?? null) : v; }
      catch (e) { return mem[k] ?? null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, v); } catch (e) {}
      mem[k] = v;
    }
  };
  TCC.store = store;

  /* ------------------------------------------------------------ audio ----
     Everything is synthesised with the Web Audio API — zero asset files. */
  const SFX = {
    ctx: null,
    master: null,
    muted: store.get("tcc_muted") === "1",

    init() {
      if (this.ctx) return;
      try {
        const AC = global.AudioContext || global.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; }
    },
    resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
    setMuted(m) {
      this.muted = m;
      store.set("tcc_muted", m ? "1" : "0");
      if (this.master) this.master.gain.value = m ? 0 : 0.9;
    },
    toggle() { this.setMuted(!this.muted); return this.muted; },

    _noise(dur) {
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      return src;
    },
    _env(node, t, a, peak, d) {
      const g = node.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.0001, t);
      g.exponentialRampToValueAtTime(peak, t + a);
      g.exponentialRampToValueAtTime(0.0001, t + a + d);
    },

    bat() {
      if (!this.ctx || this.muted) return; this.resume();
      const t = this.ctx.currentTime;
      // tonal "knock"
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
      this._env(g, t, 0.004, 0.5, 0.09); o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.12);
      // click transient
      const n = this._noise(0.05), ng = this.ctx.createGain(), bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1800;
      this._env(ng, t, 0.001, 0.35, 0.04); n.connect(bp).connect(ng).connect(this.master);
      n.start(t); n.stop(t + 0.05);
    },

    cheer(level) {
      if (!this.ctx || this.muted) return; this.resume();
      const t = this.ctx.currentTime, dur = 0.55 + level * 0.25;
      const n = this._noise(dur), g = this.ctx.createGain(), bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.setValueAtTime(700, t);
      bp.frequency.exponentialRampToValueAtTime(1400, t + dur * 0.5);
      bp.Q.value = 0.7;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18 + level * 0.12, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(bp).connect(g).connect(this.master);
      n.start(t); n.stop(t + dur);
    },

    horn() {
      if (!this.ctx || this.muted) return; this.resume();
      const t = this.ctx.currentTime;
      [196, 262, 330].forEach((f, i) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = "sawtooth"; o.frequency.value = f;
        this._env(g, t + i * 0.005, 0.02, 0.16, 0.5);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.6);
      });
    },

    four() { this.bat(); this.cheer(0.4); },
    six() { this.bat(); this.horn(); this.cheer(1); },

    gold() {
      if (!this.ctx || this.muted) return; this.resume();
      const t = this.ctx.currentTime;
      [880, 1320, 1760].forEach((f, i) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = "sine"; o.frequency.value = f;
        this._env(g, t + i * 0.04, 0.005, 0.18, 0.55);
        o.connect(g).connect(this.master); o.start(t + i * 0.04); o.stop(t + i * 0.04 + 0.6);
      });
    },

    appeal() {
      if (!this.ctx || this.muted) return; this.resume();
      const t = this.ctx.currentTime, dur = 0.5;
      const n = this._noise(dur), g = this.ctx.createGain(), bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(500, t);
      bp.frequency.exponentialRampToValueAtTime(1700, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(bp).connect(g).connect(this.master); n.start(t); n.stop(t + dur);
    },

    wicket() {
      if (!this.ctx || this.muted) return; this.resume();
      const t = this.ctx.currentTime;
      // low thud
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
      this._env(g, t, 0.004, 0.6, 0.28); o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.35);
      // timber clatter
      const n = this._noise(0.22), ng = this.ctx.createGain(), hp = this.ctx.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 900;
      this._env(ng, t, 0.002, 0.4, 0.2); n.connect(hp).connect(ng).connect(this.master);
      n.start(t); n.stop(t + 0.22);
    },

    fire() {
      if (!this.ctx || this.muted) return; this.resume();
      const t = this.ctx.currentTime;
      const n = this._noise(0.6), g = this.ctx.createGain(), bp = this.ctx.createBiquadFilter();
      bp.type = "lowpass"; bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(3000, t + 0.5);
      this._env(g, t, 0.05, 0.25, 0.5); n.connect(bp).connect(g).connect(this.master);
      n.start(t); n.stop(t + 0.6);
      this.horn();
    },

    ui() {
      if (!this.ctx || this.muted) return; this.resume();
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "square"; o.frequency.value = 660;
      this._env(g, t, 0.003, 0.12, 0.08); o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.1);
    }
  };
  TCC.SFX = SFX;

  /* ------------------------------------------------------- leaderboard ---
     This was localStorage, which meant every phone had its own private
     "Clubhouse Leaderboard" and nobody ever saw anybody else's score.
     It now reads from Supabase and writes through the Worker.

     What stays local, and why:

       CACHE_KEY  the last board we managed to fetch, so the screen has
                  something to show instantly and still works on the
                  clubhouse wifi when it drops.
       QUEUE_KEY  innings we could not send. The whole complaint was
                  that scores were not saved; an innings that is lost
                  because the network blinked is the same failure with
                  a better excuse. It goes in the queue and is sent on
                  the next load.
       CLIENT_KEY a random id this browser makes for itself. It is what
                  the Worker rate-limits against. It identifies a
                  browser, not a person, and is never shown.
  */
  const BOARD_KEY  = "tcc_board_v1";     // legacy local board, migrated once
  const CACHE_KEY  = "tcc_board_cache";
  const QUEUE_KEY  = "tcc_board_queue";
  const CLIENT_KEY = "tcc_client_id";
  const GAME_ID    = "six_and_out";

  TCC.config = {
    SUPABASE_URL: "https://cgjannvzpqecwzjdzwso.supabase.co",
    /* The anon key is a public credential — it is in every other
       deployed asset on the club site already, and RLS plus the grants
       in 1-game-scores.sql are what actually decide what it can reach:
       the leaderboard view, read only. */
    ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8",
    WORKER_URL: "https://tcc-admin.bydaries.workers.dev",
    timeout: 7000
  };

  function uuid() {
    try {
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    } catch (e) {}
    /* Older browsers, and any context where crypto is unavailable.
       This id only has to be unique, never unguessable. */
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function clientId() {
    let id = store.get(CLIENT_KEY);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "")) {
      id = uuid();
      store.set(CLIENT_KEY, id);
    }
    return id;
  }

  /* fetch with a deadline. A clubhouse connection that hangs is worse
     than one that fails, because the screen sits there saying nothing. */
  function fetchT(url, opts) {
    const o = opts || {};
    if (!global.AbortController) return fetch(url, o);
    const ac = new AbortController();
    const timer = setTimeout(function () { ac.abort(); }, TCC.config.timeout);
    o.signal = ac.signal;
    return fetch(url, o).then(
      function (r) { clearTimeout(timer); return r; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  function readJSON(key, fallback) {
    try { const v = JSON.parse(store.get(key) || "null"); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }

  const Board = {
    clientId: clientId,

    /* The last board we saw. Shown immediately, replaced when the real
       one arrives. */
    cached() { return readJSON(CACHE_KEY, []); },

    queue() { return readJSON(QUEUE_KEY, []); },

    /* The board, best innings per player. Falls back to the cache so
       the screen is never blank because of the network. */
    async top() {
      const c = TCC.config;
      try {
        const r = await fetchT(
          c.SUPABASE_URL + "/rest/v1/game_leaderboard?game=eq." + GAME_ID +
          "&select=name,score,balls&order=score.desc&limit=10",
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

    /* Send one innings. Returns { ok, rank, board, queued }.
       A failure is never silent and never loses the score: it goes in
       the queue and the caller is told it is pending. */
    async submit(entry) {
      const rec = {
        game: GAME_ID,
        name: String(entry.name || "Player").slice(0, 14),
        score: entry.score | 0,
        balls: entry.balls | 0,
        best_shot: entry.best_shot | 0,
        client_id: clientId(),
        ts: Date.now()
      };
      const res = await this._send(rec);
      if (res.ok) {
        if (Array.isArray(res.board)) store.set(CACHE_KEY, JSON.stringify(res.board));
        return res;
      }
      /* 4xx means the board will never accept this row — queuing it
         would retry forever. Anything else is the network's fault and
         is worth keeping. */
      if (res.permanent) return { ok: false, queued: false, error: res.error };
      const q = this.queue();
      q.push(rec);
      store.set(QUEUE_KEY, JSON.stringify(q.slice(-20)));
      return { ok: false, queued: true, error: res.error };
    },

    async _send(rec) {
      try {
        const r = await fetchT(TCC.config.WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "game.submitScore", payload: rec })
        });
        const data = await r.json().catch(function () { return {}; });
        if (r.ok && data && data.ok) {
          return { ok: true, rank: data.rank, board: data.board || [] };
        }
        return {
          ok: false,
          permanent: r.status >= 400 && r.status < 500 && r.status !== 429,
          error: (data && data.error) || ("HTTP " + r.status)
        };
      } catch (e) {
        return { ok: false, permanent: false, error: e.message || "offline" };
      }
    },

    /* Called on load. Sends anything stranded from a previous visit,
       plus a one-time migration of the old private board so a member's
       own best is not thrown away by this change. */
    async flush() {
      const pending = this.queue().concat(this._legacy());
      if (!pending.length) return 0;
      store.set(QUEUE_KEY, "[]");
      let sent = 0;
      const stillStuck = [];
      for (const rec of pending) {
        const res = await this._send(rec);
        if (res.ok) sent++;
        else if (!res.permanent) stillStuck.push(rec);
      }
      if (stillStuck.length) store.set(QUEUE_KEY, JSON.stringify(stillStuck.slice(-20)));
      return sent;
    },

    /* The old localStorage board, read once and then marked done.
       Balls were never recorded back then, so each entry is given the
       fewest balls its score could honestly have come off — otherwise
       the server's plausibility check refuses a real innings. */
    _legacy() {
      if (store.get("tcc_board_migrated") === "1") return [];
      store.set("tcc_board_migrated", "1");
      const old = readJSON(BOARD_KEY, []);
      if (!Array.isArray(old) || !old.length) return [];
      const id = clientId();
      return old.filter(function (e) { return e && e.score > 0; }).map(function (e) {
        return {
          game: GAME_ID,
          name: String(e.name || "Player").slice(0, 14),
          score: e.score | 0,
          balls: Math.max(1, Math.ceil((e.score | 0) / 39)),
          best_shot: 0,
          client_id: id,
          ts: e.ts || Date.now()
        };
      });
    }
  };
  TCC.Board = Board;

  /* ------------------------------------------------------ achievements ---*/
  const ACH_KEY = "tcc_ach_v1";
  const ACH = {
    first_run:  { name: "Off the Mark",      desc: "Got off the mark" },
    first_six:  { name: "Maximum",           desc: "Cleared the rope" },
    hat_six:    { name: "Three in the Stands",desc: "Three sixes in a row" },
    fifty:      { name: "Half Century",      desc: "Reached 50" },
    century:    { name: "Century",           desc: "Reached 100" },
    on_fire:    { name: "On Fire",           desc: "Hit Fire Mode" },
    golden:     { name: "Golden Touch",      desc: "Cashed in a golden ball" }
  };
  const Achievements = {
    defs: ACH,
    _set() { try { return new Set(JSON.parse(store.get(ACH_KEY) || "[]")); } catch (e) { return new Set(); } },
    has(id) { return this._set().has(id); },
    unlock(id) {
      if (!ACH[id]) return null;
      const s = this._set();
      if (s.has(id)) return null;
      s.add(id);
      store.set(ACH_KEY, JSON.stringify([...s]));
      return ACH[id];
    }
  };
  TCC.Achievements = Achievements;

  /* -------------------------------------------------------- crowd lines --*/
  TCC.crowd = {
    six:  ["MAXIMUM!", "INTO THE STANDS!", "GET IN!", "WHAT A SHOT!", "ALL THE WAY!", "FACTA NON VERBA!"],
    four: ["SHOT!", "FOUR!", "RACES AWAY!", "BEAUTY!", "CLASS!", "FIND THE GAP!"],
    rand(arr) { return arr[(Math.random() * arr.length) | 0]; }
  };

  /* ------------------------------------------------------------ toast ----*/
  let toastTimer = null;
  TCC.toast = function (kicker, name) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.innerHTML = '<span class="t-kicker">' + kicker + '</span><span class="t-name">' + name + "</span>";
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  };

  /* ------------------------------------------------------------ crest ----
     A self-contained SVG roundel: gold ring, crossed bats, ball, monogram. */
  TCC.crestSVG = function () {
    return (
      '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-label="Tygerberg Cricket Club crest">' +
        '<defs>' +
          '<radialGradient id="cg" cx="50%" cy="38%" r="65%">' +
            '<stop offset="0%" stop-color="#1c1810"/><stop offset="100%" stop-color="#070707"/>' +
          '</radialGradient>' +
        '</defs>' +
        '<circle cx="50" cy="50" r="48" fill="url(#cg)" stroke="#C9A227" stroke-width="3"/>' +
        '<circle cx="50" cy="50" r="41" fill="none" stroke="#C9A227" stroke-width="1" opacity="0.5"/>' +
        // crossed bats
        '<g stroke="#C9A227" stroke-width="3.4" stroke-linecap="round" opacity="0.92">' +
          '<line x1="30" y1="70" x2="58" y2="34"/>' +
          '<line x1="70" y1="70" x2="42" y2="34"/>' +
        '</g>' +
        // ball
        '<circle cx="50" cy="74" r="5.4" fill="#C9A227"/>' +
        '<path d="M45.2 74 a5 6 0 0 0 9.6 0" fill="none" stroke="#070707" stroke-width="0.9"/>' +
        // monogram
        '<text x="50" y="49" text-anchor="middle" font-family="Bebas Neue, Impact, sans-serif" font-size="26" fill="#F5F2E8" letter-spacing="1">TCC</text>' +
        '<text x="50" y="22" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-size="6.5" fill="#C9A227" letter-spacing="2">EST&#8226;1957</text>' +
      '</svg>'
    );
  };

  global.TCC = TCC;
})(window);
