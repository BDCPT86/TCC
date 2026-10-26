'use strict';

var SB_URL  = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var WORKER  = 'https://tcc-admin.bydaries.workers.dev';
var H = { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON };

var pendingEmail = '';
var pendingName  = '';
var otpTimer     = null;

// ── NAV ───────────────────────────────────────────────
document.getElementById('hamburger').addEventListener('click', function() {
  this.classList.toggle('open');
  document.getElementById('nav-links').classList.toggle('open');
});
document.querySelector('.copy-year').textContent = new Date().getFullYear();

// ── MEMBER COUNT ──────────────────────────────────────
(async function loadCount() {
  try {
    var r = await fetch(SB_URL + '/rest/v1/members?select=id&status=eq.approved', { headers: H });
    if (!r.ok) return;
    var data = await r.json();
    var el = document.getElementById('member-count');
    if (el && data.length > 0) el.textContent = data.length;
  } catch(e) {}
})();

// ── OPEN / CLOSE MODAL ────────────────────────────────
function openForm(tier, price) {
  document.getElementById('modal-tier-label').textContent = tier + ' — ' + price;
  document.getElementById('mem-tier').value = tier;
  showStep('form');
  document.getElementById('mem-modal').style.display = 'flex';
  setTimeout(function() { document.getElementById('mem-name').focus(); }, 200);
}

function closeModal() {
  document.getElementById('mem-modal').style.display = 'none';
  clearOTPTimer();
  // reset
  document.getElementById('mem-name').value = '';
  document.getElementById('mem-email').value = '';
  document.getElementById('mem-phone').value = '';
  document.getElementById('mem-dob').value = '';
  document.getElementById('mem-position').value = '';
  document.getElementById('mem-prev-club').value = '';
  document.getElementById('mem-consent').checked = false;
  document.getElementById('form-error').textContent = '';
  document.getElementById('otp-error').textContent = '';
  document.getElementById('otp-input').value = '';
  pendingEmail = ''; pendingName = '';
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('mem-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

function showStep(step) {
  document.getElementById('step-form').style.display    = step === 'form'    ? 'block' : 'none';
  document.getElementById('step-otp').style.display     = step === 'otp'     ? 'block' : 'none';
  document.getElementById('step-success').style.display = step === 'success' ? 'block' : 'none';
}

// ── FORM SUBMIT ───────────────────────────────────────
document.getElementById('form-submit-btn').addEventListener('click', async function() {
  var errEl = document.getElementById('form-error');
  errEl.textContent = '';

  var name     = document.getElementById('mem-name').value.trim();
  var email    = document.getElementById('mem-email').value.trim();
  var phone    = document.getElementById('mem-phone').value.trim();
  var dob      = document.getElementById('mem-dob').value;
  var tier     = document.getElementById('mem-tier').value;
  var position = document.getElementById('mem-position').value.trim();
  var prevClub = document.getElementById('mem-prev-club').value.trim();
  var consent  = document.getElementById('mem-consent').checked;

  if (!name)    { errEl.textContent = 'Please enter your full name.'; return; }
  if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) { errEl.textContent = 'Please enter a valid email address.'; return; }
  if (!dob)     { errEl.textContent = 'Please enter your date of birth.'; return; }
  if (!consent) { errEl.textContent = 'Please agree to the club constitution and code of conduct.'; return; }

  this.disabled = true;
  this.textContent = 'Submitting…';

  try {
    var r = await fetch(WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'membership.register',
        payload: { name, email, phone, dob, tier, position, prevClub }
      })
    });
    var data = await r.json();

    if (data.error) {
      errEl.textContent = data.error;
    } else {
      pendingEmail = email;
      pendingName  = name;
      document.getElementById('otp-email-display').textContent = email;
      startOTPTimer();
      showStep('otp');
    }
  } catch(e) {
    errEl.textContent = 'Network error — please try again.';
  }

  this.disabled = false;
  this.textContent = 'Submit Registration';
});

// ── OTP ───────────────────────────────────────────────
document.getElementById('otp-btn').addEventListener('click', verifyOTP);
document.getElementById('otp-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') verifyOTP();
});
document.getElementById('otp-resend').addEventListener('click', async function() {
  try {
    await fetch(WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'membership.sendOTP', payload: { email: pendingEmail, name: pendingName }})
    });
    clearOTPTimer(); startOTPTimer();
    document.getElementById('otp-input').value = '';
    document.getElementById('otp-error').textContent = '';
  } catch(e) {}
});

async function verifyOTP() {
  var errEl = document.getElementById('otp-error');
  var code  = document.getElementById('otp-input').value.trim();
  errEl.textContent = '';
  if (code.length !== 6) { errEl.textContent = 'Please enter the 6-digit code.'; return; }

  var btn = document.getElementById('otp-btn');
  btn.disabled = true; btn.textContent = 'Verifying…';

  try {
    var r = await fetch(WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'membership.verifyOTP', payload: { email: pendingEmail, code } })
    });
    var data = await r.json();
    if (data.error) {
      errEl.textContent = data.error;
    } else {
      clearOTPTimer();
      showStep('success');
    }
  } catch(e) {
    errEl.textContent = 'Network error — please try again.';
  }

  btn.disabled = false; btn.textContent = 'Verify Code';
}

// OTP countdown ring (10 min)
function startOTPTimer() {
  var total = 600; var remaining = total;
  var circle = document.getElementById('otp-ring-circle');
  var timerEl = document.getElementById('otp-timer');
  var circumference = 2 * Math.PI * 26; // r=26

  function tick() {
    remaining--;
    var pct = remaining / total;
    circle.style.strokeDashoffset = circumference * (1 - pct);
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    if (remaining <= 0) {
      clearOTPTimer();
      document.getElementById('otp-error').textContent = 'Code expired — please request a new one.';
    }
  }
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = 0;
  tick();
  otpTimer = setInterval(tick, 1000);
}

function clearOTPTimer() {
  if (otpTimer) { clearInterval(otpTimer); otpTimer = null; }
}
