/* TCC Player Registration — vanilla JS, no dependencies */
(function () {
  'use strict';

  var form = document.getElementById('regForm');
  var steps = Array.prototype.slice.call(document.querySelectorAll('.reg-step'));
  var stepPips = Array.prototype.slice.call(document.querySelectorAll('.reg-steps__item'));
  var stepLabel = document.getElementById('stepLabel');
  var btnBack = document.getElementById('btnBack');
  var btnNext = document.getElementById('btnNext');
  var btnSubmit = document.getElementById('btnSubmit');
  var current = 1;
  var TOTAL = 4;
  var isMinor = false;

  var STEP_NAMES = { 1: 'Player details', 2: 'Contact details', 3: 'Cricket profile', 4: 'Emergency, medical & consent' };

  /* ---------- validation ---------- */
  function setError(id, msg) {
    var input = document.getElementById(id);
    var err = document.getElementById('err-' + id);
    if (err) err.textContent = msg || '';
    if (input && input.type !== 'checkbox') {
      input.classList.toggle('is-invalid', !!msg);
      input.classList.toggle('is-valid', !msg && input.value.trim() !== '');
    }
  }

  function validateField(id) {
    var el = document.getElementById(id);
    if (!el) return true;
    var v = el.value.trim();

    switch (id) {
      case 'firstName':
      case 'surname':
      case 'emName':
      case 'guardianName':
        if (!v) { setError(id, 'This field is required.'); return false; }
        break;
      case 'dob':
        if (!v) { setError(id, 'Date of birth is required.'); return false; }
        if (new Date(v) > new Date()) { setError(id, 'Date of birth can\u2019t be in the future.'); return false; }
        break;
      case 'email':
        if (!v) { setError(id, 'Email is required.'); return false; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setError(id, 'Enter a valid email address.'); return false; }
        break;
      case 'phone':
      case 'emPhone':
      case 'guardianPhone':
        if (!v) { setError(id, 'A contact number is required.'); return false; }
        if (!/^[0-9+][0-9 \-()]{7,}$/.test(v)) { setError(id, 'Enter a valid phone number.'); return false; }
        break;
      case 'batting':
      case 'role':
      case 'guardianRel':
        if (!v) { setError(id, 'Please make a selection.'); return false; }
        break;
    }
    setError(id, '');
    return true;
  }

  function validateCheckbox(id, msg) {
    var el = document.getElementById(id);
    var ok = el && el.checked;
    setError(id, ok ? '' : msg);
    return ok;
  }

  var STEP_FIELDS = {
    1: ['firstName', 'surname', 'dob'],
    2: function () {
      var f = ['email', 'phone'];
      if (isMinor) f = f.concat(['guardianName', 'guardianPhone', 'guardianRel']);
      return f;
    },
    3: ['batting', 'role'],
    4: ['emName', 'emPhone']
  };

  function validateStep(n) {
    var fields = typeof STEP_FIELDS[n] === 'function' ? STEP_FIELDS[n]() : STEP_FIELDS[n];
    var ok = true;
    fields.forEach(function (id) { if (!validateField(id)) ok = false; });

    if (n === 4) {
      if (!validateCheckbox('popiaConsent', 'We can\u2019t register you without this consent.')) ok = false;
      if (!validateCheckbox('indemnityConsent', 'Please accept the Disclaimer & Indemnity to register.')) ok = false;
      if (isMinor && !validateCheckbox('guardianConsent', 'Parent/guardian consent is required for players under 18.')) ok = false;
      var med = document.getElementById('medical').value.trim();
      if (med && !validateCheckbox('medicalConsent', 'Consent is required if you share medical information (or clear the field).')) ok = false;
    }
    return ok;
  }

  /* validate on blur (per skill guideline: blur, not submit-only) */
  form.addEventListener('blur', function (e) {
    if (e.target.matches('input, select, textarea') && e.target.value.trim() !== '') {
      validateField(e.target.id);
    }
  }, true);

  /* ---------- age / minor handling ---------- */
  function ageGroupFor(age) {
    if (age >= 18) return 'Senior (1st\u20134th Team)';
    if (age >= 13) return 'Youth';
    if (age >= 12) return 'U13';
    if (age >= 11) return 'U12';
    if (age >= 10) return 'U11';
    if (age >= 9)  return 'U10';
    return 'Mini Cricket';
  }

  /* ── DOB dropdowns (mobile-friendly): three selects populate the hidden
        #dob field as YYYY-MM-DD, then fire its change so all existing logic
        (validation, age-group hint, minor detection, submit) works unchanged. ── */
  (function initDobSelects() {
    var daySel = document.getElementById('dob-day');
    var monSel = document.getElementById('dob-month');
    var yearSel = document.getElementById('dob-year');
    if (!daySel || !monSel || !yearSel) return;

    var months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
    months.forEach(function (m, i) {
      var o = document.createElement('option');
      o.value = String(i + 1).padStart(2, '0');
      o.textContent = m;
      monSel.appendChild(o);
    });

    // Years newest-first so recent birth years (most registrations) are on top.
    var thisYear = new Date().getFullYear();
    for (var y = thisYear; y >= thisYear - 100; y--) {
      var o = document.createElement('option');
      o.value = String(y);
      o.textContent = y;
      yearSel.appendChild(o);
    }

    // Days depend on the selected month/year (handles 28/29/30/31).
    function fillDays() {
      var prev = daySel.value;
      var m = parseInt(monSel.value, 10);
      var y = parseInt(yearSel.value, 10);
      var count = 31;
      if (m) count = new Date(y || 2000, m, 0).getDate(); // day 0 of next month = last day
      // rebuild
      daySel.innerHTML = '<option value="" disabled ' + (prev ? '' : 'selected') + '>Day</option>';
      for (var d = 1; d <= count; d++) {
        var o = document.createElement('option');
        o.value = String(d).padStart(2, '0');
        o.textContent = d;
        daySel.appendChild(o);
      }
      // restore previous day if still valid
      if (prev && parseInt(prev, 10) <= count) daySel.value = prev;
    }
    fillDays();

    function syncDob() {
      var d = daySel.value, m = monSel.value, y = yearSel.value;
      var dob = document.getElementById('dob');
      if (d && m && y) {
        dob.value = y + '-' + m + '-' + d;
      } else {
        dob.value = '';
      }
      dob.dispatchEvent(new Event('change')); // drives age-group + minor logic
    }

    monSel.addEventListener('change', function () { fillDays(); syncDob(); });
    yearSel.addEventListener('change', function () { fillDays(); syncDob(); });
    daySel.addEventListener('change', syncDob);
  })();

  document.getElementById('dob').addEventListener('change', function () {
    var v = this.value;
    var hint = document.getElementById('ageGroupHint');
    var guardian = document.getElementById('guardianBlock');
    var gConsent = document.getElementById('guardianConsentWrap');
    if (!v) { hint.hidden = true; return; }

    var dob = new Date(v);
    var now = new Date();
    var age = now.getFullYear() - dob.getFullYear();
    if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) age--;

    isMinor = age < 18;
    hint.hidden = false;
    hint.textContent = 'Likely age group: ' + ageGroupFor(age);
    guardian.hidden = !isMinor;
    gConsent.hidden = !isMinor;
    updateCard();
  });

  /* medical consent only appears when medical info is entered */
  document.getElementById('medical').addEventListener('input', function () {
    document.getElementById('medicalConsentWrap').hidden = this.value.trim() === '';
    if (this.value.trim() === '') setError('medicalConsent', '');
  });

  /* ---------- step navigation ---------- */
  function goTo(n) {
    current = n;
    steps.forEach(function (s) { s.classList.toggle('is-visible', +s.dataset.step === n); });
    stepPips.forEach(function (p) {
      var sn = +p.dataset.step;
      p.classList.toggle('is-active', sn === n);
      p.classList.toggle('is-done', sn < n);
    });
    stepLabel.textContent = 'Step ' + n + ' of ' + TOTAL + ' \u2014 ' + STEP_NAMES[n];
    btnBack.hidden = n === 1;
    btnNext.hidden = n === TOTAL;
    btnSubmit.hidden = n !== TOTAL;
    if (n === TOTAL) renderTurnstile();
    var first = steps[n - 1].querySelector('input, select, textarea');
    if (first) first.focus({ preventScroll: false });
  }

  btnNext.addEventListener('click', function () {
    if (validateStep(current)) goTo(current + 1);
  });
  btnBack.addEventListener('click', function () { goTo(current - 1); });

  /* ---------- live player card ---------- */
  function updateCard() {
    var name = (val('firstName') + ' ' + val('surname')).trim();
    var cardName = document.getElementById('cardName');
    cardName.textContent = name || 'Your name';
    cardName.classList.toggle('is-empty', !name);
    document.getElementById('cardNick').textContent = val('nickname') ? '\u201C' + val('nickname') + '\u201D' : '';
    document.getElementById('cardRole').textContent = val('role') || '\u2014';
    document.getElementById('cardBat').textContent = shortBat(val('batting'));
    document.getElementById('cardBowl').textContent = val('bowling') || '\u2014';
    var dob = val('dob');
    if (dob) {
      var hint = document.getElementById('ageGroupHint');
      document.getElementById('cardAge').textContent = hint.textContent.replace('Likely age group: ', '');
    }
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function shortBat(v) {
    if (v.indexOf('Right') === 0) return 'RHB';
    if (v.indexOf('Left') === 0) return 'LHB';
    return '\u2014';
  }
  form.addEventListener('input', updateCard);
  form.addEventListener('change', updateCard);

  /* ---------- submit ---------- */
  var WORKER_URL = 'https://tcc-admin.bydaries.workers.dev';
  /* Same public sitekey as the contact page — copy it from contact.html */
  /* Sitekey is defined once in main.js (window.TCC_TURNSTILE_SITEKEY).
     Fallback below is only used if register.html doesn't load main.js. */
  var TURNSTILE_SITEKEY = '0x4AAAAAACrt-KOiraItvVww';
  var turnstileId = null;

  /* Render lazily when step 4 becomes visible — Turnstile inside a
     display:none container renders zero-sized and never issues a token. */
  function renderTurnstile() {
    if (turnstileId !== null) return;                 /* already rendered */
    if (!TURNSTILE_SITEKEY || /PASTE_|REPLACE/.test(TURNSTILE_SITEKEY)) {
      console.error('TCC register: TURNSTILE_SITEKEY not set \u2014 set the real key in main.js (window.TCC_TURNSTILE_SITEKEY)');
      document.getElementById('err-turnstile').textContent =
        'Security check unavailable \u2014 please contact the club.';
      return;
    }
    if (!window.turnstile) { setTimeout(renderTurnstile, 200); return; }
    try {
    turnstileId = window.turnstile.render('#turnstileWidget', {
      sitekey: TURNSTILE_SITEKEY,
      theme: 'dark',
      'expired-callback': function () {
        /* Tokens expire after ~5 min; reset so a fresh one is issued */
        window.turnstile.reset(turnstileId);
      },
      'error-callback': function () {
        document.getElementById('err-turnstile').textContent =
          'Security check failed to load \u2014 refresh and try again.';
      }
    });
    } catch (e) {
      console.error('TCC register: Turnstile render failed \u2014', e);
      document.getElementById('err-turnstile').textContent =
        'Security check couldn\u2019t initialise \u2014 see console.';
    }
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!validateStep(4)) return;

    var tsToken = (window.turnstile && turnstileId !== null)
      ? window.turnstile.getResponse(turnstileId) : '';
    if (!tsToken) {
      document.getElementById('err-turnstile').textContent = (turnstileId === null)
        ? 'Security check never loaded \u2014 check the browser console (missing/invalid sitekey, or this domain isn\u2019t allowed for the Turnstile widget).'
        : 'Please complete the security check above \u2014 if you already did, it may have expired; tick it again.';
      return;
    }
    document.getElementById('err-turnstile').textContent = '';

    btnSubmit.classList.add('is-loading');
    btnSubmit.textContent = 'Submitting\u2026';

    var body = {
      action: 'registration.submit',
      payload: {
        website: val('website'), /* honeypot — must be empty */
        turnstileToken: tsToken,
        firstName: val('firstName'),
        surname: val('surname'),
        nickname: val('nickname') || null,
        dob: val('dob'),
        email: val('email'),
        phone: val('phone'),
        suburb: val('suburb') || null,
        guardianName: val('guardianName') || null,
        guardianPhone: val('guardianPhone') || null,
        guardianRelationship: val('guardianRel') || null,
        batting: val('batting'),
        bowling: val('bowling') || null,
        role: val('role'),
        previousClub: val('prevClub') || null,
        emergencyName: val('emName'),
        emergencyPhone: val('emPhone'),
        medicalInfo: val('medical') || null,
        medicalConsent: document.getElementById('medicalConsent').checked,
        popiaConsent: document.getElementById('popiaConsent').checked,
        mediaConsent: document.getElementById('mediaConsent').checked,
        indemnityConsent: document.getElementById('indemnityConsent').checked,
        guardianConsent: document.getElementById('guardianConsent').checked
      }
    };

    try {
      var res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      /* Read as text first — a non-JSON body (e.g. a Worker crash or an
         HTML error page) would otherwise throw on res.json() and hide
         the real status. */
      var raw = await res.text();
      var data = {};
      try { data = JSON.parse(raw); } catch (e) { /* not JSON */ }

      if (!res.ok || !data.ok) {
        var serverMsg = data.error || raw || ('HTTP ' + res.status);
        console.error('TCC register: submit failed', res.status, serverMsg);
        throw new Error(serverMsg);
      }

      form.hidden = true;
      document.querySelector('.reg-steps').hidden = true;
      stepLabel.hidden = true;
      document.getElementById('regSuccess').hidden = false;
      document.getElementById('regSuccess').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      btnSubmit.classList.remove('is-loading');
      btnSubmit.textContent = 'Submit registration';
      /* Turnstile tokens are single-use — reset so a retry gets a fresh one */
      if (window.turnstile && turnstileId !== null) window.turnstile.reset(turnstileId);

      var msg = err.message || '';
      var shown;
      if (msg === 'duplicate') {
        shown = 'This player is already pending review \u2014 no need to submit again.';
      } else if (/security check/i.test(msg)) {
        shown = 'The security check didn\u2019t verify \u2014 please tick it again and resubmit.';
      } else if (/consent/i.test(msg)) {
        shown = msg; /* Worker's consent message is already player-friendly */
      } else if (/missing field/i.test(msg)) {
        shown = 'A required field is missing: ' + msg.replace(/missing field:\s*/i, '') + '.';
      } else {
        /* Show the real reason so it can be reported/diagnosed, not a black box */
        shown = 'Registration couldn\u2019t be saved: ' + msg + '. Please try again, or contact the club.';
      }
      setError('indemnityConsent', shown);
    }
  });

})();
