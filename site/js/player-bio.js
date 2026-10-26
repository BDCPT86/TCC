var SB_URL  = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var WORKER  = 'https://tcc-admin.bydaries.workers.dev';
var H = { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON };

var selectedPhotoFile = null;

/* ── Load squad into player dropdown ── */
(async function loadPlayers() {
  var sel = document.getElementById('f-player');
  if (!sel) return;
  try {
    var r = await fetch(
      SB_URL + '/rest/v1/players?select=id,name&order=name.asc&limit=200',
      { headers: H }
    );
    if (!r.ok) throw new Error('Failed to load');
    var players = await r.json();
    sel.innerHTML = '<option value="">Select your name…</option>';
    if (!players.length) {
      sel.innerHTML = '<option value="">No players found</option>';
      return;
    }
    players.forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  } catch(e) {
    sel.innerHTML = '<option value="">Could not load squad — try refreshing</option>';
  }
})();

/* ── Character counters ── */
function initCounter(inputId, counterId, max) {
  var input   = document.getElementById(inputId);
  var counter = document.getElementById(counterId);
  if (!input || !counter) return;
  function update() {
    var len = input.value.length;
    counter.textContent = len + ' / ' + max;
    counter.className = 'field-counter' + (len > max * 0.9 ? (len >= max ? ' over' : ' warn') : '');
  }
  input.addEventListener('input', update);
  update();
}
initCounter('f-bio',  'bio-counter',  300);
initCounter('f-fact', 'fact-counter', 120);

/* ── Photo upload ── */
var dropzone   = document.getElementById('photo-dropzone');
var fileInput  = document.getElementById('f-photo');
var preview    = document.getElementById('photo-preview');
var dzInner    = document.getElementById('photo-dz-inner');
var clearBtn   = document.getElementById('photo-clear-btn');
var photoErr   = document.getElementById('photo-error');

dropzone.addEventListener('click', function() { fileInput.click(); });
dropzone.addEventListener('dragover', function(e) { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', function() { dropzone.classList.remove('drag-over'); });
dropzone.addEventListener('drop', function(e) {
  e.preventDefault(); dropzone.classList.remove('drag-over');
  var file = e.dataTransfer.files[0];
  if (file) handlePhotoFile(file);
});
fileInput.addEventListener('change', function() {
  if (this.files[0]) handlePhotoFile(this.files[0]);
  this.value = '';
});
clearBtn.addEventListener('click', function() { clearPhoto(); });

function handlePhotoFile(file) {
  photoErr.textContent = '';
  if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
    photoErr.textContent = 'Please select a JPG, PNG or WebP image.'; return;
  }
  if (file.size > 5 * 1024 * 1024) {
    photoErr.textContent = 'Photo must be under 5MB.'; return;
  }
  // Compress to max 800px wide, 0.85 quality
  compressImage(file, 800, 0.85, function(compressed) {
    selectedPhotoFile = compressed;
    var url = URL.createObjectURL(compressed);
    preview.src = url;
    preview.style.display = 'block';
    dzInner.style.display  = 'none';
    clearBtn.style.display = 'inline-flex';
  });
}

function clearPhoto() {
  selectedPhotoFile = null;
  preview.style.display  = 'none';
  preview.src            = '';
  dzInner.style.display  = 'flex';
  clearBtn.style.display = 'none';
  photoErr.textContent   = '';
}

function compressImage(file, maxWidth, quality, cb) {
  var img = new Image();
  var url = URL.createObjectURL(file);
  img.onload = function() {
    URL.revokeObjectURL(url);
    var w = img.naturalWidth, h = img.naturalHeight;
    if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    canvas.toBlob(function(blob) {
      cb(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
    }, 'image/jpeg', quality);
  };
  img.src = url;
}

/* ── Check if already submitted ── */
(function() {
  if (localStorage.getItem('tcc_bio_submitted')) {
    document.getElementById('bio-form').style.display   = 'none';
    document.getElementById('bio-already').style.display = 'flex';
    document.querySelector('.bio-hero').style.display   = 'none';
  }
})();

/* ── Form submission ── */
document.getElementById('bio-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  var errEl = document.getElementById('form-error');
  var btn   = document.getElementById('bio-submit-btn');
  errEl.textContent = '';

  var playerSel = document.getElementById('f-player');
  var playerId  = playerSel.value;
  var name      = playerSel.options[playerSel.selectedIndex] ? playerSel.options[playerSel.selectedIndex].text : '';
  var email    = document.getElementById('f-email').value.trim();
  var nickname = document.getElementById('f-nickname').value.trim();
  var batting  = document.getElementById('f-batting').value;
  var bowling  = document.getElementById('f-bowling').value;
  var shot     = document.getElementById('f-shot').value.trim();
  var hero     = document.getElementById('f-hero').value.trim();
  var years    = document.getElementById('f-years').value;
  var bio      = document.getElementById('f-bio').value.trim();
  var fact     = document.getElementById('f-fact').value.trim();

  if (!playerId) { errEl.textContent = 'Please select your name from the squad list.'; return; }
  if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) { errEl.textContent = 'Please enter a valid email.'; return; }
  if (!batting) { errEl.textContent = 'Please select your batting style.'; return; }
  if (bio.length < 50) { errEl.textContent = 'Bio must be at least 50 characters.'; return; }

  btn.disabled = true; btn.textContent = 'Submitting…';

  try {
    // Upload photo first if provided
    var photoUrl = null;
    if (selectedPhotoFile) {
      btn.textContent = 'Uploading photo…';
      var safeName  = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      var fileName  = 'player-photos/pending/' + safeName + '-' + Date.now() + '.jpg';
      var uploadR   = await fetch(SB_URL + '/storage/v1/object/gallery/' + fileName, {
        method: 'POST',
        headers: {
          'apikey':        SB_ANON,
          'Authorization': 'Bearer ' + SB_ANON,
          'Content-Type':  'image/jpeg',
          'x-upsert':      'false'
        },
        body: selectedPhotoFile
      });
      if (!uploadR.ok) {
        var uploadErr = await uploadR.text();
        throw new Error('Photo upload failed: ' + uploadErr);
      }
      photoUrl = SB_URL + '/storage/v1/object/public/gallery/' + fileName;
    }

    btn.textContent = 'Sending…';

    var r = await fetch(WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'bio.submit',
        payload: { player_id: playerId, name, email, nickname, batting_style: batting, bowling_style: bowling,
          favourite_shot: shot, cricket_hero: hero,
          years_at_tcc: years ? parseInt(years) : null,
          bio, fun_fact: fact, photo_url: photoUrl }
      })
    });
    var d = await r.json();
    if (!r.ok) {
      if (d.error === 'duplicate') {
        document.getElementById('bio-form').style.display   = 'none';
        document.getElementById('bio-already').style.display = 'flex';
        document.querySelector('.bio-hero').style.display   = 'none';
        localStorage.setItem('tcc_bio_submitted', '1');
        return;
      }
      throw new Error(d.error || 'Submission failed');
    }
    localStorage.setItem('tcc_bio_submitted', '1');
    document.getElementById('bio-form').style.display    = 'none';
    document.getElementById('bio-success').style.display = 'flex';
    document.querySelector('.bio-hero').style.display    = 'none';
  } catch(err) {
    errEl.textContent = '❌ ' + (err.message || 'Something went wrong. Please try again.');
    btn.disabled = false; btn.textContent = 'Submit My Bio →';
  }
});
