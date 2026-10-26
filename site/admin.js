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
  if (r.status === 403) throw new Error('You do not have permission to perform this action.');
  if (!r.ok) {
    var text = await r.text();
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
  bios:     ['super', 'content', 'registrar', 'chair'],
  players:  ['super', 'scores', 'content', 'chair'],
  registrations: ['super', 'scores', 'chair'],
  shop: ['super', 'scores', 'finance'],
  fixtures: ['super', 'fixtures', 'scores'],
  coaching: ['super', 'scores', 'fixtures', 'registrar', 'coach', 'chair'],
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
    if(tab.dataset.tab==='manage')   loadManageAlbums();
    if(tab.dataset.tab==='news')     loadNewsList();
    if(tab.dataset.tab==='fantasy')  { loadPlayerValues(); loadRoundsAdmin(); loadParticipants(); loadPendingRegistrations(); }
    if(tab.dataset.tab==='bios')     { loadBioSubmissions(); loadBioLinkPlayers(); }
    if(tab.dataset.tab==='players')  loadPlayersAdmin();
    if(tab.dataset.tab==='registrations') loadPlayerRegs();
    if(tab.dataset.tab==='shop') loadShopOrders();
    if(tab.dataset.tab==='fixtures') loadFixtures();
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
  positionImgToolbar(fig);
  if (!isVideo) syncImgToolbarState(fig);
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
  if (btn.id === 'img-tb-remove') {
    var fig = _selectedFigure;
    deselectFigure();
    fig.remove();
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
function confirmModal(title,body,cb){
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-body').textContent=body;
  document.getElementById('modal-overlay').style.display='flex';
  pendingConfirm=cb;
}
document.getElementById('modal-cancel').addEventListener('click',function(){document.getElementById('modal-overlay').style.display='none';pendingConfirm=null;});
document.getElementById('modal-confirm').addEventListener('click',function(){document.getElementById('modal-overlay').style.display='none';if(pendingConfirm){pendingConfirm();pendingConfirm=null;}});

/* ══ UTILS ══ */
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
async function loadFixtureOptions(selectId, selectedIds) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/fixtures?select=id,date,team,opponent,division&order=date.desc&limit=60', { headers: H });
    var fixtures = await r.json();
    sel.innerHTML = (fixtures||[]).map(function(f) {
      var label = (f.date ? f.date.substring(0,10) : '?') + ' — ' + (f.team||'TCC') + ' vs ' + (f.opponent||'?') + (f.division ? ' (' + f.division + ')' : '');
      var isSel = selectedIds && selectedIds.indexOf(f.id) !== -1 ? ' selected' : '';
      return '<option value="' + f.id + '"' + isSel + '>' + label + '</option>';
    }).join('');
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
        + '<div><div class="round-item-name">'+round.name+' '+badges+'</div><div class="round-item-meta">Deadline: '+dl+'</div></div>'
        + '<div class="round-item-actions">'
        + (round.locked
            ? '<button class="btn-sm" onclick="unlockRound(\''+round.id+'\')">Unlock</button><span class="locked-badge">Locked</span>'
            : '<button class="btn-sm" onclick="lockRound(\''+round.id+'\')">Lock</button>')
        + '<button class="btn-sm" onclick="editRound(\'' + round.id + '\', \'' + round.name.replace(/'/g, "\\'") + '\', \'' + round.deadline + '\', ' + !!round.wildcard + ', ' + !!round.h2h + ', \'' + (round.boost_modifier || '') + '\')" >Edit</button>'
        + '<button class="btn-sm" onclick="openScores(\''+round.id+'\',\''+round.name.replace(/'/g,"\\'")+'\')">Scores</button>'
        + h2hBtns
        + '<button class="btn-sm danger" onclick="deleteRound(\''+round.id+'\',\''+round.name.replace(/'/g,"\\'")+'\')">Delete</button>'
        + '</div>'
        + '</div>';
    }).join('');
  } catch(e) { el.innerHTML = '<div class="mx-empty" style="color:#e07070">Error loading rounds.</div>'; }
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
    await adminAPI('fantasy.lockRound', { id: id });
    loadRoundsAdmin();
  } catch(e) { alert('Failed to lock: ' + e.message); }
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
   The fantasy league is senior-adult only: minors are not priced,
   picked or traded. `squad` records which side someone plays for,
   NOT their age, so a junior in the senior squad is still excluded
   on age. Players with no age data on record are treated as adults
   (legacy profiles created before the registration pipeline).      */
function isFantasyEligible(p) {
  if (!p) return false;
  if (p.squad === 'youth') return false;
  if (p.is_minor === true) return false;
  if (p.dob) {
    var d = new Date(p.dob);
    if (!isNaN(d.getTime())) {
      var age = Math.floor((Date.now() - d.getTime()) / 31557600000);
      if (age < 18) return false;
    }
  }
  return true;
}

/* Fetch active players with the fields needed to judge eligibility.
   Falls back to a squad-only select if this database predates the
   dob/is_minor columns, so the admin never breaks on an older schema. */
async function fetchPlayersForFantasy() {
  var base = SUPABASE_URL + '/rest/v1/players?active=not.eq.false&order=name.asc';
  var r = await fetch(base + '&select=id,name,role,fantasy_value,squad,dob,is_minor', { headers: H });
  if (!r.ok) r = await fetch(base + '&select=id,name,role,fantasy_value,squad', { headers: H });
  if (!r.ok) throw new Error('Could not load players');
  var rows = await r.json();
  return Array.isArray(rows) ? rows : [];
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
            return { playerId: s.player_id, runs: s.runs||0, wickets: s.wickets||0, catches: s.catches||0, stumpings: s.stumpings||0, economy: s.economy!=null?s.economy:null, maidens: s.maidens||0, runouts: s.runouts||0, potm: !!s.player_of_match };
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
    + '<div class="scores-grid-wrap"><div class="scores-grid-row scores-grid-head"><span>Player</span><span>Runs</span><span>Wkts</span><span>Catches</span><span>Stump.</span><span>Econ.</span><span>Maidens</span><span>Run-outs</span><span>POTM</span><span></span></div>'
    + allScorePlayers.map(function(p) {
        var s = existing[p.id] || null;
        // Only pre-fill if they have a score row, otherwise blank
        return '<div class="scores-grid-row" data-player-id="'+p.id+'">'
          + '<span class="sc-player-name">'+esc(p.name)+'<small>'+esc(p.role)+'</small></span>'
          + '<input type="number" min="0" class="sc-runs"      placeholder="—" value="'+(s?s.runs:'')+'">'
          + '<input type="number" min="0" class="sc-wickets"   placeholder="—" value="'+(s?s.wickets:'')+'">'
          + '<input type="number" min="0" class="sc-catches"   placeholder="—" value="'+(s?s.catches:'')+'">'
          + '<input type="number" min="0" class="sc-stumpings" placeholder="—" value="'+(s?s.stumpings:'')+'">'
          + '<input type="number" min="0" step="0.01" class="sc-economy"   placeholder="—" value="'+(s&&s.economy!=null?s.economy:'')+'">'
          + '<input type="number" min="0" class="sc-maidens"   placeholder="—" value="'+(s&&s.maidens!=null?s.maidens:'')+'">'
          + '<input type="number" min="0" class="sc-runouts"   placeholder="—" value="'+(s&&s.runouts!=null?s.runouts:'')+'">'
          + '<div class="scores-potm"><input type="checkbox" class="sc-potm" '+(s&&s.potm?'checked':'')+' title="POTM"></div>'
          + '<button class="btn-sm sc-clear-row" title="Clear row" style="opacity:0.4">✕</button>'
          + '</div>';
      }).join('') + '</div>';

  // Clear row buttons
  content.querySelectorAll('.sc-clear-row').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var row = btn.closest('.scores-grid-row');
      row.querySelector('.sc-runs').value      = '';
      row.querySelector('.sc-wickets').value   = '';
      row.querySelector('.sc-catches').value   = '';
      row.querySelector('.sc-stumpings').value = '';
      row.querySelector('.sc-economy').value   = '';
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
    var economy   = row.querySelector('.sc-economy').value;
    var maidens   = row.querySelector('.sc-maidens').value;
    var runouts   = row.querySelector('.sc-runouts').value;
    var potm      = row.querySelector('.sc-potm').checked;
    // Only include players who have at least one field filled in
    if (runs === '' && wickets === '' && catches === '' && stumpings === '' &&
        economy === '' && maidens === '' && runouts === '' && !potm) return;
    match.players.push({
      playerId:  row.dataset.playerId,
      runs:      parseInt(runs)      || 0,
      wickets:   parseInt(wickets)   || 0,
      catches:   parseInt(catches)   || 0,
      stumpings: parseInt(stumpings) || 0,
      economy:   economy !== '' ? parseFloat(economy) : null,
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
    // Delete existing scores for this round first, then re-insert
    await adminAPI('fantasy.clearRoundScores', { round_id: currentScoreRound });
    await adminAPI('fantasy.saveScores', { scores: scores });
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
    fetch(SUPABASE_URL+'/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name,email', {headers:H}).then(function(r){return r.ok?r.json():[];}),
    fetch(SUPABASE_URL+'/rest/v1/fantasy_picks?select=*', {headers:H}).then(function(r){return r.ok?r.json():[];}),
    fetch(SUPABASE_URL+'/rest/v1/fantasy_scores?select=*', {headers:H}).then(function(r){return r.ok?r.json():[];}),
    fetch(SUPABASE_URL+'/rest/v1/fantasy_rounds?select=id,name,wildcard&order=created_at.asc', {headers:H}).then(function(r){return r.ok?r.json():[];}),
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
  var scoreLookup = {};
  scores.forEach(function(s) {
    var key = s.round_id + '_' + s.player_id;
    if (!scoreLookup[key]) scoreLookup[key] = { runs:0, wickets:0, catches:0, stumpings:0, player_of_match:false };
    scoreLookup[key].runs      += s.runs      || 0;
    scoreLookup[key].wickets   += s.wickets   || 0;
    scoreLookup[key].catches   += s.catches   || 0;
    scoreLookup[key].stumpings += s.stumpings || 0;
    if (s.player_of_match) scoreLookup[key].player_of_match = true;
  });

  // calcPoints is defined in fantasy-badges.js scope (badges.html has its own copy)
  // We need it here too — inline simplified version matching the badge engine's expectations
  function _calcPts(score, isCap, isWild, isVC) {
    var pts = 0, runs = score.runs || 0, wkts = score.wickets || 0;
    pts += runs;
    if (runs >= 50)  pts += 10;
    if (runs >= 100) pts += 25;
    pts += wkts * 15;
    if (wkts >= 5) pts += 20;
    pts += (score.catches || 0) * 10 + (score.stumpings || 0) * 10 + (score.runouts || 0) * 10;
    if (score.player_of_match) pts += 25;
    if (isCap) pts = isWild ? pts * 3 : pts * 2;
    else if (isVC) pts = Math.round(pts * 1.5);
    return pts;
  }

  var totals = {};
  picks.forEach(function(pick) {
    var pid = pick.participant_id;
    if (!totals[pid]) totals[pid] = { participantId: pid, points: 0, rounds: 0, roundPts: {}, picks: [] };
    var isWild = allRounds[pick.round_id] ? allRounds[pick.round_id].wildcard : false;
    var rp = 0;
    (pick.player_ids || []).forEach(function(playerId) {
      var s = scoreLookup[pick.round_id + '_' + playerId];
      if (s) rp += _calcPts(s, playerId === pick.captain_id, isWild, playerId === pick.vice_captain_id);
    });
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
      var econRaw = row['Economy'] || row['economy'] || row['Econ'] || row['econ'] || '';
      matched.push({
        playerId:  player.id,
        runs:      parseInt(row['Runs']      || row['runs']      || 0) || 0,
        wickets:   parseInt(row['Wickets']   || row['wickets']   || 0) || 0,
        catches:   parseInt(row['Catches']   || row['catches']   || 0) || 0,
        stumpings: parseInt(row['Stumpings'] || row['stumpings'] || 0) || 0,
        maidens:   parseInt(row['Maidens']   || row['maidens']   || 0) || 0,
        runouts:   parseInt(row['Run Outs']  || row['run_outs']  || row['Run-outs'] || row['runouts'] || 0) || 0,
        economy:   econRaw !== '' ? parseFloat(econRaw) : null,
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
    var r    = await fetch(SUPABASE_URL+'/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name,email&order=name.asc', {headers:H});
    var rows = await r.json();
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
    var r    = await fetch(SUPABASE_URL+'/rest/v1/fantasy_participants?status=eq.pending&select=*&order=created_at.asc', {headers:H});
    var rows = await r.json();
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
    var r = await fetch(SUPABASE_URL + '/rest/v1/players?select=id,name,role,active,captain,vice_captain,photo_url,squad&order=name.asc', { headers: H });
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

async function loadPlayerEditor(id) {
  var r = await fetch(SUPABASE_URL + '/rest/v1/players?id=eq.' + id + '&select=*', { headers: H });
  var rows = await r.json();
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
  chair:     'Chair'
};

function renderAdminUsers() {
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
