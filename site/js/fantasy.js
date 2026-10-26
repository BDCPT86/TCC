/* ════════════════════════════════════════════════════
   TCC FANTASY — LANDING PAGE
   Handles: loading screen, GSAP, auth flow, OTP
════════════════════════════════════════════════════ */
var SB_URL  = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var WORKER  = 'https://tcc-admin.bydaries.workers.dev';
var H = { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON };

document.querySelectorAll('.copy-year').forEach(function(el){ el.textContent = new Date().getFullYear(); });

/* ══════════════════════════════════════════════════
   LOADING SCREEN
══════════════════════════════════════════════════ */
(function() {
  var loader    = document.getElementById('loader');
  var countEl   = document.getElementById('loader-count');
  var barEl     = document.getElementById('loader-bar');
  var wordEl    = document.getElementById('loader-word');
  if (!loader) return;

  var words     = ['Build', 'Pick', 'Score', 'Win'];
  var wordIdx   = 0;
  var count     = 0;
  var start     = null;
  var duration  = 2700;
  var wordTimer = null;

  function cycleWord() {
    if (!wordEl) return;
    wordEl.style.animation = 'none';
    wordEl.offsetHeight; // reflow
    wordIdx = (wordIdx + 1) % words.length;
    wordEl.textContent = words[wordIdx];
    wordEl.style.animation = 'wordIn 0.4s var(--ease) both';
  }
  wordTimer = setInterval(cycleWord, 900);

  function tick(ts) {
    if (!start) start = ts;
    var progress = Math.min((ts - start) / duration, 1);
    // easeInOut
    var eased = progress < 0.5 ? 2*progress*progress : -1+(4-2*progress)*progress;
    count = Math.round(eased * 100);
    if (countEl) countEl.textContent = String(count).padStart(3, '0');
    if (barEl)   barEl.style.width   = count + '%';
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      clearInterval(wordTimer);
      setTimeout(function() {
        loader.classList.add('done');
        document.body.classList.add('loaded');
        initPage();
      }, 400);
    }
  }
  requestAnimationFrame(tick);
})();

/* ══════════════════════════════════════════════════
   PAGE INIT (after loader)
══════════════════════════════════════════════════ */
function initPage() {
  // Hamburger nav
  var ham = document.getElementById('hamburger');
  if (ham) ham.addEventListener('click', function() {
    this.classList.toggle('open');
    var dr = document.getElementById('mobile-drawer');
    if (dr) dr.classList.toggle('open');
  });

  initGSAP();
  initRoleCycle();
  initParallax();
  initCountdown();
  initScrollReveal();
  initRoundStrip();
  initLiveData();
  checkExistingAuth();

  // Nav scroll shadow
  window.addEventListener('scroll', function() {
    var nav = document.getElementById('nav-pill');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 60);
  }, { passive: true });

  // CTAs
  ['hero-enter-btn','nav-cta-btn'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', openAuth);
  });
}

/* ══════════════════════════════════════════════════
   GSAP ENTRANCE
══════════════════════════════════════════════════ */
function initGSAP() {
  // Simple CSS-based entrance — no GSAP dependency
  var h1 = document.querySelector('.hero-h1');
  if (h1) {
    h1.style.transition = 'opacity 1.2s cubic-bezier(0.16,1,0.3,1), transform 1.2s cubic-bezier(0.16,1,0.3,1)';
    h1.style.transitionDelay = '0.1s';
    requestAnimationFrame(function() {
      h1.classList.add('entered');
    });
  }
  document.querySelectorAll('.blur-in').forEach(function(el, i) {
    el.style.transition = 'opacity 1s cubic-bezier(0.16,1,0.3,1), filter 1s, transform 1s cubic-bezier(0.16,1,0.3,1)';
    el.style.transitionDelay = (0.3 + i * 0.1) + 's';
    requestAnimationFrame(function() {
      el.classList.add('entered');
    });
  });
}

/* ══════════════════════════════════════════════════
   ROLE CYCLING
══════════════════════════════════════════════════ */
function initRoleCycle() {
  var roles  = ['Selector', 'Analyst', 'Tactician', 'Captain'];
  var el     = document.getElementById('hero-role');
  if (!el) return;
  var idx    = 0;
  setInterval(function() {
    el.style.animation = 'none';
    el.offsetHeight;
    idx = (idx + 1) % roles.length;
    el.textContent = roles[idx];
    el.style.animation = 'role-fade-in 0.4s ease-out both';
  }, 2000);
}

/* ══════════════════════════════════════════════════
   PARALLAX SCROLL
══════════════════════════════════════════════════ */
function initParallax() {
  var heroVid   = document.getElementById('hero-vid');
  var footerImg = document.getElementById('footer-img');
  var ticking   = false;
  window.addEventListener('scroll', function() {
    if (ticking) return;
    requestAnimationFrame(function() {
      var sy = window.scrollY;
      var wh = window.innerHeight;
      if (heroVid) heroVid.style.transform = 'translate(-50%,-50%) translateY(' + (sy * 0.25) + 'px)';
      if (footerImg) {
        var r = footerImg.closest('.footer-img-section').getBoundingClientRect();
        var rel = (wh - r.top) / (wh + r.height);
        footerImg.style.transform = 'translateY(' + ((rel - 0.5) * -70) + 'px)';
      }
      ticking = false;
    });
    ticking = true;
  }, { passive: true });
}

/* ══════════════════════════════════════════════════
   BENTO BAR ANIMATION
══════════════════════════════════════════════════ */
function initBentoBars() {
  var bars = document.querySelectorAll('.bc-bar-fill');
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) { e.target.style.width = e.target.dataset.width || '68%'; }
    });
  }, { threshold: 0.3 });
  bars.forEach(function(b) {
    b.dataset.width = b.style.width || '68%';
    b.style.width   = '0%';
    observer.observe(b);
  });
}

/* ══════════════════════════════════════════════════
   SCROLL REVEAL
══════════════════════════════════════════════════ */
function initScrollReveal() {
  var items = document.querySelectorAll('.fade-up');
  // Stagger bento cards
  document.querySelectorAll('.bento-card').forEach(function(card, i) {
    card.style.setProperty('--delay', (i * 0.07) + 's');
  });
  var obs = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  items.forEach(function(el) { obs.observe(el); });
}

/* ══════════════════════════════════════════════════
   COUNTDOWN
══════════════════════════════════════════════════ */
async function initCountdown() {
  try {
    var r = await fetch(SB_URL+'/rest/v1/fantasy_rounds?locked=eq.false&order=created_at.desc&limit=1', {headers:H});
    var rows = await r.json();
    if (!rows || !rows.length) return;
    var deadline = new Date(rows[0].deadline);
    var cdEl     = document.getElementById('hero-countdown');
    var tmEl     = document.getElementById('hero-timer');
    var stripEl  = document.getElementById('hero-deadline-strip');
    var stripTm  = document.getElementById('hero-timer-mobile');
    if (cdEl) cdEl.style.display = 'block';
    if (stripEl) stripEl.dataset.active = 'true'; // CSS shows this on mobile only
    function pad(n){ return n < 10 ? '0'+n : n; }
    (function tick() {
      var diff = deadline - new Date();
      var str  = diff <= 0 ? 'CLOSED' : pad(Math.floor(diff/3600000))+':'+pad(Math.floor((diff%3600000)/60000))+':'+pad(Math.floor((diff%60000)/1000));
      if (tmEl)     tmEl.textContent     = str;
      if (stripTm)  stripTm.textContent  = str;
      if (diff > 0) setTimeout(tick, 1000);
    })();
  } catch(e) {}
}

/* ══════════════════════════════════════════════════
   AUTH CHECK
══════════════════════════════════════════════════ */
function checkExistingAuth() {
  var saved = localStorage.getItem('tcc_fantasy_participant');
  if (!saved) return;
  try {
    var p = JSON.parse(saved);
    if (!p || !p.id) return;
    if (p.status && p.status !== 'approved') return;
    // Logged in — update CTAs to link to pick screen instead of opening auth overlay
    var label = (p.team_name || p.name || 'My Team');
    ['hero-enter-btn','nav-cta-btn'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      // Update the inner text span if it exists, otherwise fall back to textContent
      var inner = el.querySelector('.nav-sh-inner');
      if (inner) {
        inner.textContent = id === 'nav-cta-btn' ? label : 'Pick XI →';
      } else {
        el.textContent = id === 'nav-cta-btn' ? label : 'Pick XI →';
      }
      el.removeEventListener('click', openAuth);
      el.addEventListener('click', function() { window.location.href = 'pick.html'; });
    });
    // Update the pick tile label
    var pickTile = document.querySelector('.fn-tile-pick .fn-tile-label');
    if (pickTile) pickTile.textContent = label;
    // Show My Team nav link
    var profileLink = document.getElementById('nav-profile-link');
    if (profileLink) profileLink.style.display = '';
    var drawerLink = document.getElementById('drawer-profile-link');
    if (drawerLink) drawerLink.style.display = '';
  } catch(e) { localStorage.removeItem('tcc_fantasy_participant'); }
}

/* ══════════════════════════════════════════════════
   AUTH OVERLAY
══════════════════════════════════════════════════ */
var SCREENS = ['screen-no-round','screen-register','screen-name','screen-otp','screen-profile','screen-pending'];
function showScreen(id) {
  SCREENS.forEach(function(s) {
    var el = document.getElementById(s);
    if (el) el.style.display = s === id ? 'flex' : 'none';
  });
}
function openAuth() {
  var overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'flex';
  showScreen('screen-register');
  setTimeout(function() { var e = document.getElementById('reg-email'); if (e) e.focus(); }, 300);
}
function closeAuth() {
  var overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'none';
}
window.closeAuth = closeAuth;

/* Backdrop click closes */
document.getElementById('auth-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeAuth();
});

/* ── Step 1: Email — check status then route ── */
var pendingEmail = '', pendingName = '', pendingTeamName = '', otpInterval = null;

document.getElementById('reg-btn').addEventListener('click', async function() {
  var email = document.getElementById('reg-email').value.trim();
  var errEl = document.getElementById('reg-error');
  errEl.textContent = '';
  if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) { errEl.textContent = 'Please enter a valid email.'; return; }
  this.disabled = true; document.getElementById('reg-btn-label').textContent = 'Checking…';
  try {
    pendingEmail = email;

    /* The Worker decides whether this address is known, not the
       browser.

       This used to look the member up directly:

         fantasy_participants?email=eq.<you>&select=id,name,team_name,status

       and it broke the moment the email column was closed to anon.
       PostgREST answered 401, `await r.json()` turned that into an
       error OBJECT rather than an array, `existing.length` came back
       undefined, and the code fell straight through to "new
       registration". Every approved member was shown the sign-up form.
       Nothing caught it because `r.ok` was never checked.

       It should never have been a browser query in the first place.
       It let anyone test whether an address was registered AND handed
       back that person's real name and team name with it. The Worker
       looks it up with the service key — the only credential that can
       see the participants table — and answers with what should happen
       next, and nothing else. */
    var r = await fetch(WORKER, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ action:'fantasy.sendOTP', payload:{ email: email } })
    });
    var d = await r.json().catch(function(){ return {}; });

    if (r.ok) {
      /* Known and approved — a code is on its way. Deliberately no
         name or team comes back here: the code has not been verified
         yet, so whoever typed this address has proved nothing. */
      pendingName = ''; pendingTeamName = '';
      showOTPScreen(false);
      return;
    }

    if (r.status === 404) { showScreen('screen-name'); return; }

    if (r.status === 403 && d.error === 'pending') {
      document.getElementById('pending-email-display').textContent = email;
      showScreen('screen-pending');
      return;
    }
    if (r.status === 403 && d.error === 'rejected') {
      errEl.textContent = 'This email is not approved for the league — please contact the club.';
      return;
    }
    if (r.status === 429) {
      errEl.textContent = d.error || 'Too many codes requested — wait a few minutes and try again.';
      return;
    }
    errEl.textContent = d.error || 'Something went wrong.';
  } catch(e) { errEl.textContent = e.message || 'Something went wrong.'; }
  finally { this.disabled = false; document.getElementById('reg-btn-label').textContent = 'Continue'; }
});
document.getElementById('reg-email').addEventListener('keydown', function(e){ if(e.key==='Enter') document.getElementById('reg-btn').click(); });

/* ── Step 2: New registration request ── */
document.getElementById('name-btn').addEventListener('click', async function() {
  var name = document.getElementById('reg-name').value.trim();
  var team = document.getElementById('reg-team-name').value.trim();
  var errEl = document.getElementById('name-error');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Please enter your name.'; return; }
  if (!team) { errEl.textContent = 'Please enter a team name.'; return; }
  this.disabled = true; document.getElementById('name-btn-label').textContent = 'Sending request…';
  try {
    pendingName = name; pendingTeamName = team;
    var r = await fetch(WORKER, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ action:'fantasy.register', payload:{ email:pendingEmail, name:name, teamName:team } })
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Registration failed');
    if (d.status === 'approved') {
      // Edge case — was just approved between checks
      var otpResult = await sendOTP(pendingEmail, pendingName);
      showOTPScreen(true);
    } else {
      // Pending — show waiting screen
      document.getElementById('pending-email-display').textContent = pendingEmail;
      showScreen('screen-pending');
    }
  } catch(e) { errEl.textContent = e.message || 'Could not submit request.'; }
  finally { this.disabled = false; document.getElementById('name-btn-label').textContent = 'Request Access'; }
});

async function sendOTP(email, name) {
  var r = await fetch(WORKER, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ action:'fantasy.sendOTP', payload:{ email:email, name:name } })
  });
  var d = await r.json();
  if (r.status === 403) return d; // Return error object for status checks
  if (!r.ok) throw new Error(d.error || 'Send failed');
  return d;
}

function showOTPScreen(isNew) {
  document.getElementById('otp-email-display').textContent = pendingEmail;
  document.getElementById('otp-step-label').textContent = isNew ? '03 / 03' : '02 / 02';
  document.getElementById('otp-input').value = '';
  document.getElementById('otp-error').textContent = '';
  showScreen('screen-otp');
  startOTPRing();
  setTimeout(function(){ var e = document.getElementById('otp-input'); if(e) e.focus(); }, 300);
}

/* OTP Ring */
function startOTPRing() {
  if (otpInterval) clearInterval(otpInterval);
  var ring = document.getElementById('otp-ring');
  var txt  = document.getElementById('otp-timer');
  var circ = 169.6; var elapsed = 0;
  if (ring) { ring.style.strokeDashoffset = '0'; }
  otpInterval = setInterval(function() {
    elapsed++;
    var rem = 120 - elapsed;
    if (txt) { var m = Math.floor(rem/60), s = rem%60; txt.textContent = m+':'+(s<10?'0':'')+s; }
    if (ring) ring.style.strokeDashoffset = String(circ * elapsed / 120);
    if (rem <= 0) { clearInterval(otpInterval); if(txt) txt.textContent = '0:00'; }
  }, 1000);
}

/* ── Step 3: Verify ── */
document.getElementById('otp-btn').addEventListener('click', verifyOTP);
document.getElementById('otp-input').addEventListener('keydown', function(e){ if(e.key==='Enter') verifyOTP(); });

async function verifyOTP() {
  var code = document.getElementById('otp-input').value.trim();
  var errEl = document.getElementById('otp-error');
  var btn = document.getElementById('otp-btn');
  var lbl = document.getElementById('otp-btn-label');
  errEl.textContent = '';
  if (code.length !== 6) { errEl.textContent = 'Please enter the 6-digit code.'; return; }
  btn.disabled = true; lbl.textContent = 'Verifying…';
  try {
    var r = await fetch(WORKER, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ action:'fantasy.verifyOTP', payload:{ email:pendingEmail, code:code, name:pendingName, teamName:pendingTeamName } })
    });
    var d = await r.json();
    if (!r.ok) { errEl.textContent = d.error === 'Code expired' ? 'Code expired — resend.' : 'Invalid code. Try again.'; btn.disabled=false; lbl.textContent='Verify'; return; }
    clearInterval(otpInterval);
    var pObj = d.participant || {};
    pObj.token = d.token || null;   // signed participant token — authorises picks + profile edits
    localStorage.setItem('tcc_fantasy_participant', JSON.stringify(pObj));
    window.location.href = 'fantasy.html';
  } catch(e) { errEl.textContent = 'Something went wrong.'; btn.disabled=false; lbl.textContent='Verify'; }
}

document.getElementById('otp-resend-btn').addEventListener('click', async function() {
  this.disabled = true; this.textContent = 'Sending…';
  try { var resendResult = await sendOTP(pendingEmail, pendingName); if (resendResult && resendResult.error) { document.getElementById('otp-error').textContent = 'Could not resend — ' + resendResult.error; return; } startOTPRing(); document.getElementById('otp-input').value = ''; document.getElementById('otp-error').textContent = ''; }
  catch(e) { document.getElementById('otp-error').textContent = 'Could not resend.'; }
  finally { this.disabled = false; this.textContent = 'Resend code'; }
});

document.getElementById('otp-back-btn').addEventListener('click', function() {
  clearInterval(otpInterval); pendingEmail=''; pendingName=''; pendingTeamName='';
  showScreen('screen-register');
});

/* Profile */
var profileSaveBtn = document.getElementById('profile-save-btn');
if (profileSaveBtn) profileSaveBtn.addEventListener('click', async function() {
  var name = document.getElementById('profile-name').value.trim();
  var team = document.getElementById('profile-team-name').value.trim();
  var errEl = document.getElementById('profile-error');
  var lbl   = document.getElementById('profile-save-label');
  errEl.textContent = '';
  if (!team) { errEl.textContent = 'Please enter a team name.'; return; }
  this.disabled = true; lbl.textContent = 'Saving…';
  try {
    var saved = JSON.parse(localStorage.getItem('tcc_fantasy_participant')||'{}');
    var r = await fetch(WORKER, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ action:'fantasy.updateProfile', token: saved.token || null, payload:{ id:saved.id, team_name:team, name:name||saved.name } })
    });
    if (r.status === 401 || r.status === 403) {
      localStorage.removeItem('tcc_fantasy_participant');
      errEl.textContent = 'Session expired — please verify your email again.';
      setTimeout(function(){ window.location.href = 'fantasy.html'; }, 1500);
      return;
    }
    if (!r.ok) throw new Error('Save failed');
    saved.team_name = team; if (name) saved.name = name;
    localStorage.setItem('tcc_fantasy_participant', JSON.stringify(saved));
    window.location.href = 'fantasy.html';
  } catch(e) { errEl.textContent = 'Could not save.'; }
  finally { this.disabled = false; lbl.textContent = 'Save'; }
});
var profileBackBtn = document.getElementById('profile-back-btn');
if (profileBackBtn) profileBackBtn.addEventListener('click', function(){ window.location.href='fantasy.html'; });

/* ══════════════════════════════════════════════════
   ROUND STRIP
   Shows active round name, deadline, pick link
══════════════════════════════════════════════════ */
async function initRoundStrip() {
  try {
    var r = await fetch(SB_URL+'/rest/v1/fantasy_rounds?locked=eq.false&order=deadline.asc&limit=1&select=id,name,deadline,wildcard,h2h,boost_modifier', {headers:H});
    var rows = await r.json();
    if (!rows || !rows.length) return;
    var round = rows[0];
    var strip = document.getElementById('fn-round-strip');
    if (!strip) return;

    // Badge label
    var badge = document.getElementById('fn-rs-badge');
    var badgeText = round.wildcard ? 'Wildcard' : round.h2h ? 'H2H Round' : 'Active Round';
    if (badge) badge.textContent = badgeText;

    // Name
    var nameEl = document.getElementById('fn-rs-name');
    if (nameEl) nameEl.textContent = round.name;

    // Deadline
    var dlEl = document.getElementById('fn-rs-deadline');
    if (dlEl && round.deadline) {
      var dl = new Date(round.deadline);
      dlEl.textContent = 'Deadline: ' + dl.toLocaleDateString('en-ZA', {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    }

    // Boost / wildcard indicator
    var boostEl = document.getElementById('fn-rs-boost');
    if (boostEl) {
      var boostLabels = {
        bowlers_double:    '🎯 Bowlers ×2',
        batters_double:    '🏏 Batters ×2',
        allrounders_boost: '⚡ All-Rounders ×1.5',
        bonus_economy:     '📉 Economy bonus ×2',
        potm_double:       '🏆 POTM ×2'
      };
      var pills = [];
      if (round.wildcard) pills.push('⭐ Wildcard — Captain ×3');
      if (round.boost_modifier && boostLabels[round.boost_modifier]) pills.push('🚀 ' + boostLabels[round.boost_modifier]);
      if (pills.length) {
        boostEl.innerHTML = pills.map(function(p){ return '<span class="fn-rs-boost-pill">' + p + '</span>'; }).join('');
        boostEl.style.display = 'flex';
      } else {
        boostEl.style.display = 'none';
      }
    }

    strip.style.display = 'flex';
  } catch(e) {}
}

/* ══════════════════════════════════════════════════
   LIVE DATA PANELS
   Mini leaderboard + season stats
══════════════════════════════════════════════════ */
async function initLiveData() {
  try {
    var safeArr = function(v) { return Array.isArray(v) ? v : []; };

    var [lbRows, participants, rounds] = await Promise.all([
      fetch(SB_URL+'/rest/v1/fantasy_leaderboard_summary?select=team_name,name,total_points&order=total_points.desc&limit=5', {headers:H}).then(function(r){return r.ok?r.json():[];}),
      fetch(SB_URL+'/rest/v1/fantasy_participants?status=eq.approved&select=id', {headers:H}).then(function(r){return r.ok?r.json():[];}),
      fetch(SB_URL+'/rest/v1/fantasy_rounds?scored=eq.true&select=id', {headers:H}).then(function(r){return r.ok?r.json():[];}),
    ]);

    lbRows      = safeArr(lbRows);
    participants = safeArr(participants);
    rounds      = safeArr(rounds);

    // ── Leaderboard ──
    var lbWrap = document.getElementById('fn-lb-rows');
    if (lbWrap) {
      if (!lbRows.length) {
        lbWrap.innerHTML = '<div class="fn-lb-empty">No scores yet — check back after the first round.</div>';
      } else {
        var rankClasses = ['gold','silver','bronze','',''];
        lbWrap.innerHTML = lbRows.map(function(row, i) {
          var teamName = row.team_name || row.name || '—';
          var subName  = row.team_name && row.name ? row.name : null;
          return '<div class="fn-lb-row">'
            + '<div class="fn-lb-rank ' + (rankClasses[i]||'') + '">' + (i+1) + '</div>'
            + '<div style="min-width:0">'
            +   '<div class="fn-lb-name">' + teamName + '</div>'
            +   (subName ? '<div class="fn-lb-sub">' + subName + '</div>' : '')
            + '</div>'
            + '<div class="fn-lb-pts">' + (row.total_points||0) + '<span>pts</span></div>'
            + '</div>';
        }).join('');
      }
    }

    // ── Stats cards ──
    var topPts = lbRows.length ? (lbRows[0].total_points || 0) : 0;
    var pEl = document.getElementById('fn-stat-players');
    var rEl = document.getElementById('fn-stat-rounds');
    var tEl = document.getElementById('fn-stat-top');
    if (pEl) pEl.textContent = participants.length || '—';
    if (rEl) rEl.textContent = rounds.length || '—';
    if (tEl) tEl.textContent = topPts || '—';

  } catch(e) {
    var lbWrap = document.getElementById('fn-lb-rows');
    if (lbWrap) lbWrap.innerHTML = '<div class="fn-lb-empty">Could not load standings.</div>';
  }
}
