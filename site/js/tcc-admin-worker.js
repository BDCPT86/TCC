/**
 * TCC Admin API Worker
 * 
 * Deploy as a Cloudflare Worker.
 * Set these environment variables (Secrets) in the Worker settings:
 *   SUPABASE_URL          = https://cgjannvzpqecwzjdzwso.supabase.co
 *   SUPABASE_SERVICE_KEY  = <your service role key from Supabase dashboard>
 *   JWT_SECRET            = <long random string — 32+ chars>
 *   EMAILJS_SERVICE_ID    = service_bm93b1f
 *   EMAILJS_TEMPLATE_ID   = template_7zsaamp
 *   EMAILJS_PUBLIC_KEY    = 1WxxEA04fur2LEm8x
 *   EMAILJS_PRIVATE_KEY   = <your EmailJS private key from emailjs.com → Account → API Keys>
 *   TURNSTILE_SECRET      = <your Turnstile secret key from Cloudflare dashboard>
 *
 * Routes:
 *   POST tygerbergcc.co.za/api/admin/*   — admin API
 *   GET  tygerbergcc.co.za/news.html     — OG meta injection for share crawlers
 *
 * SETUP STEPS:
 *   1. Cloudflare Dashboard → Workers & Pages → Create Worker
 *   2. Paste this code → Deploy
 *   3. Worker Settings → Variables → Add the secrets above
 *   4. Settings → Triggers → Add Routes:
 *        tygerbergcc.co.za/api/admin/*
 *        tygerbergcc.co.za/news.html
 */

export default {
  async fetch(request, env, ctx) {

/* ══════════════════════════════════════════════════════
   JWT HELPERS  (HS256, Web Crypto — CF Workers native)
══════════════════════════════════════════════════════ */
const JWT_EXPIRY_SECS = 4 * 60 * 60; // 4 hours

async function jwtSign(payload, secret) {
  const enc  = s => btoa(JSON.stringify(s)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const header = enc({ alg: 'HS256', typ: 'JWT' });
  const body   = enc(payload);
  const data   = `${header}.${body}`;
  const key    = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig    = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${data}.${sigB64}`;
}

async function jwtVerify(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(
      atob(sig.replace(/-/g,'+').replace(/_/g,'/')),
      c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, sigBytes, new TextEncoder().encode(data)
    );
    if (!valid) return null;
    const payload = JSON.parse(atob(body.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

/* ══════════════════════════════════════════════════════
   ROLE PERMISSIONS
   '*' = full access. All other values are exact action strings.
══════════════════════════════════════════════════════ */
const ROLE_PERMISSIONS = {
  super: ['*'],
  scores: [
    'fantasy.savePlayerValues',
    'fantasy.createRound','fantasy.updateRound','fantasy.lockRound','fantasy.unlockRound','fantasy.deleteRound',
    'fantasy.clearRoundScores','fantasy.saveScores','fantasy.notifyScores',
    'fantasy.createH2HFixtures','fantasy.resolveH2H','fantasy.resendH2HDraw','fantasy.resendH2HResult',
    'fantasy.saveBadgesAndNotify','fantasy.autoScoreRound',
    'player.insert','player.update','player.delete',
    'fixtures.insert','fixtures.update','fixtures.delete',
  ],
  content: [
    'gallery.insert','gallery.update','gallery.delete','gallery.deleteAlbum','gallery.updateOrder','gallery.renameAlbum',
    'storage.upload','storage.uploadNews','storage.delete',
    'news.insert','news.update','news.delete',
    'bio.list','bio.approve','bio.reject',
    'player.insert','player.update',
  ],
  fixtures: [
    'fixtures.insert','fixtures.update','fixtures.delete',
  ],
  registrar: [
    'fantasy.approveParticipant','fantasy.rejectParticipant','fantasy.deleteParticipant',
    'bio.list','bio.approve','bio.reject',
  ],
};

function isAllowed(role, action) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(action);
}


    const url = new URL(request.url);

    // ── CORS preflight
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    // ── GET /news.html?id=<uuid> — inject article OG meta tags for share crawlers
    if (request.method === 'GET' && url.pathname === '/news.html') {
      const id = url.searchParams.get('id');
      if (id) {
        try {
          const SB  = env.SUPABASE_URL;
          const KEY = env.SUPABASE_SERVICE_KEY;
          const H   = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

          // Fetch article and page HTML in parallel
          const [articleRes, pageRes] = await Promise.all([
            fetch(`${SB}/rest/v1/news?id=eq.${id}&published=eq.true&select=title,content,cover_image,created_at`, { headers: H }),
            fetch(request, { cf: { cacheEverything: false } })   // pass through to origin
          ]);

          // If article not found or page fetch failed, just pass through
          if (!articleRes.ok || !pageRes.ok) return pageRes;

          const articles = await articleRes.json();
          if (!articles || !articles.length) return pageRes;

          const article = articles[0];
          const title   = article.title + ' | Tygerberg Cricket Club';
          const desc    = (article.content || '').replace(/<[^>]+>/g, '').substring(0, 160).trim();
          const image   = article.cover_image || 'https://tygerbergcc.co.za/images/og-image.jpg';
          const canon   = `https://tygerbergcc.co.za/news.html?id=${id}`;

          let html = await pageRes.text();

          // Inject correct OG tags immediately after <head> — crawlers use first occurrence
          const injected = [
            '<title>' + escHtml(title) + '</title>',
            '<meta property="og:title" content="' + escHtml(title) + '">',
            '<meta property="og:description" content="' + escHtml(desc) + '">',
            '<meta property="og:image" content="' + escHtml(image) + '">',
            '<meta property="og:image:width" content="1200">',
            '<meta property="og:image:height" content="630">',
            '<meta property="og:url" content="' + escHtml(canon) + '">',
            '<meta property="og:type" content="article">',
            '<meta name="twitter:card" content="summary_large_image">',
            '<meta name="twitter:title" content="' + escHtml(title) + '">',
            '<meta name="twitter:description" content="' + escHtml(desc) + '">',
            '<meta name="twitter:image" content="' + escHtml(image) + '">',
          ].join('\n');
          html = html.replace('<head>', '<head>\n' + injected);

          return new Response(html, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',   // don't cache — each article is different
            }
          });
        } catch (err) {
          // On any error, fall through to normal page delivery
          return fetch(request);
        }
      }
      // No ?id= param — serve the page normally
      return fetch(request);
    }

    // ── Only accept POST requests for admin API
    if (request.method !== 'POST') {
      return cors(new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 }));
    }

    let body;
    try { body = await request.json(); }
    catch { return cors(new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })); }

    const { action, payload } = body;

    // ── Public actions — no auth needed
    const publicActions = [
      'admin.login',
      'contact.send','fantasy.sendOTP','fantasy.verifyOTP','fantasy.updateProfile',
      'fantasy.register','bio.submit','push.subscribe','push.unsubscribe',
      'push.dispatch','fantasy.subscribePush'
    ];

    if (!publicActions.includes(action)) {
      // All protected actions require a valid JWT
      const token   = body.token || '';
      const claims  = await jwtVerify(token, env.JWT_SECRET || '');
      if (!claims) {
        return cors(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
      }
      if (!isAllowed(claims.role, action)) {
        return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
      }
      // Attach claims so action handlers can inspect role if needed
      body._claims = claims;
    }
    const SB  = env.SUPABASE_URL;
    const KEY = env.SUPABASE_SERVICE_KEY;
    const H   = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };


    // ── H2H email helpers ──────────────────────────────────────────────
    const h2hInitials = n => (n||'??').split(' ').slice(0,2).map(w=>w[0].toUpperCase()).join('');
    const h2hFmtDl = iso => {
      try {
        const d = new Date(iso);
        return d.toLocaleDateString('en-ZA',{weekday:'short',day:'numeric',month:'long'})
               + ' \u00b7 '
               + d.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Africa/Johannesburg'});
      } catch(e) { return iso||'TBC'; }
    };

    const sendH2HDrawEmail = async (SB, KEY, env, participant, oppTeam, roundName, deadline) => {
      if (!participant || !participant.email) return;
      const me  = participant.team_name || participant.name;
      const opp = oppTeam || 'Mr. Average';
      const html = `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"><tr><td style="background:#1A2B1C;padding:28px 28px 24px;border-radius:8px 8px 0 0;"><div style="font-size:10px;color:#C9A84C;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Head-to-Head &middot; ${roundName}</div><div style="font-size:22px;font-weight:600;color:#F0EBD8;line-height:1.3;">The draw is in.<br>Your opponent awaits.</div></td></tr><tr><td style="background:#ffffff;padding:24px 28px;border-left:1px solid #e0ddd4;border-right:1px solid #e0ddd4;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td width="44%" valign="middle"><div style="width:42px;height:42px;border-radius:50%;background:#EAF3DE;text-align:center;line-height:42px;font-size:13px;font-weight:600;color:#3B6D11;margin-bottom:8px;">${h2hInitials(me)}</div><div style="font-size:13px;font-weight:600;color:#1a1a1a;">${me}</div><div style="font-size:11px;color:#888;">You</div></td><td width="12%" valign="middle" align="center"><div style="font-size:20px;color:#1A2B1C;">&#9876;</div><div style="font-size:9px;color:#aaa;letter-spacing:0.1em;text-transform:uppercase;">vs</div></td><td width="44%" valign="middle" align="right"><div style="width:42px;height:42px;border-radius:50%;background:#FAECE7;text-align:center;line-height:42px;font-size:13px;font-weight:600;color:#993C1D;margin-bottom:8px;margin-left:auto;">${h2hInitials(opp)}</div><div style="font-size:13px;font-weight:600;color:#1a1a1a;">${opp}</div><div style="font-size:11px;color:#888;">Opponent</div></td></tr></table></td></tr><tr><td style="background:#ffffff;padding:4px 28px 16px;border-left:1px solid #e0ddd4;border-right:1px solid #e0ddd4;border-bottom:1px solid #eeebe4;"><p style="font-size:13px;color:#555;line-height:1.75;margin:0;">Pick your best XI before the deadline and outscore <strong>${opp}</strong> to claim the win.</p></td></tr><tr><td style="background:#ffffff;padding:14px 28px;border-left:1px solid #e0ddd4;border-right:1px solid #e0ddd4;border-bottom:1px solid #eeebe4;"><span style="font-size:11px;color:#888;font-weight:500;">Picks close &nbsp;</span><span style="font-size:13px;color:#1a1a1a;font-weight:600;">${deadline}</span></td></tr><tr><td style="background:#ffffff;padding:20px 28px;border:1px solid #e0ddd4;border-top:none;border-radius:0 0 8px 8px;"><a href="https://tygerbergcc.co.za/pick.html" style="display:block;background:#1A2B1C;color:#C9A84C;text-align:center;padding:12px 0;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.07em;text-decoration:none;">Pick your XI &rarr;</a><p style="font-size:11px;color:#aaa;text-align:center;margin:12px 0 0;font-style:italic;">Facta Non Verba</p></td></tr></table>`;
      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: env.EMAILJS_SERVICE_ID, template_id: 'template_iifjomq',
          user_id: env.EMAILJS_PUBLIC_KEY, accessToken: env.EMAILJS_PRIVATE_KEY,
          template_params: { to_email: participant.email, email: participant.email,
            subject: '\u2694\ufe0f H2H Draw \u2014 ' + roundName, name: me, message: html }
        })
      }).catch(() => {});
    };

    const sendH2HResultEmail = async (SB, KEY, env, participant, myPts, oppPts, oppTeamName, winnerId, isMrAvg, roundName, seasonRecord) => {
      if (!participant || !participant.email) return;
      const me    = participant.team_name || participant.name;
      const opp   = oppTeamName || 'Mr. Average';
      const isWin = isMrAvg ? myPts > oppPts : winnerId === participant.id;
      const isDraw = !isMrAvg && winnerId === null;
      const state  = isWin ? 'win' : isDraw ? 'draw' : 'loss';
      const badgeColor  = { win:'#1D9E75', draw:'#BA7517', loss:'#A32D2D' }[state];
      const badgeBg     = { win:'rgba(29,158,117,0.12)', draw:'rgba(186,117,23,0.12)', loss:'rgba(162,45,45,0.12)' }[state];
      const ptsColor    = { win:'#1D9E75', draw:'#BA7517', loss:'#A32D2D' }[state];
      const pillBg      = { win:'#EAF3DE', draw:'#FAEEDA', loss:'#FCEBEB' }[state];
      const pillTxt     = { win:'#3B6D11', draw:'#633806', loss:'#501313' }[state];
      const label       = { win:'Victory', draw:'Draw', loss:'Defeat' }[state];
      const title       = { win:'You won the H2H.<br>Well played.', draw:"It&#39;s a draw.<br>Evenly matched.", loss:'You lost this one.<br>Bounce back next round.' }[state];
      const margin      = Math.abs(myPts - oppPts);
      const total       = myPts + oppPts || 1;
      const barPct      = Math.round((Math.max(myPts,oppPts)/total)*100);
      const h2hPts      = isWin ? 3 : isDraw ? 1 : 0;
      const emoji       = isWin ? '\ud83c\udfc6' : isDraw ? '\ud83e\udd1d' : '\ud83d\udc94';
      const html = `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"><tr><td style="background:#1A2B1C;padding:28px 28px 24px;border-radius:8px 8px 0 0;"><div style="display:inline-block;background:${badgeBg};border:1px solid ${badgeColor};border-radius:4px;padding:3px 10px;font-size:10px;font-weight:600;color:${badgeColor};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:10px;">${label}</div><div style="font-size:22px;font-weight:600;color:#F0EBD8;line-height:1.3;">${title}</div></td></tr><tr><td style="background:#ffffff;padding:24px 28px;border-left:1px solid #e0ddd4;border-right:1px solid #e0ddd4;border-bottom:1px solid #eeebe4;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td width="44%" valign="top"><div style="width:42px;height:42px;border-radius:50%;background:#EAF3DE;text-align:center;line-height:42px;font-size:13px;font-weight:600;color:#3B6D11;margin-bottom:8px;">${h2hInitials(me)}</div><div style="font-size:13px;font-weight:600;color:#1a1a1a;">${me}</div><div style="font-size:26px;font-weight:500;color:${ptsColor};line-height:1;margin-top:6px;">${myPts}</div><div style="font-size:10px;color:#aaa;letter-spacing:0.1em;text-transform:uppercase;">pts</div></td><td width="12%" valign="middle" align="center"><div style="width:1px;height:60px;background:#e8e4dc;margin:0 auto;"></div></td><td width="44%" valign="top" align="right"><div style="width:42px;height:42px;border-radius:50%;background:#FAECE7;text-align:center;line-height:42px;font-size:13px;font-weight:600;color:#993C1D;margin-bottom:8px;margin-left:auto;">${h2hInitials(opp)}</div><div style="font-size:13px;font-weight:600;color:#1a1a1a;">${opp}</div><div style="font-size:26px;font-weight:500;color:#888;line-height:1;margin-top:6px;">${oppPts}</div><div style="font-size:10px;color:#aaa;letter-spacing:0.1em;text-transform:uppercase;">pts</div></td></tr></table><table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;margin-bottom:5px;"><tr><td style="font-size:11px;color:#888;">${isDraw?'Tied':isWin?'Winning margin':'Losing margin'}</td><td align="right" style="font-size:11px;font-weight:600;color:${ptsColor};">${isDraw?'Level':(isWin?'+':'-')+margin+' pts'}</td></tr></table><div style="height:4px;background:#e8e4dc;border-radius:2px;overflow:hidden;"><div style="height:100%;width:${barPct}%;background:${ptsColor};border-radius:2px;"></div></div></td></tr><tr><td style="background:#ffffff;padding:14px 28px;border-left:1px solid #e0ddd4;border-right:1px solid #e0ddd4;border-bottom:1px solid #eeebe4;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td><span style="font-size:11px;color:#888;display:block;">Season H2H record</span><span style="font-size:13px;font-weight:600;color:#1a1a1a;">${seasonRecord}</span></td><td align="right"><span style="background:${pillBg};color:${pillTxt};border-radius:4px;padding:4px 12px;font-size:12px;font-weight:600;">${h2hPts} H2H pts</span></td></tr></table></td></tr><tr><td style="background:#ffffff;padding:20px 28px;border:1px solid #e0ddd4;border-top:none;border-radius:0 0 8px 8px;"><a href="https://tygerbergcc.co.za/leaderboard.html" style="display:block;background:#1A2B1C;color:#C9A84C;text-align:center;padding:12px 0;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.07em;text-decoration:none;">View leaderboard &rarr;</a><p style="font-size:11px;color:#aaa;text-align:center;margin:12px 0 0;font-style:italic;">Facta Non Verba</p></td></tr></table>`;
      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: env.EMAILJS_SERVICE_ID, template_id: 'template_iifjomq',
          user_id: env.EMAILJS_PUBLIC_KEY, accessToken: env.EMAILJS_PRIVATE_KEY,
          template_params: { to_email: participant.email, email: participant.email,
            subject: emoji + ' H2H Result \u2014 ' + roundName, name: me, message: html }
        })
      }).catch(() => {});
    };

    try {
      switch (action) {

        // ══════════════════════════════════════════════════════
        // ADMIN AUTH + USER MANAGEMENT
        // ══════════════════════════════════════════════════════

        // Login — validates username/password, returns signed JWT + role
        case 'admin.login': {
          const { username, password_hash } = payload || {};
          if (!username || !password_hash) {
            return cors(new Response(JSON.stringify({ error: 'Missing credentials' }), { status: 400 }));
          }
          const r = await fetch(
            `${SB}/rest/v1/admin_users?username=eq.${encodeURIComponent(username)}&active=eq.true&select=id,name,username,role,password_hash`,
            { headers: H }
          );
          const rows = await r.json();
          const user = Array.isArray(rows) ? rows[0] : null;
          if (!user || user.password_hash !== password_hash) {
            return cors(new Response(JSON.stringify({ error: 'Invalid username or password' }), { status: 401 }));
          }
          // Update last_login (non-fatal)
          fetch(`${SB}/rest/v1/admin_users?id=eq.${user.id}`, {
            method: 'PATCH',
            headers: { ...H, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ last_login: new Date().toISOString() })
          }).catch(() => {});
          const token = await jwtSign({
            sub:      user.id,
            username: user.username,
            name:     user.name,
            role:     user.role,
            exp:      Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECS,
          }, env.JWT_SECRET || '');
          return cors(new Response(JSON.stringify({ token, role: user.role, name: user.name }), { status: 200 }));
        }

        // List all admin users (super only — enforced by ROLE_PERMISSIONS)
        case 'admin.listUsers': {
          const r = await fetch(
            `${SB}/rest/v1/admin_users?select=id,name,username,role,active,created_at,last_login&order=created_at.asc`,
            { headers: H }
          );
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // Create a new admin user
        case 'admin.createUser': {
          const { name, username, password_hash, role } = payload || {};
          if (!name || !username || !password_hash || !role) {
            return cors(new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 }));
          }
          const r = await fetch(`${SB}/rest/v1/admin_users`, {
            method: 'POST',
            headers: { ...H, 'Prefer': 'return=representation' },
            body: JSON.stringify({ name, username, password_hash, role, active: true })
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // Update an existing admin user (name, role, active — not username)
        case 'admin.updateUser': {
          const { id, name, role, active, password_hash } = payload || {};
          if (!id) return cors(new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 }));
          const patch = {};
          if (name     !== undefined) patch.name          = name;
          if (role     !== undefined) patch.role          = role;
          if (active   !== undefined) patch.active        = active;
          if (password_hash)          patch.password_hash = password_hash;
          const r = await fetch(`${SB}/rest/v1/admin_users?id=eq.${id}`, {
            method: 'PATCH',
            headers: { ...H, 'Prefer': 'return=minimal' },
            body: JSON.stringify(patch)
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // Deactivate (soft-delete) an admin user
        case 'admin.deactivateUser': {
          const { id } = payload || {};
          if (!id) return cors(new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 }));
          // Prevent deactivating yourself
          if (body._claims && body._claims.sub === id) {
            return cors(new Response(JSON.stringify({ error: 'Cannot deactivate yourself' }), { status: 400 }));
          }
          const r = await fetch(`${SB}/rest/v1/admin_users?id=eq.${id}`, {
            method: 'PATCH',
            headers: { ...H, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ active: false })
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ══════════════════════════════════════════════════════

        // ── GALLERY: insert row after image upload
        case 'gallery.insert': {
          const r = await fetch(`${SB}/rest/v1/gallery`, { method: 'POST', headers: H, body: JSON.stringify(payload) });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── GALLERY: update row (sort order, album rename, etc)
        case 'gallery.update': {
          const { id, data } = payload;
          const r = await fetch(`${SB}/rest/v1/gallery?id=eq.${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(data) });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── GALLERY: delete row
        case 'gallery.delete': {
          const { id } = payload;
          const r = await fetch(`${SB}/rest/v1/gallery?id=eq.${id}`, { method: 'DELETE', headers: H });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── GALLERY: delete entire album rows
        case 'gallery.deleteAlbum': {
          const { album } = payload;
          const r = await fetch(`${SB}/rest/v1/gallery?album=eq.${encodeURIComponent(album)}`, { method: 'DELETE', headers: H });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── STORAGE: upload image (binary — payload contains fileName + contentType, file sent as base64)
        case 'storage.upload': {
          const { fileName, contentType, base64 } = payload;
          const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const storageH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': contentType, 'x-upsert': 'false' };
          const r = await fetch(`${SB}/storage/v1/object/gallery/${fileName}`, { method: 'POST', headers: storageH, body: binary });
          const publicUrl = `${SB}/storage/v1/object/public/gallery/${fileName}`;
          return cors(new Response(JSON.stringify({ url: publicUrl, status: r.status }), { status: r.ok ? 200 : r.status }));
        }

        // ── STORAGE: upload news cover image to 'news' bucket
        case 'storage.uploadNews': {
          const { fileName, contentType, base64 } = payload;
          const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const storageH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': contentType, 'x-upsert': 'true' };
          const r = await fetch(`${SB}/storage/v1/object/news/${fileName}`, { method: 'POST', headers: storageH, body: binary });
          const publicUrl = `${SB}/storage/v1/object/public/news/${fileName}`;
          return cors(new Response(JSON.stringify({ url: publicUrl, status: r.status }), { status: r.ok ? 200 : r.status }));
        }

        // ── STORAGE: delete image
        case 'storage.delete': {
          const { path } = payload;
          const storageH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };
          const r = await fetch(`${SB}/storage/v1/object/gallery/${path}`, { method: 'DELETE', headers: storageH });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── GALLERY: update sort orders (batch)
        case 'gallery.updateOrder': {
          const { items } = payload; // [{ id, sort_order }, ...]
          const results = await Promise.all(items.map(item =>
            fetch(`${SB}/rest/v1/gallery?id=eq.${item.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ sort_order: item.sort_order }) })
          ));
          const ok = results.every(r => r.ok);
          return cors(new Response(JSON.stringify({ ok }), { status: ok ? 200 : 500 }));
        }

        // ── GALLERY: rename album
        case 'gallery.renameAlbum': {
          const { oldName, newName, category, date } = payload;
          const r = await fetch(`${SB}/rest/v1/gallery?album=eq.${encodeURIComponent(oldName)}`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({ album: newName, category, taken_at: date || null })
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── NEWS: insert article — returns the new row with ID
        case 'news.insert': {
          const fetchH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
          const r = await fetch(`${SB}/rest/v1/news`, { method: 'POST', headers: fetchH, body: JSON.stringify(payload) });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── NEWS: update article
        case 'news.update': {
          const { id, data } = payload;
          const r = await fetch(`${SB}/rest/v1/news?id=eq.${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(data) });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── NEWS: delete article
        case 'news.delete': {
          const { id } = payload;
          const r = await fetch(`${SB}/rest/v1/news?id=eq.${id}`, { method: 'DELETE', headers: H });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── FANTASY: save player values via Supabase RPC (single subrequest)
        case 'fantasy.savePlayerValues': {
          const { updates } = payload;
          if (!updates || !updates.length) return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
          const rpcH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
          const r = await fetch(`${SB}/rest/v1/rpc/update_player_values`, {
            method: 'POST', headers: rpcH,
            body: JSON.stringify({ updates_json: updates })
          });
          const text = await r.text();
          if (!r.ok) return cors(new Response(JSON.stringify({ error: 'RPC failed ' + r.status + ': ' + text }), { status: 500 }));
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── FANTASY: create round
        case 'fantasy.createRound': {
          const { fixture_ids, ...roundFields } = payload;
          if (roundFields.h2h === undefined) roundFields.h2h = false;
          const r = await fetch(`${SB}/rest/v1/fantasy_rounds`, { method: 'POST', headers: H, body: JSON.stringify(roundFields) });
          if (!r.ok) return cors(new Response(await r.text(), { status: r.status }));
          const created = await r.json();
          const roundId = Array.isArray(created) ? created[0]?.id : created?.id;
          if (roundId && Array.isArray(fixture_ids) && fixture_ids.length) {
            const rows = fixture_ids.map(fid => ({ round_id: roundId, fixture_id: parseInt(fid, 10) }));
            await fetch(`${SB}/rest/v1/fantasy_round_fixtures`, {
              method: 'POST', headers: H, body: JSON.stringify(rows)
            });
          }
          return cors(new Response(JSON.stringify(created), { status: 200 }));
        }

        // ── FANTASY: update round
        case 'fantasy.updateRound': {
          const { id, name, deadline, wildcard, h2h, fixture_ids } = payload;
          const patch = { name, deadline };
          if (wildcard !== undefined) patch.wildcard = wildcard;
          if (payload.boost_modifier !== undefined) patch.boost_modifier = payload.boost_modifier;
          if (h2h !== undefined) patch.h2h = h2h;
          const r = await fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${id}`, {
            method: 'PATCH', headers: H, body: JSON.stringify(patch)
          });
          if (!r.ok) return cors(new Response(await r.text(), { status: r.status }));
          // Replace fixture links
          if (Array.isArray(fixture_ids)) {
            await fetch(`${SB}/rest/v1/fantasy_round_fixtures?round_id=eq.${id}`, { method: 'DELETE', headers: H });
            if (fixture_ids.length) {
              const rows = fixture_ids.map(fid => ({ round_id: id, fixture_id: parseInt(fid, 10) }));
              await fetch(`${SB}/rest/v1/fantasy_round_fixtures`, { method: 'POST', headers: H, body: JSON.stringify(rows) });
            }
          }
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── FANTASY: lock round + notify participants who have picks
        case 'fantasy.lockRound': {
          const lockId = payload.id;

          // 1. Lock the round
          const lockR = await fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${lockId}`, { method: 'PATCH', headers: H, body: JSON.stringify({ locked: true }) });
          if (!lockR.ok) return cors(new Response(await lockR.text(), { status: lockR.status }));

          // 2. Fetch round name (non-fatal if missing)
          let roundName = 'This round';
          try {
            const rnR  = await fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${lockId}&select=name`, { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
            const rnD  = await rnR.json();
            if (Array.isArray(rnD) && rnD.length) roundName = rnD[0].name || roundName;
          } catch(e) {}

          // 3. Fetch picks for this round joined to participant details
          let sent = 0;
          try {
            const pickR  = await fetch(`${SB}/rest/v1/fantasy_picks?round_id=eq.${lockId}&select=participant_id,fantasy_participants(name,team_name,email)`, {
              headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY }
            });
            const picks = await pickR.json();
            if (Array.isArray(picks) && picks.length) {

              // Deduplicate by participant
              const seen = {};
              const participants = [];
              picks.forEach(p => {
                if (!seen[p.participant_id] && p.fantasy_participants) {
                  seen[p.participant_id] = true;
                  participants.push(p.fantasy_participants);
                }
              });

              // Build styled HTML email
              const buildLockHtml = (displayName, rName) => `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"><tr><td style="background:#1A2B1C;padding:28px 28px 24px;border-radius:8px 8px 0 0;"><div style="font-size:10px;color:#C9A84C;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">${rName}</div><div style="font-size:22px;font-weight:600;color:#F0EBD8;line-height:1.3;">🔒 Picks locked.<br>Your XI is set.</div></td></tr><tr><td style="background:#ffffff;padding:24px 28px;border-left:1px solid #e0ddd4;border-right:1px solid #e0ddd4;border-bottom:1px solid #eeebe4;"><p style="font-size:14px;color:#1a1a1a;font-weight:600;margin:0 0 8px;">Hi ${displayName},</p><p style="font-size:13px;color:#555;line-height:1.75;margin:0;">The deadline has passed and your XI is locked in. Sit back and watch the points roll in — results will be published once the round is scored.</p></td></tr><tr><td style="background:#ffffff;padding:20px 28px;border:1px solid #e0ddd4;border-top:none;border-radius:0 0 8px 8px;"><a href="https://tygerbergcc.co.za/leaderboard.html" style="display:block;background:#1A2B1C;color:#C9A84C;text-align:center;padding:12px 0;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.07em;text-decoration:none;">View leaderboard &rarr;</a><p style="font-size:11px;color:#aaa;text-align:center;margin:12px 0 0;font-style:italic;">Facta Non Verba</p></td></tr></table>`;

              for (const p of participants) {
                if (!p.email) continue;
                const displayName = p.team_name || p.name;
                const html = buildLockHtml(displayName, roundName);
                await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    service_id:  env.EMAILJS_SERVICE_ID,
                    template_id: 'template_iifjomq',
                    user_id:     env.EMAILJS_PUBLIC_KEY,
                    accessToken: env.EMAILJS_PRIVATE_KEY,
                    template_params: {
                      to_email: p.email,
                      email:    p.email,
                      subject:  '🔒 Picks locked — ' + roundName,
                      name:     displayName,
                      message:  html
                    }
                  })
                }).catch(() => {}); // non-fatal
                sent++;
              }
            }
          } catch(e) {
            // Email failure must not block the lock response
          }

          return cors(new Response(JSON.stringify({ ok: true, sent }), { status: 200 }));
        }

        // ── FANTASY: unlock round
        case 'fantasy.unlockRound': {
          const r = await fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${payload.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ locked: false }) });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── FANTASY: clear all scores for a round before re-saving
        case 'fantasy.clearRoundScores': {
          const { round_id } = payload;
          const r = await fetch(`${SB}/rest/v1/fantasy_scores?round_id=eq.${round_id}`, { method: 'DELETE', headers: H });
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── FANTASY: save scores (insert — always fresh after clearRoundScores)
        case 'fantasy.saveScores': {
          const insertH = Object.assign({}, H, { 'Prefer': 'return=minimal' });
          const r = await fetch(`${SB}/rest/v1/fantasy_scores`, { method: 'POST', headers: insertH, body: JSON.stringify(payload.scores) });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── FANTASY: notify participants that scores are published
        // ── FANTASY: subscribe to deadline push reminders
        case 'fantasy.subscribePush': {
          const { endpoint, p256dh, auth, participant_id } = payload;
          if (!endpoint || !p256dh || !auth) {
            return cors(new Response(JSON.stringify({ error: 'Missing subscription fields' }), { status: 400 }));
          }
          const pH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };
          const subBody = { endpoint, p256dh, auth, source: 'fantasy' };
          if (participant_id) subBody.participant_id = participant_id;
          await fetch(`${SB}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
            method: 'POST', headers: pH,
            body: JSON.stringify(subBody)
          });
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── FANTASY: save newly earned badges + send targeted push notifications
        case 'fantasy.saveBadgesAndNotify': {
          const { badges } = payload; // [{participant_id, badge_id, badge_name, badge_icon, round_id, participant_name, participant_email}]
          if (!badges || !badges.length) return cors(new Response(JSON.stringify({ ok: true, saved: 0 }), { status: 200 }));

          const bH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=ignore-duplicates,return=minimal' };

          // 1. Upsert badges to fantasy_badges (ignore duplicates)
          const badgeRows = badges.map(b => ({
            participant_id: b.participant_id,
            badge_id:       b.badge_id,
            round_id:       b.round_id || null,
          }));
          await fetch(`${SB}/rest/v1/fantasy_badges`, {
            method: 'POST', headers: bH, body: JSON.stringify(badgeRows)
          });

          // 2. Group by participant so one push covers multiple badges earned at once
          const byParticipant = {};
          badges.forEach(b => {
            if (!byParticipant[b.participant_id]) byParticipant[b.participant_id] = { name: b.participant_name, email: b.participant_email, badges: [] };
            byParticipant[b.participant_id].badges.push({ id: b.badge_id, name: b.badge_name, icon: b.badge_icon });
          });

          const VAPID_PUBLIC  = env.VAPID_PUBLIC_KEY;
          const VAPID_PRIVATE = env.VAPID_PRIVATE_KEY;
          const VAPID_SUBJECT = 'mailto:info@tygerbergcc.co.za';

          let notified = 0;
          await Promise.allSettled(Object.entries(byParticipant).map(async ([pid, pData]) => {
            const badgeList = pData.badges;
            const title = badgeList.length === 1
              ? `${badgeList[0].icon} Badge unlocked: ${badgeList[0].name}`
              : `${badgeList.length} new badges unlocked!`;
            const body = badgeList.length === 1
              ? `You earned the ${badgeList[0].name} badge. Check your profile!`
              : badgeList.map(b => `${b.icon} ${b.name}`).join('  ·  ');

            // Look up this participant's push subscription
            const subRes = await fetch(`${SB}/rest/v1/push_subscriptions?participant_id=eq.${pid}&source=eq.fantasy&select=endpoint,p256dh,auth&limit=1`, {
              headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY }
            });
            const subs = await subRes.json();

            if (subs && subs.length && VAPID_PUBLIC && VAPID_PRIVATE) {
              const notification = JSON.stringify({ title, body, icon: 'https://tygerbergcc.co.za/images/tcc-logo.png', tag: 'tcc-badge', url: 'https://tygerbergcc.co.za/badges.html' });
              try {
                await webPushSend(subs[0], notification, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT);
                notified++;
              } catch(e) {
                if (e.message && (e.message.includes('410') || e.message.includes('404'))) {
                  await fetch(`${SB}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(subs[0].endpoint)}`, { method: 'DELETE', headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
                }
              }
            }
          }));

          return cors(new Response(JSON.stringify({ ok: true, saved: badgeRows.length, notified }), { status: 200 }));
        }

        case 'fantasy.notifyScores': {
          const { roundId, roundName } = payload;
          // Get all participants who have picks for this round
          const pickR = await fetch(`${SB}/rest/v1/fantasy_picks?round_id=eq.${roundId}&select=participant_id,fantasy_participants(name,team_name,email)`, {
            headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY }
          });
          const picks = await pickR.json();
          if (!picks || !picks.length) return cors(new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 }));

          // Deduplicate by participant
          const seen = {};
          const participants = [];
          picks.forEach(function(p) {
            if (!seen[p.participant_id] && p.fantasy_participants) {
              seen[p.participant_id] = true;
              participants.push(p.fantasy_participants);
            }
          });

          // Send email to each participant
          let sent = 0;
          for (const p of participants) {
            if (!p.email) continue;
            const displayName = p.team_name || p.name;
            await fetch('https://api.emailjs.com/api/v1.0/email/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                service_id:  env.EMAILJS_SERVICE_ID,
                template_id: 'template_iifjomq',
                user_id:     env.EMAILJS_PUBLIC_KEY,
                accessToken: env.EMAILJS_PRIVATE_KEY,
                template_params: {
                  to_email: p.email,
                  email:    p.email,
                  subject:  'Scores are in — ' + roundName,
                  name:     displayName,
                  message:  'Hi ' + displayName + ',\n\nScores for "' + roundName + '" have been published. Head to the leaderboard to see how your team performed!\n\nhttps://tygerbergcc.co.za/leaderboard.html\n\nFacta Non Verba 🏏\nTygerberg Cricket Club'
                }
              })
            });
            sent++;
          }
          return cors(new Response(JSON.stringify({ ok: true, sent }), { status: 200 }));
        }

        // ── FANTASY: delete round (cascades to picks and scores)
        case 'fantasy.deleteRound': {
          const { id } = payload;
          // Delete scores, picks, then round
          await fetch(`${SB}/rest/v1/fantasy_scores?round_id=eq.${id}`, { method: 'DELETE', headers: H });
          await fetch(`${SB}/rest/v1/fantasy_picks?round_id=eq.${id}`,  { method: 'DELETE', headers: H });
          const r = await fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${id}`, { method: 'DELETE', headers: H });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── FANTASY: delete participant
        case 'fantasy.deleteParticipant': {
          const { id } = payload;
          // Delete picks first, then participant
          await fetch(`${SB}/rest/v1/fantasy_picks?participant_id=eq.${id}`, { method: 'DELETE', headers: H });
          const r = await fetch(`${SB}/rest/v1/fantasy_participants?id=eq.${id}`, { method: 'DELETE', headers: H });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── FANTASY: update participant profile
        case 'fantasy.updateProfile': {
          const { id, team_name, name } = payload;
          const data = { team_name };
          if (name) data.name = name;
          const r = await fetch(`${SB}/rest/v1/fantasy_participants?id=eq.${id}`, {
            method: 'PATCH', headers: H, body: JSON.stringify(data)
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── FANTASY: register (creates pending participant + notifies admin)
        case 'fantasy.register': {
          const { email, name, teamName } = payload;
          const regH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

          // Check if already exists — scan all rows in case of duplicates
          const checkR = await fetch(`${SB}/rest/v1/fantasy_participants?email=eq.${encodeURIComponent(email)}&select=id,status`, { headers: regH });
          const existing = await checkR.json();
          if (existing && existing.length) {
            const statuses = existing.map(r => r.status);
            if (statuses.includes('approved')) return cors(new Response(JSON.stringify({ status: 'approved' }), { status: 200 }));
            if (statuses.includes('pending'))  return cors(new Response(JSON.stringify({ status: 'pending'  }), { status: 200 }));
          }

          // Create pending participant
          const repH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
          const cr = await fetch(`${SB}/rest/v1/fantasy_participants`, {
            method: 'POST', headers: repH,
            body: JSON.stringify({ email, name, team_name: teamName, status: 'pending' })
          });
          if (!cr.ok) {
            const crErr = await cr.text();
            return cors(new Response(JSON.stringify({ error: 'Registration failed: ' + crErr }), { status: 500 }));
          }

          // Notify admin via email
          const adminEmailPayload = {
            service_id:  env.EMAILJS_SERVICE_ID,
            template_id: 'template_iifjomq',
            user_id:     env.EMAILJS_PUBLIC_KEY,
            accessToken: env.EMAILJS_PRIVATE_KEY,
            template_params: {
              to_email: 'fantasy@tygerbergcc.co.za',
              email:    'fantasy@tygerbergcc.co.za',
              subject:  'New Fantasy League registration request',
              name:     'TCC Admin',
              message:  `New registration request for TCC Fantasy Cricket:

Name: ${name}
Team: ${teamName}
Email: ${email}

Log in to the admin panel to approve or reject:
https://tygerbergcc.co.za/admin.html

Facta Non Verba 🏏
Tygerberg Cricket Club`
            }
          };
          await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adminEmailPayload)
          });

          return cors(new Response(JSON.stringify({ status: 'pending' }), { status: 200 }));
        }

        // ── FANTASY: approve participant
        case 'fantasy.approveParticipant': {
          const { id } = payload;
          const aH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

          // Get participant details
          const pR = await fetch(`${SB}/rest/v1/fantasy_participants?id=eq.${id}&select=email,name,team_name`, { headers: aH });
          const pRows = await pR.json();
          if (!pRows || !pRows.length) return cors(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
          const p = pRows[0];

          // Update status
          const upR = await fetch(`${SB}/rest/v1/fantasy_participants?id=eq.${id}`, {
            method: 'PATCH', headers: { ...aH, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ status: 'approved' })
          });
          if (!upR.ok) return cors(new Response(JSON.stringify({ error: 'Update failed' }), { status: 500 }));

          // Email the user — styled HTML welcome
          const initials = (p.name||'?').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
          const welcomeHtml = `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"><tr><td style="background:#1A2B1C;padding:28px 28px 24px;border-radius:8px 8px 0 0;"><div style="font-size:10px;color:#C9A84C;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">TCC Fantasy Cricket</div><div style="font-size:22px;font-weight:600;color:#F0EBD8;line-height:1.3;">You're in.<br>Welcome to the league.</div></td></tr><tr><td style="background:#ffffff;padding:24px 28px;border-left:1px solid #e0ddd4;border-right:1px solid #e0ddd4;border-bottom:1px solid #eeebe4;"><div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;"><div style="width:44px;height:44px;border-radius:50%;background:#EAF3DE;text-align:center;line-height:44px;font-size:14px;font-weight:700;color:#3B6D11;flex-shrink:0;">${initials}</div><div><div style="font-size:14px;font-weight:600;color:#1a1a1a;">${p.name}</div><div style="font-size:12px;color:#888;">${p.team_name}</div></div></div><p style="font-size:13px;color:#555;line-height:1.75;margin:0 0 12px;">Your registration has been approved. Pick your XI, track your score on the leaderboard, and compete in H2H rounds as the season unfolds.</p><table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f1;border-radius:6px;margin-top:4px;"><tr><td style="padding:12px 14px;"><div style="font-size:11px;color:#888;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">Your team</div><div style="font-size:14px;font-weight:600;color:#1a1a1a;">${p.team_name}</div></td></tr></table></td></tr><tr><td style="background:#ffffff;padding:20px 28px;border:1px solid #e0ddd4;border-top:none;border-radius:0 0 8px 8px;"><a href="https://tygerbergcc.co.za/pick.html" style="display:block;background:#1A2B1C;color:#C9A84C;text-align:center;padding:12px 0;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.07em;text-decoration:none;">Pick your XI &rarr;</a><p style="font-size:11px;color:#aaa;text-align:center;margin:12px 0 0;font-style:italic;">Facta Non Verba</p></td></tr></table>`;

          const approvalEmailPayload = {
            service_id:  env.EMAILJS_SERVICE_ID,
            template_id: 'template_iifjomq',
            user_id:     env.EMAILJS_PUBLIC_KEY,
            accessToken: env.EMAILJS_PRIVATE_KEY,
            template_params: {
              to_email: p.email,
              email:    p.email,
              subject:  "You’re in — TCC Fantasy Cricket",
              name:     p.name,
              message:  welcomeHtml
            }
          };
          await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(approvalEmailPayload)
          });

          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── FANTASY: reject participant (deletes so they can reapply)
        case 'fantasy.rejectParticipant': {
          const { id } = payload;
          const rjH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

          // Get participant details for optional rejection email
          const pR2 = await fetch(`${SB}/rest/v1/fantasy_participants?id=eq.${id}&select=email,name`, { headers: rjH });
          const pRows2 = await pR2.json();

          // Delete picks first, then participant (allow reapplication)
          await fetch(`${SB}/rest/v1/fantasy_picks?participant_id=eq.${id}`, { method: 'DELETE', headers: rjH });
          const delR = await fetch(`${SB}/rest/v1/fantasy_participants?id=eq.${id}`, { method: 'DELETE', headers: rjH });
          if (!delR.ok) return cors(new Response(JSON.stringify({ error: 'Delete failed' }), { status: 500 }));

          // Notify the user they can reapply
          if (pRows2 && pRows2.length) {
            const pr = pRows2[0];
            const rejectionEmailPayload = {
              service_id:  env.EMAILJS_SERVICE_ID,
              template_id: 'template_iifjomq',
              user_id:     env.EMAILJS_PUBLIC_KEY,
              accessToken: env.EMAILJS_PRIVATE_KEY,
              template_params: {
                to_email: pr.email,
                email:    pr.email,
                subject:  'TCC Fantasy Cricket — registration update',
                name:     pr.name,
                message:  `Hi ${pr.name},

Unfortunately your TCC Fantasy Cricket registration was not approved at this time.

You are welcome to apply again at:
https://tygerbergcc.co.za/fantasy.html

Facta Non Verba 🏏
Tygerberg Cricket Club`
              }
            };
            await fetch('https://api.emailjs.com/api/v1.0/email/send', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(rejectionEmailPayload)
            });
          }

          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── FANTASY: send OTP
        case 'fantasy.sendOTP': {
          const { email, name } = payload;
          const SBH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };

          // Check participant exists and is approved
          const statusR = await fetch(`${SB}/rest/v1/fantasy_participants?email=eq.${encodeURIComponent(email)}&select=id,status`, { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          const statusRows = await statusR.json();
          if (!statusRows || !statusRows.length) {
            return cors(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
          }
          const pStatus = statusRows[0].status;
          if (pStatus === 'pending') {
            return cors(new Response(JSON.stringify({ error: 'pending' }), { status: 403 }));
          }
          if (pStatus !== 'approved') {
            return cors(new Response(JSON.stringify({ error: 'rejected' }), { status: 403 }));
          }

          // Generate 6-digit code
          const code    = String(Math.floor(100000 + Math.random() * 900000));
          const expires = new Date(Date.now() + 2 * 60 * 1000).toISOString();

          // Invalidate old OTPs
          await fetch(`${SB}/rest/v1/fantasy_otps?email=eq.${encodeURIComponent(email)}&used=eq.false`, { method: 'DELETE', headers: SBH });

          // Store new OTP
          const insertR    = await fetch(`${SB}/rest/v1/fantasy_otps`, {
            method: 'POST', headers: SBH,
            body: JSON.stringify({ email, code, expires_at: expires })
          });
          if (!insertR.ok) {
            const insertErr = await insertR.text();
            return cors(new Response(JSON.stringify({ error: 'OTP store failed: ' + insertR.status + ' — ' + insertErr }), { status: 500 }));
          }

          // Send email via EmailJS
          const greeting = name ? `Hi ${name},` : 'Hi there,';
          const emailPayload = {
            service_id:  env.EMAILJS_SERVICE_ID,
            template_id: 'template_iifjomq',
            user_id:     env.EMAILJS_PUBLIC_KEY,
            accessToken: env.EMAILJS_PRIVATE_KEY,
            template_params: {
              to_email: email,
              email:    email,
              subject:  'Your TCC Fantasy Cricket verification code',
              name:     name || email.split('@')[0],
              message:  `${greeting}\n\nYour TCC Fantasy Cricket verification code is:\n\n${code}\n\nThis code expires in 2 minutes.\n\nFacta Non Verba 🏏\nTygerberg Cricket Club`
            }
          };
          const emailRes  = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(emailPayload)
          });
          if (!emailRes.ok) {
            const emailErr = await emailRes.text();
            return cors(new Response(JSON.stringify({ error: 'EmailJS failed: ' + emailRes.status + ' — ' + emailErr }), { status: 500 }));
          }
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── FANTASY: verify OTP
        case 'fantasy.verifyOTP': {
          const { email, code, name, teamName } = payload;
          const SBH2 = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

          // Find valid OTP
          const otpR = await fetch(
            `${SB}/rest/v1/fantasy_otps?email=eq.${encodeURIComponent(email)}&code=eq.${code}&used=eq.false&order=created_at.desc&limit=1`,
            { headers: SBH2 }
          );
          const otps = await otpR.json();
          if (!otps || !otps.length) return cors(new Response(JSON.stringify({ error: 'Invalid code' }), { status: 401 }));

          const otp = otps[0];
          if (new Date(otp.expires_at) < new Date()) {
            return cors(new Response(JSON.stringify({ error: 'Code expired' }), { status: 401 }));
          }

          // Mark OTP used
          await fetch(`${SB}/rest/v1/fantasy_otps?id=eq.${otp.id}`, {
            method: 'PATCH', headers: SBH2, body: JSON.stringify({ used: true })
          });

          // Find or create participant
          const repH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
          const pR   = await fetch(`${SB}/rest/v1/fantasy_participants?email=eq.${encodeURIComponent(email)}`, { headers: SBH2 });
          const existing = await pR.json();

          let participant;
          if (existing && existing.length) {
            participant = existing[0];
          } else {
            const cr = await fetch(`${SB}/rest/v1/fantasy_participants`, {
              method: 'POST', headers: repH,
              body: JSON.stringify({
                email,
                name:      name      || email.split('@')[0],
                team_name: teamName  || null
              })
            });
            const created = await cr.json();
            participant = Array.isArray(created) ? created[0] : created;
          }

          return cors(new Response(JSON.stringify({ ok: true, participant }), { status: 200 }));
        }

        // ── CONTACT FORM: send email via EmailJS REST API
        case 'contact.send': {
          const { name, email, message, turnstileToken, requestId } = payload || {};

          // ── Hard validation — reject blank submissions immediately
          if (!name || !name.trim() || !email || !email.trim() || !message || !message.trim()) {
            return cors(new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 }));
          }
          if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            return cors(new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400 }));
          }

          // ── Turnstile verification — always required (no bypass)
          if (!turnstileToken) {
            return cors(new Response(JSON.stringify({ error: 'Security check required' }), { status: 403 }));
          }
          const tv = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: turnstileToken })
          });
          const tvData = await tv.json();
          if (!tvData.success) {
            return cors(new Response(JSON.stringify({ error: 'Security check failed' }), { status: 403 }));
          }

          // ── Deduplication — Turnstile tokens are single-use; double-check by
          //    logging the requestId in Supabase and rejecting duplicates
          if (requestId) {
            const dedupH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
            // Try to insert a dedup record — unique constraint on request_id will reject dupes
            const dedupR = await fetch(`${SB}/rest/v1/contact_dedup`, {
              method: 'POST',
              headers: { ...dedupH, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ request_id: requestId, created_at: new Date().toISOString() })
            });
            if (dedupR.status === 409) {
              // Duplicate — already processed this request
              return cors(new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 }));
            }
            // If table doesn't exist yet, fall through (don't block sending)
          }

          // ── Send via EmailJS REST API
          const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              service_id:  env.EMAILJS_SERVICE_ID,
              template_id: env.EMAILJS_TEMPLATE_ID,
              user_id:     env.EMAILJS_PUBLIC_KEY,
              accessToken: env.EMAILJS_PRIVATE_KEY,
              template_params: {
                to_email: 'info@tygerbergcc.co.za',
                subject:  'New message from ' + name.trim() + ' via tygerbergcc.co.za',
                name:     name.trim(),
                email:    email.trim(),
                message:  message.trim()
              }
            })
          });
          if (!emailRes.ok) {
            const errText = await emailRes.text();
            return cors(new Response(JSON.stringify({ error: 'Email failed: ' + errText }), { status: 500 }));
          }
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── BIO: list all submissions with current player data for diff (admin)
        case 'bio.list': {
          const listH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };
          const [subR, plrR] = await Promise.all([
            fetch(`${SB}/rest/v1/bio_submissions?select=*&order=created_at.desc`, { headers: listH }),
            fetch(`${SB}/rest/v1/players?active=eq.true&select=id,name,batting_hand,bowling_style,photo_url`, { headers: listH })
          ]);
          const subs    = await subR.json();
          const players = await plrR.json();
          // Build name lookup for quick diff
          const playerMap = {};
          (players||[]).forEach(function(p) { playerMap[p.name.toLowerCase()] = p; });
          // Attach current player data to each submission
          const enriched = (subs||[]).map(function(s) {
            const match = playerMap[s.name.toLowerCase()] || null;
            return Object.assign({}, s, { current_player: match });
          });
          return cors(new Response(JSON.stringify(enriched), { status: subR.ok ? 200 : subR.status }));
        }

        // ── BIO: submit (public — player self-submission)
        case 'bio.submit': {
          const { name, email, nickname, batting_style, bowling_style,
                  favourite_shot, cricket_hero, years_at_tcc, bio, fun_fact } = payload;
          const bioH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

          // Check for duplicate submission by email (unique constraint)
          const checkR = await fetch(`${SB}/rest/v1/bio_submissions?email=eq.${encodeURIComponent(email)}&select=id`, { headers: bioH });
          const existing = await checkR.json();
          if (existing && existing.length) {
            return cors(new Response(JSON.stringify({ error: 'duplicate' }), { status: 409 }));
          }

          // Insert submission — no player_id, linking happens at approval time
          const insertR = await fetch(`${SB}/rest/v1/bio_submissions`, {
            method: 'POST',
            headers: { ...bioH, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ name, email, nickname, batting_style, bowling_style,
              favourite_shot, cricket_hero, years_at_tcc, bio, fun_fact,
              photo_url: payload.photo_url || null, status: 'pending' })
          });
          if (!insertR.ok) {
            const err = await insertR.text();
            return cors(new Response(JSON.stringify({ error: 'Insert failed: ' + err }), { status: 500 }));
          }

          // Notify admin
          await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              service_id: env.EMAILJS_SERVICE_ID, template_id: 'template_iifjomq',
              user_id: env.EMAILJS_PUBLIC_KEY, accessToken: env.EMAILJS_PRIVATE_KEY,
              template_params: {
                to_email: 'fantasy@tygerbergcc.co.za',
                email: 'fantasy@tygerbergcc.co.za',
                subject: 'New player bio submission — ' + name,
                name: 'TCC Admin',
                message: `New player bio submitted:\n\nName: ${name}\nEmail: ${email}\nBatting: ${batting_style}\n\nBio: ${bio}\n\nReview at: https://tygerbergcc.co.za/admin.html`
              }
            })
          }).catch(function(){});

          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── BIO: approve — writes bio to players table
        case 'bio.approve': {
          const { id, player_id, field_overrides, force_all } = payload;
          const bioH2 = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

          // Get submission
          const subR = await fetch(`${SB}/rest/v1/bio_submissions?id=eq.${id}&select=*`, { headers: bioH2 });
          const subs = await subR.json();
          if (!subs || !subs.length) return cors(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
          const sub = subs[0];

          // Resolve player: explicit admin override > token from form > name match
          let resolvedId = player_id || sub.player_id || null;
          if (!resolvedId) {
            const pR = await fetch(`${SB}/rest/v1/players?name=ilike.${encodeURIComponent(sub.name)}&select=id`, { headers: bioH2 });
            const ps = await pR.json();
            if (ps && ps.length) resolvedId = ps[0].id;
          }

          // Build bio text
          const bioText = sub.bio + (sub.fun_fact ? ' — ' + sub.fun_fact : '');

          if (resolvedId) {
            const overrides    = field_overrides || {};
            const playerPatch  = { bio: bioText };

            // Batting/bowling only update if admin ticked the box
            if (overrides.batting_hand  !== false && sub.batting_style)  playerPatch.batting_hand  = sub.batting_style;
            if (overrides.bowling_style !== false && sub.bowling_style) playerPatch.bowling_style = sub.bowling_style;

            // Extra profile fields — always write these from submission
            if (sub.years_at_tcc)   playerPatch.years_at_tcc   = sub.years_at_tcc;
            if (sub.cricket_hero)   playerPatch.cricket_hero   = sub.cricket_hero;
            if (sub.favourite_shot) playerPatch.favourite_shot = sub.favourite_shot;
            if (sub.nickname)       playerPatch.nickname       = sub.nickname;

            // Photo — move from pending/ to player-photos/ if admin approved it
            if (overrides.photo !== false && sub.photo_url && sub.photo_url.includes('/pending/')) {
              const pendingPath  = sub.photo_url.split('/object/public/gallery/')[1];
              const approvedPath = pendingPath.replace('player-photos/pending/', 'player-photos/');
              const storageH     = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
              // Copy to approved location
              const copyR = await fetch(`${SB}/storage/v1/object/copy`, {
                method: 'POST', headers: storageH,
                body: JSON.stringify({ bucketId: 'gallery', sourceKey: pendingPath, destinationKey: approvedPath })
              });
              if (copyR.ok) {
                playerPatch.photo_url = `${SB}/storage/v1/object/public/gallery/${approvedPath}`;
                // Delete pending original
                await fetch(`${SB}/storage/v1/object/gallery/${pendingPath}`, { method: 'DELETE', headers: storageH });
              }
            }

            await fetch(`${SB}/rest/v1/players?id=eq.${resolvedId}`, {
              method: 'PATCH', headers: { ...bioH2, 'Prefer': 'return=minimal' },
              body: JSON.stringify(playerPatch)
            });
          }

          // Mark submission approved
          await fetch(`${SB}/rest/v1/bio_submissions?id=eq.${id}`, {
            method: 'PATCH', headers: { ...bioH2, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ status: 'approved' })
          });

          return cors(new Response(JSON.stringify({ ok: true, player_found: !!resolvedId }), { status: 200 }));
        }

        // ── BIO: reject — deletes submission so player can resubmit
        case 'bio.reject': {
          const { id } = payload;
          const bioH3 = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
          // Get submission to check for pending photo
          const rejSubR = await fetch(`${SB}/rest/v1/bio_submissions?id=eq.${id}&select=photo_url`, { headers: bioH3 });
          const rejSubs = await rejSubR.json();
          if (rejSubs && rejSubs.length && rejSubs[0].photo_url && rejSubs[0].photo_url.includes('/pending/')) {
            const pendingPath = rejSubs[0].photo_url.split('/object/public/gallery/')[1];
            await fetch(`${SB}/storage/v1/object/gallery/${pendingPath}`, { method: 'DELETE', headers: bioH3 });
          }
          await fetch(`${SB}/rest/v1/bio_submissions?id=eq.${id}`, { method: 'DELETE', headers: bioH3 });
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── PLAYERS: insert
        case 'player.insert': {
          const pH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
          const r  = await fetch(`${SB}/rest/v1/players`, { method: 'POST', headers: pH, body: JSON.stringify(payload) });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── PLAYERS: update
        case 'player.update': {
          const { id, data } = payload;
          const r = await fetch(`${SB}/rest/v1/players?id=eq.${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(data) });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── PLAYERS: delete
        case 'player.delete': {
          const { id } = payload;
          const r = await fetch(`${SB}/rest/v1/players?id=eq.${id}`, { method: 'DELETE', headers: H });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── PUSH: save subscription
        case 'push.subscribe': {
          const { endpoint, p256dh, auth } = payload;
          if (!endpoint || !p256dh || !auth) {
            return cors(new Response(JSON.stringify({ error: 'Missing subscription fields' }), { status: 400 }));
          }
          const pH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal', 'on-conflict': 'endpoint' };
          const r = await fetch(`${SB}/rest/v1/push_subscriptions`, {
            method: 'POST', headers: pH,
            body: JSON.stringify({ endpoint, p256dh, auth })
          });
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── PUSH: delete subscription
        case 'push.unsubscribe': {
          const { endpoint } = payload;
          if (!endpoint) return cors(new Response(JSON.stringify({ error: 'Missing endpoint' }), { status: 400 }));
          const dH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };
          await fetch(`${SB}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE', headers: dH });
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── PUSH: dispatch notification to all subscribers
        case 'push.dispatch': {
          const { type, matchId, title, body: msgBody, url } = payload;
          if (!title) return cors(new Response(JSON.stringify({ error: 'Missing title' }), { status: 400 }));

          const VAPID_PUBLIC  = env.VAPID_PUBLIC_KEY;
          const VAPID_PRIVATE = env.VAPID_PRIVATE_KEY;
          const VAPID_SUBJECT = 'mailto:info@tygerbergcc.co.za';

          if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
            return cors(new Response(JSON.stringify({ error: 'VAPID keys not configured' }), { status: 500 }));
          }

          // Fetch all subscriptions
          const subRes = await fetch(`${SB}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth`, {
            headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY }
          });
          const subs = await subRes.json();
          if (!subs || !subs.length) {
            return cors(new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 }));
          }

          const notification = JSON.stringify({
            title,
            body:  msgBody || '',
            icon:  'https://tygerbergcc.co.za/images/tcc-logo.png',
            tag:   type || 'tcc-match',
            url:   url || 'https://tygerbergcc.co.za/live.html'
          });

          // Send to each subscriber, collect failures for cleanup
          const stale = [];
          let sent = 0;
          await Promise.allSettled(subs.map(async (sub) => {
            try {
              await webPushSend(sub, notification, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT);
              sent++;
            } catch(err) {
              // 404/410 = subscription expired — remove it
              if (err.message && (err.message.includes('404') || err.message.includes('410'))) {
                stale.push(sub.endpoint);
              }
            }
          }));

          // Clean up stale subscriptions
          if (stale.length) {
            const delH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };
            await Promise.allSettled(stale.map(ep =>
              fetch(`${SB}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE', headers: delH })
            ));
          }

          return cors(new Response(JSON.stringify({ ok: true, sent, stale: stale.length }), { status: 200 }));
        }

        // ── FANTASY: generate H2H fixtures for a round
        // Pairs all approved participants randomly (< 3 scored rounds) or
        // by standings (≥ 3 scored rounds: 1st vs 2nd, 3rd vs 4th …).
        // Odd numbers get a "Mr. Average" ghost (participant_b = null).
        case 'fantasy.createH2HFixtures': {
          const { round_id } = payload;
          if (!round_id) return cors(new Response(JSON.stringify({ error: 'round_id required' }), { status: 400 }));

          const fetchH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

          // Get all approved participants
          const pR = await fetch(`${SB}/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name`, { headers: fetchH });
          const participants = await pR.json();
          if (!participants || participants.length < 2) {
            return cors(new Response(JSON.stringify({ error: 'Need at least 2 approved participants' }), { status: 400 }));
          }

          // Count how many rounds have been scored (have picks + at least one score)
          const prevPicksR = await fetch(`${SB}/rest/v1/fantasy_picks?round_id=neq.${round_id}&select=round_id`, { headers: fetchH });
          const prevPicks  = await prevPicksR.json();
          const prevRoundIds = [...new Set((prevPicks || []).map(p => p.round_id))];

          let scoredRoundCount = 0;
          if (prevRoundIds.length) {
            const scoresR = await fetch(`${SB}/rest/v1/fantasy_scores?select=round_id`, { headers: fetchH });
            const scores  = await scoresR.json();
            const scoredIds = new Set((scores || []).map(s => s.round_id));
            scoredRoundCount = prevRoundIds.filter(id => scoredIds.has(id)).length;
          }

          let ordered;
          const useStandings = scoredRoundCount >= 3;

          if (useStandings) {
            // Build season points per participant using same logic as leaderboard
            const [allPicksR, allScoresR, allRoundsR] = await Promise.all([
              fetch(`${SB}/rest/v1/fantasy_picks?select=*`, { headers: fetchH }).then(r => r.json()),
              fetch(`${SB}/rest/v1/fantasy_scores?select=*`, { headers: fetchH }).then(r => r.json()),
              fetch(`${SB}/rest/v1/fantasy_rounds?select=id,wildcard,boost_modifier`, { headers: fetchH }).then(r => r.json()),
            fetch(`${SB}/rest/v1/players?select=id,role&active=not.eq.false`, { headers: fetchH }).then(r => r.json()),
            ]);

            const roundWc = {};
            const roundBoost = {};
            (allRoundsR || []).forEach(r => { roundWc[r.id] = r.wildcard; roundBoost[r.id] = r.boost_modifier || null; });
            const playerRoleMap = {};
            (playersR || []).forEach(p => { playerRoleMap[p.id] = p.role || ''; });

            // Build score lookup: round_id+player_id → aggregated stats
            const scoreLookup = {};
            (allScoresR || []).forEach(s => {
              const key = s.round_id + '_' + s.player_id;
              if (!scoreLookup[key]) scoreLookup[key] = { runs:0, wickets:0, catches:0, stumpings:0, runouts:0, maidens:0, economy:null, player_of_match:false };
              scoreLookup[key].runs      += s.runs      || 0;
              scoreLookup[key].wickets   += s.wickets   || 0;
              scoreLookup[key].catches   += s.catches   || 0;
              scoreLookup[key].stumpings += s.stumpings || 0;
              scoreLookup[key].runouts   += s.runouts   || 0;
              scoreLookup[key].maidens   += s.maidens   || 0;
              if (s.economy  != null && s.economy  > 0) scoreLookup[key].economy = s.economy;
              if (s.player_of_match) scoreLookup[key].player_of_match = true;
            });

            function calcPtsWorker(score, isCap, isWc, isVC, boost, role) {
              let pts = 0, runs = score.runs||0, wkts = score.wickets||0;
              let batPts = runs; if(runs>=50) batPts+=10; if(runs>=100) batPts+=25;
              let bowlPts = wkts*15; if(wkts>=5) bowlPts+=20;
              let econPts = 0;
              if (score.economy != null && score.economy > 0) {
                const e = score.economy;
                const base = e<=5?10:e<=6?6:e<=7?2:e<=8?0:e<=9?-2:-4;
                econPts = boost==='bonus_economy' ? base*2 : base;
              }
              let fieldPts = (score.maidens||0)*10+(score.catches||0)*10+(score.stumpings||0)*10+(score.runouts||0)*10;
              let potmPts  = score.player_of_match ? (boost==='potm_double' ? 50 : 25) : 0;
              // Apply role boosts
              const r = (role||'').toLowerCase();
              const isBowler = r==='bowler';
              const isBatter = r==='batter'||r==='wicketkeeper';
              const isAR     = r==='all-rounder'||r==='allrounder';
              if (boost==='bowlers_double'    && isBowler) { bowlPts*=2; econPts*=2; }
              if (boost==='batters_double'    && isBatter) { batPts*=2; }
              if (boost==='allrounders_boost' && isAR)     { batPts=Math.round(batPts*1.5); bowlPts=Math.round(bowlPts*1.5); }
              pts = batPts + bowlPts + econPts + fieldPts + potmPts;
              if (isCap) pts = isWc ? pts*3 : pts*2;
              else if (isVC) pts = Math.round(pts*1.5);
              return pts;
            }

            const totals = {};
            (allPicksR || []).forEach(pick => {
              const pid = pick.participant_id;
              const wc  = roundWc[pick.round_id] || false;
              if (!totals[pid]) totals[pid] = 0;
              (pick.player_ids || []).forEach(playerId => {
                const score = scoreLookup[pick.round_id + '_' + playerId];
                const boost = roundBoost[pick.round_id] || null;
                const role  = (playerRoleMap && playerRoleMap[playerId]) || '';
                if (score) totals[pid] += calcPtsWorker(score, playerId===pick.captain_id, wc, playerId===pick.vice_captain_id, boost, role);
              });
            });

            ordered = [...participants].sort((a, b) => (totals[b.id]||0) - (totals[a.id]||0));
          } else {
            // Random shuffle (Fisher-Yates)
            ordered = [...participants];
            for (let i = ordered.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
            }
          }

          // Build fixture pairs
          const fixtures = [];
          for (let i = 0; i < ordered.length - 1; i += 2) {
            fixtures.push({ round_id, participant_a: ordered[i].id, participant_b: ordered[i+1].id });
          }
          if (ordered.length % 2 !== 0) {
            // Odd one out gets Mr. Average
            fixtures.push({ round_id, participant_a: ordered[ordered.length - 1].id, participant_b: null });
          }

          // Clear existing fixtures for this round, then insert
          await fetch(`${SB}/rest/v1/fantasy_h2h_fixtures?round_id=eq.${round_id}`, { method: 'DELETE', headers: H });
          const insertH2 = Object.assign({}, H, { 'Prefer': 'return=representation' });
          const insertR  = await fetch(`${SB}/rest/v1/fantasy_h2h_fixtures`, { method: 'POST', headers: insertH2, body: JSON.stringify(fixtures) });
          const created  = await insertR.json();

          // ── Send draw notification emails ──────────────────────────
          if (insertR.ok && Array.isArray(created) && created.length) {
            const emailRD = await fetch(`${SB}/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name,email`, { headers: fetchH }).then(r => r.json()).catch(() => []);
            const emailMapD = {};
            (emailRD||[]).forEach(p => { emailMapD[p.id] = p; });
            const dlRD  = await fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${round_id}&select=name,deadline`, { headers: fetchH }).then(r => r.json()).catch(() => []);
            const roundNameD  = dlRD?.[0]?.name     || 'This round';
            const deadlineStr = dlRD?.[0]?.deadline ? h2hFmtDl(dlRD[0].deadline) : 'Check the site';
            for (const fx of created) {
              const pA = emailMapD[fx.participant_a];
              const pB = fx.participant_b ? emailMapD[fx.participant_b] : null;
              await sendH2HDrawEmail(SB, KEY, env, pA, pB ? (pB.team_name||pB.name) : null, roundNameD, deadlineStr);
              if (pB) await sendH2HDrawEmail(SB, KEY, env, pB, pA ? (pA.team_name||pA.name) : null, roundNameD, deadlineStr);
            }
          }

          return cors(new Response(JSON.stringify({
            ok: true,
            method:    useStandings ? 'standings' : 'random',
            count:     fixtures.length,
            fixtures:  created
          }), { status: insertR.ok ? 200 : 500 }));
        }

        // ── FANTASY: resolve H2H results for a round
        // Call after all scores for the round have been saved.
        // Calculates each participant's round points, determines W/D/L
        // for every fixture, and writes pts_a, pts_b, winner_id.
        case 'fantasy.resolveH2H': {
          const { round_id } = payload;
          if (!round_id) return cors(new Response(JSON.stringify({ error: 'round_id required' }), { status: 400 }));

          const fetchH2 = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

          const [fixturesR, roundR, playersR2, picksR, scoresR] = await Promise.all([
            fetch(`${SB}/rest/v1/fantasy_h2h_fixtures?round_id=eq.${round_id}&select=*`, { headers: fetchH2 }).then(r => r.json()),
            fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${round_id}&select=wildcard,boost_modifier`, { headers: fetchH2 }).then(r => r.json()),
            fetch(`${SB}/rest/v1/players?select=id,role&active=not.eq.false`, { headers: fetchH2 }).then(r => r.json()),
            fetch(`${SB}/rest/v1/fantasy_picks?round_id=eq.${round_id}&select=*`, { headers: fetchH2 }).then(r => r.json()),
            fetch(`${SB}/rest/v1/fantasy_scores?round_id=eq.${round_id}&select=*`, { headers: fetchH2 }).then(r => r.json()),
          ]);

          if (!fixturesR || !fixturesR.length) {
            return cors(new Response(JSON.stringify({ error: 'No fixtures for this round. Generate fixtures first.' }), { status: 404 }));
          }

          const isWildcard   = roundR && roundR.length ? roundR[0].wildcard         : false;
          const roundBoost2  = roundR && roundR.length ? (roundR[0].boost_modifier||null) : null;
          const roleMap2 = {};
          (playersR2||[]).forEach(p => { roleMap2[p.id] = p.role||''; });

          // Aggregate scores per player
          const scoreLookup2 = {};
          (scoresR || []).forEach(s => {
            const k = s.player_id;
            if (!scoreLookup2[k]) scoreLookup2[k] = { runs:0, wickets:0, catches:0, stumpings:0, runouts:0, maidens:0, economy:null, player_of_match:false };
            scoreLookup2[k].runs      += s.runs      || 0;
            scoreLookup2[k].wickets   += s.wickets   || 0;
            scoreLookup2[k].catches   += s.catches   || 0;
            scoreLookup2[k].stumpings += s.stumpings || 0;
            scoreLookup2[k].runouts   += s.runouts   || 0;
            scoreLookup2[k].maidens   += s.maidens   || 0;
            if (s.economy != null && s.economy > 0) scoreLookup2[k].economy = s.economy;
            if (s.player_of_match) scoreLookup2[k].player_of_match = true;
          });

          function calcPtsResolve(score, isCap, isWc, isVC, boost, role) {
            let pts = 0, runs = score.runs||0, wkts = score.wickets||0;
            let batPts = runs; if(runs>=50) batPts+=10; if(runs>=100) batPts+=25;
            let bowlPts = wkts*15; if(wkts>=5) bowlPts+=20;
            let econPts = 0;
            if (score.economy != null && score.economy > 0) {
              const e = score.economy;
              const base = e<=5?10:e<=6?6:e<=7?2:e<=8?0:e<=9?-2:-4;
              econPts = boost==='bonus_economy' ? base*2 : base;
            }
            let fieldPts = (score.maidens||0)*10+(score.catches||0)*10+(score.stumpings||0)*10+(score.runouts||0)*10;
            let potmPts  = score.player_of_match ? (boost==='potm_double' ? 50 : 25) : 0;
            const r = (role||'').toLowerCase();
            const isBowler = r==='bowler';
            const isBatter = r==='batter'||r==='wicketkeeper';
            const isAR     = r==='all-rounder'||r==='allrounder';
            if (boost==='bowlers_double'    && isBowler) { bowlPts*=2; econPts*=2; }
            if (boost==='batters_double'    && isBatter) { batPts*=2; }
            if (boost==='allrounders_boost' && isAR)     { batPts=Math.round(batPts*1.5); bowlPts=Math.round(bowlPts*1.5); }
            pts = batPts + bowlPts + econPts + fieldPts + potmPts;
            if (isCap) pts = isWc ? pts*3 : pts*2;
            else if (isVC) pts = Math.round(pts*1.5);
            return pts;
          }

          // Round points per participant
          const participantPts = {};
          (picksR || []).forEach(pick => {
            let rPts = 0;
            (pick.player_ids || []).forEach(playerId => {
              const score = scoreLookup2[playerId];
              if (score) rPts += calcPtsResolve(score, playerId===pick.captain_id, isWildcard, playerId===pick.vice_captain_id, roundBoost2, roleMap2[playerId]||'');
            });
            participantPts[pick.participant_id] = rPts;
          });

          // Mr. Average = mean of all real participants' points
          const allPtsArr = Object.values(participantPts);
          const avgPts = allPtsArr.length
            ? Math.round(allPtsArr.reduce((s, p) => s + p, 0) / allPtsArr.length)
            : 0;

          // Resolve each fixture
          const results = await Promise.all(fixturesR.map(async fixture => {
            const ptsA = participantPts[fixture.participant_a] ?? 0;
            const ptsB = fixture.participant_b
              ? (participantPts[fixture.participant_b] ?? 0)
              : avgPts;

            let winnerId = null;
            if      (ptsA > ptsB && fixture.participant_b) winnerId = fixture.participant_a;
            else if (ptsB > ptsA && fixture.participant_b) winnerId = fixture.participant_b;
            else if (ptsA > ptsB && !fixture.participant_b) winnerId = fixture.participant_a;
            // exact tie (incl. ghost tie) → draw, winnerId stays null

            await fetch(`${SB}/rest/v1/fantasy_h2h_fixtures?id=eq.${fixture.id}`, {
              method: 'PATCH', headers: H,
              body: JSON.stringify({ pts_a: ptsA, pts_b: ptsB, winner_id: winnerId })
            });
            return { id: fixture.id, pts_a: ptsA, pts_b: ptsB, winner_id: winnerId };
          }));

          // ── Send result notification emails ────────────────────────
          try {
            const emailRR = await fetch(`${SB}/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name,email`, { headers: fetchH2 }).then(r => r.json()).catch(() => []);
            const emailMapR = {};
            (emailRR||[]).forEach(p => { emailMapR[p.id] = p; });
            const rndR = await fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${round_id}&select=name`, { headers: fetchH2 }).then(r => r.json()).catch(() => []);
            const roundNameR = rndR?.[0]?.name || 'This round';
            const allFxR = await fetch(`${SB}/rest/v1/fantasy_h2h_fixtures?select=participant_a,participant_b,winner_id`, { headers: fetchH2 }).then(r => r.json()).catch(() => []);
            const getSeasonRec = pid => {
              let w=0,d=0,l=0;
              (allFxR||[]).forEach(f => {
                const isA=f.participant_a===pid, isB=f.participant_b===pid;
                if (!isA&&!isB) return;
                if (!f.winner_id) d++; else if (f.winner_id===pid) w++; else l++;
              });
              return w+'W · '+d+'D · '+l+'L';
            };
            for (const res of results) {
              const fx = fixturesR.find(f => f.id === res.id);
              if (!fx) continue;
              const pA = emailMapR[fx.participant_a];
              const pB = fx.participant_b ? emailMapR[fx.participant_b] : null;
              await sendH2HResultEmail(SB, KEY, env, pA, res.pts_a, res.pts_b, pB?(pB.team_name||pB.name):'Mr. Average', res.winner_id, !fx.participant_b, roundNameR, getSeasonRec(fx.participant_a));
              if (pB) await sendH2HResultEmail(SB, KEY, env, pB, res.pts_b, res.pts_a, pA?(pA.team_name||pA.name):'Unknown', res.winner_id, false, roundNameR, getSeasonRec(fx.participant_b));
            }
          } catch(emailErr) {}

          return cors(new Response(JSON.stringify({ ok: true, avgPts, results }), { status: 200 }));
        }



        // ── FANTASY: auto-score a round from linked live_scores data
        case 'fantasy.autoScoreRound': {
          const { round_id, dry_run } = payload;
          if (!round_id) return cors(new Response(JSON.stringify({ error: 'round_id required' }), { status: 400 }));

          const aH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };

          // 1. Get linked fixture IDs for this round
          const rfRes = await fetch(`${SB}/rest/v1/fantasy_round_fixtures?round_id=eq.${round_id}&select=fixture_id`, { headers: aH });
          const rfRows = await rfRes.json();
          if (!rfRows || !rfRows.length) {
            return cors(new Response(JSON.stringify({ error: 'No fixtures linked to this round. Link fixtures via the round edit form first.' }), { status: 400 }));
          }
          const fixtureIds = rfRows.map(r => r.fixture_id);
          const fidsParam  = fixtureIds.join(',');

          // 2. Fetch completed live_scores for those fixtures
          const lsRes = await fetch(
            `${SB}/rest/v1/live_scores?status=eq.completed&fixture_id=in.(${fidsParam})&select=id,fixture_id,batting_state,bowling_state,first_innings_batting,first_innings_bowling,lineup_state`,
            { headers: aH }
          );
          const lsRows = await lsRes.json();
          if (!lsRows || !lsRows.length) {
            return cors(new Response(JSON.stringify({ error: 'No completed matches found for the linked fixtures. Matches must be completed in the scoring app first.' }), { status: 400 }));
          }

          // 3. Fetch name map and player roles
          const [nameMapRes, playersRes] = await Promise.all([
            fetch(`${SB}/rest/v1/fantasy_player_name_map?select=scorer_name,player_id`, { headers: aH }).then(r => r.json()),
            fetch(`${SB}/rest/v1/players?select=id,role&active=not.eq.false`, { headers: aH }).then(r => r.json()),
          ]);

          const nameMap  = {};
          (nameMapRes || []).forEach(m => { nameMap[m.scorer_name.toLowerCase()] = m.player_id; });
          const roleMap  = {};
          (playersRes || []).forEach(p => { roleMap[p.id] = p.role || ''; });

          // 4. Aggregate per-player stats across all matches
          const stats  = {}; // player_id -> { runs, wickets, catches, stumpings, runouts, maidens, overs, runsBowled }
          const unmatched = new Set();

          const ensurePlayer = pid => {
            if (!stats[pid]) stats[pid] = { runs:0, wickets:0, catches:0, stumpings:0, runouts:0, maidens:0, overs:0, runsBowled:0 };
          };

          const extractBatting = (battingState) => {
            if (!battingState) return;
            let batters = [];
            if (battingState.striker)    batters.push(battingState.striker);
            if (battingState.nonStriker) batters.push(battingState.nonStriker);
            if (battingState.dismissed)  batters = batters.concat(battingState.dismissed);
            if (battingState.retiredHurt)batters = batters.concat(battingState.retiredHurt);
            batters.forEach(b => {
              if (!b || !b.name) return;
              const pid = nameMap[b.name.toLowerCase()];
              if (!pid) { unmatched.add(b.name); return; }
              ensurePlayer(pid);
              stats[pid].runs += b.runs || 0;
              // Run-outs: check dismissal
              if (b.how && b.how.toLowerCase().includes('run out')) stats[pid].runouts++;
            });
          };

          const extractBowling = (bowlingState) => {
            if (!bowlingState) return;
            const bowlers = (bowlingState.bowlers || []).slice();
            if (bowlingState.current && bowlingState.current.name) {
              const existing = bowlers.find(bw => bw.name === bowlingState.current.name);
              if (!existing) bowlers.push(bowlingState.current);
              else {
                // Merge current into the existing entry
                existing.wickets = Math.max(existing.wickets||0, bowlingState.current.wickets||0);
                existing.maidens = Math.max(existing.maidens||0, bowlingState.current.maidens||0);
                existing.runs    = Math.max(existing.runs||0, bowlingState.current.runs||0);
                existing.overs   = Math.max(existing.overs||0, bowlingState.current.overs||0);
              }
            }
            bowlers.forEach(b => {
              if (!b || !b.name) return;
              const pid = nameMap[b.name.toLowerCase()];
              if (!pid) { unmatched.add(b.name); return; }
              ensurePlayer(pid);
              stats[pid].wickets    += b.wickets || 0;
              stats[pid].maidens    += b.maidens || 0;
              stats[pid].overs      += b.overs   || 0;
              stats[pid].runsBowled += b.runs    || 0;
            });
          };

          const extractLineup = (lineupState) => {
            if (!lineupState) return;
            if (lineupState.catches) {
              Object.entries(lineupState.catches).forEach(([name, count]) => {
                const pid = nameMap[name.toLowerCase()];
                if (!pid) { unmatched.add(name); return; }
                ensurePlayer(pid);
                stats[pid].catches += count || 0;
              });
            }
            if (lineupState.stumpings) {
              Object.entries(lineupState.stumpings).forEach(([name, count]) => {
                const pid = nameMap[name.toLowerCase()];
                if (!pid) { unmatched.add(name); return; }
                ensurePlayer(pid);
                stats[pid].stumpings += count || 0;
              });
            }
          };

          for (const ls of lsRows) {
            try {
              const bat2  = JSON.parse(ls.batting_state         || '{}');
              const bowl2 = JSON.parse(ls.bowling_state         || '{}');
              const bat1  = JSON.parse(ls.first_innings_batting  || 'null');
              const bowl1 = JSON.parse(ls.first_innings_bowling  || 'null');
              const lineup= JSON.parse(ls.lineup_state           || '{}');
              extractBatting(bat1);
              extractBatting(bat2);
              extractBowling(bowl1);
              extractBowling(bowl2);
              extractLineup(lineup);
            } catch(e) {}
          }

          // 5. Calculate economy rate per player
          const scoreRows = Object.entries(stats).map(([player_id, s]) => {
            const econ = s.overs >= 1 ? Math.round((s.runsBowled / s.overs) * 10) / 10 : null;
            return {
              round_id,
              player_id,
              runs:             s.runs,
              wickets:          s.wickets,
              catches:          s.catches,
              stumpings:        s.stumpings,
              runouts:          s.runouts,
              maidens:          s.maidens,
              economy:          econ,
              player_of_match:  false,
              match_label:      'Auto-scored',
            };
          });

          const unmatchedList = Array.from(unmatched);

          // 6. Dry run — return preview without saving
          if (dry_run) {
            return cors(new Response(JSON.stringify({
              ok: true,
              dry_run: true,
              matched_players: scoreRows.length,
              unmatched_names: unmatchedList,
              preview: scoreRows,
            }), { status: 200 }));
          }

          // 7. Clear existing scores and write new ones
          await fetch(`${SB}/rest/v1/fantasy_scores?round_id=eq.${round_id}&match_label=eq.Auto-scored`, {
            method: 'DELETE', headers: aH
          });

          if (scoreRows.length) {
            const insertH2 = Object.assign({}, aH, { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' });
            const insRes = await fetch(`${SB}/rest/v1/fantasy_scores`, {
              method: 'POST', headers: insertH2, body: JSON.stringify(scoreRows)
            });
            if (!insRes.ok) {
              const errText = await insRes.text();
              return cors(new Response(JSON.stringify({ error: 'Failed to save scores: ' + errText }), { status: 500 }));
            }
          }

          return cors(new Response(JSON.stringify({
            ok: true,
            saved: scoreRows.length,
            unmatched_names: unmatchedList,
          }), { status: 200 }));
        }


        // ── FIXTURES: insert (single row or array)
        case 'fixtures.insert': {
          const insertH = Object.assign({}, H, { 'Prefer': 'return=representation' });
          const body = Array.isArray(payload.data) ? payload.data : [payload.data];
          const r = await fetch(`${SB}/rest/v1/fixtures`, {
            method: 'POST', headers: insertH, body: JSON.stringify(body)
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── FIXTURES: update
        case 'fixtures.update': {
          const { id, data } = payload;
          if (!id) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          const r = await fetch(`${SB}/rest/v1/fixtures?id=eq.${id}`, {
            method: 'PATCH', headers: H, body: JSON.stringify(data)
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── FIXTURES: delete
        case 'fixtures.delete': {
          const { id } = payload;
          if (!id) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          const r = await fetch(`${SB}/rest/v1/fixtures?id=eq.${id}`, {
            method: 'DELETE', headers: H
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        case 'fantasy.resendH2HDraw': {
          const { round_id } = payload;
          if (!round_id) return cors(new Response(JSON.stringify({ error: 'round_id required' }), { status: 400 }));
          const fetchRD = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };
          const [fxRD, rndRD, pRD] = await Promise.all([
            fetch(`${SB}/rest/v1/fantasy_h2h_fixtures?round_id=eq.${round_id}&select=*`, { headers: fetchRD }).then(r => r.json()),
            fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${round_id}&select=name,deadline`, { headers: fetchRD }).then(r => r.json()),
            fetch(`${SB}/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name,email`, { headers: fetchRD }).then(r => r.json()),
          ]);
          if (!fxRD?.length) return cors(new Response(JSON.stringify({ error: 'No fixtures found for this round' }), { status: 404 }));
          const roundNameRD  = rndRD?.[0]?.name     || 'This round';
          const deadlineRD   = rndRD?.[0]?.deadline ? h2hFmtDl(rndRD[0].deadline) : 'Check the site';
          const emapRD = {};
          (pRD||[]).forEach(p => { emapRD[p.id] = p; });
          let sent = 0;
          for (const fx of fxRD) {
            const pA = emapRD[fx.participant_a];
            const pB = fx.participant_b ? emapRD[fx.participant_b] : null;
            await sendH2HDrawEmail(SB, KEY, env, pA, pB?(pB.team_name||pB.name):null, roundNameRD, deadlineRD);
            if (pB) await sendH2HDrawEmail(SB, KEY, env, pB, pA?(pA.team_name||pA.name):null, roundNameRD, deadlineRD);
            sent++;
          }
          return cors(new Response(JSON.stringify({ ok: true, sent }), { status: 200 }));
        }

        case 'fantasy.resendH2HResult': {
          const { round_id } = payload;
          if (!round_id) return cors(new Response(JSON.stringify({ error: 'round_id required' }), { status: 400 }));
          const fetchRR = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };
          const [fxRR, rndRR, pRR, allFxRR] = await Promise.all([
            fetch(`${SB}/rest/v1/fantasy_h2h_fixtures?round_id=eq.${round_id}&select=*`, { headers: fetchRR }).then(r => r.json()),
            fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${round_id}&select=name`, { headers: fetchRR }).then(r => r.json()),
            fetch(`${SB}/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name,email`, { headers: fetchRR }).then(r => r.json()),
            fetch(`${SB}/rest/v1/fantasy_h2h_fixtures?select=participant_a,participant_b,winner_id`, { headers: fetchRR }).then(r => r.json()),
          ]);
          if (!fxRR?.length) return cors(new Response(JSON.stringify({ error: 'No fixtures found' }), { status: 404 }));
          const unresolved = (fxRR||[]).filter(f => f.pts_a == null);
          if (unresolved.length === fxRR.length) return cors(new Response(JSON.stringify({ error: 'Round not resolved yet. Run Resolve H2H first.' }), { status: 400 }));
          const roundNameRR = rndRR?.[0]?.name || 'This round';
          const emapRR = {};
          (pRR||[]).forEach(p => { emapRR[p.id] = p; });
          const getRecRR = pid => {
            let w=0,d=0,l=0;
            (allFxRR||[]).forEach(f => {
              const isA=f.participant_a===pid, isB=f.participant_b===pid;
              if (!isA&&!isB) return;
              if (!f.winner_id) d++; else if (f.winner_id===pid) w++; else l++;
            });
            return w+'W · '+d+'D · '+l+'L';
          };
          let sentR = 0;
          for (const fx of fxRR) {
            if (fx.pts_a == null) continue;
            const pA = emapRR[fx.participant_a];
            const pB = fx.participant_b ? emapRR[fx.participant_b] : null;
            await sendH2HResultEmail(SB, KEY, env, pA, fx.pts_a, fx.pts_b, pB?(pB.team_name||pB.name):'Mr. Average', fx.winner_id, !fx.participant_b, roundNameRR, getRecRR(fx.participant_a));
            if (pB) await sendH2HResultEmail(SB, KEY, env, pB, fx.pts_b, fx.pts_a, pA?(pA.team_name||pA.name):'Unknown', fx.winner_id, false, roundNameRR, getRecRR(fx.participant_b));
            sentR++;
          }
          return cors(new Response(JSON.stringify({ ok: true, sent: sentR }), { status: 200 }));
        }

        default:
          return cors(new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 }));
      }
    } catch (err) {
      return cors(new Response(JSON.stringify({ error: err.message }), { status: 500 }));
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  }
};

/* ── Helpers ── */
function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, headers });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ══════════════════════════════════════════════════════
   WEB PUSH — RFC 8291 / aes128gcm encryption
   Runs entirely on Web Crypto API (no Node modules).
══════════════════════════════════════════════════════ */
function b64uDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + (4 - s.length % 4) % 4, '=');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
function b64uEncode(bytes) {
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}
async function hkdf(ikm, salt, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: infoBytes },
    key,
    len * 8
  ));
}

async function webPushSend(subscription, payloadStr, vapidPublicKey, vapidPrivateKey, subject) {
  const { endpoint, p256dh, auth } = subscription;

  // ── Encrypt payload (RFC 8291 aes128gcm) ──────────────────────────────
  const clientPubBytes = b64uDecode(p256dh);
  const authSecret     = b64uDecode(auth);
  const salt           = crypto.getRandomValues(new Uint8Array(16));

  // Generate ephemeral P-256 key pair
  const ephKP = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephPubBytes = new Uint8Array(await crypto.subtle.exportKey('raw', ephKP.publicKey));

  // ECDH shared secret
  const clientPub = await crypto.subtle.importKey('raw', clientPubBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientPub }, ephKP.privateKey, 256));

  // Step 1 HKDF: IKM = HKDF(salt=auth, ikm=sharedSecret, info=keyInfo)
  const keyInfo = concat(new TextEncoder().encode('WebPush: info\x00'), clientPubBytes, ephPubBytes);
  const ikm = await hkdf(sharedSecret, authSecret, keyInfo, 32);

  // Step 2a: CEK = HKDF(salt=salt, ikm=IKM, info="Content-Encoding: aes128gcm\0")[0:16]
  const cek = await hkdf(ikm, salt, 'Content-Encoding: aes128gcm\x00', 16);

  // Step 2b: NONCE = HKDF(salt=salt, ikm=IKM, info="Content-Encoding: nonce\0")[0:12]
  const nonce = await hkdf(ikm, salt, 'Content-Encoding: nonce\x00', 12);

  // Encrypt: AES-128-GCM(CEK, NONCE, plaintext || 0x02)
  const plaintext = concat(new TextEncoder().encode(payloadStr), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM', length: 128 }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  // aes128gcm header: [salt:16][rs:4 BE][idlen:1][keyid:65][ciphertext]
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, 4096, false);
  const body = concat(salt, rsBytes, new Uint8Array([65]), ephPubBytes, ciphertext);

  // ── VAPID JWT ──────────────────────────────────────────────────────────
  const audience  = new URL(endpoint).origin;
  const now       = Math.floor(Date.now() / 1000);
  const jwtHeader = b64uEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const jwtPayload = b64uEncode(new TextEncoder().encode(JSON.stringify({ aud: audience, exp: now + 43200, sub: subject })));
  const sigInput  = new TextEncoder().encode(`${jwtHeader}.${jwtPayload}`);

  const pubBytes = b64uDecode(vapidPublicKey);
  const sigKey   = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: vapidPrivateKey,
    x: b64uEncode(pubBytes.slice(1, 33)),
    y: b64uEncode(pubBytes.slice(33, 65))
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sigKey, sigInput));
  const jwt = `${jwtHeader}.${jwtPayload}.${b64uEncode(sig)}`;

  // ── POST to push endpoint ──────────────────────────────────────────────
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Authorization':    `vapid t=${jwt},k=${vapidPublicKey}`,
      'TTL':              '86400',
    },
    body
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${txt}`);
  }
  return { ok: true };
}

/* ══════════════════════════════════════════════════════
   SCHEDULED CRON — Fantasy Deadline Reminders
   Runs every hour (configure in wrangler.toml or CF dashboard:
     crons = ["0 * * * *"]  )
   Checks for rounds whose deadline is ~24hr or ~1hr away
   and sends push notifications to all fantasy subscribers.
══════════════════════════════════════════════════════ */
async function handleScheduled(env) {
  const SB  = 'https://cgjannvzpqecwzjdzwso.supabase.co';
  const KEY  = env.SUPABASE_SERVICE_KEY;
  const H    = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };
  const PH   = { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };

  const now = Date.now();

  // ── AUTO-LOCK: lock any unlocked round whose deadline has passed ──────
  // Runs unconditionally — independent of VAPID config.
  try {
    const overdueRes = await fetch(
      `${SB}/rest/v1/fantasy_rounds?locked=eq.false&select=id,name,deadline`,
      { headers: H }
    );
    const overdueRounds = await overdueRes.json();
    if (Array.isArray(overdueRounds)) {
      await Promise.all(overdueRounds
        .filter(r => new Date(r.deadline).getTime() < now)
        .map(r => fetch(
          `${SB}/rest/v1/fantasy_rounds?id=eq.${r.id}`,
          { method: 'PATCH', headers: PH, body: JSON.stringify({ locked: true }) }
        ))
      );
    }
  } catch(e) {
    // Non-fatal — don't block push notifications
    console.error('Auto-lock error:', e);
  }

  // ── PUSH REMINDERS ────────────────────────────────────────────────────
  const VAPID_PUBLIC  = env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE = env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT = 'mailto:info@tygerbergcc.co.za';
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

  const windows = [
    { label: '24hr',  min: 23 * 60 * 60 * 1000, max: 25 * 60 * 60 * 1000 },
    { label: '1hr',   min:      50 * 60 * 1000,  max:      70 * 60 * 1000 },
  ];

  // Fetch upcoming unlocked rounds (already locked ones filtered out above)
  const rRes   = await fetch(`${SB}/rest/v1/fantasy_rounds?locked=eq.false&select=id,name,deadline,wildcard`, { headers: H });
  const rounds = await rRes.json();
  if (!rounds || !rounds.length) return;

  // Fetch fantasy push subscriptions
  const sRes = await fetch(`${SB}/rest/v1/push_subscriptions?source=eq.fantasy&select=endpoint,p256dh,auth`, { headers: H });
  const subs = await sRes.json();
  if (!subs || !subs.length) return;

  for (const round of rounds) {
    const deadline = new Date(round.deadline).getTime();
    const diff     = deadline - now;
    if (diff < 0) continue;

    for (const win of windows) {
      if (diff >= win.min && diff < win.max) {
        const label   = win.label === '24hr' ? '24 hours' : '1 hour';
        const title   = `⏰ ${round.name} — Deadline in ${label}`;
        const boostMsgs = { bowlers_double:'🎯 Bowlers Double — bowling pts ×2!', batters_double:'🏏 Batters Double — batting pts ×2!', allrounders_boost:'⚡ All-Rounders Boost — AR pts ×1.5!', bonus_economy:'📉 Economy Bonus Weekend!', potm_double:'🏆 POTM Double this round!' };
          const boostNote = round.boost_modifier ? ' '+( boostMsgs[round.boost_modifier]||'') : '';
          const body    = `Lock in your XI before the deadline. ${round.wildcard ? '⭐ Wildcard — captain scores ×3!' : ''}${boostNote}`.trim();
        const payload = JSON.stringify({ title, body, icon: '/images/tcc-logo.png', url: '/pick.html', tag: 'fantasy-deadline-' + round.id });

        // ── Push notifications (opt-in subscribers only)
        for (const sub of subs) {
          try {
            await webPushSend(sub, payload, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT);
          } catch(e) {
            if (e.message && (e.message.includes('410') || e.message.includes('404'))) {
              await fetch(`${SB}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE', headers: H });
            }
          }
        }

        // ── Email reminders — only participants who haven't picked yet
        try {
          const [participantsRes, picksRes] = await Promise.all([
            fetch(`${SB}/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name,email`, { headers: H }),
            fetch(`${SB}/rest/v1/fantasy_picks?round_id=eq.${round.id}&select=participant_id`, { headers: H }),
          ]);
          const participants  = await participantsRes.json();
          const picks         = await picksRes.json();
          const alreadyPicked = new Set((picks || []).map(p => p.participant_id));

          const toEmail = (participants || []).filter(p => p.email && !alreadyPicked.has(p.id));

          for (const p of toEmail) {
            const displayName = p.team_name || p.name;
            const urgency     = win.label === '1hr' ? '⚠️ Last chance' : '📅 Reminder';
            await fetch('https://api.emailjs.com/api/v1.0/email/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                service_id:  env.EMAILJS_SERVICE_ID,
                template_id: 'template_iifjomq',
                user_id:     env.EMAILJS_PUBLIC_KEY,
                accessToken: env.EMAILJS_PRIVATE_KEY,
                template_params: {
                  to_email: p.email,
                  email:    p.email,
                  subject:  `${urgency} — ${round.name} deadline in ${label}`,
                  name:     displayName,
                  message:  `Hi ${displayName},\n\nYou haven't submitted your XI yet for "${round.name}" and the deadline is in ${label}.\n\nPick your team now:\nhttps://tygerbergcc.co.za/pick.html\n${round.wildcard ? '\n⭐ Wildcard round — your captain scores ×3!\n' : ''}${round.boost_modifier ? '\n🚀 '+( boostMsgs[round.boost_modifier]||round.boost_modifier)+'\n' : ''}\nFacta Non Verba 🏏\nTygerberg Cricket Club`
                }
              })
            }).catch(() => {}); // non-fatal per recipient
          }
        } catch(e) {
          console.error('Email reminder error:', e);
        }
        break;
      }
    }
  }
}

// Scheduled handler — merged into the single export below.
// (replaces the old duplicate export default that caused the Worker to return 404)