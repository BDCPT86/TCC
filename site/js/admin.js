/* ══════════════════════════════════════════════════════
   CONFIG
   All WRITE operations go through the Cloudflare Worker.
   READ operations still use the anon key directly.
══════════════════════════════════════════════════════ */
var SUPABASE_URL      = 'https://cgjannvzpqecwzjdzwso.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
var WORKER_URL        = 'https://tcc-admin.bydaries.workers.dev';
var H = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY };

// Session state — populated on login, cleared on logout
var SESSION_TOKEN = '';   // signed JWT
var SESSION_ROLE  = '';   // 'super' | 'scores' | 'content' | 'fixtures' | 'registrar' | 'chair'
var SESSION_NAME  = '';   // display name

/* ══ WORKER PROXY — all writes go here ══ */
async function adminAPI(action, payload) {
  var r = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: SESSION_TOKEN, action: action, payload: payload })
  });
  if (r.status === 401) throw new Error('Unauthorized — please log in again.');
  if (!r.ok) {
    var text = await r.text();
    /* When the Worker sends a readable sentence ("You cannot approve your own
       hours"), show that. Terse codes like "Forbidden" keep the old messages. */
    var said = '';
    try { said = String((JSON.parse(text) || {}).error || ''); } catch (e) {}
    if (said.indexOf(' ') > 0) throw new Error(said);
    if (r.status === 403) throw new Error('You do not have permission to perform this action.');
    throw new Error(action + ' failed: ' + r.status + ' — ' + text);
  }
  var body = await r.text();
  try { return body ? JSON.parse(body) : null; }
  catch { return null; }
}

/* ══ TAB VISIBILITY BY ROLE ══ */
var TAB_ROLES = {
  upload:   ['super', 'content'],
  manage:   ['super', 'content'],
  news:     ['super', 'content'],
  fantasy:  ['super', 'scores'],
  bios:     ['super', 'content', 'registrar', 'chair', 'pafco'],
  players:  ['super', 'scores', 'content', 'chair', 'pafco'],
  registrations: ['super', 'scores', 'chair', 'pafco'],
  shop: ['super', 'scores', 'finance'],
  fixtures: ['super', 'fixtures', 'scores', 'pafco'],
  calendar: ['super', 'content', 'scores', 'fixtures', 'coach', 'registrar', 'chair', 'pafco'],
  timesheet: ['super', 'content', 'scores', 'fixtures', 'coach', 'registrar', 'finance', 'chair', 'captain', 'pafco'],
  coaching: ['super', 'scores', 'fixtures', 'registrar', 'coach', 'chair', 'pafco'],
  warnings: ['super', 'chair', 'captain', 'pafco'],
  /* Agreements carry payment terms, so this is the money side of the club:
     chair and finance. Deliberately not PAFCO, who run playing affairs. */
  agreements: ['super', 'chair', 'finance'],
  confidentiality: ['super', 'chair'],
  admin:    ['super'],
};

function applyRoleVisibility(role) {
  document.querySelectorAll('.nav-tab[data-tab]').forEach(function(btn) {
    var tab    = btn.dataset.tab;
    var allowed = TAB_ROLES[tab] || ['super'];
    var show   = allowed.includes(role);
    btn.style.display = show ? '' : 'none';
  });
  // Mobile select options
  document.querySelectorAll('#nav-tab-select option').forEach(function(opt) {
    var allowed = TAB_ROLES[opt.value] || ['super'];
    opt.style.display = allowed.includes(role) ? '' : 'none';
  });
  // Welcome line
  var nameEl = document.getElementById('admin-user-name');
  if (nameEl) nameEl.textContent = SESSION_NAME;
  // Jump to first allowed tab for this role
  var firstAllowed = Object.keys(TAB_ROLES).find(function(t) {
    return (TAB_ROLES[t] || []).includes(role);
  });
  if (firstAllowed) switchTab(firstAllowed);
}

function loadTabsForRole(role) {
  // Only call load functions for tabs this role can see
  if (['super','content'].includes(role)) {
    loadAlbums(); loadManageAlbums(); loadNewsList();
    loadBioSubmissions(); loadBioLinkPlayers();
  }
  if (['super','scores','content'].includes(role)) {
    loadPlayersAdmin();
  }
  if (['super','scores'].includes(role)) {
    loadPlayerValues(); loadRoundsAdmin(); loadPlayerRegs(); loadShopOrders();
  }
  if (['super','fixtures','scores'].includes(role)) {
    // fixtures tab loads on demand
  }
  if (['super','scores','content','registrar'].includes(role)) {
    loadParticipants(); loadPendingRegistrations();
  }
  if (role === 'chair') {
    loadBioSubmissions(); loadBioLinkPlayers();
    loadPlayersAdmin();
    loadPlayerRegs();
  }
  if (['super','chair','captain','pafco'].includes(role)) {
    wnLoad();
  }
  /* PAFCO sees the playing side of the club, so everything behind those
     tabs is loaded the same way the chair's is. */
  if (['super','chair','finance'].includes(role)) {
    agLoad();
  }
  if (role === 'pafco') {
    loadBioSubmissions(); loadBioLinkPlayers();
    loadPlayersAdmin();
    loadPlayerRegs(); loadPendingRegistrations();
  }
  if (role === 'super') {
    loadAdminUsers();
  }
}

/* ══ LOGIN ══ */
document.getElementById('login-btn').addEventListener('click', async function() {
  var username = (document.getElementById('admin-username').value || '').trim();
  var pwd      = document.getElementById('admin-password').value;
  var errEl    = document.getElementById('login-error');
  errEl.classList.remove('show');
  if (!username || !pwd) { errEl.classList.add('show'); return; }
  try {
    var r    = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'admin.login', payload: { username: username, password: pwd } })
    });
    if (!r.ok) { errEl.classList.add('show'); return; }
    var data = await r.json();
    SESSION_TOKEN = data.token;
    SESSION_ROLE  = data.role;
    SESSION_NAME  = data.name;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-panel').style.display  = 'block';
    applyRoleVisibility(SESSION_ROLE);
    loadTabsForRole(SESSION_ROLE);
  } catch(e) {
    errEl.classList.add('show');
  }
});

document.getElementById('admin-username').addEventListener('keydown', function(e){ if(e.key==='Enter') document.getElementById('admin-password').focus(); });
document.getElementById('admin-password').addEventListener('keydown', function(e){ if(e.key==='Enter') document.getElementById('login-btn').click(); });

// Password show/hide toggle
(function(){
  var toggle = document.getElementById('admin-password-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', function(){
    var input = document.getElementById('admin-password');
    var showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    toggle.setAttribute('aria-pressed', String(!showing));
    toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    toggle.querySelector('.pwd-eye').style.display     = showing ? '' : 'none';
    toggle.querySelector('.pwd-eye-off').style.display = showing ? 'none' : '';
    input.focus();
  });
})();

document.getElementById('logout-btn').addEventListener('click', function(){
  SESSION_TOKEN = '';
  SESSION_ROLE  = '';
  SESSION_NAME  = '';
  document.getElementById('admin-panel').style.display  = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('admin-username').value = '';
  document.getElementById('admin-password').value = '';
  currentAlbum = null;
});

/* ══ TABS ══ */
var activeTab = 'upload';

/* Programmatic tab switch — used by applyRoleVisibility */
function switchTab(tab) {
  var panelEl = document.getElementById('tab-' + tab);
  if (!panelEl) return;
  document.querySelectorAll('.nav-tab').forEach(function(t){ t.classList.toggle('active', t.dataset.tab === tab); });
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.style.display='none'; });
  panelEl.style.display = 'block';
  activeTab = tab;
  var sel = document.getElementById('nav-tab-select');
  if (sel) sel.value = tab;
}

document.querySelectorAll('.nav-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    document.querySelectorAll('.nav-tab').forEach(function(t){t.classList.remove('active');});
    document.querySelectorAll('.tab-panel').forEach(function(p){p.style.display='none';});
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    document.getElementById('tab-'+tab.dataset.tab).style.display='block';
    document.getElementById('nav-tab-select').value = activeTab;
    if(tab.dataset.tab==='timesheet') loadTimesheet();
    if(tab.dataset.tab==='manage')   loadManageAlbums();
    if(tab.dataset.tab==='news')     loadNewsList();
    if(tab.dataset.tab==='fantasy')  { loadPlayerValues(); loadRoundsAdmin(); loadParticipants(); loadPendingRegistrations(); }
    if(tab.dataset.tab==='bios')     { loadBioSubmissions(); loadBioLinkPlayers(); }
    if(tab.dataset.tab==='players')  loadPlayersAdmin();
    if(tab.dataset.tab==='registrations') loadPlayerRegs();
    if(tab.dataset.tab==='shop') loadShopOrders();
    if(tab.dataset.tab==='fixtures') loadFixtures();
    if(tab.dataset.tab==='calendar') loadCalendar();
    if(tab.dataset.tab==='coaching') { if(typeof initCoachingAnalytics==='function') setTimeout(initCoachingAnalytics,50); }
    if(tab.dataset.tab==='admin')    loadAdminUsers();
    if(tab.dataset.tab==='confidentiality') loadConfidentiality();
  });
});

// Mobile select
document.getElementById('nav-tab-select').addEventListener('change', function() {
  var tab = this.value;
  document.querySelectorAll('.nav-tab').forEach(function(t){ t.classList.toggle('active', t.dataset.tab === tab); });
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.style.display='none'; });
  document.getElementById('tab-'+tab).style.display = 'block';
  activeTab = tab;
  if (tab === 'manage')   loadManageAlbums();
  if (tab === 'news')     loadNewsList();
  if (tab === 'fantasy')  { loadPlayerValues(); loadRoundsAdmin(); loadParticipants(); loadPendingRegistrations(); }
  if (tab === 'bios')     { loadBioSubmissions(); }
  if (tab === 'registrations') loadPlayerRegs();
  if (tab === 'shop') loadShopOrders();
  if (tab === 'fixtures') loadFixtures();
  if (tab === 'calendar') loadCalendar();
  if (tab === 'timesheet') loadTimesheet();
  if (tab === 'coaching') { if(typeof initCoachingAnalytics==='function') setTimeout(initCoachingAnalytics,50); }
  if (tab === 'admin')    loadAdminUsers();
  if (tab === 'confidentiality') loadConfidentiality();
});

document.getElementById('tab-refresh-btn-mobile').addEventListener('click', refreshActiveTab);

/* ── Refresh button — reloads data for the active tab ── */
function refreshActiveTab() {
  var btn  = document.getElementById('tab-refresh-btn');
  var icon = document.getElementById('tab-refresh-icon');
  if (btn) btn.classList.add('spinning');
  var done = function() { if (btn) btn.classList.remove('spinning'); };

  if (activeTab === 'upload') {
    loadAlbums(); done();
  } else if (activeTab === 'manage') {
    loadManageAlbums(); done();
  } else if (activeTab === 'news') {
    loadNewsList(); done();
  } else if (activeTab === 'bios') {
    Promise.all([loadBioSubmissions(), loadBioLinkPlayers()]).then(done).catch(done);
  } else if (activeTab === 'timesheet') {
    loadTimesheet().then(done).catch(done);
  } else if (activeTab === 'calendar') {
    loadCalendar().then(done).catch(done);
  } else if (activeTab === 'players') {
    loadPlayersAdmin(); done();
  } else if (activeTab === 'registrations') {
    loadPlayerRegs().then(done).catch(done);
  } else if (activeTab === 'shop') {
    loadShopOrders().then(done).catch(done);
  } else if (activeTab === 'fixtures') {
    loadFixtures(); done();
  } else if (activeTab === 'fantasy') {
    Promise.all([
      loadPendingRegistrations(),
      loadParticipants(),
      loadRoundsAdmin(),
      loadPlayerValues()
    ]).then(done).catch(done);
  } else if (activeTab === 'admin') {
    loadAdminUsers(); done();
  } else if (activeTab === 'confidentiality') {
    loadConfidentiality(); done();
  } else {
    done();
  }
}

document.getElementById('tab-refresh-btn').addEventListener('click', refreshActiveTab);

/* ══════════════════════════════════════════════════════
   FILE UPLOAD HELPERS
══════════════════════════════════════════════════════ */
function toBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload  = function() { resolve(reader.result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadImagesToSupabase(files, albumName, category, date, caption) {
  // Get current row count for sort_order base
  var maxOrder = 0;
  try {
    var r0 = await fetch(SUPABASE_URL+'/rest/v1/gallery?select=id&album=eq.'+encodeURIComponent(albumName), {headers:H});
    var rows = await r0.json();
    if (rows && rows.length) maxOrder = rows.length;
  } catch(e) {}

  for (var i = 0; i < files.length; i++) {
    var file     = files[i];
    var ext      = file.name.split('.').pop().toLowerCase();
    var fileName = Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;

    // Upload binary directly to Supabase Storage — bypasses worker size/CPU limits
    var storageHeaders = {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type':  file.type,
      'x-upsert':      'false'
    };
    var storageR = await fetch(
      SUPABASE_URL + '/storage/v1/object/gallery/' + fileName,
      { method: 'POST', headers: storageHeaders, body: file }
    );
    if (!storageR.ok) {
      var storageErr = await storageR.text();
      throw new Error('Upload failed for ' + file.name + ': ' + storageErr);
    }
    var url = SUPABASE_URL + '/storage/v1/object/public/gallery/' + fileName;

    // Insert DB record via worker (small JSON payload — no issue)
    var takenAt = (date && date.trim()) ? date.trim() : null;
    var cap     = (caption && caption.trim()) ? caption.trim() : null;
    await adminAPI('gallery.insert', {
      url: url, album: albumName, category: category || 'General',
      taken_at: takenAt, caption: cap, sort_order: maxOrder + i + 1
    });
  }
}

function makeDropZone(dropId, inputId, arr, onUpdate) {
  var drop=document.getElementById(dropId), input=document.getElementById(inputId);
  drop.addEventListener('click', function(){input.click();});
  drop.addEventListener('dragover', function(e){e.preventDefault();drop.classList.add('drag-over');});
  drop.addEventListener('dragleave', function(){drop.classList.remove('drag-over');});
  drop.addEventListener('drop', function(e){e.preventDefault();drop.classList.remove('drag-over');pushFiles(Array.from(e.dataTransfer.files),arr,onUpdate);});
  input.addEventListener('change', function(){pushFiles(Array.from(input.files),arr,onUpdate);input.value='';});
}
function pushFiles(files,arr,cb){files.forEach(function(f){if(!f.type.startsWith('image/'))return;if(f.size>5*1024*1024){alert(f.name+' exceeds 5MB.');return;}arr.push(f);});cb();}

function renderPreviews(gridId, btnId, arr) {
  var g=document.getElementById(gridId);
  g.innerHTML=arr.map(function(f,i){return '<div class="preview-item"><img src="'+URL.createObjectURL(f)+'" alt=""><button class="preview-remove" data-index="'+i+'">✕</button></div>';}).join('');
  document.getElementById(btnId).style.display=arr.length?'flex':'none';
}

function setBusy(btnId,labelId,spinnerId,on){
  document.getElementById(btnId).disabled=on;
  document.getElementById(labelId).style.display=on?'none':'inline';
  document.getElementById(spinnerId).style.display=on?'inline':'none';
}

/* ══════════════════════════════════════════════════════
   UPLOAD TAB
══════════════════════════════════════════════════════ */
var upFiles=[];
makeDropZone('file-drop','file-input',upFiles,function(){renderPreviews('preview-grid','upload-btn',upFiles);});
document.getElementById('preview-grid').addEventListener('click',function(e){
  if(e.target.classList.contains('preview-remove')){upFiles.splice(parseInt(e.target.dataset.index),1);renderPreviews('preview-grid','upload-btn',upFiles);}
});
document.getElementById('upload-btn').addEventListener('click', async function(){
  var album=document.getElementById('album-input').value.trim();
  var cat=document.getElementById('category-input').value;
  var date=document.getElementById('date-input').value;
  var cap=document.getElementById('caption-input').value.trim();
  var suc=document.getElementById('upload-success'), err=document.getElementById('upload-error');
  if(!album||!upFiles.length) return;
  suc.style.display='none'; err.style.display='none';
  setBusy('upload-btn','upload-label','upload-spinner',true);
  try {
    await uploadImagesToSupabase(upFiles,album,cat,date,cap);
    suc.style.display='block'; upFiles.length=0;
    renderPreviews('preview-grid','upload-btn',upFiles);
    document.getElementById('caption-input').value='';
    loadAlbums();
  } catch(e){ err.textContent='❌ '+e.message; err.style.display='block'; }
  finally { setBusy('upload-btn','upload-label','upload-spinner',false); }
});

function loadAlbums(){
  fetch(SUPABASE_URL+'/rest/v1/gallery?select=album&order=created_at.desc',{headers:H})
  .then(function(r){return r.json();}).then(function(rows){
    var counts={};
    (rows||[]).forEach(function(r){var a=r.album||'General';counts[a]=(counts[a]||0)+1;});
    var el=document.getElementById('album-list'), keys=Object.keys(counts);
    if(!keys.length){el.innerHTML='<div class="album-list-loading">No albums yet.</div>';return;}
    el.innerHTML=keys.map(function(n){return '<div class="album-list-item" data-album="'+esc(n)+'"><span class="album-list-name">'+esc(n)+'</span><span class="album-list-count">'+counts[n]+' photo'+(counts[n]>1?'s':'')+'</span></div>';}).join('');
    el.querySelectorAll('.album-list-item').forEach(function(item){item.addEventListener('click',function(){document.getElementById('album-input').value=item.dataset.album;});});
  }).catch(function(){});
}

/* ══════════════════════════════════════════════════════
   MANAGE ALBUMS TAB
══════════════════════════════════════════════════════ */
var currentAlbum='', currentAlbumData=[], editFiles_=[];
makeDropZone('edit-file-drop','edit-file-input',editFiles_,function(){renderPreviews('edit-preview-grid','edit-upload-btn',editFiles_);});
document.getElementById('edit-preview-grid').addEventListener('click',function(e){
  if(e.target.classList.contains('preview-remove')){editFiles_.splice(parseInt(e.target.dataset.index),1);renderPreviews('edit-preview-grid','edit-upload-btn',editFiles_);}
});

function loadManageAlbums(){
  var el = document.getElementById('manage-albums-list');
  el.innerHTML = '<div class="album-list-loading">Loading albums…</div>';
  fetch(SUPABASE_URL+'/rest/v1/gallery?select=album,category,taken_at&order=created_at.desc',{headers:H})
  .then(function(r){
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  })
  .then(function(rows){
    var map={};
    (rows||[]).forEach(function(r){var a=r.album||'General';if(!map[a])map[a]={count:0,category:r.category,date:r.taken_at};map[a].count++;});
    var keys=Object.keys(map);
    if(!keys.length){el.innerHTML='<div class="album-list-loading">No albums yet.</div>';return;}
    el.innerHTML=keys.map(function(n){return '<div class="album-list-item" data-album="'+esc(n)+'"><span class="album-list-name">'+esc(n)+'</span><span class="album-list-count">'+map[n].count+' photo'+(map[n].count>1?'s':'')+'</span></div>';}).join('');
    el.querySelectorAll('.album-list-item').forEach(function(item){item.addEventListener('click',function(){openAlbumEdit(item.dataset.album);});});
  }).catch(function(err){
    console.error('loadManageAlbums error:', err);
    el.innerHTML='<div class="album-list-loading" style="color:#e07070">Error loading albums: '+err.message+'</div>';
  });
}

function openAlbumEdit(name){
  currentAlbum=name;
  document.getElementById('edit-album-name').value=name;
  document.getElementById('edit-panel-empty').style.display='none';
  document.getElementById('edit-panel-content').style.display='block';
  fetch(SUPABASE_URL+'/rest/v1/gallery?select=*&album=eq.'+encodeURIComponent(name)+'&order=sort_order.asc,created_at.asc',{headers:H})
  .then(function(r){return r.json();}).then(function(rows){
    currentAlbumData=rows||[];
    var meta=rows[0]||{};
    document.getElementById('edit-category').value=meta.category||'General';
    document.getElementById('edit-date').value=meta.taken_at?meta.taken_at.substring(0,10):'';
    document.getElementById('edit-photo-count').textContent='('+currentAlbumData.length+')';
    renderEditPhotos();
  });
}

function renderEditPhotos(){
  var grid=document.getElementById('edit-photos-grid');
  grid.innerHTML=currentAlbumData.map(function(p,i){
    // Child media-consent gate. A photo showing under-18s stays HIDDEN from the
    // public gallery until an admin confirms every child shown has media consent.
    var minors = !!p.contains_minors;
    var ok = !!p.consent_confirmed;
    var state = !minors ? ''
      : (ok ? '<span style="font-size:.62rem;color:#8fd08f">✓ consent confirmed</span>'
            : '<span style="font-size:.62rem;color:#e0736f">⚠ hidden — needs consent</span>');
    return '<div class="edit-photo-item" data-id="'+p.id+'" draggable="true"'
      + (minors && !ok ? ' style="outline:2px solid #c05a5a;outline-offset:-2px"' : '') + '>'
      +'<img src="'+p.url+'" alt="" loading="lazy">'
      +'<button class="edit-photo-delete" data-id="'+p.id+'" data-url="'+p.url+'" title="Delete">✕</button>'
      +'<div style="position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.78);'
      +  'padding:4px 6px;font-size:.62rem;line-height:1.35;text-align:left">'
      +  '<label style="display:flex;gap:5px;align-items:center;cursor:pointer">'
      +    '<input type="checkbox" data-minors="'+p.id+'"'+(minors?' checked':'')+'> Shows children'
      +  '</label>'
      +  (minors
          ? '<label style="display:flex;gap:5px;align-items:center;cursor:pointer;margin-top:2px">'
            + '<input type="checkbox" data-consent="'+p.id+'"'+(ok?' checked':'')+'> All have media consent'
            + '</label>' + state
          : '')
      +'</div>'
      +'</div>';
  }).join('');

  // consent controls
  grid.querySelectorAll('[data-minors]').forEach(function(cb){
    cb.addEventListener('change', async function(){
      try{
        await adminAPI('gallery.update', { id: cb.dataset.minors,
          data: { contains_minors: cb.checked, ...(cb.checked ? {} : { consent_confirmed: false }) } });
        openAlbumEdit(currentAlbum);
      }catch(e){ alert('Failed: '+e.message); cb.checked = !cb.checked; }
    });
  });
  grid.querySelectorAll('[data-consent]').forEach(function(cb){
    cb.addEventListener('change', async function(){
      if(cb.checked && !confirm('Confirm that EVERY child shown in this photo has media consent on their registration?\n\nOnly tick this if you have checked.')){
        cb.checked = false; return;
      }
      try{
        await adminAPI('gallery.confirmConsent', { id: cb.dataset.consent, confirmed: cb.checked });
        openAlbumEdit(currentAlbum);
      }catch(e){ alert('Failed: '+e.message); cb.checked = !cb.checked; }
    });
  });

  // Drag to reorder
  var items=grid.querySelectorAll('.edit-photo-item');
  items.forEach(function(item){
    item.addEventListener('dragstart',function(){item.classList.add('dragging');});
    item.addEventListener('dragend',function(){item.classList.remove('dragging');grid.querySelectorAll('.edit-photo-item').forEach(function(i){i.classList.remove('drag-over');});saveOrder();});
    item.addEventListener('dragover',function(e){e.preventDefault();item.classList.add('drag-over');});
    item.addEventListener('dragleave',function(){item.classList.remove('drag-over');});
    item.addEventListener('drop',function(e){
      e.preventDefault();item.classList.remove('drag-over');
      var dragging=grid.querySelector('.dragging');
      if(dragging&&dragging!==item){grid.insertBefore(dragging,item);}
    });
  });

  // Delete buttons
  grid.querySelectorAll('.edit-photo-delete').forEach(function(btn){
    btn.addEventListener('click',function(e){e.stopPropagation();deletePhoto(btn.dataset.id,btn.dataset.url);});
  });
}

async function saveOrder(){
  var items=document.querySelectorAll('.edit-photo-item');
  var updates=Array.from(items).map(function(el,i){return {id:el.dataset.id, sort_order:i+1};});
  try { await adminAPI('gallery.updateOrder', { items: updates }); }
  catch(e){ console.error('Save order failed:', e.message); }
}

/* Save album metadata */
document.getElementById('save-album-btn').addEventListener('click', async function(){
  if(!currentAlbum) return;
  var newName=document.getElementById('edit-album-name').value.trim();
  var cat=document.getElementById('edit-category').value;
  var date=document.getElementById('edit-date').value;
  var suc=document.getElementById('edit-success'),err=document.getElementById('edit-error');
  suc.style.display='none'; err.style.display='none';
  try {
    await adminAPI('gallery.renameAlbum', { oldName: currentAlbum, newName: newName, category: cat, date: date||null });
    currentAlbum=newName;
    suc.style.display='block'; loadManageAlbums();
  } catch(e){ err.textContent='❌ '+e.message; err.style.display='block'; }
});

/* Delete entire album */
document.getElementById('delete-album-btn').addEventListener('click', function(){
  if(!currentAlbum) return;
  confirmModal('Delete Album','Permanently delete all photos in "'+currentAlbum+'"?', async function(){
    try {
      // Delete storage files
      for(var i=0;i<currentAlbumData.length;i++){
        var path=currentAlbumData[i].url.split('/gallery/')[1];
        if(path) await adminAPI('storage.delete', { path: path });
      }
      // Delete DB rows
      await adminAPI('gallery.deleteAlbum', { album: currentAlbum });
      document.getElementById('edit-panel-empty').style.display='flex';
      document.getElementById('edit-panel-content').style.display='none';
      currentAlbum=''; currentAlbumData=[];
      loadManageAlbums();
    } catch(e){ alert('Delete failed: '+e.message); }
  });
});

/* Delete single photo */
async function deletePhoto(id, url){
  confirmModal('Delete Photo','Remove this photo from the album?', async function(){
    try {
      var path=url.split('/gallery/')[1];
      if(path) await adminAPI('storage.delete', { path: path });
      await adminAPI('gallery.delete', { id: id });
      currentAlbumData=currentAlbumData.filter(function(p){return p.id!==id;});
      document.getElementById('edit-photo-count').textContent='('+currentAlbumData.length+')';
      renderEditPhotos(); loadManageAlbums();
    } catch(e){ alert('Delete failed: '+e.message); }
  });
}

/* Add more photos */
document.getElementById('edit-upload-btn').addEventListener('click', async function(){
  if(!currentAlbum||!editFiles_.length) return;
  var cat=document.getElementById('edit-category').value;
  var date=document.getElementById('edit-date').value;
  var suc=document.getElementById('edit-upload-success'),err=document.getElementById('edit-upload-error');
  suc.style.display='none'; err.style.display='none';
  setBusy('edit-upload-btn','edit-upload-label','edit-upload-spinner',true);
  try {
    await uploadImagesToSupabase(editFiles_,currentAlbum,cat,date,null);
    suc.style.display='block'; editFiles_.length=0;
    renderPreviews('edit-preview-grid','edit-upload-btn',editFiles_);
    openAlbumEdit(currentAlbum); loadAlbums();
  } catch(e){ err.textContent='❌ '+e.message; err.style.display='block'; }
  finally { setBusy('edit-upload-btn','edit-upload-label','edit-upload-spinner',false); }
});

/* ══════════════════════════════════════════════════════
   NEWS TAB
══════════════════════════════════════════════════════ */
function loadNewsList(){
  fetch(SUPABASE_URL+'/rest/v1/news?select=id,title,published,status,pinned,expires_at&order=created_at.desc',{headers:H})
  .then(function(r){return r.json();}).then(function(rows){
    var el=document.getElementById('news-list');
    var countEl=document.getElementById('news-count');
    if(!rows||!rows.length){if(countEl)countEl.textContent='0 articles';el.innerHTML='<div class="mx-empty">No articles yet.</div>';return;}
    if(countEl)countEl.textContent=rows.length+(rows.length===1?' article':' articles');
    el.innerHTML=rows.map(function(r){
      // Support both old published bool and new status field
      var status = r.status || (r.published ? 'published' : 'draft');
      var label  = status === 'published' ? 'Live' : status === 'archived' ? 'Archived' : 'Draft';
      var pin    = r.pinned ? '<span style="margin-right:4px" title="Pinned">📌</span>' : '';
      var exp    = r.expires_at ? '<span style="font-size:0.65rem;color:var(--muted2);margin-left:6px">exp '+new Date(r.expires_at).toLocaleDateString('en-ZA',{day:'numeric',month:'short'})+'</span>' : '';
      return '<div class="news-list-item" data-id="'+r.id+'">'
        +'<span class="news-item-title">'+pin+r.title+exp+'</span>'
        +'<span class="news-item-status '+status+'">'+label+'</span>'
        +'</div>';
    }).join('');
    el.querySelectorAll('.news-list-item').forEach(function(item){
      item.addEventListener('click',function(){
        el.querySelectorAll('.news-list-item').forEach(function(i){i.classList.remove('active');});
        item.classList.add('active'); loadNewsArticle(item.dataset.id);
      });
    });
  }).catch(function(){});
}

function loadNewsArticle(id){
  fetch(SUPABASE_URL+'/rest/v1/news?id=eq.'+id+'&select=*',{headers:H})
  .then(function(r){return r.json();}).then(function(rows){
    if(!rows||!rows.length) return;
    var a=rows[0];
    document.getElementById('news-id').value              = a.id;
    document.getElementById('news-title').value           = a.title;
    document.getElementById('news-content').innerHTML     = a.content||'';
    document.getElementById('news-pinned').checked        = !!a.pinned;
    document.getElementById('news-expires').value         = a.expires_at ? a.expires_at.split('T')[0] : '';
    var status = a.status || (a.published ? 'published' : 'draft');
    setNewsStatus(status);
    setCoverImage(a.cover_image || '');
    if (a.gallery_album) {
      loadAlbumPickerData(function() { setAlbumPicker(a.gallery_album); });
    } else {
      setAlbumPicker('');
    }
    // Restore article type and match report fields
    var cat = a.category || 'general';
    setArticleType(cat);
    if (cat === 'match-report' && a.match_meta) {
      var m = typeof a.match_meta === 'string' ? JSON.parse(a.match_meta) : a.match_meta;
      document.getElementById('mr-opponent').value   = m.opponent   || '';
      document.getElementById('mr-result').value     = m.result     || '';
      document.getElementById('mr-our-score').value  = m.our_score  || '';
      document.getElementById('mr-their-score').value= m.their_score|| '';
      document.getElementById('mr-team').value       = m.team       || '1st XI';
      document.getElementById('mr-venue').value      = m.venue      || '';
      document.getElementById('mr-date').value       = m.match_date || '';
    }
    document.getElementById('delete-news-btn').style.display='inline-flex';
    showNewsEditor();
  });
}

function showNewsEditor(){
  document.getElementById('news-editor-empty').style.display  ='none';
  document.getElementById('news-editor-content').style.display='block';
}

/* ── Article type toggle ── */
function setArticleType(type) {
  document.getElementById('news-category').value = type;
  document.querySelectorAll('.article-type-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.type === type);
  });
  var mrFields = document.getElementById('match-report-fields');
  if (type === 'match-report') {
    mrFields.classList.add('visible');
    // Auto-set today's date
    if (!document.getElementById('mr-date').value) {
      document.getElementById('mr-date').value = new Date().toISOString().split('T')[0];
    }
  } else {
    mrFields.classList.remove('visible');
  }
}

document.querySelectorAll('.article-type-btn').forEach(function(btn) {
  btn.addEventListener('click', function() { setArticleType(btn.dataset.type); });
});

/* ── Match report auto-fill template ── */
document.getElementById('mr-autofill-btn').addEventListener('click', function() {
  var opponent  = document.getElementById('mr-opponent').value.trim() || '[Opponent]';
  var result    = document.getElementById('mr-result').value;
  var ourScore  = document.getElementById('mr-our-score').value.trim() || '[our score]';
  var theirScore= document.getElementById('mr-their-score').value.trim() || '[their score]';
  var team      = document.getElementById('mr-team').value;
  var venue     = document.getElementById('mr-venue').value.trim() || '[venue]';
  var date      = document.getElementById('mr-date').value;
  var dateStr   = date ? new Date(date).toLocaleDateString('en-ZA', {day:'numeric',month:'long',year:'numeric'}) : '[date]';
  var resultWord = {W:'won',L:'lost',D:'drew',T:'tied',NR:'had no result'}[result] || '[result]';
  var margin = result === 'W' ? '[margin of victory]' : result === 'L' ? '[margin of defeat]' : '';
  var marginStr = margin ? ` by ${margin}` : '';

  // Auto-set title if empty
  if (!document.getElementById('news-title').value) {
    var resultShort = {W:'Win',L:'Loss',D:'Draw',T:'Tie',NR:'No Result'}[result] || 'Match Report';
    document.getElementById('news-title').value = `${team} ${resultShort} vs ${opponent} — ${dateStr}`;
  }

  document.getElementById('news-content').innerHTML =
    `<p>Tygerberg Cricket Club's <strong>${team}</strong> ${resultWord}${marginStr} against <strong>${opponent}</strong> at ${venue} on ${dateStr}.</p>` +
    `<p><strong>Scores:</strong> TCC ${ourScore} · ${opponent} ${theirScore}</p>` +
    `<h2>Match Summary</h2>` +
    `<p>[Describe how the match unfolded — key partnerships, momentum shifts, turning points.]</p>` +
    `<h2>Batting</h2>` +
    `<p>[Name top run-scorers and their contributions. Include how they got out if notable.]</p>` +
    `<h2>Bowling</h2>` +
    `<p>[Name top wicket-takers with their figures. Note any standout spells.]</p>` +
    `<h2>In the Field</h2>` +
    `<p>[Mention any notable catches, run-outs or keeping moments.]</p>` +
    `<p><em>Next up: [next fixture details].</em></p>`;
});

document.getElementById('new-article-btn').addEventListener('click',function(){
  document.getElementById('news-id').value='';
  document.getElementById('news-title').value='';
  document.getElementById('news-content').innerHTML='';
  document.getElementById('news-pinned').checked=false;
  document.getElementById('news-expires').value='';
  // Reset match report fields
  setArticleType('general');
  document.getElementById('mr-opponent').value='';
  document.getElementById('mr-result').value='';
  document.getElementById('mr-our-score').value='';
  document.getElementById('mr-their-score').value='';
  document.getElementById('mr-team').value='1st XI';
  document.getElementById('mr-venue').value='';
  document.getElementById('mr-date').value='';
  setNewsStatus('draft');
  setCoverImage('');
  setAlbumPicker('');
  document.getElementById('delete-news-btn').style.display='none';
  showNewsEditor();
});

/* News status button wiring */
function setNewsStatus(status) {
  document.getElementById('news-status').value = status;
  document.querySelectorAll('.status-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
}
document.querySelectorAll('.status-btn').forEach(function(btn) {
  btn.addEventListener('click', function() { setNewsStatus(btn.dataset.status); });
});

/* Editor toolbar */
var savedRange = null;

function saveSelection() {
  var sel = window.getSelection();
  if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
}

function restoreSelection() {
  if (!savedRange) return;
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
}

document.querySelectorAll('.editor-btn[data-cmd]').forEach(function(btn){
  btn.addEventListener('click',function(e){
    e.preventDefault();
    var cmd=btn.dataset.cmd;
    if(cmd==='h2'||cmd==='h3'){
      document.execCommand('formatBlock',false,'<'+cmd+'>');
    } else {
      document.execCommand(cmd,false,null);
    }
    document.getElementById('news-content').focus();
  });
});

/* Link button */
document.getElementById('editor-link-btn').addEventListener('click', function(e) {
  e.preventDefault();
  saveSelection();
  var bar = document.getElementById('editor-link-bar');
  var imgBar = document.getElementById('editor-img-bar');
  imgBar.style.display = 'none';
  bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
  if (bar.style.display === 'flex') {
    document.getElementById('editor-link-url').value = '';
    document.getElementById('editor-link-url').focus();
  }
});

document.getElementById('editor-link-apply').addEventListener('click', function() {
  var url = document.getElementById('editor-link-url').value.trim();
  if (!url) return;
  restoreSelection();
  document.execCommand('createLink', false, url);
  var sel = window.getSelection();
  if (sel && sel.anchorNode) {
    var link = sel.anchorNode.parentElement.closest('a');
    if (link) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  }
  document.getElementById('editor-link-bar').style.display = 'none';
  document.getElementById('news-content').focus();
});

document.getElementById('editor-link-cancel').addEventListener('click', function() {
  document.getElementById('editor-link-bar').style.display = 'none';
});

document.getElementById('editor-link-url').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('editor-link-apply').click();
  if (e.key === 'Escape') document.getElementById('editor-link-cancel').click();
});

/* Image button */
document.getElementById('editor-img-btn').addEventListener('click', function(e) {
  e.preventDefault();
  saveSelection();
  var bar = document.getElementById('editor-img-bar');
  var linkBar = document.getElementById('editor-link-bar');
  linkBar.style.display = 'none';
  bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
  if (bar.style.display === 'flex') {
    document.getElementById('editor-img-url').value = '';
    document.getElementById('editor-img-status').textContent = '';
  }
});

document.getElementById('editor-img-upload-btn').addEventListener('click', function() {
  document.getElementById('editor-img-file').click();
});

document.getElementById('editor-img-file').addEventListener('change', async function() {
  var file = this.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { setImgStatus('File exceeds 5MB', 'error'); return; }
  setImgStatus('Uploading…', 'uploading');
  var ext      = file.name.split('.').pop().toLowerCase();
  var fileName = 'news-' + Date.now() + '.' + ext;
  try {
    var storageHeaders = {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type':  file.type,
      'x-upsert':      'false'
    };
    var r = await fetch(
      SUPABASE_URL + '/storage/v1/object/gallery/' + fileName,
      { method: 'POST', headers: storageHeaders, body: file }
    );
    if (!r.ok) { var e = await r.text(); throw new Error(e); }
    var url = SUPABASE_URL + '/storage/v1/object/public/gallery/' + fileName;
    document.getElementById('editor-img-url').value = url;
    setImgStatus('✓ Ready to insert', '');
  } catch(err) { setImgStatus('Upload failed: ' + err.message, 'error'); }
  this.value = '';
});

function setImgStatus(msg, cls) {
  var el = document.getElementById('editor-img-status');
  el.textContent = msg;
  el.className = 'editor-img-status' + (cls ? ' ' + cls : '');
}

document.getElementById('editor-img-apply').addEventListener('click', function() {
  var url = document.getElementById('editor-img-url').value.trim();
  if (!url) return;
  restoreSelection();
  var html =
    '<figure class="news-img size-full align-center" contenteditable="false">' +
      '<img src="' + url + '" alt="">' +
      '<figcaption contenteditable="true" data-placeholder="Add a caption (optional)"></figcaption>' +
    '</figure><p><br></p>';
  document.execCommand('insertHTML', false, html);
  document.getElementById('editor-img-bar').style.display = 'none';
  document.getElementById('news-content').focus();
});

document.getElementById('editor-img-cancel').addEventListener('click', function() {
  document.getElementById('editor-img-bar').style.display = 'none';
});

/* ══ Video insert (YouTube facade) ══ */
function parseYouTubeId(url) {
  var m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

document.getElementById('editor-video-btn').addEventListener('click', function(e) {
  e.preventDefault();
  saveSelection();
  document.getElementById('editor-video-bar').style.display = 'flex';
  document.getElementById('editor-video-status').textContent = '';
  document.getElementById('editor-video-url').focus();
});

document.getElementById('editor-video-apply').addEventListener('click', function() {
  var url = document.getElementById('editor-video-url').value.trim();
  var id  = parseYouTubeId(url);
  var status = document.getElementById('editor-video-status');
  if (!id) { status.textContent = 'Not a recognisable YouTube link'; return; }
  restoreSelection();
  var html =
    '<figure class="news-video" contenteditable="false" data-video-id="' + id + '">' +
      '<div class="video-facade">' +
        '<img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="" loading="lazy">' +
        '<span class="video-play" aria-hidden="true">▶</span>' +
      '</div>' +
      '<figcaption contenteditable="true" data-placeholder="Add a caption (optional)"></figcaption>' +
    '</figure><p><br></p>';
  document.execCommand('insertHTML', false, html);
  document.getElementById('editor-video-bar').style.display = 'none';
  document.getElementById('editor-video-url').value = '';
  document.getElementById('news-content').focus();
});

document.getElementById('editor-video-cancel').addEventListener('click', function() {
  document.getElementById('editor-video-bar').style.display = 'none';
});

/* ══ Image select + inline align/size toolbar ══ */
var _selectedFigure = null;
var _imgToolbar      = document.getElementById('img-inline-toolbar');
var _newsContentEl   = document.getElementById('news-content');

function positionImgToolbar(fig) {
  var r = fig.getBoundingClientRect();
  _imgToolbar.style.display = 'flex';
  var top = r.top - _imgToolbar.offsetHeight - 8;
  if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - _imgToolbar.offsetHeight - 8);
  var left = r.left + (r.width / 2) - (_imgToolbar.offsetWidth / 2);
  left = Math.max(8, Math.min(left, window.innerWidth - _imgToolbar.offsetWidth - 8));
  _imgToolbar.style.top  = top + 'px';
  _imgToolbar.style.left = left + 'px';
}

function syncImgToolbarState(fig) {
  _imgToolbar.querySelectorAll('[data-align]').forEach(function(b) {
    b.classList.toggle('active', fig.classList.contains('align-' + b.dataset.align));
  });
  _imgToolbar.querySelectorAll('[data-size]').forEach(function(b) {
    b.classList.toggle('active', fig.classList.contains('size-' + b.dataset.size));
  });
}

function selectFigure(fig) {
  if (_selectedFigure) _selectedFigure.classList.remove('is-selected');
  _selectedFigure = fig;
  fig.classList.add('is-selected');
  // videos are always full-width — hide align/size groups, leave remove
  var isVideo = fig.classList.contains('news-video');
  _imgToolbar.querySelectorAll('.img-tb-group, .img-tb-sep').forEach(function(el) {
    el.style.display = isVideo ? 'none' : '';
  });
  var inRow = !!figRow(fig);
  var rowGroup = document.getElementById('img-tb-row-group');
  if (rowGroup) rowGroup.style.display = isVideo ? 'none' : '';
  var addBtn = document.getElementById('img-tb-row-add');
  var outBtn = document.getElementById('img-tb-row-out');
  if (addBtn) addBtn.style.display = inRow ? 'none' : '';
  if (outBtn) outBtn.style.display = inRow ? '' : 'none';
  // Inside a row the width is set by the row, so per-image sizing is meaningless.
  _imgToolbar.querySelectorAll('[data-size]').forEach(function (b) {
    b.style.display = inRow ? 'none' : '';
  });
  _imgToolbar.querySelectorAll('[data-align]').forEach(function (b) {
    b.style.display = inRow ? 'none' : '';
  });
  positionImgToolbar(fig);
  if (!isVideo) syncImgToolbarState(fig);
}

/* ── Side-by-side image rows ──────────────────────────────────────────
   A .news-row wraps 2–4 existing figure.news-img elements. Wrapping rather
   than replacing means captions, selection and remove keep working, and the
   stored HTML degrades to normal stacked figures if the CSS ever goes missing.
   Capped at 4: beyond that each image is too small to read on any screen. */
var NEWS_ROW_MAX = 4;

function figRow(fig) { return fig && fig.parentElement && fig.parentElement.classList.contains('news-row')
  ? fig.parentElement : null; }

/* Merge with an adjacent row if there is one, otherwise start a new row with
   the following figure. */
function addFigureToRow(fig) {
  var existing = figRow(fig);
  if (existing) return;

  var prev = fig.previousElementSibling;
  var next = fig.nextElementSibling;
  // skip the empty <p><br></p> the editor leaves between blocks
  var isFiller = function (el) { return el && el.tagName === 'P' && el.textContent.trim() === ''; };
  if (isFiller(prev)) prev = prev.previousElementSibling;
  if (isFiller(next)) next = next.nextElementSibling;

  var target = null;
  if (prev && prev.classList && prev.classList.contains('news-row')) target = prev;
  else if (next && next.classList && next.classList.contains('news-row')) target = next;

  if (target) {
    if (target.children.length >= NEWS_ROW_MAX) {
      showToast('A row holds at most ' + NEWS_ROW_MAX + ' images', 2600);
      return;
    }
    if (target === prev) target.appendChild(fig);
    else target.insertBefore(fig, target.firstChild);
    tidyRowFillers(target);
    return;
  }

  // No adjacent row — pair with the neighbouring figure if there is one.
  var partner = (next && next.tagName === 'FIGURE' && next.classList.contains('news-img')) ? next
              : (prev && prev.tagName === 'FIGURE' && prev.classList.contains('news-img')) ? prev
              : null;
  if (!partner) {
    showToast('Insert another image next to this one, then tap Row', 3200);
    return;
  }
  var row = document.createElement('div');
  row.className = 'news-row';
  row.setAttribute('contenteditable', 'false');
  (partner === next ? fig : partner).insertAdjacentElement('beforebegin', row);
  row.appendChild(partner === next ? fig : partner);
  row.appendChild(partner === next ? partner : fig);
  tidyRowFillers(row);
}

function removeFigureFromRow(fig) {
  var row = figRow(fig);
  if (!row) return;
  row.insertAdjacentElement('beforebegin', fig);
  if (row.children.length === 0) row.remove();
  else if (row.children.length === 1) {
    // a one-image row is just an image
    var last = row.firstElementChild;
    row.insertAdjacentElement('beforebegin', last);
    row.remove();
  }
}

/* Remove stray empty paragraphs left inside a row by execCommand. */
function tidyRowFillers(row) {
  Array.prototype.slice.call(row.children).forEach(function (el) {
    if (el.tagName === 'P' && el.textContent.trim() === '') el.remove();
  });
  if (!row.nextElementSibling || row.nextElementSibling.tagName !== 'P') {
    var p = document.createElement('p');
    p.innerHTML = '<br>';
    row.insertAdjacentElement('afterend', p);
  }
}

function deselectFigure() {
  if (_selectedFigure) _selectedFigure.classList.remove('is-selected');
  _selectedFigure = null;
  _imgToolbar.style.display = 'none';
}

if (_newsContentEl) {
  _newsContentEl.addEventListener('click', function(e) {
    var fig = e.target.closest('figure.news-img, figure.news-video');
    if (fig && !e.target.closest('figcaption')) { e.preventDefault(); selectFigure(fig); }
    else if (_selectedFigure && !e.target.closest('figcaption')) { deselectFigure(); }
  });
}

_imgToolbar.addEventListener('click', function(e) {
  var btn = e.target.closest('.img-tb-btn');
  if (!btn || !_selectedFigure) return;
  if (btn.id === 'img-tb-row-add') {
    addFigureToRow(_selectedFigure);
    selectFigure(_selectedFigure);
    return;
  }
  if (btn.id === 'img-tb-row-out') {
    removeFigureFromRow(_selectedFigure);
    selectFigure(_selectedFigure);
    return;
  }
  if (btn.id === 'img-tb-remove') {
    var fig = _selectedFigure;
    var row = figRow(fig);
    deselectFigure();
    fig.remove();
    if (row) {
      if (row.children.length === 0) row.remove();
      else if (row.children.length === 1) {
        var only = row.firstElementChild;
        row.insertAdjacentElement('beforebegin', only);
        row.remove();
      }
    }
    return;
  }
  if (btn.dataset.align) {
    _selectedFigure.classList.remove('align-left', 'align-center', 'align-right');
    _selectedFigure.classList.add('align-' + btn.dataset.align);
  } else if (btn.dataset.size) {
    _selectedFigure.classList.remove('size-small', 'size-medium', 'size-large', 'size-full');
    _selectedFigure.classList.add('size-' + btn.dataset.size);
    // a full-width image can't sensibly wrap text — force it to break the flow
    if (btn.dataset.size === 'full') {
      _selectedFigure.classList.remove('align-left', 'align-right');
      _selectedFigure.classList.add('align-center');
    }
  }
  syncImgToolbarState(_selectedFigure);
  positionImgToolbar(_selectedFigure);
});

// click anywhere outside the image or the toolbar deselects
document.addEventListener('click', function(e) {
  if (!_selectedFigure) return;
  if (e.target.closest('figure.news-img') || e.target.closest('figure.news-video') || e.target.closest('#img-inline-toolbar')) return;
  deselectFigure();
});
// don't let the toolbar drift out of place on scroll — just hide it
window.addEventListener('scroll', function() { if (_selectedFigure) deselectFigure(); }, true);

document.getElementById('editor-img-url').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('editor-img-apply').click();
  if (e.key === 'Escape') document.getElementById('editor-img-cancel').click();
});

/* ══════════════════════════════════════════════════════
   COVER IMAGE — upload or URL
══════════════════════════════════════════════════════ */
function setCoverImage(url) {
  var hidden   = document.getElementById('news-cover-image');
  var preview  = document.getElementById('cover-image-preview');
  var thumb    = document.getElementById('cover-image-thumb');
  var actions  = document.getElementById('cover-image-actions');
  var urlInput = document.getElementById('cover-image-url');

  hidden.value = url || '';
  if (url) {
    thumb.src = url;
    preview.style.display  = 'flex';
    actions.style.display  = 'none';
    urlInput.value = '';
  } else {
    preview.style.display  = 'none';
    actions.style.display  = 'flex';
    urlInput.value = '';
  }
}

document.getElementById('cover-image-remove').addEventListener('click', function() {
  setCoverImage('');
});

document.getElementById('cover-image-upload-btn').addEventListener('click', function() {
  document.getElementById('cover-image-file').click();
});

document.getElementById('cover-image-file').addEventListener('change', async function() {
  var file = this.files[0];
  if (!file) return;
  var status = document.getElementById('cover-image-status');
  var ext = file.name.split('.').pop().toLowerCase();
  var fileName = 'cover-' + Date.now() + '.' + ext;
  status.textContent = 'Uploading…';
  status.style.color = 'var(--muted2)';
  try {
    // Read file as base64 and send through worker (avoids CORS/anon restrictions)
    var base64 = await new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result.split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    var res = await adminAPI('storage.uploadNews', { fileName: fileName, contentType: file.type, base64: base64 });
    if (!res || !res.url) throw new Error('Upload failed');
    setCoverImage(res.url);
    status.textContent = '✅ Uploaded';
    status.style.color = '#5ec98a';
    setTimeout(function() { status.textContent = ''; }, 3000);
  } catch(e) {
    status.textContent = '❌ ' + e.message;
    status.style.color = '#e05a5a';
  }
  this.value = '';
});

document.getElementById('cover-image-url').addEventListener('blur', function() {
  var val = this.value.trim();
  if (val) setCoverImage(val);
});
document.getElementById('cover-image-url').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); var val = this.value.trim(); if (val) setCoverImage(val); }
});

document.getElementById('cover-image-url').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); var val = this.value.trim(); if (val) setCoverImage(val); }
});

/* ══════════════════════════════════════════════════════
   ALBUM PICKER
══════════════════════════════════════════════════════ */
var albumPickerData = [];  // { name, count, thumb }

function loadAlbumPickerData(cb) {
  if (albumPickerData.length) { cb(albumPickerData); return; }
  fetch(SUPABASE_URL + '/rest/v1/gallery?select=album,url&order=sort_order.asc,created_at.asc', { headers: H })
  .then(function(r) { return r.json(); })
  .then(function(rows) {
    var map = {};
    (rows || []).forEach(function(r) {
      var a = r.album || 'General';
      if (!map[a]) map[a] = { name: a, count: 0, thumb: r.url };
      map[a].count++;
    });
    albumPickerData = Object.values(map);
    cb(albumPickerData);
  }).catch(function() { cb([]); });
}

function setAlbumPicker(albumName) {
  var hidden   = document.getElementById('news-gallery-album');
  var search   = document.getElementById('album-picker-search');
  var selected = document.getElementById('album-picker-selected');
  var clearBtn = document.getElementById('album-picker-clear');
  var nameEl   = document.getElementById('album-picker-name');
  var countEl  = document.getElementById('album-picker-count');
  var thumbEl  = document.getElementById('album-picker-thumb');

  hidden.value = albumName || '';
  if (albumName) {
    // Find album data for preview
    var album = albumPickerData.find(function(a) { return a.name === albumName; });
    nameEl.textContent  = albumName;
    countEl.textContent = album ? album.count + ' photo' + (album.count !== 1 ? 's' : '') : '';
    thumbEl.src         = album ? album.thumb : '';
    search.value        = '';
    search.placeholder  = albumName;
    selected.style.display = 'flex';
    clearBtn.style.display = 'inline-flex';
  } else {
    search.value        = '';
    search.placeholder  = 'Search albums…';
    selected.style.display = 'none';
    clearBtn.style.display = 'none';
  }
  document.getElementById('album-picker-dropdown').style.display = 'none';
}

function renderAlbumDropdown(filter) {
  var dropdown = document.getElementById('album-picker-dropdown');
  var filtered = filter
    ? albumPickerData.filter(function(a) { return a.name.toLowerCase().includes(filter.toLowerCase()); })
    : albumPickerData;

  if (!filtered.length) {
    dropdown.innerHTML = '<div class="album-picker-empty">No albums found</div>';
  } else {
    dropdown.innerHTML = filtered.map(function(a) {
      return '<div class="album-picker-option" data-name="' + a.name.replace(/"/g,'&quot;') + '">'
        + '<img class="album-picker-opt-thumb" src="' + a.thumb + '" alt="">'
        + '<span class="album-picker-opt-name">' + a.name + '</span>'
        + '<span class="album-picker-opt-count">' + a.count + ' photo' + (a.count !== 1 ? 's' : '') + '</span>'
        + '</div>';
    }).join('');
    dropdown.querySelectorAll('.album-picker-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        setAlbumPicker(opt.dataset.name);
      });
    });
  }
  dropdown.style.display = 'block';
}

var albumSearchEl = document.getElementById('album-picker-search');
albumSearchEl.addEventListener('focus', function() {
  loadAlbumPickerData(function() { renderAlbumDropdown(albumSearchEl.value); });
});
albumSearchEl.addEventListener('input', function() {
  loadAlbumPickerData(function() { renderAlbumDropdown(albumSearchEl.value); });
});
albumSearchEl.addEventListener('keydown', function(e) {
  var dropdown = document.getElementById('album-picker-dropdown');
  var opts = dropdown.querySelectorAll('.album-picker-option');
  var focused = dropdown.querySelector('.album-picker-option.focused');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    var next = focused ? (focused.nextElementSibling || opts[0]) : opts[0];
    if (focused) focused.classList.remove('focused');
    if (next) next.classList.add('focused');
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    var prev = focused ? (focused.previousElementSibling || opts[opts.length-1]) : opts[opts.length-1];
    if (focused) focused.classList.remove('focused');
    if (prev) prev.classList.add('focused');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (focused) { setAlbumPicker(focused.dataset.name); }
  } else if (e.key === 'Escape') {
    dropdown.style.display = 'none';
  }
});

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  if (!document.getElementById('album-picker-wrap').contains(e.target)) {
    document.getElementById('album-picker-dropdown').style.display = 'none';
  }
});

document.getElementById('album-picker-clear').addEventListener('click', function() {
  albumPickerData = []; // force reload in case albums changed
  setAlbumPicker('');
});

/* Save article */
document.getElementById('save-news-btn').addEventListener('click', async function(){
  var id        = document.getElementById('news-id').value;
  var title     = document.getElementById('news-title').value.trim();
  var contentEl = document.getElementById('news-content');
  contentEl.querySelectorAll('.is-selected').forEach(function(el) { el.classList.remove('is-selected'); });
  var content   = contentEl.innerHTML.trim();
  var status    = document.getElementById('news-status').value;
  var pinned    = document.getElementById('news-pinned').checked;
  var expiresRaw= document.getElementById('news-expires').value;
  var expires   = expiresRaw ? new Date(expiresRaw).toISOString() : null;
  var published = status === 'published';
  var cover_image   = document.getElementById('news-cover-image').value || null;
  var gallery_album = document.getElementById('news-gallery-album').value || null;
  var suc=document.getElementById('news-success'), err=document.getElementById('news-error');
  suc.style.display='none'; err.style.display='none';
  if(!title||!content) { err.textContent='❌ Title and content are required.'; err.style.display='block'; return; }

  var category = document.getElementById('news-category').value || 'general';
  var match_meta = null;
  if (category === 'match-report') {
    match_meta = {
      opponent:    document.getElementById('mr-opponent').value.trim(),
      result:      document.getElementById('mr-result').value,
      our_score:   document.getElementById('mr-our-score').value.trim(),
      their_score: document.getElementById('mr-their-score').value.trim(),
      team:        document.getElementById('mr-team').value,
      venue:       document.getElementById('mr-venue').value.trim(),
      match_date:  document.getElementById('mr-date').value || null,
    };
  }

  try {
    if(id){
      await adminAPI('news.update', { id: id, data: { title, content, published, status, pinned, cover_image, gallery_album, expires_at: expires, category, match_meta, updated_at: new Date().toISOString() } });
    } else {
      var newRows = await adminAPI('news.insert', { title, content, published, status, pinned, cover_image, gallery_album, expires_at: expires, category, match_meta });
      if(newRows && newRows[0]) {
        document.getElementById('news-id').value = newRows[0].id;
        document.getElementById('delete-news-btn').style.display='inline-flex';
      }
    }
    suc.style.display='block'; loadNewsList();
  } catch(e){ err.textContent='❌ '+e.message; err.style.display='block'; }
});

/* Delete article */
document.getElementById('delete-news-btn').addEventListener('click',function(){
  var id=document.getElementById('news-id').value;
  if(!id) return;
  confirmModal('Delete Article','Permanently delete this article?', async function(){
    try {
      await adminAPI('news.delete', { id: id });
      document.getElementById('news-editor-empty').style.display  ='flex';
      document.getElementById('news-editor-content').style.display='none';
      loadNewsList();
    } catch(e){ alert('Delete failed: '+e.message); }
  });
});

/* ══════════════════════════════════════════════════════
   CONFIRM MODAL
══════════════════════════════════════════════════════ */
var pendingConfirm=null;
function confirmModal(title,body,cb,opts){
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-body').textContent=body;
  /* Existing callers pass no opts and keep the red Delete button. */
  var mc=document.getElementById('modal-confirm');
  mc.textContent=(opts&&opts.label)||'Delete';
  mc.className=(opts&&opts.label&&!opts.danger)?'btn btn-primary':'btn btn-danger';
  document.getElementById('modal-overlay').style.display='flex';
  pendingConfirm=cb;
}
document.getElementById('modal-cancel').addEventListener('click',function(){document.getElementById('modal-overlay').style.display='none';pendingConfirm=null;});
document.getElementById('modal-confirm').addEventListener('click',function(){document.getElementById('modal-overlay').style.display='none';if(pendingConfirm){pendingConfirm();pendingConfirm=null;}});

/* ══ UTILS ══ */
/* Toast. Called by the news-row editor and the timesheet tab; it was never
   defined, so both threw "showToast is not defined". Self-contained. */
function showToast(msg, ms) {
  var el = document.getElementById('admin-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'admin-toast';
    el.className = 'admin-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.classList.remove('on'); }, ms || 2200);
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

/* ══════════════════════════════════════════════════════
   FANTASY ADMIN TAB
══════════════════════════════════════════════════════ */
var currentScoreRound = null;

/* Load when tab opens */
document.querySelectorAll('.nav-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    if (tab.dataset.tab === 'fantasy') { loadPlayerValues(); loadRoundsAdmin(); loadParticipants(); loadPendingRegistrations(); }
    if (tab.dataset.tab === 'bios') { loadBioSubmissions(); loadBioLinkPlayers(); }
  });
});

/* ── New round form toggle ── */
document.getElementById('new-round-btn').addEventListener('click', function() {
  var form = document.getElementById('round-form');
  var showing = form.style.display !== 'none';
  form.style.display = showing ? 'none' : 'block';
  if (!showing) loadFixtureOptions('round-fixtures', []);
});

/* ── Create round ── */
document.getElementById('save-round-btn').addEventListener('click', async function() {
  var name     = document.getElementById('round-name').value.trim();
  var deadline = document.getElementById('round-deadline').value;
  var errEl    = document.getElementById('round-error');
  errEl.style.display = 'none';
  if (!name || !deadline) { errEl.textContent = '❌ Name and deadline required.'; errEl.style.display = 'block'; return; }
  this.disabled = true;
  try {
    var wildcard = document.getElementById('round-wildcard') ? document.getElementById('round-wildcard').checked : false;
    var h2h      = document.getElementById('round-h2h')      ? document.getElementById('round-h2h').checked      : false;
    var boost = document.getElementById('round-boost') ? document.getElementById('round-boost').value : '';
    var fixtureIds = getSelectedFixtures('round-fixtures');
    await adminAPI('fantasy.createRound', { name: name, deadline: new Date(deadline).toISOString(), wildcard: wildcard, h2h: h2h, boost_modifier: boost || null, fixture_ids: fixtureIds });
    document.getElementById('round-name').value     = '';
    document.getElementById('round-deadline').value = '';
    document.getElementById('round-form').style.display = 'none';
    loadRoundsAdmin();
  } catch(e) { errEl.textContent = '❌ ' + e.message; errEl.style.display = 'block'; }
  finally { this.disabled = false; }
});

/* ── Load rounds ── */

/* The picker used to ask for the 60 newest fixtures and nothing else:
   order=date.desc&limit=60. Three things were wrong with that.

   · 60 is not many once a club runs several XIs, so older fixtures simply
     were not there to pick.
   · The tournament put another dozen-odd future-dated fixtures at the top
     of a date.desc list, pushing that many real ones off the bottom.
   · Worse than either: a fixture already attached to a round but outside
     those 60 had no <option>, so it could not be selected — and saving the
     round wrote the shorter list back. Editing a round's name could quietly
     detach its fixtures.

   So: a wide window, tournament fixtures left out, and the ones already
   attached fetched by id and merged in whatever their date. */
/* No date floor. A window would still hide a fixture older than it, which
   is the complaint this is fixing; 500 covers several seasons of a club
   running three XIs, and the count under the box says when it is reached. */
var FIXTURE_MAX = 500;

async function loadFixtureOptions(selectId, selectedIds) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  var linked = (selectedIds || []).map(String);
  try {
    /* Tournament fixtures are a separate competition, and the knockout ones
       are named "A1" and "Winner SF1" until the groups decide them — not
       something to build a fantasy round on. One line to include them. */
    var url = SUPABASE_URL + '/rest/v1/fixtures?select=id,date,team,opponent,division' +
              '&tournament_id=is.null&order=date.desc&limit=' + FIXTURE_MAX;
    var r = await fetch(url, { headers: H });
    var fixtures = await r.json();
    if (!Array.isArray(fixtures)) fixtures = [];

    /* Anything already attached to this round that the window missed, by id,
       so a round can never lose a fixture just by being opened. */
    var have = {};
    fixtures.forEach(function (f) { have[String(f.id)] = true; });
    var missing = linked.filter(function (id) { return !have[id]; });
    if (missing.length) {
      try {
        var mr = await fetch(SUPABASE_URL + '/rest/v1/fixtures?select=id,date,team,opponent,division' +
                             '&id=in.(' + missing.join(',') + ')', { headers: H });
        var extra = await mr.json();
        if (Array.isArray(extra)) fixtures = extra.concat(fixtures);
      } catch (e) { /* better a short list than none */ }
    }

    sel.innerHTML = fixtures.map(function(f) {
      var label = (f.date ? f.date.substring(0,10) : 'no date') + ' — ' + (f.team||'TCC') + ' vs ' + (f.opponent||'?') + (f.division ? ' (' + f.division + ')' : '');
      var isSel = linked.indexOf(String(f.id)) !== -1 ? ' selected' : '';
      return '<option value="' + f.id + '"' + isSel + '>' + label + '</option>';
    }).join('');

    /* Say how many are on offer, so "some are missing" is answerable by
       looking rather than by counting the list. */
    var note = document.getElementById(selectId + '-count');
    if (note) {
      note.textContent = fixtures.length + ' fixture' + (fixtures.length === 1 ? '' : 's') +
        ', newest first' +
        (missing.length ? ', including ' + missing.length + ' already on this round' : '') +
        (fixtures.length - missing.length >= FIXTURE_MAX
          ? ' — this is the maximum the list shows, so older ones are not here.' : '');
    }
  } catch(e) { sel.innerHTML = '<option value="">Could not load fixtures</option>'; }
}

function getSelectedFixtures(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel) return [];
  return Array.from(sel.selectedOptions).map(function(o){ return o.value; });
}

async function loadRoundsAdmin() {
  var el = document.getElementById('rounds-list');
  el.innerHTML = '<div class="album-list-loading">Loading…</div>';
  try {
    var r    = await fetch(SUPABASE_URL+'/rest/v1/fantasy_rounds?select=*&order=created_at.desc', {headers:H});
    var rows = await r.json();
    fantasyStats.rounds = (rows && rows.length) || 0; fantasyRenderMetrics();
    if (!rows || !rows.length) { el.innerHTML = '<div class="mx-empty">No rounds yet.</div>'; return; }
    el.innerHTML = rows.map(function(round) {
      var dl     = new Date(round.deadline).toLocaleString('en-ZA');
      var boostLabels = { bowlers_double:'Bowlers ×2', batters_double:'Batters ×2', allrounders_boost:'AR ×1.5', bonus_economy:'Economy ×2', potm_double:'POTM ×2' };
      var badges = (round.wildcard ? '<span class="badge-pill gold">Wildcard</span>' : '')
                 + (round.h2h     ? '<span class="badge-pill blue">H2H</span>' : '')
                 + (round.boost_modifier ? '<span class="badge-pill green">'+( boostLabels[round.boost_modifier]||round.boost_modifier)+'</span>' : '');
      var h2hBtns = round.h2h
        ? '<button class="btn-sm blue" onclick="generateH2HFixtures(\''+round.id+'\',\''+round.name.replace(/'/g,"\\'")+'\')" title="Generate or regenerate pairings">Fixtures</button>'
          + '<button class="btn-sm" onclick="resolveH2H(\''+round.id+'\',\''+round.name.replace(/'/g,"\\'")+'\')">Resolve H2H</button>'
        : '';
      return '<div class="round-list-item">'
        + '<div><div class="round-item-name">'+round.name+' '+badges+'</div><div class="round-item-meta">Deadline: '+dl+ roundToldLine(round) +'</div></div>'
        + '<div class="round-item-actions">'
        + (round.locked
            ? '<button class="btn-sm" onclick="unlockRound(\''+round.id+'\')">Unlock</button><span class="locked-badge">Locked</span>'
              /* Rounds that locked before carry-forward existed never
                 got one. This runs it after the fact. Only on locked
                 rounds, because an open one carries itself. */
              + '<button class="btn-sm" onclick="carryForwardRound(\''+round.id+'\',\''+round.name.replace(/'/g,"\\'")+'\')" title="Copy a previous team forward for anyone who did not submit for this round">Carry</button>'
            : '<button class="btn-sm" onclick="lockRound(\''+round.id+'\')">Lock</button>')
        /* Only while people can still act on it. Telling everyone about a
           locked round is an email nobody can do anything with. */
        + (round.locked ? '' :
            '<button class="btn-sm" onclick="notifyRound(\''+round.id+'\',\''+round.name.replace(/'/g,"\\'")+'\',\'open\')" title="Email every approved participant that this round is open">'
            + (round.notified_at ? 'Tell again' : 'Tell players') + '</button>'
          + '<button class="btn-sm" onclick="notifyRound(\''+round.id+'\',\''+round.name.replace(/'/g,"\\'")+'\',\'reminder\')" title="Email only the players who have not picked yet">Nudge</button>')
        + '<button class="btn-sm" onclick="editRound(\'' + round.id + '\', \'' + round.name.replace(/'/g, "\\'") + '\', \'' + round.deadline + '\', ' + !!round.wildcard + ', ' + !!round.h2h + ', \'' + (round.boost_modifier || '') + '\')" >Edit</button>'
        + '<button class="btn-sm" onclick="openScores(\''+round.id+'\',\''+round.name.replace(/'/g,"\\'")+'\')">Scores</button>'
        + h2hBtns
        + '<button class="btn-sm danger" onclick="deleteRound(\''+round.id+'\',\''+round.name.replace(/'/g,"\\'")+'\')">Delete</button>'
        + '</div>'
        + '</div>';
    }).join('');
  } catch(e) { el.innerHTML = '<div class="mx-empty" style="color:#e07070">Error loading rounds.</div>'; }
}

/* When people were last told about a round, so a second press is a
   decision rather than an accident. */
function roundToldLine(round) {
  var bits = [];
  if (round.notified_at) bits.push('told ' + wnFmtShort(round.notified_at));
  if (round.reminded_at) bits.push('nudged ' + wnFmtShort(round.reminded_at));
  return bits.length ? ' · ' + bits.join(' · ') : '';
}

/* Pressed, never automatic. A round created on Tuesday for Saturday should
   not mail everybody on Tuesday — you choose the moment. */
async function notifyRound(roundId, roundName, mode) {
  var reminder = mode === 'reminder';
  var ask = reminder
    ? 'Nudge the players who have NOT picked for "' + roundName + '"?\n\n' +
      'Players who have already picked are left alone.'
    : 'Tell every approved participant that "' + roundName + '" is open?\n\n' +
      'They get the deadline and a link to their picks.';
  if (!confirm(ask)) return;
  try {
    var d = await adminAPI('fantasy.notifyRound', { id: roundId, mode: reminder ? 'reminder' : 'open' });
    if (!d) { showToast('No answer from the server'); return; }
    if (d.note) { showToast(d.note); loadRoundsAdmin(); return; }
    var said = (reminder ? 'Nudged ' : 'Told ') + d.sent + ' of ' + d.total;
    if (d.failed) said += ' — ' + d.failed + ' did not go';
    if (d.no_email) said += ', ' + d.no_email + ' have no email address';
    if (d.pushed) said += ' · ' + d.pushed + ' push';
    showToast(said, 5000);
    loadRoundsAdmin();
  } catch (e) { showToast(e.message || 'Could not send'); }
}

/* ── H2H: generate fixtures ── */
async function generateH2HFixtures(roundId, roundName) {
  var h2hPanel = document.getElementById('h2h-fixtures-panel');
  var h2hTitle = document.getElementById('h2h-panel-title');
  var h2hBody  = document.getElementById('h2h-fixtures-body');
  if (!h2hPanel) return;

  // Check if fixtures already exist — if so, just display them, no regeneration allowed
  var existingR = await fetch(SUPABASE_URL+'/rest/v1/fantasy_h2h_fixtures?round_id=eq.'+roundId+'&select=*', {headers:H});
  var existing  = await existingR.json();
  if (existing && existing.length > 0) {
    var h2hPanel = document.getElementById('h2h-fixtures-panel');
    var h2hTitle = document.getElementById('h2h-panel-title');
    var h2hBody  = document.getElementById('h2h-fixtures-body');
    var pR2  = await fetch(SUPABASE_URL+'/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name', {headers:H});
    var pMap2= {};
    (await pR2.json()||[]).forEach(function(p){ pMap2[p.id] = p.team_name||p.name; });
    h2hTitle.textContent = 'H2H Fixtures — ' + roundName;
    h2hBody.innerHTML = '<div class="h2h-method-label">Draw locked — ' + existing.length + ' fixture' + (existing.length!==1?'s':'') + '</div>'
      + existing.map(function(fx) {
          var nameA = pMap2[fx.participant_a] || 'Unknown';
          var nameB = fx.participant_b ? (pMap2[fx.participant_b]||'Unknown') : '<em>Mr. Average</em>';
          return '<div class="h2h-fixture-row"><span class="h2h-name-a">'+nameA+'</span><span class="h2h-vs">vs</span><span class="h2h-name-b">'+nameB+'</span></div>';
        }).join('')
      + '<div class="h2h-resend-row"><button class="btn-sm" onclick="resendH2HDrawEmails(\''+roundId+'\',\''+roundName+'\')">📨 Resend Draw Emails</button></div>'
      + '<p class="form-hint" style="margin-top:10px;color:#e07070">The draw is locked and cannot be regenerated once fixtures have been created.</p>';
    h2hPanel.style.display = 'block';
    h2hPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  h2hTitle.textContent = 'H2H Fixtures — ' + roundName;
  h2hBody.innerHTML    = '<div class="album-list-loading">Generating…</div>';
  h2hPanel.style.display = 'block';
  h2hPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    var result = await adminAPI('fantasy.createH2HFixtures', { round_id: roundId });
    var fixtures = result.fixtures || [];
    var method   = result.method === 'standings' ? 'standings-based draw' : 'random draw';

    if (!fixtures.length) {
      h2hBody.innerHTML = '<div class="album-list-loading" style="color:#e07070">No fixtures generated. Need ≥2 approved participants.</div>';
      return;
    }

    // Fetch participant names for display
    var pR   = await fetch(SUPABASE_URL+'/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name', {headers:H});
    var pMap = {};
    (await pR.json() || []).forEach(function(p){ pMap[p.id] = p.team_name || p.name; });

    h2hBody.innerHTML = '<div class="h2h-method-label">'+method+' · '+fixtures.length+' fixture'+(fixtures.length!==1?'s':'')+'</div>'
      + fixtures.map(function(f) {
          var nameA = pMap[f.participant_a] || 'Unknown';
          var nameB = f.participant_b       ? (pMap[f.participant_b] || 'Unknown') : '<em>Mr. Average</em>';
          return '<div class="h2h-fixture-row"><span class="h2h-name-a">'+nameA+'</span><span class="h2h-vs">vs</span><span class="h2h-name-b">'+nameB+'</span></div>';
        }).join('');
  } catch(e) {
    h2hBody.innerHTML = '<div class="album-list-loading" style="color:#e07070">Error: '+e.message+'</div>';
  }
}

/* ── H2H: resolve results ── */
async function resolveH2H(roundId, roundName) {
  if (!confirm('Resolve H2H results for "'+roundName+'"?\n\nThis will calculate win/loss/draw for each fixture based on current scores.\nYou can re-resolve after editing scores.')) return;

  var h2hPanel = document.getElementById('h2h-fixtures-panel');
  var h2hTitle = document.getElementById('h2h-panel-title');
  var h2hBody  = document.getElementById('h2h-fixtures-body');
  if (!h2hPanel) return;

  h2hTitle.textContent   = 'H2H Results — ' + roundName;
  h2hBody.innerHTML      = '<div class="album-list-loading">Resolving…</div>';
  h2hPanel.style.display = 'block';
  h2hPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    var result   = await adminAPI('fantasy.resolveH2H', { round_id: roundId });
    var results  = result.results || [];
    var avgPts   = result.avgPts  || 0;

    // Fetch participant names
    var pR  = await fetch(SUPABASE_URL+'/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name', {headers:H});
    var pMap= {};
    (await pR.json() || []).forEach(function(p){ pMap[p.id] = p.team_name || p.name; });

    // Fetch fixtures to get participant_b (who might be null = Mr. Average)
    var fR  = await fetch(SUPABASE_URL+'/rest/v1/fantasy_h2h_fixtures?round_id=eq.'+roundId+'&select=*', {headers:H});
    var fMap= {};
    (await fR.json() || []).forEach(function(f){ fMap[f.id] = f; });

    h2hBody.innerHTML = '<div class="h2h-method-label">'+results.length+' fixture'+(results.length!==1?'s':'')+' resolved · Mr. Average = '+avgPts+'pt</div>'
      + results.map(function(res) {
          var fixture  = fMap[res.id] || {};
          var nameA    = pMap[fixture.participant_a] || 'Unknown';
          var nameB    = fixture.participant_b ? (pMap[fixture.participant_b] || 'Unknown') : '<em>Mr. Average</em>';
          var winA     = res.winner_id === fixture.participant_a;
          var winB     = fixture.participant_b && res.winner_id === fixture.participant_b;
          var isDraw   = res.winner_id === null;
          var tag      = isDraw ? '<span class="h2h-draw-badge">DRAW</span>'
                       : winA  ? '<span class="h2h-win-badge">WIN</span>'
                       :         '<span class="h2h-loss-badge">WIN</span>';
          return '<div class="h2h-fixture-row resolved">'
            + '<span class="h2h-name-a'+(winA?' h2h-winner':'')+'">'+nameA+'</span>'
            + '<span class="h2h-score">'+res.pts_a+'<span class="h2h-score-sep">–</span>'+res.pts_b+'</span>'
            + '<span class="h2h-name-b'+(winB?' h2h-winner':'')+'">'+nameB+'</span>'
            + tag
            + '</div>';
        }).join('')
      + '<div class="h2h-resend-row">'      + '<button class="btn-sm" onclick="resendH2HDrawEmails(\''+roundId+'\',\''+roundName+'\')" title="Re-send draw notification to all participants">📨 Resend Draw Emails</button>'      + '<button class="btn-sm" onclick="resendH2HResultEmails(\''+roundId+'\',\''+roundName+'\')" title="Re-send result notifications to all participants">📨 Resend Result Emails</button>'      + '</div>';  } catch(e) {
    h2hBody.innerHTML = '<div class="album-list-loading" style="color:#e07070">Error: '+e.message+'</div>';
  }
}

/* ── H2H: resend draw emails ── */
async function resendH2HDrawEmails(roundId, roundName) {
  if (!confirm('Resend H2H draw notification emails for "'+roundName+'"?\n\nAll participants will receive the draw email again.')) return;
  try {
    await adminAPI('fantasy.resendH2HDraw', { round_id: roundId });
    alert('Draw emails sent for "'+roundName+'"');
  } catch(e) { alert('Error: ' + e.message); }
}

/* ── H2H: resend result emails ── */
async function resendH2HResultEmails(roundId, roundName) {
  if (!confirm('Resend H2H result emails for "'+roundName+'"?\n\nAll participants will receive their result again.')) return;
  try {
    await adminAPI('fantasy.resendH2HResult', { round_id: roundId });
    alert('Result emails sent for "'+roundName+'"');
  } catch(e) { alert('Error: ' + e.message); }
}

/* ── Lock round ── */
async function lockRound(id) {
  try {
    var res = await adminAPI('fantasy.lockRound', { id: id });
    loadRoundsAdmin();

    /* Locking now also copies a team forward for anyone who never
       submitted, so say what happened. Silence here would mean the
       first anybody heard of a carried team was a manager asking why
       they scored points for a round they skipped. */
    var c = res && res.carry;
    if (c && (c.carried || c.dormant || c.skipped || (c.errors && c.errors.length))) {
      var lines = [];
      if (c.carried)      lines.push(c.carried + (c.carried === 1 ? ' team was' : ' teams were') + ' carried forward.');
      if (c.dormant)      lines.push(c.dormant + (c.dormant === 1 ? ' manager has' : ' managers have') + ' had three rounds carried in a row, so nothing was carried this time.');
      if (c.skipped)      lines.push(c.skipped + ' could not be carried: no legal XI under this round’s prices and eligibility.');
      if (c.never_played) lines.push(c.never_played + ' approved ' + (c.never_played === 1 ? 'manager has' : 'managers have') + ' never entered a team, so there was nothing to copy.');
      if (c.errors && c.errors.length) lines.push('\nErrors:\n' + c.errors.join('\n'));
      alert('Round locked.\n\n' + lines.join('\n'));
    }
  } catch(e) { alert('Failed to lock: ' + e.message); }
}

/* ── Carry forward, after the fact ──
   For rounds that locked before auto carry-forward existed. The lock
   does this by itself now; this is the backlog.

   Run 20-who-missed-a-round.sql first to see who it would affect. */
async function carryForwardRound(id, name) {
  try {
    var res = await adminAPI('fantasy.carryForwardRound', { round_id: id });

    /* Already scored. The Worker is asking, not failing. */
    if (res && res.needs_confirm) {
      if (!confirm(res.message + '\n\nCarry teams forward into "' + name + '" anyway?')) return;
      res = await adminAPI('fantasy.carryForwardRound', { round_id: id, confirm_scored: true });
    }

    var c = (res && res.carry) || {};
    var lines = [];
    if (c.carried)      lines.push(c.carried + (c.carried === 1 ? ' team was' : ' teams were') + ' carried forward.');
    if (c.dormant)      lines.push(c.dormant + (c.dormant === 1 ? ' manager has' : ' managers have') + ' had three rounds carried in a row, so nothing was carried for ' + (c.dormant === 1 ? 'them' : 'those') + '.');
    if (c.skipped)      lines.push(c.skipped + ' could not be carried: no legal XI under this round’s prices and eligibility.');
    if (c.never_played) lines.push(c.never_played + ' approved ' + (c.never_played === 1 ? 'manager has' : 'managers have') + ' never entered a team, so there was nothing to copy.');
    if (c.errors && c.errors.length) lines.push('\nErrors:\n' + c.errors.join('\n'));

    if (!lines.length) {
      alert('Nothing to carry for "' + name + '" — everybody already has a team in it.');
    } else {
      alert('"' + name + '"\n\n' + lines.join('\n')
        + (res && res.scored && c.carried
            ? '\n\nThis round was already scored. Re-save its scores and recompute badges so the new teams count.'
            : ''));
    }
    loadRoundsAdmin();
  } catch(e) { alert('Carry failed: ' + e.message); }
}

/* ── Unlock round ── */
async function unlockRound(id) {
  try {
    await adminAPI('fantasy.unlockRound', { id: id });
    loadRoundsAdmin();
  } catch(e) { alert('Failed to unlock: ' + e.message); }
}

/* ── Edit round ── */
async function editRound(id, name, deadline, wildcard, h2h, boost) {
  document.getElementById('edit-round-id').value       = id;
  document.getElementById('edit-round-name').value     = name;
  document.getElementById('edit-round-deadline').value = deadline ? deadline.substring(0,16) : '';
  document.getElementById('edit-round-wildcard').checked = wildcard;
  document.getElementById('edit-round-h2h').checked     = !!h2h;
  var boostEl = document.getElementById('edit-round-boost'); if (boostEl) boostEl.value = boost || '';
  var linkedIds = [];
  try {
    var lr = await fetch(SUPABASE_URL + '/rest/v1/fantasy_round_fixtures?round_id=eq.' + id + '&select=fixture_id', { headers: H });
    linkedIds = (await lr.json() || []).map(function(x){ return x.fixture_id; });
  } catch(e) {}
  await loadFixtureOptions('edit-round-fixtures', linkedIds);
  document.getElementById('edit-round-form').style.display = 'block';
  document.getElementById('edit-round-error').style.display = 'none';
  document.getElementById('edit-round-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById('edit-round-cancel-btn').addEventListener('click', function() {
  document.getElementById('edit-round-form').style.display = 'none';
});

document.getElementById('save-edit-round-btn').addEventListener('click', async function() {
  var id       = document.getElementById('edit-round-id').value;
  var name     = document.getElementById('edit-round-name').value.trim();
  var deadline = document.getElementById('edit-round-deadline').value;
  var wildcard = document.getElementById('edit-round-wildcard').checked;
  var h2h      = document.getElementById('edit-round-h2h').checked;
  var boost    = document.getElementById('edit-round-boost') ? document.getElementById('edit-round-boost').value : '';
  var errEl    = document.getElementById('edit-round-error');
  errEl.style.display = 'none';
  if (!name || !deadline) { errEl.textContent = '❌ Name and deadline required.'; errEl.style.display = 'block'; return; }
  this.disabled = true;
  try {
    var fixtureIds = getSelectedFixtures('edit-round-fixtures');
    await adminAPI('fantasy.updateRound', { id: id, name: name, deadline: new Date(deadline).toISOString(), wildcard: wildcard, h2h: h2h, boost_modifier: boost || null, fixture_ids: fixtureIds });
    document.getElementById('edit-round-form').style.display = 'none';
    loadRoundsAdmin();
  } catch(e) { errEl.textContent = '❌ ' + e.message; errEl.style.display = 'block'; }
  finally { this.disabled = false; }
});

/* ── Enter scores ── */
/* ═══════════════════════════════════════════════════════
   SCORES — per-match entry, multiple matches per round
═══════════════════════════════════════════════════════ */
var scoreMatches    = [];   // [{ label, players: [{playerId, runs, wickets, catches, stumpings, potm}] }]
var activeMatchIdx  = 0;
/* ── FANTASY ELIGIBILITY ──────────────────────────────────────────
   THIS MUST MATCH THE fantasy_players VIEW, clause for clause. The
   view decides who can be PICKED; this decides who can be SCORED, and
   a disagreement between them means a player somebody has in their
   team cannot be given a score, or a player nobody could pick gets
   one. 10-fantasy-players-minors.sql is the other half.

   The rule: playing members, not youth squad, and either an adult or
   a minor whose media consent is on file.

   Minors used to be excluded outright. They are now admitted on
   consent, because a 16-year-old who opens the batting for the 1st XI
   is part of the squad the league is played on. `squad` still records
   which side someone plays for and NOT their age, so moving a junior
   into a senior squad remains the deliberate human act that puts them
   in scope — the age test no longer blocks it, the squad test still
   does, and without consent they are still out.

   Players with no age data on record are treated as adults (legacy
   profiles created before the registration pipeline). is_minor is the
   explicit override for any of those that turn out to be juniors. */
function isFantasyEligible(p) {
  if (!p) return false;
  if (p.member_type && p.member_type !== 'player') return false;

  /* Case-insensitive and widened to the usual age-group spellings.
     This was squad === 'youth', exact and lower case, so a player
     whose squad read 'Youth' slipped past it — survivable only while
     the age test below caught them regardless. Admitting consented
     minors removes that second net, so a spelling slip would now put
     a child on the pick screen. Keep this list and the one in the
     fantasy_players view identical. */
  var squad = String(p.squad == null ? 'senior' : p.squad).trim().toLowerCase();
  if (['youth','youths','junior','juniors','colts','mini','minis'].indexOf(squad) !== -1) return false;
  if (/^u-? ?[0-9]{1,2}/.test(squad)) return false;   // u19, U-17, u 15 …

  var minor = (p.is_minor === true);
  if (!minor && p.dob) {
    /* Compared as calendar dates, exactly as the view does
       (dob <= current_date - interval '18 years').

       This used to divide milliseconds by 31557600000 — the length of
       an average Julian year, 365.25 days. Eighteen real years is
       6574 days and that average makes it 6574.5, so on the morning
       of someone's eighteenth birthday the arithmetic returned 17.
       One day, once per player, and it did not matter while minors
       were excluded outright. It matters now: for that one day the
       view would call them pickable and this would call them
       unscoreable, and somebody's team would quietly score nothing
       for them. eligibility-parity-test.js found it.

       ISO date strings compare correctly with > and <, which also
       sidesteps timezones and DST entirely — and Postgres clamps
       29 February back to the 28th the same way a string comparison
       against a non-existent 02-29 does. */
    var dobIso = String(p.dob).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dobIso)) {
      var n  = new Date();
      var pad = function (v) { return (v < 10 ? '0' : '') + v; };
      var cutoff = (n.getFullYear() - 18) + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
      if (dobIso > cutoff) minor = true;
    }
  }
  /* Consent is the gate, and it has to be an explicit true — a null,
     an undefined or a missing column all mean "not recorded", which
     is not consent. If a minor you expect to see is missing from the
     score grid, this is why: record it in the player admin. */
  if (minor) return p.media_consent === true;

  return true;
}

/* Fetch active players with the fields needed to judge eligibility.
   Falls back to a squad-only select if this database predates the
   dob/is_minor columns, so the admin never breaks on an older schema. */
var fantasyConsentFieldMissing = false;

async function fetchPlayersForFantasy() {
  /* Via the Worker (service key): dob is revoked from the public anon key, but
     the minor-eligibility check below needs it. */
  var rows = await adminAPI('player.listFantasy', {});
  if (!Array.isArray(rows)) return [];

  /* "Consent not given" and "consent never sent to me" are different
     answers, and isFantasyEligible() cannot tell them apart — both
     come out as falsy and both exclude the player. One is the rule
     working; the other is the Worker's player.listFantasy still
     missing media_consent from its select, which looks EXACTLY the
     same from the score grid: the minor is simply not in the list.

     So detect the field's absence rather than its value, and say so
     out loud. A deployment that is half-applied should not be
     indistinguishable from a guardian who ticked no. */
  fantasyConsentFieldMissing = rows.length > 0
    && !Object.prototype.hasOwnProperty.call(rows[0], 'media_consent');
  if (fantasyConsentFieldMissing) {
    console.warn('player.listFantasy returned no media_consent field — the Worker '
               + 'patch has not been applied, so every minor will be treated as '
               + 'unconsented and kept out of the score grid.');
  }
  return rows;
}

var allScorePlayers = [];   // eligible squad (+ anyone already scored this round)

async function openScores(roundId, roundName) {
  currentScoreRound = roundId;
  document.getElementById('scores-round-name').textContent = roundName;
  document.getElementById('scores-section').style.display = 'block';
  document.getElementById('scores-success').style.display = 'none';
  document.getElementById('scores-error').style.display   = 'none';

  var content = document.getElementById('scores-match-content');
  content.innerHTML = '<div class="album-list-loading">Loading…</div>';

  try {
    var [pr, sr] = await Promise.all([
      fetchPlayersForFantasy(),
      fetch(SUPABASE_URL+'/rest/v1/fantasy_scores?round_id=eq.'+roundId+'&select=*&order=match_label.asc,created_at.asc', {headers:H}).then(function(r){return r.json();})
    ]);

    /* Show eligible players, plus anyone who already has a score in this
       round. Saving clears and re-inserts the round from these rows, so an
       existing score that wasn't rendered would be silently deleted. */
    var scoredIds = {};
    (sr||[]).forEach(function(s){ if (s.player_id) scoredIds[s.player_id] = true; });
    allScorePlayers = (pr || []).filter(function(p){
      return isFantasyEligible(p) || scoredIds[p.id];
    });

    /* If the Worker is not sending media_consent, say so on screen
       instead of quietly producing a grid with the minors missing. */
    if (fantasyConsentFieldMissing) {
      var minorsHidden = (pr || []).filter(function(p){
        if (scoredIds[p.id]) return false;
        if (p.is_minor === true) return true;
        var dobIso = String(p.dob || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dobIso)) return false;
        var n = new Date(), pad = function(v){ return (v < 10 ? '0' : '') + v; };
        return dobIso > (n.getFullYear() - 18) + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
      }).length;
      if (minorsHidden > 0) {
        var warn = document.getElementById('scores-error');
        if (warn) {
          warn.textContent = 'Heads up: ' + minorsHidden + ' under-18 player'
            + (minorsHidden === 1 ? ' is' : 's are') + ' missing from this grid because the '
            + 'Worker is not sending media_consent. Add media_consent to the select in '
            + 'player.listFantasy and redeploy the Worker — until then every minor reads '
            + 'as unconsented, whatever is recorded against them.';
          warn.style.display = 'block';
        }
      }
    }

    // Group existing scores by match_label
    var matchMap = {};
    (sr||[]).forEach(function(s) {
      var lbl = s.match_label || 'Match 1';
      if (!matchMap[lbl]) matchMap[lbl] = [];
      matchMap[lbl].push(s);
    });

    var labels = Object.keys(matchMap);
    if (labels.length) {
      scoreMatches = labels.map(function(lbl) {
        return {
          label:   lbl,
          players: matchMap[lbl].map(function(s) {
            return { playerId: s.player_id, runs: s.runs||0, wickets: s.wickets||0, catches: s.catches||0, stumpings: s.stumpings||0, overs: s.overs!=null?s.overs:null, runs_conceded: s.runs_conceded!=null?s.runs_conceded:null, economy: s.economy!=null?s.economy:null, maidens: s.maidens||0, runouts: s.runouts||0, potm: !!s.player_of_match };
          })
        };
      });
    } else {
      scoreMatches = [{ label: 'Match 1', players: [] }];
    }
    activeMatchIdx = 0;
    renderMatchTabs();
    renderMatchScoreGrid();
  } catch(e) {
    content.innerHTML = '<div style="color:#e07070">Error loading players.</div>';
  }
}

function renderMatchTabs() {
  var tabs = document.getElementById('scores-match-tabs');
  tabs.innerHTML = scoreMatches.map(function(m, i) {
    return '<button class="scores-match-tab'+(i===activeMatchIdx?' active':'')+'" data-idx="'+i+'">'+m.label+'</button>';
  }).join('');
  tabs.querySelectorAll('.scores-match-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      saveCurrentMatchGrid(); // persist edits before switching
      activeMatchIdx = parseInt(btn.dataset.idx);
      renderMatchTabs();
      renderMatchScoreGrid();
    });
  });
}

function renderMatchScoreGrid() {
  var match   = scoreMatches[activeMatchIdx];
  var content = document.getElementById('scores-match-content');

  // Build player lookup for this match
  var existing = {};
  match.players.forEach(function(p) { existing[p.playerId] = p; });

  content.innerHTML =
    '<div class="sc-match-label-row">'
    + '<label class="form-label" style="font-size:0.72rem">Match label</label>'
    + '<input type="text" class="form-control sc-match-label" style="max-width:280px;margin-bottom:12px" value="'+match.label+'" placeholder="e.g. vs Parow CC">'
    + '</div>'
    + '<div class="scores-grid-wrap"><div class="scores-grid-row scores-grid-head"><span>Player</span><span>Runs</span><span>Wkts</span><span>Catches</span><span>Stump.</span><span>Overs</span><span>Runs&nbsp;cnc</span><span>Econ.</span><span>Maidens</span><span>Run-outs</span><span>POTM</span><span></span></div>'
    + allScorePlayers.map(function(p) {
        var s = existing[p.id] || null;
        // Only pre-fill if they have a score row, otherwise blank
        return '<div class="scores-grid-row" data-player-id="'+p.id+'">'
          + '<span class="sc-player-name">'+esc(p.name)+'<small>'+esc(p.role)+'</small></span>'
          + '<input type="number" min="0" class="sc-runs"      placeholder="—" value="'+(s?s.runs:'')+'">'
          + '<input type="number" min="0" class="sc-wickets"   placeholder="—" value="'+(s?s.wickets:'')+'">'
          + '<input type="number" min="0" class="sc-catches"   placeholder="—" value="'+(s?s.catches:'')+'">'
          + '<input type="number" min="0" class="sc-stumpings" placeholder="—" value="'+(s?s.stumpings:'')+'">'
          /* Overs is what says whether they bowled at all. Leave it blank
             for a player who did not — then nothing in the economy tier
             applies, however the other boxes read. Runs conceded turns
             4-0-23-2 straight off a scorecard into a rate, instead of
             asking whoever is typing to divide 23 by 4 in their head. */
          + '<input type="number" min="0" step="0.1" class="sc-overs"   placeholder="—" title="Overs bowled — blank if they did not bowl" value="'+(s&&s.overs!=null?s.overs:'')+'">'
          + '<input type="number" min="0" class="sc-conceded" placeholder="—" title="Runs conceded off those overs" value="'+(s&&s.runs_conceded!=null?s.runs_conceded:'')+'">'
          + '<span class="sc-econ-out" title="Worked out from overs and runs conceded">—</span>'
          + '<input type="number" min="0" class="sc-maidens"   placeholder="—" value="'+(s&&s.maidens!=null?s.maidens:'')+'">'
          + '<input type="number" min="0" class="sc-runouts"   placeholder="—" value="'+(s&&s.runouts!=null?s.runouts:'')+'">'
          + '<div class="scores-potm"><input type="checkbox" class="sc-potm" '+(s&&s.potm?'checked':'')+' title="POTM"></div>'
          + '<button class="btn-sm sc-clear-row" title="Clear row" style="opacity:0.4">✕</button>'
          + '</div>';
      }).join('') + '</div>';

  /* Show the rate as it is typed, so whoever is entering can see that
     4 overs for 0 really is 0.00 and not an empty box. */
  function paintEcon(row) {
    var o = parseFloat(row.querySelector('.sc-overs').value);
    var c = row.querySelector('.sc-conceded').value;
    var out = row.querySelector('.sc-econ-out');
    if (!out) return;
    if (isFinite(o) && o > 0 && String(c).trim() !== '') {
      out.textContent = (parseInt(c) / o).toFixed(2);
      out.classList.add('on');
    } else if (isFinite(o) && o > 0) {
      out.textContent = '?';
      out.classList.remove('on');
    } else {
      out.textContent = '—';
      out.classList.remove('on');
    }
  }
  content.querySelectorAll('.scores-grid-row[data-player-id]').forEach(function(row) {
    paintEcon(row);
    row.querySelectorAll('.sc-overs, .sc-conceded').forEach(function(inp) {
      inp.addEventListener('input', function() { paintEcon(row); });
    });
  });

  // Clear row buttons
  content.querySelectorAll('.sc-clear-row').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var row = btn.closest('.scores-grid-row');
      row.querySelector('.sc-runs').value      = '';
      row.querySelector('.sc-wickets').value   = '';
      row.querySelector('.sc-catches').value   = '';
      row.querySelector('.sc-stumpings').value = '';
      row.querySelector('.sc-overs').value    = '';
      row.querySelector('.sc-conceded').value = '';
      paintEcon(row);
      row.querySelector('.sc-maidens').value   = '';
      row.querySelector('.sc-runouts').value   = '';
      row.querySelector('.sc-potm').checked    = false;
    });
  });
}

function saveCurrentMatchGrid() {
  var content = document.getElementById('scores-match-content');
  var match   = scoreMatches[activeMatchIdx];
  if (!match || !content) return;

  var labelInput = content.querySelector('.sc-match-label');
  if (labelInput) match.label = labelInput.value.trim() || match.label;

  match.players = [];
  content.querySelectorAll('.scores-grid-row[data-player-id]').forEach(function(row) {
    var runs      = row.querySelector('.sc-runs').value;
    var wickets   = row.querySelector('.sc-wickets').value;
    var catches   = row.querySelector('.sc-catches').value;
    var stumpings = row.querySelector('.sc-stumpings').value;
    var overs     = row.querySelector('.sc-overs').value;
    var conceded  = row.querySelector('.sc-conceded').value;
    var maidens   = row.querySelector('.sc-maidens').value;
    var runouts   = row.querySelector('.sc-runouts').value;
    var potm      = row.querySelector('.sc-potm').checked;
    // Only include players who have at least one field filled in
    if (runs === '' && wickets === '' && catches === '' && stumpings === '' &&
        overs === '' && conceded === '' && maidens === '' && runouts === '' && !potm) return;
    match.players.push({
      playerId:  row.dataset.playerId,
      runs:      parseInt(runs)      || 0,
      wickets:   parseInt(wickets)   || 0,
      catches:   parseInt(catches)   || 0,
      stumpings: parseInt(stumpings) || 0,
      overs:     overs !== '' ? parseFloat(overs) : null,
      /* Runs conceded only means anything alongside overs — the table
         has a CHECK saying so. */
      runs_conceded: (overs !== '' && parseFloat(overs) > 0 && conceded !== '') ? parseInt(conceded) : null,
      /* economy is still written, so anything reading that column —
         including rows filed before the overs column existed — keeps
         working. It is derived here, never typed. */
      economy:   (overs !== '' && conceded !== '' && parseFloat(overs) > 0)
                   ? Math.round((parseInt(conceded) / parseFloat(overs)) * 100) / 100
                   : null,
      maidens:   parseInt(maidens)   || 0,
      runouts:   parseInt(runouts)   || 0,
      potm:      potm
    });
  });
}

document.getElementById('add-match-btn').addEventListener('click', function() {
  saveCurrentMatchGrid();
  var newLabel = 'Match ' + (scoreMatches.length + 1);
  scoreMatches.push({ label: newLabel, players: [] });
  activeMatchIdx = scoreMatches.length - 1;
  renderMatchTabs();
  renderMatchScoreGrid();
});

/* ── Save all matches ── */
document.getElementById('save-scores-btn').addEventListener('click', async function() {
  if (!currentScoreRound) return;
  saveCurrentMatchGrid();
  this.disabled = true;
  var suc = document.getElementById('scores-success');
  var err = document.getElementById('scores-error');
  suc.style.display = 'none'; err.style.display = 'none';

  // Build flat scores array — one entry per player per match
  var scores = [];
  scoreMatches.forEach(function(match) {
    match.players.forEach(function(p) {
      scores.push({
        round_id:        currentScoreRound,
        player_id:       p.playerId,
        match_label:     match.label,
        runs:            p.runs,
        wickets:         p.wickets,
        catches:         p.catches,
        stumpings:       p.stumpings,
        overs:           p.overs != null ? p.overs : null,
        runs_conceded:   p.runs_conceded != null ? p.runs_conceded : null,
        economy:         p.economy,
        maidens:         p.maidens,
        runouts:         p.runouts,
        player_of_match: p.potm
      });
    });
  });

  if (!scores.length) {
    err.textContent = '❌ No scores entered.';
    err.style.display = 'block';
    this.disabled = false;
    return;
  }

  try {
    /* One call, one transaction. This used to be a clearRoundScores
       followed by a saveScores: the delete committed on its own, so if
       the insert then failed — one row violating the overs check, a
       dropped connection, a Worker timeout — the round's scores were
       gone, on a database with no point-in-time recovery.

       fantasy_replace_round_scores does both inside a Postgres
       function, so a failure now leaves the previous scores exactly
       where they were and the error below says why. */
    var res = await adminAPI('fantasy.replaceRoundScores', {
      round_id: currentScoreRound, scores: scores
    });
    console.log('Scores saved: ' + ((res && res.saved) != null ? res.saved : scores.length) + ' row(s)');
    suc.style.display = 'block';
    // Fire badge check in background — don't block the save confirmation
    computeAndNotifyBadges(currentScoreRound).catch(function(e) {
      console.warn('Badge notify error (non-critical):', e);
    });
  } catch(e) { err.textContent = '❌ ' + e.message; err.style.display = 'block'; }
  finally { this.disabled = false; }
});


/* ═══════════════════════════════════════════════════════
   BADGE COMPUTATION + PUSH NOTIFICATION
   Called automatically after scores are saved.
   Uses computeBadges() from fantasy-badges.js.
═══════════════════════════════════════════════════════ */
async function computeAndNotifyBadges(roundId) {
  if (typeof computeBadges !== 'function') return; // safety — badges engine not loaded

  var safeArr = function(v) { return Array.isArray(v) ? v : []; };

  // Fetch everything needed for badge computation
  var [participants, picks, scores, rounds, players, existingBadges, h2hFixtures] = await Promise.all([
    /* Participants carry the email the badge push is addressed to, and
       email is no longer readable with the anon key — so this one goes
       through the Worker while the rest stay on PostgREST. A 401 here
       used to come back as an empty array and badges simply stopped
       being awarded, silently, which is the failure this whole file
       has a history of. */
    adminAPI('fantasy.listParticipants', { status: 'approved' }).catch(function(){ return []; }),
    fetch(SUPABASE_URL+'/rest/v1/fantasy_picks?select=*', {headers:H}).then(function(r){return r.ok?r.json():[];}),
    fetch(SUPABASE_URL+'/rest/v1/fantasy_scores?select=*', {headers:H}).then(function(r){return r.ok?r.json():[];}),
    fetch(SUPABASE_URL+'/rest/v1/fantasy_rounds?select=id,name,wildcard,boost_modifier&order=created_at.asc', {headers:H}).then(function(r){return r.ok?r.json():[];}),
    fetch(SUPABASE_URL+'/rest/v1/players?active=not.eq.false&select=id,name,role,fantasy_value', {headers:H}).then(function(r){return r.ok?r.json():[];}),
    fetch(SUPABASE_URL+'/rest/v1/fantasy_badges?select=participant_id,badge_id', {headers:H}).then(function(r){return r.ok?r.json():[];}),
    fetch(SUPABASE_URL+'/rest/v1/fantasy_h2h_fixtures?resolved=eq.true&select=participant_a,participant_b,winner_id,round_id', {headers:H}).then(function(r){return r.ok?r.json():[];}),
  ]);

  participants = safeArr(participants);
  picks        = safeArr(picks);
  scores       = safeArr(scores);
  players      = safeArr(players);
  existingBadges = safeArr(existingBadges);

  // Build allRounds map
  var allRounds = {};
  safeArr(rounds).forEach(function(r) { allRounds[r.id] = r; });

  // Build score lookup and ranked array (needed by computeBadges)
  /* Through the shared aggregator, which keeps maidens, run-outs and
     economy. This lookup used to drop all three, so badges were decided
     on a smaller score than the leaderboard showed. */
  var badgeRows = {};
  scores.forEach(function(s) {
    var key = s.round_id + '_' + s.player_id;
    (badgeRows[key] = badgeRows[key] || []).push(s);
  });
  var scoreLookup = {};
  Object.keys(badgeRows).forEach(function(key) {
    scoreLookup[key] = FantasyScoring.aggregate(badgeRows[key]);
  });
  /* Player roles, for the round boost modifiers. */
  var badgeRoleOf = {};
  (players || []).forEach(function(p) { badgeRoleOf[p.id] = p.role || ''; });

  /* NOTE: computeBadges() in js/fantasy-badges.js is handed the RAW
     fantasy_scores rows below and scores them with its own copy of this
     arithmetic. That copy has not been converted — it is the last one
     left, and badges.html reportedly carries another. Until they are
     pointed at FantasyScoring too, a badge decided inside the engine
     can still disagree with the leaderboard. The totals and ranking
     this file computes and passes in ARE now correct. */

  var totals = {};
  picks.forEach(function(pick) {
    var pid = pick.participant_id;
    if (!totals[pid]) totals[pid] = { participantId: pid, points: 0, rounds: 0, roundPts: {}, picks: [] };
    var rnd    = allRounds[pick.round_id] || {};
    var isWild = !!rnd.wildcard;
    /* Chips and the round boost, as every other surface applies them. */
    var rp = FantasyScoring.pickPoints(pick, function(id) {
      return scoreLookup[pick.round_id + '_' + id] || null;
    }, { wildcard: isWild, boost: rnd.boost_modifier || null,
         roleOf: function(id) { return badgeRoleOf[id] || ''; } });
    totals[pid].points      += rp;
    totals[pid].rounds      += 1;
    totals[pid].roundPts[pick.round_id] = rp;
    totals[pid].picks.push(pick);
  });
  var ranked = Object.values(totals).sort(function(a, b) { return b.points - a.points; });

  // Compute badges for each participant, collect newly earned
  var newlyEarned = [];
  participants.forEach(function(p) {
    var alreadyEarned = existingBadges
      .filter(function(b) { return b.participant_id === p.id; })
      .map(function(b) { return b.badge_id; });

    var result = computeBadges(p.id, {
      allPicks:       picks,
      allScores:      scores,
      allRounds:      allRounds,
      allPlayers:     players,
      ranked:         ranked,
      existingBadges: existingBadges.filter(function(b) { return b.participant_id === p.id; }),
      allH2HFixtures: h2hFixtures || [],
    });

    result.earned.forEach(function(badge) {
      if (alreadyEarned.indexOf(badge.id) === -1) {
        newlyEarned.push({
          participant_id:   p.id,
          participant_name: p.team_name || p.name,
          participant_email: p.email,
          badge_id:   badge.id,
          badge_name: badge.name,
          badge_icon: badge.icon,
          round_id:   roundId,
        });
      }
    });
  });

  if (!newlyEarned.length) return; // nothing to do

  // Send to worker — saves to DB + sends push notifications
  await adminAPI('fantasy.saveBadgesAndNotify', { badges: newlyEarned });
  console.log('Badge notify: ' + newlyEarned.length + ' new badge(s) sent');
}

/* ═══════════════════════════════════════════════════════
   SCORES IMPORT — CSV / Excel
═══════════════════════════════════════════════════════ */
document.getElementById('scores-import-file').addEventListener('change', async function() {
  var file = this.files[0];
  if (!file) return;
  var errEl = document.getElementById('import-error');
  errEl.style.display = 'none';
  this.value = '';

  try {
    var rows = await parseScoreFile(file);
    if (!rows || !rows.length) { errEl.textContent = '❌ No data rows found in file.'; errEl.style.display = 'block'; return; }

    saveCurrentMatchGrid();

    // Build a new match tab from the file
    var matchLabel = file.name.replace(/\.(csv|xlsx|xls)$/i, '').replace(/_/g,' ') || ('Match ' + (scoreMatches.length + 1));
    var matched = [], skipped = [];

    rows.forEach(function(row) {
      var name = (row['Player Name'] || row['player_name'] || row['name'] || row['Player'] || '').trim();
      if (!name) return;
      // Case-insensitive match against loaded players
      var player = allScorePlayers.find(function(p) {
        return p.name.toLowerCase() === name.toLowerCase();
      });
      if (!player) { skipped.push(name); return; }

      var potm    = String(row['Player of Match (yes/no)'] || row['POTM'] || row['potm'] || row['player_of_match'] || '').toLowerCase();
      /* Overs is what says whether they bowled. A sheet from before the
         column existed has none, and falls back to its Economy value.

         cell() picks the first column that is PRESENT, not the first
         that is truthy. `row['Runs Conceded'] || ''` looks equivalent
         and is not: a spell of 0 runs conceded is falsy, so it fell
         through to the empty string and four overs for nothing came
         back as though nobody had bowled — the exact fault this column
         was added to fix. */
      var cell = function(keys) {
        for (var i = 0; i < keys.length; i++) {
          var v = row[keys[i]];
          if (v !== undefined && v !== null && String(v).trim() !== '') return v;
        }
        return '';
      };
      var oversRaw = cell(['Overs', 'overs']);
      var concRaw  = cell(['Runs Conceded', 'runs_conceded', 'Runs conceded', 'Conceded', 'conceded']);
      var econRaw  = cell(['Economy', 'economy', 'Econ', 'econ']);
      var oversN   = String(oversRaw).trim() !== '' ? parseFloat(oversRaw) : null;
      var concN    = (oversN != null && oversN > 0 && String(concRaw).trim() !== '') ? parseInt(concRaw) : null;
      matched.push({
        playerId:  player.id,
        runs:      parseInt(row['Runs']      || row['runs']      || 0) || 0,
        wickets:   parseInt(row['Wickets']   || row['wickets']   || 0) || 0,
        catches:   parseInt(row['Catches']   || row['catches']   || 0) || 0,
        stumpings: parseInt(row['Stumpings'] || row['stumpings'] || 0) || 0,
        maidens:   parseInt(row['Maidens']   || row['maidens']   || 0) || 0,
        runouts:   parseInt(row['Run Outs']  || row['run_outs']  || row['Run-outs'] || row['runouts'] || 0) || 0,
        overs:         oversN,
        runs_conceded: concN,
        economy:   (oversN != null && oversN > 0 && concN != null)
                     ? Math.round((concN / oversN) * 100) / 100
                     /* Legacy sheet. A rate of 0 with no overs cannot be
                        told apart from "did not bowl", so it stays null
                        rather than being stored as a real 0.00. */
                     : (oversN == null && parseFloat(econRaw) > 0 ? parseFloat(econRaw) : null),
        potm:      potm === 'yes' || potm === '1' || potm === 'true'
      });
    });

    if (!matched.length) {
      errEl.textContent = '❌ No players matched. Check names match exactly. Not matched: ' + skipped.join(', ');
      errEl.style.display = 'block';
      return;
    }

    scoreMatches.push({ label: matchLabel, players: matched });
    activeMatchIdx = scoreMatches.length - 1;
    renderMatchTabs();
    renderMatchScoreGrid();

    if (skipped.length) {
      errEl.textContent = '⚠️ Imported ' + matched.length + ' players. Not matched: ' + skipped.join(', ');
      errEl.style.color = '#d4a830';
      errEl.style.display = 'block';
      setTimeout(function(){ errEl.style.color=''; errEl.style.display='none'; }, 6000);
    }
  } catch(e) {
    errEl.textContent = '❌ Could not parse file: ' + e.message;
    errEl.style.display = 'block';
  }
});

function parseScoreFile(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function() { reject(new Error('File read failed')); };

    if (file.name.match(/\.csv$/i)) {
      reader.onload = function(e) {
        try {
          var lines  = e.target.result.split(/\r?\n/).filter(function(l){ return l.trim(); });
          if (!lines.length) { resolve([]); return; }
          var headers = lines[0].split(',').map(function(h){ return h.trim().replace(/^"|"$/g,''); });
          var rows = lines.slice(1).map(function(line) {
            var vals = line.split(',').map(function(v){ return v.trim().replace(/^"|"$/g,''); });
            var obj = {};
            headers.forEach(function(h, i){ obj[h] = vals[i] || ''; });
            return obj;
          });
          resolve(rows);
        } catch(e) { reject(e); }
      };
      reader.readAsText(file);
    } else {
      // Excel — use SheetJS
      reader.onload = function(e) {
        try {
          var wb   = XLSX.read(e.target.result, { type: 'array' });
          var ws   = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          resolve(rows);
        } catch(e) { reject(e); }
      };
      reader.readAsArrayBuffer(file);
    }
  });
}

/* ── PLAYER VALUES ── */
var fantasyStats = { participants:null, pending:null, rounds:null };
function fantasyRenderMetrics(){
  var el = document.getElementById('fantasy-metrics');
  if(!el) return;
  var v = function(x){ return x===null ? '\u2014' : String(x); };
  el.innerHTML = confMetricCard('Participants', v(fantasyStats.participants))
    + confMetricCard('Pending', v(fantasyStats.pending))
    + confMetricCard('Rounds', v(fantasyStats.rounds));
}

/* Filter the values grid by hiding rows (never re-render: the save button
   reads every row from the DOM, so removing rows would drop unsaved values). */
function fvApplyFilter(){
  var box = document.getElementById('fv-search');
  var term = (box ? box.value : '').trim().toLowerCase();
  var rows = document.querySelectorAll('#player-values-grid .player-values-grid-row[data-player-id]');
  var shown = 0;
  rows.forEach(function(row){
    var hay = row.dataset.search || '';
    var match = !term || hay.indexOf(term) !== -1;
    row.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  var countEl = document.getElementById('fv-count');
  if (countEl) countEl.textContent = shown + (shown === 1 ? ' player' : ' players');
}

async function loadPlayerValues() {
  var el = document.getElementById('player-values-grid');
  el.innerHTML = '<div class="mx-empty">Loading…</div>';
  try {
    var rows = (await fetchPlayersForFantasy()).filter(isFantasyEligible);
    if (!rows || !rows.length) { el.innerHTML = '<div class="mx-empty">No eligible senior players found.</div>'; return; }
    el.innerHTML = '<div class="player-values-grid-row"><span>Player</span><span>Role</span><span>Value (R)</span></div>'
      + rows.map(function(p) {
        var fvSearch = ((p.name||'') + ' ' + (p.role||'')).toLowerCase().replace(/"/g,'&quot;');
        return '<div class="player-values-grid-row" data-player-id="'+p.id+'" data-search="'+fvSearch+'">'
          + '<span>'+esc(p.name)+'</span>'
          + '<span class="player-role-tag">'+esc(p.role)+'</span>'
          + '<input type="number" min="1" max="20" value="'+(p.fantasy_value||5)+'" class="pv-input">'
          + '</div>';
      }).join('');
    fvApplyFilter();
  } catch(e) { el.innerHTML = '<div class="mx-empty" style="color:#e07070">Error loading players.</div>'; }
}

document.getElementById('save-values-btn').addEventListener('click', async function() {
  var rows   = document.querySelectorAll('#player-values-grid .player-values-grid-row[data-player-id]');
  var suc    = document.getElementById('values-success');
  var err    = document.getElementById('values-error');
  suc.style.display = 'none'; err.style.display = 'none';
  this.disabled = true;
  try {
    var updates = Array.from(rows).map(function(row) {
      return { id: row.dataset.playerId, value: parseInt(row.querySelector('.pv-input').value) || 5 };
    });
    // Send in batches of 10 to stay well under Worker subrequest limits
    var BATCH = 10;
    for (var i = 0; i < updates.length; i += BATCH) {
      await adminAPI('fantasy.savePlayerValues', { updates: updates.slice(i, i + BATCH) });
    }
    suc.style.display = 'block';
  } catch(e) { err.textContent = '❌ ' + e.message; err.style.display = 'block'; }
  finally { this.disabled = false; }
});

// Load player values when fantasy tab opens — handled by main tab listener above

/* ── DELETE ROUND ── */
async function deleteRound(id, name) {
  confirmModal('Delete Round', 'Delete "' + name + '"? All picks and scores for this round will also be deleted.', async function() {
    try {
      await adminAPI('fantasy.deleteRound', { id: id });
      loadRoundsAdmin();
      document.getElementById('scores-section').style.display = 'none';
    } catch(e) { alert('Delete failed: ' + e.message); }
  });
}

/* ── PARTICIPANTS (TEAMS) MANAGEMENT ── */
async function loadParticipants() {
  var el = document.getElementById('participants-list');
  if (!el) return;
  el.innerHTML = '<div class="album-list-loading">Loading…</div>';
  try {
    /* Same reason as the pending queue above: email is no longer
       readable with the anon key, so this goes through the Worker. */
    var rows = await adminAPI('fantasy.listParticipants', { status: 'approved' });
    if (!Array.isArray(rows)) rows = [];
    fantasyStats.participants = (rows && rows.length) || 0; fantasyRenderMetrics();
    if (!rows || !rows.length) { el.innerHTML = '<div class="mx-empty">No participants yet.</div>'; return; }
    el.innerHTML = rows.map(function(p) {
      var display = p.team_name ? '<strong>'+esc(p.team_name)+'</strong> <span style="color:var(--muted);font-size:0.8rem">— '+esc(p.name)+'</span>' : esc(p.name);
      return '<div class="round-list-item">'
        + '<div><div class="round-item-name">'+display+'</div><div class="round-item-meta">'+esc(p.email)+'</div></div>'
        + '<div class="round-item-actions">'
        + '<button class="btn-sm danger" data-id="'+esc(p.id)+'" data-name="'+esc(p.name)+'" onclick="deleteParticipant(this.dataset.id,this.dataset.name)">Remove</button>'
        + '</div>'
        + '</div>';
    }).join('');
  } catch(e) { el.innerHTML = '<div class="mx-empty" style="color:#e07070">Error loading participants.</div>'; }
}

async function deleteParticipant(id, name) {
  confirmModal('Remove Participant', 'Remove "' + name + '" from the fantasy league? Their picks will also be deleted.', async function() {
    try {
      await adminAPI('fantasy.deleteParticipant', { id: id });
      loadParticipants();
    } catch(e) { alert('Remove failed: ' + e.message); }
  });
}

// Load participants when fantasy tab opens
// (loadPlayerValues and loadRoundsAdmin already handled by main tab listener above)

/* ── PENDING REGISTRATIONS ── */
async function loadPendingRegistrations() {
  var el    = document.getElementById('pending-list');
  var badge = document.getElementById('pending-badge');
  if (!el) return;
  el.innerHTML = '<div class="album-list-loading">Loading…</div>';
  try {
    /* Through the Worker on the service key. This was a direct
       PostgREST read with the anon key, which stopped working when the
       email column was revoked from anon: PostgREST answers a request
       touching a column the role cannot read with 401 for the whole
       request, so select=* began failing outright. */
    var rows = await adminAPI('fantasy.listParticipants', { status: 'pending' });
    if (!Array.isArray(rows)) rows = [];
    fantasyStats.pending = (rows && rows.length) || 0; fantasyRenderMetrics();
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="mx-empty">No pending registrations.</div>';
      if (badge) badge.style.display = 'none';
      return;
    }
    if (badge) { badge.textContent = rows.length; badge.style.display = 'inline-flex'; }
    el.innerHTML = rows.map(function(p) {
      var date = new Date(p.created_at).toLocaleDateString('en-ZA', {day:'numeric',month:'short',year:'numeric'});
      var eid = p.id;
      return '<div class="pending-card">'
        + '<div class="pending-info">'
        +   '<div class="pending-name">' + esc(p.name) + ' <span style="font-weight:400;opacity:0.5">/ ' + esc(p.team_name||'—') + '</span></div>'
        +   '<div class="pending-meta">' + esc(p.email) + ' &middot; Applied ' + date + '</div>'
        + '</div>'
        + '<div class="pending-actions">'
        +   '<button class="btn-approve" data-id="' + eid + '">&#10003; Approve</button>'
        +   '<button class="btn-reject"  data-id="' + eid + '">&#10005; Reject</button>'
        + '</div>'
        + '</div>';
    }).join('');
    // Attach listeners
    el.querySelectorAll('.btn-approve').forEach(function(btn) {
      btn.addEventListener('click', function(){ approveParticipant(this.dataset.id); });
    });
    el.querySelectorAll('.btn-reject').forEach(function(btn) {
      btn.addEventListener('click', function(){ rejectParticipant(this.dataset.id); });
    });
  } catch(e) { el.innerHTML = '<div class="mx-empty" style="color:#e07070">Error loading.</div>'; }
}

async function approveParticipant(id) {
  try {
    await adminAPI('fantasy.approveParticipant', { id: id });
    loadPendingRegistrations();
    loadParticipants();
  } catch(e) { alert('Failed to approve: ' + e.message); }
}

async function rejectParticipant(id) {
  if (!confirm('Reject this registration? The applicant will be notified and can reapply.')) return;
  try {
    await adminAPI('fantasy.rejectParticipant', { id: id });
    loadPendingRegistrations();
  } catch(e) { alert('Failed to reject: ' + e.message); }
}

/* ── NOTIFY PARTICIPANTS ── */
document.getElementById('notify-scores-btn').addEventListener('click', async function() {
  if (!currentScoreRound) return;
  this.disabled = true; this.textContent = '📧 Sending…';
  var suc = document.getElementById('notify-success');
  var err = document.getElementById('scores-error');
  suc.style.display = 'none'; err.style.display = 'none';
  try {
    // Get round name from the section title
    var roundName = document.getElementById('scores-round-name').textContent;
    var result    = await adminAPI('fantasy.notifyScores', { roundId: currentScoreRound, roundName: roundName });
    suc.textContent = '📧 Sent to ' + (result.sent||0) + ' participant' + ((result.sent||0) !== 1 ? 's' : '') + '!';
    suc.style.display = 'block';
  } catch(e) { err.textContent = '❌ ' + e.message; err.style.display = 'block'; }
  finally { this.disabled = false; this.textContent = '📧 Notify Participants'; }
});


/* ═══════════════════════════════════════════════════════
   PLAYER BIOS
═══════════════════════════════════════════════════════ */
/* ── Bio link generator ── */
async function loadBioLinkPlayers() {
  var sel = document.getElementById('bio-link-player-select');
  if (!sel || sel.options.length > 1) return; // already loaded
  try {
    var r = await fetch(SUPABASE_URL+'/rest/v1/players?active=not.eq.false&select=id,name&order=name.asc', {headers:H});
    var rows = await r.json();
    (rows||[]).forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      sel.appendChild(opt);
    });
  } catch(e) {}
}

document.getElementById('bio-link-generate-btn').addEventListener('click', function() {
  var sel     = document.getElementById('bio-link-player-select');
  var output  = document.getElementById('bio-link-output');
  var copyBtn = document.getElementById('bio-link-copy-btn');
  if (!sel.value) { alert('Please select a player first.'); return; }
  var url = 'https://tygerbergcc.co.za/player-bio.html?player=' + sel.value;
  output.textContent = url;
  output.style.display = 'block';
  copyBtn.style.display = 'inline-flex';
  copyBtn.textContent = '📋 Copy Link';
});

document.getElementById('bio-link-copy-btn').addEventListener('click', function() {
  var url = document.getElementById('bio-link-output').textContent;
  navigator.clipboard.writeText(url).then(function() {
    document.getElementById('bio-link-copy-btn').textContent = '✓ Copied!';
    setTimeout(function(){ document.getElementById('bio-link-copy-btn').textContent = '📋 Copy Link'; }, 2500);
  });
});

function bioRenderMetrics(pending, approved){
  var el = document.getElementById('bio-metrics');
  if(!el) return;
  el.innerHTML =
    confMetricCard('Pending', String(pending.length)) +
    confMetricCard('Approved', String(approved.length)) +
    confMetricCard('Total', String(pending.length + approved.length));
}

async function loadBioSubmissions() {
  var pendingEl  = document.getElementById('bio-pending-list');
  var approvedEl = document.getElementById('bio-approved-list');
  var badge      = document.getElementById('bio-pending-badge');
  if (!pendingEl) return;

  pendingEl.innerHTML  = '<div class="album-list-loading">Loading…</div>';
  approvedEl.innerHTML = '<div class="album-list-loading">Loading…</div>';

  try {
    var r    = await adminAPI('bio.list', {});
    var rows = Array.isArray(r) ? r : [];
    var pending  = (rows||[]).filter(function(s){ return s.status === 'pending'; });
    var approved = (rows||[]).filter(function(s){ return s.status === 'approved'; });

    // Badge
    bioRenderMetrics(pending, approved);

    // Pending
    if (!pending.length) {
      pendingEl.innerHTML = '<div class="mx-empty">No pending submissions.</div>';
    } else {
      pendingEl.innerHTML = pending.map(function(s) {
        var date    = new Date(s.created_at).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'});
        var current = s.current_player;

        // Build diff rows for batting/bowling
        function diffRow(label, submitted, existing, field) {
          if (!submitted) return '';
          if (!existing || existing.toLowerCase() === submitted.toLowerCase()) {
            return '<div class="bio-diff-row">'
              + '<span class="bdr-label">'+label+'</span>'
              + '<span class="bdr-val">'+submitted+'</span>'
              + '</div>';
          }
          return '<div class="bio-diff-row conflict">'
            + '<span class="bdr-label">'+label+'</span>'
            + '<span class="bdr-existing" title="Current in database">'+existing+'</span>'
            + '<span class="bdr-arrow">→</span>'
            + '<span class="bdr-new">'+submitted+'</span>'
            + '<label class="bdr-toggle" title="Apply this change">'
            + '<input type="checkbox" class="bio-update-field" data-field="'+field+'" data-val="'+submitted+'" checked>'
            + '<span>Update</span>'
            + '</label>'
            + '</div>';
        }

        var battingDiff = diffRow('Batting', s.batting_style, current ? current.batting_hand : null, 'batting_hand');
        var bowlingDiff = diffRow('Bowling', s.bowling_style, current ? current.bowling_style : null, 'bowling_style');

        // Photo diff
        var photoHtml = '';
        if (s.photo_url) {
          var hasExistingPhoto = current && current.photo_url;
          photoHtml = '<div class="bio-photo-preview-wrap">'
            + '<img src="'+s.photo_url+'" class="bio-photo-thumb" alt="Submitted photo">'
            + (hasExistingPhoto
                ? '<div class="bio-diff-row conflict" style="margin-top:6px">'
                  + '<span class="bdr-label">Photo</span>'
                  + '<img src="'+current.photo_url+'" class="bio-photo-thumb-sm" title="Current photo">'
                  + '<span class="bdr-arrow">→</span>'
                  + '<img src="'+s.photo_url+'" class="bio-photo-thumb-sm" title="Submitted photo">'
                  + '<label class="bdr-toggle">'
                  + '<input type="checkbox" class="bio-update-field" data-field="photo" checked>'
                  + '<span>Use new</span>'
                  + '</label>'
                  + '</div>'
                : '<div class="pending-meta" style="margin-top:4px">New photo — no existing</div>')
            + '</div>';
        }

        var hasDiff = battingDiff.includes('conflict') || bowlingDiff.includes('conflict') || (s.photo_url && current && current.photo_url);

        return '<div class="mx-review-card bio-card" data-id="'+s.id+'">'
          + '<div class="mx-review-top"><div class="mx-review-name">'+s.name
          +   '<span class="mx-review-nick">'+s.email+'</span>'
          +   (hasDiff ? '<span class="mx-tag mx-tag-warn">Conflicts</span>' : '')
          + '</div><div class="mx-review-date">Submitted '+date+'</div></div>'
          + (battingDiff || bowlingDiff
              ? '<div class="bio-diff-block">' + battingDiff + bowlingDiff + '</div>'
              : '')
          + (s.years_at_tcc ? '<div class="pending-meta">'+s.years_at_tcc+' years at TCC</div>' : '')
          + '<div class="bio-preview">'+s.bio+'</div>'
          + photoHtml
          + (s.fun_fact ? '<div class="bio-funfact">'+s.fun_fact+'</div>' : '')
          + '<div class="mx-review-foot">'
          +   '<button class="mx-btn mx-btn-sm mx-btn-primary bio-approve-btn" data-id="'+s.id+'" data-name="'+s.name+'">Approve</button>'
          +   '<button class="mx-btn mx-btn-sm mx-btn-danger bio-reject-btn" data-id="'+s.id+'">Reject</button>'
          + '</div>'
          + '</div>';
      }).join('');

      // Wire buttons — pass field override selections when approving
      pendingEl.querySelectorAll('.bio-approve-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var card      = btn.closest('.bio-card');
          var overrides = {};
          card.querySelectorAll('.bio-update-field').forEach(function(cb) {
            overrides[cb.dataset.field] = cb.checked; // true = apply player's value
          });
          approveBio(btn.dataset.id, btn.dataset.name, overrides);
        });
      });
      pendingEl.querySelectorAll('.bio-reject-btn').forEach(function(btn) {
        btn.addEventListener('click', function(){ rejectBio(btn.dataset.id); });
      });
    }

    // Approved
    if (!approved.length) {
      approvedEl.innerHTML = '<div class="mx-empty">No approved bios yet.</div>';
    } else {
      approvedEl.innerHTML = approved.map(function(s) {
        var fields = [];
        if (s.batting_style) fields.push(s.batting_style);
        if (s.bowling_style) fields.push(s.bowling_style);
        if (s.years_at_tcc)  fields.push(s.years_at_tcc + ' yrs');
        if (s.nickname)      fields.push('"' + s.nickname + '"');
        if (s.cricket_hero)  fields.push('Hero: ' + s.cricket_hero);
        if (s.favourite_shot) fields.push('Shot: ' + s.favourite_shot);
        return '<div class="mx-review-card">'
          + '<div class="mx-review-top"><div class="mx-review-name">'+s.name+'</div></div>'
          + '<div class="mx-review-sub">'+s.email+'</div>'
          + (fields.length ? '<div class="mx-review-rows"><div>'+fields.join(' · ')+'</div></div>' : '')
          + '<div class="bio-preview approved">'+s.bio+'</div>'
          + '<div class="mx-review-foot">'
          +   '<button class="mx-btn mx-btn-sm mx-btn-ghost bio-reapply-btn" data-id="'+s.id+'" data-name="'+s.name+'" title="Re-write all fields to the player profile">Re-apply</button>'
          +   '<button class="mx-btn mx-btn-sm mx-btn-danger bio-remove-btn" data-id="'+s.id+'">Remove</button>'
          + '</div>'
          + '</div>';
      }).join('');

      // Wire re-apply and remove buttons
      approvedEl.querySelectorAll('.bio-reapply-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { reapplyBio(btn.dataset.id, btn.dataset.name); });
      });
      approvedEl.querySelectorAll('.bio-remove-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { rejectBio(btn.dataset.id); });
      });
    }
  } catch(e) {
    pendingEl.innerHTML = '<div class="album-list-loading" style="color:#e07070">Error loading.</div>';
  }
}

async function approveBio(id, name, fieldOverrides) {
  try {
    var result = await adminAPI('bio.approve', { id: id, field_overrides: fieldOverrides || {} });
    if (result && !result.player_found) {
      showBioLinkDialog(id, name, fieldOverrides || {});
    } else {
      loadBioSubmissions();
    }
  } catch(e) { alert('Approve failed: ' + e.message); }
}

async function reapplyBio(id, name) {
  if (!confirm('Re-apply all fields from this submission to ' + name + '\'s player profile?\n\nThis will overwrite batting style, bowling style, years at TCC, nickname, cricket hero and favourite shot.')) return;
  try {
    // force_all bypasses conflict checking — writes everything
    var result = await adminAPI('bio.approve', { id: id, field_overrides: { batting_hand: true, bowling_style: true, photo: true }, force_all: true });
    if (result && !result.player_found) {
      showBioLinkDialog(id, name, { batting_hand: true, bowling_style: true, photo: true });
    } else {
      alert('✅ Fields re-applied to ' + name + '\'s profile.');
      loadBioSubmissions();
    }
  } catch(e) { alert('Re-apply failed: ' + e.message); }
}

async function showBioLinkDialog(submissionId, submittedName, fieldOverrides) {
  // Load active players for the dropdown
  var r     = await fetch(SUPABASE_URL+'/rest/v1/players?active=not.eq.false&select=id,name&order=name.asc', {headers:H});
  var squad = await r.json();

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML =
    '<div class="modal" style="max-width:480px">'
    + '<div class="modal-title">Link Bio to Player</div>'
    + '<div class="modal-body">'
    + '<p style="margin-bottom:12px;font-size:0.82rem;color:var(--muted2)">No player named <strong style="color:var(--white)">'+submittedName+'</strong> was found. Select the correct player to link this bio to, or create a new player first.</p>'
    + '<select id="bio-link-select" class="form-control" style="margin-bottom:8px">'
    + '<option value="">— Select a player —</option>'
    + (squad||[]).map(function(p){ return '<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>'; }).join('')
    + '</select>'
    + '<div class="upload-error" id="bio-link-error" style="display:none;margin-top:6px"></div>'
    + '</div>'
    + '<div class="modal-actions">'
    + '<button class="btn btn-outline-muted" id="bio-link-cancel">Cancel</button>'
    + '<button class="btn btn-primary" id="bio-link-confirm">Link & Approve →</button>'
    + '</div>'
    + '</div>';

  document.body.appendChild(overlay);

  document.getElementById('bio-link-cancel').addEventListener('click', function() {
    document.body.removeChild(overlay);
    loadBioSubmissions();
  });

  document.getElementById('bio-link-confirm').addEventListener('click', async function() {
    var playerId = document.getElementById('bio-link-select').value;
    var errEl    = document.getElementById('bio-link-error');
    if (!playerId) { errEl.textContent = 'Please select a player.'; errEl.style.display = 'block'; return; }
    this.disabled = true; this.textContent = 'Saving…';
    try {
      await adminAPI('bio.approve', { id: submissionId, player_id: playerId, field_overrides: fieldOverrides || {} });
      document.body.removeChild(overlay);
      loadBioSubmissions();
    } catch(e) { errEl.textContent = 'Failed: ' + e.message; errEl.style.display = 'block'; this.disabled = false; this.textContent = 'Link & Approve →'; }
  });
}

async function rejectBio(id) {
  if (!confirm('Reject and delete this bio submission? The player can resubmit.')) return;
  try {
    await adminAPI('bio.reject', { id: id });
    loadBioSubmissions();
  } catch(e) { alert('Reject failed: ' + e.message); }
}

/* ═══════════════════════════════════════════════════════
   PLAYER MANAGEMENT
═══════════════════════════════════════════════════════ */
var playerFilter  = 'active';
var allPlayersAdmin = [];

// Tab init
document.querySelectorAll('.nav-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    if (tab.dataset.tab === 'players') loadPlayersAdmin();
  });
});
document.getElementById('nav-tab-select').addEventListener('change', function() {
  if (this.value === 'players') loadPlayersAdmin();
});

// Filter buttons
var playerSquadFilter = 'all';
var playerSearchTerm = '';
document.querySelectorAll('.pf-btn[data-filter]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    btn.parentNode.querySelectorAll('.pf-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    playerFilter = btn.dataset.filter;
    renderPlayerList();
  });
});
document.querySelectorAll('.pf-btn[data-squad]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    btn.parentNode.querySelectorAll('.pf-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    playerSquadFilter = btn.dataset.squad;
    renderPlayerList();
  });
});
(function(){
  var s = document.getElementById('player-search');
  if (s) s.addEventListener('input', function(){ playerSearchTerm = s.value.trim().toLowerCase(); renderPlayerList(); });
})();

async function loadPlayersAdmin() {
  var el = document.getElementById('players-admin-list');
  el.innerHTML = '<div class="album-list-loading">Loading…</div>';
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/players?select=id,name,role,active,captain,vice_captain,photo_url,squad,member_type&order=name.asc', { headers: H });
    allPlayersAdmin = await r.json();
    renderPlayerList();
  } catch(e) { el.innerHTML = '<div class="album-list-loading" style="color:#e07070">Error loading players.</div>'; }
}

function renderPlayerList() {
  var el = document.getElementById('players-admin-list');
  var filtered = allPlayersAdmin.filter(function(p) {
    var isActive = p.active !== false;
    if (playerFilter === 'active' && !isActive) return false;
    if (playerFilter === 'inactive' && isActive) return false;
    if (playerSquadFilter !== 'all' && (p.squad || 'senior') !== playerSquadFilter) return false;
    if (playerSearchTerm) {
      var hay = ((p.name || '') + ' ' + (p.role || '')).toLowerCase();
      if (hay.indexOf(playerSearchTerm) === -1) return false;
    }
    return true;
  });
  var countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = filtered.length + (filtered.length === 1 ? ' player' : ' players');
  if (!filtered.length) { el.innerHTML = '<div class="mx-empty">No players match.</div>'; return; }
  el.innerHTML = filtered.map(function(p) {
    var badges = '';
    if (p.captain)      badges += '<span class="player-badge badge-captain" style="font-size:0.55rem;padding:1px 6px">C</span>';
    if (p.vice_captain) badges += '<span class="player-badge badge-vc" style="font-size:0.55rem;padding:1px 6px">VC</span>';
    if (p.member_type === 'executive')   badges += '<span class="player-badge" style="font-size:0.55rem;padding:1px 6px;background:rgba(201,168,76,0.22);color:#e6d19a">EXEC</span>';
    if (p.member_type === 'non_playing') badges += '<span class="player-badge" style="font-size:0.55rem;padding:1px 6px;background:rgba(110,115,127,0.3);color:#b9bdc5">NON-PLAYING</span>';
    var isActive = p.active !== false;
    var inactive = !isActive ? ' style="opacity:0.45"' : '';
    return '<div class="round-list-item player-admin-item" data-id="'+p.id+'"'+inactive+'>'
      + '<div style="display:flex;align-items:center;gap:10px;min-width:0">'
      + (p.photo_url
          ? '<img src="'+p.photo_url+'" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display=\'none\'">'
          : '<div style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.06);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--muted)">?</div>')
      + '<div>'
      + '<div class="round-item-name">'+esc(p.name)+' '+badges+'</div>'
      + '<div class="round-item-meta">'+esc(p.role)+(!isActive?' · Inactive':'')+'</div>'
      + '</div></div>'
      + '</div>';
  }).join('');
  el.querySelectorAll('.player-admin-item').forEach(function(item) {
    item.addEventListener('click', function() {
      el.querySelectorAll('.player-admin-item').forEach(function(i){ i.classList.remove('active'); });
      item.classList.add('active');
      loadPlayerEditor(item.dataset.id);
    });
  });
}

function playerDobInit(){
  var d = document.getElementById('player-dob-d');
  var m = document.getElementById('player-dob-m');
  var y = document.getElementById('player-dob-y');
  if (!d || d.dataset.built) return;
  var MONTHS = ['January','February','March','April','May','June','July',
                'August','September','October','November','December'];
  for (var i = 1; i <= 31; i++) d.insertAdjacentHTML('beforeend', '<option value="'+i+'">'+i+'</option>');
  MONTHS.forEach(function(nm, i){ m.insertAdjacentHTML('beforeend', '<option value="'+(i+1)+'">'+nm+'</option>'); });
  var thisYear = new Date().getFullYear();
  for (var yr = thisYear; yr >= thisYear - 90; yr--) y.insertAdjacentHTML('beforeend', '<option value="'+yr+'">'+yr+'</option>');
  d.dataset.built = '1';
  [d, m, y].forEach(function(el){ el.addEventListener('change', playerDobSync); });
}
function playerDobSync(){
  var ds = document.getElementById('player-dob-d');
  var d = Number(ds.value), m = Number(document.getElementById('player-dob-m').value),
      y = Number(document.getElementById('player-dob-y').value);
  if (m && y) {                                  // clamp day list to the month (leap years included)
    var max = new Date(y, m, 0).getDate();
    Array.prototype.forEach.call(ds.options, function(o){
      if (o.value) o.disabled = Number(o.value) > max;
    });
    if (d > max) { ds.value = ''; d = 0; }
  }
  document.getElementById('player-dob').value =
    (d && m && y) ? y + '-' + String(m).padStart(2,'0') + '-' + String(d).padStart(2,'0') : '';
}
function setPlayerDob(iso){
  playerDobInit();
  var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  document.getElementById('player-dob-y').value = p ? String(Number(p[1])) : '';
  document.getElementById('player-dob-m').value = p ? String(Number(p[2])) : '';
  document.getElementById('player-dob-d').value = p ? String(Number(p[3])) : '';
  playerDobSync();
}

async function loadPlayerEditor(id) {
  var rows = await adminAPI('player.get', { id: id });
  if (!rows || !rows.length) return;
  var p = rows[0];

  document.getElementById('player-id').value            = p.id;
  document.getElementById('player-name').value          = p.name || '';
  document.getElementById('player-role').value          = p.role || '';
  document.getElementById('player-batting').value       = p.batting_hand || '';
  document.getElementById('player-bowling').value       = p.bowling_style || '';
  document.getElementById('player-nickname').value      = p.nickname || '';
  document.getElementById('player-years').value         = p.years_at_tcc || '';
  document.getElementById('player-shot').value          = p.favourite_shot || '';
  document.getElementById('player-hero').value          = p.cricket_hero || '';
  document.getElementById('player-fantasy-value').value = p.fantasy_value || 5;
  document.getElementById('player-bio').value           = p.bio || '';
  document.getElementById('player-active').checked      = p.active !== false;
  document.getElementById('player-captain').checked     = !!p.captain;
  document.getElementById('player-vc').checked          = !!p.vice_captain;
  document.getElementById('player-squad').value         = p.squad || 'senior';
  document.getElementById('player-member-type').value   = p.member_type || 'player';
  setPlayerDob(p.dob || '');
  syncFantasyValueField();

  // Minor status is derived from DOB — it is NOT the same thing as squad.
  // A 16-year-old can play SENIOR cricket and is still a minor: guardian
  // details and the media-consent photo gate still apply. Make that explicit.
  var minorNote = document.getElementById('player-minor-note');
  if (minorNote) {
    var pAge = null;
    if (p.dob) {
      var d = new Date(p.dob), n = new Date();
      pAge = n.getFullYear() - d.getFullYear();
      if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) pAge--;
    }
    if (pAge != null && pAge < 18) {
      minorNote.innerHTML = '&#9888; <strong>Under 18 (' + pAge + ')</strong> — still a minor even if in the senior squad. '
        + 'Guardian details apply, and their photo only shows publicly with media consent '
        + '(' + (p.media_consent ? 'consent given' : '<strong>no consent — photo hidden</strong>') + ').';
      minorNote.style.display = 'block';
    } else {
      minorNote.style.display = 'none';
    }
  }

  document.getElementById('player-photo-url').value     = p.photo_url || '';
  setPlayerPhoto(p.photo_url);

  document.getElementById('delete-player-btn').style.display = 'inline-flex';
  document.getElementById('players-editor-empty').style.display   = 'none';
  document.getElementById('players-editor-content').style.display = 'block';
  document.getElementById('player-success').style.display = 'none';
  document.getElementById('player-error').style.display   = 'none';
}

function setPlayerPhoto(url) {
  var img     = document.getElementById('player-photo-img');
  var fallback= document.getElementById('player-photo-fallback');
  var removeBtn = document.getElementById('player-photo-remove-btn');
  if (url) {
    img.src = url; img.style.display = 'block';
    fallback.style.display = 'none';
    removeBtn.style.display = 'inline-flex';
  } else {
    img.src = ''; img.style.display = 'none';
    fallback.style.display = 'flex';
    removeBtn.style.display = 'none';
  }
}

// Photo upload
document.getElementById('player-photo-file').addEventListener('change', async function() {
  var file = this.files[0];
  if (!file) return;
  var errEl = document.getElementById('player-photo-error');
  errEl.style.display = 'none';
  if (file.size > 5 * 1024 * 1024) { errEl.textContent = 'Max 5MB'; errEl.style.display = 'block'; return; }
  try {
    var name     = document.getElementById('player-name').value.trim() || 'player';
    var safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    var fileName = 'player-photos/' + safeName + '-' + Date.now() + '.' + file.name.split('.').pop().toLowerCase();
    var r = await fetch(SUPABASE_URL + '/storage/v1/object/gallery/' + fileName, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': file.type, 'x-upsert': 'true' },
      body: file
    });
    if (!r.ok) throw new Error(await r.text());
    var url = SUPABASE_URL + '/storage/v1/object/public/gallery/' + fileName;
    document.getElementById('player-photo-url').value = url;
    setPlayerPhoto(url);
  } catch(e) { errEl.textContent = 'Upload failed: ' + e.message; errEl.style.display = 'block'; }
  this.value = '';
});

document.getElementById('player-photo-remove-btn').addEventListener('click', function() {
  document.getElementById('player-photo-url').value = '';
  setPlayerPhoto('');
});

// New player
document.getElementById('new-player-btn').addEventListener('click', function() {
  document.getElementById('player-id').value            = '';
  document.getElementById('player-name').value          = '';
  document.getElementById('player-role').value          = '';
  document.getElementById('player-batting').value       = '';
  document.getElementById('player-bowling').value       = '';
  document.getElementById('player-nickname').value      = '';
  document.getElementById('player-years').value         = '';
  document.getElementById('player-shot').value          = '';
  document.getElementById('player-hero').value          = '';
  document.getElementById('player-fantasy-value').value = 5;
  document.getElementById('player-bio').value           = '';
  document.getElementById('player-active').checked      = true;
  document.getElementById('player-captain').checked     = false;
  document.getElementById('player-vc').checked          = false;
  document.getElementById('player-squad').value         = 'senior';
  document.getElementById('player-member-type').value   = 'player';
  setPlayerDob('');
  syncFantasyValueField();
  document.getElementById('player-photo-url').value     = '';
  setPlayerPhoto('');
  document.getElementById('delete-player-btn').style.display = 'none';
  document.getElementById('players-editor-empty').style.display   = 'none';
  document.getElementById('players-editor-content').style.display = 'block';
  document.getElementById('player-success').style.display = 'none';
  document.getElementById('player-error').style.display   = 'none';
  document.querySelectorAll('.player-admin-item').forEach(function(i){ i.classList.remove('active'); });
  document.getElementById('player-name').focus();
});

// Save player
document.getElementById('save-player-btn').addEventListener('click', async function() {
  var id   = document.getElementById('player-id').value;
  var name = document.getElementById('player-name').value.trim();
  var role = document.getElementById('player-role').value;
  var suc  = document.getElementById('player-success');
  var err  = document.getElementById('player-error');
  suc.style.display = 'none'; err.style.display = 'none';
  if (!name) { err.textContent = '❌ Name is required.'; err.style.display = 'block'; return; }
  if (!role) { err.textContent = '❌ Role is required.'; err.style.display = 'block'; return; }

  var data = {
    name:          name,
    role:          role,
    batting_hand:  document.getElementById('player-batting').value || null,
    bowling_style: document.getElementById('player-bowling').value || null,
    nickname:      document.getElementById('player-nickname').value.trim() || null,
    years_at_tcc:  parseInt(document.getElementById('player-years').value) || null,
    favourite_shot:document.getElementById('player-shot').value.trim() || null,
    cricket_hero:  document.getElementById('player-hero').value.trim() || null,
    fantasy_value: parseInt(document.getElementById('player-fantasy-value').value) || 5,
    bio:           document.getElementById('player-bio').value.trim() || null,
    active:        document.getElementById('player-active').checked,
    captain:       document.getElementById('player-captain').checked,
    vice_captain:  document.getElementById('player-vc').checked,
    squad:         document.getElementById('player-squad').value || null,
    member_type:   document.getElementById('player-member-type').value || 'player',
    dob:           document.getElementById('player-dob').value || null,
    photo_url:     document.getElementById('player-photo-url').value || null
  };

  this.disabled = true;
  try {
    if (id) {
      await adminAPI('player.update', { id: id, data: data });
    } else {
      var rows = await adminAPI('player.insert', data);
      if (rows && rows[0]) document.getElementById('player-id').value = rows[0].id;
      document.getElementById('delete-player-btn').style.display = 'inline-flex';
    }
    suc.style.display = 'block';
    loadPlayersAdmin();
  } catch(e) { err.textContent = '❌ ' + e.message; err.style.display = 'block'; }
  finally { this.disabled = false; }
});

// Delete player
document.getElementById('delete-player-btn').addEventListener('click', function() {
  var id   = document.getElementById('player-id').value;
  var name = document.getElementById('player-name').value;
  if (!id) return;
  confirmModal('Delete Player', 'Permanently delete ' + name + '? This cannot be undone. Consider setting them to Inactive instead.', async function() {
    try {
      await adminAPI('player.delete', { id: id });
      document.getElementById('players-editor-empty').style.display   = 'flex';
      document.getElementById('players-editor-content').style.display = 'none';
      loadPlayersAdmin();
    } catch(e) { alert('Delete failed: ' + e.message); }
  });
});


// ═══════════════════════════════════════════════════════
// FIXTURES ADMIN
// ═══════════════════════════════════════════════════════
(function() {

  var fixData      = [];
  var editingFixId = null;

  // ── Sub-tab switching ────────────────────────────────
  document.querySelectorAll('.fix-subtab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.fix-subtab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var sub = btn.dataset.sub;
      document.getElementById('fix-panel-list').style.display = sub === 'list' ? 'block' : 'none';
      document.getElementById('fix-panel-add').style.display  = sub === 'add'  ? 'block' : 'none';
      if (sub === 'add') resetAddForm();
    });
  });

  // ── Load all fixtures ────────────────────────────────
  async function loadFixtures() {
    document.getElementById('fix-loading').style.display = 'block';
    document.getElementById('fix-list').innerHTML = '';
    closeDrawer();
    try {
      var r = await fetch(SUPABASE_URL + '/rest/v1/fixtures?select=*&order=date.asc', { headers: H });
      fixData = await r.json();
      populateFilters();
      renderTable();
    } catch(e) {
      document.getElementById('fix-loading').textContent = 'Failed to load fixtures.';
    }
    document.getElementById('fix-loading').style.display = 'none';
  }

  // ── Populate filter dropdowns ────────────────────────
  function populateFilters() {
    var teams   = [...new Set(fixData.map(function(f){ return f.team; }).filter(Boolean))].sort();
    var seasons = [...new Set(fixData.map(function(f){ return f.season; }).filter(Boolean))].sort().reverse();

    var tSel = document.getElementById('fix-filter-team');
    var curT = tSel.value;
    tSel.innerHTML = '<option value="">All teams</option>' +
      teams.map(function(t){ return '<option value="'+escH(t)+'">'+escH(t)+'</option>'; }).join('');
    if (curT) tSel.value = curT;

    var sSel = document.getElementById('fix-filter-season');
    var curS = sSel.value;
    sSel.innerHTML = '<option value="">All seasons</option>' +
      seasons.map(function(s){ return '<option value="'+escH(s)+'">'+escH(s)+'</option>'; }).join('');
    if (curS) sSel.value = curS;
  }

  // ── Render table ─────────────────────────────────────
  function renderTable() {
    var teamF   = document.getElementById('fix-filter-team').value;
    var seasonF = document.getElementById('fix-filter-season').value;
    var list    = fixData.filter(function(f) {
      if (teamF   && f.team   !== teamF)   return false;
      if (seasonF && f.season !== seasonF) return false;
      return true;
    });

    var el = document.getElementById('fix-list');
    if (!list.length) {
      el.innerHTML = '<div class="fix-empty">No fixtures found. Use <strong>Add Fixture</strong> to create one.</div>';
      return;
    }

    var html = '<div class="fix-table-head">' +
      '<div>Date</div><div>Team</div><div>Opponent</div>' +
      '<div>Venue</div><div>Division</div><div>Result</div><div></div>' +
    '</div>';

    html += list.map(function(f) {
      var today = new Date().toISOString().slice(0,10);
      var past  = f.date < today;
      var r     = (f.result || '').toLowerCase();
      var badgeClass = !f.result && !past ? 'fix-result-upcoming'
                     : r === 'won'        ? 'fix-result-won'
                     : r === 'lost'       ? 'fix-result-lost'
                     : r === 'draw'       ? 'fix-result-draw'
                     : f.result           ? 'fix-result-other'
                     :                     'fix-result-other';
      var badgeText = f.result || (!past ? 'Upcoming' : 'Played');
      var isActive  = editingFixId && String(f.id) === String(editingFixId) ? ' active' : '';

      return '<div class="fix-table-row'+isActive+'" data-id="'+f.id+'">' +
        '<div class="fix-col fix-col-date">'+fmtD(f.date)+'</div>' +
        '<div class="fix-col fix-col-team">'+escH(f.team||'')+'</div>' +
        '<div class="fix-col fix-col-opponent">'+escH(f.opponent||'TBC')+'</div>' +
        '<div class="fix-col fix-col-venue">'+escH(f.venue||'—')+'</div>' +
        '<div class="fix-col fix-col-div">'+escH(f.division||'—')+'</div>' +
        '<div class="fix-col"><span class="fix-result-badge '+badgeClass+'">'+escH(badgeText)+'</span></div>' +
        '<div class="fix-col fix-col-edit">✎</div>' +
      '</div>';
    }).join('');

    el.innerHTML = html;

    el.querySelectorAll('.fix-table-row').forEach(function(row) {
      row.addEventListener('click', function() { openDrawer(this.dataset.id); });
    });
  }

  // ── Open edit drawer ─────────────────────────────────
  function openDrawer(id) {
    var f = fixData.find(function(x){ return String(x.id) === String(id); });
    if (!f) return;
    editingFixId = f.id;

    document.getElementById('fix-editor-title').textContent = 'Edit — ' + (f.opponent || 'Fixture');
    document.getElementById('fix-date').value     = f.date     || '';
    document.getElementById('fix-team').value     = f.team     || '';
    document.getElementById('fix-opponent').value = f.opponent || '';
    document.getElementById('fix-venue').value    = f.venue    || '';
    document.getElementById('fix-division').value = f.division || '';
    document.getElementById('fix-season').value   = f.season   || '';
    document.getElementById('fix-result').value   = f.result   || '';
    document.getElementById('fix-delete-btn').style.display = 'inline-flex';

    var statusEl = document.getElementById('fix-status');
    statusEl.style.display = 'none';
    statusEl.textContent = '';

    document.getElementById('fix-edit-drawer').style.display = 'block';
    document.getElementById('fix-edit-drawer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renderTable(); // re-render to show active row
  }

  function closeDrawer() {
    editingFixId = null;
    document.getElementById('fix-edit-drawer').style.display = 'none';
  }

  function setStatus(msg, isErr) {
    var el = document.getElementById('fix-status');
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
    el.className = isErr ? 'upload-error' : 'upload-success';
  }

  // ── Save (edit) ──────────────────────────────────────
  document.getElementById('fix-save-btn').addEventListener('click', async function() {
    var date     = document.getElementById('fix-date').value.trim();
    var team     = document.getElementById('fix-team').value.trim();
    var opponent = document.getElementById('fix-opponent').value.trim();
    var venue    = document.getElementById('fix-venue').value.trim();
    var division = document.getElementById('fix-division').value.trim();
    var season   = document.getElementById('fix-season').value.trim();
    var result   = document.getElementById('fix-result').value.trim();

    if (!date || !team || !opponent || !season) {
      setStatus('Date, team, opponent and season are required.', true); return;
    }
    setStatus('Saving…', false);
    this.disabled = true;
    try {
      await adminAPI('fixtures.update', {
        id: editingFixId,
        data: { date, team, opponent, venue: venue||null, division: division||null, season, result: result||null }
      });
      await loadFixtures();
      closeDrawer();
    } catch(e) { setStatus('Save failed: ' + e.message, true); }
    this.disabled = false;
  });

  // ── Delete ────────────────────────────────────────────
  document.getElementById('fix-delete-btn').addEventListener('click', function() {
    if (!editingFixId) return;
    var f = fixData.find(function(x){ return String(x.id) === String(editingFixId); });
    var label = f ? (escH(f.team) + ' vs ' + escH(f.opponent) + ' (' + fmtD(f.date) + ')') : 'this fixture';
    confirmModal('Delete Fixture', 'Delete ' + label + '? This cannot be undone.', async function() {
      try {
        await adminAPI('fixtures.delete', { id: editingFixId });
        await loadFixtures();
      } catch(e) { alert('Delete failed: ' + e.message); }
    });
  });

  // ── Cancel / close drawer ────────────────────────────
  document.getElementById('fix-cancel-btn').addEventListener('click', function() {
    closeDrawer();
    renderTable();
  });

  // ── Filters ───────────────────────────────────────────
  document.getElementById('fix-filter-team').addEventListener('change', renderTable);
  document.getElementById('fix-filter-season').addEventListener('change', renderTable);

  // ── Add New form ──────────────────────────────────────
  function currentSeason() {
    var y = new Date().getFullYear(), m = new Date().getMonth() + 1;
    var start = m >= 7 ? y : y - 1;
    return start + '-' + String(start + 1).slice(2);
  }

  function resetAddForm() {
    document.getElementById('fix-new-date').value     = '';
    document.getElementById('fix-new-team').value     = '';
    document.getElementById('fix-new-opponent').value = '';
    document.getElementById('fix-new-venue').value    = '';
    document.getElementById('fix-new-division').value = '';
    document.getElementById('fix-new-season').value   = currentSeason();
    document.getElementById('fix-new-result').value   = '';
    document.getElementById('fix-new-status').style.display  = 'none';
    document.getElementById('fix-new-success').style.display = 'none';
  }

  document.getElementById('fix-new-save-btn').addEventListener('click', async function() {
    var date     = document.getElementById('fix-new-date').value.trim();
    var team     = document.getElementById('fix-new-team').value.trim();
    var opponent = document.getElementById('fix-new-opponent').value.trim();
    var venue    = document.getElementById('fix-new-venue').value.trim();
    var division = document.getElementById('fix-new-division').value.trim();
    var season   = document.getElementById('fix-new-season').value.trim();
    var result   = document.getElementById('fix-new-result').value.trim();

    var errEl = document.getElementById('fix-new-status');
    var sucEl = document.getElementById('fix-new-success');
    errEl.style.display = 'none';
    sucEl.style.display = 'none';

    if (!date || !team || !opponent || !season) {
      errEl.textContent = 'Date, team, opponent and season are required.';
      errEl.style.display = 'block'; return;
    }

    this.disabled = true;
    this.textContent = 'Saving…';
    try {
      await adminAPI('fixtures.insert', {
        data: { date, team, opponent, venue: venue||null, division: division||null, season, result: result||null }
      });
      sucEl.style.display = 'block';
      resetAddForm();
      await loadFixtures(); // refresh the list in background
    } catch(e) {
      errEl.textContent = 'Failed: ' + e.message;
      errEl.style.display = 'block';
    }
    this.disabled = false;
    this.textContent = 'Add Fixture →';
  });

  // ── Helpers ───────────────────────────────────────────
  function escH(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function fmtD(d) {
    if (!d) return '—';
    var p = d.split('-'), m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return parseInt(p[2]) + ' ' + m[parseInt(p[1])-1] + ' ' + p[0];
  }


  // ── CSV Template download ─────────────────────────────
  document.getElementById('fix-csv-template-btn').addEventListener('click', function(e) {
    e.preventDefault();
    var rows = [
      'date,team,opponent,venue,division,season,result',
      '2025-10-11,1st Team,Bellville CC,Florida Park (Home),Div A,2025-26,',
      '2025-10-18,2nd Team,Pinelands CC,Pinelands (Away),Div A,2025-26,Won',
      '2025-10-25,U13,Durbanville CC,Florida Park (Home),,2025-26,'
    ];
    var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tcc_fixtures_template.csv';
    a.click();
  });

  // ── CSV drop zone ─────────────────────────────────────
  var csvDrop = document.getElementById('fix-csv-drop');
  var csvInput = document.getElementById('fix-csv-input');
  var csvRows = [];

  csvDrop.addEventListener('click', function() { csvInput.click(); });
  csvDrop.addEventListener('dragover', function(e) { e.preventDefault(); csvDrop.classList.add('drag-over'); });
  csvDrop.addEventListener('dragleave', function() { csvDrop.classList.remove('drag-over'); });
  csvDrop.addEventListener('drop', function(e) {
    e.preventDefault(); csvDrop.classList.remove('drag-over');
    var file = e.dataTransfer.files[0];
    if (file) parseCSV(file);
  });
  csvInput.addEventListener('change', function() {
    if (this.files[0]) parseCSV(this.files[0]);
  });

  function parseCSV(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var lines = e.target.result.replace(/\r/g,'').split('\n').filter(function(l){ return l.trim(); });
      if (!lines.length) return;

      // Parse header
      var headers = lines[0].split(',').map(function(h){ return h.trim().toLowerCase(); });
      var required = ['date','team','opponent'];
      var missing = required.filter(function(r){ return headers.indexOf(r) === -1; });
      if (missing.length) {
        showCsvError('Missing required columns: ' + missing.join(', '));
        return;
      }

      var idxDate     = headers.indexOf('date');
      var idxTeam     = headers.indexOf('team');
      var idxOpponent = headers.indexOf('opponent');
      var idxVenue    = headers.indexOf('venue');
      var idxDivision = headers.indexOf('division');
      var idxSeason   = headers.indexOf('season');
      var idxResult   = headers.indexOf('result');

      var parsed = [];
      var errors = [];
      for (var i = 1; i < lines.length; i++) {
        var cols = parseCSVLine(lines[i]);
        var date     = (cols[idxDate]     || '').trim();
        var team     = (cols[idxTeam]     || '').trim();
        var opponent = (cols[idxOpponent] || '').trim();
        if (!date || !team || !opponent) {
          errors.push('Row ' + (i+1) + ': missing date, team or opponent');
          continue;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          errors.push('Row ' + (i+1) + ': date must be YYYY-MM-DD (got "' + date + '")');
          continue;
        }
        parsed.push({
          date:     date,
          team:     team,
          opponent: opponent,
          venue:    idxVenue    >= 0 ? (cols[idxVenue]    || '').trim() || null : null,
          division: idxDivision >= 0 ? (cols[idxDivision] || '').trim() || null : null,
          season:   idxSeason   >= 0 ? (cols[idxSeason]   || '').trim() || null : null,
          result:   idxResult   >= 0 ? (cols[idxResult]   || '').trim() || null : null,
        });
      }

      csvRows = parsed;
      renderCSVPreview(parsed, errors);
    };
    reader.readAsText(file);
  }

  function parseCSVLine(line) {
    // Handles quoted fields
    var result = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
      else { cur += ch; }
    }
    result.push(cur);
    return result;
  }

  function renderCSVPreview(rows, errors) {
    document.getElementById('fix-csv-preview').style.display = 'block';
    document.getElementById('fix-csv-success').style.display = 'none';
    document.getElementById('fix-csv-count').textContent = rows.length + ' fixture' + (rows.length !== 1 ? 's' : '') + ' ready';

    if (errors.length) {
      var errEl = document.getElementById('fix-csv-errors');
      errEl.textContent = errors.join('\n');
      errEl.style.display = 'block';
    }

    var cols = ['Date','Team','Opponent','Venue','Division','Season','Result'];
    var keys = ['date','team','opponent','venue','division','season','result'];
    var html = '<thead><tr>' + cols.map(function(c) {
      return '<th style="padding:7px 10px;text-align:left;font-size:0.62rem;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);border-bottom:1px solid rgba(201,168,76,0.2);white-space:nowrap">' + c + '</th>';
    }).join('') + '</tr></thead><tbody>';

    rows.forEach(function(r) {
      html += '<tr>' + keys.map(function(k) {
        return '<td style="padding:7px 10px;font-size:0.78rem;color:var(--white);border-bottom:1px solid rgba(255,255,255,0.04);white-space:nowrap">' + escH(r[k] || '—') + '</td>';
      }).join('') + '</tr>';
    });
    html += '</tbody>';
    document.getElementById('fix-csv-table').innerHTML = html;
  }

  function showCsvError(msg) {
    document.getElementById('fix-csv-preview').style.display = 'none';
    alert('CSV error: ' + msg);
  }

  document.getElementById('fix-csv-clear-btn').addEventListener('click', function() {
    csvRows = [];
    csvInput.value = '';
    document.getElementById('fix-csv-preview').style.display = 'none';
    document.getElementById('fix-csv-errors').style.display = 'none';
    document.getElementById('fix-csv-success').style.display = 'none';
  });

  document.getElementById('fix-csv-import-btn').addEventListener('click', async function() {
    if (!csvRows.length) return;
    this.disabled = true;
    this.textContent = 'Importing…';

    // Single batch request instead of one per row
    var sucEl = document.getElementById('fix-csv-success');
    try {
      await adminAPI('fixtures.insert', { data: csvRows });
      sucEl.textContent = '✅ ' + csvRows.length + ' fixture' + (csvRows.length !== 1 ? 's' : '') + ' imported successfully.';
    } catch(e) {
      // Fall back to sequential if worker/DB doesn't support array insert
      var failed = 0;
      for (var i = 0; i < csvRows.length; i++) {
        try { await adminAPI('fixtures.insert', { data: csvRows[i] }); }
        catch(e2) { failed++; }
      }
      var imported = csvRows.length - failed;
      sucEl.textContent = '✅ ' + imported + ' fixture' + (imported !== 1 ? 's' : '') + ' imported.' +
        (failed ? ' ' + failed + ' failed.' : '');
    }
    sucEl.style.display = 'block';

    csvRows = [];
    csvInput.value = '';
    document.getElementById('fix-csv-preview').style.display = 'none';
    document.getElementById('fix-csv-errors').style.display = 'none';
    await loadFixtures();

    this.disabled = false;
    this.textContent = 'Import All →';
  });

  window.loadFixtures = loadFixtures;

})();

/* ══════════════════════════════════════════════════════
   LIVE FANTASY — PLAYER NAME MAP ADMIN
══════════════════════════════════════════════════════ */
async function loadNameMap() {
  var listEl    = document.getElementById('name-map-list');
  var loadingEl = document.getElementById('name-map-loading');
  if (!listEl) return;

  loadingEl.style.display = 'block';
  listEl.style.display    = 'none';

  try {
    var [mapRows, players] = await Promise.all([
      fetch(SUPABASE_URL+'/rest/v1/fantasy_player_name_map?select=id,scorer_name,player_id,players(name)&order=scorer_name.asc', {headers:H}).then(function(r){return r.json();}),
      fetch(SUPABASE_URL+'/rest/v1/players?select=id,name&active=not.eq.false&order=name.asc', {headers:H}).then(function(r){return r.json();}),
    ]);

    // Populate player select
    var sel = document.getElementById('nm-player-select');
    if (sel) {
      sel.innerHTML = '<option value="">— Select player —</option>'
        + (players||[]).map(function(p){
            return '<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>';
          }).join('');
    }

    if (!mapRows || !mapRows.length) {
      listEl.innerHTML = '<div style="font-size:0.8rem;color:var(--muted);padding:8px 0">No mappings yet. Add one below.</div>';
    } else {
      listEl.innerHTML = '<table class="lb-table" style="font-size:0.78rem">'
        + '<thead><tr><th>Scorer Name</th><th>Fantasy Player</th><th style="width:60px"></th></tr></thead>'
        + '<tbody>'
        + (mapRows||[]).map(function(m) {
            var pName = m.players ? m.players.name : '<em style="color:var(--red)">Unlinked</em>';
            return '<tr>'
              + '<td>'+m.scorer_name+'</td>'
              + '<td>'+pName+'</td>'
              + '<td><button class="btn-sm" onclick="deleteNameMap(\''+m.id+'\')" style="color:var(--red);border-color:var(--red)">✕</button></td>'
              + '</tr>';
          }).join('')
        + '</tbody></table>';
    }

    loadingEl.style.display = 'none';
    listEl.style.display    = 'block';
  } catch(e) {
    loadingEl.textContent = 'Error: ' + e.message;
  }
}

async function saveNameMap() {
  var scorerName = (document.getElementById('nm-scorer-name').value || '').trim();
  var playerId   = document.getElementById('nm-player-select').value;
  var errEl      = document.getElementById('nm-error');

  if (!scorerName || !playerId) {
    errEl.textContent = 'Both scorer name and player are required.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  try {
    var res = await fetch(SUPABASE_URL+'/rest/v1/fantasy_player_name_map', {
      method: 'POST',
      headers: Object.assign({}, H, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ scorer_name: scorerName, player_id: playerId })
    });
    if (!res.ok) throw new Error(await res.text());
    document.getElementById('nm-scorer-name').value = '';
    document.getElementById('nm-player-select').value = '';
    loadNameMap();
  } catch(e) {
    errEl.textContent = 'Save failed: ' + e.message;
    errEl.style.display = 'block';
  }
}

async function deleteNameMap(id) {
  if (!confirm('Remove this name mapping?')) return;
  try {
    await fetch(SUPABASE_URL+'/rest/v1/fantasy_player_name_map?id=eq.'+id, {
      method: 'DELETE', headers: H
    });
    loadNameMap();
  } catch(e) { alert('Delete failed: ' + e.message); }
}

// Auto-load name map when the fantasy section is visible
(function() {
  var section = document.getElementById('name-map-section');
  if (section) loadNameMap();
})();


/* ══════════════════════════════════════════════════════
   AUTO-SCORE PIPELINE
══════════════════════════════════════════════════════ */
async function previewAutoScore(roundId, roundName) {
  var modal = document.getElementById('auto-score-modal');
  var body  = document.getElementById('auto-score-body');
  var title = document.getElementById('auto-score-title');
  if (!modal) return;

  title.textContent = 'Auto-score — ' + roundName;
  body.innerHTML = '<div class="album-list-loading">Fetching match data…</div>';
  modal.style.display = 'flex';

  try {
    var result = await adminAPI('fantasy.autoScoreRound', { round_id: roundId, dry_run: true });

    if (!result.matched_players) {
      body.innerHTML = '<div class="modal-error" style="display:block">No matched players found. Make sure matches are completed and player names are linked via the Name Map.</div>';
      return;
    }

    var unmatchedHtml = result.unmatched_names && result.unmatched_names.length
      ? '<div class="auto-score-unmatched"><strong>⚠ Unmatched names (' + result.unmatched_names.length + '):</strong> '
        + result.unmatched_names.join(', ')
        + '<br><small>These players will not be scored. Add them to the Name Map to include them.</small></div>'
      : '<div class="auto-score-ok">✓ All player names matched</div>';

    var tableRows = (result.preview || [])
      .sort(function(a,b){ return (b.runs||0)+(b.wickets||0)*15 - (a.runs||0)-(a.wickets||0)*15; })
      .map(function(s) {
        return '<tr>'
          + '<td>' + (s.player_id||'?').substring(0,8) + '…</td>'
          + '<td style="text-align:center">' + (s.runs||0) + '</td>'
          + '<td style="text-align:center">' + (s.wickets||0) + '</td>'
          + '<td style="text-align:center">' + (s.catches||0) + '</td>'
          + '<td style="text-align:center">' + (s.stumpings||0) + '</td>'
          + '<td style="text-align:center">' + (s.maidens||0) + '</td>'
          + '<td style="text-align:center">' + (s.runouts||0) + '</td>'
          + '<td style="text-align:center">' + (s.economy != null ? s.economy : '—') + '</td>'
          + '</tr>';
      }).join('');

    body.innerHTML = unmatchedHtml
      + '<p style="font-size:0.8rem;color:var(--muted);margin:10px 0 6px">Preview — <strong>' + result.matched_players + ' players</strong> will be scored. Existing auto-scored rows for this round will be replaced.</p>'
      + '<div style="overflow-x:auto"><table class="lb-table" style="font-size:0.75rem">'
      + '<thead><tr><th>Player ID</th><th>Runs</th><th>Wkts</th><th>Ctch</th><th>Stmp</th><th>Mdns</th><th>R/O</th><th>Econ</th></tr></thead>'
      + '<tbody>' + tableRows + '</tbody></table></div>';

    document.getElementById('auto-score-confirm-btn').onclick = function() {
      commitAutoScore(roundId, roundName);
    };
    document.getElementById('auto-score-confirm-btn').style.display = 'inline-flex';

  } catch(e) {
    body.innerHTML = '<div class="modal-error" style="display:block">Error: ' + e.message + '</div>';
    document.getElementById('auto-score-confirm-btn').style.display = 'none';
  }
}

async function commitAutoScore(roundId, roundName) {
  var body    = document.getElementById('auto-score-body');
  var confirmBtn = document.getElementById('auto-score-confirm-btn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Saving…';

  try {
    var result = await adminAPI('fantasy.autoScoreRound', { round_id: roundId, dry_run: false });
    body.innerHTML = '<div class="auto-score-ok" style="font-size:0.9rem">✓ <strong>' + result.saved + ' players scored</strong> for "' + roundName + '".'
      + (result.unmatched_names && result.unmatched_names.length
          ? '<br><br>⚠ Still unmatched: ' + result.unmatched_names.join(', ')
          : '')
      + '</div>';
    confirmBtn.style.display = 'none';
    loadRoundsAdmin();
  } catch(e) {
    body.innerHTML = '<div class="modal-error" style="display:block">Error: ' + e.message + '</div>';
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm & Save';
  }
}

/* ══════════════════════════════════════════════════════
   ADMIN USERS TAB
   Super-only. List, create, edit role, deactivate.
══════════════════════════════════════════════════════ */
var adminUsersList = [];

async function loadAdminUsers() {
  var el = document.getElementById('admin-users-list');
  if (!el) return;
  el.innerHTML = '<div class="album-list-loading">Loading…</div>';
  try {
    adminUsersList = await adminAPI('admin.listUsers', {});
    renderAdminUsers();
  } catch(e) {
    el.innerHTML = '<div style="color:#e07070">Failed to load users: ' + e.message + '</div>';
  }
}

var ROLE_LABELS = {
  super:     'Super',
  scores:    'Scores',
  content:   'Content',
  fixtures:  'Fixtures',
  registrar: 'Registrar',
  coach:	 'Coach',
  finance:   'Finance',
  chair:     'Chair',
  captain:   'Club Captain',
  pafco:     'PAFCO'
};

/* What each one is for, in the order they are offered when creating a user.
   The "add a user" dropdown is built from this rather than written out in
   the HTML as well — a role listed in one place and not the other is how
   PAFCO ended up impossible to assign. */
var ROLE_HINTS = {
  content:   'Content — gallery, news, bios',
  scores:    'Scores — rounds, scoring, fixtures, players',
  fixtures:  'Fixtures — fixture CRUD only',
  registrar: 'Registrar — approvals & bios',
  coach:     'Coach — coaching analytics only',
  pafco:     'PAFCO — playing affairs: players, fixtures, coaching, discipline',
  captain:   'Club Captain — approves hours, raises warnings',
  finance:   'Finance — shop orders and the payment run',
  chair:     'Chair — oversight, confidentiality, warnings',
  super:     'Super — full access'
};

function fillRoleSelect() {
  var sel = document.getElementById('new-user-role');
  if (!sel) return;
  sel.innerHTML = Object.keys(ROLE_HINTS).map(function (r) {
    return '<option value="' + r + '">' + ROLE_HINTS[r] + '</option>';
  }).join('');
}
fillRoleSelect();

function renderAdminUsers() {
  fillRoleSelect();
  var el = document.getElementById('admin-users-list');
  if (!el || !adminUsersList.length) { if (el) el.innerHTML = '<p style="color:var(--muted);font-size:0.85rem">No users found.</p>'; return; }
  el.innerHTML = '<div class="au-table">'
    + '<div class="au-row au-head"><span>Name</span><span>Username</span><span>Role</span><span>Last login</span><span>Status</span><span></span></div>'
    + adminUsersList.map(function(u) {
        var lastLogin = u.last_login
          ? new Date(u.last_login).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' })
          : 'Never';
        var isMe = u.name === SESSION_NAME && u.role === SESSION_ROLE;
        return '<div class="au-row" data-id="' + u.id + '">'
          + '<span class="au-name">' + u.name + (isMe ? ' <span class="au-you">you</span>' : '') + '</span>'
          + '<span class="au-username">@' + u.username + '</span>'
          + '<span><select class="au-role-select form-control" data-id="' + u.id + '" ' + (isMe ? 'disabled' : '') + '>'
          + Object.keys(ROLE_LABELS).map(function(r) {
              return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>';
            }).join('')
          + '</select></span>'
          + '<span class="au-last">' + lastLogin + '</span>'
          + '<span class="au-status ' + (u.active ? 'active' : 'inactive') + '">' + (u.active ? 'Active' : 'Inactive') + '</span>'
          + '<span class="au-actions">'
          + (u.active && !isMe
              ? '<button class="btn-sm au-deactivate-btn" data-id="' + u.id + '">Deactivate</button>'
              : '')
          + (!u.active
              ? '<button class="btn-sm au-activate-btn" data-id="' + u.id + '">Reactivate</button>'
              : '')
          + '<button class="btn-sm au-reset-btn" data-id="' + u.id + '">Reset PW</button>'
          + '</span>'
          + '</div>'
          + '<div class="au-reset-row" id="au-reset-' + u.id + '">'
          + '<div>'
          + '<input type="text" class="form-control au-new-pw" placeholder="New password" style="flex:1;font-family:monospace;font-size:0.82rem" autocomplete="off">'
          + '<button class="btn-sm au-gen-pw-btn" data-id="' + u.id + '">Generate</button>'
          + '<button class="btn-sm btn-primary au-save-pw-btn" data-id="' + u.id + '">Save</button>'
          + '<button class="btn-sm au-cancel-pw-btn" data-id="' + u.id + '">Cancel</button>'
          + '</div>'
          + '</div>';
      }).join('')
    + '</div>'
    + '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">'
    + '<button class="btn btn-primary" id="save-roles-btn">Save role changes</button>'
    + '</div>'
    + '<div class="upload-success" id="roles-success" style="display:none;margin-top:8px">Roles updated.</div>'
    + '<div class="upload-error"   id="roles-error"   style="display:none;margin-top:8px"></div>';

  // Deactivate
  el.querySelectorAll('.au-deactivate-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!confirm('Deactivate this user? They will be unable to log in.')) return;
      try {
        await adminAPI('admin.deactivateUser', { id: btn.dataset.id });
        loadAdminUsers();
      } catch(e) { alert('Error: ' + e.message); }
    });
  });

  // Reset password — toggle inline row
  el.querySelectorAll('.au-reset-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var row = document.getElementById('au-reset-' + btn.dataset.id);
      if (!row) return;
      var isOpen = row.classList.contains('open');
      // Close any other open reset rows first
      el.querySelectorAll('.au-reset-row').forEach(function(r) { r.classList.remove('open'); });
      if (!isOpen) { row.classList.add('open'); row.querySelector('.au-new-pw').focus(); }
    });
  });

  el.querySelectorAll('.au-gen-pw-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%';
      var pwd = Array.from(crypto.getRandomValues(new Uint8Array(12)))
        .map(function(b) { return chars[b % chars.length]; }).join('');
      var row = document.getElementById('au-reset-' + btn.dataset.id);
      if (row) row.querySelector('.au-new-pw').value = pwd;
    });
  });

  el.querySelectorAll('.au-cancel-pw-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var row = document.getElementById('au-reset-' + btn.dataset.id);
      if (row) { row.classList.remove('open'); row.querySelector('.au-new-pw').value = ''; }
    });
  });

  el.querySelectorAll('.au-save-pw-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var row = document.getElementById('au-reset-' + btn.dataset.id);
      var pwd = row ? row.querySelector('.au-new-pw').value.trim() : '';
      if (!pwd) { alert('Enter or generate a password first.'); return; }
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await adminAPI('admin.updateUser', { id: btn.dataset.id, password: pwd });
        row.classList.remove('open');
        row.querySelector('.au-new-pw').value = '';
        var suc = document.getElementById('roles-success');
        if (suc) { suc.textContent = '✅ Password reset.'; suc.style.display = 'block'; setTimeout(function(){ suc.style.display='none'; suc.textContent='✅ Roles updated.'; }, 3000); }
      } catch(e) {
        alert('Error: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });
  });

  // Reactivate
  el.querySelectorAll('.au-activate-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      try {
        await adminAPI('admin.updateUser', { id: btn.dataset.id, active: true });
        loadAdminUsers();
      } catch(e) { alert('Error: ' + e.message); }
    });
  });

  // Save role changes
  document.getElementById('save-roles-btn').addEventListener('click', async function() {
    var suc = document.getElementById('roles-success');
    var err = document.getElementById('roles-error');
    suc.style.display = 'none'; err.style.display = 'none';
    this.disabled = true;
    try {
      var selects = el.querySelectorAll('.au-role-select:not([disabled])');
      var promises = Array.from(selects).map(function(sel) {
        var user = adminUsersList.find(function(u) { return u.id === sel.dataset.id; });
        if (!user || user.role === sel.value) return Promise.resolve();
        return adminAPI('admin.updateUser', { id: sel.dataset.id, role: sel.value });
      });
      await Promise.all(promises);
      suc.style.display = 'block';
      loadAdminUsers();
    } catch(e) { err.textContent = '❌ ' + e.message; err.style.display = 'block'; }
    finally { this.disabled = false; }
  });
}

// Create user
document.getElementById('create-user-btn').addEventListener('click', async function() {
  var name     = (document.getElementById('new-user-name').value     || '').trim();
  var username = (document.getElementById('new-user-username').value  || '').trim().toLowerCase();
  var pwd      = document.getElementById('new-user-password').value;
  var role     = document.getElementById('new-user-role').value;
  var suc = document.getElementById('create-user-success');
  var err = document.getElementById('create-user-error');
  suc.style.display = 'none'; err.style.display = 'none';
  if (!name || !username || !pwd || !role) {
    err.textContent = '❌ All fields required.'; err.style.display = 'block'; return;
  }
  this.disabled = true;
  try {
    await adminAPI('admin.createUser', { name: name, username: username, password: pwd, role: role });
    suc.style.display = 'block';
    document.getElementById('new-user-name').value     = '';
    document.getElementById('new-user-username').value = '';
    document.getElementById('new-user-password').value = '';
    loadAdminUsers();
  } catch(e) { err.textContent = '❌ ' + e.message; err.style.display = 'block'; }
  finally { this.disabled = false; }
});

/* ── Generate password button ── */
document.getElementById('gen-password-btn').addEventListener('click', function() {
  var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%';
  var pwd = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(function(b) { return chars[b % chars.length]; }).join('');
  document.getElementById('new-user-password').value = pwd;
});

/* ══════════════════════════════════════════════════════
   PLAYER REGISTRATIONS TAB  (super + scores)
   Queue from the public registration form → review → CSV export.
══════════════════════════════════════════════════════ */
var pregRows = [];   // rows for the current filter — feeds the CSV export

function pregEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function pregAge(dobStr) {
  var dob = new Date(dobStr), now = new Date();
  var a = now.getFullYear() - dob.getFullYear();
  if (now.getMonth() < dob.getMonth() ||
     (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) a--;
  return a;
}

// Squad split: 17 and under = youth, 18+ = senior. Age computed as of today.
// (If the club later wants age as of a fixed season date, anchor `now` in
//  pregAge to e.g. 1 September instead of new Date().)
function pregSquad(dobStr) {
  return pregAge(dobStr) <= 17 ? 'youth' : 'senior';
}

function pregCardHtml(r){
  var date  = new Date(r.created_at).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'});
  var age   = pregAge(r.dob);
  var squad = pregSquad(r.dob);
  var name  = pregEsc(r.first_name + ' ' + r.surname) + (r.nickname ? ' <span class="mx-review-nick">\u201C' + pregEsc(r.nickname) + '\u201D</span>' : '');
  var tags  = (r.is_minor
        ? '<span class="mx-tag mx-tag-warn">Minor \u00B7 ' + age + '</span>'
        : '<span class="mx-tag mx-tag-neutral">' + age + ' yrs</span>')
    + (squad === 'youth'
        ? '<span class="mx-tag mx-tag-info">Youth</span>'
        : '<span class="mx-tag mx-tag-neutral">Senior</span>');
  var cricket = pregEsc(r.role) + ' \u00B7 ' + pregEsc(r.batting) + (r.bowling ? ' \u00B7 ' + pregEsc(r.bowling) : '');

  var rows = '<div>' + pregEsc(r.email) + ' \u00B7 ' + pregEsc(r.phone) + (r.suburb ? ' \u00B7 ' + pregEsc(r.suburb) : '') + '</div>'
    + '<div><span class="lbl">Emergency:</span> ' + pregEsc(r.emergency_name) + ' \u00B7 ' + pregEsc(r.emergency_phone) + '</div>'
    + (r.is_minor ? '<div><span class="lbl">Guardian:</span> ' + pregEsc(r.guardian_name) + ' (' + pregEsc(r.guardian_relationship) + ') \u00B7 ' + pregEsc(r.guardian_phone) + '</div>' : '')
    + (r.previous_club ? '<div class="mx-warn-line">\u26A0 Previous club: ' + pregEsc(r.previous_club) + ' \u2014 WPCA transfer rules apply (7-day wait)</div>' : '')
    + '<div class="lbl" style="font-size:0.76rem">POPIA \u2713 \u00B7 Indemnity \u2713 (v' + pregEsc(r.disclaimer_version || '\u2014') + ') \u00B7 Media ' + (r.media_consent ? '\u2713' : '\u2717') + '</div>';

  var medical = r.medical_info
    ? '<details class="mx-details"><summary>Medical info provided (POPIA special personal information)</summary><div class="mx-details-body">' + pregEsc(r.medical_info) + '</div></details>'
    : '';

  var promoteBtn = r.player_id
    ? '<span class="mx-linked">\u2713 Profile linked</span>'
    : '<button class="mx-btn mx-btn-sm mx-btn-ghost" data-preg-promote="' + r.id + '">Create / link profile</button>';

  var footer;
  if (r.status === 'pending') {
    footer = '<div class="mx-review-foot">'
      + '<button class="mx-btn mx-btn-sm mx-btn-primary" data-preg-approve="' + r.id + '">Approve</button>'
      + '<button class="mx-btn mx-btn-sm mx-btn-danger" data-preg-reject="' + r.id + '">Reject</button>'
      + promoteBtn + '</div>';
  } else {
    footer = '<div class="mx-review-meta">'
      + (r.status === 'approved' ? '\u2713 Approved' : '\u2717 Rejected') + ' by ' + pregEsc(r.reviewed_by || '\u2014')
      + ' \u00B7 ' + (r.reviewed_at ? new Date(r.reviewed_at).toLocaleString('en-ZA') : '\u2014')
      + (r.review_note ? '<br>Note: ' + pregEsc(r.review_note) : '')
      + '</div>'
      + (r.status === 'approved' ? '<div class="mx-review-foot">' + promoteBtn + '</div>' : '');
  }

  return '<div class="mx-review-card">'
    + '<div class="mx-review-top"><div>'
    +   '<div class="mx-review-name">' + name + ' ' + tags + '</div>'
    +   '<div class="mx-review-sub">' + cricket + '</div>'
    + '</div><div class="mx-review-date">' + date + '</div></div>'
    + '<div class="mx-review-rows">' + rows + '</div>'
    + medical + footer
    + '</div>';
}

function pregRenderMetrics(rows, status){
  var el = document.getElementById('preg-metrics');
  if(!el) return;
  var youth=0, senior=0;
  rows.forEach(function(r){ if(pregSquad(r.dob)==='youth') youth++; else senior++; });
  var statusLabel = status==='approved' ? 'Approved' : status==='rejected' ? 'Rejected' : 'Pending';
  el.innerHTML =
    confMetricCard(statusLabel, String(rows.length)) +
    confMetricCard('Youth', String(youth)) +
    confMetricCard('Senior', String(senior));
}

async function loadPlayerRegs() {
  var listEl = document.getElementById('preg-list');
  var badge  = document.getElementById('preg-pending-badge');
  if (!listEl) return;
  var status = (document.getElementById('preg-status-filter') || {}).value || 'pending';
  listEl.innerHTML = '<div class="album-list-loading">Loading…</div>';

  try {
    var rows = await adminAPI('registration.list', { status: status });
    pregRows = Array.isArray(rows) ? rows : [];

    // Squad filter (client-side, from DOB). Export still splits regardless.
    var squadFilter = (document.getElementById('preg-squad-filter') || {}).value || 'all';
    var shownRows = squadFilter === 'all'
      ? pregRows
      : pregRows.filter(function(r){ return pregSquad(r.dob) === squadFilter; });

    pregRenderMetrics(pregRows, status);

    if (!shownRows.length) {
      listEl.innerHTML = '<div class="mx-empty">No ' + pregEsc(status) + ' registrations' + (squadFilter !== 'all' ? ' in the ' + squadFilter + ' squad' : '') + '.</div>';
      return;
    }

    listEl.innerHTML = '<div class="mx-review-list">' + shownRows.map(pregCardHtml).join('') + '</div>';

    // Wire review buttons
    listEl.querySelectorAll('[data-preg-promote]').forEach(function(btn) {
      btn.addEventListener('click', function() { openPromoteModal(btn.dataset.pregPromote); });
    });
    listEl.querySelectorAll('[data-preg-approve]').forEach(function(btn) {
      btn.addEventListener('click', function() { reviewPlayerReg(btn.dataset.pregApprove, 'approved'); });
    });
    listEl.querySelectorAll('[data-preg-reject]').forEach(function(btn) {
      btn.addEventListener('click', function() { reviewPlayerReg(btn.dataset.pregReject, 'rejected'); });
    });
  } catch(e) {
    listEl.innerHTML = '<div class="album-list-loading">Error: ' + pregEsc(e.message) + '</div>';
  }
}

async function reviewPlayerReg(id, status) {
  var note = null;
  if (status === 'rejected') {
    note = prompt('Reason for rejection (optional — stored on the record):') || null;
    if (note === null && !confirm('Reject without a note?')) return;
  } else {
    if (!confirm('Approve this registration? Remember to add the player in the Players tab.')) return;
  }
  try {
    await adminAPI('registration.review', { id: id, status: status, note: note });
    loadPlayerRegs();
  } catch(e) {
    alert('Review failed: ' + e.message);
  }
}

/* ── CSV export — client-side from the currently loaded filter.
     Medical info is EXCLUDED by default (POPIA special personal
     information) and only included when the checkbox is ticked. ── */
async function exportPlayerRegsCSV() {
  var scope  = (document.getElementById('preg-export-scope') || {}).value || 'all';
  var status = scope === 'all' ? 'all'
             : ((document.getElementById('preg-status-filter') || {}).value || 'pending');

  var rows;
  if (scope === 'all') {
    // Fresh fetch across every status — don't rely on the filtered view
    try {
      var r = await adminAPI('registration.list', { status: 'all' });
      rows = Array.isArray(r) ? r : [];
    } catch(e) { alert('Export failed: ' + e.message); return; }
  } else {
    rows = pregRows;
  }

  // ── Clean the roster before export ────────────────────────
  // Rejected ("deleted") registrations live in the review list, not the
  // roster — drop them unless we're explicitly exporting rejected.
  if (status !== 'rejected') {
    rows = rows.filter(function(r){ return r.status !== 'rejected'; });
  }
  // Collapse duplicate submissions. A person is keyed by name + DOB (NOT
  // email — one guardian email is often shared across siblings). Keep the
  // best record per person: approved > pending, newest breaks ties.
  var regRank = function(s){ return s === 'approved' ? 2 : s === 'pending' ? 1 : 0; };
  var personKey = function(r){
    return [ String(r.first_name||'').trim().toLowerCase().replace(/\s+/g,' '),
             String(r.surname||'').trim().toLowerCase().replace(/\s+/g,' '),
             String(r.dob||'').trim() ].join('|');
  };
  var bestByPerson = {}, dupCount = 0;
  rows.forEach(function(r){
    var k = personKey(r), cur = bestByPerson[k];
    if (!cur) { bestByPerson[k] = r; return; }
    dupCount++;
    var better = regRank(r.status) > regRank(cur.status) ||
      (regRank(r.status) === regRank(cur.status) &&
       String(r.created_at||'') > String(cur.created_at||''));
    if (better) bestByPerson[k] = r;
  });
  rows = Object.keys(bestByPerson).map(function(k){ return bestByPerson[k]; });

  if (!rows.length) { alert('Nothing to export.'); return; }

  var withMedical = !!(document.getElementById('preg-export-medical') || {}).checked;
  if (withMedical && !confirm(
    'The export will include medical information (POPIA special personal information).\n' +
    'Only share this file with people who need it for player safety.\n\nContinue?')) return;
  var cols = [
    ['First name',   function(r){ return r.first_name; }],
    ['Surname',      function(r){ return r.surname; }],
    ['Nickname',     function(r){ return r.nickname; }],
    ['DOB',          function(r){ return r.dob; }],
    ['Age',          function(r){ return pregAge(r.dob); }],
    ['Squad',        function(r){ return pregSquad(r.dob) === 'youth' ? 'Youth' : 'Senior'; }],
    ['Minor',        function(r){ return r.is_minor ? 'Yes' : 'No'; }],
    ['Email',        function(r){ return r.email; }],
    ['Phone',        function(r){ return r.phone; }],
    ['Suburb',       function(r){ return r.suburb; }],
    ['Guardian',     function(r){ return r.guardian_name; }],
    ['Guardian phone', function(r){ return r.guardian_phone; }],
    ['Relationship', function(r){ return r.guardian_relationship; }],
    ['Role',         function(r){ return r.role; }],
    ['Batting',      function(r){ return r.batting; }],
    ['Bowling',      function(r){ return r.bowling; }],
    ['Previous club',function(r){ return r.previous_club; }],
    ['Emergency contact', function(r){ return r.emergency_name; }],
    ['Emergency phone',   function(r){ return r.emergency_phone; }],
    ['POPIA consent',     function(r){ return r.popia_consent ? 'Yes' : 'No'; }],
    ['Indemnity consent', function(r){ return r.indemnity_consent ? 'Yes' : 'No'; }],
    ['Disclaimer version',function(r){ return r.disclaimer_version; }],
    ['Media consent',     function(r){ return r.media_consent ? 'Yes' : 'No'; }],
    ['Guardian consent',  function(r){ return r.guardian_consent ? 'Yes' : 'No'; }],
    ['Status',       function(r){ return r.status; }],
    ['Reviewed by',  function(r){ return r.reviewed_by; }],
    ['Reviewed at',  function(r){ return r.reviewed_at; }],
    ['Review note',  function(r){ return r.review_note; }],
    ['Submitted at', function(r){ return r.created_at; }]
  ];
  if (withMedical) {
    cols.push(['Medical consent', function(r){ return r.medical_consent ? 'Yes' : 'No'; }]);
    cols.push(['Medical info',    function(r){ return r.medical_info; }]);
  }

  var csvCell = function(v) {
    var s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  };
  var header = cols.map(function(c){ return csvCell(c[0]); }).join(',');
  var today = new Date().toISOString().slice(0,10);

  var buildAndDownload = function(squadRows, squadName) {
    if (!squadRows.length) return 0;
    var lines = [ header ];
    squadRows.forEach(function(r) {
      lines.push(cols.map(function(c){ return csvCell(c[1](r)); }).join(','));
    });
    // \ufeff BOM so Excel opens it as UTF-8
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tcc-registrations-' + squadName + '-' + status + '-' + today + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    return squadRows.length;
  };

  // Split by squad and export TWO files (youth + senior).
  var youth  = rows.filter(function(r){ return pregSquad(r.dob) === 'youth'; });
  var senior = rows.filter(function(r){ return pregSquad(r.dob) === 'senior'; });
  var ny = buildAndDownload(youth,  'youth');
  var ns = buildAndDownload(senior, 'senior');
  alert('Exported ' + ny + ' youth and ' + ns + ' senior registration(s) as two CSV files.\n' +
        (dupCount ? dupCount + ' duplicate submission(s) merged.\n' : '') +
        '(Youth = 17 and under, Senior = 18+, by age today.)');
}

/* ── Registration → Profile promotion ──
   We NEVER auto-match. This shows any candidate players and the admin
   explicitly chooses: link to an existing profile, or create a new one. */
async function openPromoteModal(regId) {
  var old = document.getElementById('promote-modal');
  if (old) old.remove();

  var wrap = document.createElement('div');
  wrap.id = 'promote-modal';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);' +
    'display:flex;align-items:center;justify-content:center;padding:20px';
  wrap.innerHTML = '<div style="background:var(--panel,#1a1d1a);border:1px solid var(--line,#333);' +
    'border-radius:10px;max-width:560px;width:100%;max-height:85vh;overflow:auto;padding:24px">' +
    '<div id="promote-body"><div class="album-list-loading">Checking for an existing profile…</div></div></div>';
  document.body.appendChild(wrap);
  wrap.addEventListener('click', function(e){ if (e.target === wrap) wrap.remove(); });

  var body = document.getElementById('promote-body');
  try {
    var data = await adminAPI('registration.candidates', { id: regId });
    var reg = data.registration || {};
    var cands = data.candidates || [];
    var sq = pregSquad(reg.dob);

    var html = '<h3 style="margin:0 0 4px">Create / link profile</h3>'
      + '<p style="color:var(--muted2);font-size:0.85rem;margin:0 0 16px">'
      + pregEsc(data.fullName) + ' &middot; ' + pregAge(reg.dob) + ' yrs &middot; '
      + (sq === 'youth' ? 'Youth' : 'Senior') + (reg.email ? ' &middot; ' + pregEsc(reg.email) : '')
      + '</p>';

    if (cands.length) {
      html += '<p style="font-size:0.8rem;color:var(--muted2);margin-bottom:8px">'
        + 'Possible existing profiles — pick one to <strong>link</strong> (their details get refreshed '
        + 'from this registration), or create a new player below.</p>';
      cands.forEach(function(c) {
        html += '<label style="display:flex;gap:10px;align-items:center;padding:10px 12px;margin-bottom:6px;'
          + 'border:1px solid var(--line,#333);border-radius:6px;cursor:pointer">'
          + '<input type="radio" name="promote-choice" value="' + c.id + '">'
          + '<span style="flex:1"><strong>' + pregEsc(c.name) + '</strong>'
          + (c.nickname ? ' <span style="color:var(--muted2)">"' + pregEsc(c.nickname) + '"</span>' : '')
          + '<br><span style="font-size:0.74rem;color:var(--muted2)">' + pregEsc(c.role || '—')
          + ' &middot; ' + pregEsc(c.match_reason) + (c.email ? ' &middot; ' + pregEsc(c.email) : '') + '</span></span>'
          + '</label>';
      });
    } else {
      html += '<p style="font-size:0.82rem;color:var(--muted2);margin-bottom:10px">'
        + 'No existing profile found with a matching name or email.</p>';
    }

    html += '<label style="display:flex;gap:10px;align-items:center;padding:10px 12px;margin-bottom:14px;'
      + 'border:1px dashed var(--line,#444);border-radius:6px;cursor:pointer">'
      + '<input type="radio" name="promote-choice" value="__new__"' + (cands.length ? '' : ' checked') + '>'
      + '<span><strong>Create a new player profile</strong>'
      + '<br><span style="font-size:0.74rem;color:var(--muted2)">This person isn\'t in the squad yet</span></span>'
      + '</label>';

    if (reg.is_minor || pregAge(reg.dob) < 18) {
      html += '<p style="font-size:0.74rem;color:#e0c96a;background:rgba(201,162,39,.1);'
        + 'border:1px solid rgba(201,162,39,.3);border-radius:5px;padding:8px 10px;margin-bottom:14px">'
        + 'Junior player. Guardian details are stored on the profile but never shown publicly. '
        + 'Their photo will only display if media consent was given ('
        + (reg.media_consent ? 'consent given' : 'NO consent — photo will stay hidden') + ').</p>';
    }

    html += '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button class="btn-sm" id="promote-cancel">Cancel</button>'
      + '<button class="btn-sm" id="promote-confirm" style="background:var(--gold,#C9A227);color:#111;'
      + 'border-color:var(--gold,#C9A227)">Confirm</button></div>';

    body.innerHTML = html;

    document.getElementById('promote-cancel').addEventListener('click', function(){ wrap.remove(); });
    document.getElementById('promote-confirm').addEventListener('click', async function() {
      var sel = document.querySelector('input[name="promote-choice"]:checked');
      if (!sel) { alert('Pick an option first.'); return; }
      this.disabled = true; this.textContent = 'Working…';
      try {
        var payload = { id: regId };
        if (sel.value !== '__new__') payload.playerId = sel.value;
        var res = await adminAPI('registration.promote', payload);
        wrap.remove();
        alert(res.mode === 'linked'
          ? 'Linked to existing profile: ' + (res.player && res.player.name)
          : 'New player profile created: ' + (res.player && res.player.name));
        loadPlayerRegs();
      } catch(e) {
        alert('Failed: ' + e.message);
        this.disabled = false; this.textContent = 'Confirm';
      }
    });
  } catch(e) {
    body.innerHTML = '<div class="album-list-loading">Error: ' + pregEsc(e.message) + '</div>'
      + '<div style="text-align:right;margin-top:12px"><button class="btn-sm" onclick="document.getElementById(\'promote-modal\').remove()">Close</button></div>';
  }
}

(function wirePlayerRegsUI() {
  var filter = document.getElementById('preg-status-filter');
  var squadFilter = document.getElementById('preg-squad-filter');
  var exportBtn = document.getElementById('preg-export-btn');
  if (filter)    filter.addEventListener('change', loadPlayerRegs);
  if (squadFilter) squadFilter.addEventListener('change', loadPlayerRegs);
  if (exportBtn) exportBtn.addEventListener('click', exportPlayerRegsCSV);
})();

/* ══════════════════════════════════════════════════════
   SHOP TAB  (super + scores)
   Orders (collection workflow) + Products (catalogue CRUD).
══════════════════════════════════════════════════════ */
var shopOrders = [];        // current filter's orders — feeds CSV
var shopProducts = [];      // admin catalogue (incl. inactive)
var spEditing = null;       // product being edited, or null for new
var spVariants = [];        // working variant rows in the editor

function shopEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function shopRand(cents) { return (Number(cents || 0) / 100).toFixed(2); }

/* ── sub-tab switching ── */
(function shopSubtabs() {
  document.querySelectorAll('.fix-subtab[data-shopsub]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.fix-subtab[data-shopsub]').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var sub = btn.dataset.shopsub;
      document.getElementById('shop-panel-orders').style.display   = sub === 'orders'   ? 'block' : 'none';
      document.getElementById('shop-panel-products').style.display = sub === 'products' ? 'block' : 'none';
      if (sub === 'products' && !shopProducts.length) loadShopProducts();
    });
  });
})();

/* Finance role = read-only orders. Hide Products sub-tab, sweep, and (via CSS)
   the per-order action buttons. Called whenever the shop orders list renders. */
function applyFinanceReadonly() {
  if (SESSION_ROLE !== 'finance') return;
  // hide the Products sub-tab button entirely
  document.querySelectorAll('.fix-subtab[data-shopsub="products"]').forEach(function(b){ b.style.display = 'none'; });
  document.getElementById('shop-panel-products') && (document.getElementById('shop-panel-products').style.display = 'none');
  // hide sweep + any per-order action buttons (confirm ready / collect / delete)
  var sweep = document.getElementById('shop-orders-sweep');
  if (sweep) sweep.style.display = 'none';
  document.querySelectorAll('#shop-orders-list [data-ready],#shop-orders-list [data-collect],#shop-orders-list [data-delorder]')
    .forEach(function(btn){ btn.style.display = 'none'; });
}

/* ══ ORDERS ══ */
function shopRenderMetrics(orders){
  var el = document.getElementById('shop-metrics');
  if(!el) return;
  var value = orders.reduce(function(s,o){ return s + (o.total_cents||0); }, 0);
  var paid = orders.filter(function(o){ return o.payment_status==='paid'; }).length;
  el.innerHTML =
    confMetricCard('Orders', String(orders.length)) +
    confMetricCard('Value', 'R' + shopRand(value)) +
    confMetricCard('Paid', String(paid));
}

async function loadShopOrders() {
  var listEl = document.getElementById('shop-orders-list');
  var badge  = document.getElementById('shop-ready-badge');
  if (!listEl) return;
  var filter = (document.getElementById('shop-order-filter') || {}).value || 'awaiting_preparation';
  listEl.innerHTML = '<div class="album-list-loading">Loading…</div>';
  try {
    var rows = await adminAPI('store.listOrders', { fulfilment: filter });
    shopOrders = Array.isArray(rows) ? rows : [];

    // badge shows the prep queue — paid orders still needing to be readied
    shopRenderMetrics(shopOrders);
    if (!shopOrders.length) {
      listEl.innerHTML = '<div class="mx-empty">No orders in this view.</div>';
      return;
    }
    listEl.innerHTML = shopOrders.map(function(o) {
      var date = new Date(o.created_at).toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'});
      var items = (o.order_items || []).map(function(it) {
        return '<li>' + it.qty + '\u00D7 ' + shopEsc(it.name_snapshot) + ' <span style="color:var(--muted)">R' + shopRand(it.line_cents) + '</span></li>';
      }).join('');
      var payPill = o.payment_status === 'paid'
        ? '<span style="color:#6cc58a">Paid</span>'
        : '<span style="color:var(--muted)">' + shopEsc(o.payment_status) + '</span>';
      var methodTag = o.payment_method === 'cash'
        ? '<span class="mx-tag mx-tag-neutral">Cash</span>'
        : '<span class="mx-tag mx-tag-info">Card</span>';
      var action;
      if (o.fulfilment === 'awaiting_preparation') {
        action = '<button class="mx-btn mx-btn-sm mx-btn-primary" data-ready="' + o.id + '">Confirm ready</button>';
      } else if (o.fulfilment === 'ready_for_collection') {
        action = '<button class="mx-btn mx-btn-sm mx-btn-ghost" data-collect="' + o.id + '">Mark collected</button>';
      } else if (o.fulfilment === 'collected') {
        action = '<span class="mx-review-meta" style="margin-top:0">Collected ' + (o.collected_at ? new Date(o.collected_at).toLocaleDateString('en-ZA') : '') + '</span>';
      } else {
        action = '';
      }
      var delBtn = (o.payment_status !== 'paid')
        ? '<button class="mx-btn mx-btn-sm mx-btn-danger" data-delorder="' + o.id + '">Delete</button>'
        : '';
      return '<div class="mx-review-card">'
        + '<div class="mx-review-top"><div class="mx-review-name">#' + (o.order_no || o.id.slice(0,8)) + ' \u00B7 ' + shopEsc(o.buyer_name) + methodTag + '</div>'
        +   '<div class="mx-review-date">' + date + '<br>' + payPill + '</div></div>'
        + '<div class="mx-review-sub">' + shopEsc(o.buyer_email) + (o.buyer_phone ? ' \u00B7 ' + shopEsc(o.buyer_phone) : '') + '</div>'
        + '<ul class="mx-order-items">' + items + '</ul>'
        + '<div class="mx-order-foot"><strong>Total R' + shopRand(o.total_cents) + '</strong>'
        +   '<span class="mx-review-foot" style="margin-top:0">' + action + delBtn + '</span></div>'
        + '</div>';
    }).join('');

    listEl.querySelectorAll('[data-ready]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Confirm this order is ready? This emails the buyer to come collect it.')) return;
        btn.disabled = true; btn.textContent = 'Sending…';
        try { await adminAPI('store.confirmReady', { id: btn.dataset.ready }); loadShopOrders(); }
        catch(e) { alert('Failed: ' + e.message); btn.disabled = false; }
      });
    });
    listEl.querySelectorAll('[data-collect]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Mark order as collected?')) return;
        try { await adminAPI('store.markCollected', { id: btn.dataset.collect }); loadShopOrders(); }
        catch(e) { alert('Failed: ' + e.message); }
      });
    });
    listEl.querySelectorAll('[data-delorder]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Delete this order? Only unpaid orders can be removed. This cannot be undone.')) return;
        btn.disabled = true;
        try { await adminAPI('store.deleteOrder', { id: btn.dataset.delorder }); loadShopOrders(); }
        catch(e) { alert('Delete failed: ' + e.message); btn.disabled = false; }
      });
    });
    applyFinanceReadonly();
  } catch(e) {
    listEl.innerHTML = '<div class="album-list-loading">Error: ' + shopEsc(e.message) + '</div>';
  }
}

function exportShopOrdersCSV() {
  if (!shopOrders.length) { alert('Nothing to export for this view.'); return; }
  var cols = [
    ['Order no', function(o){ return o.order_no; }],
    ['Buyer', function(o){ return o.buyer_name; }],
    ['Email', function(o){ return o.buyer_email; }],
    ['Phone', function(o){ return o.buyer_phone; }],
    ['Items', function(o){ return (o.order_items||[]).map(function(i){ return i.qty+'x '+i.name_snapshot; }).join('; '); }],
    ['Total (R)', function(o){ return shopRand(o.total_cents); }],
    ['Payment', function(o){ return o.payment_status; }],
    ['Fulfilment', function(o){ return o.fulfilment; }],
    ['Ordered', function(o){ return o.created_at; }],
    ['Collected', function(o){ return o.collected_at; }]
  ];
  var cell = function(v){ var s=String(v==null?'':v); return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  var lines = [cols.map(function(c){return cell(c[0]);}).join(',')];
  shopOrders.forEach(function(o){ lines.push(cols.map(function(c){return cell(c[1](o));}).join(',')); });
  var blob = new Blob(['\ufeff'+lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tcc-shop-orders-' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* ══ PRODUCTS ══ */
async function loadShopProducts() {
  var listEl = document.getElementById('shop-products-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="album-list-loading">Loading…</div>';
  try {
    var rows = await adminAPI('store.listProductsAdmin', {});
    shopProducts = Array.isArray(rows) ? rows : [];
    if (!shopProducts.length) {
      listEl.innerHTML = '<div class="album-list-loading">No products yet. Add your first one.</div>';
      return;
    }
    listEl.innerHTML = shopProducts.map(function(p) {
      var stock = p.has_variants
        ? (p.product_variants||[]).reduce(function(n,v){return n+(v.stock||0);},0) + ' in stock across ' + (p.product_variants||[]).length + ' sizes'
        : 'Single item';
      var thumb = p.image_url
        ? '<div class="sp-thumb" style="background-image:url(' + shopEsc(p.image_url) + ')"></div>'
        : '<div class="sp-thumb sp-thumb--ph">TCC</div>';
      return '<div class="shop-prow" data-edit="' + p.id + '">'
        + thumb
        + '<div style="flex:1"><strong>' + shopEsc(p.name) + '</strong>'
        +   (p.active ? '' : ' <span style="color:var(--muted2);font-size:0.72rem">(hidden)</span>')
        +   '<div style="font-size:0.76rem;color:var(--muted2)">R' + shopRand(p.price_cents) + ' · ' + stock + '</div></div>'
        + '<span style="color:var(--muted2)">Edit ›</span>'
        + '</div>';
    }).join('');
    listEl.querySelectorAll('[data-edit]').forEach(function(row) {
      row.addEventListener('click', function() { openProductEditor(row.dataset.edit); });
    });
  } catch(e) {
    listEl.innerHTML = '<div class="album-list-loading">Error: ' + shopEsc(e.message) + '</div>';
  }
}

function openProductEditor(id) {
  spEditing = id ? shopProducts.find(function(p){ return p.id === id; }) : null;
  var ed = document.getElementById('shop-editor');
  ed.style.display = 'block';
  document.getElementById('shop-editor-title').textContent = spEditing ? 'Edit product' : 'New product';
  document.getElementById('sp-delete').style.display = spEditing ? 'inline-block' : 'none';
  document.getElementById('sp-save-status').textContent = '';

  var p = spEditing || {};
  document.getElementById('sp-name').value = p.name || '';
  document.getElementById('sp-slug').value = p.slug || '';
  document.getElementById('sp-price').value = p.price_cents != null ? (p.price_cents/100).toFixed(2) : '';
  document.getElementById('sp-category').value = p.category || '';
  document.getElementById('sp-desc').value = p.description || '';
  document.getElementById('sp-active').checked = p.active !== false;
  document.getElementById('sp-hasvariants').checked = !!p.has_variants;
  setProductImage(p.image_url || '');

  spVariants = (p.product_variants || []).map(function(v) {
    return { id: v.id, label: v.label, stock: v.stock, priceCents: v.price_cents };
  });
  toggleVariantsBlock();
  renderVariantRows();
  ed.scrollIntoView({ behavior:'smooth', block:'start' });
}

function setProductImage(url) {
  var prev = document.getElementById('sp-image-preview');
  prev.dataset.url = url || '';
  prev.style.backgroundImage = url ? 'url(' + url + ')' : '';
  prev.textContent = url ? '' : 'No image';
}

function toggleVariantsBlock() {
  var on = document.getElementById('sp-hasvariants').checked;
  document.getElementById('sp-variants-block').style.display = on ? 'block' : 'none';
}

function renderVariantRows() {
  var wrap = document.getElementById('sp-variants-list');
  wrap.innerHTML = spVariants.map(function(v, i) {
    return '<div class="sp-vrow">'
      + '<input class="form-control" placeholder="Size (S, M, L…)" value="' + shopEsc(v.label||'') + '" data-vi="' + i + '" data-vf="label">'
      + '<input class="form-control" type="number" min="0" placeholder="Stock" value="' + (v.stock!=null?v.stock:'') + '" data-vi="' + i + '" data-vf="stock" style="max-width:90px">'
      + '<input class="form-control" type="number" min="0" step="0.01" placeholder="Price (opt)" value="' + (v.priceCents!=null?(v.priceCents/100).toFixed(2):'') + '" data-vi="' + i + '" data-vf="price" style="max-width:120px">'
      + '<button class="btn-sm" data-vdel="' + i + '">✕</button>'
      + '</div>';
  }).join('');
  wrap.querySelectorAll('input[data-vi]').forEach(function(inp) {
    inp.addEventListener('input', function() {
      var i = +inp.dataset.vi, f = inp.dataset.vf;
      if (f === 'label') spVariants[i].label = inp.value;
      if (f === 'stock') spVariants[i].stock = parseInt(inp.value,10) || 0;
      if (f === 'price') spVariants[i].priceCents = inp.value === '' ? null : Math.round(parseFloat(inp.value)*100);
    });
  });
  wrap.querySelectorAll('[data-vdel]').forEach(function(btn) {
    btn.addEventListener('click', function() { spVariants.splice(+btn.dataset.vdel,1); renderVariantRows(); });
  });
}

/* editor events */
(function shopEditorWiring() {
  var addBtn = document.getElementById('shop-add-product');
  if (addBtn) addBtn.addEventListener('click', function(){ openProductEditor(null); });
  var closeBtn = document.getElementById('shop-editor-close');
  if (closeBtn) closeBtn.addEventListener('click', function(){ document.getElementById('shop-editor').style.display='none'; });
  var hv = document.getElementById('sp-hasvariants');
  if (hv) hv.addEventListener('change', toggleVariantsBlock);
  var av = document.getElementById('sp-add-variant');
  if (av) av.addEventListener('click', function(){ spVariants.push({label:'',stock:0,priceCents:null}); renderVariantRows(); });

  var orderFilter = document.getElementById('shop-order-filter');
  if (orderFilter) orderFilter.addEventListener('change', loadShopOrders);
  var exportBtn = document.getElementById('shop-orders-export');
  if (exportBtn) exportBtn.addEventListener('click', exportShopOrdersCSV);
  var sweepBtn = document.getElementById('shop-orders-sweep');
  if (sweepBtn) sweepBtn.addEventListener('click', async function() {
    if (!confirm('Remove abandoned online orders left unpaid for over an hour? Cash orders and paid orders are never affected.')) return;
    sweepBtn.disabled = true; sweepBtn.textContent = 'Clearing…';
    try {
      var r = await adminAPI('store.sweepStale', { maxAgeMinutes: 60 });
      alert('Cleared ' + (r.removed || 0) + ' stuck order(s).');
      loadShopOrders();
    } catch(e) { alert('Sweep failed: ' + e.message); }
    finally { sweepBtn.disabled = false; sweepBtn.textContent = '🧹 Clear stuck orders'; }
  });

  // image upload (reuses the worker storage path, 'store' bucket)
  var imgFile = document.getElementById('sp-image-file');
  if (imgFile) imgFile.addEventListener('change', async function() {
    var file = this.files[0]; if (!file) return;
    var status = document.getElementById('sp-image-status');
    status.textContent = 'Uploading…';
    try {
      var base64 = await new Promise(function(res, rej){
        var r = new FileReader(); r.onload=function(){res(r.result.split(',')[1]);}; r.onerror=rej; r.readAsDataURL(file);
      });
      var ext = file.name.split('.').pop().toLowerCase();
      var fileName = 'product-' + Date.now() + '.' + ext;
      var up = await adminAPI('store.uploadImage', { fileName: fileName, contentType: file.type, base64: base64 });
      if (!up || !up.url) throw new Error('Upload failed');
      setProductImage(up.url);
      status.textContent = '✅ Uploaded';
      setTimeout(function(){ status.textContent=''; }, 3000);
    } catch(e) { status.textContent = 'Failed: ' + e.message; }
  });

  var saveBtn = document.getElementById('sp-save');
  if (saveBtn) saveBtn.addEventListener('click', saveProduct);
  var delBtn = document.getElementById('sp-delete');
  if (delBtn) delBtn.addEventListener('click', deleteProduct);
})();

async function saveProduct() {
  var status = document.getElementById('sp-save-status');
  var name = document.getElementById('sp-name').value.trim();
  var slug = document.getElementById('sp-slug').value.trim();
  var priceR = document.getElementById('sp-price').value;
  if (!name || !slug || priceR === '') {
    status.style.color = '#e0736f'; status.textContent = 'Name, slug and price are required.'; return;
  }
  var hasVariants = document.getElementById('sp-hasvariants').checked;
  status.style.color = 'var(--muted2)'; status.textContent = 'Saving…';

  try {
    var saved = await adminAPI('store.saveProduct', {
      id: spEditing ? spEditing.id : undefined,
      name: name, slug: slug,
      priceCents: Math.round(parseFloat(priceR) * 100),
      description: document.getElementById('sp-desc').value.trim() || null,
      category: document.getElementById('sp-category').value.trim() || null,
      imageUrl: document.getElementById('sp-image-preview').dataset.url || null,
      hasVariants: hasVariants,
      active: document.getElementById('sp-active').checked
    });
    var prodRow = Array.isArray(saved) ? saved[0] : saved;
    var productId = prodRow && prodRow.id ? prodRow.id : (spEditing && spEditing.id);

    if (hasVariants && productId) {
      await adminAPI('store.saveVariants', { productId: productId, variants: spVariants });
    }
    status.style.color = '#5ec98a'; status.textContent = '✅ Saved';
    await loadShopProducts();
    setTimeout(function(){ document.getElementById('shop-editor').style.display='none'; }, 800);
  } catch(e) {
    status.style.color = '#e0736f'; status.textContent = 'Save failed: ' + e.message;
  }
}

async function deleteProduct() {
  if (!spEditing) return;
  if (!confirm('Delete "' + spEditing.name + '"? This removes it and its sizes. Orders already placed keep their record.')) return;
  try {
    await adminAPI('store.deleteProduct', { id: spEditing.id });
    document.getElementById('shop-editor').style.display = 'none';
    loadShopProducts();
  } catch(e) { alert('Delete failed: ' + e.message); }
}


/* ══════════════════════════════════════════════════════
   CONFIDENTIALITY UNDERTAKINGS  (super only)
   Register + CSV + printable PDF of signed undertakings.
   Reads the Worker's /api/agreement/records endpoint with the logged-in
   admin's JWT (SESSION_TOKEN). Everything else is client-side. The PDF is
   built in a separate print window so it never inherits the admin layout.
══════════════════════════════════════════════════════ */
var confRecords = [];

function confEsc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function confFmtDate(iso){
  if(!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleString('en-ZA',{dateStyle:'long',timeStyle:'short',timeZone:'Africa/Johannesburg'});
  } catch(e){ return iso; }
}

async function loadConfidentiality(){
  var list = document.getElementById('conf-list');
  if(list) list.innerHTML = '<div class="album-list-loading">Loading&hellip;</div>';
  try {
    var res = await fetch(WORKER_URL + '/api/agreement/records?token=' + encodeURIComponent(SESSION_TOKEN));
    if(res.status===401 || res.status===403){
      if(list) list.innerHTML = '<div class="conf-empty">Not authorised, or your session has expired. Please log in again.</div>';
      return;
    }
    var data = await res.json();
    if(!data.ok) throw new Error(data.error||'Load failed');
    confRecords = Array.isArray(data.records)?data.records:[];
    confPopulateVersions();
    confRenderList();
  } catch(e){
    console.error(e);
    if(list) list.innerHTML = '<div class="conf-empty">Could not load records. Try Reload.</div>';
  }
}

function confPopulateVersions(){
  var sel = document.getElementById('conf-version');
  if(!sel) return;
  var current = sel.value || 'all';
  var versions = Array.from(new Set(confRecords.map(function(r){return r.agreement_version;}))).sort();
  sel.innerHTML = '<option value="all">All versions</option>' +
    versions.map(function(v){return '<option value="'+confEsc(v)+'">Version '+confEsc(v)+'</option>';}).join('');
  sel.value = current;
}

function confFiltered(){
  var sel = document.getElementById('conf-version');
  var v = sel ? sel.value : 'all';
  return v==='all' ? confRecords : confRecords.filter(function(r){return r.agreement_version===v;});
}

var MX_ICON_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>';

function confFmtDateShort(iso){
  if(!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleDateString('en-ZA',{day:'2-digit',month:'short',year:'numeric',timeZone:'Africa/Johannesburg'});
  } catch(e){ return iso; }
}

function confMetricCard(label,value){
  return '<div class="mx-metric"><div class="mx-metric-label">'+confEsc(label)+'</div><div class="mx-metric-value">'+confEsc(value)+'</div></div>';
}

function confRenderMetrics(rows){
  var el = document.getElementById('conf-metrics');
  if(!el) return;
  var vers = Array.from(new Set(rows.map(function(r){return r.agreement_version;}))).filter(Boolean).sort();
  var sel = document.getElementById('conf-version');
  var verLabel, verValue;
  if(sel && sel.value && sel.value!=='all'){ verLabel='Version'; verValue=sel.value; }
  else if(vers.length<=1){ verLabel='Version'; verValue=vers[0]||'\u2014'; }
  else { verLabel='Versions'; verValue=String(vers.length); }
  var last = rows.reduce(function(acc,r){
    var t = r.signed_at ? new Date(r.signed_at).getTime() : 0;
    return (t && t>acc.t) ? {t:t,iso:r.signed_at} : acc;
  }, {t:0,iso:null});
  el.innerHTML =
    confMetricCard('Signed', String(rows.length)) +
    confMetricCard(verLabel, verValue) +
    confMetricCard('Last signed', last.iso ? confFmtDateShort(last.iso) : '\u2014');
}

function confRenderList(){
  var rows   = confFiltered();
  var list   = document.getElementById('conf-list');
  var csvBtn = document.getElementById('conf-csv-btn');
  var pdfBtn = document.getElementById('conf-pdf-btn');
  if(csvBtn) csvBtn.disabled = rows.length===0;
  if(pdfBtn) pdfBtn.disabled = rows.length===0;
  confRenderMetrics(rows);
  if(!rows.length){
    if(list) list.innerHTML = '<div class="mx-table-wrap"><div class="mx-empty">No signatures recorded yet.</div></div>';
    return;
  }
  var body = rows.map(function(r){
    return '<tr>'+
      '<td>'+confEsc(r.signer_name)+'</td>'+
      '<td>'+confEsc(r.signer_role||'\u2014')+'</td>'+
      '<td>'+confEsc(confFmtDateShort(r.signed_at))+'</td>'+
      '<td class="mx-col-action"><button class="mx-icon-btn conf-row-pdf" data-print-id="'+confEsc(String(r.id))+'" title="Download signed record (PDF)" aria-label="Download signed record for '+confEsc(r.signer_name)+'">'+MX_ICON_FILE+'</button></td>'+
    '</tr>';
  }).join('');
  if(list) list.innerHTML =
    '<div class="mx-table-wrap"><div class="mx-table-scroll"><table class="mx-table"><thead><tr>'+
      '<th>Name</th><th>Position</th><th>Signed</th><th class="mx-col-action"></th>'+
    '</tr></thead><tbody>'+body+'</tbody></table></div></div>';
}

/* ── CSV ── */
function confDownloadCsv(){
  var rows = confFiltered();
  if(!rows.length) return;
  var head = ['#','Name','Position','Email','Signed (ISO)','Version','IP','Device','Record reference'];
  var q = function(v){ return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'; };
  var lines = [head.map(q).join(',')];
  rows.forEach(function(r,i){
    lines.push([i+1,r.signer_name,r.signer_role||'',r.signer_email,r.signed_at||'',r.agreement_version,r.ip_address||'',r.user_agent||'',r.record_hash||''].map(q).join(','));
  });
  var blob = new Blob([lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'TCC-undertakings-register-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ── Printable PDF (opens a print-ready window) ── */
function confSigBlock(r){
  var data = r.signature_data||'';
  if(r.signature_type==='drawn' && /^data:image\//.test(data)){
    return '<img class="c-sig-img" src="'+confEsc(data)+'" alt="Signature of '+confEsc(r.signer_name)+'">';
  }
  return '<div class="c-sig-typed">'+confEsc(data||r.signer_name)+'</div>';
}

function confCertHtml(r,n,total){
  return ''+
  '<section class="c-page c-cert">'+
    '<div class="c-cert-head"><span class="c-kicker">Confidentiality Undertaking &mdash; Signed Record</span><span class="c-no">'+n+' of '+total+'</span></div>'+
    '<h2 class="c-name">'+confEsc(r.signer_name)+'</h2>'+
    '<p class="c-role">'+confEsc(r.signer_role||'Position not stated')+'</p>'+
    '<p class="c-email">'+confEsc(r.signer_email)+'</p>'+
    '<div class="c-textwrap"><p class="c-textmeta">The text agreed to &mdash; version '+confEsc(r.agreement_version)+'</p>'+
      '<p class="c-text">'+confEsc(r.agreement_text||'[Text for this version is not on file.]')+'</p></div>'+
    '<div class="c-sig"><div class="c-sig-mark">'+confSigBlock(r)+'<div class="c-sig-label">Signature ('+confEsc(r.signature_type||'n/a')+')</div></div></div>'+
    '<div class="c-audit">'+
      '<div class="c-arow"><span class="c-k">Signed</span><span class="c-v">'+confEsc(confFmtDate(r.signed_at))+'</span></div>'+
      '<div class="c-arow"><span class="c-k">Consent given</span><span class="c-v">'+confEsc(r.consent_text||'\u2014')+'</span></div>'+
      '<div class="c-arow"><span class="c-k">Network address</span><span class="c-v c-mono">'+confEsc(r.ip_address||'\u2014')+'</span></div>'+
      '<div class="c-arow"><span class="c-k">Device</span><span class="c-v">'+confEsc(r.user_agent||'\u2014')+'</span></div>'+
      '<div class="c-arow"><span class="c-k">Text hash</span><span class="c-v c-mono">'+confEsc(r.agreement_hash||'\u2014')+'</span></div>'+
      '<div class="c-arow"><span class="c-k">Record reference</span><span class="c-v c-mono">'+confEsc(r.record_hash||'\u2014')+'</span></div>'+
    '</div>'+
    '<p class="c-statement">Signed electronically in terms of the Electronic Communications and Transactions Act, 2002. The record reference is a tamper-evidence fingerprint of this record as it was saved; re-computing it from the stored fields will differ if the record was altered after signing.</p>'+
  '</section>';
}

function confCoverHtml(rows){
  var trs = rows.map(function(r,i){
    return '<tr><td>'+(i+1)+'</td><td>'+confEsc(r.signer_name)+'</td><td>'+confEsc(r.signer_role||'\u2014')+'</td><td>'+confEsc(r.signer_email)+'</td><td>'+confEsc(confFmtDate(r.signed_at))+'</td><td>'+confEsc(r.agreement_version)+'</td><td class="c-mono">'+confEsc(String(r.record_hash||'').slice(0,12))+'</td></tr>';
  }).join('');
  return ''+
  '<section class="c-page c-cover">'+
    '<p class="c-eyebrow">Tygerberg Cricket Club &middot; Est. 1957</p>'+
    '<h1 class="c-title">Register of Confidentiality Undertakings</h1>'+
    '<p class="c-meta">'+rows.length+(rows.length===1?' signatory':' signatories')+' &middot; generated '+confEsc(confFmtDate(new Date().toISOString()))+'</p>'+
    '<table class="c-table"><thead><tr><th>#</th><th>Name</th><th>Position</th><th>Email</th><th>Signed</th><th>Version</th><th>Reference</th></tr></thead><tbody>'+trs+'</tbody></table>'+
    '<p class="c-cover-foot">Facta Non Verba.</p>'+
  '</section>';
}

function confBuildPrintDoc(rows, includeCover){
  if(includeCover===undefined) includeCover=true;
  var certs = rows.map(function(r,i){return confCertHtml(r,i+1,rows.length);}).join('');
  var css =
    '*{box-sizing:border-box;}'+
    'body{margin:0;background:#fff;color:#141414;font-family:"DM Sans",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'+
    '.c-page{padding:0;}'+
    '.c-eyebrow{font-family:"Bebas Neue",sans-serif;letter-spacing:.2em;font-size:12px;color:#c9a227;margin:0 0 6px;}'+
    '.c-title{font-family:"DM Serif Display",Georgia,serif;font-size:28px;line-height:1.08;margin:0 0 8px;}'+
    '.c-meta{color:#6c6c6c;margin:0 0 16px;font-size:12px;}'+
    '.c-table{width:100%;border-collapse:collapse;font-size:12px;}'+
    '.c-table th{text-align:left;border-bottom:1.5px solid #000;padding:6px 8px;font-family:"Bebas Neue",sans-serif;font-weight:400;letter-spacing:.06em;color:#333;}'+
    '.c-table td{padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top;}'+
    '.c-cover-foot{font-family:"Bebas Neue",sans-serif;letter-spacing:.16em;color:#c9a227;text-align:right;margin-top:16px;}'+
    '.c-cover{page-break-after:always;}'+
    '.c-cert{page-break-after:always;}'+
    '.c-cert:last-child{page-break-after:auto;}'+
    '.c-cert-head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #ddd;padding-bottom:5px;margin-bottom:9px;}'+
    '.c-kicker{font-family:"Bebas Neue",sans-serif;letter-spacing:.14em;color:#c9a227;font-size:11px;}'+
    '.c-no{color:#6c6c6c;font-size:11px;}'+
    '.c-name{font-family:"DM Serif Display",Georgia,serif;font-size:20px;margin:0 0 1px;}'+
    '.c-role,.c-email{color:#6c6c6c;margin:0;font-size:11px;}'+
    '.c-textwrap{margin:9px 0;border:1px solid #ccc;border-radius:4px;padding:8px 10px;}'+
    '.c-textmeta{font-family:"Bebas Neue",sans-serif;letter-spacing:.1em;font-size:10px;color:#6c6c6c;margin:0 0 5px;text-transform:uppercase;}'+
    '.c-text{font-size:9.5px;line-height:1.38;white-space:pre-wrap;margin:0;}'+
    '.c-sig{margin:11px 0 4px;page-break-inside:avoid;}'+
    '.c-sig-mark{display:inline-block;min-width:240px;border-bottom:1.5px solid #000;padding-bottom:3px;}'+
    '.c-sig-img{max-height:58px;max-width:300px;display:block;}'+
    '.c-sig-typed{font-family:"DM Serif Display",Georgia,serif;font-style:italic;font-size:24px;line-height:1;}'+
    '.c-sig-label{font-family:"Bebas Neue",sans-serif;letter-spacing:.1em;font-size:10px;color:#6c6c6c;margin-top:4px;}'+
    '.c-audit{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;border-top:1px solid #ddd;padding-top:9px;margin-top:8px;page-break-inside:avoid;}'+
    '.c-k{font-family:"Bebas Neue",sans-serif;letter-spacing:.08em;color:#6c6c6c;font-size:10px;display:block;}'+
    '.c-v{font-size:11px;word-break:break-word;line-height:1.3;}'+
    '.c-mono{font-variant-numeric:tabular-nums;font-size:10px;}'+
    '.c-statement{font-size:9px;color:#6c6c6c;margin-top:10px;line-height:1.4;}'+
    '@page{margin:12mm;}';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>TCC Confidentiality Undertakings</title>'+
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'+
    '<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,400;0,500;0,700;1,400&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet">'+
    '<style>'+css+'</style></head><body>'+(includeCover?confCoverHtml(rows):'')+certs+
    '<scr'+'ipt>window.onload=function(){setTimeout(function(){window.focus();window.print();},500);};</scr'+'ipt>'+
    '</body></html>';
}

function confPrint(){
  var rows = confFiltered();
  if(!rows.length) return;
  var w = window.open('', '_blank');
  if(!w){ alert('Please allow pop-ups for this site to save the PDF.'); return; }
  w.document.open();
  w.document.write(confBuildPrintDoc(rows));
  w.document.close();
}

/* Download one signatory's certificate (no cover, single page) */
function confPrintOne(id){
  var rec = confRecords.filter(function(r){return String(r.id)===String(id);})[0];
  if(!rec) return;
  var w = window.open('', '_blank');
  if(!w){ alert('Please allow pop-ups for this site to save the PDF.'); return; }
  w.document.open();
  w.document.write(confBuildPrintDoc([rec], false));
  w.document.close();
}

/* wire up controls (elements are in the static panel markup) */
(function(){
  var csv = document.getElementById('conf-csv-btn');
  var pdf = document.getElementById('conf-pdf-btn');
  var ver = document.getElementById('conf-version');
  var listEl = document.getElementById('conf-list');
  if(csv) csv.addEventListener('click', confDownloadCsv);
  if(pdf) pdf.addEventListener('click', confPrint);
  if(ver) ver.addEventListener('change', confRenderList);
  if(listEl) listEl.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('[data-print-id]') : null;
    if(b) confPrintOne(b.getAttribute('data-print-id'));
  });
})();


/* ══ Sidebar drawer (mobile) ══ */
(function(){
  var sidebar  = document.getElementById('admin-sidebar');
  var backdrop = document.getElementById('sidebar-backdrop');
  var toggle   = document.getElementById('sidebar-toggle');
  var navEl    = document.getElementById('sidebar-nav');
  if(!sidebar) return;
  function openNav(){ sidebar.classList.add('open'); if(backdrop) backdrop.classList.add('show'); if(toggle) toggle.setAttribute('aria-expanded','true'); }
  function closeNav(){ sidebar.classList.remove('open'); if(backdrop) backdrop.classList.remove('show'); if(toggle) toggle.setAttribute('aria-expanded','false'); }
  if(toggle) toggle.addEventListener('click', function(){ sidebar.classList.contains('open') ? closeNav() : openNav(); });
  if(backdrop) backdrop.addEventListener('click', closeNav);
  if(navEl) navEl.addEventListener('click', function(e){ if(e.target.closest && e.target.closest('.nav-tab')) closeNav(); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeNav(); });
})();

/* fantasy: player-values search */
(function(){
  var s = document.getElementById('fv-search');
  if (s) s.addEventListener('input', fvApplyFilter);
})();

/* Fantasy value only applies to the senior squad — reflect that in the editor. */
function syncFantasyValueField() {
  var squadEl = document.getElementById('player-squad');
  var fvEl    = document.getElementById('player-fantasy-value');
  var noteEl  = document.getElementById('player-fantasy-note');
  if (!squadEl || !fvEl) return;
  var youth = squadEl.value === 'youth';
  fvEl.disabled = youth;
  fvEl.style.opacity = youth ? '0.45' : '';
  if (noteEl) noteEl.style.display = youth ? 'block' : 'none';
}
(function(){
  var s = document.getElementById('player-squad');
  if (s) s.addEventListener('change', syncFantasyValueField);
})();

/* ══════════════════════════════════════════════════════
   CALENDAR
   Aggregates fixtures, training sessions, club events and
   player birthdays. Birthdays are derived server-side from
   players.dob — that column is NOT readable with the public
   anon key, and calendar.feed is JWT-gated, so no birth date
   ever reaches a public browser.
══════════════════════════════════════════════════════ */
var calCursor   = (function(){ var d = new Date(); d.setDate(1); return d; })();
var calItems    = [];
var calEditing  = null;   // event id while editing, null while creating
var calSelected = null;   // currently selected day (ISO)

var CAL_KIND_LABEL = { fixture:'Fixture', training:'Training', event:'Event', birthday:'Birthday' };

function calISO(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function calRange(){
  var y = calCursor.getFullYear(), m = calCursor.getMonth();
  return { from: calISO(new Date(y, m, 1)), to: calISO(new Date(y, m+1, 0)) };
}
function calLayers(){
  function g(id){ var el = document.getElementById(id); return el ? el.checked : true; }
  return { fixture:g('cal-l-fixture'), training:g('cal-l-training'), event:g('cal-l-event'), birthday:g('cal-l-birthday') };
}
function calCanEdit(){
  return ['super','content','scores','fixtures'].indexOf(SESSION_ROLE) >= 0;
}
function calPrettyDate(iso){
  var p = String(iso).split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return d.toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

/* Today's birthdays — mirrors the daily email nudge, so an admin can still
   post if that email gets buried. Same wa.me link, same message. */
async function loadTodayBirthdays(){
  var strip = document.getElementById('cal-bday-strip');
  if (!strip) return;
  try {
    var res    = await adminAPI('birthday.today', {});
    var people = (res && res.people) || [];
    if (!people.length) { strip.style.display = 'none'; return; }
    document.getElementById('cal-bday-names').textContent =
      people.map(function(p){ return p.name + ' (turns ' + p.age + ')'; }).join(', ');
    document.getElementById('cal-bday-send').style.display = '';
    document.getElementById('cal-bday-send').href =
      'https://wa.me/?text=' + encodeURIComponent(res.message || '');
    strip.style.display = 'flex';
    prepareBirthdayCard(people.map(function(p){ return p.name; }));
  } catch (e) {
    // Show the reason rather than hiding — a failed call and "no birthdays
    // today" must not look identical.
    document.getElementById('cal-bday-names').textContent = 'Birthday check failed: ' + e.message;
    document.getElementById('cal-bday-send').style.display = 'none';
    var gw = document.getElementById('cal-bday-graphic'); if (gw) gw.style.display = 'none';
    strip.style.display = 'flex';
  }
}

async function loadCalendar(){
  var grid = document.getElementById('cal-grid');
  if (!grid) return;
  var newBtn = document.getElementById('cal-new-btn');
  if (newBtn) newBtn.style.display = calCanEdit() ? '' : 'none';

  var lbl = document.getElementById('cal-month-label');
  if (lbl) lbl.textContent = calCursor.toLocaleDateString('en-ZA', { month:'long', year:'numeric' });

  loadTodayBirthdays();

  var r = calRange();
  grid.innerHTML = '<div class="mx-empty">Loading\u2026</div>';
  try {
    var res = await adminAPI('calendar.feed', { from: r.from, to: r.to });
    calItems = (res && res.items) || [];
  } catch (e) {
    grid.innerHTML = '<div class="mx-empty">' + esc(e.message) + '</div>';
    return;
  }
  renderCalendar();
}

function calMetric(label, val){
  return '<div class="mx-metric"><div class="mx-metric-value">' + val + '</div>'
       + '<div class="mx-metric-label">' + esc(label) + '</div></div>';
}

function renderCalendar(){
  var grid = document.getElementById('cal-grid');
  if (!grid) return;

  var layers  = calLayers();
  var visible = calItems.filter(function(it){ return layers[it.kind]; });

  var counts = { fixture:0, training:0, event:0, birthday:0 };
  calItems.forEach(function(it){ if (counts[it.kind] !== undefined) counts[it.kind]++; });
  var mEl = document.getElementById('cal-metrics');
  if (mEl) {
    mEl.innerHTML = calMetric('Fixtures', counts.fixture)
                  + calMetric('Training', counts.training)
                  + calMetric('Events', counts.event)
                  + calMetric('Birthdays', counts.birthday);
  }

  var byDate = {};
  visible.forEach(function(it){ (byDate[it.date] = byDate[it.date] || []).push(it); });

  var y = calCursor.getFullYear(), m = calCursor.getMonth();
  var startOffset = (new Date(y, m, 1).getDay() + 6) % 7;   // Monday-first weeks
  var daysInMonth = new Date(y, m + 1, 0).getDate();
  var todayISO    = calISO(new Date());

  var html = '';
  for (var i = 0; i < startOffset; i++) html += '<div class="cal-cell cal-cell-muted"></div>';
  for (var d = 1; d <= daysInMonth; d++) {
    var iso   = y + '-' + String(m+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var items = byDate[iso] || [];
    html += '<div class="cal-cell' + (iso === todayISO ? ' cal-today' : '')
          +   (iso === calSelected ? ' cal-cell-sel' : '') + '" data-date="' + iso + '">'
          +   '<div class="cal-daynum">' + d + '</div>'
          +   '<div class="cal-chips">'
          +     items.slice(0, 3).map(function(it){
                  return '<div class="cal-chip cal-chip-' + esc(it.kind) + '">' + esc(it.title) + '</div>';
                }).join('')
          +     (items.length > 3 ? '<div class="cal-more">+' + (items.length - 3) + ' more</div>' : '')
          +   '</div>'
          + '</div>';
  }
  grid.innerHTML = html;
  if (calSelected) calShowDay(calSelected);
}

function calShowDay(iso){
  calSelected = iso;
  var panel = document.getElementById('cal-day-panel');
  var list  = document.getElementById('cal-day-list');
  var title = document.getElementById('cal-day-title');
  if (!panel || !list) return;

  var layers = calLayers();
  var items  = calItems.filter(function(it){ return it.date === iso && layers[it.kind]; });
  if (title) title.textContent = calPrettyDate(iso);

  if (!items.length) {
    list.innerHTML = '<div class="mx-empty">Nothing scheduled.</div>';
  } else {
    list.innerHTML = items.map(function(it){
      var meta = [ CAL_KIND_LABEL[it.kind] || it.kind ];
      if (it.kind === 'birthday' && it.meta) meta.push('turns ' + it.meta);
      if (it.start_time) meta.push(String(it.start_time).slice(0,5));
      if (it.venue) meta.push(it.venue);
      if (it.kind === 'event' && it.is_public) meta.push('public');
      if (it.kind === 'fixture' && it.meta) meta.push(it.meta);
      return '<div class="cal-day-item">'
           +   '<span class="cal-dot cal-dot-' + esc(it.kind) + '" style="margin-top:6px"></span>'
           +   '<div class="cal-day-item-main">'
           +     '<div class="cal-day-item-title">' + esc(it.title) + '</div>'
           +     '<div class="cal-day-item-meta">' + esc(meta.join(' \u00b7 ')) + '</div>'
           +   '</div>'
           +   (it.kind === 'event' && calCanEdit()
                 ? '<button class="mx-btn mx-btn-sm mx-btn-ghost cal-day-edit" data-edit-id="' + esc(it.id) + '">Edit</button>'
                 : '')
           + '</div>';
    }).join('');
  }
  panel.style.display = 'block';
}

/* ── Event editor ─────────────────────────────────────── */
function calOpenEditor(ev, dateISO){
  if (!calCanEdit()) return;
  var g = function(id){ return document.getElementById(id); };
  calEditing = ev ? ev.id : null;
  g('cal-modal-title').textContent = ev ? 'Edit event' : 'New event';
  g('cal-f-title').value  = ev ? (ev.title || '') : '';
  g('cal-f-date').value   = ev ? ev.date : (dateISO || calISO(new Date()));
  g('cal-f-type').value   = ev ? (ev.meta || 'other') : 'other';
  g('cal-f-start').value  = ev && ev.start_time ? String(ev.start_time).slice(0,5) : '';
  g('cal-f-end').value    = ev && ev.end_time   ? String(ev.end_time).slice(0,5)   : '';
  g('cal-f-venue').value  = ev ? (ev.venue || '') : '';
  g('cal-f-desc').value   = ev ? (ev.description || '') : '';
  g('cal-f-public').checked = ev ? !!ev.is_public : false;
  setCalImage(ev && ev.image_url ? ev.image_url : '', ev && ev.image_pos ? ev.image_pos : '50% 50%');
  g('cal-delete-btn').style.display = ev ? '' : 'none';
  var err = g('cal-form-err'); err.style.display = 'none'; err.textContent = '';
  g('cal-event-modal').style.display = 'flex';
  setTimeout(function(){ g('cal-f-title').focus(); }, 40);
}

function calCloseEditor(){
  var m = document.getElementById('cal-event-modal');
  if (m) m.style.display = 'none';
  calEditing = null;
}

async function calSaveEvent(){
  var g   = function(id){ return document.getElementById(id); };
  var err = g('cal-form-err');
  var data = {
    title:       g('cal-f-title').value,
    start_date:  g('cal-f-date').value,
    event_type:  g('cal-f-type').value,
    start_time:  g('cal-f-start').value || null,
    end_time:    g('cal-f-end').value || null,
    venue:       g('cal-f-venue').value,
    description: g('cal-f-desc').value,
    is_public:   g('cal-f-public').checked,
    image_url:   g('cal-f-image').value || null,
    image_pos:   g('cal-f-image-pos').value || '50% 50%'
  };
  if (!String(data.title).trim() || !data.start_date) {
    err.textContent = 'A title and a date are required.';
    err.style.display = 'block';
    return;
  }
  var btn = g('cal-save-btn');
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    if (calEditing) { data.id = calEditing; await adminAPI('events.update', { data: data }); }
    else            { await adminAPI('events.insert', { data: data }); }
    calCloseEditor();
    await loadCalendar();
  } catch (e) {
    err.textContent = e.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Save event';
  }
}

function calDeleteEvent(){
  if (!calEditing) return;
  var id = calEditing;
  confirmModal('Delete this event?', 'This removes it from the calendar and cannot be undone.', async function(){
    try { await adminAPI('events.delete', { id: id }); calCloseEditor(); await loadCalendar(); }
    catch (e) { alert(e.message); }
  });
}

function calNormPos(p){
  var m = /^(\d{1,3})% (\d{1,3})%$/.exec(String(p || ''));
  if (!m) return '50% 50%';
  var clamp = function(n){ return Math.max(0, Math.min(100, n)); };
  return clamp(+m[1]) + '% ' + clamp(+m[2]) + '%';
}
function setCalImage(url, pos){
  var hid  = document.getElementById('cal-f-image');
  var hpos = document.getElementById('cal-f-image-pos');
  var img  = document.getElementById('cal-img-thumb');
  var emp  = document.getElementById('cal-img-empty');
  var rm   = document.getElementById('cal-img-remove-btn');
  var ctr  = document.getElementById('cal-img-center-btn');
  var hint = document.getElementById('cal-img-hint');
  var prev = document.getElementById('cal-img-preview');
  if (!hid) return;
  hid.value = url || '';
  var p = calNormPos(pos);
  if (hpos) hpos.value = p;
  if (url) {
    img.src = url; img.style.display = 'block'; img.style.objectPosition = p;
    emp.style.display = 'none'; rm.style.display = ''; if (ctr) ctr.style.display = '';
    if (hint) hint.style.display = ''; if (prev) prev.classList.add('has-img');
  } else {
    img.removeAttribute('src'); img.style.display = 'none'; img.style.objectPosition = '50% 50%';
    emp.style.display = ''; rm.style.display = 'none'; if (ctr) ctr.style.display = 'none';
    if (hint) hint.style.display = 'none'; if (prev) prev.classList.remove('has-img');
  }
}

/* ── Wiring ───────────────────────────────────────────── */
(function calInit(){
  var g = function(id){ return document.getElementById(id); };
  if (!g('cal-grid')) return;

  function jump(delta){
    calCursor.setMonth(calCursor.getMonth() + delta);
    calSelected = null;
    var p = g('cal-day-panel'); if (p) p.style.display = 'none';
    loadCalendar();
  }
  g('cal-prev').addEventListener('click', function(){ jump(-1); });
  g('cal-next').addEventListener('click', function(){ jump(1); });
  g('cal-today').addEventListener('click', function(){
    var d = new Date(); d.setDate(1);
    calCursor = d; calSelected = calISO(new Date());
    loadCalendar();
  });

  ['cal-l-fixture','cal-l-training','cal-l-event','cal-l-birthday'].forEach(function(id){
    var el = g(id); if (el) el.addEventListener('change', renderCalendar);
  });

  g('cal-new-btn').addEventListener('click', function(){ calOpenEditor(null, calSelected); });

  g('cal-grid').addEventListener('click', function(e){
    var cell = e.target.closest ? e.target.closest('.cal-cell[data-date]') : null;
    if (cell) calShowDay(cell.dataset.date);
  });

  g('cal-day-list').addEventListener('click', function(e){
    var btn = e.target.closest ? e.target.closest('[data-edit-id]') : null;
    if (!btn) return;
    var ev = calItems.filter(function(it){
      return it.kind === 'event' && String(it.id) === btn.dataset.editId;
    })[0];
    if (ev) calOpenEditor(ev);
  });

  var dayClose = g('cal-day-close');
  if (dayClose) dayClose.addEventListener('click', function(){
    g('cal-day-panel').style.display = 'none';
    calSelected = null;
  });

  // Drag the poster preview to set its focal point (object-position). Only the
  // axis the 16:9 crop actually overflows will move, which is the intuitive result.
  (function(){
    var prev = g('cal-img-preview'), img = g('cal-img-thumb'), hpos = g('cal-f-image-pos');
    if (!prev || !img || !hpos) return;
    var dragging = false, sx = 0, sy = 0, px = 50, py = 50;
    var pt = function(e){ return e.touches && e.touches[0] ? e.touches[0] : e; };
    function start(e){
      if (!prev.classList.contains('has-img')) return;
      var m = /^(\d{1,3})% (\d{1,3})%$/.exec(hpos.value || '50% 50%');
      px = m ? +m[1] : 50; py = m ? +m[2] : 50;
      var p = pt(e); sx = p.clientX; sy = p.clientY;
      dragging = true; prev.classList.add('dragging'); e.preventDefault();
    }
    function move(e){
      if (!dragging) return;
      var p = pt(e), r = prev.getBoundingClientRect();
      var nx = Math.max(0, Math.min(100, px - (p.clientX - sx) / r.width  * 100));
      var ny = Math.max(0, Math.min(100, py - (p.clientY - sy) / r.height * 100));
      var val = Math.round(nx) + '% ' + Math.round(ny) + '%';
      img.style.objectPosition = val; hpos.value = val; e.preventDefault();
    }
    function end(){ dragging = false; prev.classList.remove('dragging'); }
    prev.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    prev.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
  })();
  var centerBtn = g('cal-img-center-btn');
  if (centerBtn) centerBtn.addEventListener('click', function(){
    g('cal-f-image-pos').value = '50% 50%';
    g('cal-img-thumb').style.objectPosition = '50% 50%';
  });

  g('cal-img-upload-btn').addEventListener('click', function(){ g('cal-f-image-file').click(); });
  g('cal-img-remove-btn').addEventListener('click', function(){ setCalImage(''); });
  g('cal-f-image-file').addEventListener('change', async function(){
    var file = this.files[0];
    if (!file) return;
    var status = g('cal-img-status');
    if (file.size > 5 * 1024 * 1024) {
      status.textContent = 'Image must be under 5MB.'; status.style.color = '#f3aeae';
      this.value = ''; return;
    }
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    status.textContent = 'Uploading\u2026'; status.style.color = 'var(--muted)';
    try {
      var base64 = await new Promise(function(resolve, reject){
        var reader = new FileReader();
        reader.onload = function(){ resolve(reader.result.split(',')[1]); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      var res = await adminAPI('storage.uploadEvent', {
        fileName: Date.now() + '.' + ext, contentType: file.type, base64: base64
      });
      if (!res || !res.url) throw new Error('Upload failed');
      setCalImage(res.url);
      status.textContent = 'Uploaded'; status.style.color = '#5ec98a';
      setTimeout(function(){ status.textContent = ''; }, 3000);
    } catch (e) {
      status.textContent = e.message; status.style.color = '#f3aeae';
    } finally { this.value = ''; }
  });

  var thumbStrip = g('cal-bday-thumbs');
  if (thumbStrip) thumbStrip.addEventListener('click', function(e){
    var im = e.target.closest('.cal-bday-thumb');
    if (!im) return;
    var card = bdayCards[Number(im.dataset.idx) || 0];
    if (!card) return;
    g('cal-card-full').src = URL.createObjectURL(card.blob);
    g('cal-card-modal').style.display = 'flex';
  });
  var cardClose = g('cal-card-close');
  if (cardClose) cardClose.addEventListener('click', function(){
    g('cal-card-modal').style.display = 'none';
  });
  var cardModal = g('cal-card-modal');
  if (cardModal) cardModal.addEventListener('click', function(e){
    if (e.target === this) this.style.display = 'none';
  });

  var bgBtn = g('cal-bday-graphic-btn');
  if (bgBtn) bgBtn.addEventListener('click', shareBirthdayCard);

  g('cal-save-btn').addEventListener('click', calSaveEvent);
  g('cal-cancel-btn').addEventListener('click', calCloseEditor);
  g('cal-delete-btn').addEventListener('click', calDeleteEvent);
  g('cal-event-modal').addEventListener('click', function(e){ if (e.target === this) calCloseEditor(); });
  document.addEventListener('keydown', function(e){
    var m = g('cal-event-modal');
    if (e.key === 'Escape' && m && m.style.display === 'flex') calCloseEditor();
  });
})();

/* ══════════════════════════════════════════════════════
   BIRTHDAY GRAPHIC
   A typographic card drawn on canvas — deliberately no player
   photos: uploads vary wildly in crop and quality, and a photo
   card would also need the media_consent gate for minors.
   Pre-generated when the strip loads, because iOS requires
   navigator.share() to fire inside the user gesture.
══════════════════════════════════════════════════════ */
var bdayBlob = null;      // first card, for the enlarge preview
var bdayCards = [];       // [{ name, blob }] — one per person
var bdayNames = [];

/* Seeded so the same day always produces the same card — regenerating
   doesn't reshuffle the confetti. */
function bdayRand(seed){
  var a = 0;
  for (var i = 0; i < seed.length; i++) a = (a + seed.charCodeAt(i) * (i + 13)) >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* Confetti kept out of the central text band so nothing sits behind the names. */
function bdayConfetti(x, S, rand){
  var cols = ['#c9a84c', '#e8c96a', '#f2ede3', '#8f7430', '#d9b95f'];
  var placed = 0, tries = 0;
  while (placed < 78 && tries < 900) {
    tries++;
    var px = rand() * S, py = rand() * S;
    if (py > S * 0.28 && py < S * 0.80 && px > S * 0.08 && px < S * 0.92) continue;
    if (px < 18 || px > S - 18 || py < 18 || py > S - 18) continue;
    placed++;
    x.save();
    x.translate(px, py);
    x.rotate(rand() * Math.PI * 2);
    x.globalAlpha = 0.30 + rand() * 0.55;
    x.fillStyle = cols[(rand() * cols.length) | 0];
    var kind = rand();
    if (kind < 0.45) {
      var w = 7 + rand() * 11, h = 3 + rand() * 5;
      x.fillRect(-w/2, -h/2, w, h);
    } else if (kind < 0.75) {
      x.beginPath(); x.arc(0, 0, 2.2 + rand() * 3.4, 0, Math.PI * 2); x.fill();
    } else {
      x.strokeStyle = x.fillStyle;
      x.lineWidth = 2.2; x.lineCap = 'round';
      x.beginPath();
      x.moveTo(-7, 0);
      x.quadraticCurveTo(-2, -7, 2, 0);
      x.quadraticCurveTo(6, 7, 10, 0);
      x.stroke();
    }
    x.restore();
  }
  x.globalAlpha = 1;
}

/* Line-art cake in gold — matches the card rather than fighting it. */
function bdayCake(x, cx, cy, s){
  x.save();
  x.translate(cx, cy);
  x.scale(s, s);
  x.lineWidth = 3.2; x.lineJoin = 'round'; x.lineCap = 'round';
  x.strokeStyle = '#c9a84c';

  x.beginPath(); x.moveTo(-64, 44); x.lineTo(64, 44); x.stroke();            // plate
  x.beginPath();                                                             // body
  x.moveTo(-46, 44); x.lineTo(-46, -4); x.lineTo(46, -4); x.lineTo(46, 44);
  x.stroke();
  x.beginPath();                                                             // icing
  x.moveTo(-46, -4);
  x.quadraticCurveTo(-34, -17, -23, -4);
  x.quadraticCurveTo(-11, -17,   0, -4);
  x.quadraticCurveTo( 11, -17,  23, -4);
  x.quadraticCurveTo( 34, -17,  46, -4);
  x.stroke();
  x.globalAlpha = 0.55;
  x.beginPath(); x.moveTo(-46, 22); x.lineTo(46, 22); x.stroke();            // band
  x.globalAlpha = 1;

  [-23, 0, 23].forEach(function(px){                                         // candles
    x.beginPath(); x.moveTo(px, -8); x.lineTo(px, -38); x.stroke();
    x.beginPath();
    x.moveTo(px, -52);
    x.quadraticCurveTo(px + 8, -44, px, -34);
    x.quadraticCurveTo(px - 8, -44, px, -52);
    x.fillStyle = '#e8c96a';
    x.fill();
  });
  x.restore();
}

function bdayLoadImg(src){
  return new Promise(function(resolve, reject){
    var im = new Image();
    im.onload  = function(){ resolve(im); };
    im.onerror = reject;
    im.src = src;
  });
}

function bdayFitFont(x, text, maxW, startPx, minPx){
  var size = startPx;
  while (size > minPx) {
    x.font = '400 ' + size + 'px "Anton", sans-serif';
    if (x.measureText(text).width <= maxW) break;
    size -= 4;
  }
  return size;
}

async function buildBirthdayCard(names){
  var S = 1080;
  var c = document.createElement('canvas');
  c.width = S; c.height = S;
  var x = c.getContext('2d');

  // Fonts must be resolved before drawing or canvas falls back to a system face.
  try {
    await Promise.all([
      document.fonts.load('400 150px "Anton"'),
      document.fonts.load('500 34px "DM Sans"'),
      document.fonts.load('400 36px "DM Sans"'),
      document.fonts.load('italic 400 32px "DM Serif Display"')
    ]);
    if (document.fonts.ready) await document.fonts.ready;
  } catch (e) { /* proceed with fallbacks */ }
  // If Anton still isn't resolvable the card would silently fall back to a
  // system sans, so surface that rather than shipping a wrong-looking card.
  if (document.fonts && document.fonts.check && !document.fonts.check('150px Anton')) {
    console.warn('[TCC] Anton not available to canvas — card will use a fallback face.');
  }

  // Background + gold glow
  x.fillStyle = '#111110';
  x.fillRect(0, 0, S, S);
  var g = x.createRadialGradient(S/2, S*0.40, 40, S/2, S*0.40, S*0.66);
  g.addColorStop(0, 'rgba(201,168,76,0.17)');
  g.addColorStop(1, 'rgba(201,168,76,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);

  // Confetti (behind the frame, outside the text band)
  bdayConfetti(x, S, bdayRand(names.join('|') + '#' + new Date().toDateString()));

  // Double frame
  x.strokeStyle = 'rgba(201,168,76,0.55)'; x.lineWidth = 3;
  x.strokeRect(46, 46, S - 92, S - 92);
  x.strokeStyle = 'rgba(201,168,76,0.20)'; x.lineWidth = 1;
  x.strokeRect(64, 64, S - 128, S - 128);

  x.textAlign = 'center';

  // Crest
  var y = 150;
  try {
    var img = await bdayLoadImg('images/tcc-logo.png');
    var lw = 148, lh = img.height * (lw / img.width);
    x.drawImage(img, (S - lw) / 2, y, lw, lh);
    y += lh + 58;
  } catch (e) { y += 40; }

  // "HAPPY BIRTHDAY"
  x.fillStyle = '#c9a84c';
  x.font = '500 34px "DM Sans", sans-serif';
  if ('letterSpacing' in x) x.letterSpacing = '13px';
  x.fillText('HAPPY BIRTHDAY', S/2, y);
  if ('letterSpacing' in x) x.letterSpacing = '0px';
  y += 30;

  // One card per person, so the name always gets the full display size.
  x.fillStyle = '#f2ede3';
  var nameText = String(names[0] || '').toUpperCase();
  var px = bdayFitFont(x, nameText, S - 200, 150, 44);
  y += px * 0.86;
  x.fillText(nameText, S/2, y);
  y += 12;

  // Birthday wish — sized to fit, and clamped above the footer block so a
  // card with four names can never push it into the divider.
  var wish = 'Wishing you a wonderful day';
  x.fillStyle = 'rgba(242,237,227,0.82)';
  var wishPx = 36;
  x.font = '400 ' + wishPx + 'px "DM Sans", sans-serif';
  while (wishPx > 22 && x.measureText(wish).width > S - 220) {
    wishPx -= 2;
    x.font = '400 ' + wishPx + 'px "DM Sans", sans-serif';
  }
  y = Math.min(y + 62, S - 272);
  x.fillText(wish, S/2, y);

  // Cake — only drawn when the wish line leaves enough clearance above the
  // footer, so a crowded four-name card simply skips it.
  var gap = (S - 232) - y;
  if (gap >= 118) {
    var cs = Math.min(0.92, (gap - 34) / 150);
    bdayCake(x, S/2, y + gap * 0.52, cs);
  }

  // Footer
  x.strokeStyle = 'rgba(201,168,76,0.35)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(S/2 - 110, S - 232); x.lineTo(S/2 + 110, S - 232); x.stroke();

  x.fillStyle = '#f2ede3';
  x.font = '500 30px "DM Sans", sans-serif';
  if ('letterSpacing' in x) x.letterSpacing = '8px';
  x.fillText('TYGERBERG CRICKET CLUB', S/2, S - 176);
  if ('letterSpacing' in x) x.letterSpacing = '0px';

  x.fillStyle = '#c9a84c';
  x.font = 'italic 400 32px "DM Serif Display", Georgia, serif';
  x.fillText('Facta Non Verba', S/2, S - 124);

  return new Promise(function(resolve){
    c.toBlob(function(b){ resolve(b); }, 'image/png');
  });
}

/* One card per person rather than a shared card. Everyone gets their own
   name at full size, which is the point of the graphic — a card with four
   names on it is a list, not a birthday card. */
async function prepareBirthdayCard(names){
  bdayNames = names || [];
  bdayCards = [];
  bdayBlob  = null;
  var wrap  = document.getElementById('cal-bday-graphic');
  var strip = document.getElementById('cal-bday-thumbs');
  if (!wrap) return;
  try {
    for (var i = 0; i < bdayNames.length; i++) {
      var blob = await buildBirthdayCard([bdayNames[i]]);
      if (blob) bdayCards.push({ name: bdayNames[i], blob: blob });
    }
    if (!bdayCards.length) throw new Error('Could not render card');
    bdayBlob = bdayCards[0].blob;   // kept for the enlarge preview

    if (strip) {
      strip.innerHTML = '';
      bdayCards.forEach(function (c, idx) {
        var im = document.createElement('img');
        im.className = 'cal-bday-thumb';
        im.src = URL.createObjectURL(c.blob);
        im.alt = c.name + ' birthday card';
        im.title = 'Tap to enlarge — ' + c.name;
        im.dataset.idx = idx;
        strip.appendChild(im);
      });
    }
    wrap.style.display = '';

    var btn = document.getElementById('cal-bday-graphic-btn');
    var canShareFiles = !!(navigator.canShare && window.File &&
      navigator.canShare({ files: bdayCards.map(function (c) {
        return new File([c.blob], 'x.png', { type: 'image/png' });
      }) }));
    var many = bdayCards.length > 1;
    btn.textContent = canShareFiles
      ? (many ? 'Share ' + bdayCards.length + ' cards' : 'Share graphic')
      : (many ? 'Download ' + bdayCards.length + ' cards' : 'Download graphic');
  } catch (e) {
    wrap.style.display = 'none';   // text link still works
  }
}

function bdaySlug(name){
  return String(name || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function shareBirthdayCard(){
  if (!bdayCards.length) return;
  var files = bdayCards.map(function (c) {
    return new File([c.blob], 'tcc-birthday-' + bdaySlug(c.name) + '.png', { type: 'image/png' });
  });
  var msg = document.getElementById('cal-bday-send').href;
  msg = decodeURIComponent(String(msg).replace('https://wa.me/?text=', ''));

  /* The share sheet takes several files at once, so all of the day's cards
     go into one WhatsApp message rather than needing a send each. */
  if (navigator.canShare && navigator.canShare({ files: files })) {
    try { await navigator.share({ files: files, text: msg }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  /* Some browsers allow one file but not several — fall back to one at a time. */
  if (files.length > 1 && navigator.canShare && navigator.canShare({ files: [files[0]] })) {
    for (var i = 0; i < files.length; i++) {
      try { await navigator.share({ files: [files[i]], text: i === 0 ? msg : '' }); }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    return;
  }
  // Desktop / unsupported: download each, then attach manually
  files.forEach(function (f, i) {
    setTimeout(function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }, i * 250);   // stagger or the browser blocks the later downloads
  });
}

/* ══════════════════════════════════════════════════════
   TIMESHEET
   Anyone with a login logs their own hours; finance and chair approve
   and run payment. The server decides whose hours are whose from the
   JWT, so nothing here can be trusted into writing someone else's.
══════════════════════════════════════════════════════ */
var tsMe          = null;    // { worker, canApprove }
var tsMine        = [];
var tsReview      = [];
var tsWorkers     = [];
var tsPay         = null;
var tsEditingId   = null;
var tsEditingWorker = null;

function tsMoney(n)  { return 'R' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
function tsMonth(period) {
  var p = String(period || '').split('-');
  if (p.length < 2) return period || '';
  return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
}
function tsIsMonthly() { return !!(tsMe && tsMe.worker && tsMe.worker.pay_type === 'monthly'); }
function tsHours(n)  { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
function tsDate(iso) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return iso || '';
  var d = new Date(+p[0], +p[1] - 1, +p[2]);
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}
function tsDay(iso) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return '';
  return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-ZA', { weekday: 'short' });
}
/* Default range: the current month to date — what a payment run usually covers. */
function tsMonthStart() {
  var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
}
function tsToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

var TS_STATUS = {
  draft:     { label: 'Draft',     cls: 'ts-s-draft' },
  submitted: { label: 'Submitted', cls: 'ts-s-sub' },
  approved:  { label: 'Approved',  cls: 'ts-s-ok' },
  rejected:  { label: 'Rejected',  cls: 'ts-s-rej' },
  paid:      { label: 'Paid',      cls: 'ts-s-paid' }
};

/* ── entry point ─────────────────────────────────────── */
async function loadTimesheet() {
  var from = document.getElementById('ts-from');
  var to   = document.getElementById('ts-to');
  if (from && !from.value) from.value = tsMonthStart();
  if (to   && !to.value)   to.value   = tsToday();
  var pf = document.getElementById('ts-pay-from');
  var pt = document.getElementById('ts-pay-to');
  if (pf && !pf.value) pf.value = tsMonthStart();
  if (pt && !pt.value) pt.value = tsToday();

  try {
    tsMe = await adminAPI('timesheet.me', {});
  } catch (e) {
    tsMe = { worker: null, canApprove: false };
  }

  var notWorker = document.getElementById('ts-not-worker');
  var newBtn    = document.getElementById('ts-new-btn');
  if (notWorker) notWorker.style.display = tsMe.worker ? 'none' : '';
  if (newBtn)    newBtn.style.display    = tsMe.worker ? '' : 'none';

  /* Approver-only tabs */
  ['review', 'pay', 'people'].forEach(function (k) {
    var b = document.querySelector('.ts-tab[data-ts="' + k + '"]');
    if (b) b.style.display = tsMe.canApprove ? '' : 'none';
  });

  await loadTsMine();
  if (tsMe.canApprove) await loadTsReview();
  renderTsMetrics();
}

function renderTsMetrics() {
  var el = document.getElementById('ts-metrics');
  if (!el) return;
  var mine = tsMine || [];
  var sum = function (pred) {
    return mine.filter(pred).reduce(function (s, e) { return s + (Number(e.hours) || 0); }, 0);
  };
  var card = function (v, l) {
    return '<div class="mx-metric"><div class="mx-metric-value">' + v +
           '</div><div class="mx-metric-label">' + esc(l) + '</div></div>';
  };
  var html = card(tsHours(sum(function (e) { return e.status === 'draft'; })), 'Draft hours')
           + card(tsHours(sum(function (e) { return e.status === 'submitted'; })), 'Awaiting approval')
           + card(tsHours(sum(function (e) { return e.status === 'approved'; })), 'Approved')
           + card(tsHours(sum(function (e) { return e.status === 'paid'; })), 'Paid');
  if (tsMe && tsMe.canApprove) {
    html += card((tsReview || []).length, 'To approve');
  }
  el.innerHTML = html;
}

/* ── My hours ────────────────────────────────────────── */
async function loadTsMine() {
  var list = document.getElementById('ts-mine-list');
  if (!list) return;
  if (!tsMe || !tsMe.worker) { list.innerHTML = ''; return; }
  list.innerHTML = '<div class="mx-empty">Loading\u2026</div>';
  try {
    tsMine = await adminAPI('timesheet.myEntries', {
      from: document.getElementById('ts-from').value,
      to:   document.getElementById('ts-to').value
    }) || [];
  } catch (e) {
    list.innerHTML = '<div class="mx-empty">' + esc(e.message) + '</div>';
    return;
  }
  if (!tsMine.length) {
    list.innerHTML = '<div class="mx-empty">No hours logged in this period.</div>';
    renderTsMetrics();
    return;
  }
  list.innerHTML = tsMine.map(function (e) {
    var s = TS_STATUS[e.status] || TS_STATUS.draft;
    var editable = e.status === 'draft' || e.status === 'rejected';
    var times = (e.start_time && e.end_time)
      ? String(e.start_time).slice(0, 5) + '\u2013' + String(e.end_time).slice(0, 5)
        + (e.break_minutes ? ' less ' + e.break_minutes + 'min' : '')
      : '';
    return '<div class="ts-row' + (editable ? ' ts-row-edit' : '') + '"'
      + (editable ? ' data-ts-edit="' + esc(e.id) + '"' : '') + '>'
      + '<span class="ts-date"><b>' + esc(tsDate(e.work_date)) + '</b>'
      +   '<small>' + esc(tsDay(e.work_date)) + '</small></span>'
      + '<span class="ts-mid">'
      +   '<span class="ts-notes">' + esc(e.notes || '\u2014')
      +     (e.is_extra ? ' <span class="ts-tag">Extra</span>' : '') + '</span>'
      +   (times ? '<span class="ts-times">' + esc(times) + '</span>' : '')
      +   (e.status === 'rejected' && e.reject_reason
            ? '<span class="ts-reject">Sent back: ' + esc(e.reject_reason) + '</span>' : '')
      + '</span>'
      + '<span class="ts-hrs">' + tsHours(e.hours) + '<small>hrs</small></span>'
      + '<span class="ts-status ' + s.cls + '">' + s.label + '</span>'
      + '</div>';
  }).join('');
  renderTsMetrics();
}

/* ── Approver queue ──────────────────────────────────── */
async function loadTsReview() {
  var list = document.getElementById('ts-review-list');
  if (!list) return;
  list.innerHTML = '<div class="mx-empty">Loading\u2026</div>';
  try {
    tsReview = await adminAPI('timesheet.review', { status: 'submitted' }) || [];
  } catch (e) {
    list.innerHTML = '<div class="mx-empty">' + esc(e.message) + '</div>';
    return;
  }
  var count = document.getElementById('ts-review-count');
  if (count) count.textContent = tsReview.length ? tsReview.length : '';

  if (!tsReview.length) {
    list.innerHTML = '<div class="mx-empty">Nothing waiting for approval.</div>';
    renderTsMetrics();
    return;
  }
  /* An approver's own entries are shown but cannot be ticked — the server
     refuses them anyway, so disabling here avoids a pointless round trip. */
  var myWorkerId = tsMe && tsMe.worker ? tsMe.worker.id : null;
  list.innerHTML = tsReview.map(function (e) {
    var w = e.timesheet_workers || {};
    var own = myWorkerId && w.id === myWorkerId;
    var times = (e.start_time && e.end_time)
      ? String(e.start_time).slice(0, 5) + '\u2013' + String(e.end_time).slice(0, 5) : '';
    return '<div class="ts-row">'
      + '<label class="ts-pick">'
      +   '<input type="checkbox" class="ts-chk" value="' + esc(e.id) + '"'
      +     (own ? ' disabled title="You cannot approve your own hours"' : '') + '>'
      + '</label>'
      + '<span class="ts-date"><b>' + esc(tsDate(e.work_date)) + '</b>'
      +   '<small>' + esc(tsDay(e.work_date)) + '</small></span>'
      + '<span class="ts-mid">'
      +   '<span class="ts-who">' + esc(w.name || 'Unknown')
      +     (w.job_title ? ' <em>' + esc(w.job_title) + '</em>' : '')
      +     (own ? ' <span class="ts-own">your own</span>' : '')
      +     (w.pay_type === 'monthly'
              ? (e.is_extra ? ' <span class="ts-tag">Extra \u00b7 paid hourly</span>'
                            : ' <span class="ts-tag ts-tag-quiet">Covered by fee</span>')
              : '') + '</span>'
      +   '<span class="ts-notes">' + esc(e.notes || '\u2014') + '</span>'
      +   (times ? '<span class="ts-times">' + esc(times) + '</span>' : '')
      + '</span>'
      + '<span class="ts-hrs">' + tsHours(e.hours) + '<small>hrs</small></span>'
      + '</div>';
  }).join('');
  renderTsMetrics();
}

function tsChecked() {
  return [].slice.call(document.querySelectorAll('#ts-review-list .ts-chk:checked'))
    .map(function (c) { return c.value; });
}

/* ── Payment run ─────────────────────────────────────── */
/* Two sections. Hourly: approved hours x the rate locked in at approval
   (including a monthly person's extra hours). Monthly fees: one line per
   person per calendar month, proposed at their fee. The approver can untick
   a line to leave it for a later run, or change the amount — a changed amount
   needs a reason, and the Worker keeps both figures. */
async function loadTsPay() {
  var list = document.getElementById('ts-pay-list');
  if (!list) return;
  list.innerHTML = '<div class="mx-empty">Calculating\u2026</div>';
  try {
    tsPay = await adminAPI('timesheet.summary', {
      from: document.getElementById('ts-pay-from').value,
      to:   document.getElementById('ts-pay-to').value
    });
  } catch (e) {
    tsPay = null;
    list.innerHTML = '<div class="mx-empty">' + esc(e.message) + '</div>';
    return;
  }
  var w = (tsPay && tsPay.workers) || [];
  var fees = (tsPay && tsPay.fees) || [];
  var paid = (tsPay && tsPay.feesPaid) || [];
  if (!w.length && !fees.length && !paid.length) {
    list.innerHTML = '<div class="mx-empty">Nothing to pay in this period.</div>';
    return;
  }

  var html = '';

  /* hourly */
  html += '<div class="ts-pay-section"><h4>Hourly</h4>'
        + '<span>Approved hours at the rate locked in when they were approved.</span></div>';
  if (!w.length) {
    html += '<div class="mx-empty">No approved hourly hours in this period.</div>';
  } else {
    html += '<div class="ts-pay-head"><span>Person</span><span>Entries</span><span>Hours</span><span>Amount</span></div>'
      + w.map(function (p) {
          return '<div class="ts-pay-row">'
            + '<span class="ts-who">' + esc(p.name)
            +   (p.job_title ? ' <em>' + esc(p.job_title) + '</em>' : '')
            +   (p.extra ? ' <span class="ts-tag">Extra hours</span>' : '') + '</span>'
            + '<span>' + p.entries + '</span>'
            + '<span>' + tsHours(p.hours) + '</span>'
            + '<span class="ts-amt">' + tsMoney(p.amount) + '</span>'
            + '</div>';
        }).join('')
      + '<div class="ts-pay-sub"><span>Hourly subtotal</span><span class="ts-amt">' + tsMoney(tsPay.hourlyTotal) + '</span></div>';
  }

  /* monthly fees */
  if (fees.length || paid.length) {
    html += '<div class="ts-pay-section"><h4>Monthly fees</h4>'
          + '<span>One line per month. Untick a month to leave it for a later run. '
          + 'If you change an amount, add the reason.</span></div>'
          + '<div class="ts-pay-head"><span>Person</span><span>Month</span><span>Hours logged</span><span>Amount</span></div>';
    html += fees.map(function (f, i) {
      return '<div class="ts-pay-row ts-fee-row">'
        + '<span class="ts-who"><label class="ts-fee-pick">'
        +   '<input type="checkbox" class="ts-fee-chk" data-i="' + i + '"'
        +   (f.own ? ' disabled title="Another approver must mark your own fee as paid"' : ' checked') + '>'
        +   esc(f.name) + '</label>'
        +   (f.job_title ? ' <em>' + esc(f.job_title) + '</em>' : '')
        +   (f.own ? ' <span class="ts-own">your own</span>' : '') + '</span>'
        + '<span>' + esc(tsMonth(f.period)) + '</span>'
        + '<span>' + (f.entries ? tsHours(f.hours_logged)
                                : '<span class="ts-flag" title="No approved hours logged for this month">none</span>') + '</span>'
        + '<span class="ts-amt"><input type="number" class="form-control ts-fee-amt" data-i="' + i + '"'
        +   ' min="0" step="0.01" value="' + (Math.round(f.proposed_fee * 100) / 100).toFixed(2) + '"'
        +   ' aria-label="Fee for ' + esc(f.name) + ', ' + esc(tsMonth(f.period)) + '"'
        +   (f.own ? ' disabled' : '') + '></span>'
        + '</div>'
        + '<div class="ts-fee-reason" id="ts-fee-reason-' + i + '" style="display:none">'
        +   '<input type="text" class="form-control" data-i="' + i + '" maxlength="200"'
        +   ' placeholder="Reason for changing it from ' + tsMoney(f.proposed_fee) + ', e.g. started mid-month">'
        + '</div>';
    }).join('');
    html += paid.map(function (f) {
      return '<div class="ts-pay-row ts-fee-paid">'
        + '<span class="ts-who">' + esc(f.name)
        +   (f.adjust_reason ? '<small>' + esc(f.adjust_reason) + '</small>' : '') + '</span>'
        + '<span>' + esc(tsMonth(f.period)) + '</span>'
        + '<span>' + tsHours(f.hours_logged) + '</span>'
        + '<span class="ts-amt">' + tsMoney(f.amount) + ' <span class="ts-status ts-s-paid">Paid</span></span>'
        + '</div>';
    }).join('');
  }

  html += '<div class="ts-pay-total"><span>Total to pay</span><span class="ts-amt" id="ts-pay-grand"></span></div>';
  list.innerHTML = html;
  tsPayRefresh();
}

/* The fee lines as the approver has left them: ticked, with amount and reason. */
function tsFeeLines() {
  if (!tsPay || !tsPay.fees) return [];
  return tsPay.fees.map(function (f, i) {
    var chk = document.querySelector('.ts-fee-chk[data-i="' + i + '"]');
    var amt = document.querySelector('.ts-fee-amt[data-i="' + i + '"]');
    var why = document.querySelector('#ts-fee-reason-' + i + ' input');
    var amount = Math.round((parseFloat(amt && amt.value) || 0) * 100) / 100;
    return {
      fee: f, i: i,
      on: !!(chk && chk.checked && !f.own),
      amount: amount,
      changed: amount !== Math.round(f.proposed_fee * 100) / 100,
      reason: why ? why.value.trim() : ''
    };
  });
}

function tsPayRefresh() {
  var lines = tsFeeLines();
  lines.forEach(function (l) {
    var box = document.getElementById('ts-fee-reason-' + l.i);
    if (box) box.style.display = l.on && l.changed ? '' : 'none';
  });
  var fees = lines.filter(function (l) { return l.on; })
                  .reduce(function (sum, l) { return sum + l.amount; }, 0);
  var grand = document.getElementById('ts-pay-grand');
  if (grand) grand.textContent = tsMoney(((tsPay && tsPay.hourlyTotal) || 0) + fees);
}

function tsPayCsv() {
  if (!tsPay) { showToast('Calculate a run first', 2200); return; }
  var fees = tsFeeLines().filter(function (l) { return l.on; });
  if (!(tsPay.workers || []).length && !fees.length) { showToast('Nothing to export', 2200); return; }
  var q = function (v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  var money = function (n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); };
  var rows = [['Type', 'Person', 'Job title', 'Month', 'Entries', 'Hours', 'Amount (ZAR)', 'Note', 'From', 'To']];
  var total = 0;
  (tsPay.workers || []).forEach(function (p) {
    rows.push(['Hourly', p.name, p.job_title || '', '', p.entries, tsHours(p.hours), money(p.amount),
               p.extra ? 'Includes extra hours' : '', tsPay.from, tsPay.to]);
    total += Number(p.amount) || 0;
  });
  fees.forEach(function (l) {
    rows.push(['Monthly fee', l.fee.name, l.fee.job_title || '', l.fee.period.slice(0, 7), l.fee.entries,
               tsHours(l.fee.hours_logged), money(l.amount),
               l.changed ? 'Changed from ' + money(l.fee.proposed_fee) + (l.reason ? ': ' + l.reason : '') : '',
               tsPay.from, tsPay.to]);
    total += l.amount;
  });
  rows.push(['TOTAL', '', '', '', '', '', money(total), '', '', '']);
  /* BOM so Excel reads UTF-8 rather than mangling names. */
  var csv = '\uFEFF' + rows.map(function (r) { return r.map(q).join(','); }).join('\r\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'tcc-payment-' + tsPay.from + '-to-' + tsPay.to + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

async function tsMarkPaid() {
  if (!tsPay) { showToast('Calculate a run first', 2200); return; }
  var ids = [];
  (tsPay.workers || []).forEach(function (w) { ids = ids.concat(w.ids || []); });
  var fees = tsFeeLines().filter(function (l) { return l.on; });
  if (!ids.length && !fees.length) { showToast('Nothing ticked to pay', 2200); return; }

  var missing = fees.filter(function (l) { return l.changed && !l.reason; });
  if (missing.length) {
    showToast('Add a reason for the changed fee' + (missing.length > 1 ? 's' : ''), 3000);
    var box = document.querySelector('#ts-fee-reason-' + missing[0].i + ' input');
    if (box) box.focus();
    return;
  }

  var hourlyAmt = (tsPay.workers || []).reduce(function (sum, w) { return sum + (Number(w.amount) || 0); }, 0);
  var feeAmt = fees.reduce(function (sum, l) { return sum + l.amount; }, 0);
  var parts = [];
  if (ids.length)  parts.push(tsMoney(hourlyAmt) + ' hourly (' + ids.length + ' entr' + (ids.length === 1 ? 'y' : 'ies') + ')');
  if (fees.length) parts.push(tsMoney(feeAmt) + ' in fees (' + fees.length + ' month' + (fees.length === 1 ? '' : 's') + ')');
  var batch = tsPay.from.slice(0, 7);

  confirmModal('Mark ' + tsMoney(hourlyAmt + feeAmt) + ' as paid?',
    parts.join(' and ') + '. They move to Paid and drop out of future payment runs.',
    async function () {
      /* Fees first: that insert is all-or-nothing, so a refusal (a month
         already paid elsewhere) leaves everything untouched. */
      if (fees.length) {
        try {
          await adminAPI('timesheet.markFeePaid', {
            batch: batch,
            lines: fees.map(function (l) {
              return { worker_id: l.fee.worker_id, period: l.fee.period, amount: l.amount, reason: l.reason };
            })
          });
        } catch (e) { alert(e.message + '\n\nNothing was marked as paid.'); return; }
      }
      if (ids.length) {
        try { await adminAPI('timesheet.markPaid', { ids: ids, batch: batch }); }
        catch (e) {
          alert(e.message + (fees.length ? '\n\nThe monthly fees WERE marked as paid; the hourly lines were not.' : ''));
          await loadTsPay(); return;
        }
      }
      await loadTsPay();
      showToast('Marked as paid', 2200);
    }, { label: 'Mark as paid' });
}

/* ── People & rates ──────────────────────────────────── */
async function loadTsPeople() {
  var list = document.getElementById('ts-people-list');
  if (!list) return;
  list.innerHTML = '<div class="mx-empty">Loading\u2026</div>';
  try {
    tsWorkers = await adminAPI('timesheet.workers', {}) || [];
  } catch (e) {
    list.innerHTML = '<div class="mx-empty">' + esc(e.message) + '</div>';
    return;
  }
  if (!tsWorkers.length) {
    list.innerHTML = '<div class="mx-empty">Nobody set up yet. Add the first person.</div>';
    return;
  }
  list.innerHTML = tsWorkers.map(function (w) {
    return '<div class="ts-row ts-row-edit" data-ts-worker="' + esc(w.id) + '">'
      + '<span class="ts-mid">'
      +   '<span class="ts-who">' + esc(w.name)
      +     (w.job_title ? ' <em>' + esc(w.job_title) + '</em>' : '') + '</span>'
      +   '<span class="ts-times">' + (w.admin_user_id ? 'logs their own hours' : 'admin logs for them') + '</span>'
      + '</span>'
      + (w.pay_type === 'monthly'
          ? '<span class="ts-hrs">' + tsMoney(w.monthly_fee) + '<small>per month'
            + (Number(w.hourly_rate) ? ' \u00b7 extras ' + tsMoney(w.hourly_rate) + '/h' : '') + '</small></span>'
          : '<span class="ts-hrs">' + tsMoney(w.hourly_rate) + '<small>per hour</small></span>')
      + '<span class="ts-status ' + (w.active ? 'ts-s-ok' : 'ts-s-draft') + '">'
      +   (w.active ? 'Active' : 'Inactive') + '</span>'
      + '</div>';
  }).join('');
}

/* ── entry modal ─────────────────────────────────────── */
function tsRecalc() {
  var g = function (id) { return document.getElementById(id); };
  var st = g('ts-f-start').value, en = g('ts-f-end').value;
  var brk = parseInt(g('ts-f-break').value, 10) || 0;
  var out = g('ts-f-calc');
  if (!st || !en) { out.textContent = 'Enter a start and end time.'; return; }
  var mins = function (h) { return (+h.slice(0, 2)) * 60 + (+h.slice(3, 5)); };
  var d = mins(en) - mins(st);
  if (d < 0) d += 24 * 60;                      // shift over midnight
  d -= brk;
  var hrs = Math.max(0, Math.round((d / 60) * 100) / 100);
  out.textContent = hrs > 0 ? hrs.toFixed(2) + ' hours' : 'That works out at zero hours.';
}

function tsOpenEntry(entry) {
  var g = function (id) { return document.getElementById(id); };
  tsEditingId = entry ? entry.id : null;
  g('ts-entry-title').textContent = entry ? 'Edit hours' : 'Log hours';
  g('ts-f-date').value   = entry ? entry.work_date : tsToday();
  g('ts-f-start').value  = entry && entry.start_time ? String(entry.start_time).slice(0, 5) : '';
  g('ts-f-end').value    = entry && entry.end_time   ? String(entry.end_time).slice(0, 5)   : '';
  g('ts-f-break').value  = entry ? (entry.break_minutes || 0) : 0;
  g('ts-f-notes').value  = entry ? (entry.notes || '') : '';
  g('ts-f-extra-wrap').style.display = tsIsMonthly() ? '' : 'none';
  g('ts-f-extra').checked = !!(entry && entry.is_extra);
  g('ts-f-err').textContent = '';
  g('ts-f-delete').style.display = entry ? '' : 'none';
  g('ts-f-date').max = tsToday();               // cannot log the future
  tsRecalc();
  g('ts-entry-modal').style.display = 'flex';
}

async function tsSaveEntry() {
  var g = function (id) { return document.getElementById(id); };
  var err = g('ts-f-err'), btn = g('ts-f-save');
  var data = {
    id:            tsEditingId || undefined,
    work_date:     g('ts-f-date').value,
    start_time:    g('ts-f-start').value || null,
    end_time:      g('ts-f-end').value || null,
    break_minutes: parseInt(g('ts-f-break').value, 10) || 0,
    notes:         g('ts-f-notes').value,
    is_extra:      tsIsMonthly() && g('ts-f-extra').checked
  };
  if (!data.work_date) { err.textContent = 'Pick a date.'; return; }
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    await adminAPI('timesheet.saveEntry', { data: data });
    g('ts-entry-modal').style.display = 'none';
    await loadTsMine();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

/* ── worker modal ────────────────────────────────────── */
/* Monthly people get a fee field; their hourly rate becomes the rate for
   extra hours only, so the label says so. */
function tsPayTypeUI() {
  var monthly = document.getElementById('ts-w-pay').value === 'monthly';
  document.getElementById('ts-w-fee-wrap').style.display = monthly ? '' : 'none';
  document.getElementById('ts-w-rate-label').textContent = monthly ? 'Rate for extra hours (R)' : 'Hourly rate (R)';
  document.getElementById('ts-w-rate-hint').style.display = monthly ? '' : 'none';
}
async function tsOpenWorker(worker) {
  var g = function (id) { return document.getElementById(id); };
  tsEditingWorker = worker ? worker.id : null;
  g('ts-worker-title').textContent = worker ? 'Edit person' : 'Add person';
  g('ts-w-name').value  = worker ? worker.name : '';
  g('ts-w-title').value = worker ? (worker.job_title || '') : '';
  g('ts-w-rate').value  = worker ? worker.hourly_rate : 0;
  g('ts-w-pay').value   = worker && worker.pay_type === 'monthly' ? 'monthly' : 'hourly';
  g('ts-w-fee').value   = worker && worker.monthly_fee != null ? worker.monthly_fee : '';
  tsPayTypeUI();
  g('ts-w-active').checked = worker ? worker.active !== false : true;
  g('ts-w-err').textContent = '';

  /* Offer the admin accounts so a person can log their own hours. */
  var sel = g('ts-w-user');
  sel.innerHTML = '<option value="">None — an admin logs for them</option>';
  try {
    var users = await adminAPI('admin.listUsers', {}) || [];
    users.forEach(function (u) {
      var o = document.createElement('option');
      o.value = u.id;
      o.textContent = u.username + (u.role ? ' (' + u.role + ')' : '');
      sel.appendChild(o);
    });
  } catch (e) { /* not permitted to list users — leave the picker empty */ }
  sel.value = worker && worker.admin_user_id ? worker.admin_user_id : '';
  g('ts-worker-modal').style.display = 'flex';
}

async function tsSaveWorker() {
  var g = function (id) { return document.getElementById(id); };
  var err = g('ts-w-err'), btn = g('ts-w-save');
  var data = {
    id:            tsEditingWorker || undefined,
    name:          g('ts-w-name').value,
    job_title:     g('ts-w-title').value,
    hourly_rate:   g('ts-w-rate').value,
    pay_type:      g('ts-w-pay').value,
    monthly_fee:   g('ts-w-fee').value,
    admin_user_id: g('ts-w-user').value || null,
    active:        g('ts-w-active').checked
  };
  if (!data.name.trim()) { err.textContent = 'A name is required.'; return; }
  if (data.pay_type === 'monthly' && !(parseFloat(data.monthly_fee) > 0)) {
    err.textContent = 'Enter the monthly fee.'; return;
  }
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    await adminAPI('timesheet.saveWorker', { data: data });
    g('ts-worker-modal').style.display = 'none';
    await loadTsPeople();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

/* ── wiring ──────────────────────────────────────────── */
(function tsInit() {
  var g = function (id) { return document.getElementById(id); };
  if (!g('tab-timesheet')) return;

  /* sub-tabs */
  document.querySelectorAll('.ts-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.ts-tab').forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      var want = btn.dataset.ts;
      ['mine', 'review', 'pay', 'people'].forEach(function (k) {
        var v = g('ts-view-' + k);
        if (v) v.style.display = k === want ? '' : 'none';
      });
      if (want === 'review') loadTsReview();
      if (want === 'people') loadTsPeople();
    });
  });

  g('ts-new-btn').addEventListener('click', function () { tsOpenEntry(null); });
  g('ts-mine-refresh').addEventListener('click', loadTsMine);

  g('ts-mine-list').addEventListener('click', function (e) {
    var row = e.target.closest('[data-ts-edit]');
    if (!row) return;
    var entry = tsMine.filter(function (x) { return String(x.id) === row.dataset.tsEdit; })[0];
    if (entry) tsOpenEntry(entry);
  });

  g('ts-people-list').addEventListener('click', function (e) {
    var row = e.target.closest('[data-ts-worker]');
    if (!row) return;
    var w = tsWorkers.filter(function (x) { return String(x.id) === row.dataset.tsWorker; })[0];
    if (w) tsOpenWorker(w);
  });
  g('ts-worker-new').addEventListener('click', function () { tsOpenWorker(null); });

  ['ts-f-start', 'ts-f-end', 'ts-f-break'].forEach(function (id) {
    g(id).addEventListener('input', tsRecalc);
  });
  g('ts-f-save').addEventListener('click', tsSaveEntry);
  g('ts-f-cancel').addEventListener('click', function () { g('ts-entry-modal').style.display = 'none'; });
  g('ts-f-delete').addEventListener('click', function () {
    if (!tsEditingId) return;
    var id = tsEditingId;
    confirmModal('Delete this entry?', 'The logged hours will be removed.', async function () {
      try {
        await adminAPI('timesheet.deleteEntry', { id: id });
        g('ts-entry-modal').style.display = 'none';
        await loadTsMine();
      } catch (e) { g('ts-f-err').textContent = e.message; }
    });
  });

  g('ts-w-save').addEventListener('click', tsSaveWorker);
  g('ts-w-pay').addEventListener('change', tsPayTypeUI);
  g('ts-w-cancel').addEventListener('click', function () { g('ts-worker-modal').style.display = 'none'; });

  g('ts-submit-btn').addEventListener('click', function () {
    var ids = (tsMine || []).filter(function (e) { return e.status === 'draft'; })
                            .map(function (e) { return e.id; });
    if (!ids.length) { showToast('No drafts to submit', 2200); return; }
    confirmModal('Submit ' + ids.length + ' entr' + (ids.length === 1 ? 'y' : 'ies') + '?',
      'They go to an approver and cannot be edited while waiting.', async function () {
        try { await adminAPI('timesheet.submit', { ids: ids }); await loadTsMine(); showToast('Submitted', 2200); }
        catch (e) { alert(e.message); }
      }, { label: 'Submit' });
  });

  g('ts-approve-btn').addEventListener('click', function () {
    var ids = tsChecked();
    if (!ids.length) { showToast('Tick the entries to approve', 2200); return; }
    confirmModal('Approve ' + ids.length + ' entr' + (ids.length === 1 ? 'y' : 'ies') + '?',
      'The pay rate is locked in at approval and will not change afterwards.', async function () {
        try { await adminAPI('timesheet.approve', { ids: ids }); await loadTsReview(); showToast('Approved', 2200); }
        catch (e) { alert(e.message); }
      }, { label: 'Approve' });
  });

  g('ts-reject-btn').addEventListener('click', async function () {
    var ids = tsChecked();
    if (!ids.length) { showToast('Tick the entries to send back', 2200); return; }
    var why = prompt('Why is this being sent back? The person will see this.');
    if (!why || !why.trim()) return;
    try { await adminAPI('timesheet.reject', { ids: ids, reason: why }); await loadTsReview(); showToast('Sent back', 2200); }
    catch (e) { alert(e.message); }
  });

  g('ts-pay-run').addEventListener('click', loadTsPay);
  g('ts-pay-csv').addEventListener('click', tsPayCsv);
  g('ts-pay-mark').addEventListener('click', tsMarkPaid);
  /* Live total, and the reason box appears as soon as an amount changes. */
  g('ts-pay-list').addEventListener('input', tsPayRefresh);
  g('ts-pay-list').addEventListener('change', tsPayRefresh);

  [g('ts-entry-modal'), g('ts-worker-modal')].forEach(function (m) {
    if (m) m.addEventListener('click', function (e) { if (e.target === this) this.style.display = 'none'; });
  });
})();


/* ══════════════════════════════════════════════════════
   PLAYER WARNINGS
   A disciplinary document raised here, signed by the player through a
   link, kept with its signature. Three things are deliberate and worth
   not undoing:

   · Signing means "I received and read this", never "I agree". The
     player gets a box to disagree in, and the reply is kept.
   · The club signs before the player ever sees it.
   · doc_text is the document. The templates build a first draft; what is
     stored and signed is whatever stands in the box when it is created,
     so editing the templates later cannot change a signed document.
══════════════════════════════════════════════════════ */

/* Where the player's copy lives. One line to change if it moves. */
var WN_SIGN_BASE = location.origin + '/warning.html';
var WN_ALL = [], WN_TOUCHED = false, WN_MADE = null;
var WN_PAD = null, WN_SIGMODE = 'draw';

function wnEl(id) { return document.getElementById(id); }
function wnEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
  return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
function wnSay(text, bad) {
  var n = wnEl('wn-msg');
  if (!n) return;
  n.textContent = text || '';
  n.style.color = bad ? '#e08a84' : 'var(--muted)';
}

function wnFmtDate(iso) {
  if (!iso) return '';
  var d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d)) return iso;
  var m = ['January','February','March','April','May','June','July',
           'August','September','October','November','December'];
  return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
}
function wnFmtShort(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 10);
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}
function wnFmtWhen(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d)) return iso;
  return wnFmtDate(iso) + ' at ' + String(d.getHours()).padStart(2, '0') + ':' +
         String(d.getMinutes()).padStart(2, '0');
}

/* ── the list ─────────────────────────────────────────── */
async function wnLoad() {
  try {
    WN_ALL = await adminAPI('warning.list', { status: (wnEl('wn-filter') || {}).value || 'all' }) || [];
    wnRender();
  } catch (e) {
    var l = wnEl('wn-list');
    if (l) l.innerHTML = '<div class="mx-table-wrap"><div class="mx-empty">' +
      wnEsc(e.message || 'Could not load the warnings.') + '</div></div>';
  }
}

function wnRender() {
  var list = wnEl('wn-list');
  if (!list) return;
  var openN   = WN_ALL.filter(function (r) { return r.status === 'open'; }).length;
  var signedN = WN_ALL.filter(function (r) { return r.status === 'signed'; }).length;
  var last = WN_ALL.reduce(function (acc, r) {
    var t = r.issued_on ? new Date(r.issued_on).getTime() : 0;
    return t > acc.t ? { t: t, iso: r.issued_on } : acc;
  }, { t: 0, iso: null });

  var m = wnEl('wn-metrics');
  if (m) m.innerHTML =
    confMetricCard('On record', String(WN_ALL.length)) +
    confMetricCard('Signed', String(signedN)) +
    confMetricCard('Unsigned', String(openN)) +
    confMetricCard('Last raised', last.iso ? wnFmtShort(last.iso) : '—');

  if (!WN_ALL.length) {
    list.innerHTML = '<div class="mx-table-wrap"><div class="mx-empty">No warnings on record.</div></div>';
    return;
  }

  var body = WN_ALL.map(function (r) {
    var lv = (typeof levelById === 'function' && levelById(r.level)) || null;
    var badge = r.status === 'signed' ? 'signed' : r.status === 'void' ? 'void' : 'open';
    var label = r.status === 'signed' ? 'signed' : r.status === 'void' ? 'withdrawn' : 'unsigned';
    return '<tr>' +
      '<td>' + wnEsc(r.player_name) +
        (r.is_minor ? ' <span class="wn-badge minor">under 18</span>' : '') +
        (r.player_team ? '<div style="font-size:.78rem;color:var(--muted)">' + wnEsc(r.player_team) + '</div>' : '') +
      '</td>' +
      '<td>' + wnEsc(lv ? lv.label : r.level) +
        '<div style="font-size:.78rem;color:var(--muted)">' + wnEsc(r.ref) + '</div></td>' +
      '<td>' + wnEsc(wnFmtShort(r.issued_on)) + '</td>' +
      '<td><span class="wn-badge ' + badge + '">' + label + '</span></td>' +
      '<td class="mx-col-action">' +
        '<button class="mx-icon-btn wn-open" data-wn="' + r.id + '" title="Read it" aria-label="Read the warning for ' +
        wnEsc(r.player_name) + '">' + MX_ICON_FILE + '</button></td>' +
    '</tr>';
  }).join('');

  list.innerHTML =
    '<div class="mx-table-wrap"><div class="mx-table-scroll"><table class="mx-table"><thead><tr>' +
      '<th>Player</th><th>Level</th><th>Issued</th><th>Status</th><th class="mx-col-action"></th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div></div>';

  list.querySelectorAll('.wn-open').forEach(function (b) {
    b.addEventListener('click', function () { wnView(parseInt(this.dataset.wn, 10)); });
  });
}

/* ── reading one ──────────────────────────────────────── */
var WN_VIEWING = null;
async function wnView(id) {
  try {
    var res = await adminAPI('warning.one', { id: id });
    var w = res && res.warning;
    if (!w) return;
    WN_VIEWING = w;
    var lv = (typeof levelById === 'function' && levelById(w.level)) || null;
    wnEl('wn-view-title').textContent = (lv ? lv.label : 'Warning') + ' — ' + w.player_name;

    /* A drawn mark is shown as the mark, with the name under it: a
       squiggle on its own identifies nobody. */
    var mark = function (type, data, name) {
      return (type === 'drawn' && data)
        ? '<img class="wn-sigmark" src="' + wnEsc(data) + '" alt="Signature of ' + wnEsc(name) + '">'
        : '';
    };
    var signed = w.player_signed_at
      ? mark(w.player_signature_type, w.player_signature_data, w.player_signature) +
        wnEsc(w.player_signature) + ' on ' + wnEsc(wnFmtWhen(w.player_signed_at)) +
        (w.guardian_signed_at
          ? '<div style="margin-top:8px">' +
            mark(w.guardian_signature_type, w.guardian_signature_data, w.guardian_signature) +
            wnEsc(w.guardian_signature) + ', parent or guardian</div>' : '')
      : (w.status === 'void' ? 'Withdrawn' : 'Not signed yet');

    wnEl('wn-view-body').innerHTML =
      '<div class="wn-view-meta">' +
        '<div><span>Reference</span><b>' + wnEsc(w.ref) + '</b></div>' +
        '<div><span>Player</span><b>' + wnEsc(w.player_name) +
          (w.is_minor ? ' (under 18)' : '') + '</b></div>' +
        '<div><span>Issued by</span><b>' +
          mark(w.official_signature_type, w.official_signature_data, w.issued_by) +
          wnEsc(w.issued_by) + (w.issued_role ? ' (' + wnEsc(w.issued_role) + ')' : '') + '</b></div>' +
        '<div><span>Issued on</span><b>' + wnEsc(wnFmtDate(w.issued_on)) + '</b></div>' +
        '<div style="grid-column:1/-1"><span>Signature</span><b>' + signed + '</b></div>' +
      '</div>' +
      '<div class="wn-view-doc">' + wnEsc(w.doc_text) + '</div>' +
      (w.player_response
        ? '<div class="wn-reply"><strong>The player’s reply</strong>' + wnEsc(w.player_response) + '</div>' : '') +
      (w.void_reason
        ? '<div class="wn-reply"><strong>Withdrawn</strong>' + wnEsc(w.void_reason) + '</div>' : '') +
      '<div class="wn-fp">Document fingerprint (SHA-256): ' + wnEsc(w.doc_hash || '') + '</div>';

    /* Only the chair withdraws one, and only one that still stands. */
    var actions = wnEl('wn-view-modal').querySelector('.modal-actions');
    var old = actions.querySelector('#wn-view-void');
    if (old) old.remove();
    if (w.status !== 'void' && (SESSION_ROLE === 'chair' || SESSION_ROLE === 'super')) {
      var b = document.createElement('button');
      b.className = 'mx-btn mx-btn-ghost';
      b.id = 'wn-view-void';
      b.textContent = 'Withdraw';
      b.style.color = '#e08a84';
      b.addEventListener('click', function () { wnVoid(w); });
      actions.insertBefore(b, actions.firstChild);
    }
    wnEl('wn-view-modal').style.display = 'flex';
  } catch (e) { showToast(e.message || 'Could not open it'); }
}

async function wnVoid(w) {
  var why = prompt('Withdraw ' + w.ref + ' for ' + w.player_name + '?\n\nWhy? (kept on the record)');
  if (why === null) return;
  try {
    await adminAPI('warning.void', { id: w.id, reason: why || null });
    showToast(w.ref + ' withdrawn');
    wnEl('wn-view-modal').style.display = 'none';
    wnLoad();
  } catch (e) { showToast(e.message || 'Could not withdraw it'); }
}

/* ── raising one ──────────────────────────────────────── */
function wnFillLevels() {
  var sel = wnEl('wn-level');
  if (!sel || typeof LEVELS === 'undefined') return;
  sel.innerHTML = LEVELS.map(function (l) {
    return '<option value="' + l.id + '">' + wnEsc(l.label) + '</option>';
  }).join('');
  sel.value = 'first';
}

function wnPrettyDate(iso) { return iso ? wnFmtDate(iso) : ''; }

function wnFields() {
  return {
    levelId: wnEl('wn-level').value,
    issuedBy: wnEl('wn-by').value.trim() || '[who is issuing it]',
    incidentOn: wnPrettyDate(wnEl('wn-date').value) || '[date of the incident]',
    incidentPlace: wnEl('wn-place').value.trim(),
    incidentText: wnEl('wn-incident').value.trim() || '[what happened]',
    codeRef: wnEl('wn-code').value.trim(),
    expectedText: wnEl('wn-expected').value.trim(),
    consequenceText: wnEl('wn-consequence').value.trim(),
    sanctionText: '',
    suspendFrom: wnPrettyDate(wnEl('wn-sfrom').value),
    suspendTo: wnPrettyDate(wnEl('wn-sto').value),
    suspendMatches: wnEl('wn-smatches').value,
    hearingAt: wnEl('wn-hwhen').value
      ? wnFmtDate(wnEl('wn-hwhen').value.slice(0, 10)) + ' at ' + wnEl('wn-hwhen').value.slice(11, 16)
      : '',
    hearingPlace: wnEl('wn-hwhere').value.trim(),
    isMinor: wnEl('wn-minor').checked,
    months: parseInt(wnEl('wn-months').value, 10),
    appealDays: parseInt(wnEl('wn-appeal').value, 10)
  };
}

/* Rebuilds only while the wording has not been edited by hand. Nothing is
   more annoying than careful wording wiped by a stray keystroke. */
function wnRebuild(force) {
  if (WN_TOUCHED && force !== true) return;
  if (typeof buildDocument !== 'function') return;
  wnEl('wn-doc').value = buildDocument(wnFields());
}

/* Draw or type, one or the other. The same shape as the player's page and
   as the confidentiality undertaking, so a signature means the same thing
   wherever it was given. */
function wnSetSigMode(mode) {
  WN_SIGMODE = mode;
  wnEl('wn-sig-draw-tab').classList.toggle('on', mode === 'draw');
  wnEl('wn-sig-type-tab').classList.toggle('on', mode === 'type');
  wnEl('wn-sig-draw').style.display = mode === 'draw' ? '' : 'none';
  wnEl('wn-sig-type').style.display = mode === 'type' ? '' : 'none';
  if (mode === 'draw' && WN_PAD) WN_PAD.resize();
}

function wnWirePad() {
  var canvas = wnEl('wn-pad');
  if (!canvas || typeof makeSignaturePad !== 'function') return;
  if (typeof signaturePadSupported === 'function' && !signaturePadSupported()) {
    wnSetSigMode('type');
    wnEl('wn-sig-draw-tab').style.display = 'none';
    return;
  }
  WN_PAD = makeSignaturePad(canvas, {
    onChange: function () {
      var g = wnEl('wn-pad-ghost');
      if (g) g.style.display = WN_PAD.isEmpty() ? '' : 'none';
    }
  });
  wnEl('wn-pad-clear').addEventListener('click', function () { WN_PAD.clear(); });
  wnEl('wn-sig-draw-tab').addEventListener('click', function () { wnSetSigMode('draw'); });
  wnEl('wn-sig-type-tab').addEventListener('click', function () { wnSetSigMode('type'); });
}

function wnSignaturePayload() {
  if (WN_SIGMODE === 'draw') {
    if (!WN_PAD || WN_PAD.isEmpty()) return { error: 'Sign in the box before you send it.' };
    var data = WN_PAD.toDataURL();
    if (!data || (typeof validSignatureData === 'function' && !validSignatureData(data))) {
      return { error: 'That signature did not come through. Please sign again.' };
    }
    return { official_signature_type: 'drawn', official_signature_data: data };
  }
  var typed = wnEl('wn-sign').value.trim();
  if (typed.length < 3) return { error: 'Sign it before you send it.' };
  return { official_signature: typed, official_signature_type: 'typed' };
}

function wnSyncLevel() {
  var lv = wnEl('wn-level').value;
  wnEl('wn-suspend').style.display = lv === 'suspension' ? '' : 'none';
  wnEl('wn-hearing').style.display = lv === 'hearing' ? '' : 'none';
  var def = (typeof levelById === 'function' && levelById(lv)) || null;
  if (def && !wnEl('wn-months').dataset.touched) wnEl('wn-months').value = String(def.months);
  wnRebuild();
}

function wnOpenNew() {
  WN_TOUCHED = false; WN_MADE = null;
  ['wn-player','wn-team','wn-guardian','wn-place','wn-code','wn-incident',
   'wn-expected','wn-consequence','wn-sfrom','wn-sto','wn-smatches','wn-hwhen','wn-hwhere']
    .forEach(function (id) { if (wnEl(id)) wnEl(id).value = ''; });
  wnEl('wn-minor').checked = false;
  wnEl('wn-guardian-wrap').style.display = 'none';
  wnEl('wn-date').value = new Date().toISOString().slice(0, 10);
  if (!wnEl('wn-by').value) wnEl('wn-by').value = SESSION_NAME || '';
  if (!wnEl('wn-sign').value) wnEl('wn-sign').value = SESSION_NAME || '';
  wnEl('wn-made').style.display = 'none';
  wnEl('wn-create').style.display = '';
  wnSay('');
  wnSyncLevel();
  wnRebuild(true);
  wnFillPlayerList();
  wnEl('wn-modal').style.display = 'flex';
  /* A canvas in a hidden modal has no width until the modal is on screen. */
  if (WN_PAD) { WN_PAD.clear(); WN_PAD.resize(); }
}

/* The club already knows its players; typing a name from scratch invites
   a misspelling that then sits on a disciplinary record for a year. */
async function wnFillPlayerList() {
  var dl = wnEl('wn-players');
  if (!dl || dl.dataset.filled) return;
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/players?select=name&active=not.eq.false&order=name.asc&limit=400', { headers: H });
    var rows = await r.json();
    if (!Array.isArray(rows)) return;
    dl.innerHTML = rows.map(function (p) { return '<option value="' + wnEsc(p.name) + '">'; }).join('');
    dl.dataset.filled = '1';
  } catch (e) { /* a datalist is a convenience, never a requirement */ }
}

async function wnCreate() {
  var p = {
    level: wnEl('wn-level').value,
    player_name: wnEl('wn-player').value.trim(),
    player_team: wnEl('wn-team').value.trim() || null,
    is_minor: wnEl('wn-minor').checked,
    guardian_name: wnEl('wn-guardian').value.trim() || null,
    incident_on: wnEl('wn-date').value || null,
    incident_place: wnEl('wn-place').value.trim() || null,
    incident_text: wnEl('wn-incident').value.trim(),
    code_ref: wnEl('wn-code').value.trim() || null,
    expected_text: wnEl('wn-expected').value.trim() || null,
    consequence_text: wnEl('wn-consequence').value.trim() || null,
    suspend_from: wnEl('wn-sfrom').value || null,
    suspend_to: wnEl('wn-sto').value || null,
    suspend_matches: wnEl('wn-smatches').value ? parseInt(wnEl('wn-smatches').value, 10) : null,
    hearing_at: wnEl('wn-hwhen').value ? new Date(wnEl('wn-hwhen').value).toISOString() : null,
    hearing_place: wnEl('wn-hwhere').value.trim() || null,
    record_months: parseInt(wnEl('wn-months').value, 10),
    appeal_days: parseInt(wnEl('wn-appeal').value, 10),
    issued_by: wnEl('wn-by').value.trim(),
    issued_role: wnEl('wn-role').value.trim() || null,
    doc_text: wnEl('wn-doc').value
  };
  if (!p.player_name) { wnSay('Name the player.', true); return; }
  if (!p.incident_text) { wnSay('Say what happened.', true); return; }
  if (p.is_minor && !p.guardian_name) { wnSay('Name the parent or guardian.', true); return; }
  var sig = wnSignaturePayload();
  if (sig.error) { wnSay(sig.error, true); return; }
  Object.assign(p, sig);

  wnEl('wn-create').disabled = true;
  wnSay('Creating…');
  try {
    var d = await adminAPI('warning.create', p);
    if (!d || !d.ok) { wnSay((d && d.error) || 'The server refused it.', true); return; }
    WN_MADE = d;
    var link = WN_SIGN_BASE + '?t=' + d.token;
    wnEl('wn-link').value = link;
    wnEl('wn-send-msg').value = wnMessage(p, d.ref, link);
    wnEl('wn-made').style.display = '';
    wnEl('wn-create').style.display = 'none';
    wnSay(d.ref + ' created. Send the link below to the player.');
    wnLoad();
  } catch (e) { wnSay(e.message || 'Could not reach the server.', true); }
  finally { wnEl('wn-create').disabled = false; }
}

function wnMessage(p, ref, link) {
  var lv = (typeof levelById === 'function' && levelById(p.level)) || null;
  var who = p.is_minor ? 'your son or daughter' : 'you';
  return 'Hi ' + (p.player_name.split(' ')[0] || '') + ',\n\n' +
    'Tygerberg Cricket Club has issued ' + who + ' a ' + (lv ? lv.label.toLowerCase() : 'warning') +
    ' (reference ' + ref + ').\n\n' +
    'Please open the link below, read it, and sign to confirm you have received it. ' +
    'Signing does not mean you agree with it — there is a box to write your side, ' +
    'and it goes to the committee with the document.\n\n' +
    link + '\n\n' +
    (p.is_minor ? 'As the player is under 18, a parent or guardian signs as well.\n\n' : '') +
    'Please do not forward this link — it opens the document.\n\n' +
    p.issued_by + (p.issued_role ? '\n' + p.issued_role : '') + '\nTygerberg Cricket Club';
}

function wnCopy(text, btn) {
  var said = function () {
    if (!btn) return;
    var was = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(function () { btn.textContent = was; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(said, function () { wnCopyFallback(text, said); });
  } else { wnCopyFallback(text, said); }
}
function wnCopyFallback(text, said) {
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); said(); } catch (e) {}
  document.body.removeChild(ta);
}

/* ── wiring ───────────────────────────────────────────── */
(function wnWire() {
  if (!wnEl('wn-modal')) return;
  wnFillLevels();
  wnWirePad();

  wnEl('wn-new-btn').addEventListener('click', wnOpenNew);
  wnEl('wn-filter').addEventListener('change', wnLoad);
  wnEl('wn-close').addEventListener('click', function () { wnEl('wn-modal').style.display = 'none'; });
  wnEl('wn-view-close').addEventListener('click', function () { wnEl('wn-view-modal').style.display = 'none'; });
  wnEl('wn-level').addEventListener('change', wnSyncLevel);
  wnEl('wn-months').addEventListener('change', function () { this.dataset.touched = '1'; wnRebuild(); });
  wnEl('wn-minor').addEventListener('change', function () {
    wnEl('wn-guardian-wrap').style.display = this.checked ? '' : 'none';
    wnRebuild();
  });

  /* Wrapped, not passed by reference: a listener hands its Event to the
     callback, which would arrive as `force` and override the guard that
     keeps hand-written wording from being rebuilt away. */
  ['wn-player','wn-team','wn-date','wn-place','wn-code','wn-incident','wn-expected',
   'wn-consequence','wn-sfrom','wn-sto','wn-smatches','wn-hwhen','wn-hwhere','wn-by',
   'wn-role','wn-appeal'].forEach(function (id) {
    var n = wnEl(id);
    if (!n) return;
    n.addEventListener('input', function () { wnRebuild(); });
    n.addEventListener('change', function () { wnRebuild(); });
  });

  wnEl('wn-doc').addEventListener('input', function () { WN_TOUCHED = true; });
  wnEl('wn-rebuild').addEventListener('click', function () {
    if (WN_TOUCHED && !confirm('Rebuild the wording from the fields?\n\nYour edits to the text will be lost.')) return;
    WN_TOUCHED = false;
    wnRebuild(true);
  });
  wnEl('wn-create').addEventListener('click', wnCreate);
  wnEl('wn-copy-link').addEventListener('click', function () { wnCopy(wnEl('wn-link').value, this); });
  wnEl('wn-copy-msg').addEventListener('click', function () { wnCopy(wnEl('wn-send-msg').value, this); });
  wnEl('wn-view-copy').addEventListener('click', function () {
    if (WN_VIEWING) wnCopy(WN_SIGN_BASE + '?t=' + WN_VIEWING.token, this);
  });
  wnEl('wn-view-print').addEventListener('click', function () {
    if (WN_VIEWING) window.open(WN_SIGN_BASE + '?t=' + WN_VIEWING.token, '_blank', 'noopener');
  });

  [wnEl('wn-modal'), wnEl('wn-view-modal')].forEach(function (m) {
    if (m) m.addEventListener('click', function (e) { if (e.target === this) this.style.display = 'none'; });
  });
})();


/* ══════════════════════════════════════════════════════
   AGREEMENTS
   A document the club sends out for signature. Its own table, its own
   roles, its own expiry — a stipend agreement and a disciplinary warning
   are different things and do not belong in one register.

   The signer reads TEXT, not a rendered PDF, on purpose: it opens on a
   cheap phone, on little data, with no reader app. The PDF the committee
   approved is kept privately beside it and fingerprinted, so the text that
   was signed can be shown to belong to that file.
══════════════════════════════════════════════════════ */
var AG_ALL = [], AG_PAD = null, AG_SIGMODE = 'draw', AG_FILE = null, AG_VIEWING = null;
var AG_SIGN_BASE = location.origin + '/agreement.html';

function agEl(id) { return document.getElementById(id); }
function agSay(text, bad) {
  var n = agEl('ag-msg');
  if (!n) return;
  n.textContent = text || '';
  n.style.color = bad ? '#e08a84' : 'var(--muted)';
}

/* ── the list ─────────────────────────────────────────── */
async function agLoad() {
  try {
    AG_ALL = await adminAPI('agreement.list', { status: (agEl('ag-filter') || {}).value || 'all' }) || [];
    agRender();
  } catch (e) {
    var l = agEl('ag-list');
    if (l) l.innerHTML = '<div class="mx-table-wrap"><div class="mx-empty">' +
      wnEsc(e.message || 'Could not load the agreements.') + '</div></div>';
  }
}

function agRender() {
  var list = agEl('ag-list');
  if (!list) return;
  var today = new Date().toISOString().slice(0, 10);
  var openN = AG_ALL.filter(function (r) { return r.status === 'open'; }).length;
  var signedN = AG_ALL.filter(function (r) { return r.status === 'signed'; }).length;
  var deadN = AG_ALL.filter(function (r) {
    return r.status === 'open' && r.link_expires_on && r.link_expires_on < today;
  }).length;

  var m = agEl('ag-metrics');
  if (m) m.innerHTML =
    confMetricCard('On record', String(AG_ALL.length)) +
    confMetricCard('Signed', String(signedN)) +
    confMetricCard('Waiting', String(openN)) +
    confMetricCard('Links expired', String(deadN));

  if (!AG_ALL.length) {
    list.innerHTML = '<div class="mx-table-wrap"><div class="mx-empty">No agreements yet.</div></div>';
    return;
  }

  var body = AG_ALL.map(function (r) {
    var expired = r.status === 'open' && r.link_expires_on && r.link_expires_on < today;
    var badge = r.status === 'signed' ? 'signed' : r.status === 'void' ? 'void' : expired ? 'void' : 'open';
    var label = r.status === 'signed' ? 'signed'
              : r.status === 'void' ? 'withdrawn'
              : expired ? 'link expired' : 'waiting';
    return '<tr>' +
      '<td>' + wnEsc(r.party_name) +
        (r.party_role ? '<div style="font-size:.78rem;color:var(--muted)">' + wnEsc(r.party_role) + '</div>' : '') +
      '</td>' +
      '<td>' + wnEsc(r.title) +
        '<div style="font-size:.78rem;color:var(--muted)">' + wnEsc(r.ref) + '</div></td>' +
      '<td>' + wnEsc(wnFmtShort(r.issued_on)) + '</td>' +
      '<td><span class="wn-badge ' + badge + '">' + label + '</span></td>' +
      '<td class="mx-col-action">' +
        '<button class="mx-icon-btn ag-open" data-ag="' + r.id + '" title="Read it" aria-label="Read the agreement with ' +
        wnEsc(r.party_name) + '">' + MX_ICON_FILE + '</button></td>' +
    '</tr>';
  }).join('');

  list.innerHTML =
    '<div class="mx-table-wrap"><div class="mx-table-scroll"><table class="mx-table"><thead><tr>' +
      '<th>With</th><th>Agreement</th><th>Issued</th><th>Status</th><th class="mx-col-action"></th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div></div>';

  list.querySelectorAll('.ag-open').forEach(function (b) {
    b.addEventListener('click', function () { agView(parseInt(this.dataset.ag, 10)); });
  });
}

/* ── reading one ──────────────────────────────────────── */
async function agView(id) {
  try {
    var res = await adminAPI('agreement.one', { id: id });
    var a = res && res.agreement;
    if (!a) return;
    AG_VIEWING = a;
    agEl('ag-view-title').textContent = a.title + ' — ' + a.party_name;

    var mark = function (type, data, name) {
      return (type === 'drawn' && data)
        ? '<img class="wn-sigmark" src="' + wnEsc(data) + '" alt="Signature of ' + wnEsc(name) + '">'
        : '';
    };
    var theirs = a.party_signed_at
      ? mark(a.party_signature_type, a.party_signature_data, a.party_signature) +
        wnEsc(a.party_signature) + ' on ' + wnEsc(wnFmtWhen(a.party_signed_at))
      : (a.status === 'void' ? 'Withdrawn' : 'Not signed yet');

    agEl('ag-view-file').style.display = a.file_path ? '' : 'none';

    agEl('ag-view-body').innerHTML =
      '<div class="wn-view-meta">' +
        '<div><span>Reference</span><b>' + wnEsc(a.ref) + '</b></div>' +
        '<div><span>With</span><b>' + wnEsc(a.party_name) +
          (a.party_role ? ' (' + wnEsc(a.party_role) + ')' : '') + '</b></div>' +
        '<div><span>For the club</span><b>' +
          mark(a.club_signature_type, a.club_signature_data, a.issued_by) +
          wnEsc(a.club_signature || a.issued_by) +
          (a.issued_role ? ' (' + wnEsc(a.issued_role) + ')' : '') + '</b></div>' +
        '<div><span>Issued on</span><b>' + wnEsc(wnFmtDate(a.issued_on)) + '</b></div>' +
        '<div><span>Link</span><b>' + (a.status === 'signed' ? 'signed' :
           wnEsc(wnFmtDate(a.link_expires_on)) +
           (a.link_expires_on < new Date().toISOString().slice(0, 10) ? ' (expired)' : '')) + '</b></div>' +
        '<div><span>Keep until</span><b>' + (a.retain_until ? wnEsc(wnFmtDate(a.retain_until)) : 'no end set') + '</b></div>' +
        '<div style="grid-column:1/-1"><span>Their signature</span><b>' + theirs + '</b></div>' +
      '</div>' +
      '<div class="wn-view-doc">' + wnEsc(a.doc_text) + '</div>' +
      (a.party_note
        ? '<div class="wn-reply"><strong>Their note</strong>' + wnEsc(a.party_note) + '</div>' : '') +
      (a.void_reason
        ? '<div class="wn-reply"><strong>Withdrawn</strong>' + wnEsc(a.void_reason) + '</div>' : '') +
      '<div class="wn-fp">Text fingerprint: ' + wnEsc(a.doc_hash || '') +
        (a.file_hash ? '<br>Original PDF fingerprint: ' + wnEsc(a.file_hash) : '') + '</div>';

    var actions = agEl('ag-view-modal').querySelector('.modal-actions');
    var old = actions.querySelector('#ag-view-void');
    if (old) old.remove();
    if (a.status !== 'void') {
      var b = document.createElement('button');
      b.className = 'mx-btn mx-btn-ghost';
      b.id = 'ag-view-void';
      b.textContent = 'Withdraw';
      b.style.color = '#e08a84';
      b.addEventListener('click', function () { agVoid(a); });
      actions.insertBefore(b, actions.firstChild);
    }
    agEl('ag-view-modal').style.display = 'flex';
  } catch (e) { showToast(e.message || 'Could not open it'); }
}

async function agVoid(a) {
  var why = prompt('Withdraw ' + a.ref + ' with ' + a.party_name + '?\n\nWhy? (kept on the record)');
  if (why === null) return;
  try {
    await adminAPI('agreement.void', { id: a.id, reason: why || null });
    showToast(a.ref + ' withdrawn');
    agEl('ag-view-modal').style.display = 'none';
    agLoad();
  } catch (e) { showToast(e.message || 'Could not withdraw it'); }
}

/* The file never has a standing URL — this asks for one that lasts five
   minutes and opens it. */
async function agOpenFile(which) {
  try {
    var d = await adminAPI('agreement.fileAdmin', { id: which.id });
    if (d && d.url) window.open(d.url, '_blank', 'noopener');
    else showToast('No file on this one');
  } catch (e) { showToast(e.message || 'Could not fetch the file'); }
}

/* ── reading a PDF in the browser ─────────────────────────
   Done here rather than in the Worker: the file stays on the machine until
   the person has looked at what came out of it, and a Worker has neither
   the time nor the memory budget to parse PDFs. */
async function agReadPdf(file) {
  if (typeof pdfjsLib === 'undefined') {
    agSay('The PDF reader did not load. Paste the text in instead.', true);
    return null;
  }
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var buf = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    var out = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      var page = await pdf.getPage(i);
      var tc = await page.getTextContent();
      /* Rebuild lines from the y position: the items come in reading order
         but with no line breaks, and an agreement run together into one
         paragraph is not something anyone should be asked to sign. */
      var lines = [], lastY = null, line = [];
      tc.items.forEach(function (it) {
        var y = Math.round(it.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line.join('')); line = []; }
        line.push(it.str);
        lastY = y;
      });
      if (line.length) lines.push(line.join(''));
      out.push(lines.join('\n').replace(/[ \t]+$/gm, ''));
    }
    return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    agSay('That PDF could not be read. Paste the text in instead.', true);
    return null;
  }
}

async function agPickFile(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (file.type && file.type !== 'application/pdf') {
    agSay('That is not a PDF.', true); input.value = ''; return;
  }
  if (file.size > 15 * 1024 * 1024) {
    agSay('That file is bigger than 15 MB.', true); input.value = ''; return;
  }
  agSay('Reading it…');
  var text = await agReadPdf(file);
  AG_FILE = { file: file, name: file.name };
  if (text) {
    agEl('ag-doc').value = text;
    if (!agEl('ag-title').value) {
      agEl('ag-title').value = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    }
    agSay(file.name + ' — ' + Math.round(file.size / 1024) + ' KB, ' +
          text.split(/\n/).length + ' lines of text read out of it. Check it below.');
  }
}

/* ── the club's signature ─────────────────────────────── */
function agSetSigMode(mode) {
  AG_SIGMODE = mode;
  agEl('ag-sig-draw-tab').classList.toggle('on', mode === 'draw');
  agEl('ag-sig-type-tab').classList.toggle('on', mode === 'type');
  agEl('ag-sig-draw').style.display = mode === 'draw' ? '' : 'none';
  agEl('ag-sig-type').style.display = mode === 'type' ? '' : 'none';
  if (mode === 'draw' && AG_PAD) AG_PAD.resize();
}

function agWirePad() {
  var canvas = agEl('ag-pad');
  if (!canvas || typeof makeSignaturePad !== 'function') return;
  if (typeof signaturePadSupported === 'function' && !signaturePadSupported()) {
    agSetSigMode('type');
    agEl('ag-sig-draw-tab').style.display = 'none';
    return;
  }
  AG_PAD = makeSignaturePad(canvas, {
    onChange: function () {
      var g = agEl('ag-pad-ghost');
      if (g) g.style.display = AG_PAD.isEmpty() ? '' : 'none';
    }
  });
  agEl('ag-pad-clear').addEventListener('click', function () { AG_PAD.clear(); });
  agEl('ag-sig-draw-tab').addEventListener('click', function () { agSetSigMode('draw'); });
  agEl('ag-sig-type-tab').addEventListener('click', function () { agSetSigMode('type'); });
}

function agSignaturePayload() {
  if (AG_SIGMODE === 'draw') {
    if (!AG_PAD || AG_PAD.isEmpty()) return { error: 'Sign it before you send it.' };
    var data = AG_PAD.toDataURL();
    if (!data || (typeof validSignatureData === 'function' && !validSignatureData(data))) {
      return { error: 'That signature did not come through. Please sign again.' };
    }
    return { club_signature_type: 'drawn', club_signature_data: data };
  }
  var typed = agEl('ag-sign').value.trim();
  if (typed.length < 3) return { error: 'Sign it before you send it.' };
  return { club_signature: typed, club_signature_type: 'typed' };
}

/* ── raising one ──────────────────────────────────────── */
function agOpenNew() {
  AG_FILE = null;
  ['ag-title','ag-place','ag-party','ag-party-role','ag-doc','ag-retain'].forEach(function (id) {
    if (agEl(id)) agEl(id).value = '';
  });
  agEl('ag-file').value = '';
  agEl('ag-place').value = 'Ravensmead';
  agEl('ag-confidential').checked = true;
  if (!agEl('ag-by').value) agEl('ag-by').value = SESSION_NAME || '';
  agEl('ag-made').style.display = 'none';
  agEl('ag-create').style.display = '';
  agSay('');
  agFillPlayerList();
  agEl('ag-modal').style.display = 'flex';
  if (AG_PAD) { AG_PAD.clear(); AG_PAD.resize(); }
}

async function agFillPlayerList() {
  var dl = agEl('ag-players');
  if (!dl || dl.dataset.filled) return;
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/players?select=name&active=not.eq.false&order=name.asc&limit=400', { headers: H });
    var rows = await r.json();
    if (!Array.isArray(rows)) return;
    dl.innerHTML = rows.map(function (p) { return '<option value="' + wnEsc(p.name) + '">'; }).join('');
    dl.dataset.filled = '1';
  } catch (e) {}
}

function agFileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var fr = new FileReader();
    fr.onload = function () {
      var s = String(fr.result || '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

async function agCreate() {
  var p = {
    title: agEl('ag-title').value.trim(),
    party_name: agEl('ag-party').value.trim(),
    party_role: agEl('ag-party-role').value.trim() || null,
    doc_text: agEl('ag-doc').value,
    place: agEl('ag-place').value.trim() || null,
    issued_by: agEl('ag-by').value.trim(),
    issued_role: agEl('ag-by-role').value.trim() || null,
    confidential: agEl('ag-confidential').checked,
    link_days: parseInt(agEl('ag-days').value, 10),
    retain_until: agEl('ag-retain').value || null
  };
  if (!p.title) { agSay('Give it a title.', true); return; }
  if (!p.party_name) { agSay('Name the person it is with.', true); return; }
  if (!p.doc_text.trim()) { agSay('There is no agreement text — drop the PDF in or paste it.', true); return; }
  var sig = agSignaturePayload();
  if (sig.error) { agSay(sig.error, true); return; }
  Object.assign(p, sig);

  agEl('ag-create').disabled = true;
  try {
    if (AG_FILE && AG_FILE.file) {
      agSay('Storing the PDF…');
      var b64 = await agFileToBase64(AG_FILE.file);
      var up = await adminAPI('agreement.uploadFile', { fileName: AG_FILE.name, base64: b64 });
      if (up && up.path) {
        p.file_path = up.path; p.file_name = up.name;
        p.file_hash = up.hash; p.file_size = up.size;
      }
    }
    agSay('Creating…');
    var d = await adminAPI('agreement.create', p);
    if (!d || !d.ok) { agSay((d && d.error) || 'The server refused it.', true); return; }
    var link = AG_SIGN_BASE + '?t=' + d.token;
    agEl('ag-link').value = link;
    agEl('ag-link-life').textContent =
      'This link stops working on ' + wnFmtDate(d.link_expires_on) +
      '. Anyone who has it can open and sign the agreement, so send it to them and nobody else.';
    agEl('ag-send-msg').value = agMessage(p, d.ref, link, d.link_expires_on);
    agEl('ag-made').style.display = '';
    agEl('ag-create').style.display = 'none';
    agSay(d.ref + ' created.');
    agLoad();
  } catch (e) { agSay(e.message || 'Could not reach the server.', true); }
  finally { agEl('ag-create').disabled = false; }
}

function agMessage(p, ref, link, expires) {
  return 'Hi ' + (p.party_name.split(' ')[0] || '') + ',\n\n' +
    'Please find the ' + p.title.toLowerCase() + ' agreement (' + ref + ') from Tygerberg Cricket Club.\n\n' +
    'Open the link below on your phone, read it, and sign at the bottom. ' +
    'It opens as a normal web page — there is nothing to download and no app needed.\n\n' +
    link + '\n\n' +
    'The link stops working on ' + wnFmtDate(expires) + ', so please do it before then. ' +
    'Please do not forward it.\n\n' +
    p.issued_by + (p.issued_role ? '\n' + p.issued_role : '') + '\nTygerberg Cricket Club';
}

/* ── wiring ───────────────────────────────────────────── */
(function agWire() {
  if (!agEl('ag-modal')) return;
  agWirePad();
  agEl('ag-new-btn').addEventListener('click', agOpenNew);
  agEl('ag-filter').addEventListener('change', agLoad);
  agEl('ag-close').addEventListener('click', function () { agEl('ag-modal').style.display = 'none'; });
  agEl('ag-view-close').addEventListener('click', function () { agEl('ag-view-modal').style.display = 'none'; });
  agEl('ag-file').addEventListener('change', function () { agPickFile(this); });
  agEl('ag-create').addEventListener('click', agCreate);
  agEl('ag-copy-link').addEventListener('click', function () { wnCopy(agEl('ag-link').value, this); });
  agEl('ag-copy-msg').addEventListener('click', function () { wnCopy(agEl('ag-send-msg').value, this); });
  agEl('ag-view-copy').addEventListener('click', function () {
    if (AG_VIEWING) wnCopy(AG_SIGN_BASE + '?t=' + AG_VIEWING.token, this);
  });
  agEl('ag-view-file').addEventListener('click', function () {
    if (AG_VIEWING) agOpenFile(AG_VIEWING);
  });
  [agEl('ag-modal'), agEl('ag-view-modal')].forEach(function (m) {
    if (m) m.addEventListener('click', function (e) { if (e.target === this) this.style.display = 'none'; });
  });
})();
