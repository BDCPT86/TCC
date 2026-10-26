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

/* ============================================================
   PayFast integration helpers — to merge into worker.js
   ABSA arrangement: PayFast = gateway, ABSA = acquiring bank.
   We integrate PayFast ONLY. Sandbox creds until the club's live
   account exists (then swap env vars, flip PF_SANDBOX=false).

   Mirrors the field ordering + validation of the louislewis2/.NET
   library, implemented in Web Crypto for the Worker.
   ============================================================ */

/* ---- config resolver (call with env) ----
   Sandbox default merchant creds are PayFast's public test values.
   Set real PAYFAST_MERCHANT_ID / _KEY / _PASSPHRASE as Worker secrets
   for production and set PF_SANDBOX=false. */
function pfConfig(env) {
  const sandbox = env.PF_SANDBOX !== 'false'; // default true unless explicitly disabled
  return {
    sandbox,
    // Defaults are TCC's OWN sandbox account (fallback if secrets unset).
    // Production: set PAYFAST_MERCHANT_ID/_KEY/_PASSPHRASE secrets + PF_SANDBOX=false.
    merchantId:  env.PAYFAST_MERCHANT_ID  || '10051065',
    merchantKey: env.PAYFAST_MERCHANT_KEY || 'kmit1u2wsugf6',
    passphrase:  env.PAYFAST_PASSPHRASE   || 'sandboxsalestcc',
    processUrl:  sandbox ? 'https://sandbox.payfast.co.za/eng/process'
                         : 'https://www.payfast.co.za/eng/process',
    validateUrl: sandbox ? 'https://sandbox.payfast.co.za/eng/query/validate'
                         : 'https://www.payfast.co.za/eng/query/validate',
    siteUrl:     env.SITE_URL || 'https://tygerbergcc.co.za'
  };
}

/* ---- MD5 via Web Crypto is NOT available (SubtleCrypto lacks MD5).
   PayFast signatures require MD5, so we ship a compact MD5 impl. ---- */
function md5(str) {
  function rl(n, c){ return (n << c) | (n >>> (32 - c)); }
  function au(x, y){ const l = (x & 0xFFFF) + (y & 0xFFFF); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xFFFF); }
  function cmn(q, a, b, x, s, t){ return au(rl(au(au(a, q), au(x, t)), s), b); }
  function ff(a,b,c,d,x,s,t){ return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a,b,c,d,x,s,t){ return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a,b,c,d,x,s,t){ return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a,b,c,d,x,s,t){ return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function tb(s){
    const n = s.length, b = [];
    for (let i = 0; i < n * 8; i += 8) b[i >> 5] |= (s.charCodeAt(i / 8) & 0xFF) << (i % 32);
    return b;
  }
  function bh(b){
    let s = '';
    for (let i = 0; i < b.length * 32; i += 8) s += String.fromCharCode((b[i >> 5] >>> (i % 32)) & 0xFF);
    return s;
  }
  function hex(s){
    const h = '0123456789abcdef'; let o = '';
    for (let i = 0; i < s.length; i++){ const c = s.charCodeAt(i); o += h.charAt((c >>> 4) & 0x0F) + h.charAt(c & 0x0F); }
    return o;
  }
  function utf8(s){ return unescape(encodeURIComponent(s)); }

  let x = tb(utf8(str)); const len = utf8(str).length * 8;
  x[len >> 5] |= 0x80 << (len % 32);
  x[(((len + 64) >>> 9) << 4) + 14] = len;
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < x.length; i += 16){
    const oa=a, ob=b, oc=c, od=d;
    a=ff(a,b,c,d,x[i],7,-680876936);      d=ff(d,a,b,c,x[i+1],12,-389564586);  c=ff(c,d,a,b,x[i+2],17,606105819);  b=ff(b,c,d,a,x[i+3],22,-1044525330);
    a=ff(a,b,c,d,x[i+4],7,-176418897);    d=ff(d,a,b,c,x[i+5],12,1200080426);  c=ff(c,d,a,b,x[i+6],17,-1473231341);b=ff(b,c,d,a,x[i+7],22,-45705983);
    a=ff(a,b,c,d,x[i+8],7,1770035416);    d=ff(d,a,b,c,x[i+9],12,-1958414417); c=ff(c,d,a,b,x[i+10],17,-42063);    b=ff(b,c,d,a,x[i+11],22,-1990404162);
    a=ff(a,b,c,d,x[i+12],7,1804603682);   d=ff(d,a,b,c,x[i+13],12,-40341101);  c=ff(c,d,a,b,x[i+14],17,-1502002290);b=ff(b,c,d,a,x[i+15],22,1236535329);
    a=gg(a,b,c,d,x[i+1],5,-165796510);    d=gg(d,a,b,c,x[i+6],9,-1069501632);  c=gg(c,d,a,b,x[i+11],14,643717713); b=gg(b,c,d,a,x[i],20,-373897302);
    a=gg(a,b,c,d,x[i+5],5,-701558691);    d=gg(d,a,b,c,x[i+10],9,38016083);    c=gg(c,d,a,b,x[i+15],14,-660478335);b=gg(b,c,d,a,x[i+4],20,-405537848);
    a=gg(a,b,c,d,x[i+9],5,568446438);     d=gg(d,a,b,c,x[i+14],9,-1019803690); c=gg(c,d,a,b,x[i+3],14,-187363961); b=gg(b,c,d,a,x[i+8],20,1163531501);
    a=gg(a,b,c,d,x[i+13],5,-1444681467);  d=gg(d,a,b,c,x[i+2],9,-51403784);    c=gg(c,d,a,b,x[i+7],14,1735328473); b=gg(b,c,d,a,x[i+12],20,-1926607734);
    a=hh(a,b,c,d,x[i+5],4,-378558);       d=hh(d,a,b,c,x[i+8],11,-2022574463); c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i+14],23,-35309556);
    a=hh(a,b,c,d,x[i+1],4,-1530992060);   d=hh(d,a,b,c,x[i+4],11,1272893353);  c=hh(c,d,a,b,x[i+7],16,-155497632); b=hh(b,c,d,a,x[i+10],23,-1094730640);
    a=hh(a,b,c,d,x[i+13],4,681279174);    d=hh(d,a,b,c,x[i],11,-358537222);    c=hh(c,d,a,b,x[i+3],16,-722521979); b=hh(b,c,d,a,x[i+6],23,76029189);
    a=hh(a,b,c,d,x[i+9],4,-640364487);    d=hh(d,a,b,c,x[i+12],11,-421815835); c=hh(c,d,a,b,x[i+15],16,530742520); b=hh(b,c,d,a,x[i+2],23,-995338651);
    a=ii(a,b,c,d,x[i],6,-198630844);      d=ii(d,a,b,c,x[i+7],10,1126891415);  c=ii(c,d,a,b,x[i+14],15,-1416354905);b=ii(b,c,d,a,x[i+5],21,-57434055);
    a=ii(a,b,c,d,x[i+12],6,1700485571);   d=ii(d,a,b,c,x[i+3],10,-1894986606); c=ii(c,d,a,b,x[i+10],15,-1051523);  b=ii(b,c,d,a,x[i+1],21,-2054922799);
    a=ii(a,b,c,d,x[i+8],6,1873313359);    d=ii(d,a,b,c,x[i+15],10,-30611744);  c=ii(c,d,a,b,x[i+6],15,-1560198380);b=ii(b,c,d,a,x[i+13],21,1309151649);
    a=ii(a,b,c,d,x[i+4],6,-145523070);    d=ii(d,a,b,c,x[i+11],10,-1120210379);c=ii(c,d,a,b,x[i+2],15,718787259);  b=ii(b,c,d,a,x[i+9],21,-343485551);
    a=au(a,oa); b=au(b,ob); c=au(c,oc); d=au(d,od);
  }
  return hex(bh([a, b, c, d]));
}

/* ---- signature over an ordered field object ----
   PayFast rule: fields in the ORDER THEY ARE SUBMITTED (for the process
   redirect), url-encoded, '&'-joined, then passphrase appended if set.
   For the ITN, the order is the order received. Empty values excluded. */
function pfUrlEncode(value) {
  // PHP urlencode() equivalent: encodeURIComponent already yields UPPERCASE
  // hex (spec), which is what PayFast expects. We only add the extra chars PHP
  // escapes (! ' ( ) * ~) and turn %20 into '+'. Do NOT lowercase.
  return encodeURIComponent(String(value))
    .replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

/* ---- ITN signature ----
   CRITICAL: the ITN signs DIFFERENTLY from checkout:
   (1) fields in PayFast's fixed DOCUMENTATION order (not received order), and
   (2) empty fields are KEPT in the string (checkout excludes them).
   Verified against a real sandbox ITN signature. */
const PF_ITN_FIELD_ORDER = [
  'm_payment_id', 'pf_payment_id', 'payment_status', 'item_name', 'item_description',
  'amount_gross', 'amount_fee', 'amount_net',
  'custom_str1', 'custom_str2', 'custom_str3', 'custom_str4', 'custom_str5',
  'custom_int1', 'custom_int2', 'custom_int3', 'custom_int4', 'custom_int5',
  'name_first', 'name_last', 'email_address', 'merchant_id'
];
function pfItnSignature(data, passphrase) {
  const parts = [];
  for (const k of PF_ITN_FIELD_ORDER) {
    if (!(k in data)) continue;         // field absent entirely → skip
    // NOTE: present-but-empty fields ARE included (unlike checkout).
    parts.push(k + '=' + pfUrlEncode(String(data[k]).trim()));
  }
  let str = parts.join('&');
  if (passphrase) str += '&passphrase=' + pfUrlEncode(passphrase.trim());
  return md5(str);
}

function pfSignature(fields, passphrase) {
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v === null || v === undefined) continue;
    parts.push(k + '=' + pfUrlEncode(String(v).trim()));
  }
  let str = parts.join('&');
  if (passphrase) str += '&passphrase=' + pfUrlEncode(passphrase.trim());
  return md5(str);
}

/* ---- build the redirect field set for a checkout ----
   Returned to the storefront, which auto-POSTs to processUrl. */
function pfBuildCheckout(order, payment, env) {
  const cfg = pfConfig(env);
  // Order matters — this is the canonical PayFast field order.
  const fields = {
    merchant_id:   cfg.merchantId,
    merchant_key:  cfg.merchantKey,
    return_url:    cfg.siteUrl + '/store-return.html?payment=' + payment.id,
    cancel_url:    cfg.siteUrl + '/store-return.html?cancelled=1&payment=' + payment.id,
    notify_url:    'https://tcc-admin.bydaries.workers.dev/?pf_itn=1', // ITN endpoint (see route)
    name_first:    (order.buyer_name || '').split(' ')[0] || 'Member',
    email_address: order.buyer_email,
    m_payment_id:  payment.id,                       // our id — ties ITN back to the order
    amount:        (order.total_cents / 100).toFixed(2),
    item_name:     'TCC Order ' + (order.order_no ? '#' + order.order_no : '')
  };
  fields.signature = pfSignature(fields, cfg.passphrase);
  return { processUrl: cfg.processUrl, fields };
}

/* ---- ITN handler: the ONLY trusted 'paid' signal.
   Runs the four PayFast security checks before settling. ---- */
async function handlePayfastITN(request, env, SB, KEY, H, settlePaidOrder) {
  const cfg = pfConfig(env);
  const raw = await request.text();               // form-urlencoded
  const params = new URLSearchParams(raw);
  const data = {};
  for (const [k, v] of params.entries()) data[k] = v;

  const log = (...a) => console.log('PF ITN:', ...a);
  log('received', JSON.stringify(data));

  // Rebuild the signature over everything EXCEPT the signature field,
  // in the order received (PayFast posts in a fixed order).
  const received = data.signature;
  const check = {};
  for (const [k, v] of Object.entries(data)) { if (k !== 'signature') check[k] = v; }

  // ── CHECK 1: signature valid ──
  // ITN uses a DIFFERENT rule from checkout: fixed field order + empty fields kept.
  const expected = pfItnSignature(data, cfg.passphrase);
  const sigOk = expected === received;
  log('sig check', { sigOk, expected, received, passphraseSet: !!cfg.passphrase });

  // ── CHECK 2: source IP (ADVISORY in sandbox — sandbox sends from IPs not in
  //    the production ranges, so we log but DO NOT reject on it. The postback
  //    validation below is the real security guarantee.) ──
  const pfRanges = [
    '197.97.145.144/28', '41.74.179.192/27',
    '102.216.36.0/28', '102.216.36.128/28', '144.126.193.139/32'
  ];
  const srcIp = request.headers.get('cf-connecting-ip') || '';
  const ipOk = ipInRanges(srcIp, pfRanges);
  log('ip check', { srcIp, ipOk, note: 'advisory only' });

  // ── CHECK 4: server-to-server validate with PayFast ──
  let postbackOk = false, vText = '';
  try {
    const vRes = await fetch(cfg.validateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: raw
    });
    vText = (await vRes.text()).trim();
    postbackOk = vText === 'VALID';
  } catch (e) { vText = 'postback error: ' + e.message; }
  log('postback check', { postbackOk, vText, validateUrl: cfg.validateUrl });

  // ── CHECK 3: amount matches our order ──
  const paymentId = data.m_payment_id;
  const pr = await fetch(`${SB}/rest/v1/payments?id=eq.${paymentId}&select=*`,
    { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
  const [pay] = await pr.json();
  if (!pay) {
    log('unknown payment', paymentId);
    try {
      await fetch(`${SB}/rest/v1/itn_log`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          m_payment_id: paymentId, payment_status: data.payment_status,
          amount_gross: data.amount_gross, sig_ok: sigOk, postback_ok: postbackOk,
          amount_ok: false, settled: false, raw: data
        })
      });
    } catch (e) {}
    return new Response('unknown payment', { status: 200 });
  }
  const expectCents = pay.amount_cents;
  const gotCents = Math.round(parseFloat(data.amount_gross) * 100);
  const amountOk = Math.abs(expectCents - gotCents) === 0;
  log('amount check', { amountOk, expectCents, gotCents });

  // ── Decision: require signature + postback + amount (IP is advisory).
  //    In sandbox, if PF_ITN_LENIENT=true, settle when postback OR signature
  //    passes, so a single flaky check doesn't strand the order while testing.
  const lenient = env.PF_ITN_LENIENT === 'true';
  const strictOk = sigOk && postbackOk && amountOk;
  const lenientOk = amountOk && (sigOk || postbackOk);
  const shouldSettle = (lenient ? lenientOk : strictOk) && data.payment_status === 'COMPLETE';
  log('decision', { strictOk, lenientOk, lenient, paymentStatus: data.payment_status, shouldSettle });

  if (shouldSettle) {
    await settlePaidOrder(paymentId, 'payfast', data.pf_payment_id, data, SB, KEY, H, env);
    log('SETTLED', paymentId);
  } else {
    log('NOT settled', { sigOk, postbackOk, amountOk, ipOk });
  }

  // Write diagnostics onto the PAYMENT row (guaranteed to exist — we fetched it
  // above). This can't silently vanish like an itn_log insert to a missing table.
  try {
    await fetch(`${SB}/rest/v1/payments?id=eq.${paymentId}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({
        meta: {
          itn_seen_at: new Date().toISOString(),
          payment_status: data.payment_status,
          sig_ok: sigOk, expected_sig: expected, received_sig: received,
          postback_ok: postbackOk, postback_text: vText,
          amount_ok: amountOk, expect_cents: pay.amount_cents, got_gross: data.amount_gross,
          ip_ok: ipOk, src_ip: srcIp,
          should_settle: shouldSettle, lenient
        }
      })
    });
  } catch (e) { log('meta write failed', e.message); }

  // Best-effort itn_log too (ignore if table absent)
  try {
    await fetch(`${SB}/rest/v1/itn_log`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        m_payment_id: paymentId, payment_status: data.payment_status,
        amount_gross: data.amount_gross, sig_ok: sigOk, postback_ok: postbackOk,
        amount_ok: amountOk, settled: shouldSettle, raw: data
      })
    });
  } catch (e) { log('itn_log write failed', e.message); }

  // Always 200 so PayFast stops retrying.
  return new Response('ok', { status: 200 });
}

/* simple CIDR match for IPv4 */
function ipInRanges(ip, ranges) {
  const toInt = a => a.split('.').reduce((n, o) => (n << 8) + parseInt(o, 10), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const ipInt = toInt(ip);
  return ranges.some(r => {
    const [net, bits] = r.split('/');
    const mask = bits === '32' ? 0xFFFFFFFF : (~((1 << (32 - parseInt(bits, 10))) - 1)) >>> 0;
    return (ipInt & mask) === (toInt(net) & mask);
  });
}


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
   PASSWORD HASHING  (PBKDF2-HMAC-SHA256, Web Crypto)
   Stored format is self-describing — no DB schema change:
     pbkdf2$<iters>$<saltHex>$<hashHex>
   Legacy rows are bare 64-char SHA-256 hex and are upgraded
   in place on the next successful login.
══════════════════════════════════════════════════════ */
const PBKDF2_ITERS = 100000;

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBuf(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2Derive(password, saltBytes, iters) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: iters, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return bufToHex(bits);
}

// New strong hash for storage.
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Derive(password, salt, PBKDF2_ITERS);
  return `pbkdf2$${PBKDF2_ITERS}$${bufToHex(salt)}$${hash}`;
}

// Legacy unsalted SHA-256 — only used to verify/upgrade old rows.
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return bufToHex(buf);
}

// Constant-time string comparison (avoids login timing side-channel).
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verify a plaintext password against a stored value (either scheme).
// Returns { ok, upgrade } — `upgrade` is a fresh pbkdf2 string when a
// legacy row matched and should be migrated, otherwise null.
async function verifyPassword(password, stored) {
  if (!password || !stored) return { ok: false, upgrade: null };
  if (stored.startsWith('pbkdf2$')) {
    const parts = stored.split('$');
    const iters = parseInt(parts[1], 10);
    const computed = await pbkdf2Derive(password, hexToBuf(parts[2]), iters);
    return { ok: timingSafeEqual(computed, parts[3]), upgrade: null };
  }
  // Legacy unsalted SHA-256 hex
  const legacy = await sha256Hex(password);
  if (timingSafeEqual(legacy, stored)) {
    return { ok: true, upgrade: await hashPassword(password) };
  }
  return { ok: false, upgrade: null };
}

/* ══════════════════════════════════════════════════════
   ROLE PERMISSIONS
   '*' = full access. All other values are exact action strings.
══════════════════════════════════════════════════════ */
const ROLE_PERMISSIONS = {
  super: ['*'],
  scores: [
    'timesheet.me','timesheet.myEntries','timesheet.saveEntry','timesheet.submit','timesheet.deleteEntry',
    'fantasy.savePlayerValues',
    'fantasy.createRound','fantasy.updateRound','fantasy.lockRound','fantasy.unlockRound','fantasy.deleteRound',
    'fantasy.replaceRoundScores','fantasy.listParticipants','fantasy.carryForwardRound',
    'fantasy.clearRoundScores','fantasy.saveScores','fantasy.notifyScores',
    'fantasy.createH2HFixtures','fantasy.resolveH2H','fantasy.resendH2HDraw','fantasy.resendH2HResult',
    'fantasy.saveBadgesAndNotify','fantasy.autoScoreRound',
    'fantasy.notifyRound',
    'player.insert','player.update','player.delete','player.get','player.listFantasy',
    'fixtures.insert','fixtures.update','fixtures.delete',
    'coaching.insertMatch','coaching.updateMatch','coaching.deleteMatch',
    'coaching.insertSession','coaching.updateSession','coaching.deleteSession',
    'coaching.insertDev','coaching.updateDev','coaching.deleteDev',
    'coaching.upsertKpi','coaching.deleteKpi','coaching.saveReport',
    'coaching.saveSkills','coaching.deletePlayerSkills','coaching.upsertSkillDef','coaching.deleteSkillDef',
    'registration.list','registration.review','registration.candidates','registration.promote',
    'store.listOrders','store.markCollected','store.saveProduct',
    'store.deleteOrder','store.sweepStale',
    'store.listProductsAdmin','store.saveVariants','store.deleteProduct','store.uploadImage',
    'calendar.feed','events.list','events.insert','events.update','events.delete','storage.uploadEvent','birthday.today',
    'tournament.save','tournament.saveTeam','tournament.deleteTeam','tournament.linkFixture',
    'tournament.saveResult','tournament.deleteResult','tournament.captureFromMatch',
    'tournament.saveSquad','tournament.deletePlayer',
  ],
  content: [
    'timesheet.me','timesheet.myEntries','timesheet.saveEntry','timesheet.submit','timesheet.deleteEntry',
    'gallery.insert','gallery.update','gallery.delete','gallery.deleteAlbum','gallery.updateOrder','gallery.renameAlbum',
    'storage.upload','storage.uploadNews','storage.delete',
    'news.insert','news.update','news.delete',
    'calendar.feed','events.list','events.insert','events.update','events.delete','storage.uploadEvent','birthday.today',
    'bio.list','bio.approve','bio.reject',
    'player.insert','player.update','player.get',
  ],
  fixtures: [
    'timesheet.me','timesheet.myEntries','timesheet.saveEntry','timesheet.submit','timesheet.deleteEntry',
    'fixtures.insert','fixtures.update','fixtures.delete',
    'calendar.feed','events.list','events.insert','events.update','events.delete','storage.uploadEvent','birthday.today',
  ],
  // Coaching staff — full access to the Coaching Analytics tab only
  coach: [
    'timesheet.me','timesheet.myEntries','timesheet.saveEntry','timesheet.submit','timesheet.deleteEntry',
    'calendar.feed','events.list','birthday.today',
    'coaching.insertMatch','coaching.updateMatch','coaching.deleteMatch',
    'coaching.insertSession','coaching.updateSession','coaching.deleteSession',
    'coaching.insertDev','coaching.updateDev','coaching.deleteDev',
    'coaching.upsertKpi','coaching.deleteKpi','coaching.saveReport',
    'coaching.saveSkills','coaching.deletePlayerSkills','coaching.upsertSkillDef','coaching.deleteSkillDef',
  ],
  // Finance committee — READ-ONLY view of shop orders + CSV export.
  // No mark-collected, no confirm-ready, no delete, no product edits.
  finance: [
    'agreement.create','agreement.list','agreement.one','agreement.void',
    'agreement.uploadFile','agreement.fileAdmin',
    'store.listOrders',
    'timesheet.me','timesheet.myEntries','timesheet.saveEntry','timesheet.submit','timesheet.deleteEntry',
    'timesheet.review','timesheet.approve','timesheet.reject',
    'timesheet.workers','timesheet.saveWorker','timesheet.summary','timesheet.markPaid','timesheet.markFeePaid',
  ],
  registrar: [
    'timesheet.me','timesheet.myEntries','timesheet.saveEntry','timesheet.submit','timesheet.deleteEntry',
    'calendar.feed','events.list','birthday.today',
    'fantasy.listParticipants',
    'fantasy.approveParticipant','fantasy.rejectParticipant','fantasy.deleteParticipant',
    'bio.list','bio.approve','bio.reject',
  ],
  // Issued by fantasy.verifyOTP — scoped to the participant's own data
  participant: [
    'fantasy.updateProfile','fantasy.submitPicks','fantasy.getMyPicks',
  ],
  // Issued by scoring.auth (PIN exchange) — scoped to live scoring writes
  scorer: [
    'scoring.push','scoring.setResult','scoring.takeover','scoring.abandon',
    'squad.get','squad.save',
    /* Filing a tournament result: the scorers are the people at the matches.
       captureFromMatch reads the score from the saved match, so a phone can
       file only what it actually scored. */
    'tournament.saveResult','tournament.deleteResult','tournament.captureFromMatch',
  ],
  /* PAFCO — the playing affairs committee. Everything to do with who plays:
     the players themselves, registrations and bios, the fixture list and the
     playing calendar, coaching, the tournament, and discipline. Nothing to do
     with money, the shop, the website's content or who has a login. */
  pafco: [
    'timesheet.me','timesheet.myEntries','timesheet.saveEntry','timesheet.submit','timesheet.deleteEntry',
    'calendar.feed','events.list','events.insert','events.update','events.delete','storage.uploadEvent','birthday.today',
    'player.insert','player.update','player.delete','player.get',
    'bio.list','bio.approve','bio.reject',
    'registration.list','registration.review','registration.candidates','registration.promote',
    'fixtures.insert','fixtures.update','fixtures.delete',
    'coaching.insertMatch','coaching.updateMatch','coaching.deleteMatch',
    'coaching.insertSession','coaching.updateSession','coaching.deleteSession',
    'coaching.insertDev','coaching.updateDev','coaching.deleteDev',
    'coaching.upsertKpi','coaching.deleteKpi','coaching.saveReport',
    'coaching.saveSkills','coaching.deletePlayerSkills','coaching.upsertSkillDef','coaching.deleteSkillDef',
    'tournament.save','tournament.saveTeam','tournament.deleteTeam','tournament.linkFixture',
    'tournament.saveResult','tournament.deleteResult','tournament.captureFromMatch',
    'tournament.saveSquad','tournament.deletePlayer',
    /* Discipline is playing affairs. Withdrawing one is allowed; deleting a
       record outright stays with the chair. */
    'warning.create','warning.list','warning.one','warning.void',
  ],
  // Club chairman — oversight. View-only: can READ the registration and
  // bio lists (both go through the Worker) plus the confidentiality register.
  // No write actions; grant more here as needed.
  chair: [
    'agreement.create','agreement.list','agreement.one','agreement.void','agreement.delete',
    'agreement.uploadFile','agreement.fileAdmin',
    'warning.create','warning.list','warning.one','warning.void','warning.delete',
    'registration.list','bio.list','player.get',
    'timesheet.me','timesheet.myEntries','timesheet.saveEntry','timesheet.submit','timesheet.deleteEntry',
    'timesheet.review','timesheet.approve','timesheet.reject',
    'timesheet.workers','timesheet.saveWorker','timesheet.summary','timesheet.markPaid','timesheet.markFeePaid',
    'calendar.feed','events.list','birthday.today',
  ],
  // Club captain — signs off hours (confirms the work happened) but never
  // sees rates, fees or the payment run. Pay stays with finance and chair.
  captain: [
    'warning.create','warning.list','warning.one',
    'timesheet.me','timesheet.myEntries','timesheet.saveEntry','timesheet.submit','timesheet.deleteEntry',
    'timesheet.review','timesheet.approve','timesheet.reject',
    'calendar.feed','events.list','birthday.today',
  ],
};

/* ══════════════════════════════════════════════════════
   FANTASY PICK VALIDATION — server-side rules of the game.
   Top-level (not inline in the case) so it can be unit-
   tested in node. Returns { ok:true, effectiveChip,
   alreadyLogged } or { ok:false, error }.
══════════════════════════════════════════════════════ */
/* ── Arcade leaderboard ──────────────────────────────────────
   39 runs is the best possible single ball in Six & Out, measured
   against the game's own scoring code: a golden ball (12) at a x3
   streak multiplier, plus the +3 Fire Mode bonus. Anything above
   balls x 39 did not happen.

   Keep this in step with the CHECK constraint in 1-game-scores.sql
   and with the game's scoring. If the game's maximum ball ever
   changes, both numbers change together or the board starts refusing
   honest innings. */
const GAME_MAX_PER_BALL    = 39;
const GAME_RATE_WINDOW_MS  = 60 * 1000;
const GAME_RATE_MAX        = 6;

/* Last Over Hero is a chase, not an innings, so it does not fit the
   one-number shape above. Its legal targets come straight from
   LOH.POOLS in the game's ui.js, and 12 is its best possible ball —
   a six on a golden ball, doubled. Six deliveries in an over.

   Keep this in step with 2-last-over-hero.sql, which carries the same
   rules as a CHECK constraint. If the pools in the game ever change,
   three places change together or honest chases start being refused. */
const LOH_TARGETS = {
  club:   [6, 8, 10, 12, 14, 16],
  first:  [12, 15, 18, 20, 22, 24],
  legend: [24, 27, 30, 33, 36, 40],
};
const LOH_MAX_PER_BALL = 12;
const LOH_BALLS        = 6;

const GAME_IDS = ['six_and_out', 'last_over_hero'];

/* What a submission for each game has to satisfy. Returns null when it
   is fine, or the reason it is not. Pure, so the tests can hold it to
   the same cases as the database. */
function gameScoreProblem(g) {
  if (g.game === 'six_and_out') {
    if (g.balls > 1000) return 'balls';
    if (g.best_shot > GAME_MAX_PER_BALL) return 'best_shot';
    if (g.score > g.balls * GAME_MAX_PER_BALL) return 'score';
    return null;
  }
  if (g.game === 'last_over_hero') {
    const legal = LOH_TARGETS[g.difficulty];
    if (!legal) return 'difficulty';
    if (!legal.includes(g.target)) return 'target';
    if (g.balls > LOH_BALLS) return 'balls';
    if (g.best_shot > LOH_MAX_PER_BALL) return 'best_shot';
    if (g.score > g.balls * LOH_MAX_PER_BALL) return 'score';
    if (!(g.balls_left >= 0 && g.balls_left <= LOH_BALLS - 1)) return 'balls_left';
    if (g.balls + g.balls_left > LOH_BALLS) return 'balls_left';
    if (typeof g.won !== 'boolean') return 'won';
    /* You cannot win a chase without reaching the total. */
    if (g.won && g.score < g.target) return 'won';
    return null;
  }
  return 'game';
}

const FANTASY_BUDGET       = 100;
const FANTASY_BOOST_AMOUNT = 25;
const FANTASY_SQUAD_SIZE   = 11;
/* Every chip name the pick screen has ever sent. The screen offered four
   power-ups while this list held two, so three of them came back "Unknown
   chip" and the manager could not submit a team at all — the power-up, not
   the squad, was the problem, and nothing said so.

   captain_safety is the page's name; captain_safety_net was this file's.
   Both are kept so no saved row is orphaned by the spelling.

   IMPORTANT: being accepted here is not the same as being scored. The word
   "chip" appears nowhere in the points calculation, so of these only
   budget_boost does anything — it raises the cap at pick time, which needs
   no scoring support. Until the others are implemented, the pick screen
   offers budget_boost alone; they stay here only so a cached page cannot
   hard-fail a save. */
/* Exactly the list the database will accept, checked against the live
   CHECK constraint on fantasy_picks.chip and fantasy_chip_usage.chip.
   captain_safety_net was this file's old spelling and is deliberately
   NOT here: no row has ever used it, so 4-chip-constraint.sql did not
   carry it forward, and a chip the Worker waves through only for
   Postgres to refuse is worse than one refused up front with a clear
   message. If a name is ever added here, add it to that constraint in
   the same change. */
const FANTASY_CHIPS        = ['triple_captain', 'bench_boost',
                              'budget_boost', 'captain_safety'];
/* How many rounds in a row we will copy a team forward before giving up
   on a manager.

   Carrying forward is a kindness to somebody who forgot, and it is how
   the Premier League game behaves — except that there a squad persists
   by design and transfers are rationed, so leaving it alone is a real
   strategy. Here a team is submitted per round and transfers are free,
   so doing nothing is strictly worse than doing something: the carry
   only ever helps people who missed the deadline.

   Which also means an abandoned team would otherwise score and hold a
   league position all season. In a league of millions nobody notices a
   ghost. In nineteen it is corrosive, and unfair on the manager who
   turns up every week and has a bad run. One missed round is life;
   three in a row is gone. */
const FANTASY_CARRY_LIMIT  = 3;
/* Captain Safety Net, mirroring resolveCaptaincy() in leaderboard.js, which
   is where this rule was first written and where managers read their points.
   When the chip is on and the chosen captain's BASE score (no multipliers,
   no round boost) is under 10, the vice-captain is promoted to captain and
   the old captain drops back to a plain ×1 player.

   This lives at the top level on purpose. The same scoring arithmetic is
   written out four times across this platform — twice below, once in
   admin.js for badges, once in leaderboard.js — and they have already
   drifted apart. Anything new goes in one place. */
function fantasyResolveCaptaincy(pick, baseOf) {
  let capId = pick.captain_id, vcId = pick.vice_captain_id, triggered = false;
  if (pick.chip === 'captain_safety' && capId && vcId) {
    if (baseOf(capId) < 10) {
      capId = pick.vice_captain_id;   // the VC takes the armband, at ×2
      vcId  = null;                   // and no ×1.5 remains to award
      triggered = true;
    }
  }
  return { capId, vcId, triggered };
}

/* ══════════════════════════════════════════════════════════════════
   FANTASY SCORING — the one implementation
   ══════════════════════════════════════════════════════════════════
   There were six, and no two agreed:

     leaderboard.js calcPoints    season standings — chips, no round boost
     leaderboard.js calcLivePts   live view       — round boost, no chips
     live-worker    calcPtsWorker H2H seeding     — both   (now deleted)
     live-worker    calcPtsResolve H2H results    — both   (now deleted)
     admin.js       _calcPts      badges          — neither, and no
                                                    economy or maidens

   So a manager could watch one number on the live view, find another on
   the standings, have their head-to-head decided on a third and their
   badges on a fourth. Every difference was an accident of which file
   a feature happened to be added to, not a rule anyone chose.

   The rule here is the union: every feature that exists applies, every
   time. Economy and maidens count. Round boost modifiers count. Chips
   count. Nothing is scored differently depending on which screen is
   asking.

   Callers normalise their input into a score object and this does the
   rest, so a live match (overs and runs conceded) and a filed scorecard
   (an economy figure) go down the same path.
   ══════════════════════════════════════════════════════════════════ */

/* Combine several fantasy_scores rows for one player in one round.
   Mirrors aggregate() in js/fantasy-scoring.js — see the note there.
   Counting stats add up; economy is a rate, so it is recomputed from
   total overs and runs conceded where those are present, and otherwise
   averaged across the non-null figures. Taking "the last non-null one",
   as this used to, made a two-match round depend on row order. */
function fantasyAggregateScores(rows) {
  const out = { runs: 0, wickets: 0, maidens: 0, catches: 0, stumpings: 0,
                runouts: 0, overs: null, runs_conceded: null,
                economy: null, player_of_match: false };
  let overs = 0, conceded = 0, bowled = false, econSum = 0, econN = 0, any = false;
  (rows || []).forEach(s => {
    if (!s) return;
    any = true;
    out.runs      += Number(s.runs      || 0);
    out.wickets   += Number(s.wickets   || 0);
    out.maidens   += Number(s.maidens   || 0);
    out.catches   += Number(s.catches   || 0);
    out.stumpings += Number(s.stumpings || 0);
    out.runouts   += Number(s.runouts   || 0);
    if (s.player_of_match) out.player_of_match = true;
    const o = (s.overs != null && s.overs !== '') ? Number(s.overs) : null;
    const c = (s.runs_conceded != null && s.runs_conceded !== '') ? Number(s.runs_conceded)
            : (s.runsBowled   != null && s.runsBowled   !== '') ? Number(s.runsBowled)
            : null;
    if (o != null && o > 0) {
      bowled = true;
      overs += o;
      conceded += (c != null) ? c : (s.economy != null ? Number(s.economy) * o : 0);
    } else if (o == null && s.economy != null && Number(s.economy) > 0) {
      econSum += Number(s.economy); econN++;
    }
  });
  if (!any) return null;
  if (bowled) {
    out.overs = overs; out.runs_conceded = conceded; out.economy = conceded / overs;
  } else if (econN > 0) {
    out.economy = econSum / econN;
  }
  return out;
}

/* A score, however it arrived:
     { runs, wickets, maidens, catches, stumpings, runouts,
       economy (number|null), player_of_match (bool) }            */
/* OVERS IS THE SIGNAL for whether a player bowled. See the long note on
   normalise() in js/fantasy-scoring.js: `economy > 0` excluded the best
   figure there is (0.00, conceding nothing) and could not simply be
   relaxed, because the score template told people to type 0 for someone
   who had not bowled at all. Rows filed before the overs column existed
   keep the old rule so their numbers do not move. */
function fantasyNormaliseScore(s) {
  if (!s) return null;
  const overs    = (s.overs != null && s.overs !== '') ? Number(s.overs) : null;
  const conceded = (s.runs_conceded != null && s.runs_conceded !== '') ? Number(s.runs_conceded)
                 : (s.runsBowled   != null && s.runsBowled   !== '') ? Number(s.runsBowled)
                 : null;
  let economy = null;
  if (overs != null && overs > 0) {
    if (conceded != null)       economy = conceded / overs;
    else if (s.economy != null) economy = Number(s.economy);
  } else if (overs == null && s.economy != null && Number(s.economy) > 0) {
    economy = Number(s.economy);
  }
  return {
    runs:            Number(s.runs      || 0),
    wickets:         Number(s.wickets   || 0),
    maidens:         Number(s.maidens   || 0),
    catches:         Number(s.catches   || 0),
    stumpings:       Number(s.stumpings || 0),
    runouts:         Number(s.runouts   || 0),
    economy:         (economy != null && isFinite(economy)) ? economy : null,
    player_of_match: !!s.player_of_match,
  };
}

/* Role buckets for the round boost modifiers. 'rounder' rather than an
   exact list, so "Bowling Allrounder" counts as an all-rounder — the
   stricter version silently left those players out of the boost. */
function fantasyRoleBucket(role) {
  const r = String(role || '').toLowerCase().trim();
  if (r.indexOf('rounder') !== -1) return 'allrounder';
  if (r === 'bowler')              return 'bowler';
  if (r === 'wicketkeeper' || r === 'batter' || r === 'batsman') return 'batter';
  return 'other';
}

/* One player's points before any captaincy multiplier. */
function fantasyBasePoints(score, boost, role) {
  const s = fantasyNormaliseScore(score);
  if (!s) return 0;

  let batPts = s.runs;
  if (s.runs >= 50)  batPts += 10;
  if (s.runs >= 100) batPts += 25;

  let bowlPts = s.wickets * 15;
  if (s.wickets >= 5) bowlPts += 20;

  let econPts = 0;
  if (s.economy != null) {
    const e = s.economy;
    const base = e <= 5 ? 10 : e <= 6 ? 6 : e <= 7 ? 2 : e <= 8 ? 0 : e <= 9 ? -2 : -4;
    econPts = boost === 'bonus_economy' ? base * 2 : base;
  }

  const fieldPts = (s.maidens + s.catches + s.stumpings + s.runouts) * 10;
  const potmPts  = s.player_of_match ? (boost === 'potm_double' ? 50 : 25) : 0;

  const bucket = fantasyRoleBucket(role);
  if (boost === 'bowlers_double'    && bucket === 'bowler')     { bowlPts *= 2; econPts *= 2; }
  if (boost === 'batters_double'    && bucket === 'batter')     { batPts  *= 2; }
  if (boost === 'allrounders_boost' && bucket === 'allrounder') {
    batPts  = Math.round(batPts  * 1.5);
    bowlPts = Math.round(bowlPts * 1.5);
  }

  return batPts + bowlPts + econPts + fieldPts + potmPts;
}

/* One player's points with the armband applied. */
function fantasyPlayerPoints(score, o) {
  const pts = fantasyBasePoints(score, o.boost, o.role);
  if (o.isCaptain) return pts * (o.captainMultiplier || 2);
  if (o.isVice)    return Math.round(pts * 1.5);
  return pts;
}

/* A whole pick: eleven players, the armbands, and the chips.

     pick     — { player_ids, captain_id, vice_captain_id, chip }
     scoreOf  — playerId → a score object (or null)
     opts     — { wildcard, boost, roleOf }                        */
function fantasyPickPoints(pick, scoreOf, opts) {
  opts = opts || {};
  const roleOf = opts.roleOf || (() => '');
  const chip   = (pick && pick.chip) || null;

  /* The safety net reads the captain's BASE score — no multipliers, no
     round boost — which is how leaderboard.js has always defined it. */
  const eff = fantasyResolveCaptaincy(pick || {}, id => fantasyBasePoints(scoreOf(id), null, ''));

  const captainMultiplier = (opts.wildcard || chip === 'triple_captain') ? 3 : 2;

  let total = 0;
  ((pick && pick.player_ids) || []).forEach(id => {
    const score = scoreOf(id);
    if (!score) return;
    total += fantasyPlayerPoints(score, {
      isCaptain: id === eff.capId,
      isVice:    id === eff.vcId,
      captainMultiplier,
      boost: opts.boost || null,
      role:  roleOf(id),
    });
  });

  if (chip === 'bench_boost') total += 25;
  return total;
}

function validatePickSubmission(p, players, chipRows, round, now) {
  if (!round)        return { ok: false, error: 'Round not found' };
  if (round.locked)  return { ok: false, error: 'This round is locked' };

  /* The deadline, enforced here rather than left to the clock.

     Only the hourly cron used to close a round, so anything submitted
     between the deadline passing and the next tick was accepted and
     written — up to 59 minutes late, and a manager who knew that could
     pick after seeing how the morning's games were going. The cron
     still runs and still sets locked; this makes the deadline itself
     the thing that closes picks.

     A round with no deadline, or an unreadable one, stays open: a bad
     date should not lock a whole league out of a round. `locked` above
     remains the way to close one deliberately. */
  const at = (now === undefined || now === null) ? Date.now() : now;
  if (round.deadline) {
    const dl = new Date(round.deadline).getTime();
    if (isFinite(dl) && at >= dl) {
      return { ok: false, error: 'The deadline for this round has passed — picks are closed.' };
    }
  }

  const ids = p.player_ids;
  if (!Array.isArray(ids) || ids.length !== FANTASY_SQUAD_SIZE) {
    return { ok: false, error: 'Squad must have exactly ' + FANTASY_SQUAD_SIZE + ' players' };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'Duplicate players in squad' };
  }
  /* PostgREST answers an error with an OBJECT, not an array — a missing
     relation, a permissions problem, a timeout. Spreading that into forEach
     threw a TypeError that surfaced to the manager as the raw text
     "(players || []).forEach is not a function" on a failed save. Never let
     the shape of an error decide whether a squad is valid. */
  if (!Array.isArray(players)) {
    return { ok: false, error: 'The squad list could not be read just now, so nothing was saved. Please tell the club.' };
  }
  const byId = {};
  players.forEach(pl => { byId[pl.id] = pl; });
  for (const id of ids) {
    if (!byId[id]) return { ok: false, error: 'Your squad has someone in it who cannot be picked. Reload the page and pick again.' };
  }
  if (!p.captain_id || !ids.includes(p.captain_id)) {
    return { ok: false, error: 'Captain must be in your squad' };
  }
  if (!p.vice_captain_id || !ids.includes(p.vice_captain_id)) {
    return { ok: false, error: 'Vice-captain must be in your squad' };
  }
  if (p.captain_id === p.vice_captain_id) {
    return { ok: false, error: 'Captain and vice-captain must differ' };
  }

  const chip = p.chip || null;
  if (chip && !FANTASY_CHIPS.includes(chip)) {
    return { ok: false, error: 'Unknown chip' };
  }
  const thisRound = (chipRows || []).filter(r => r.round_id === round.id);
  const usedElsewhere = chip && (chipRows || []).some(r => r.chip === chip && r.round_id !== round.id);
  if (usedElsewhere) return { ok: false, error: 'That chip was already used in a previous round' };

  /* While the round is open, the chip is whatever the manager just sent —
     including nothing at all.

     This used to read `chip || thisRound[0].chip`, with the note "a chip
     logged for this round stays burned even if resubmitting without it".
     That made a power-up impossible to take back: untick it, save, and the
     server quietly re-applied the old one, so the row stayed in
     fantasy_chip_usage and the screen still showed it played. Swapping one
     chip for another was refused outright for the same reason.

     Nothing is protected by that. Submissions stop the moment the round
     locks, and no scores are published before then, so there is no window
     in which a manager could see how a chip was doing and withdraw it.
     Changing your mind before the deadline is just changing your mind.

     What stays is the rule that matters: once a chip has been played in a
     round that is finished, it is gone for the season — that is the
     usedElsewhere check above. */
  const effectiveChip  = chip || null;
  const alreadyLogged  = !!effectiveChip && thisRound.some(r => r.chip === effectiveChip);
  /* Rows for this round that no longer reflect the choice, to be cleared. */
  const staleChips     = thisRound.filter(r => r.chip !== effectiveChip).map(r => r.chip);

  const cap  = FANTASY_BUDGET + (effectiveChip === 'budget_boost' ? FANTASY_BOOST_AMOUNT : 0);
  const cost = ids.reduce((s, id) => s + (Number(byId[id].fantasy_value) || 0), 0);
  if (Math.round(cost * 10) / 10 > cap) {
    return { ok: false, error: 'Squad cost R' + cost + ' exceeds the R' + cap + ' budget' };
  }
  return { ok: true, effectiveChip, alreadyLogged, staleChips };
}

/* ══════════════════════════════════════════════════════
   AUTO CARRY-FORWARD
   A manager who entered a team and then missed a deadline keeps the
   team they had, rather than scoring nothing.

   pick.js has done a version of this since the start, but only as a
   pre-fill: open the pick screen and last round's XI is already in it.
   That dies if nobody opens the page, which is exactly the person this
   is for. The rules below are the same rules, moved to the one place
   that runs whether or not anyone is looking.

   Three things this deliberately does NOT do:

     - copy a chip. A power-up is once a season and the manager chose
       when to spend it. validatePickSubmission would reject it anyway
       (usedElsewhere), and silently burning somebody's Budget Boost on
       a round they did not know they were in is indefensible.
     - guess. If the old XI cannot be made legal under this round's
       prices and this round's eligibility, nothing is written.
     - hide. The row is flagged auto_carried, the profile says so, and
       Season Survivor does not count it.
══════════════════════════════════════════════════════ */

/* How many auto-carried rounds a manager has run up, counting back from
   their most recent pick. `picks` must be newest first. A real
   submission anywhere in the run resets it to zero — turning up once
   buys you another three. */
function carryDormancy(picksNewestFirst) {
  let n = 0;
  for (const p of (picksNewestFirst || [])) {
    if (p && p.auto_carried) n++;
    else break;
  }
  return n;
}

/* Rebuild an old XI under current conditions. Pure — no I/O, so the
   tests can hold it to the same cases as the pick screen.

   `eligible` is rows from the fantasy_players VIEW, not the players
   table: the view is the eligibility rule (playing members, not the
   youth squad, minors only with media consent on file). Anyone who has
   left it since — retired, moved to youth, consent lapsed — is simply
   not in it and drops out here.

   Returns { player_ids, captain_id, vice_captain_id } or null when no
   legal XI can be built. */
function buildCarriedPick(prev, eligible, opts) {
  const o         = opts || {};
  const squadSize = o.squadSize || FANTASY_SQUAD_SIZE;
  /* FANTASY_BUDGET flat. No chip is carried, so there is no boost to
     raise the cap — an XI that cost R118 last week only fitted because
     the manager spent their Budget Boost on it. */
  const budget    = (o.budget === undefined || o.budget === null) ? FANTASY_BUDGET : o.budget;

  if (!prev || !Array.isArray(prev.player_ids) || !Array.isArray(eligible)) return null;

  const value = new Map();
  eligible.forEach(p => {
    if (p && p.id) value.set(p.id, Number(p.fantasy_value) || 0);
  });

  /* Still pickable, in the order the manager had them, no duplicates. */
  const seen = new Set();
  let kept = [];
  prev.player_ids.forEach(id => {
    if (value.has(id) && !seen.has(id)) { seen.add(id); kept.push(id); }
  });

  const cost = ids => Math.round(ids.reduce((s, i) => s + (value.get(i) || 0), 0) * 10) / 10;

  /* A shrunk squad size would otherwise carry an illegal team forever. */
  if (kept.length > squadSize) {
    kept.sort((a, b) => (value.get(a) || 0) - (value.get(b) || 0));
    kept = kept.slice(0, squadSize);
  }

  /* Prices move between rounds, so last week's XI can be over this
     week's cap. Drop the dearest until it fits — same rule the pick
     screen uses, so the manager sees the same team either way. */
  while (kept.length && cost(kept) > budget) {
    let dearest = kept[0];
    kept.forEach(id => { if ((value.get(id) || 0) > (value.get(dearest) || 0)) dearest = id; });
    kept = kept.filter(id => id !== dearest);
  }

  /* Back up to a full XI with the cheapest players available. This is
     us choosing somebody's team, which is why it is the cheapest and
     not the best: it is a deterministic rule we can explain, not a
     recommendation, and the manager can see exactly what happened. */
  const inKept = new Set(kept);
  const pool = eligible
    .filter(p => p && p.id && !inKept.has(p.id))
    .map(p => p.id)
    .sort((a, b) => (value.get(a) || 0) - (value.get(b) || 0));
  for (const id of pool) {
    if (kept.length >= squadSize) break;
    if (cost(kept.concat([id])) > budget) continue;
    kept.push(id);
  }

  /* Not enough eligible players, or not enough affordable ones. Write
     nothing: a nine-man XI is a row that validatePickSubmission would
     have refused from a human, and picks nobody could have submitted
     are how a rule set stops meaning anything. */
  if (kept.length !== squadSize) return null;

  /* The armband. Keep the manager's choice where it survived; promote
     their most valuable remaining player where it did not, because the
     Worker requires a captain and a vice who are both in the squad. */
  const byValueDesc = kept.slice().sort((a, b) => (value.get(b) || 0) - (value.get(a) || 0));
  const captain = kept.includes(prev.captain_id) ? prev.captain_id : byValueDesc[0];
  const vice = (kept.includes(prev.vice_captain_id) && prev.vice_captain_id !== captain)
    ? prev.vice_captain_id
    : byValueDesc.find(id => id !== captain);

  if (!captain || !vice || captain === vice) return null;

  return { player_ids: kept, captain_id: captain, vice_captain_id: vice };
}

/* The I/O around the two functions above. Called when a round locks,
   from the cron and from the admin button, so it must be safe to run
   twice: anyone who already has a pick in this round is skipped, and
   that includes rows this job wrote on an earlier pass.

   Never throws. A round must lock whatever happens here. */
async function carryForwardRound(SB, H, roundId) {
  const out = { carried: 0, dormant: 0, skipped: 0, never_played: 0, errors: [] };
  if (!roundId) return out;

  const JH = { ...H, 'Content-Type': 'application/json' };

  /* Rounds in chronological order, so "most recent previous pick" and
     the dormancy run are both well defined. deadline is the only
     ordering the fantasy tables carry. */
  const [roundsR, picksR, eligibleR, partsR] = await Promise.all([
    fetch(`${SB}/rest/v1/fantasy_rounds?select=id,deadline&order=deadline.asc`, { headers: H })
      .then(r => r.json()).catch(() => null),
    fetch(`${SB}/rest/v1/fantasy_picks?select=participant_id,round_id,player_ids,captain_id,vice_captain_id,auto_carried`, { headers: H })
      .then(r => r.json()).catch(() => null),
    fetch(`${SB}/rest/v1/fantasy_players?select=id,fantasy_value`, { headers: H })
      .then(r => r.json()).catch(() => null),
    fetch(`${SB}/rest/v1/fantasy_participants?status=eq.approved&select=id`, { headers: H })
      .then(r => r.json()).catch(() => null),
  ]);

  /* PostgREST answers an error with an object, not an array. Any of
     these unreadable and we have no idea who is missing a team, so the
     only safe move is to write nothing. */
  if (!Array.isArray(roundsR) || !Array.isArray(picksR) ||
      !Array.isArray(eligibleR) || !Array.isArray(partsR)) {
    out.errors.push('carry-forward: could not read rounds, picks, players or participants — nothing written');
    return out;
  }
  if (!eligibleR.length) {
    out.errors.push('carry-forward: fantasy_players returned no rows — nothing written');
    return out;
  }

  const order = new Map();
  roundsR.forEach((r, i) => order.set(r.id, i));
  const here = order.get(roundId);
  if (here === undefined) {
    out.errors.push('carry-forward: round ' + roundId + ' not found');
    return out;
  }

  /* Picks per participant, newest first, this round excluded. */
  const mine = new Map();
  const hasHere = new Set();
  picksR.forEach(p => {
    if (!p || !p.participant_id) return;
    if (p.round_id === roundId) { hasHere.add(p.participant_id); return; }
    const at = order.get(p.round_id);
    if (at === undefined || at > here) return;   // unknown or later round
    if (!mine.has(p.participant_id)) mine.set(p.participant_id, []);
    mine.get(p.participant_id).push({ ...p, _at: at });
  });
  mine.forEach(list => list.sort((a, b) => b._at - a._at));

  for (const part of partsR) {
    const pid = part && part.id;
    if (!pid || hasHere.has(pid)) continue;

    const prior = mine.get(pid) || [];
    if (!prior.length) { out.never_played++; continue; }

    if (carryDormancy(prior) >= FANTASY_CARRY_LIMIT) { out.dormant++; continue; }

    const built = buildCarriedPick(prior[0], eligibleR);
    if (!built) { out.skipped++; continue; }

    /* chip is left out entirely — see the note at the top. */
    const res = await fetch(`${SB}/rest/v1/fantasy_picks`, {
      method: 'POST',
      headers: { ...JH, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        participant_id:  pid,
        round_id:        roundId,
        player_ids:      built.player_ids,
        captain_id:      built.captain_id,
        vice_captain_id: built.vice_captain_id,
        auto_carried:    true,
      }),
    }).catch(e => ({ ok: false, text: async () => String(e && e.message || e) }));

    if (res && res.ok) {
      out.carried++;
    } else {
      /* Whatever Postgres said, keep it. A missing auto_carried column
         (19-auto-carry.sql not run) looks exactly like a constraint
         failure from here, and the message is the difference. */
      const txt = res && res.text ? await res.text().catch(() => '') : '';
      out.errors.push('carry-forward ' + pid + ': ' + txt);
    }
  }

  return out;
}

/* ══════════════════════════════════════════════════════
   PLAYER WARNINGS — helpers
   A disciplinary document the player signs through a link. The token in
   that link stands in for a login, so everything about it is deliberate:
   192 bits of randomness, one document, one signature, never twice.
══════════════════════════════════════════════════════ */
const W_LEVELS = ['informal', 'first', 'final', 'suspension', 'hearing'];

function wToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* sha256Hex is defined just below; the document's fingerprint uses it. */
const wHash = (text) => sha256Hex(String(text || ''));

function wNextRef(year, lastRef) {
  let n = 0;
  if (lastRef) {
    /* The year has to match before the count carries on. Reading the number
       off a reference from a different year would start 2027 at 0043. */
    const m = String(lastRef).match(/^TCC-W-(\d{4})-(\d+)$/);
    if (m && Number(m[1]) === Number(year)) n = parseInt(m[2], 10) || 0;
  }
  return 'TCC-W-' + year + '-' + String(n + 1).padStart(4, '0');
}

/* What the person opening the link may see. Not the whole row: the reason a
   warning was withdrawn, and the address a signature came from, are the
   club's business and nobody else's. */
function wPublic(row) {
  if (!row) return null;
  return {
    ref: row.ref, level: row.level, status: row.status,
    player_name: row.player_name, player_team: row.player_team,
    is_minor: row.is_minor, guardian_name: row.guardian_name,
    incident_on: row.incident_on, incident_place: row.incident_place,
    issued_by: row.issued_by, issued_role: row.issued_role, issued_on: row.issued_on,
    official_signature: row.official_signature,
    doc_text: row.doc_text, doc_hash: row.doc_hash,
    appeal_days: row.appeal_days, record_months: row.record_months,
    official_signature_type: row.official_signature_type,
    official_signature_data: row.official_signature_data,
    player_signature: row.player_signature, player_signed_at: row.player_signed_at,
    player_signature_type: row.player_signature_type,
    player_signature_data: row.player_signature_data,
    player_response: row.player_response,
    guardian_signature: row.guardian_signature, guardian_signed_at: row.guardian_signed_at,
    guardian_signature_type: row.guardian_signature_type,
    guardian_signature_data: row.guardian_signature_data
  };
}

/* A drawn signature arrives as a string and is nothing until it has been
   checked. PNG only — an SVG data URL can carry script — and bounded, or
   one signature fills a row. The page checks too, so the person is told
   straight away; this checks because the page cannot be trusted. */
const W_SIG_MAX = 160000;   // ~120 KB of PNG
function wValidSigData(v) {
  if (typeof v !== 'string' || !v) return false;
  if (v.length > W_SIG_MAX) return false;
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v);
}

/* One signature, whichever way it was given. Returns the columns to store,
   or an error. The name is required either way: a drawn mark identifies
   nobody on its own, and a register of squiggles is not a register. */
function wSignatureFields(name, who, p, prefix) {
  const typed = String(p[prefix + '_signature'] || '').trim();
  const drawn = p[prefix + '_signature_data'];
  const wants = String(p[prefix + '_signature_type'] || (drawn ? 'drawn' : 'typed'));

  if (wants === 'drawn') {
    if (!wValidSigData(drawn)) {
      return { error: 'That drawn signature did not come through. Please sign again.' };
    }
    /* Nothing was drawn: a blank pad still produces a tiny valid PNG. */
    if (drawn.length < 200) {
      return { error: who + ', please draw your signature in the box.' };
    }
    const out = {};
    out[prefix + '_signature'] = typed || name;
    out[prefix + '_signature_type'] = 'drawn';
    out[prefix + '_signature_data'] = drawn;
    return out;
  }
  if (typed.length < 3) {
    return { error: who + ', please type your full name as your signature.' };
  }
  const out = {};
  out[prefix + '_signature'] = typed;
  out[prefix + '_signature_type'] = 'typed';
  out[prefix + '_signature_data'] = null;
  return out;
}

function wValidateSign(row, p) {
  if (!row) return { error: 'This link is not valid.' };
  if (row.status === 'void') return { error: 'This document has been withdrawn by the club.' };
  if (row.status === 'signed' || row.player_signed_at) {
    return { error: 'This document has already been signed.' };
  }
  if (!p.confirm) return { error: 'Please tick the box to confirm you have read the document.' };

  const ps = wSignatureFields(row.player_name, 'Please', p, 'player');
  if (ps.error) return { error: ps.error };

  let gs = null;
  if (row.is_minor) {
    const drawnG = p.guardian_signature_type === 'drawn';
    const typedG = String(p.guardian_signature || '').trim();
    if (!drawnG && typedG.length < 3) {
      return { error: 'A parent or guardian must also sign, because the player is under 18.' };
    }
    gs = wSignatureFields(row.guardian_name || '', 'Parent or guardian', p, 'guardian');
    if (gs.error) return { error: gs.error };
    /* A typed name that simply repeats the player's is the child signing as
       their own parent. Two drawn marks are left alone — telling two
       squiggles apart is not something a server should pretend to do. */
    if (ps.player_signature_type === 'typed' && gs.guardian_signature_type === 'typed' &&
        gs.guardian_signature.toLowerCase() === ps.player_signature.toLowerCase()) {
      return { error: 'The parent or guardian signature cannot be the same name as the player.' };
    }
  }
  if (String(p.player_response || '').length > 4000) {
    return { error: 'Your reply is too long — please keep it under 4000 characters.' };
  }
  return { ok: true, player: ps, guardian: gs };
}

/* ══════════════════════════════════════════════════════
   AGREEMENTS — helpers
   A document the club sends out for signature. Its own table and its own
   actions: an agreement carries payment terms and is read by a narrower
   group than a disciplinary warning, and the two have no business in one
   register. The signature plumbing is shared because a signature is a
   signature; nothing else is.
══════════════════════════════════════════════════════ */
function agNextRef(year, lastRef) {
  let n = 0;
  if (lastRef) {
    const m = String(lastRef).match(/^TCC-A-(\d{4})-(\d+)$/);
    if (m && Number(m[1]) === Number(year)) n = parseInt(m[2], 10) || 0;
  }
  return 'TCC-A-' + year + '-' + String(n + 1).padStart(4, '0');
}

/* What the person opening the link may see. Not the storage path, not the
   address a signature came from, not why the club withdrew something. */
function agPublic(row) {
  if (!row) return null;
  return {
    ref: row.ref, title: row.title, status: row.status, confidential: row.confidential,
    party_name: row.party_name, party_role: row.party_role,
    doc_text: row.doc_text, doc_hash: row.doc_hash,
    file_name: row.file_name, has_file: !!row.file_path, file_hash: row.file_hash,
    place: row.place,
    issued_by: row.issued_by, issued_role: row.issued_role, issued_on: row.issued_on,
    club_signature: row.club_signature,
    club_signature_type: row.club_signature_type,
    club_signature_data: row.club_signature_data,
    club_signed_at: row.club_signed_at,
    party_signature: row.party_signature,
    party_signature_type: row.party_signature_type,
    party_signature_data: row.party_signature_data,
    party_signed_at: row.party_signed_at,
    party_note: row.party_note,
    link_expires_on: row.link_expires_on
  };
}

/* Why a link will not open, in a sentence a person can act on. */
function agLinkProblem(row) {
  if (!row) return { error: 'This link is not valid.', status: 404 };
  if (row.status === 'void') {
    return { error: 'This agreement has been withdrawn by the club.', status: 410 };
  }
  if (row.status !== 'signed' && row.link_expires_on &&
      String(row.link_expires_on) < new Date().toISOString().slice(0, 10)) {
    return { error: 'This link has expired. Ask the club to send a new one.', status: 410 };
  }
  return null;
}

/* A URL to a private object that stops working in five minutes. There is
   no standing link to an agreement PDF anywhere. */
async function agSignedUrl(SB, KEY, path) {
  const r = await fetch(`${SB}/storage/v1/object/sign/agreements/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 300 })
  });
  if (!r.ok) {
    return new Response(JSON.stringify({ error: 'That file could not be fetched.' }), { status: 500 });
  }
  const d = await r.json().catch(() => ({}));
  const signed = d.signedURL || d.signedUrl || '';
  const url = signed.indexOf('http') === 0 ? signed : `${SB}/storage/v1${signed}`;
  return new Response(JSON.stringify({ ok: true, url, expires_in: 300 }),
    { headers: { 'Content-Type': 'application/json' } });
}

function agValidateCreate(p) {
  if (!String(p.title || '').trim()) return { error: 'Give the agreement a title.' };
  if (!String(p.party_name || '').trim()) return { error: 'Name the person it is with.' };
  if (!String(p.doc_text || '').trim()) return { error: 'The agreement has no text in it.' };
  if (!String(p.issued_by || '').trim()) return { error: 'Say who is issuing it.' };
  const cs = wSignatureFields(String(p.issued_by || '').trim(), 'Please', p, 'club');
  if (cs.error) {
    return { error: 'The club has to sign it before it goes out.' };
  }
  return { ok: true, club: cs };
}

function agValidateSign(row, p) {
  const bad = agLinkProblem(row);
  if (bad) return { error: bad.error };
  if (row.status === 'signed' || row.party_signed_at) {
    return { error: 'This agreement has already been signed.' };
  }
  if (!p.confirm) {
    return { error: 'Please tick the box to confirm you agree to the terms.' };
  }
  const ps = wSignatureFields(row.party_name, 'Please', p, 'party');
  if (ps.error) return { error: ps.error };
  if (String(p.party_note || '').length > 2000) {
    return { error: 'That note is too long — please keep it under 2000 characters.' };
  }
  return { ok: true, party: ps };
}

function wValidateCreate(p) {
  if (W_LEVELS.indexOf(p.level) === -1) return { error: 'Unknown warning level.' };
  if (!String(p.player_name || '').trim()) return { error: 'The player has to be named.' };
  if (!String(p.incident_text || '').trim()) return { error: 'Say what happened.' };
  if (!String(p.doc_text || '').trim()) return { error: 'The document is empty.' };
  if (!String(p.issued_by || '').trim()) return { error: 'Say who is issuing it.' };
  const os = wSignatureFields(String(p.issued_by || '').trim(), 'Please', p, 'official');
  if (os.error) {
    return { error: 'The person issuing it has to sign it before it goes to the player.' };
  }
  if (p.is_minor && !String(p.guardian_name || '').trim()) {
    return { error: 'Name the parent or guardian who will countersign.' };
  }
  return { ok: true, official: os };
}

function isAllowed(role, action) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(action);
}


    const url = new URL(request.url);

    // ── CORS preflight
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    // ── Tournament draw (phone-remote rooms) — /api/draw/*
    //    Returns a Response if the path is a draw route, otherwise null so
    //    the request falls through to the routes below untouched.
    const drawRes = await handleDraw(request, env, url);
    if (drawRes) return drawRes;

    // ── Confidentiality undertaking (exec & captains) — /api/agreement/*
    //    Same pattern as the draw block: returns a Response for its own
    //    routes, otherwise null so the request falls through untouched.
    const agreementRes = await handleAgreement(request, env, url, jwtVerify);
    if (agreementRes) return agreementRes;

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

    // ── PayFast ITN (Instant Transaction Notification) — posted form-encoded,
    //    so it must be handled BEFORE the JSON body parse below.
    if (request.method === 'POST' && url.searchParams.get('pf_itn') === '1') {
      const SB  = env.SUPABASE_URL;
      const KEY = env.SUPABASE_SERVICE_KEY;
      const H   = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
      return handlePayfastITN(request, env, SB, KEY, H, settlePaidOrder);
    }

    // ── PayFast signature DEBUG (GET /?pf_debug=1) — TEMPORARY.
    //    Shows the exact string we sign + the hash, so you can paste it into
    //    PayFast's signature tool and see where they differ. DELETE after use.
    if (request.method === 'GET' && url.searchParams.get('pf_debug') === '1') {
      const cfg = pfConfig(env);
      // Optional: pass ?pass=THEPASSPHRASE to test WITH a passphrase without
      // committing it as a secret. Sandbox only — safe for test creds.
      const testPass = url.searchParams.get('pass') || cfg.passphrase || '';
      const fields = {
        merchant_id: cfg.merchantId,
        merchant_key: cfg.merchantKey,
        return_url: cfg.siteUrl + '/store-return.html?payment=test',
        cancel_url: cfg.siteUrl + '/store-return.html?cancelled=1&payment=test',
        notify_url: 'https://tcc-admin.bydaries.workers.dev/?pf_itn=1',
        name_first: 'Test',
        email_address: 'test@example.com',
        m_payment_id: 'test',
        amount: '100.00',
        item_name: 'TCC Order 999'
      };

      const encV = (v, o) => {
        v = String(v).trim();
        let e = encodeURIComponent(v);
        if (o.phpExtra) e = e.replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
        if (o.space === 'plus') e = e.replace(/%20/g, '+');
        if (o.lower) e = e.replace(/%[0-9A-F]{2}/g, m => m.toLowerCase());
        return e;
      };
      const buildStr = (o) => {
        let pairs = Object.entries(fields).filter(([k, v]) => v !== '');
        if (o.sort) pairs = pairs.slice().sort((a, b) => a[0] < b[0] ? -1 : 1);
        return pairs.map(([k, v]) => k + '=' + encV(v, o)).join('&');
      };

      const variants = [
        ['A submission uppercase +space', { space: 'plus', phpExtra: true }],
        ['C submission uppercase %20',    {}],
        ['D submission lowercase +space', { space: 'plus', lower: true }],
        ['F alphabetical uppercase +space', { space: 'plus', phpExtra: true, sort: true }],
        ['G alphabetical uppercase %20',  { sort: true }],
        ['H alphabetical lowercase +space', { space: 'plus', lower: true, sort: true }]
      ];

      const results = [];
      for (const [name, o] of variants) {
        const s = buildStr(o);
        const sig = md5(testPass ? s + '&passphrase=' + encV(testPass, o) : s);
        let pairs = Object.entries(fields).filter(([k, v]) => v !== '');
        if (o.sort) pairs = pairs.slice().sort((a, b) => a[0] < b[0] ? -1 : 1);
        const body = pairs.map(([k, v]) => k + '=' + encV(v, o)).join('&') + '&signature=' + sig;
        let verdict;
        try {
          const r = await fetch(cfg.processUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body, redirect: 'manual'
          });
          const t = await r.text();
          const mismatch = /signature does not match/i.test(t);
          verdict = { status: r.status, accepted: !mismatch, mismatch };
        } catch (e) { verdict = { error: e.message }; }
        results.push({ variant: name, sig, ...verdict });
      }

      return cors(new Response(JSON.stringify({
        note: 'Whichever variant has accepted:true is the correct combo. If a ?pass= was supplied and now one passes, the passphrase was the missing piece.',
        passphraseUsed: testPass ? ('yes (len ' + testPass.length + ')') : 'no',
        results
      }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } }));
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
      'events.publicList',
      'admin.login',
      'contact.send','fantasy.sendOTP','fantasy.verifyOTP',
      'fantasy.register','bio.submit','registration.submit','store.catalogue','store.checkout','store.mockConfirm','store.trackOrder','push.subscribe','push.unsubscribe',
      'push.dispatch','fantasy.subscribePush','scoring.auth',
      /* The player signing has no account. The token in the link is what
         stands in for one: it names one document and nothing else. */
      'warning.get','warning.sign',
      'agreement.get','agreement.sign','agreement.fileUrl',
      /* A game on the website has no login and never will. See the
         case itself for what stands in for one. */
      'game.submitScore'
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

    // ── STORE: shared settlement (mark paid, decrement stock; idempotent) ──
    //    Called by store.mockConfirm now, and by the real payment webhook later.
    //    Lives here (inside the fetch handler) alongside the H2H email helpers
    //    so SB/KEY/H are available; also accepts them as args for clarity.
    async function settlePaidOrder(paymentId, gateway, gatewayRef, rawEvt, SB, KEY, H, env) {
      const pr = await fetch(`${SB}/rest/v1/payments?id=eq.${paymentId}&select=*`,
        { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
      const [pay] = await pr.json();
      if (!pay || pay.status === 'paid') return; // idempotent — webhooks can fire twice

      await fetch(`${SB}/rest/v1/payments?id=eq.${paymentId}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ status: 'paid', gateway, gateway_ref: gatewayRef,
          paid_at: new Date().toISOString(), meta: rawEvt })
      });

      if (pay.purpose === 'shop_order' && pay.reference_id) {
        await fetch(`${SB}/rest/v1/orders?id=eq.${pay.reference_id}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ payment_status: 'paid', fulfilment: 'awaiting_preparation' })
        });
        // full order + items for stock decrement AND the invoice email
        const oiRes = await fetch(`${SB}/rest/v1/orders?id=eq.${pay.reference_id}&select=*,order_items(*)`,
          { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
        const [order] = await oiRes.json();
        const items = (order && order.order_items) || [];

        for (const it of items) {
          if (!it.variant_id) continue;
          const vr = await fetch(`${SB}/rest/v1/product_variants?id=eq.${it.variant_id}&select=stock`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          const [v] = await vr.json();
          if (v) await fetch(`${SB}/rest/v1/product_variants?id=eq.${it.variant_id}`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({ stock: Math.max(0, v.stock - it.qty) })
          });
        }

        // send the invoice / paid confirmation (non-fatal — never block settlement)
        let invoiceEmailResult = 'not_attempted';
        if (env && order && order.buyer_email) {
          try {
            await sendOrderInvoiceEmail(order, gateway, gatewayRef, env);
            invoiceEmailResult = 'sent_to:' + order.buyer_email;
          } catch (e) {
            invoiceEmailResult = 'error:' + e.message;
            console.error('invoice email failed', e);
          }
        } else {
          invoiceEmailResult = 'skipped:no_email(' + (order ? order.buyer_email : 'no_order') + ')';
        }
        // record on the payment meta so we can see if/why the invoice email ran
        try {
          await fetch(`${SB}/rest/v1/payments?id=eq.${paymentId}`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({ meta: { ...(pay.meta || {}), invoice_email: invoiceEmailResult, invoice_email_at: new Date().toISOString() } })
          });
        } catch (e) {}
      }
    }

    // ── Shop invoice email — full HTML built here (same passthrough pattern
    //    as the H2H emails: template_iifjomq just renders {{message}}). ──
    // Club crest for emails. Uses a hosted PNG (renders everywhere incl. Outlook).
    // ▶ REPLACE this URL with the real crest PNG (e.g. Supabase 'store' bucket).
    //   Falls back to a dark gold-ringed circle behind it if the image fails.
    const TCC_CREST_URL = 'https://tygerbergcc.co.za/img/crest.png';

    async function sendOrderInvoiceEmail(order, gateway, gatewayRef, env) {
      const rand = c => 'R' + (Number(c || 0) / 100).toFixed(2);
      const invNo = 'TCC-' + String(order.order_no || 0).padStart(6, '0');
      const paidDate = new Date().toLocaleDateString('en-ZA',
        { day: 'numeric', month: 'long', year: 'numeric' });
      const esc = s => String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      const rows = (order.order_items || []).map(it => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #eeebe4;font-size:13px;color:#1a1a1a;">${esc(it.name_snapshot)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eeebe4;font-size:13px;color:#555;text-align:center;">${it.qty}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eeebe4;font-size:13px;color:#555;text-align:right;">${rand(it.unit_cents)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eeebe4;font-size:13px;color:#1a1a1a;text-align:right;font-weight:600;">${rand(it.line_cents)}</td>
        </tr>`).join('');

      const crestCell = `<!--[if !mso]><!--><img src="${TCC_CREST_URL}" width="64" height="64" alt="TCC" style="display:block;margin:0 auto 16px;border:0;border-radius:50%;background:#0A0A0B;"><!--<![endif]-->`;
      const html = `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#ffffff;">
  <tr><td style="background:#0A0A0B;padding:0;border-radius:8px 8px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:6px;background:#C9A227;font-size:0;line-height:0;border-radius:8px 8px 0 0;">&nbsp;</td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:34px 32px 30px;text-align:center;">
      ${crestCell}
      <div style="font-size:11px;color:#C9A227;letter-spacing:0.24em;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Tygerberg Cricket Club</div>
      <div style="font-size:34px;font-weight:700;color:#F2F0EA;text-transform:uppercase;letter-spacing:0.03em;line-height:0.95;">Order<br>Confirmed</div>
      <div style="font-size:13px;color:#9B978B;margin-top:14px;">Thanks ${esc(order.buyer_name)} — payment received.</div>
    </td></tr></table>
  </td></tr>

  <tr><td style="padding:0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" style="background:#1a1a1a;padding:16px 24px;text-align:center;border-right:1px solid #333;">
        <div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.14em;">Invoice</div>
        <div style="font-size:17px;color:#C9A227;font-weight:700;margin-top:3px;">${invNo}</div>
      </td>
      <td width="50%" style="background:#1a1a1a;padding:16px 24px;text-align:center;">
        <div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.14em;">Date paid</div>
        <div style="font-size:17px;color:#F2F0EA;font-weight:600;margin-top:3px;">${paidDate}</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:26px 32px 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:10px;color:#C9A227;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;padding-bottom:10px;border-bottom:2px solid #C9A227;">Item</td>
        <td style="font-size:10px;color:#C9A227;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;padding-bottom:10px;border-bottom:2px solid #C9A227;text-align:center;">Qty</td>
        <td style="font-size:10px;color:#C9A227;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;padding-bottom:10px;border-bottom:2px solid #C9A227;text-align:right;">Unit</td>
        <td style="font-size:10px;color:#C9A227;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;padding-bottom:10px;border-bottom:2px solid #C9A227;text-align:right;">Total</td>
      </tr>${rows}
    </table>
  </td></tr>

  <tr><td style="padding:22px 32px 26px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#C9A227;border-radius:8px;"><tr>
      <td style="padding:20px 24px;font-size:14px;color:#0A0A0B;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Total paid</td>
      <td style="padding:20px 24px;font-size:26px;color:#0A0A0B;font-weight:700;text-align:right;">${rand(order.total_cents)}</td>
    </tr></table>
    <div style="font-size:10px;color:#bbb;margin-top:8px;text-align:right;">Paid via ${esc(gateway || 'online')}${gatewayRef ? ' &middot; ref ' + esc(gatewayRef) : ''}</div>
  </td></tr>

  <tr><td style="padding:0 32px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F0E6;border-radius:8px;"><tr><td style="padding:20px 24px;">
      <div style="font-size:11px;color:#8a7a35;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;margin-bottom:6px;">■ What happens next</div>
      <div style="font-size:13px;color:#5d5749;line-height:1.65;">We're getting your order ready. You'll get a second email the moment it's ready to collect at the clubhouse — <strong>Florida Park, Ravensmead</strong>. Quote <strong>${invNo}</strong> when you fetch it.</div>
    </td></tr></table>
  </td></tr>

  <tr><td style="background:#0A0A0B;padding:24px 32px;border-radius:0 0 8px 8px;text-align:center;">
    <div style="font-size:13px;color:#C9A227;font-style:italic;letter-spacing:0.08em;font-weight:600;">Facta Non Verba</div>
    <div style="font-size:10px;color:#666;margin-top:6px;letter-spacing:0.04em;">Tygerberg Cricket Club &middot; Est. 1957 &middot; info@tygerbergcc.co.za</div>
  </td></tr>
</table>`;

      const ejRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: env.EMAILJS_SERVICE_ID, template_id: 'template_iifjomq',
          user_id: env.EMAILJS_PUBLIC_KEY, accessToken: env.EMAILJS_PRIVATE_KEY,
          template_params: {
            to_email: order.buyer_email, email: order.buyer_email,
            subject: 'Your TCC order ' + invNo + ' — confirmed',
            name: order.buyer_name, message: html
          }
        })
      });
      if (!ejRes.ok) {
        const t = await ejRes.text().catch(() => '');
        throw new Error('emailjs ' + ejRes.status + ': ' + t.slice(0, 120));
      }
    }

    // ── Collection-ready email — sent when the club confirms the order is
    //    prepared and can be collected. Second email in the flow. ──
    async function sendOrderReadyEmail(order, env) {
      const rand = c => 'R' + (Number(c || 0) / 100).toFixed(2);
      const invNo = 'TCC-' + String(order.order_no || 0).padStart(6, '0');
      const esc = s => String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const itemLines = (order.order_items || [])
        .map(it => esc(it.qty + '× ' + it.name_snapshot)).join('<br>');

      const crestCell = `<!--[if !mso]><!--><img src="${TCC_CREST_URL}" width="64" height="64" alt="TCC" style="display:block;margin:0 auto 16px;border:0;border-radius:50%;background:#0A0A0B;"><!--<![endif]-->`;
      const html = `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#ffffff;">
  <tr><td style="background:#0A0A0B;padding:0;border-radius:8px 8px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:6px;background:#C9A227;font-size:0;line-height:0;border-radius:8px 8px 0 0;">&nbsp;</td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:34px 32px 30px;text-align:center;">
      ${crestCell}
      <div style="font-size:11px;color:#C9A227;letter-spacing:0.24em;text-transform:uppercase;font-weight:700;margin-bottom:10px;">Tygerberg Cricket Club &middot; ${invNo}</div>
      <div style="font-size:34px;font-weight:700;color:#F2F0EA;text-transform:uppercase;letter-spacing:0.03em;line-height:0.95;">Ready to<br>Collect</div>
      <div style="font-size:13px;color:#9B978B;margin-top:14px;">Good news ${esc(order.buyer_name)} — your order's packed and waiting.</div>
    </td></tr></table>
  </td></tr>

  <tr><td style="padding:26px 32px 0;">
    <div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;padding-bottom:10px;border-bottom:2px solid #C9A227;">Your order</div>
    <div style="font-size:14px;color:#1a1a1a;line-height:1.8;padding-top:12px;">${itemLines}</div>
  </td></tr>

  <tr><td style="padding:22px 32px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F0E6;border-radius:8px;"><tr><td style="padding:20px 24px;">
      <div style="font-size:11px;color:#8a7a35;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;margin-bottom:6px;">■ Where &amp; when</div>
      <div style="font-size:13px;color:#5d5749;line-height:1.65;">Collect at the clubhouse — <strong>Florida Park, Ravensmead</strong> — at training or on a match day. Just quote <strong>${invNo}</strong> when you arrive. Already paid in full, so nothing further to settle.</div>
    </td></tr></table>
  </td></tr>

  <tr><td style="background:#0A0A0B;padding:24px 32px;border-radius:0 0 8px 8px;text-align:center;">
    <div style="font-size:13px;color:#C9A227;font-style:italic;letter-spacing:0.08em;font-weight:600;">Facta Non Verba</div>
    <div style="font-size:10px;color:#666;margin-top:6px;letter-spacing:0.04em;">Tygerberg Cricket Club &middot; Est. 1957 &middot; info@tygerbergcc.co.za</div>
  </td></tr>
</table>`;

      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: env.EMAILJS_SERVICE_ID, template_id: 'template_iifjomq',
          user_id: env.EMAILJS_PUBLIC_KEY, accessToken: env.EMAILJS_PRIVATE_KEY,
          template_params: {
            to_email: order.buyer_email, email: order.buyer_email,
            subject: 'Your TCC order ' + invNo + ' is ready to collect',
            name: order.buyer_name, message: html
          }
        })
      }).catch(() => {});
    }


    try {
      switch (action) {

        /* ══════════════════════════════════════════════════════
           ARCADE — a shared leaderboard for the club games

           This is the Worker's first unauthenticated WRITE. Everything
           else public here either reads (store.catalogue), or is gated
           by a token that stands in for a login (warning.sign). A game
           on the club website has no login and never will, so anyone
           who can reach the site can post a score.

           Three things keep that honest, and none of them is clever:

             1. A ceiling. 39 runs is the best possible single ball
                against the real scoring code — a golden ball at a x3
                streak multiplier plus the Fire Mode bonus — so a score
                above balls x 39 did not happen. The same rule is a
                CHECK constraint in 1-game-scores.sql, because a rule
                that lives only here is one deploy from not existing.
             2. A rate limit, per browser, per minute.
             3. Nothing to gain. It is a club arcade board, not a
                payout.

           A determined person with the dev tools open can still post a
           plausible score. That is true of every client-side game ever
           written, and the honest response is to bound the damage
           rather than pretend otherwise.
        ══════════════════════════════════════════════════════ */
        case 'game.submitScore': {
          const gp = payload || {};

          /* Names are typed by whoever is holding the phone, shown on a
             public board, and nothing else. No contact details are
             accepted here even if sent — see 1-game-scores.sql. */
          const gName = String(gp.name == null ? '' : gp.name)
            .replace(/[\u0000-\u001f\u007f]/g, '')   // control chars, incl. newlines
            .trim()
            .slice(0, 14);

          const gScore  = Math.trunc(Number(gp.score));
          const gBalls  = Math.trunc(Number(gp.balls));
          const gBest   = Math.trunc(Number(gp.best_shot || 0));
          const gClient = String(gp.client_id || '');
          const gGame   = GAME_IDS.includes(gp.game) ? gp.game : 'six_and_out';

          if (!gName) {
            return cors(new Response(JSON.stringify({ error: 'A name is needed to sign the board.' }), { status: 400 }));
          }
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gClient)) {
            return cors(new Response(JSON.stringify({ error: 'Bad client id' }), { status: 400 }));
          }
          if (!Number.isFinite(gScore) || !Number.isFinite(gBalls) ||
              gScore < 0 || gBalls < 1 || gBalls > 1000) {
            return cors(new Response(JSON.stringify({ error: 'Bad score' }), { status: 400 }));
          }

          /* The chase fields. Only Last Over Hero sends them, and the
             row written below carries them only for that game — a
             stray difficulty on a Six & Out row is refused by the
             CHECK constraint, so it must not be sent at all. */
          const gChase = gGame === 'last_over_hero';
          const gRow = {
            game: gGame, name: gName, score: gScore,
            balls: gBalls, best_shot: gBest, client_id: gClient,
          };
          if (gChase) {
            gRow.target     = Math.trunc(Number(gp.target));
            gRow.balls_left = Math.trunc(Number(gp.balls_left));
            gRow.difficulty = String(gp.difficulty || '');
            gRow.won        = gp.won === true;
            if (!Number.isFinite(gRow.target) || !Number.isFinite(gRow.balls_left)) {
              return cors(new Response(JSON.stringify({ error: 'Bad chase' }), { status: 400 }));
            }
          }

          const gBad = gameScoreProblem(gRow);
          if (gBad) {
            /* Said plainly in the log rather than the response: whoever
               is trying this does not need our help refining it. */
            console.warn('Implausible score refused (' + gBad + '):', JSON.stringify(gRow));
            return cors(new Response(JSON.stringify({ error: 'That score could not have happened.' }), { status: 422 }));
          }

          /* Rate limit, per browser. Counting rows beats any in-memory
             tally: Workers are many short-lived isolates and a counter
             in one of them is not a limit. */
          try {
            const gSince = new Date(Date.now() - GAME_RATE_WINDOW_MS).toISOString();
            const gRecentR = await fetch(
              `${SB}/rest/v1/game_scores?client_id=eq.${encodeURIComponent(gClient)}` +
              `&created_at=gte.${encodeURIComponent(gSince)}&select=id`,
              { headers: { ...H, 'Prefer': 'count=exact' } });
            const gRecent = await gRecentR.json().catch(() => null);
            if (Array.isArray(gRecent) && gRecent.length >= GAME_RATE_MAX) {
              return cors(new Response(JSON.stringify({
                error: 'That is a lot of cricket in one minute. Try again shortly.',
              }), { status: 429 }));
            }
          } catch (e) {
            /* A failed rate-limit check must not refuse an honest
               innings. The ceiling above and the CHECK constraint are
               what actually protect the board. */
            console.warn('game rate-limit check failed:', e && e.message);
          }

          const gIns = await fetch(`${SB}/rest/v1/game_scores`, {
            method: 'POST',
            headers: { ...H, 'Prefer': 'return=minimal' },
            body: JSON.stringify(gRow),
          });
          if (!gIns.ok) {
            const gTxt = await gIns.text().catch(() => '');
            console.error('game score insert failed:', gIns.status, gTxt);

            /* WHY it failed decides two things: what the player is
               told, and whether the game keeps the score to retry.

               The first version of this answered 502 to everything,
               so a missing table — the commonest failure by a mile,
               because the SQL had not been run yet — reached the
               player as "the board is offline" while they were
               plainly online, and was queued to be retried for ever
               against a table that does not exist.

               `retry` says so explicitly rather than leaving the
               client to infer it from the status code, because no
               status code carries this distinction properly: "the
               board is not set up" is a server fault that retrying
               will never fix. */
            const gMissing = gIns.status === 404 ||
              /does not exist|schema cache|PGRST205|42P01/i.test(gTxt);
            if (gMissing) {
              return cors(new Response(JSON.stringify({
                error: 'The clubhouse board is not set up yet.',
                detail: 'game_scores is missing. Has 1-game-scores.sql been run on this database?',
                retry: false,
              }), { status: 503 }));
            }
            if (gIns.status >= 400 && gIns.status < 500) {
              /* The row itself was refused — a CHECK constraint, most
                 likely. Retrying the same row cannot help. */
              return cors(new Response(JSON.stringify({
                error: 'The board would not accept that score.',
                detail: gTxt.slice(0, 300),
                retry: false,
              }), { status: 422 }));
            }
            /* Supabase really was unreachable. Worth keeping. */
            return cors(new Response(JSON.stringify({
              error: 'The board could not be reached just now. Your score is kept on this device.',
              retry: true,
            }), { status: 502 }));
          }

          /* Hand the board back with the result. The page has just
             changed it, so it would ask for it immediately anyway, and
             on clubhouse wifi that is one round trip worth saving. */
          let gBoard = [];
          try {
            /* Each game ranks on its own terms: Six & Out on runs,
               Last Over Hero on how hard a chase was pulled off. */
            const gUrl = gChase
              ? `${SB}/rest/v1/loh_leaderboard?select=name,difficulty,target,balls_left` +
                `&order=tier.desc,target.desc,balls_left.desc&limit=10`
              : `${SB}/rest/v1/game_leaderboard?game=eq.${encodeURIComponent(gGame)}` +
                `&select=name,score,balls&order=score.desc&limit=10`;
            const gBoardR = await fetch(gUrl, { headers: H });
            const gRows = await gBoardR.json().catch(() => null);
            if (Array.isArray(gRows)) gBoard = gRows;
          } catch (e) { /* the score is saved; the board can be fetched again */ }

          /* Where they came on the board, or null if this innings did
             not beat their own best. Either way the innings is stored —
             nobody is dropped for being below a cut-off, which is what
             the old localStorage board did. */
          let gRank = null;
          for (let i = 0; i < gBoard.length; i++) {
            if (String(gBoard[i].name).toLowerCase() === gName.toLowerCase()) { gRank = i; break; }
          }

          return cors(new Response(JSON.stringify({
            ok: true, rank: gRank, board: gBoard,
          }), { status: 200 }));
        }

        // ══════════════════════════════════════════════════════
        // ADMIN AUTH + USER MANAGEMENT
        // ══════════════════════════════════════════════════════

        // Login — validates username/password, returns signed JWT + role
        case 'admin.login': {
          // `password` = plaintext over TLS (preferred). `password_hash` is a
          // legacy fallback so stale cached clients still work during rollout;
          // it can only match old SHA-256 rows, never upgraded pbkdf2 ones.
          const { username, password, password_hash } = payload || {};
          if (!username || (!password && !password_hash)) {
            return cors(new Response(JSON.stringify({ error: 'Missing credentials' }), { status: 400 }));
          }
          const r = await fetch(
            `${SB}/rest/v1/admin_users?username=eq.${encodeURIComponent(username)}&active=eq.true&select=id,name,username,role,password_hash`,
            { headers: H }
          );
          const rows = await r.json();
          const user = Array.isArray(rows) ? rows[0] : null;

          let ok = false, upgrade = null;
          if (user) {
            if (password) {
              const v = await verifyPassword(password, user.password_hash);
              ok = v.ok; upgrade = v.upgrade;
            } else if (password_hash && !String(user.password_hash || '').startsWith('pbkdf2$')) {
              ok = timingSafeEqual(password_hash, user.password_hash || '');
            }
          }
          if (!ok) {
            return cors(new Response(JSON.stringify({ error: 'Invalid username or password' }), { status: 401 }));
          }

          // Lazy-migrate a legacy SHA-256 row to pbkdf2 (non-fatal)
          if (upgrade) {
            fetch(`${SB}/rest/v1/admin_users?id=eq.${user.id}`, {
              method: 'PATCH',
              headers: { ...H, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ password_hash: upgrade })
            }).catch(() => {});
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
          const { name, username, password, password_hash, role } = payload || {};
          if (!name || !username || (!password && !password_hash) || !role) {
            return cors(new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 }));
          }
          // Prefer hashing plaintext server-side; fall back to a hash sent by a stale client.
          const stored = password ? await hashPassword(password) : password_hash;
          const r = await fetch(`${SB}/rest/v1/admin_users`, {
            method: 'POST',
            headers: { ...H, 'Prefer': 'return=representation' },
            body: JSON.stringify({ name, username, password_hash: stored, role, active: true })
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // Update an existing admin user (name, role, active — not username)
        case 'admin.updateUser': {
          const { id, name, role, active, password, password_hash } = payload || {};
          if (!id) return cors(new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 }));
          const patch = {};
          if (name     !== undefined) patch.name   = name;
          if (role     !== undefined) patch.role   = role;
          if (active   !== undefined) patch.active = active;
          if (password)               patch.password_hash = await hashPassword(password);
          else if (password_hash)     patch.password_hash = password_hash;
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
        case 'storage.uploadEvent': {
          const evName = String((payload && payload.fileName) || '').replace(/[^a-zA-Z0-9._-]/g, '');
          const evType = String((payload && payload.contentType) || '');
          if (!evName || !/^image\/(png|jpeg|jpg|webp|gif)$/.test(evType)) {
            return cors(new Response(JSON.stringify({ error: 'An image file is required.' }), { status: 400 }));
          }
          const evBin = Uint8Array.from(atob(String((payload && payload.base64) || '')), c => c.charCodeAt(0));
          if (evBin.length > 5 * 1024 * 1024) {
            return cors(new Response(JSON.stringify({ error: 'Image must be under 5MB.' }), { status: 400 }));
          }
          const evSH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': evType, 'x-upsert': 'true' };
          const evUp = await fetch(`${SB}/storage/v1/object/news/event-${evName}`, { method: 'POST', headers: evSH, body: evBin });
          const evUrl = `${SB}/storage/v1/object/public/news/event-${evName}`;
          return cors(new Response(JSON.stringify({ url: evUrl, status: evUp.status }), { status: evUp.ok ? 200 : evUp.status }));
        }

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
          /* H carries Prefer: return=minimal, so a plain insert comes back
             201 with an EMPTY body — and .json() on that throws "Unexpected
             end of JSON input", which is what the admin was being shown. The
             new round's id is needed to link its fixtures, so ask for the
             row back rather than parsing nothing. */
          const insH = Object.assign({}, H, { 'Prefer': 'return=representation' });
          const r = await fetch(`${SB}/rest/v1/fantasy_rounds`, {
            method: 'POST', headers: insH, body: JSON.stringify(roundFields)
          });
          if (!r.ok) return cors(new Response(await r.text(), { status: r.status }));
          const txt = await r.text();
          let created = null;
          try { created = txt ? JSON.parse(txt) : null; } catch (e) { created = null; }
          const roundId = Array.isArray(created) ? (created[0] || {}).id : (created || {}).id;

          /* The round exists by now. If anything below fails, say so rather
             than reporting a save that left the round with no fixtures — a
             round that scores nothing is worse than one that failed loudly. */
          if (!roundId) {
            return cors(new Response(JSON.stringify({
              error: 'The round was created, but its id did not come back, so no fixtures were linked. Open the round and add them.'
            }), { status: 500 }));
          }
          if (Array.isArray(fixture_ids) && fixture_ids.length) {
            const rows = fixture_ids
              .map(fid => ({ round_id: roundId, fixture_id: parseInt(fid, 10) }))
              .filter(x => x.fixture_id);
            const lr = await fetch(`${SB}/rest/v1/fantasy_round_fixtures`, {
              method: 'POST', headers: H, body: JSON.stringify(rows)
            });
            if (!lr.ok) {
              return cors(new Response(JSON.stringify({
                error: 'The round was saved but its fixtures were not linked: ' + (await lr.text())
              }), { status: 500 }));
            }
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
          /* Replace the fixture links. The old links are dropped first, so a
             failure here leaves the round with none — it has to be reported,
             not swallowed. */
          if (Array.isArray(fixture_ids)) {
            const dr = await fetch(`${SB}/rest/v1/fantasy_round_fixtures?round_id=eq.${id}`,
              { method: 'DELETE', headers: H });
            if (!dr.ok) {
              return cors(new Response(JSON.stringify({
                error: 'The round was saved but its old fixtures could not be cleared: ' + (await dr.text())
              }), { status: 500 }));
            }
            if (fixture_ids.length) {
              const rows = fixture_ids
                .map(fid => ({ round_id: id, fixture_id: parseInt(fid, 10) }))
                .filter(x => x.fixture_id);
              const lr = await fetch(`${SB}/rest/v1/fantasy_round_fixtures`, {
                method: 'POST', headers: H, body: JSON.stringify(rows)
              });
              if (!lr.ok) {
                return cors(new Response(JSON.stringify({
                  error: 'The round was saved but its fixtures were not linked: ' + (await lr.text())
                }), { status: 500 }));
              }
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

          /* 4. Carry forward for anyone who never submitted.
                Deliberately after the emails above, so the lock email
                still goes only to managers who picked a team
                themselves. A carried manager is told by the club, not
                by a mail that says "your XI is set" without
                mentioning that we set it. */
          let carry = null;
          try {
            carry = await carryForwardRound(SB, H, lockId);
            if (carry.errors.length) console.error('lockRound carry:', carry.errors.join(' | '));
          } catch (e) {
            console.error('lockRound carry threw:', e && e.message);
          }

          return cors(new Response(JSON.stringify({ ok: true, sent, carry }), { status: 200 }));
        }

        /* ── FANTASY: tell people a round is open ────────────────
           Pressed, never automatic: a round built on Tuesday for Saturday
           should not mail everyone on Tuesday.

           Two audiences, and the second is the point. 'open' goes to every
           approved participant. 'reminder' goes only to those who have not
           picked — which is the inverse of the lock email, the only other
           round message, and the one most likely to get somebody playing. */
        case 'fantasy.notifyRound': {
          const { id: nrId, mode } = payload || {};
          const nrMode = mode === 'reminder' ? 'reminder' : 'open';
          if (!nrId) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));

          const roundRes = await fetch(
            `${SB}/rest/v1/fantasy_rounds?id=eq.${nrId}&select=id,name,deadline,locked,notified_at,reminded_at&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const roundRows = await roundRes.json().catch(() => []);
          const round = roundRows && roundRows[0];
          if (!round) return cors(new Response(JSON.stringify({ error: 'No such round.' }), { status: 404 }));
          if (round.locked) {
            return cors(new Response(JSON.stringify({
              error: 'That round is locked, so nobody can pick. Unlock it first if you meant to reopen it.'
            }), { status: 400 }));
          }

          /* Everyone approved, then — for a reminder — everyone approved who
             has not picked. */
          const partRes = await fetch(
            `${SB}/rest/v1/fantasy_participants?status=eq.approved&select=id,name,team_name,email`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          let people = await partRes.json().catch(() => []);
          if (!Array.isArray(people)) people = [];

          let picked = {};
          if (nrMode === 'reminder') {
            const pickRes = await fetch(
              `${SB}/rest/v1/fantasy_picks?round_id=eq.${nrId}&select=participant_id`,
              { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
            const picks = await pickRes.json().catch(() => []);
            (Array.isArray(picks) ? picks : []).forEach(p => { picked[p.participant_id] = true; });
            people = people.filter(p => !picked[p.id]);
          }

          const withEmail = people.filter(p => p.email);
          const noEmail = people.length - withEmail.length;

          if (!people.length) {
            return cors(new Response(JSON.stringify({
              ok: true, sent: 0, failed: 0, audience: nrMode, total: 0,
              note: nrMode === 'reminder'
                ? 'Everybody has already picked — nobody to remind.'
                : 'There are no approved participants to tell.'
            }), { status: 200 }));
          }

          const dl = new Date(round.deadline);
          /* The deadline in the reader's own time, not UTC — a fantasy
             deadline shown an hour out is a complaint waiting to happen. */
          const dlText = isNaN(dl) ? '' : dl.toLocaleString('en-ZA', {
            timeZone: 'Africa/Johannesburg', weekday: 'long', day: 'numeric',
            month: 'long', hour: '2-digit', minute: '2-digit', hour12: false
          });

          const headline = nrMode === 'reminder'
            ? '⏳ You have not picked yet.'
            : '\u{1F3CF} A new round is open.';
          const lead = nrMode === 'reminder'
            ? 'Your XI for this round is still empty. Picks close at the deadline below, and after that the round is out of reach.'
            : 'Picks are open. Choose your XI before the deadline below.';
          const subject = nrMode === 'reminder'
            ? '⏳ Still to pick — ' + round.name
            : '\u{1F3CF} ' + round.name + ' is open';

          const buildHtml = (displayName) => `<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"><tr><td style="background:#1A2B1C;padding:28px 28px 24px;border-radius:8px 8px 0 0;"><div style="font-size:10px;color:#C9A84C;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">${round.name}</div><div style="font-size:22px;font-weight:600;color:#F0EBD8;line-height:1.3;">${headline}</div></td></tr><tr><td style="background:#ffffff;padding:24px 28px;border-left:1px solid #e0ddd4;border-right:1px solid #e0ddd4;border-bottom:1px solid #eeebe4;"><p style="font-size:14px;color:#1a1a1a;font-weight:600;margin:0 0 8px;">Hi ${displayName},</p><p style="font-size:13px;color:#555;line-height:1.75;margin:0 0 14px;">${lead}</p><p style="font-size:13px;color:#1a1a1a;margin:0;"><strong>Deadline:</strong> ${dlText}</p></td></tr><tr><td style="background:#ffffff;padding:20px 28px;border:1px solid #e0ddd4;border-top:none;border-radius:0 0 8px 8px;"><a href="https://tygerbergcc.co.za/fantasy.html" style="display:block;background:#1A2B1C;color:#C9A84C;text-align:center;padding:12px 0;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.07em;text-decoration:none;">Pick your XI &rarr;</a><p style="font-size:11px;color:#aaa;text-align:center;margin:12px 0 0;font-style:italic;">Facta Non Verba</p></td></tr></table>`;

          let sent = 0, failed = 0;
          for (const p of withEmail) {
            const displayName = p.team_name || p.name || 'there';
            try {
              const er = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  service_id: env.EMAILJS_SERVICE_ID,
                  template_id: 'template_iifjomq',
                  user_id: env.EMAILJS_PUBLIC_KEY,
                  accessToken: env.EMAILJS_PRIVATE_KEY,
                  template_params: {
                    to_email: p.email, email: p.email, subject,
                    name: displayName, message: buildHtml(displayName)
                  }
                })
              });
              /* Counted on the result, not on having tried. A number that
                 says 14 when 14 bounced is worse than no number. */
              if (er && er.ok) sent++; else failed++;
            } catch (e) { failed++; }
          }

          /* Push as well, for anyone who turned it on in the fantasy app. */
          let pushed = 0;
          try {
            if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
              const subRes = await fetch(
                `${SB}/rest/v1/push_subscriptions?source=eq.fantasy&select=endpoint,p256dh,auth,participant_id`,
                { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
              let subs = await subRes.json().catch(() => []);
              if (!Array.isArray(subs)) subs = [];
              /* A reminder goes only to the people it is about. A subscription
                 with no participant on it cannot be matched, so it is left
                 out of a reminder rather than nagging somebody who has picked. */
              if (nrMode === 'reminder') {
                const want = {};
                people.forEach(p => { want[p.id] = true; });
                subs = subs.filter(sb => sb.participant_id && want[sb.participant_id]);
              }
              const note = JSON.stringify({
                title: nrMode === 'reminder' ? 'Still to pick — ' + round.name : round.name + ' is open',
                body: nrMode === 'reminder'
                  ? 'Your XI is still empty. Deadline ' + dlText + '.'
                  : 'Picks are open. Deadline ' + dlText + '.',
                url: 'https://tygerbergcc.co.za/fantasy.html'
              });
              for (const sb of subs) {
                try {
                  await webPushSend(sb, note, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY,
                                    'mailto:info@tygerbergcc.co.za');
                  pushed++;
                } catch (e) { /* a push that fails is not a failed notification */ }
              }
            }
          } catch (e) { /* email is the notification; push is a bonus */ }

          const stamp = {};
          stamp[nrMode === 'reminder' ? 'reminded_at' : 'notified_at'] = new Date().toISOString();
          await fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${nrId}`, {
            method: 'PATCH', headers: H, body: JSON.stringify(stamp)
          }).catch(() => {});

          return cors(new Response(JSON.stringify({
            ok: true, audience: nrMode, sent, failed, pushed,
            total: people.length, no_email: noEmail
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }

        // ── FANTASY: unlock round
        case 'fantasy.unlockRound': {
          const r = await fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${payload.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ locked: false }) });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        /* ── FANTASY: carry forward on demand ──────────────────────
           The same job the lock runs, pointed at a round that locked
           earlier — the backlog from before carry-forward existed.

           Two rails, because this writes teams into a finished round:

             - the round must be locked. Carrying into an open round
               would write a team the manager is still editing, and
               the pick screen would then present our XI as theirs.
             - a round that has already been scored needs
               confirm_scored. Its totals, round ranks, badges and any
               resolved H2H result have all been published; adding a
               team changes numbers people have already been told.
               That should take two deliberate acts, not one.

           Safe to run twice either way: anyone who already has a pick
           in the round is skipped. */
        case 'fantasy.carryForwardRound': {
          const cfId = payload && payload.round_id;
          if (!cfId) {
            return cors(new Response(JSON.stringify({ error: 'round_id required' }), { status: 400 }));
          }

          const cfRoundR = await fetch(
            `${SB}/rest/v1/fantasy_rounds?id=eq.${cfId}&select=id,name,locked`, { headers: H });
          const cfRows = await cfRoundR.json().catch(() => null);
          const cfRound = (Array.isArray(cfRows) && cfRows[0]) || null;
          if (!cfRound) {
            return cors(new Response(JSON.stringify({ error: 'Round not found' }), { status: 404 }));
          }
          if (!cfRound.locked) {
            return cors(new Response(JSON.stringify({
              error: 'That round is still open. Managers can submit for it themselves, and it will carry forward on its own when it locks.',
            }), { status: 400 }));
          }

          const cfScoredR = await fetch(
            `${SB}/rest/v1/fantasy_scores?round_id=eq.${cfId}&select=round_id&limit=1`, { headers: H });
          const cfScoredRows = await cfScoredR.json().catch(() => null);
          const cfScored = Array.isArray(cfScoredRows) && cfScoredRows.length > 0;

          /* Answered 200 with ok:false rather than a 4xx on purpose.
             This is not an error — it is the job asking a question,
             and the admin needs the question back in one piece to put
             it to whoever pressed the button. adminAPI() turns a
             non-2xx into a thrown Error and the detail gets flattened
             into a string on the way. */
          if (cfScored && !(payload && payload.confirm_scored === true)) {
            return cors(new Response(JSON.stringify({
              ok: false,
              needs_confirm: true,
              scored: true,
              round: cfRound.name,
              message: cfRound.name + ' has already been scored. Carrying teams into it now will change season totals, round ranks, badges and any Head-to-Head result already emailed. Go ahead only if you are willing to re-score the round and recompute badges afterwards.',
            }), { status: 200 }));
          }

          let cfCarry = null;
          try {
            cfCarry = await carryForwardRound(SB, H, cfId);
          } catch (e) {
            return cors(new Response(JSON.stringify({ error: 'Carry failed: ' + (e && e.message) }), { status: 500 }));
          }

          return cors(new Response(JSON.stringify({
            ok: true, round: cfRound.name, scored: cfScored, carry: cfCarry,
          }), { status: 200 }));
        }

        // ── FANTASY: clear all scores for a round before re-saving
        /* ── FANTASY: replace a round's scores, atomically ──────────
           This is the action admin.js uses. The two below it are the
           old delete-then-insert pair, kept only so that an admin that
           has not been redeployed yet still saves; nothing should call
           them once js/admin.js is at v=55.

           The round is deleted and rewritten inside one Postgres
           function, so a check-constraint violation or a dropped
           connection leaves the existing scores exactly where they
           were. Before this, the delete committed on its own and a
           failed insert lost the round for good — on a database with
           no point-in-time recovery. See 12-atomic-score-save.sql. */
        case 'fantasy.replaceRoundScores': {
          const { round_id, scores } = payload;
          if (!round_id) {
            return cors(new Response(JSON.stringify({ error: 'round_id required' }), { status: 400 }));
          }
          const rpcH = Object.assign({}, H, { 'Content-Type': 'application/json' });
          const rr = await fetch(`${SB}/rest/v1/rpc/fantasy_replace_round_scores`, {
            method: 'POST', headers: rpcH,
            body: JSON.stringify({ p_round: round_id, p_rows: Array.isArray(scores) ? scores : [] })
          });
          const body = await rr.text();
          if (!rr.ok) {
            /* Hand back what Postgres actually said. A save that fails
               with "Save failed" and nothing else cost an evening
               once already — the real message names the row. */
            let msg = body;
            try { const j = JSON.parse(body); msg = j.message || j.hint || j.details || body; } catch (e) {}
            return cors(new Response(JSON.stringify({ error: msg, nothing_changed: true }), { status: rr.status }));
          }
          return cors(new Response(JSON.stringify({ ok: true, saved: Number(body) || 0 }), { status: 200 }));
        }

        case 'fantasy.clearRoundScores': {
          const { round_id } = payload;
          const r = await fetch(`${SB}/rest/v1/fantasy_scores?round_id=eq.${round_id}`, { method: 'DELETE', headers: H });
          /* The status was previously ignored and this reported ok
             regardless. It is still here only for an un-redeployed
             admin, but it no longer lies about what happened. */
          if (!r.ok) {
            return cors(new Response(JSON.stringify({ error: 'Could not clear the round: ' + (await r.text()) }), { status: r.status }));
          }
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
        /* ── FANTASY: list participants, with their email addresses ──
           The admin used to read fantasy_participants straight from
           PostgREST with the anon key. That stopped working the moment
           the email column was revoked from anon (14-close-the-exposed-
           columns.sql): PostgREST answers a request touching a column
           the role cannot read with 401 for the WHOLE request, so both
           `select=*` and `select=…,email` started failing outright.

           Reading it here with the service key is where it should have
           been anyway — the email addresses never needed to be exposed
           to the browser's key to be shown to a signed-in admin. */
        case 'fantasy.listParticipants': {
          const st = payload && payload.status;
          const allowed = ['pending', 'approved', 'rejected'];
          const filter = (st && allowed.includes(st)) ? `status=eq.${st}&` : '';
          const order  = (st === 'pending') ? 'created_at.asc' : 'name.asc';
          const lpR = await fetch(
            `${SB}/rest/v1/fantasy_participants?${filter}select=*&order=${order}`,
            { headers: H });
          return cors(new Response(await lpR.text(), { status: lpR.status }));
        }

        case 'fantasy.deleteParticipant': {
          const { id } = payload;
          // Delete picks first, then participant
          await fetch(`${SB}/rest/v1/fantasy_picks?participant_id=eq.${id}`, { method: 'DELETE', headers: H });
          const r = await fetch(`${SB}/rest/v1/fantasy_participants?id=eq.${id}`, { method: 'DELETE', headers: H });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── FANTASY: get own pick + chip history (token-gated)
        case 'fantasy.getMyPicks': {
          const c = body._claims || {};
          const pid = c.role === 'participant' ? c.pid : payload.participant_id;
          if (!pid) return cors(new Response(JSON.stringify({ error: 'Missing participant' }), { status: 400 }));
          const { round_id } = payload;
          const [pickR2, chipR2] = await Promise.all([
            round_id
              ? fetch(`${SB}/rest/v1/fantasy_picks?participant_id=eq.${pid}&round_id=eq.${round_id}&select=*`, { headers: H }).then(r => r.json())
              : Promise.resolve([]),
            fetch(`${SB}/rest/v1/fantasy_chip_usage?participant_id=eq.${pid}&select=chip,round_id`, { headers: H }).then(r => r.json()),
          ]);
          return cors(new Response(JSON.stringify({
            pick:  (pickR2 && pickR2[0]) || null,
            chips: chipR2 || [],
          }), { status: 200 }));
        }

        // ── FANTASY: submit picks (token-gated; ALL rules enforced here)
        case 'fantasy.submitPicks': {
          const c = body._claims || {};
          const pid = c.role === 'participant' ? c.pid : payload.participant_id;
          if (!pid) return cors(new Response(JSON.stringify({ error: 'Missing participant' }), { status: 400 }));
          const { round_id, player_ids, captain_id, vice_captain_id, chip } = payload;

          const idList = Array.isArray(player_ids) ? player_ids.join(',') : '';
          const [roundR, playersR3, chipR3] = await Promise.all([
            fetch(`${SB}/rest/v1/fantasy_rounds?id=eq.${round_id}&select=id,locked,deadline`, { headers: H }).then(r => r.json()),
            /* fantasy_players, not players: the view is the eligibility rule
               (adults, playing members, not youth squad). An id that is not in
               it does not come back, and validatePickSubmission below refuses
               the whole squad. So a junior cannot be saved into a team even if
               a page offered one or the id was typed by hand. */
            idList
              ? fetch(`${SB}/rest/v1/fantasy_players?id=in.(${idList})&select=id,fantasy_value`, { headers: H })
                  .then(async r => {
                    const rows = await r.json().catch(() => null);
                    if (!r.ok || !Array.isArray(rows)) {
                      /* Almost always one thing: 2-fantasy-players-view.sql
                         has not been run on this database yet. Say so in the
                         log, where whoever deployed will look. */
                      console.error('fantasy_players unreadable (has 2-fantasy-players-view.sql been run?):',
                                    r.status, JSON.stringify(rows));
                      return null;
                    }
                    return rows;
                  })
              : Promise.resolve([]),
            fetch(`${SB}/rest/v1/fantasy_chip_usage?participant_id=eq.${pid}&select=chip,round_id`, { headers: H }).then(r => r.json()),
          ]);
          const round = (roundR && roundR[0]) || null;

          const v = validatePickSubmission(
            { player_ids, captain_id, vice_captain_id, chip },
            /* Deliberately NOT "playersR3 || []". An unreadable squad list
               coerced to an empty array looks exactly like a squad full of
               ineligible players, and the manager gets told to pick again
               when the fault is ours. Pass the null through so the guard in
               validatePickSubmission can tell the two apart. */
            playersR3, chipR3 || [], round
          );
          if (!v.ok) return cors(new Response(JSON.stringify({ error: v.error }), { status: 400 }));

          // Upsert the pick
          const pickBody = { participant_id: pid, round_id, player_ids, captain_id, vice_captain_id, chip: v.effectiveChip };
          const exR = await fetch(`${SB}/rest/v1/fantasy_picks?participant_id=eq.${pid}&round_id=eq.${round_id}&select=id`, { headers: H });
          const exRows = await exR.json();
          /* "Save failed" and nothing else is what this used to answer, with
             the database's own explanation read and dropped on the floor.
             Two people then spent an evening guessing at a message Postgres
             had already written. Whatever it says, pass it on. */
          const pickWriteFailed = async (res, what) => {
            const raw = await res.text().catch(() => '');
            let detail = raw.slice(0, 400), code = null;
            try {
              const j = JSON.parse(raw);
              detail = j.message || j.details || j.hint || detail;
              code   = j.code || null;
            } catch (e) { /* not JSON — keep the raw text */ }
            console.error('fantasy_picks ' + what + ' failed:', res.status, code, raw.slice(0, 600));
            return cors(new Response(JSON.stringify({
              error:  'Could not save your team: ' + (detail || ('HTTP ' + res.status)),
              code:   code,
              status: res.status,
              chip:   pickBody.chip || null,
            }), { status: 500 }));
          };

          let pickId;
          if (exRows && exRows.length) {
            pickId = exRows[0].id;
            const up = await fetch(`${SB}/rest/v1/fantasy_picks?id=eq.${pickId}`, {
              method: 'PATCH', headers: H, body: JSON.stringify(pickBody)
            });
            if (!up.ok) return await pickWriteFailed(up, 'PATCH');
          } else {
            const repH3 = Object.assign({}, H, { 'Prefer': 'return=representation' });
            const ins = await fetch(`${SB}/rest/v1/fantasy_picks`, {
              method: 'POST', headers: repH3, body: JSON.stringify(pickBody)
            });
            if (!ins.ok) return await pickWriteFailed(ins, 'POST');
            const insRows = await ins.json().catch(() => []);
            pickId = insRows && insRows[0] ? insRows[0].id : null;
          }

          /* Chip ledger — transactional with the pick, server-side.
             Clear first: a chip taken off, or swapped for another, must
             leave no row behind, or it stays "played" forever. */
          if (v.staleChips && v.staleChips.length) {
            const delUrl = `${SB}/rest/v1/fantasy_chip_usage`
              + `?participant_id=eq.${pid}&round_id=eq.${round_id}`
              + (v.effectiveChip ? `&chip=neq.${encodeURIComponent(v.effectiveChip)}` : '');
            const del = await fetch(delUrl, { method: 'DELETE', headers: H });
            if (!del.ok) {
              return cors(new Response(JSON.stringify({
                error: 'Your team was saved, but the power-up could not be changed. Please try again.'
              }), { status: 500 }));
            }
          }
          if (v.effectiveChip && !v.alreadyLogged) {
            const chipH3 = Object.assign({}, H, { 'Prefer': 'resolution=ignore-duplicates,return=minimal' });
            const chipIns = await fetch(`${SB}/rest/v1/fantasy_chip_usage`, {
              method: 'POST', headers: chipH3,
              body: JSON.stringify({ participant_id: pid, round_id, chip: v.effectiveChip })
            });
            /* This result used to be discarded. If the ledger write fails,
               the team is saved but the power-up is not recorded — and the
               manager was told everything went fine, so they would find out
               when the round was scored without it. */
            if (!chipIns.ok) {
              const raw = await chipIns.text().catch(() => '');
              console.error('fantasy_chip_usage POST failed:', chipIns.status, raw.slice(0, 600));
              let detail = raw.slice(0, 300);
              try { const j = JSON.parse(raw); detail = j.message || j.details || j.hint || detail; } catch (e) {}
              return cors(new Response(JSON.stringify({
                error: 'Your team was saved, but the power-up could not be recorded: ' + detail,
                pick_id: pickId, chip: null, status: chipIns.status,
              }), { status: 500 }));
            }
          }
          return cors(new Response(JSON.stringify({ ok: true, pick_id: pickId, chip: v.effectiveChip }), { status: 200 }));
        }

        // ── SCORING: exchange the scorer PIN for a 24h scorer token
        case 'scoring.auth': {
          if (!env.SCORER_PIN) {
            return cors(new Response(JSON.stringify({ error: 'SCORER_PIN not configured' }), { status: 500 }));
          }
          if (String(payload.pin || '') !== String(env.SCORER_PIN)) {
            return cors(new Response(JSON.stringify({ error: 'Invalid PIN' }), { status: 401 }));
          }
          const sToken = await jwtSign({
            role: 'scorer',
            exp:  Math.floor(Date.now() / 1000) + 60 * 60 * 24,
          }, env.JWT_SECRET || '');
          return cors(new Response(JSON.stringify({ token: sToken }), { status: 200 }));
        }

        // ── SCORING: write a live score row (replaces direct anon writes)
        /* Abandon a match started against the wrong fixture. The scorer used to
           DELETE this row directly with the anon key, which RLS silently refused —
           leaving a phantom 'live' match on the public page forever. */
        /* Remembered squads. Names accumulate as the scorer enters them, so
           the next meeting with the same side starts pre-filled. */
        case 'squad.get': {
          const sqTeam = String((payload && payload.tccTeam) || '').slice(0, 60);
          const sqOpp  = String((payload && payload.opponentKey) || '').slice(0, 60);
          const sqQ = `${SB}/rest/v1/team_squads?select=side,players`
            + `&tcc_team=eq.${encodeURIComponent(sqTeam)}`
            + `&or=(opponent_key.eq.${encodeURIComponent(sqOpp)},opponent_key.eq.)`;
          const sqR = await fetch(sqQ, { headers: H });
          const rows = await sqR.json().catch(() => []);
          const out = { tcc: [], opp: [] };
          (Array.isArray(rows) ? rows : []).forEach(r => {
            if (r && (r.side === 'tcc' || r.side === 'opp') && Array.isArray(r.players)) {
              out[r.side] = r.players;
            }
          });
          return cors(new Response(JSON.stringify(out), { status: 200 }));
        }

        case 'squad.save': {
          const svSide = (payload && payload.side) === 'opp' ? 'opp' : 'tcc';
          const svTeam = String((payload && payload.tccTeam) || '').slice(0, 60);
          // The TCC row is per side only; the opposition row is per opponent.
          const svOpp  = svSide === 'tcc' ? '' : String((payload && payload.opponentKey) || '').slice(0, 60);
          const clean  = (Array.isArray(payload && payload.players) ? payload.players : [])
            .map(n => String(n == null ? '' : n).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60))
            .filter(n => n.length > 0)
            .slice(0, 40);
          if (!clean.length) return cors(new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 }));
          const svH = Object.assign({}, H, {
            'Prefer': 'resolution=merge-duplicates,return=minimal',
            'Content-Type': 'application/json'
          });
          const svR = await fetch(`${SB}/rest/v1/team_squads?on_conflict=tcc_team,opponent_key,side`, {
            method: 'POST', headers: svH,
            body: JSON.stringify([{ tcc_team: svTeam, opponent_key: svOpp, side: svSide,
                                    players: clean, updated_at: new Date().toISOString() }])
          });
          return cors(new Response(JSON.stringify({ ok: svR.ok }), { status: svR.ok ? 200 : svR.status }));
        }

        case 'scoring.abandon': {
          const abId = String((payload && payload.id) || '');
          if (!abId) return cors(new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 }));

          /* Copy the row aside before deleting it. This used to be an
             unrecoverable hard delete with no backup anywhere, so one stray
             tap destroyed a day's scoring for good. */
          try {
            const snapR = await fetch(
              `${SB}/rest/v1/live_scores?id=eq.${encodeURIComponent(abId)}&select=*`, { headers: H });
            const snapRows = await snapR.json().catch(() => []);
            if (snapRows && snapRows[0]) {
              await fetch(`${SB}/rest/v1/live_scores_deleted`, {
                method: 'POST', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }),
                body: JSON.stringify([{
                  live_score_id: abId,
                  fixture_id: snapRows[0].fixture_id || null,
                  snapshot: snapRows[0]
                }])
              });
            }
          } catch (e) {
            /* If the archive fails the delete is stopped: losing the match is
               worse than leaving a stale row on the live page. */
            return cors(new Response(JSON.stringify({
              error: 'Could not archive the match before deleting, so nothing was deleted.'
            }), { status: 500 }));
          }

          const abR = await fetch(`${SB}/rest/v1/live_scores?id=eq.${encodeURIComponent(abId)}`, {
            method: 'DELETE', headers: H
          });
          return cors(new Response(JSON.stringify({ ok: abR.ok }), { status: abR.ok ? 200 : abR.status }));
        }

        case 'scoring.push': {
          const { id, data } = payload || {};
          if (!data) return cors(new Response(JSON.stringify({ error: 'Missing data' }), { status: 400 }));
          if (id) {
            /* Handover fencing. The row records which device holds the match.
               A push from any other device is refused, so a superseded phone
               (or its offline queue flushing hours later) can no longer
               overwrite the new scorer's work. Decided here rather than on
               the device: the old phone may be offline and unaware. */
            const fR = await fetch(
              `${SB}/rest/v1/live_scores?id=eq.${encodeURIComponent(id)}&select=scorer_session`, { headers: H });
            const fRows = await fR.json().catch(() => []);
            const held = fRows && fRows[0] ? fRows[0].scorer_session : null;
            const mine = data.scorer_session || null;
            if (held && mine && held !== mine) {
              return cors(new Response(JSON.stringify({
                error: 'taken_over',
                message: 'Another device has taken over scoring this match.'
              }), { status: 409 }));
            }
            /* First device to push claims the match if nobody holds it. */
            if (!held && mine) data.scorer_session = mine;
            const pr = await fetch(`${SB}/rest/v1/live_scores?id=eq.${id}`, {
              method: 'PATCH', headers: H, body: JSON.stringify(data)
            });
            return cors(new Response(JSON.stringify({ ok: pr.ok }), { status: pr.ok ? 200 : pr.status }));
          }
          const repH4 = Object.assign({}, H, { 'Prefer': 'return=representation' });
          const cr2 = await fetch(`${SB}/rest/v1/live_scores`, {
            method: 'POST', headers: repH4, body: JSON.stringify(data)
          });
          const rows = await cr2.json().catch(() => []);
          return cors(new Response(JSON.stringify({ ok: cr2.ok, id: rows && rows[0] ? rows[0].id : null }), { status: cr2.ok ? 200 : cr2.status }));
        }

        // ── SCORING: set a fixture's result (only the result column)
        case 'scoring.setResult': {
          const { fixtureId, result } = payload || {};
          if (!fixtureId || !result) return cors(new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 }));
          const fr = await fetch(`${SB}/rest/v1/fixtures?id=eq.${fixtureId}`, {
            method: 'PATCH', headers: H, body: JSON.stringify({ result })
          });
          return cors(new Response(JSON.stringify({ ok: fr.ok }), { status: fr.ok ? 200 : fr.status }));
        }

        // ── SCORING: validate a match PIN for device takeover
        case 'scoring.takeover': {
          const { liveScoreId, pin } = payload || {};
          const tr = await fetch(`${SB}/rest/v1/live_scores?id=eq.${liveScoreId}&select=scorer_pin`, { headers: H });
          const tRows = await tr.json().catch(() => []);
          if (!tRows || !tRows.length || String(pin || '') !== String(tRows[0].scorer_pin || '')) {
            return cors(new Response(JSON.stringify({ error: 'Incorrect PIN' }), { status: 401 }));
          }
          /* Issue the new holder's token here, not on the device, so the
             previous device is fenced out from this moment on. */
          const session = 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
          await fetch(`${SB}/rest/v1/live_scores?id=eq.${encodeURIComponent(liveScoreId)}`, {
            method: 'PATCH', headers: H, body: JSON.stringify({ scorer_session: session })
          });
          return cors(new Response(JSON.stringify({ ok: true, scorer_session: session }), { status: 200 }));
        }

        // ── FANTASY: update participant profile
        case 'fantasy.updateProfile': {
          const { id, team_name, name } = payload;
          const c = body._claims || {};
          if (c.role === 'participant' && c.pid !== id) {
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          }
          const data = {};
          if (team_name !== undefined) data.team_name = team_name;
          if (name) data.name = name;
          const r = await fetch(`${SB}/rest/v1/fantasy_participants?id=eq.${id}`, {
            method: 'PATCH', headers: H, body: JSON.stringify(data)
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── FANTASY: register (creates pending participant + notifies admin)
        case 'fantasy.register': {
          const cleanReg = (s, max) => String(s == null ? '' : s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
          const email    = String((payload && payload.email) || '').trim().toLowerCase().slice(0, 200);
          const name     = cleanReg(payload && payload.name, 80);
          const teamName = cleanReg(payload && payload.teamName, 60);
          if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return cors(new Response(JSON.stringify({ error: 'A valid name and email are required.' }), { status: 400 }));
          }
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
          /* `name` is selected because the sign-in page no longer sends
             one. It used to read the participant row in the browser to
             get it, which stopped working when the email column was
             closed to anon and showed every returning member the
             registration form. The name is used for the greeting below
             and is deliberately NOT returned in the response: the code
             has not been verified yet, so whoever typed this address
             has proved nothing and is owed nothing. */
          const statusR = await fetch(`${SB}/rest/v1/fantasy_participants?email=eq.${encodeURIComponent(email)}&select=id,status,name`, { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
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

          // Rate limit: max 3 codes per email per 10 minutes
          const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const rlR = await fetch(`${SB}/rest/v1/fantasy_otps?email=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(since)}&select=id`, { headers: SBH });
          const recent = await rlR.json().catch(() => []);
          if ((recent || []).length >= 3) {
            return cors(new Response(JSON.stringify({ error: 'Too many codes requested — wait a few minutes and try again' }), { status: 429 }));
          }

          // Generate 6-digit code (crypto-strength)
          const rnd = new Uint32Array(1);
          crypto.getRandomValues(rnd);
          const code    = String(100000 + (rnd[0] % 900000));
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
          /* Prefer the name on file over whatever the page sent, which
             for a returning member is now nothing. Falling back to the
             local part of the address would greet Byron as "bydaries". */
          const storedName = statusRows[0].name || '';
          const whoName    = name || storedName;
          const greeting   = whoName ? `Hi ${whoName},` : 'Hi there,';
          const emailPayload = {
            service_id:  env.EMAILJS_SERVICE_ID,
            template_id: 'template_iifjomq',
            user_id:     env.EMAILJS_PUBLIC_KEY,
            accessToken: env.EMAILJS_PRIVATE_KEY,
            template_params: {
              to_email: email,
              email:    email,
              subject:  'Your TCC Fantasy Cricket verification code',
              name:     whoName || email.split('@')[0],
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

          // Find the active OTP for this email (by email only — the code
          // is compared here so failed attempts can be counted and capped)
          const otpR = await fetch(
            `${SB}/rest/v1/fantasy_otps?email=eq.${encodeURIComponent(email)}&used=eq.false&order=created_at.desc&limit=1`,
            { headers: SBH2 }
          );
          const otps = await otpR.json();
          if (!otps || !otps.length) return cors(new Response(JSON.stringify({ error: 'Invalid code' }), { status: 401 }));

          const otp = otps[0];
          if (new Date(otp.expires_at) < new Date()) {
            return cors(new Response(JSON.stringify({ error: 'Code expired' }), { status: 401 }));
          }
          if ((otp.attempts || 0) >= 5) {
            await fetch(`${SB}/rest/v1/fantasy_otps?id=eq.${otp.id}`, {
              method: 'PATCH', headers: SBH2, body: JSON.stringify({ used: true })
            });
            return cors(new Response(JSON.stringify({ error: 'Too many attempts — request a new code' }), { status: 429 }));
          }
          if (String(code) !== String(otp.code)) {
            await fetch(`${SB}/rest/v1/fantasy_otps?id=eq.${otp.id}`, {
              method: 'PATCH', headers: SBH2, body: JSON.stringify({ attempts: (otp.attempts || 0) + 1 })
            });
            return cors(new Response(JSON.stringify({ error: 'Invalid code' }), { status: 401 }));
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

          // Issue a participant token (season-length) — this is what
          // authorises pick submission and profile edits from now on
          const pToken = await jwtSign({
            role: 'participant',
            pid:  participant.id,
            email: participant.email,
            exp:  Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 120,
          }, env.JWT_SECRET || '');

          return cors(new Response(JSON.stringify({ ok: true, participant, token: pToken }), { status: 200 }));
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
        /* Admin player reads go through the Worker (service key) rather than
           the anon key, because dob / media_consent are deliberately revoked
           from anon. Both are needed here: dob backs the minor-eligibility
           safety net and the safeguarding note in the player editor. */
        case 'player.get': {
          const pgId = String((payload && payload.id) || '');
          if (!pgId) return cors(new Response(JSON.stringify({ error: 'Missing player id' }), { status: 400 }));
          const pgR = await fetch(`${SB}/rest/v1/players?id=eq.${encodeURIComponent(pgId)}&select=*`, { headers: H });
          return cors(new Response(await pgR.text(), { status: pgR.status }));
        }

        case 'player.listFantasy': {
          /* media_consent is part of the eligibility rule: a minor in a
             senior squad may be picked and scored only with consent on
             file. Without it here, isFantasyEligible() in admin.js sees
             undefined and treats every minor as unconsented, so they
             vanish from the score grid with no error anywhere — which
             is indistinguishable from the rule working correctly.
             admin.js now detects the field's absence and says so on
             screen, but the fix is this line. */
          const pfR = await fetch(`${SB}/rest/v1/players?active=not.eq.false&order=name.asc&select=id,name,role,fantasy_value,squad,dob,is_minor,member_type,media_consent`, { headers: H });
          return cors(new Response(await pfR.text(), { status: pfR.status }));
        }
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
            const rowsByKey = {};
            (allScoresR || []).forEach(s => {
              const key = s.round_id + '_' + s.player_id;
              (rowsByKey[key] = rowsByKey[key] || []).push(s);
            });
            const scoreLookup = {};
            Object.keys(rowsByKey).forEach(key => {
              scoreLookup[key] = fantasyAggregateScores(rowsByKey[key]);
            });


            const totals = {};
            (allPicksR || []).forEach(pick => {
              const pid = pick.participant_id;
              if (!totals[pid]) totals[pid] = 0;
              totals[pid] += fantasyPickPoints(
                pick,
                id => scoreLookup[pick.round_id + '_' + id] || null,
                { wildcard: roundWc[pick.round_id] || false,
                  boost:    roundBoost[pick.round_id] || null,
                  roleOf:   id => (playerRoleMap && playerRoleMap[id]) || '' }
              );
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

          // Aggregate scores per player, by the one rule
          const rowsByPlayer2 = {};
          (scoresR || []).forEach(s => {
            (rowsByPlayer2[s.player_id] = rowsByPlayer2[s.player_id] || []).push(s);
          });
          const scoreLookup2 = {};
          Object.keys(rowsByPlayer2).forEach(k => {
            scoreLookup2[k] = fantasyAggregateScores(rowsByPlayer2[k]);
          });


          // Round points per participant
          const participantPts = {};
          (picksR || []).forEach(pick => {
            participantPts[pick.participant_id] = fantasyPickPoints(
              pick,
              id => scoreLookup2[id] || null,
              { wildcard: isWildcard, boost: roundBoost2, roleOf: id => roleMap2[id] || '' }
            );
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
            fetch(`${SB}/rest/v1/players?select=id,role,name&active=not.eq.false`, { headers: aH }).then(r => r.json()),
          ]);

          // Resolution order: exact DB player names first, then the
          // admin-managed alias map overwrites (aliases always win).
          // This keeps auto-score working now that the scorer lineup
          // selection (which auto-populated the map) is removed.
          const nameMap  = {};
          (playersRes || []).forEach(p => { if (p.name) nameMap[p.name.toLowerCase()] = p.id; });
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
        /* ══════════════════════════════════════════════════════
           CALENDAR & CLUB EVENTS
           calendar.feed aggregates fixtures + training + club events +
           player birthdays. Birthdays are derived from players.dob, which
           is NOT readable with the public anon key -- so this action is
           JWT-gated and the dob never reaches a browser.
        ══════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════
           TIMESHEETS
           ══════════════════════════════════════════════════════ */

        /* Who is this caller, and may they approve? */
        case 'timesheet.me': {
          const meR = await fetch(
            `${SB}/rest/v1/timesheet_workers?admin_user_id=eq.${encodeURIComponent(body._claims.sub)}&select=id,name,job_title,active,pay_type`,
            { headers: H });
          const me = await meR.json().catch(() => []);
          const canApprove = ['super','chair','finance','captain'].includes(body._claims.role);
          /* Rates, fees and the payment run. The captain approves hours but
             is not in this list. */
          const canPay = ['super','chair','finance'].includes(body._claims.role);
          return cors(new Response(JSON.stringify({
            worker: Array.isArray(me) && me.length ? me[0] : null,
            canApprove, canPay
          }), { status: 200 }));
        }

        /* A worker's own entries. Never returns anyone else's. */
        case 'timesheet.myEntries': {
          const wR = await fetch(
            `${SB}/rest/v1/timesheet_workers?admin_user_id=eq.${encodeURIComponent(body._claims.sub)}&select=id`,
            { headers: H });
          const w = await wR.json().catch(() => []);
          if (!Array.isArray(w) || !w.length) {
            return cors(new Response(JSON.stringify([]), { status: 200 }));
          }
          const from = /^\d{4}-\d{2}-\d{2}$/.test(String(payload?.from || '')) ? payload.from : '1900-01-01';
          const to   = /^\d{4}-\d{2}-\d{2}$/.test(String(payload?.to   || '')) ? payload.to   : '2999-12-31';
          const eR = await fetch(
            `${SB}/rest/v1/timesheet_entries?worker_id=eq.${w[0].id}` +
            `&work_date=gte.${from}&work_date=lte.${to}` +
            `&select=id,work_date,start_time,end_time,break_minutes,hours,notes,status,reject_reason,is_extra` +
            `&order=work_date.desc`, { headers: H });
          return cors(new Response(await eR.text(), { status: eR.status }));
        }

        /* Create or update one of the caller's OWN entries.
           An approved or paid entry is locked — reopening it would let someone
           quietly change hours after sign-off. */
        case 'timesheet.saveEntry': {
          const d = (payload && payload.data) || {};
          const wR = await fetch(
            `${SB}/rest/v1/timesheet_workers?admin_user_id=eq.${encodeURIComponent(body._claims.sub)}&select=id,active,pay_type`,
            { headers: H });
          const w = await wR.json().catch(() => []);
          if (!Array.isArray(w) || !w.length) {
            return cors(new Response(JSON.stringify({ error: 'You are not set up as a worker. Ask an administrator.' }), { status: 403 }));
          }
          if (!w[0].active) {
            return cors(new Response(JSON.stringify({ error: 'Your worker record is inactive.' }), { status: 403 }));
          }

          const date = String(d.work_date || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return cors(new Response(JSON.stringify({ error: 'A valid date is required.' }), { status: 400 }));
          }
          /* Not in the future — you cannot have worked tomorrow. */
          if (date > new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10)) {
            return cors(new Response(JSON.stringify({ error: 'That date is in the future.' }), { status: 400 }));
          }

          const t = (v) => /^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : null;
          const st = t(d.start_time), en = t(d.end_time);
          const brk = Math.max(0, Math.min(600, parseInt(d.break_minutes, 10) || 0));

          /* Hours are computed here, never trusted from the client. */
          let hours = 0;
          if (st && en) {
            const mins = (h) => (+h.slice(0,2)) * 60 + (+h.slice(3,5));
            let diff = mins(en) - mins(st);
            if (diff < 0) diff += 24 * 60;          // shift crossing midnight
            diff -= brk;
            hours = Math.max(0, Math.round((diff / 60) * 100) / 100);
          } else {
            hours = Math.max(0, Math.min(24, parseFloat(d.hours) || 0));
          }
          if (hours <= 0) {
            return cors(new Response(JSON.stringify({ error: 'That works out at zero hours.' }), { status: 400 }));
          }
          if (hours > 16) {
            return cors(new Response(JSON.stringify({ error: 'More than 16 hours in a day — check the times.' }), { status: 400 }));
          }

          const row = {
            worker_id: w[0].id,
            work_date: date,
            start_time: st, end_time: en,
            break_minutes: brk,
            hours,
            notes: String(d.notes == null ? '' : d.notes).replace(/[<>]/g, '').trim().slice(0, 400) || null,
            /* Extra hours are paid on top of a monthly fee. Meaningless for an
               hourly person, so it is forced off for them. */
            is_extra: w[0].pay_type === 'monthly' && d.is_extra === true,
            updated_at: new Date().toISOString()
          };

          const eid = String(d.id || '');
          const eH = Object.assign({}, H, { 'Prefer': 'return=representation' });

          if (eid) {
            /* Only the owner's own draft/submitted/rejected entries are editable. */
            const curR = await fetch(
              `${SB}/rest/v1/timesheet_entries?id=eq.${encodeURIComponent(eid)}&select=worker_id,status`,
              { headers: H });
            const cur = await curR.json().catch(() => []);
            if (!Array.isArray(cur) || !cur.length) {
              return cors(new Response(JSON.stringify({ error: 'Entry not found.' }), { status: 404 }));
            }
            if (cur[0].worker_id !== w[0].id) {
              return cors(new Response(JSON.stringify({ error: 'That is not your entry.' }), { status: 403 }));
            }
            if (['approved','paid'].includes(cur[0].status)) {
              return cors(new Response(JSON.stringify({ error: 'Approved hours cannot be edited. Ask an approver to reopen it.' }), { status: 409 }));
            }
            row.status = 'draft';   // editing a rejected entry sends it back to draft
            const uR = await fetch(`${SB}/rest/v1/timesheet_entries?id=eq.${encodeURIComponent(eid)}`, {
              method: 'PATCH', headers: eH, body: JSON.stringify(row)
            });
            return cors(new Response(await uR.text(), { status: uR.status }));
          }

          row.status = 'draft';
          const iR = await fetch(`${SB}/rest/v1/timesheet_entries`, {
            method: 'POST', headers: eH, body: JSON.stringify([row])
          });
          return cors(new Response(await iR.text(), { status: iR.status }));
        }

        /* Send drafts for approval. */
        case 'timesheet.submit': {
          const ids = Array.isArray(payload && payload.ids) ? payload.ids.slice(0, 200) : [];
          if (!ids.length) return cors(new Response(JSON.stringify({ error: 'Nothing to submit.' }), { status: 400 }));
          const wR = await fetch(
            `${SB}/rest/v1/timesheet_workers?admin_user_id=eq.${encodeURIComponent(body._claims.sub)}&select=id`,
            { headers: H });
          const w = await wR.json().catch(() => []);
          if (!Array.isArray(w) || !w.length) {
            return cors(new Response(JSON.stringify({ error: 'You are not set up as a worker.' }), { status: 403 }));
          }
          const list = ids.map(encodeURIComponent).join(',');
          const sR = await fetch(
            `${SB}/rest/v1/timesheet_entries?id=in.(${list})&worker_id=eq.${w[0].id}&status=eq.draft`, {
              method: 'PATCH', headers: H,
              body: JSON.stringify({ status: 'submitted', updated_at: new Date().toISOString() })
            });
          return cors(new Response(JSON.stringify({ ok: sR.ok }), { status: sR.ok ? 200 : sR.status }));
        }

        case 'timesheet.deleteEntry': {
          const eid = String((payload && payload.id) || '');
          if (!eid) return cors(new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 }));
          const wR = await fetch(
            `${SB}/rest/v1/timesheet_workers?admin_user_id=eq.${encodeURIComponent(body._claims.sub)}&select=id`,
            { headers: H });
          const w = await wR.json().catch(() => []);
          if (!Array.isArray(w) || !w.length) {
            return cors(new Response(JSON.stringify({ error: 'You are not set up as a worker.' }), { status: 403 }));
          }
          /* Only your own, and only while it is still yours to change. */
          const dR = await fetch(
            `${SB}/rest/v1/timesheet_entries?id=eq.${encodeURIComponent(eid)}` +
            `&worker_id=eq.${w[0].id}&status=in.(draft,rejected)`,
            { method: 'DELETE', headers: H });
          return cors(new Response(JSON.stringify({ ok: dR.ok }), { status: dR.ok ? 200 : dR.status }));
        }

        /* ── Approver side ──────────────────────────────────── */

        /* Everything awaiting a decision, with the worker's name attached. */
        case 'timesheet.review': {
          const st = ['submitted','approved','rejected','paid'].includes(payload && payload.status)
            ? payload.status : 'submitted';
          const from = /^\d{4}-\d{2}-\d{2}$/.test(String(payload?.from || '')) ? payload.from : '1900-01-01';
          const to   = /^\d{4}-\d{2}-\d{2}$/.test(String(payload?.to   || '')) ? payload.to   : '2999-12-31';
          const seesPay = ['super','chair','finance'].includes(body._claims.role);
          const rR = await fetch(
            `${SB}/rest/v1/timesheet_entries?status=eq.${st}` +
            `&work_date=gte.${from}&work_date=lte.${to}` +
            `&select=id,work_date,start_time,end_time,break_minutes,hours,notes,status,` +
            `reject_reason,approved_by,approved_at,is_extra,pay_basis,` +
            (seesPay ? `rate_snapshot,paid_batch,` : ``) +
            `timesheet_workers(id,name,job_title,admin_user_id,pay_type` + (seesPay ? `,hourly_rate` : ``) + `)` +
            `&order=work_date.asc`, { headers: H });
          return cors(new Response(await rR.text(), { status: rR.status }));
        }

        /* Approve, snapshotting the rate so a later rate change cannot rewrite
           what someone was signed off to be paid. */
        case 'timesheet.approve': {
          const ids = Array.isArray(payload && payload.ids) ? payload.ids.slice(0, 200) : [];
          if (!ids.length) return cors(new Response(JSON.stringify({ error: 'Nothing to approve.' }), { status: 400 }));

          const list = ids.map(encodeURIComponent).join(',');
          const curR = await fetch(
            `${SB}/rest/v1/timesheet_entries?id=in.(${list})&status=eq.submitted` +
            `&select=id,worker_id,work_date,is_extra,timesheet_workers(hourly_rate,admin_user_id,pay_type)`, { headers: H });
          const cur = await curR.json().catch(() => []);
          if (!Array.isArray(cur) || !cur.length) {
            return cors(new Response(JSON.stringify({ error: 'Nothing submitted to approve.' }), { status: 409 }));
          }
          /* Nobody signs off their own hours. */
          const own = cur.filter(e => e.timesheet_workers &&
            e.timesheet_workers.admin_user_id === body._claims.sub);
          if (own.length) {
            return cors(new Response(JSON.stringify({
              error: 'You cannot approve your own hours. Ask another approver.'
            }), { status: 403 }));
          }

          const now = new Date().toISOString();
          const who = String(body._claims.name || '').slice(0, 60);

          /* Pay basis is fixed at approval, like the rate. A monthly person's
             ordinary hours are covered by the fee; their extra hours, and all
             of an hourly person's hours, pay at the rate. Snapshotting it
             means switching someone between pay types later can never make
             old fee-covered hours payable. */
          const basisOf = (e) => (e.timesheet_workers && e.timesheet_workers.pay_type === 'monthly' && !e.is_extra)
            ? 'fee' : 'hourly';

          /* A fee-covered entry approved after its month's fee was already
             paid goes straight to paid under that fee's batch — otherwise it
             would sit as "approved" forever with nothing left to pay it. */
          const feeEntries = cur.filter(e => basisOf(e) === 'fee');
          const paidFee = {};
          if (feeEntries.length) {
            const wids = [...new Set(feeEntries.map(e => e.worker_id))].map(encodeURIComponent).join(',');
            const fpR = await fetch(
              `${SB}/rest/v1/timesheet_fee_payments?worker_id=in.(${wids})&select=worker_id,period,paid_batch`,
              { headers: H });
            const fps = await fpR.json().catch(() => []);
            (Array.isArray(fps) ? fps : []).forEach(p => {
              paidFee[p.worker_id + '|' + String(p.period).slice(0, 7)] = p.paid_batch || String(p.period).slice(0, 7);
            });
          }

          let failed = 0;
          for (const e of cur) {
            const basis = basisOf(e);
            const patch = {
              status: 'approved',
              pay_basis: basis,
              rate_snapshot: basis === 'fee' ? null
                : (e.timesheet_workers ? e.timesheet_workers.hourly_rate : 0),
              approved_by: who, approved_at: now,
              reject_reason: null, updated_at: now
            };
            const late = basis === 'fee' && paidFee[e.worker_id + '|' + String(e.work_date).slice(0, 7)];
            if (late) { patch.status = 'paid'; patch.paid_batch = late; }
            const aR = await fetch(`${SB}/rest/v1/timesheet_entries?id=eq.${encodeURIComponent(e.id)}`, {
              method: 'PATCH', headers: H, body: JSON.stringify(patch)
            });
            if (!aR.ok) failed++;
          }
          if (failed) {
            return cors(new Response(JSON.stringify({
              error: failed + ' of ' + cur.length + ' entries could not be approved. Refresh and try again.'
            }), { status: 500 }));
          }
          return cors(new Response(JSON.stringify({ ok: true, count: cur.length }), { status: 200 }));
        }

        case 'timesheet.reject': {
          const ids = Array.isArray(payload && payload.ids) ? payload.ids.slice(0, 200) : [];
          const why = String((payload && payload.reason) || '').replace(/[<>]/g, '').trim().slice(0, 300);
          if (!ids.length) return cors(new Response(JSON.stringify({ error: 'Nothing to reject.' }), { status: 400 }));
          if (!why)       return cors(new Response(JSON.stringify({ error: 'Give a reason so it can be corrected.' }), { status: 400 }));
          const list = ids.map(encodeURIComponent).join(',');
          const rjR = await fetch(`${SB}/rest/v1/timesheet_entries?id=in.(${list})&status=eq.submitted`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({
              status: 'rejected', reject_reason: why,
              approved_by: String(body._claims.name || '').slice(0, 60),
              approved_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
          });
          return cors(new Response(JSON.stringify({ ok: rjR.ok }), { status: rjR.ok ? 200 : rjR.status }));
        }

        /* ── Workers + payment ──────────────────────────────── */

        case 'timesheet.workers': {
          const wR = await fetch(
            `${SB}/rest/v1/timesheet_workers?select=*&order=active.desc,name.asc`, { headers: H });
          return cors(new Response(await wR.text(), { status: wR.status }));
        }

        case 'timesheet.saveWorker': {
          const d = (payload && payload.data) || {};
          const clean = (s, n) => String(s == null ? '' : s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
          const name = clean(d.name, 80);
          if (!name) return cors(new Response(JSON.stringify({ error: 'A name is required.' }), { status: 400 }));
          const row = {
            name,
            job_title: clean(d.job_title, 60) || null,
            admin_user_id: d.admin_user_id ? String(d.admin_user_id) : null,
            hourly_rate: Math.max(0, Math.min(100000, parseFloat(d.hourly_rate) || 0)),
            pay_type: d.pay_type === 'monthly' ? 'monthly' : 'hourly',
            monthly_fee: null,
            active: d.active !== false
          };
          /* The table's check constraint also enforces this pairing; checking
             here gives a readable message instead of a database error. */
          if (row.pay_type === 'monthly') {
            const fee = Math.round((parseFloat(d.monthly_fee) || 0) * 100) / 100;
            if (!(fee > 0) || fee > 1000000) {
              return cors(new Response(JSON.stringify({ error: 'Enter the monthly fee.' }), { status: 400 }));
            }
            row.monthly_fee = fee;
          }
          const wH = Object.assign({}, H, { 'Prefer': 'return=representation' });
          const wid = String(d.id || '');
          const r = wid
            ? await fetch(`${SB}/rest/v1/timesheet_workers?id=eq.${encodeURIComponent(wid)}`, {
                method: 'PATCH', headers: wH, body: JSON.stringify(row) })
            : await fetch(`${SB}/rest/v1/timesheet_workers`, {
                method: 'POST', headers: wH, body: JSON.stringify([row]) });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        /* The payment run.
             Hourly section — approved hours x snapshotted rate, per person.
             This includes a monthly person's EXTRA hours.
             Fees section   — one proposed line per monthly person per calendar
             month the range touches, unless that month is already paid. The
             approver confirms or adjusts each amount before marking it paid. */
        case 'timesheet.summary': {
          const iso = /^\d{4}-\d{2}-\d{2}$/;
          const from = iso.test(String(payload?.from || '')) ? payload.from : null;
          const to   = iso.test(String(payload?.to   || '')) ? payload.to   : null;
          if (!from || !to || from > to) {
            return cors(new Response(JSON.stringify({ error: 'Pick a from and to date.' }), { status: 400 }));
          }
          const monthsBetween = (a, b) => {
            const out = []; let y = +a.slice(0, 4), m = +a.slice(5, 7);
            const ey = +b.slice(0, 4), em = +b.slice(5, 7);
            while (y < ey || (y === ey && m <= em)) {
              out.push(y + '-' + String(m).padStart(2, '0'));
              if (++m > 12) { m = 1; y++; }
            }
            return out;
          };
          const months = monthsBetween(from, to);
          if (months.length > 24) {
            return cors(new Response(JSON.stringify({ error: 'Pick a range of 24 months or less.' }), { status: 400 }));
          }
          const incPaid = !!(payload && payload.includePaid);
          const statuses = incPaid ? 'approved,paid' : 'approved';

          const sR = await fetch(
            `${SB}/rest/v1/timesheet_entries?status=in.(${statuses})` +
            `&work_date=gte.${from}&work_date=lte.${to}` +
            `&select=id,worker_id,work_date,hours,rate_snapshot,status,paid_batch,pay_basis,is_extra,` +
            `timesheet_workers(id,name,job_title)` +
            `&order=work_date.asc`, { headers: H });
          const rows = await sR.json().catch(() => []);
          const entries = Array.isArray(rows) ? rows : [];

          /* ── hourly ── (a null basis is an entry approved by the previous
             Worker between the migration and this deploy — it was hourly) */
          const byWorker = {};
          entries.filter(e => e.pay_basis !== 'fee').forEach(e => {
            const w = e.timesheet_workers || { id: 'unknown', name: 'Unknown' };
            const b = byWorker[w.id] || (byWorker[w.id] = {
              worker_id: w.id, name: w.name, job_title: w.job_title,
              hours: 0, amount: 0, entries: 0, extra: false, ids: []
            });
            const hrs = Number(e.hours) || 0;
            const rate = Number(e.rate_snapshot) || 0;
            b.hours   = Math.round((b.hours + hrs) * 100) / 100;
            b.amount  = Math.round((b.amount + hrs * rate) * 100) / 100;
            b.entries += 1;
            if (e.is_extra) b.extra = true;
            b.ids.push(e.id);
          });
          const list = Object.keys(byWorker).map(k => byWorker[k])
            .sort((a, b) => a.name.localeCompare(b.name));
          const hourlyTotal = Math.round(list.reduce((sum, w) => sum + w.amount, 0) * 100) / 100;

          /* ── fees ── */
          const fmR = await fetch(
            `${SB}/rest/v1/timesheet_workers?pay_type=eq.monthly` +
            `&select=id,name,job_title,monthly_fee,active,admin_user_id,created_at&order=name.asc`, { headers: H });
          const monthly = await fmR.json().catch(() => []);
          const fpR = await fetch(
            `${SB}/rest/v1/timesheet_fee_payments?period=gte.${months[0]}-01&period=lte.${months[months.length - 1]}-01` +
            `&select=worker_id,period,proposed_fee,amount,adjust_reason,paid_batch,paid_by,paid_at`, { headers: H });
          const paidRows = await fpR.json().catch(() => []);
          const paidMap = {};
          (Array.isArray(paidRows) ? paidRows : []).forEach(p => { paidMap[p.worker_id + '|' + String(p.period).slice(0, 7)] = p; });

          /* Logged hours per person per month, as the record of what the fee bought. */
          const feeHours = {};
          entries.filter(e => e.pay_basis === 'fee').forEach(e => {
            const k = e.worker_id + '|' + String(e.work_date).slice(0, 7);
            const f = feeHours[k] || (feeHours[k] = { hours: 0, entries: 0 });
            f.hours = Math.round((f.hours + (Number(e.hours) || 0)) * 100) / 100;
            f.entries += 1;
          });

          const fees = [], feesPaid = [];
          (Array.isArray(monthly) ? monthly : []).forEach(w => {
            const startMonth = String(w.created_at || '').slice(0, 7);
            months.forEach(mo => {
              const k = w.id + '|' + mo;
              const logged = feeHours[k] || { hours: 0, entries: 0 };
              const paid = paidMap[k];
              const base = {
                worker_id: w.id, name: w.name, job_title: w.job_title,
                period: mo + '-01', hours_logged: logged.hours, entries: logged.entries,
                own: !!(w.admin_user_id && w.admin_user_id === body._claims.sub)
              };
              if (paid) {
                feesPaid.push(Object.assign(base, {
                  proposed_fee: Number(paid.proposed_fee), amount: Number(paid.amount),
                  adjust_reason: paid.adjust_reason, paid_batch: paid.paid_batch,
                  paid_by: paid.paid_by, paid_at: paid.paid_at
                }));
                return;
              }
              /* Nothing before the month they were added. An inactive person
                 is only proposed for a month they have hours in (a leaver's
                 final month); otherwise retiring someone stops their fee. */
              if (startMonth && mo < startMonth) return;
              if (!w.active && !logged.entries) return;
              fees.push(Object.assign(base, { proposed_fee: Number(w.monthly_fee) || 0 }));
            });
          });
          const byName = (a, b) => a.name.localeCompare(b.name) || a.period.localeCompare(b.period);
          fees.sort(byName); feesPaid.sort(byName);
          const feeTotal = Math.round(fees.reduce((sum, f) => sum + f.proposed_fee, 0) * 100) / 100;

          return cors(new Response(JSON.stringify({
            from, to,
            workers: list, hourlyTotal,
            fees, feesPaid, feeTotal,
            total: Math.round((hourlyTotal + feeTotal) * 100) / 100
          }), { status: 200 }));
        }

        /* Close off a payment run so the same hours cannot be paid twice. */
        case 'timesheet.markPaid': {
          const ids = Array.isArray(payload && payload.ids) ? payload.ids.slice(0, 1000) : [];
          const batch = String((payload && payload.batch) || '').replace(/[<>]/g, '').trim().slice(0, 40)
                        || new Date().toISOString().slice(0, 7);
          if (!ids.length) return cors(new Response(JSON.stringify({ error: 'Nothing to mark.' }), { status: 400 }));
          const list = ids.map(encodeURIComponent).join(',');
          const pR = await fetch(`${SB}/rest/v1/timesheet_entries?id=in.(${list})&status=eq.approved` +
            `&or=(pay_basis.eq.hourly,pay_basis.is.null)`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({ status: 'paid', paid_batch: batch, updated_at: new Date().toISOString() })
          });
          return cors(new Response(JSON.stringify({ ok: pR.ok, batch }), { status: pR.ok ? 200 : pR.status }));
        }

        /* Pay monthly fees. Each line is one person for one month. The amount
           may differ from the fee on record (mid-month starter, leaver), but
           only with a reason, and both figures are kept. The unique
           (worker, period) constraint makes paying a month twice impossible. */
        case 'timesheet.markFeePaid': {
          const lines = Array.isArray(payload && payload.lines) ? payload.lines.slice(0, 200) : [];
          const batch = String((payload && payload.batch) || '').replace(/[<>]/g, '').trim().slice(0, 40)
                        || new Date().toISOString().slice(0, 7);
          if (!lines.length) return cors(new Response(JSON.stringify({ error: 'No fees to mark.' }), { status: 400 }));

          const wids = [...new Set(lines.map(l => String(l.worker_id || '')))].filter(Boolean);
          const wR = await fetch(
            `${SB}/rest/v1/timesheet_workers?id=in.(${wids.map(encodeURIComponent).join(',')})` +
            `&select=id,name,pay_type,monthly_fee,admin_user_id`, { headers: H });
          const ws = await wR.json().catch(() => []);
          const wmap = {};
          (Array.isArray(ws) ? ws : []).forEach(w => { wmap[w.id] = w; });

          /* Validate every line before writing anything. */
          const who = String(body._claims.name || '').slice(0, 60);
          const rows = [];
          const seen = new Set();
          for (const l of lines) {
            const w = wmap[String(l.worker_id || '')];
            const period = String(l.period || '');
            if (!w || w.pay_type !== 'monthly') {
              return cors(new Response(JSON.stringify({ error: 'One of these people is no longer on a monthly fee. Recalculate the run.' }), { status: 409 }));
            }
            if (!/^\d{4}-\d{2}-01$/.test(period)) {
              return cors(new Response(JSON.stringify({ error: 'Invalid month.' }), { status: 400 }));
            }
            if (seen.has(w.id + '|' + period)) continue;
            seen.add(w.id + '|' + period);
            /* Same rule as approving hours: nobody pays themselves. */
            if (w.admin_user_id && w.admin_user_id === body._claims.sub) {
              return cors(new Response(JSON.stringify({
                error: 'You cannot mark your own fee as paid. Ask another approver.'
              }), { status: 403 }));
            }
            const proposed = Math.round((Number(w.monthly_fee) || 0) * 100) / 100;
            const amount = Math.round((parseFloat(l.amount)) * 100) / 100;
            if (!isFinite(amount) || amount < 0 || amount > 1000000) {
              return cors(new Response(JSON.stringify({ error: 'Check the amount for ' + w.name + '.' }), { status: 400 }));
            }
            const reason = String(l.reason || '').replace(/[<>]/g, '').trim().slice(0, 200);
            if (amount !== proposed && !reason) {
              return cors(new Response(JSON.stringify({
                error: 'Give a reason for changing ' + w.name + '\'s fee from R' + proposed.toFixed(2) + '.'
              }), { status: 400 }));
            }
            rows.push({
              worker_id: w.id, period, proposed_fee: proposed, amount,
              adjust_reason: amount !== proposed ? reason : null,
              paid_batch: batch, paid_by: who
            });
          }

          /* One insert: all lines land, or none do. */
          const iR = await fetch(`${SB}/rest/v1/timesheet_fee_payments`, {
            method: 'POST', headers: Object.assign({}, H, { 'Prefer': 'return=minimal' }),
            body: JSON.stringify(rows)
          });
          if (iR.status === 409) {
            return cors(new Response(JSON.stringify({
              error: 'One of these months has already been paid. Recalculate the run.'
            }), { status: 409 }));
          }
          if (!iR.ok) return cors(new Response(await iR.text(), { status: iR.status }));

          /* Close off the hours each fee covered, so they read as paid too. */
          const now = new Date().toISOString();
          for (const r of rows) {
            const y = +r.period.slice(0, 4), m = +r.period.slice(5, 7);
            const last = r.period.slice(0, 8) + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
            await fetch(
              `${SB}/rest/v1/timesheet_entries?worker_id=eq.${encodeURIComponent(r.worker_id)}` +
              `&status=eq.approved&pay_basis=eq.fee&work_date=gte.${r.period}&work_date=lte.${last}`, {
                method: 'PATCH', headers: H,
                body: JSON.stringify({ status: 'paid', paid_batch: batch, updated_at: now })
              });
          }
          return cors(new Response(JSON.stringify({ ok: true, count: rows.length, batch }), { status: 200 }));
        }

        case 'events.list': {
          const evFrom = String((payload && payload.from) || '').slice(0, 10);
          const evTo   = String((payload && payload.to)   || '').slice(0, 10);
          let evQ = `${SB}/rest/v1/club_events?select=*&order=start_date.asc`;
          if (/^\d{4}-\d{2}-\d{2}$/.test(evFrom)) evQ += `&start_date=gte.${evFrom}`;
          if (/^\d{4}-\d{2}-\d{2}$/.test(evTo))   evQ += `&start_date=lte.${evTo}`;
          const evR = await fetch(evQ, { headers: H });
          return cors(new Response(await evR.text(), { status: evR.status }));
        }

        case 'events.publicList': {
          // PUBLIC: only events explicitly flagged is_public. No birthdays,
          // no internal committee events, no created_by.
          const pFrom = String((payload && payload.from) || '').slice(0, 10);
          const pTo   = String((payload && payload.to)   || '').slice(0, 10);
          let pQ = `${SB}/rest/v1/club_events?select=id,title,description,event_type,start_date,end_date,start_time,end_time,venue,image_url,image_pos&is_public=is.true&order=start_date.asc`;
          if (/^\d{4}-\d{2}-\d{2}$/.test(pFrom)) pQ += `&start_date=gte.${pFrom}`;
          if (/^\d{4}-\d{2}-\d{2}$/.test(pTo))   pQ += `&start_date=lte.${pTo}`;
          const pR = await fetch(pQ, { headers: H });
          return cors(new Response(await pR.text(), { status: pR.status }));
        }

        case 'events.insert':
        case 'events.update': {
          const d = (payload && payload.data) || {};
          const cleanEv = (s, max) => String(s == null ? '' : s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
          const EV_TYPES = ['social', 'meeting', 'training', 'fixture', 'other'];
          const evTitle = cleanEv(d.title, 120);
          const evStart = String(d.start_date || '').slice(0, 10);
          if (!evTitle || !/^\d{4}-\d{2}-\d{2}$/.test(evStart)) {
            return cors(new Response(JSON.stringify({ error: 'A title and a valid date are required.' }), { status: 400 }));
          }
          const evTime = (x) => /^\d{2}:\d{2}$/.test(String(x || '')) ? String(x) : null;
          const row = {
            title:       evTitle,
            description: cleanEv(d.description, 1000) || null,
            event_type:  EV_TYPES.indexOf(d.event_type) >= 0 ? d.event_type : 'other',
            start_date:  evStart,
            end_date:    /^\d{4}-\d{2}-\d{2}$/.test(String(d.end_date || '')) ? String(d.end_date).slice(0, 10) : null,
            start_time:  evTime(d.start_time),
            end_time:    evTime(d.end_time),
            venue:       cleanEv(d.venue, 120) || null,
            is_public:   !!d.is_public,
            image_url:   /^https:\/\//.test(String(d.image_url || '')) ? String(d.image_url).slice(0, 500) : null,
            image_pos:   (function(s){ var m=/^(\d{1,3})% (\d{1,3})%$/.exec(String(s||'')); if(!m)return '50% 50%'; return Math.max(0,Math.min(100,+m[1]))+'% '+Math.max(0,Math.min(100,+m[2]))+'%'; })(d.image_pos),
          };
          const evH = Object.assign({}, H, { 'Prefer': 'return=representation' });
          if (action === 'events.insert') {
            row.created_by = cleanEv((body._claims && body._claims.name) || '', 60) || null;
            const iR = await fetch(`${SB}/rest/v1/club_events`, {
              method: 'POST', headers: evH, body: JSON.stringify([row])
            });
            return cors(new Response(await iR.text(), { status: iR.status }));
          }
          const evId = String(d.id || '');
          if (!evId) return cors(new Response(JSON.stringify({ error: 'Missing event id' }), { status: 400 }));
          const uR = await fetch(`${SB}/rest/v1/club_events?id=eq.${encodeURIComponent(evId)}`, {
            method: 'PATCH', headers: evH, body: JSON.stringify(row)
          });
          return cors(new Response(await uR.text(), { status: uR.status }));
        }

        case 'events.delete': {
          const delId = String((payload && payload.id) || '');
          if (!delId) return cors(new Response(JSON.stringify({ error: 'Missing event id' }), { status: 400 }));
          const dR = await fetch(`${SB}/rest/v1/club_events?id=eq.${encodeURIComponent(delId)}`, { method: 'DELETE', headers: H });
          return cors(new Response(await dR.text(), { status: dR.status }));
        }

        case 'birthday.today': {
          const bDate = /^\d{4}-\d{2}-\d{2}$/.test(String((payload && payload.date) || ''))
            ? String(payload.date) : sastDateStr();
          const people = await fetchBirthdaysFor(SB, H, bDate);
          return cors(new Response(JSON.stringify({
            date: bDate,
            people: people,
            message: people.length ? birthdayMessage(people.map(p => p.name)) : ''
          }), { status: 200 }));
        }
        case 'calendar.feed': {
          const cFrom = String((payload && payload.from) || '').slice(0, 10);
          const cTo   = String((payload && payload.to)   || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(cFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(cTo)) {
            return cors(new Response(JSON.stringify({ error: 'from and to (YYYY-MM-DD) are required.' }), { status: 400 }));
          }
          const items = [];
          const jsonOr = async (res) => { try { return await res.json(); } catch (e) { return []; } };

          try {
            const fR = await fetch(`${SB}/rest/v1/fixtures?select=id,date,team,opponent,venue,division,tournament_id&date=gte.${cFrom}&date=lte.${cTo}`, { headers: H });
            for (const f of await jsonOr(fR)) {
              /* A tournament the club hosts has matches between other clubs in
                 it. Those belong on the tournament page, not in the club's own
                 calendar — so a tournament fixture is carried here only when
                 the club is playing in it. */
              if (f.tournament_id && !isClubFixture(f)) continue;
              items.push({ kind: 'fixture', id: f.id, date: String(f.date || '').slice(0, 10),
                title: (f.team ? f.team + ' v ' : 'v ') + (f.opponent || 'TBC'),
                venue: f.venue || null, meta: f.division || null });
            }
          } catch (e) { /* non-fatal: one source failing must not blank the calendar */ }

          try {
            const tR = await fetch(`${SB}/rest/v1/coach_training_sessions?select=id,session_date,venue,focus&session_date=gte.${cFrom}&session_date=lte.${cTo}`, { headers: H });
            for (const s of await jsonOr(tR)) {
              items.push({ kind: 'training', id: s.id, date: String(s.session_date || '').slice(0, 10),
                title: s.focus ? 'Training \u2014 ' + s.focus : 'Training session',
                venue: s.venue || null, meta: null });
            }
          } catch (e) { /* non-fatal */ }

          try {
            const eR = await fetch(`${SB}/rest/v1/club_events?select=*&start_date=gte.${cFrom}&start_date=lte.${cTo}`, { headers: H });
            for (const ev of await jsonOr(eR)) {
              items.push({ kind: 'event', id: ev.id, date: String(ev.start_date || '').slice(0, 10),
                title: ev.title, venue: ev.venue || null, meta: ev.event_type || 'other',
                is_public: !!ev.is_public, start_time: ev.start_time || null,
                end_time: ev.end_time || null, description: ev.description || null,
                image_url: ev.image_url || null, image_pos: ev.image_pos || '50% 50%' });
            }
          } catch (e) { /* non-fatal */ }

          try {
            const bR = await fetch(`${SB}/rest/v1/players?select=id,name,dob&dob=not.is.null&active=not.eq.false`, { headers: H });
            const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
            const y0 = Number(cFrom.slice(0, 4)), y1 = Number(cTo.slice(0, 4));
            for (const p of await jsonOr(bR)) {
              const dob = String(p.dob || '').slice(0, 10);
              if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) continue;
              const mmdd = dob.slice(5);
              for (let y = y0; y <= y1; y++) {
                const md = (mmdd === '02-29' && !isLeap(y)) ? '02-28' : mmdd;
                const ds = y + '-' + md;
                if (ds >= cFrom && ds <= cTo) {
                  items.push({ kind: 'birthday', id: p.id, date: ds, title: p.name,
                    meta: String(y - Number(dob.slice(0, 4))) });
                }
              }
            }
          } catch (e) { /* non-fatal */ }

          items.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
          return cors(new Response(JSON.stringify({ items }), { status: 200 }));
        }
        /* ── AGREEMENTS ──────────────────────────────────────────
           Its own table, its own roles, its own expiry. The PDF lives in a
           private bucket and is only ever handed out behind a URL that
           lasts five minutes. */
        case 'agreement.uploadFile': {
          const { fileName, base64 } = payload || {};
          if (!base64) return cors(new Response(JSON.stringify({ error: 'No file' }), { status: 400 }));
          /* base64 is ~4/3 of the bytes; 15 MB of PDF is the bucket's limit. */
          if (base64.length > 21000000) {
            return cors(new Response(JSON.stringify({ error: 'That file is too big — 15 MB is the limit.' }), { status: 400 }));
          }
          const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          /* A PDF starts %PDF-. Anything else is not what it claims. */
          if (!(binary[0] === 0x25 && binary[1] === 0x50 && binary[2] === 0x44 && binary[3] === 0x46)) {
            return cors(new Response(JSON.stringify({ error: 'That does not look like a PDF.' }), { status: 400 }));
          }
          const hashBuf = await crypto.subtle.digest('SHA-256', binary);
          const fileHash = Array.from(new Uint8Array(hashBuf))
            .map(b => b.toString(16).padStart(2, '0')).join('');
          const safe = String(fileName || 'agreement.pdf').replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
          const key = new Date().getFullYear() + '/' + wToken().slice(0, 16) + '-' + safe;
          const up = await fetch(`${SB}/storage/v1/object/agreements/${key}`, {
            method: 'POST',
            headers: { apikey: KEY, Authorization: 'Bearer ' + KEY,
                       'Content-Type': 'application/pdf', 'x-upsert': 'false' },
            body: binary
          });
          if (!up.ok) {
            return cors(new Response(JSON.stringify({ error: 'The file could not be stored. ' + (await up.text()) }), { status: 500 }));
          }
          return cors(new Response(JSON.stringify({
            ok: true, path: key, name: safe, hash: fileHash, size: binary.length
          }), { headers: { 'Content-Type': 'application/json' } }));
        }

        case 'agreement.create': {
          const p = payload || {};
          const v = agValidateCreate(p);
          if (v.error) return cors(new Response(JSON.stringify({ error: v.error }), { status: 400 }));

          const year = new Date().getFullYear();
          const lastR = await fetch(
            `${SB}/rest/v1/agreements?select=ref&ref=like.TCC-A-${year}-*&order=ref.desc&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const lastRows = await lastR.json().catch(() => []);
          const ref = agNextRef(year, (lastRows && lastRows[0] && lastRows[0].ref) || null);
          const nowIso = new Date().toISOString();
          const days = Math.min(90, Math.max(1, parseInt(p.link_days, 10) || 14));
          const expires = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

          const row = Object.assign({
            token: wToken(), ref, title: String(p.title).trim(), status: 'open',
            confidential: p.confidential !== false,
            party_name: String(p.party_name).trim(),
            party_role: p.party_role || null,
            doc_text: p.doc_text,
            doc_hash: await wHash(p.doc_text),
            file_path: p.file_path || null,
            file_name: p.file_name || null,
            file_hash: p.file_hash || null,
            file_size: p.file_size || null,
            place: p.place || null,
            issued_by: String(p.issued_by).trim(),
            issued_role: p.issued_role || null,
            issued_on: p.issued_on || nowIso.slice(0, 10),
            club_signed_at: nowIso,
            link_expires_on: expires,
            retain_until: p.retain_until || null
          }, v.club);

          const ins = await fetch(`${SB}/rest/v1/agreements`, {
            method: 'POST',
            headers: Object.assign({}, H, { Prefer: 'return=representation' }),
            body: JSON.stringify([row])
          });
          if (!ins.ok) {
            return cors(new Response(JSON.stringify({ error: await ins.text() }), { status: 500 }));
          }
          const made = (await ins.json())[0] || {};
          return cors(new Response(JSON.stringify({
            ok: true, token: made.token, ref: made.ref, id: made.id,
            link_expires_on: made.link_expires_on
          }), { headers: { 'Content-Type': 'application/json' } }));
        }

        // PUBLIC — one token, one agreement, and only while the link lives
        case 'agreement.get': {
          const t = String((payload || {}).token || '');
          if (t.length < 20) return cors(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
          const r = await fetch(
            `${SB}/rest/v1/agreements?token=eq.${encodeURIComponent(t)}&select=*&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const rows = await r.json().catch(() => []);
          const row = rows && rows[0];
          const bad = agLinkProblem(row);
          if (bad) return cors(new Response(JSON.stringify({ error: bad.error }), { status: bad.status }));
          return cors(new Response(JSON.stringify({ ok: true, agreement: agPublic(row) }),
            { headers: { 'Content-Type': 'application/json' } }));
        }

        // PUBLIC — a link to the original PDF that lasts five minutes
        case 'agreement.fileUrl': {
          const t = String((payload || {}).token || '');
          if (t.length < 20) return cors(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
          const r = await fetch(
            `${SB}/rest/v1/agreements?token=eq.${encodeURIComponent(t)}&select=file_path&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const rows = await r.json().catch(() => []);
          const row = rows && rows[0];
          const bad = agLinkProblem(row);
          if (bad) return cors(new Response(JSON.stringify({ error: bad.error }), { status: bad.status }));
          if (!row.file_path) return cors(new Response(JSON.stringify({ error: 'No file' }), { status: 404 }));
          return cors(await agSignedUrl(SB, KEY, row.file_path));
        }

        // PUBLIC — signs once and never again
        case 'agreement.sign': {
          const p = payload || {};
          const t = String(p.token || '');
          if (t.length < 20) return cors(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
          const r = await fetch(
            `${SB}/rest/v1/agreements?token=eq.${encodeURIComponent(t)}&select=*&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const rows = await r.json().catch(() => []);
          const row = rows && rows[0];
          const v = agValidateSign(row, p);
          if (v.error) return cors(new Response(JSON.stringify({ error: v.error }), { status: 400 }));

          const now = new Date().toISOString();
          const patch = Object.assign({
            status: 'signed',
            party_signed_at: now,
            party_note: String(p.party_note || '').trim() || null,
            sign_ip: request.headers.get('CF-Connecting-IP') ||
                     request.headers.get('X-Forwarded-For') || null,
            sign_agent: (request.headers.get('User-Agent') || '').slice(0, 300) || null,
            updated_at: now
          }, v.party);

          const up = await fetch(
            `${SB}/rest/v1/agreements?token=eq.${encodeURIComponent(t)}&status=eq.open`, {
              method: 'PATCH',
              headers: Object.assign({}, H, { Prefer: 'return=representation' }),
              body: JSON.stringify(patch)
            });
          const done = await up.json().catch(() => []);
          if (!up.ok || !done.length) {
            return cors(new Response(JSON.stringify({ error: 'This agreement has already been signed.' }),
              { status: 409 }));
          }
          return cors(new Response(JSON.stringify({ ok: true, agreement: agPublic(done[0]) }),
            { headers: { 'Content-Type': 'application/json' } }));
        }

        case 'agreement.list': {
          const q = (payload || {}).status;
          const filter = q && q !== 'all' ? `&status=eq.${encodeURIComponent(q)}` : '';
          const r = await fetch(
            `${SB}/rest/v1/agreements?select=id,ref,token,title,status,party_name,party_role,` +
            `issued_by,issued_on,party_signed_at,party_note,link_expires_on,retain_until,` +
            `file_name,void_reason,confidential&order=created_at.desc&limit=200${filter}`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          return cors(new Response(await r.text(),
            { status: r.status, headers: { 'Content-Type': 'application/json' } }));
        }

        case 'agreement.one': {
          const id = parseInt((payload || {}).id, 10);
          if (!id) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          const r = await fetch(`${SB}/rest/v1/agreements?id=eq.${id}&select=*&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const rows = await r.json().catch(() => []);
          if (!rows.length) return cors(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
          return cors(new Response(JSON.stringify({ ok: true, agreement: rows[0] }),
            { headers: { 'Content-Type': 'application/json' } }));
        }

        case 'agreement.fileAdmin': {
          const id = parseInt((payload || {}).id, 10);
          if (!id) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          const r = await fetch(`${SB}/rest/v1/agreements?id=eq.${id}&select=file_path&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const rows = await r.json().catch(() => []);
          if (!rows.length || !rows[0].file_path) {
            return cors(new Response(JSON.stringify({ error: 'No file' }), { status: 404 }));
          }
          return cors(await agSignedUrl(SB, KEY, rows[0].file_path));
        }

        case 'agreement.void': {
          const { id, reason } = payload || {};
          if (!id) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          const r = await fetch(`${SB}/rest/v1/agreements?id=eq.${id}`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({ status: 'void', voided_at: new Date().toISOString(),
                                   void_reason: reason || null, updated_at: new Date().toISOString() })
          });
          return cors(new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : 500 }));
        }

        case 'agreement.delete': {
          const id = parseInt((payload || {}).id, 10);
          if (!id) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          /* Take the file with it — a deleted agreement whose PDF is still
             in the bucket has not really been deleted. */
          const got = await fetch(`${SB}/rest/v1/agreements?id=eq.${id}&select=file_path&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const rows = await got.json().catch(() => []);
          if (rows.length && rows[0].file_path) {
            await fetch(`${SB}/storage/v1/object/agreements/${rows[0].file_path}`,
              { method: 'DELETE', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
              .catch(() => {});
          }
          const r = await fetch(`${SB}/rest/v1/agreements?id=eq.${id}`, { method: 'DELETE', headers: H });
          return cors(new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : 500 }));
        }

        /* ── PLAYER WARNINGS ─────────────────────────────────────
           A disciplinary document raised by the club, signed by the player
           through a link. Two of these are public because the player has no
           account; the token is what stands in for one. */
        case 'warning.create': {
          const p = payload || {};
          const v = wValidateCreate(p);
          if (v.error) return cors(new Response(JSON.stringify({ error: v.error }), { status: 400 }));

          const year  = new Date().getFullYear();
          const lastR = await fetch(
            `${SB}/rest/v1/player_warnings?select=ref&ref=like.TCC-W-${year}-*&order=ref.desc&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const lastRows = await lastR.json().catch(() => []);
          const ref   = wNextRef(year, (lastRows && lastRows[0] && lastRows[0].ref) || null);
          const token = wToken();
          const hash  = await wHash(p.doc_text);
          const nowIso = new Date().toISOString();

          const row = {
            token, ref, level: p.level, status: 'open',
            player_name: String(p.player_name).trim(),
            player_team: p.player_team || null,
            is_minor: !!p.is_minor,
            guardian_name: p.is_minor ? String(p.guardian_name).trim() : null,
            incident_on: p.incident_on || null,
            incident_place: p.incident_place || null,
            incident_text: String(p.incident_text).trim(),
            code_ref: p.code_ref || null,
            expected_text: p.expected_text || null,
            consequence_text: p.consequence_text || null,
            sanction_text: p.sanction_text || null,
            suspend_from: p.suspend_from || null,
            suspend_to: p.suspend_to || null,
            suspend_matches: p.suspend_matches || null,
            hearing_at: p.hearing_at || null,
            hearing_place: p.hearing_place || null,
            record_months: p.record_months || 12,
            appeal_days: p.appeal_days || 7,
            issued_by: String(p.issued_by).trim(),
            issued_role: p.issued_role || null,
            issued_on: p.issued_on || nowIso.slice(0, 10),
            official_signature: v.official.official_signature,
            official_signature_type: v.official.official_signature_type,
            official_signature_data: v.official.official_signature_data,
            official_signed_at: nowIso,
            doc_text: p.doc_text, doc_hash: hash
          };
          const ins = await fetch(`${SB}/rest/v1/player_warnings`, {
            method: 'POST',
            headers: Object.assign({}, H, { Prefer: 'return=representation' }),
            body: JSON.stringify([row])
          });
          if (!ins.ok) {
            return cors(new Response(JSON.stringify({ error: await ins.text() }), { status: 500 }));
          }
          const made = (await ins.json())[0] || {};
          return cors(new Response(
            JSON.stringify({ ok: true, token: made.token, ref: made.ref, id: made.id }),
            { headers: { 'Content-Type': 'application/json' } }));
        }

        // PUBLIC — one token, one document
        case 'warning.get': {
          const t = String((payload || {}).token || '');
          if (t.length < 20) return cors(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
          const r = await fetch(
            `${SB}/rest/v1/player_warnings?token=eq.${encodeURIComponent(t)}&select=*&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const rows = await r.json().catch(() => []);
          const row  = rows && rows[0];
          if (!row) return cors(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
          if (row.status === 'void') {
            return cors(new Response(
              JSON.stringify({ error: 'This document has been withdrawn by the club.' }), { status: 410 }));
          }
          return cors(new Response(JSON.stringify({ ok: true, warning: wPublic(row) }),
            { headers: { 'Content-Type': 'application/json' } }));
        }

        // PUBLIC — signs once and never again
        case 'warning.sign': {
          const p = payload || {};
          const t = String(p.token || '');
          if (t.length < 20) return cors(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
          const r = await fetch(
            `${SB}/rest/v1/player_warnings?token=eq.${encodeURIComponent(t)}&select=*&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const rows = await r.json().catch(() => []);
          const row  = rows && rows[0];
          const v = wValidateSign(row, p);
          if (v.error) return cors(new Response(JSON.stringify({ error: v.error }), { status: 400 }));

          const now = new Date().toISOString();
          const patch = Object.assign({
            status: 'signed',
            player_signed_at: now
          }, v.player, {
            player_response: String(p.player_response || '').trim() || null,
            sign_ip: request.headers.get('CF-Connecting-IP') ||
                     request.headers.get('X-Forwarded-For') || null,
            sign_agent: (request.headers.get('User-Agent') || '').slice(0, 300) || null,
            updated_at: now
          });
          if (row.is_minor && v.guardian) {
            Object.assign(patch, v.guardian);
            patch.guardian_signed_at = now;
          }
          /* status=eq.open makes this one-shot: a second request finds nothing
             to update, so a double tap cannot overwrite a signature. */
          const up = await fetch(
            `${SB}/rest/v1/player_warnings?token=eq.${encodeURIComponent(t)}&status=eq.open`, {
              method: 'PATCH',
              headers: Object.assign({}, H, { Prefer: 'return=representation' }),
              body: JSON.stringify(patch)
            });
          const done = await up.json().catch(() => []);
          if (!up.ok || !done.length) {
            return cors(new Response(
              JSON.stringify({ error: 'This document has already been signed.' }), { status: 409 }));
          }
          return cors(new Response(JSON.stringify({ ok: true, warning: wPublic(done[0]) }),
            { headers: { 'Content-Type': 'application/json' } }));
        }

        case 'warning.list': {
          const q = (payload || {}).status;
          const filter = q && q !== 'all' ? `&status=eq.${encodeURIComponent(q)}` : '';
          const r = await fetch(
            `${SB}/rest/v1/player_warnings?select=id,ref,token,level,status,player_name,player_team,` +
            `is_minor,incident_on,issued_by,issued_on,player_signed_at,guardian_signed_at,` +
            `player_response,record_months,void_reason&order=created_at.desc&limit=200${filter}`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          return cors(new Response(await r.text(),
            { status: r.status, headers: { 'Content-Type': 'application/json' } }));
        }

        case 'warning.one': {
          const id = parseInt((payload || {}).id, 10);
          if (!id) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          const r = await fetch(`${SB}/rest/v1/player_warnings?id=eq.${id}&select=*&limit=1`,
            { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
          const rows = await r.json().catch(() => []);
          if (!rows.length) return cors(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
          return cors(new Response(JSON.stringify({ ok: true, warning: rows[0] }),
            { headers: { 'Content-Type': 'application/json' } }));
        }

        case 'warning.void': {
          const { id, reason } = payload || {};
          if (!id) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          const r = await fetch(`${SB}/rest/v1/player_warnings?id=eq.${id}`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({ status: 'void', voided_at: new Date().toISOString(),
                                   void_reason: reason || null, updated_at: new Date().toISOString() })
          });
          return cors(new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : 500 }));
        }

        case 'warning.delete': {
          const id = parseInt((payload || {}).id, 10);
          if (!id) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          const r = await fetch(`${SB}/rest/v1/player_warnings?id=eq.${id}`, { method: 'DELETE', headers: H });
          return cors(new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : 500 }));
        }

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

        /* ══════════════ COACHING: MATCHES ══════════════ */
        case 'coaching.insertMatch': {
          if (!isAllowed(body._claims.role, 'coaching.insertMatch')) return forbidden();
          const { id: _cmid, created_by: _cmcb, ...matchData } = payload;
          matchData.created_by = body._claims.name || body._claims.sub;
          matchData.updated_at = new Date().toISOString();
          const cmr = await fetch(`${SB}/rest/v1/coach_matches`, {
            method: 'POST',
            headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify(matchData)
          });
          return cors(new Response(await cmr.text(), { status: cmr.ok ? 200 : 500 }));
        }
        case 'coaching.updateMatch': {
          if (!isAllowed(body._claims.role, 'coaching.updateMatch')) return forbidden();
          const { id: cmId, created_by: _cmcb2, ...matchUpd } = payload;
          if (!cmId) return cors(new Response('Missing id', { status: 400 }));
          matchUpd.updated_at = new Date().toISOString();
          const cmr = await fetch(`${SB}/rest/v1/coach_matches?id=eq.${cmId}`, {
            method: 'PATCH',
            headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify(matchUpd)
          });
          return cors(new Response(await cmr.text(), { status: cmr.ok ? 200 : 500 }));
        }
        case 'coaching.deleteMatch': {
          if (!isAllowed(body._claims.role, 'coaching.deleteMatch')) return forbidden();
          if (!payload.id) return cors(new Response('Missing id', { status: 400 }));
          await fetch(`${SB}/rest/v1/coach_matches?id=eq.${payload.id}`, { method: 'DELETE', headers: H });
          return cors(new Response(null, { status: 204 }));
        }

        /* ══════════════ COACHING: TRAINING SESSIONS ══════════════ */
        case 'coaching.insertSession': {
          if (!isAllowed(body._claims.role, 'coaching.insertSession')) return forbidden();
          const { id: _csid, attendance: csAttend, created_by: _cscb, ...sessData } = payload;
          sessData.created_by = body._claims.name || body._claims.sub;
          sessData.updated_at = new Date().toISOString();
          const csr = await fetch(`${SB}/rest/v1/coach_training_sessions`, {
            method: 'POST',
            headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify(sessData)
          });
          const csSessions = await csr.json();
          const csSessionId = csSessions[0]?.id;
          if (csSessionId && Array.isArray(csAttend) && csAttend.length) {
            const attendRows = csAttend.map(a => ({
              session_id: csSessionId, player_name: a.player_name,
              player_id: a.player_id || null, present: true
            }));
            await fetch(`${SB}/rest/v1/coach_training_attendance`, {
              method: 'POST',
              headers: { ...H, 'Content-Type': 'application/json' },
              body: JSON.stringify(attendRows)
            });
          }
          return cors(new Response(JSON.stringify(csSessions), { status: csr.ok ? 200 : 500 }));
        }
        case 'coaching.updateSession': {
          if (!isAllowed(body._claims.role, 'coaching.updateSession')) return forbidden();
          const { id: csId, attendance: csAttend2, created_by: _cscb2, ...sessUpd } = payload;
          if (!csId) return cors(new Response('Missing id', { status: 400 }));
          sessUpd.updated_at = new Date().toISOString();
          const csr = await fetch(`${SB}/rest/v1/coach_training_sessions?id=eq.${csId}`, {
            method: 'PATCH',
            headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify(sessUpd)
          });
          if (Array.isArray(csAttend2)) {
            await fetch(`${SB}/rest/v1/coach_training_attendance?session_id=eq.${csId}`, { method: 'DELETE', headers: H });
            if (csAttend2.length) {
              await fetch(`${SB}/rest/v1/coach_training_attendance`, {
                method: 'POST',
                headers: { ...H, 'Content-Type': 'application/json' },
                body: JSON.stringify(csAttend2.map(a => ({
                  session_id: csId, player_name: a.player_name,
                  player_id: a.player_id || null, present: true
                })))
              });
            }
          }
          return cors(new Response(await csr.text(), { status: csr.ok ? 200 : 500 }));
        }
        case 'coaching.deleteSession': {
          if (!isAllowed(body._claims.role, 'coaching.deleteSession')) return forbidden();
          if (!payload.id) return cors(new Response('Missing id', { status: 400 }));
          await fetch(`${SB}/rest/v1/coach_training_sessions?id=eq.${payload.id}`, { method: 'DELETE', headers: H });
          return cors(new Response(null, { status: 204 }));
        }

        /* ══════════════ COACHING: PLAYER DEVELOPMENT ══════════════ */
        case 'coaching.insertDev': {
          if (!isAllowed(body._claims.role, 'coaching.insertDev')) return forbidden();
          const { id: _cdid, ...devData } = payload;
          devData.created_by = body._claims.name || body._claims.sub;
          devData.updated_at = new Date().toISOString();
          const cdr = await fetch(`${SB}/rest/v1/coach_player_development`, {
            method: 'POST',
            headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify(devData)
          });
          return cors(new Response(await cdr.text(), { status: cdr.ok ? 200 : 500 }));
        }
        case 'coaching.updateDev': {
          if (!isAllowed(body._claims.role, 'coaching.updateDev')) return forbidden();
          const { id: cdId, created_by: _cdcb, ...devUpd } = payload;
          if (!cdId) return cors(new Response('Missing id', { status: 400 }));
          devUpd.updated_at = new Date().toISOString();
          const cdr = await fetch(`${SB}/rest/v1/coach_player_development?id=eq.${cdId}`, {
            method: 'PATCH',
            headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify(devUpd)
          });
          return cors(new Response(await cdr.text(), { status: cdr.ok ? 200 : 500 }));
        }
        case 'coaching.deleteDev': {
          if (!isAllowed(body._claims.role, 'coaching.deleteDev')) return forbidden();
          if (!payload.id) return cors(new Response('Missing id', { status: 400 }));
          await fetch(`${SB}/rest/v1/coach_player_development?id=eq.${payload.id}`, { method: 'DELETE', headers: H });
          return cors(new Response(null, { status: 204 }));
        }

        /* ══════════════ COACHING: KPI TARGETS ══════════════ */
        case 'coaching.upsertKpi': {
          if (!isAllowed(body._claims.role, 'coaching.upsertKpi')) return forbidden();
          const { id: _ckid, ...kpiData } = payload;
          const ckExisting = await fetch(
            `${SB}/rest/v1/coach_kpi_targets?team_name=eq.${encodeURIComponent(kpiData.team_name)}&season=eq.${encodeURIComponent(kpiData.season)}&select=id`,
            { headers: H }
          ).then(r => r.json());
          let ckr;
          if (ckExisting?.length) {
            ckr = await fetch(`${SB}/rest/v1/coach_kpi_targets?id=eq.${ckExisting[0].id}`, {
              method: 'PATCH',
              headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
              body: JSON.stringify(kpiData)
            });
          } else {
            ckr = await fetch(`${SB}/rest/v1/coach_kpi_targets`, {
              method: 'POST',
              headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
              body: JSON.stringify(kpiData)
            });
          }
          return cors(new Response(await ckr.text(), { status: ckr.ok ? 200 : 500 }));
        }

        case 'coaching.deleteKpi': {
          if (!isAllowed(body._claims.role, 'coaching.deleteKpi')) return forbidden();
          if (!payload.id) return cors(new Response('Missing id', { status: 400 }));
          await fetch(`${SB}/rest/v1/coach_kpi_targets?id=eq.${payload.id}`, { method: 'DELETE', headers: H });
          return cors(new Response(null, { status: 204 }));
        }

        /* ══════════════ COACHING: SKILL MATRIX ══════════════ */
        // Batch-save only the changed cells. Each row is upserted on the
        // (team, player, skill, month) unique key so re-saving a month
        // updates in place rather than duplicating.
        case 'coaching.saveSkills': {
          if (!isAllowed(body._claims.role, 'coaching.saveSkills')) return forbidden();
          const cells = Array.isArray(payload.cells) ? payload.cells : [];
          if (!cells.length) return cors(new Response(JSON.stringify([]), { status: 200 }));
          const who = body._claims.name || body._claims.sub;
          const nowIso = new Date().toISOString();
          const rows = cells
            .filter(c => c && c.player_name && c.skill_name &&
                         c.assessment_month && c.rating >= 1 && c.rating <= 10)
            .map(c => ({
              player_name: c.player_name, skill_name: c.skill_name,
              rating: c.rating, assessment_month: c.assessment_month,
              assessed_by: who, updated_at: nowIso
            }));
          if (!rows.length) return cors(new Response('No valid cells', { status: 400 }));
          const skr = await fetch(
            `${SB}/rest/v1/coach_player_skills?on_conflict=player_name,skill_name,assessment_month`,
            {
              method: 'POST',
              headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation' },
              body: JSON.stringify(rows)
            }
          );
          return cors(new Response(await skr.text(), { status: skr.ok ? 200 : 500 }));
        }

        // Delete a player's ratings for ONE month only (history preserved)
        case 'coaching.deletePlayerSkills': {
          if (!isAllowed(body._claims.role, 'coaching.deletePlayerSkills')) return forbidden();
          if (!payload.player_name || !payload.assessment_month) {
            return cors(new Response('Missing player_name or assessment_month', { status: 400 }));
          }
          await fetch(
            `${SB}/rest/v1/coach_player_skills` +
              `?player_name=eq.${encodeURIComponent(payload.player_name)}` +
              `&assessment_month=eq.${encodeURIComponent(payload.assessment_month)}`,
            { method: 'DELETE', headers: H }
          );
          return cors(new Response(null, { status: 204 }));
        }

        case 'coaching.upsertSkillDef': {
          if (!isAllowed(body._claims.role, 'coaching.upsertSkillDef')) return forbidden();
          const { id: sdId, ...sdData } = payload;
          let sdr;
          if (sdId) {
            sdr = await fetch(`${SB}/rest/v1/coach_skill_definitions?id=eq.${sdId}`, {
              method: 'PATCH',
              headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
              body: JSON.stringify(sdData)
            });
          } else {
            sdr = await fetch(
              `${SB}/rest/v1/coach_skill_definitions?on_conflict=skill_name`,
              {
                method: 'POST',
                headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation' },
                body: JSON.stringify(sdData)
              }
            );
          }
          return cors(new Response(await sdr.text(), { status: sdr.ok ? 200 : 500 }));
        }

        case 'coaching.deleteSkillDef': {
          if (!isAllowed(body._claims.role, 'coaching.deleteSkillDef')) return forbidden();
          if (!payload.id) return cors(new Response('Missing id', { status: 400 }));
          // Soft-delete: deactivate so historical ratings survive
          const ddr = await fetch(`${SB}/rest/v1/coach_skill_definitions?id=eq.${payload.id}`, {
            method: 'PATCH',
            headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ active: false })
          });
          return cors(new Response(null, { status: ddr.ok ? 204 : 500 }));
        }

        /* ══════════════ COACHING: MONTHLY REPORT ══════════════ */
        case 'coaching.saveReport': {
          if (!isAllowed(body._claims.role, 'coaching.saveReport')) return forbidden();
          const { id: _crid, team: _legacyTeam, ...rptData } = payload;
          // Client sends team_name directly; fall back to legacy 'team' field or default
          rptData.team_name    = rptData.team_name || _legacyTeam || 'All Teams';
          rptData.generated_at = new Date().toISOString();
          rptData.generated_by = body._claims.name || body._claims.sub;
          const crExisting = await fetch(
            `${SB}/rest/v1/coach_monthly_reports?month=eq.${encodeURIComponent(rptData.month)}&team_name=eq.${encodeURIComponent(rptData.team_name)}&select=id`,
            { headers: H }
          ).then(r => r.json());
          let crr;
          if (crExisting?.length) {
            crr = await fetch(`${SB}/rest/v1/coach_monthly_reports?id=eq.${crExisting[0].id}`, {
              method: 'PATCH',
              headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
              body: JSON.stringify(rptData)
            });
          } else {
            crr = await fetch(`${SB}/rest/v1/coach_monthly_reports`, {
              method: 'POST',
              headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
              body: JSON.stringify(rptData)
            });
          }
          return cors(new Response(await crr.text(), { status: crr.ok ? 200 : 500 }));
        }

        // ══════════════════════════════════════════════════════
        // PLAYER REGISTRATION (public form → pending queue → M&R review)
        // ══════════════════════════════════════════════════════

        // ── REGISTRATION: submit (public — register.html)
        case 'registration.submit': {
          const r = payload || {};
          const REG_NOTIFY_EMAIL = 'info@tygerbergcc.co.za'; // TODO: swap to M&R secretary's address

          // Honeypot — bots that fill the hidden field get a fake success
          if (r.website) return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));

          // ── Turnstile verification — same pattern as contact.send (no bypass)
          if (!r.turnstileToken) {
            return cors(new Response(JSON.stringify({ error: 'Security check required' }), { status: 403 }));
          }
          const regTv = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: r.turnstileToken })
          });
          const regTvData = await regTv.json();
          if (!regTvData.success) {
            return cors(new Response(JSON.stringify({ error: 'Security check failed' }), { status: 403 }));
          }

          // ── Server-side validation — never trust the client
          const regRequired = ['firstName','surname','dob','email','phone',
                               'batting','role','emergencyName','emergencyPhone'];
          for (const f of regRequired) {
            if (!r[f] || !String(r[f]).trim()) {
              return cors(new Response(JSON.stringify({ error: 'Missing field: ' + f }), { status: 400 }));
            }
          }
          if (!String(r.email).match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            return cors(new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400 }));
          }
          if (r.popiaConsent !== true || r.indemnityConsent !== true) {
            return cors(new Response(JSON.stringify({ error: 'Required consents not given' }), { status: 400 }));
          }

          // ── Minor status recomputed server-side from DOB (client flag not trusted)
          const regDob = new Date(r.dob);
          const regNow = new Date();
          if (isNaN(regDob) || regDob > regNow) {
            return cors(new Response(JSON.stringify({ error: 'Invalid date of birth' }), { status: 400 }));
          }
          let regAge = regNow.getFullYear() - regDob.getFullYear();
          if (regNow.getMonth() < regDob.getMonth() ||
             (regNow.getMonth() === regDob.getMonth() && regNow.getDate() < regDob.getDate())) regAge--;
          const regIsMinor = regAge < 18;

          if (regIsMinor && (!r.guardianName || !r.guardianPhone ||
                             !r.guardianRelationship || r.guardianConsent !== true)) {
            return cors(new Response(JSON.stringify({ error: 'Guardian details and consent required for players under 18' }), { status: 400 }));
          }

          // ── Duplicate guard — same PERSON pending, not same email.
          //    Families share one email (parent registering several kids),
          //    so match on email + name + dob to only block true resubmits.
          const regEmail = String(r.email).trim().toLowerCase();
          const dupQ = `email=eq.${encodeURIComponent(regEmail)}`
            + `&first_name=ilike.${encodeURIComponent(String(r.firstName).trim())}`
            + `&surname=ilike.${encodeURIComponent(String(r.surname).trim())}`
            + `&dob=eq.${encodeURIComponent(r.dob)}`
            + `&status=eq.pending&select=id`;
          const dupR = await fetch(`${SB}/rest/v1/player_registrations?${dupQ}`, {
            headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY }
          });
          const dupRows = await dupR.json();
          if (dupRows && dupRows.length) {
            return cors(new Response(JSON.stringify({ error: 'duplicate' }), { status: 409 }));
          }

          // ── Medical info only stored with explicit consent (POPIA special info)
          const regMedical = (r.medicalConsent === true && r.medicalInfo)
            ? String(r.medicalInfo).slice(0, 2000) : null;

          const regRow = {
            first_name: String(r.firstName).trim().slice(0, 100),
            surname: String(r.surname).trim().slice(0, 100),
            nickname: r.nickname ? String(r.nickname).trim().slice(0, 60) : null,
            dob: r.dob,
            email: regEmail.slice(0, 200),
            phone: String(r.phone).trim().slice(0, 30),
            suburb: r.suburb ? String(r.suburb).trim().slice(0, 100) : null,
            is_minor: regIsMinor,
            guardian_name: regIsMinor ? String(r.guardianName).trim().slice(0, 100) : null,
            guardian_phone: regIsMinor ? String(r.guardianPhone).trim().slice(0, 30) : null,
            guardian_relationship: regIsMinor ? String(r.guardianRelationship).trim().slice(0, 40) : null,
            batting: String(r.batting).slice(0, 40),
            bowling: r.bowling ? String(r.bowling).slice(0, 40) : null,
            role: String(r.role).slice(0, 40),
            previous_club: r.previousClub ? String(r.previousClub).trim().slice(0, 120) : null,
            emergency_name: String(r.emergencyName).trim().slice(0, 100),
            emergency_phone: String(r.emergencyPhone).trim().slice(0, 30),
            medical_info: regMedical,
            medical_consent: r.medicalConsent === true,
            popia_consent: true,
            media_consent: r.mediaConsent === true,
            indemnity_consent: true,
            disclaimer_version: '2026-07',
            conduct_consent: true, // covered by disclaimer clause 7
            guardian_consent: regIsMinor,
            status: 'pending'
          };

          const regIns = await fetch(`${SB}/rest/v1/player_registrations`, {
            method: 'POST',
            headers: { ...H, 'Prefer': 'return=representation' },
            body: JSON.stringify(regRow)
          });
          if (!regIns.ok) {
            const regErr = await regIns.text();
            return cors(new Response(JSON.stringify({ error: 'Insert failed: ' + regErr }), { status: 500 }));
          }
          const regSavedRows = await regIns.json();
          const regSaved = regSavedRows[0] || {};

          // ── Notify M&R secretary (non-fatal, same pattern as bio.submit)
          await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              service_id: env.EMAILJS_SERVICE_ID, template_id: 'template_iifjomq',
              user_id: env.EMAILJS_PUBLIC_KEY, accessToken: env.EMAILJS_PRIVATE_KEY,
              template_params: {
                to_email: REG_NOTIFY_EMAIL,
                email: REG_NOTIFY_EMAIL,
                subject: 'New player registration \u2014 ' + regRow.first_name + ' ' + regRow.surname,
                name: 'TCC Admin',
                message: 'New player registration received:\n\n'
                  + 'Name: ' + regRow.first_name + ' ' + regRow.surname + '\n'
                  + 'DOB: ' + regRow.dob + (regIsMinor ? ' (minor \u2014 guardian: ' + regRow.guardian_name + ')' : '') + '\n'
                  + 'Email: ' + regRow.email + '\n'
                  + 'Phone: ' + regRow.phone + '\n'
                  + 'Role: ' + regRow.role + ' \u00b7 ' + regRow.batting + (regRow.bowling ? ' \u00b7 ' + regRow.bowling : '') + '\n'
                  + (regRow.previous_club ? 'Previous club: ' + regRow.previous_club + ' (WPCA transfer rules may apply)\n' : '')
                  + '\nReview at: https://tygerbergcc.co.za/admin.html'
              }
            })
          }).catch(function(){});

          return cors(new Response(JSON.stringify({ ok: true, id: regSaved.id }), { status: 200 }));
        }

        // ── REGISTRATION: list by status (registrar/super — M&R review queue)
        case 'registration.list': {
          const regStatus = (payload && payload.status) || 'pending';
          const regFilter = regStatus === 'all' ? '' : `status=eq.${encodeURIComponent(regStatus)}&`;
          const regL = await fetch(
            `${SB}/rest/v1/player_registrations?${regFilter}order=created_at.desc`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } }
          );
          return cors(new Response(await regL.text(), { status: regL.ok ? 200 : regL.status }));
        }

        // ── REGISTRATION: review — approve/reject with audit trail
        // ── Find possible existing players for a registration (admin confirms).
        //    We never auto-match: this returns candidates, the admin decides.
        case 'registration.candidates': {
          const rcId = payload && payload.id;
          if (!rcId) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));

          const rcR = await fetch(`${SB}/rest/v1/player_registrations?id=eq.${encodeURIComponent(rcId)}&select=*`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          const [reg] = await rcR.json();
          if (!reg) return cors(new Response(JSON.stringify({ error: 'Registration not found' }), { status: 404 }));

          const full = ((reg.first_name || '') + ' ' + (reg.surname || '')).trim();
          const cands = [];
          const seen = new Set();
          const push = (p, why, score) => {
            if (!p || seen.has(p.id)) return;
            seen.add(p.id);
            cands.push({ ...p, match_reason: why, match_score: score });
          };

          // 1. Exact email (only works once a player has been linked before —
          //    existing seniors have no email yet, so this often misses).
          if (reg.email) {
            const eR = await fetch(`${SB}/rest/v1/players?email=eq.${encodeURIComponent(reg.email)}&select=*`,
              { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
            (await eR.json() || []).forEach(p => push(p, 'Same email', 100));
          }
          // 2. Exact full-name match (case-insensitive).
          if (full) {
            const nR = await fetch(`${SB}/rest/v1/players?name=ilike.${encodeURIComponent(full)}&select=*`,
              { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
            (await nR.json() || []).forEach(p => push(p, 'Same name', 80));
          }
          // 3. Surname match — catches "Byron Daries" vs "B. Daries" / typos.
          if (reg.surname) {
            const sR = await fetch(`${SB}/rest/v1/players?name=ilike.*${encodeURIComponent(reg.surname)}*&select=*`,
              { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
            (await sR.json() || []).forEach(p => push(p, 'Surname matches', 40));
          }
          cands.sort((a, b) => b.match_score - a.match_score);

          return cors(new Response(JSON.stringify({
            registration: reg,
            fullName: full,
            candidates: cands.slice(0, 8)
          }), { status: 200 }));
        }

        // ── Promote a registration into a player profile.
        //    playerId given  → LINK to that existing player (and refresh their details)
        //    playerId absent → CREATE a new player from the registration
        case 'registration.promote': {
          const rpId = payload && payload.id;
          const linkTo = payload && payload.playerId;   // optional
          if (!rpId) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));

          const rpR = await fetch(`${SB}/rest/v1/player_registrations?id=eq.${encodeURIComponent(rpId)}&select=*`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          const [reg] = await rpR.json();
          if (!reg) return cors(new Response(JSON.stringify({ error: 'Registration not found' }), { status: 404 }));

          // age → squad (17 and under = youth)
          const ageOf = (dob) => {
            if (!dob) return null;
            const d = new Date(dob), n = new Date();
            let a = n.getFullYear() - d.getFullYear();
            if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
            return a;
          };
          const age = ageOf(reg.dob);
          const isMinor = age != null ? age < 18 : !!reg.is_minor;
          const squad = age != null ? (age <= 17 ? 'youth' : 'senior') : null;

          // Fields carried from the registration onto the profile.
          // NOTE: guardian details are admin-only; media_consent gates the photo.
          const profile = {
            name: ((reg.first_name || '') + ' ' + (reg.surname || '')).trim(),
            nickname: reg.nickname || null,
            email: reg.email || null,
            phone: reg.phone || null,
            dob: reg.dob || null,
            squad,
            is_minor: isMinor,
            guardian_name: isMinor ? (reg.guardian_name || null) : null,
            guardian_relationship: isMinor ? (reg.guardian_relationship || null) : null,
            guardian_phone: isMinor ? (reg.guardian_phone || null) : null,
            media_consent: !!reg.media_consent,
            registration_id: reg.id
          };
          // Only set cricket fields if the registration actually has them —
          // never overwrite a good existing profile value with a blank.
          if (reg.role)    profile.role = reg.role;
          if (reg.batting) profile.batting_hand = reg.batting;
          if (reg.bowling) profile.bowling_style = reg.bowling;

          const pH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY,
                       'Content-Type': 'application/json', 'Prefer': 'return=representation' };
          let player, mode;

          if (linkTo) {
            // LINK: update the existing profile with the fresh registration data.
            const uR = await fetch(`${SB}/rest/v1/players?id=eq.${encodeURIComponent(linkTo)}`, {
              method: 'PATCH', headers: pH, body: JSON.stringify(profile)
            });
            if (!uR.ok) {
              const t = await uR.text();
              return cors(new Response(JSON.stringify({ error: 'Link failed', detail: t }), { status: 500 }));
            }
            [player] = await uR.json();
            mode = 'linked';
          } else {
            // CREATE: brand-new profile. Sensible defaults for a new player.
            const created = { ...profile, active: true, fantasy_value: 5 };
            if (!created.role) created.role = 'All-rounder';
            const cR = await fetch(`${SB}/rest/v1/players`, {
              method: 'POST', headers: pH, body: JSON.stringify(created)
            });
            if (!cR.ok) {
              const t = await cR.text();
              return cors(new Response(JSON.stringify({ error: 'Create failed', detail: t }), { status: 500 }));
            }
            [player] = await cR.json();
            mode = 'created';
          }

          // Stamp the registration with the resulting player — permanent link.
          await fetch(`${SB}/rest/v1/player_registrations?id=eq.${encodeURIComponent(rpId)}`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({
              player_id: player.id,
              promoted_at: new Date().toISOString(),
              promoted_by: body._claims.name || body._claims.sub,
              status: 'approved'          // promoting implies approval
            })
          });

          return cors(new Response(JSON.stringify({ ok: true, mode, player }), { status: 200 }));
        }

        case 'registration.review': {
          const { id: regId, status: regNewStatus, note: regNote } = payload || {};
          if (!regId || !['approved','rejected'].includes(regNewStatus)) {
            return cors(new Response(JSON.stringify({ error: 'Invalid review payload' }), { status: 400 }));
          }
          const regU = await fetch(`${SB}/rest/v1/player_registrations?id=eq.${encodeURIComponent(regId)}`, {
            method: 'PATCH',
            headers: H,
            body: JSON.stringify({
              status: regNewStatus,
              review_note: regNote || null,
              reviewed_by: body._claims.name || body._claims.sub,
              reviewed_at: new Date().toISOString()
            })
          });
          if (!regU.ok) {
            return cors(new Response(JSON.stringify({ error: 'Review update failed' }), { status: 500 }));
          }
          // NOTE: promotion into `players` on approval stays manual (admin Players
          // tab) for now — auto-promotion is phase 2 once column mapping is agreed.
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ══════════════════════════════════════════════════════
        // CLUB SHOP (store)
        //  Public:    store.catalogue, store.checkout, store.mockConfirm
        //  Protected: store.listOrders, store.markCollected, store.saveProduct
        //  MOCK checkout until a gateway account exists — see MOCK_CHECKOUT.
        // ══════════════════════════════════════════════════════

        // ── STORE: catalogue (public)
        case 'store.trackOrder': {
          // Public: buyer enters order number + email to see status.
          // Requires BOTH to match (email acts as the shared secret) so orders
          // can't be enumerated by number alone.
          const rawNo = payload && payload.orderNo;
          const email = (payload && payload.email || '').trim().toLowerCase();
          if (!rawNo || !email) {
            return cors(new Response(JSON.stringify({ error: 'Order number and email required' }), { status: 400 }));
          }
          const orderNo = String(rawNo).replace(/[^0-9]/g, ''); // strip TCC- prefix etc.
          if (!orderNo) return cors(new Response(JSON.stringify({ error: 'Invalid order number' }), { status: 400 }));

          const toRes = await fetch(
            `${SB}/rest/v1/orders?order_no=eq.${orderNo}&select=order_no,buyer_name,buyer_email,total_cents,payment_status,payment_method,fulfilment,created_at,ready_at,collected_at,order_items(name_snapshot,qty)`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          const toRows = await toRes.json();
          const order = Array.isArray(toRows) ? toRows[0] : null;
          // Constant-ish response: same 'not found' whether number or email is wrong.
          if (!order || (order.buyer_email || '').trim().toLowerCase() !== email) {
            return cors(new Response(JSON.stringify({ error: 'No matching order found. Check the order number and email.' }), { status: 404 }));
          }
          // Map fulfilment to a friendly status + step index for a progress UI.
          const statusMap = {
            awaiting_payment:      { label: 'Awaiting payment', step: 0 },
            awaiting_preparation:  { label: 'Paid — being prepared', step: 1 },
            ready_for_collection:  { label: 'Ready to collect', step: 2 },
            collected:             { label: 'Collected', step: 3 },
            cancelled:             { label: 'Cancelled', step: -1 },
          };
          const st = statusMap[order.fulfilment] || { label: order.fulfilment, step: 0 };
          return cors(new Response(JSON.stringify({
            ok: true,
            orderNo: order.order_no,
            invNo: 'TCC-' + String(order.order_no || 0).padStart(6, '0'),
            buyerName: order.buyer_name,
            totalCents: order.total_cents,
            paymentStatus: order.payment_status,
            paymentMethod: order.payment_method,
            fulfilment: order.fulfilment,
            statusLabel: st.label,
            statusStep: st.step,
            placedAt: order.created_at,
            readyAt: order.ready_at,
            collectedAt: order.collected_at,
            items: (order.order_items || []).map(i => ({ name: i.name_snapshot, qty: i.qty }))
          }), { status: 200 }));
        }

        case 'store.catalogue': {
          const stCat = await fetch(
            `${SB}/rest/v1/products?active=eq.true&order=sort_order.asc&select=*,product_variants(*)`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } }
          );
          return cors(new Response(await stCat.text(), { status: stCat.ok ? 200 : stCat.status }));
        }

        // ── STORE: checkout (public) — create order + pending payment, hand back a checkout URL
        case 'store.checkout': {
          const c = payload || {};

          if (c.website) return cors(new Response(JSON.stringify({ ok: true }), { status: 200 })); // honeypot

          if (!c.buyerName || !c.buyerEmail || !Array.isArray(c.items) || !c.items.length) {
            return cors(new Response(JSON.stringify({ error: 'Name, email and at least one item are required' }), { status: 400 }));
          }
          if (!String(c.buyerEmail).match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            return cors(new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400 }));
          }

          // ── Re-price + stock-check SERVER-SIDE. Never trust client prices.
          const stIds = [...new Set(c.items.map(i => i.productId).filter(Boolean))];
          if (!stIds.length) return cors(new Response(JSON.stringify({ error: 'No valid items' }), { status: 400 }));
          const stProdRes = await fetch(
            `${SB}/rest/v1/products?id=in.(${stIds.join(',')})&select=*,product_variants(*)`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } }
          );
          const stProds = await stProdRes.json();
          const stMap = {}; stProds.forEach(p => stMap[p.id] = p);

          let stTotal = 0;
          const stLines = [];
          for (const item of c.items) {
            const p = stMap[item.productId];
            if (!p || !p.active) {
              return cors(new Response(JSON.stringify({ error: 'An item is no longer available' }), { status: 409 }));
            }
            let unit = p.price_cents, label = p.name, variant = null;
            if (p.has_variants) {
              variant = (p.product_variants || []).find(v => v.id === item.variantId);
              if (!variant) return cors(new Response(JSON.stringify({ error: 'Please choose an option for ' + p.name }), { status: 400 }));
              if (variant.stock < item.qty) {
                return cors(new Response(JSON.stringify({ error: 'Not enough stock for ' + p.name + ' (' + variant.label + ')' }), { status: 409 }));
              }
              if (variant.price_cents != null) unit = variant.price_cents;
              label = p.name + ' \u2014 ' + variant.label;
            }
            const qty = Math.max(1, parseInt(item.qty, 10) || 1);
            const line = unit * qty;
            stTotal += line;
            stLines.push({ product_id: p.id, variant_id: variant ? variant.id : null,
                           name_snapshot: label, unit_cents: unit, qty, line_cents: line });
          }

          // ── create order
          const stOrdRes = await fetch(`${SB}/rest/v1/orders`, {
            method: 'POST', headers: { ...H, 'Prefer': 'return=representation' },
            body: JSON.stringify({
              buyer_name: String(c.buyerName).trim().slice(0, 120),
              buyer_email: String(c.buyerEmail).trim().toLowerCase().slice(0, 200),
              buyer_phone: c.buyerPhone ? String(c.buyerPhone).trim().slice(0, 30) : null,
              total_cents: stTotal, payment_status: 'pending', fulfilment: 'awaiting_payment',
              payment_method: (c.paymentMethod === 'cash' ? 'cash' : 'payfast'),
              note: c.note ? String(c.note).slice(0, 500) : null
            })
          });
          if (!stOrdRes.ok) {
            const ordErr = await stOrdRes.text();
            console.error('store.checkout order insert failed', stOrdRes.status, ordErr);
            return cors(new Response(JSON.stringify({
              error: 'Could not create order', detail: ordErr, status: stOrdRes.status
            }), { status: 500 }));
          }
          const [stOrder] = await stOrdRes.json();

          await fetch(`${SB}/rest/v1/order_items`, {
            method: 'POST', headers: H,
            body: JSON.stringify(stLines.map(r => ({ ...r, order_id: stOrder.id })))
          });

          // ── create pending payment
          const stPayRes = await fetch(`${SB}/rest/v1/payments`, {
            method: 'POST', headers: { ...H, 'Prefer': 'return=representation' },
            body: JSON.stringify({
              purpose: 'shop_order', reference_id: stOrder.id,
              amount_cents: stTotal, currency: 'ZAR',
              payer_name: stOrder.buyer_name, payer_email: stOrder.buyer_email,
              status: 'pending'
            })
          });
          const [stPayment] = await stPayRes.json();
          await fetch(`${SB}/rest/v1/orders?id=eq.${stOrder.id}`, {
            method: 'PATCH', headers: H, body: JSON.stringify({ payment_id: stPayment.id })
          });

          // ── hand off to gateway
          // Cash at clubhouse skips online payment entirely.
          if (c.paymentMethod === 'cash') {
            await fetch(`${SB}/rest/v1/orders?id=eq.${stOrder.id}`, {
              method: 'PATCH', headers: H,
              body: JSON.stringify({ payment_method: 'cash', fulfilment: 'awaiting_preparation' })
            });
            // No stock decrement here yet — kept consistent with online (decrement
            // happens on payment/collection). Cash orders are marked paid when
            // collected (see store.markCollected).
            return cors(new Response(JSON.stringify({
              ok: true, cash: true, orderId: stOrder.id, orderNo: stOrder.order_no
            }), { status: 200 }));
          }

          // PF_MOCK lets you keep testing the mock inline flow if needed;
          // default is the real PayFast (sandbox) integration.
          const USE_MOCK = env.PF_MOCK === 'true';
          if (USE_MOCK) {
            return cors(new Response(JSON.stringify({
              ok: true, mock: true, orderId: stOrder.id, paymentId: stPayment.id,
              orderNo: stOrder.order_no, amountCents: stTotal,
              redirectUrl: '/store-return.html?mock=1&payment=' + stPayment.id
            }), { status: 200 }));
          }

          // ── PAYFAST (gateway). ABSA = acquiring bank behind it; we integrate PayFast only.
          const pf = pfBuildCheckout(stOrder, stPayment, env);
          await fetch(`${SB}/rest/v1/payments?id=eq.${stPayment.id}`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({ gateway: 'payfast' })  // gateway_ref set later from the ITN (pf_payment_id)
          });
          // Storefront receives the process URL + fields and auto-POSTs a form
          // to PayFast's hosted checkout (can't be a plain redirect — it's a POST).
          return cors(new Response(JSON.stringify({
            ok: true, payfast: true, processUrl: pf.processUrl, fields: pf.fields,
            orderId: stOrder.id, paymentId: stPayment.id
          }), { status: 200 }));
        }

        // ── STORE: mock confirm (public) — stands in for the gateway webhook until keys exist.
        //    DELETE this case the day the real webhook goes live.
        case 'store.mockConfirm': {
          const mcId = payload && payload.paymentId;
          if (!mcId) return cors(new Response(JSON.stringify({ error: 'paymentId required' }), { status: 400 }));
          await settlePaidOrder(mcId, 'manual', 'MOCK-' + mcId, {}, SB, KEY, H, env);
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── STORE: list orders (protected: scores/super)
        case 'store.listOrders': {
          if (!isAllowed(body._claims.role, 'store.listOrders'))
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          const stFul = (payload && payload.fulfilment) || 'ready_for_collection';
          const stQ = stFul === 'all' ? '' : `fulfilment=eq.${encodeURIComponent(stFul)}&`;
          const stO = await fetch(
            `${SB}/rest/v1/orders?${stQ}order=created_at.desc&select=*,order_items(*)`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          return cors(new Response(await stO.text(), { status: stO.ok ? 200 : stO.status }));
        }

        // ── STORE: confirm ready for collection (protected) — sends the 2nd email
        case 'store.confirmReady': {
          if (!isAllowed(body._claims.role, 'store.markCollected'))
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          const crId = payload && payload.id;
          if (!crId) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));

          const crU = await fetch(`${SB}/rest/v1/orders?id=eq.${crId}&select=*,order_items(*)`, {
            method: 'PATCH',
            headers: { ...H, 'Prefer': 'return=representation' },
            body: JSON.stringify({ fulfilment: 'ready_for_collection', ready_at: new Date().toISOString() })
          });
          if (!crU.ok) return cors(new Response(JSON.stringify({ error: 'Update failed' }), { status: 500 }));
          const [crOrder] = await crU.json();

          if (crOrder && crOrder.buyer_email) {
            try { await sendOrderReadyEmail(crOrder, env); }
            catch (e) { console.error('ready email failed', e); }
          }
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── STORE: mark collected (protected)
        case 'store.markCollected': {
          if (!isAllowed(body._claims.role, 'store.markCollected'))
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          const mkId = payload && payload.id;
          if (!mkId) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          // fetch to know if it's a cash order (cash is paid AT collection)
          const mkGet = await fetch(`${SB}/rest/v1/orders?id=eq.${mkId}&select=payment_method,payment_status`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          const [mkOrder] = await mkGet.json();
          const mkPatch = { fulfilment: 'collected', collected_at: new Date().toISOString() };
          if (mkOrder && mkOrder.payment_method === 'cash' && mkOrder.payment_status !== 'paid') {
            mkPatch.payment_status = 'paid'; // cash handed over at collection
          }
          const mkU = await fetch(`${SB}/rest/v1/orders?id=eq.${mkId}`, {
            method: 'PATCH', headers: H, body: JSON.stringify(mkPatch)
          });
          return cors(new Response(JSON.stringify({ ok: mkU.ok }), { status: mkU.ok ? 200 : 500 }));
        }

        // ── STORE: delete an order (protected) — for stuck/abandoned orders.
        //    Cascades to order_items; also removes the linked pending payment.
        case 'store.deleteOrder': {
          if (!isAllowed(body._claims.role, 'store.markCollected'))
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          const doId = payload && payload.id;
          if (!doId) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          // Safety: only allow deleting orders that were never paid.
          const doGet = await fetch(`${SB}/rest/v1/orders?id=eq.${doId}&select=payment_status,payment_id`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          const [doOrder] = await doGet.json();
          if (!doOrder) return cors(new Response(JSON.stringify({ error: 'Order not found' }), { status: 404 }));
          if (doOrder.payment_status === 'paid') {
            return cors(new Response(JSON.stringify({ error: 'Cannot delete a PAID order. Cancel/refund instead.' }), { status: 400 }));
          }
          // delete linked payment first (no FK cascade between them by convention)
          if (doOrder.payment_id) {
            await fetch(`${SB}/rest/v1/payments?id=eq.${doOrder.payment_id}`, { method: 'DELETE', headers: H });
          }
          const doDel = await fetch(`${SB}/rest/v1/orders?id=eq.${doId}`, { method: 'DELETE', headers: H });
          return cors(new Response(JSON.stringify({ ok: doDel.ok }), { status: doDel.ok ? 200 : 500 }));
        }

        // ── STORE: sweep stale pending PayFast drafts (protected).
        //    Removes online orders left 'pending' longer than maxAgeMinutes
        //    (default 60). Cash orders are never swept (they're real, unpaid).
        case 'store.sweepStale': {
          if (!isAllowed(body._claims.role, 'store.markCollected'))
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          const mins = Math.max(15, parseInt((payload && payload.maxAgeMinutes) || 60, 10));
          const cutoff = new Date(Date.now() - mins * 60000).toISOString();
          const swQ = `payment_status=eq.pending&payment_method=eq.payfast&created_at=lt.${encodeURIComponent(cutoff)}&select=id,payment_id`;
          const swGet = await fetch(`${SB}/rest/v1/orders?${swQ}`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          const stale = await swGet.json();
          let removed = 0;
          for (const o of (stale || [])) {
            if (o.payment_id) await fetch(`${SB}/rest/v1/payments?id=eq.${o.payment_id}`, { method: 'DELETE', headers: H });
            const d = await fetch(`${SB}/rest/v1/orders?id=eq.${o.id}`, { method: 'DELETE', headers: H });
            if (d.ok) removed++;
          }
          return cors(new Response(JSON.stringify({ ok: true, removed, olderThanMinutes: mins }), { status: 200 }));
        }

        // ── STORE: save product (protected) — upsert product row
        case 'store.saveProduct': {
          if (!isAllowed(body._claims.role, 'store.saveProduct'))
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          const sp = payload || {};
          const spRow = {
            name: sp.name, slug: sp.slug, description: sp.description || null,
            price_cents: sp.priceCents, image_url: sp.imageUrl || null,
            category: sp.category || null, has_variants: !!sp.hasVariants,
            active: sp.active !== false, sort_order: sp.sortOrder || 0
          };
          if (sp.id) spRow.id = sp.id;
          const spRes = await fetch(`${SB}/rest/v1/products`, {
            method: 'POST', headers: { ...H, 'Prefer': 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify(spRow)
          });
          return cors(new Response(await spRes.text(), { status: spRes.ok ? 200 : spRes.status }));
        }

        // ── STORE: admin product list (protected) — includes inactive + variants
        case 'store.listProductsAdmin': {
          if (!isAllowed(body._claims.role, 'store.saveProduct'))
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          const lpA = await fetch(
            `${SB}/rest/v1/products?order=sort_order.asc&select=*,product_variants(*)`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          return cors(new Response(await lpA.text(), { status: lpA.ok ? 200 : lpA.status }));
        }

        // ── STORE: save variants for a product (protected) — replace-all set
        case 'store.saveVariants': {
          if (!isAllowed(body._claims.role, 'store.saveProduct'))
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          const sv = payload || {};
          if (!sv.productId) return cors(new Response(JSON.stringify({ error: 'productId required' }), { status: 400 }));

          // Upsert provided variants; delete any existing ones not in the set.
          const incoming = Array.isArray(sv.variants) ? sv.variants : [];
          const keepIds = incoming.filter(v => v.id).map(v => v.id);

          // delete removed variants first (those with an id no longer present)
          const existRes = await fetch(`${SB}/rest/v1/product_variants?product_id=eq.${sv.productId}&select=id`,
            { headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY } });
          const existing = await existRes.json();
          const toDelete = existing.map(v => v.id).filter(id => !keepIds.includes(id));
          for (const id of toDelete) {
            await fetch(`${SB}/rest/v1/product_variants?id=eq.${id}`, { method: 'DELETE', headers: H });
          }

          // upsert incoming
          if (incoming.length) {
            const rows = incoming.map((v, i) => {
              const row = {
                product_id: sv.productId,
                label: String(v.label || '').slice(0, 40),
                sku: v.sku ? String(v.sku).slice(0, 60) : null,
                stock: Math.max(0, parseInt(v.stock, 10) || 0),
                price_cents: (v.priceCents === '' || v.priceCents == null) ? null : parseInt(v.priceCents, 10),
                sort_order: i
              };
              if (v.id) row.id = v.id;
              return row;
            });
            const upRes = await fetch(`${SB}/rest/v1/product_variants`, {
              method: 'POST',
              headers: { ...H, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify(rows)
            });
            if (!upRes.ok) return cors(new Response(JSON.stringify({ error: 'Variant save failed: ' + await upRes.text() }), { status: 500 }));
          }
          return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }

        // ── STORE: delete product (protected) — cascade removes variants
        case 'store.deleteProduct': {
          if (!isAllowed(body._claims.role, 'store.saveProduct'))
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          const dpId = payload && payload.id;
          if (!dpId) return cors(new Response(JSON.stringify({ error: 'id required' }), { status: 400 }));
          const dpR = await fetch(`${SB}/rest/v1/products?id=eq.${dpId}`, { method: 'DELETE', headers: H });
          return cors(new Response(JSON.stringify({ ok: dpR.ok }), { status: dpR.ok ? 200 : 500 }));
        }

        // ── STORE: product image upload (protected) — 'store' bucket, mirrors storage.uploadNews
        case 'store.uploadImage': {
          if (!isAllowed(body._claims.role, 'store.saveProduct'))
            return cors(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
          const { fileName, contentType, base64 } = payload;
          const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const storageH = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': contentType, 'x-upsert': 'true' };
          const r = await fetch(`${SB}/storage/v1/object/store/${fileName}`, { method: 'POST', headers: storageH, body: binary });
          const publicUrl = `${SB}/storage/v1/object/public/store/${fileName}`;
          return cors(new Response(JSON.stringify({ url: publicUrl, status: r.status }), { status: r.ok ? 200 : r.status }));
        }

        /* ══════════════════════════════════════════════════
           TOURNAMENT MODE
           Reads (tournaments, teams, results, standings) go straight to
           Supabase with the anon key. Only writes come through here.
        ══════════════════════════════════════════════════ */
        // ── TOURNAMENT: create or update the tournament itself
        case 'tournament.save': {
          const t = (payload && payload.tournament) || {};
          const fields = [
            'name','short_name','season','starts_on','ends_on','venue','status',
            'format','max_overs','extra_penalty','extras_count_ball','free_hits',
            'bowler_over_limit','points_win','points_tie','points_no_result',
            'points_loss','bonus_points','public_slug'
          ];
          const data = {};
          fields.forEach(k => { if (t[k] !== undefined) data[k] = t[k]; });
          if (!t.id && !data.name) {
            return cors(new Response(JSON.stringify({ error: 'A tournament needs a name.' }), { status: 400 }));
          }
          data.updated_at = new Date().toISOString();

          const r = t.id
            ? await fetch(`${SB}/rest/v1/tournaments?id=eq.${encodeURIComponent(t.id)}`, {
                method: 'PATCH',
                headers: Object.assign({}, H, { 'Prefer': 'return=representation' }),
                body: JSON.stringify(data)
              })
            : await fetch(`${SB}/rest/v1/tournaments`, {
                method: 'POST',
                headers: Object.assign({}, H, { 'Prefer': 'return=representation' }),
                body: JSON.stringify([data])
              });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        // ── TOURNAMENT: add or update a team, and its group
        case 'tournament.saveTeam': {
          const { tournamentId, team } = payload || {};
          if (!tournamentId || !team || !team.team_name) {
            return cors(new Response(JSON.stringify({ error: 'Tournament and team name are needed.' }), { status: 400 }));
          }
          const row = {
            tournament_id: tournamentId,
            team_name:  String(team.team_name).trim(),
            group_name: team.group_name ? String(team.group_name).trim() : null,
            seed:       team.seed != null ? team.seed : null,
            is_club:    !!team.is_club,
            logo_url:   team.logo_url || null
          };
          /* on_conflict keeps re-adding a team idempotent — the same club
             pasted twice updates its group rather than failing. */
          const r = await fetch(`${SB}/rest/v1/tournament_teams?on_conflict=tournament_id,team_name`, {
            method: 'POST',
            headers: Object.assign({}, H, { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
            body: JSON.stringify([row])
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        case 'tournament.deleteTeam': {
          const { id } = payload || {};
          if (!id) return cors(new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 }));
          const r = await fetch(`${SB}/rest/v1/tournament_teams?id=eq.${encodeURIComponent(id)}`, {
            method: 'DELETE', headers: H
          });
          return cors(new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : r.status }));
        }

        // ── TOURNAMENT: put a fixture into the tournament (or take it out)
        case 'tournament.linkFixture': {
          const { fixtureId, tournamentId, stage } = payload || {};
          if (!fixtureId) return cors(new Response(JSON.stringify({ error: 'Missing fixture' }), { status: 400 }));
          const data = {
            tournament_id:    tournamentId || null,
            tournament_stage: tournamentId ? (stage || 'group') : null
          };
          const r = await fetch(`${SB}/rest/v1/fixtures?id=eq.${encodeURIComponent(fixtureId)}`, {
            method: 'PATCH', headers: H, body: JSON.stringify(data)
          });
          return cors(new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : r.status }));
        }

        /* ── TOURNAMENT: file a result by hand
           For matches played on another platform. The same validation as the
           automatic route, so a typed result cannot make an impossible table. */
        case 'tournament.saveResult': {
          const { tournamentId, result } = payload || {};
          if (!tournamentId || !result) {
            return cors(new Response(JSON.stringify({ error: 'Tournament and result are needed.' }), { status: 400 }));
          }
          const teamsR = await fetch(
            `${SB}/rest/v1/tournament_teams?tournament_id=eq.${encodeURIComponent(tournamentId)}&select=team_name`,
            { headers: H });
          const teams = (await teamsR.json().catch(() => [])).map(t => t.team_name);

          const checked = tcValidateResult(result, teams);
          if (checked.error) {
            return cors(new Response(JSON.stringify({ error: checked.error }), { status: 400 }));
          }
          const row = Object.assign({}, checked.row, {
            tournament_id: tournamentId,
            source: 'manual',
            updated_at: new Date().toISOString()
          });

          /* One result per fixture: re-filing a corrected score replaces it
             rather than adding a second row and doubling it in the table. */
          const conflict = row.fixture_id ? '?on_conflict=tournament_id,fixture_id' : '';
          const prefer = row.fixture_id
            ? 'resolution=merge-duplicates,return=representation'
            : 'return=representation';
          const r = result.id
            ? await fetch(`${SB}/rest/v1/tournament_results?id=eq.${encodeURIComponent(result.id)}`, {
                method: 'PATCH',
                headers: Object.assign({}, H, { 'Prefer': 'return=representation' }),
                body: JSON.stringify(row)
              })
            : await fetch(`${SB}/rest/v1/tournament_results${conflict}`, {
                method: 'POST',
                headers: Object.assign({}, H, { 'Prefer': prefer }),
                body: JSON.stringify([row])
              });
          /* A filed result means the match has been played, so the fixture
             stops being an unplayed one — otherwise the scoring app keeps
             offering it and the website keeps calling it upcoming. */
          if (r.ok && row.fixture_id) await tcCloseFixture(SB, H, row.fixture_id, row);
          return cors(new Response(await r.text(), { status: r.status }));
        }

        /* ── TOURNAMENT: a team's squad, as submitted
           Names only. The whole squad is sent at once and replaces what was
           there, so a corrected list from a club is one paste rather than a
           reconciliation. */
        case 'tournament.saveSquad': {
          const { tournamentId, teamName, players, replace } = payload || {};
          if (!tournamentId || !teamName) {
            return cors(new Response(JSON.stringify({ error: 'Tournament and team are needed.' }), { status: 400 }));
          }
          if (!Array.isArray(players)) {
            return cors(new Response(JSON.stringify({ error: 'No players were sent.' }), { status: 400 }));
          }

          /* The team has to be in the tournament, or a typo creates a squad
             nobody can see. */
          const teamR = await fetch(
            `${SB}/rest/v1/tournament_teams?tournament_id=eq.${encodeURIComponent(tournamentId)}&select=team_name`,
            { headers: H });
          const known = (await teamR.json().catch(() => [])).map(t => t.team_name);
          const proper = known.filter(n => String(n).toLowerCase() === String(teamName).toLowerCase())[0];
          if (known.length && !proper) {
            return cors(new Response(JSON.stringify({ error: teamName + ' is not in this tournament.' }), { status: 400 }));
          }
          const team = proper || teamName;

          const rows = [];
          const seen = {};
          for (const p of players) {
            const name = String((p && p.player_name) || '').replace(/\s+/g, ' ').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (seen[key]) continue;          // the same name twice in one paste
            seen[key] = true;
            rows.push({
              tournament_id: tournamentId,
              team_name:  team,
              player_name: name,
              role:       p.role || null,
              shirt_no:   (p.shirt_no === 0 || p.shirt_no) ? p.shirt_no : null,
              is_captain: !!p.is_captain,
              is_keeper:  !!p.is_keeper,
              notes:      p.notes || null
            });
          }
          if (!rows.length) {
            return cors(new Response(JSON.stringify({ error: 'No usable names in that list.' }), { status: 400 }));
          }
          if (rows.length > 40) {
            return cors(new Response(JSON.stringify({ error: 'That is more than 40 players — check the list.' }), { status: 400 }));
          }

          /* Replacing is the default: a club sending a corrected squad means
             the new list, not the two merged. */
          if (replace !== false) {
            await fetch(`${SB}/rest/v1/tournament_players?tournament_id=eq.${encodeURIComponent(tournamentId)}` +
                        `&team_name=eq.${encodeURIComponent(team)}`, { method: 'DELETE', headers: H });
          }
          const r = await fetch(`${SB}/rest/v1/tournament_players?on_conflict=tournament_id,team_name,player_name`, {
            method: 'POST',
            headers: Object.assign({}, H, { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
            body: JSON.stringify(rows)
          });
          return cors(new Response(await r.text(), { status: r.status }));
        }

        case 'tournament.deletePlayer': {
          const { id } = payload || {};
          if (!id) return cors(new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 }));
          const r = await fetch(`${SB}/rest/v1/tournament_players?id=eq.${encodeURIComponent(id)}`, {
            method: 'DELETE', headers: H
          });
          return cors(new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : r.status }));
        }

        case 'tournament.deleteResult': {
          const { id } = payload || {};
          if (!id) return cors(new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 }));
          /* Which fixture it belonged to, before the row goes — removing a
             result puts the match back to unplayed, ready to be filed or
             scored again. */
          let fixtureId = null;
          try {
            const look = await fetch(
              `${SB}/rest/v1/tournament_results?id=eq.${encodeURIComponent(id)}&select=fixture_id`, { headers: H });
            const lrows = await look.json().catch(() => []);
            fixtureId = lrows && lrows[0] ? lrows[0].fixture_id : null;
          } catch (e) { /* the delete still goes ahead */ }

          const r = await fetch(`${SB}/rest/v1/tournament_results?id=eq.${encodeURIComponent(id)}`, {
            method: 'DELETE', headers: H
          });
          if (r.ok && fixtureId) {
            await fetch(`${SB}/rest/v1/fixtures?id=eq.${encodeURIComponent(fixtureId)}`, {
              method: 'PATCH', headers: H, body: JSON.stringify({ result: null })
            }).catch(() => {});
          }
          return cors(new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : r.status }));
        }

        /* ── TOURNAMENT: file a match our own app scored
           Called by the scoring app when a tournament match ends, and by the
           admin page's "pull from the app" button. Everything is read from
           the stored match, so a phone can file only what it actually scored. */
        case 'tournament.captureFromMatch': {
          const { liveScoreId } = payload || {};
          if (!liveScoreId) return cors(new Response(JSON.stringify({ error: 'Missing match' }), { status: 400 }));

          const mR = await fetch(
            `${SB}/rest/v1/live_scores?id=eq.${encodeURIComponent(liveScoreId)}&select=*,fixtures(id,team,opponent,date,tournament_id,tournament_stage)`,
            { headers: H });
          const mRows = await mR.json().catch(() => []);
          const match = mRows && mRows[0];
          if (!match) return cors(new Response(JSON.stringify({ error: 'Match not found' }), { status: 404 }));

          const fx = match.fixtures || {};
          const tournamentId = fx.tournament_id;
          if (!tournamentId) {
            return cors(new Response(JSON.stringify({ ok: true, skipped: 'not a tournament fixture' }), { status: 200 }));
          }
          if (match.status !== 'completed') {
            return cors(new Response(JSON.stringify({ error: 'The match is not finished yet.' }), { status: 409 }));
          }

          const tR = await fetch(`${SB}/rest/v1/tournaments?id=eq.${encodeURIComponent(tournamentId)}&select=*`, { headers: H });
          const tournament = (await tR.json().catch(() => []))[0] || {};

          const built = tcResultFromMatch(match, fx, tournament);
          if (built.error) return cors(new Response(JSON.stringify({ error: built.error }), { status: 400 }));

          const row = Object.assign({}, built.row, {
            tournament_id: tournamentId,
            source: 'app',
            live_score_id: match.id,
            fixture_id: fx.id || match.fixture_id || null,
            stage: fx.tournament_stage || 'group',
            updated_at: new Date().toISOString()
          });

          const conflict = row.fixture_id ? '?on_conflict=tournament_id,fixture_id' : '';
          const prefer = row.fixture_id
            ? 'resolution=merge-duplicates,return=representation'
            : 'return=representation';
          const r = await fetch(`${SB}/rest/v1/tournament_results${conflict}`, {
            method: 'POST',
            headers: Object.assign({}, H, { 'Prefer': prefer }),
            body: JSON.stringify([row])
          });
          if (r.ok && row.fixture_id) await tcCloseFixture(SB, H, row.fixture_id, row);
          return cors(new Response(await r.text(), { status: r.status }));
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

/* ══════════════════════════════════════════════════════
   BIRTHDAYS — shared by the birthday.today action and the daily cron.
   Dates are evaluated in SAST (UTC+2); Cloudflare cron runs in UTC.
══════════════════════════════════════════════════════ */
function sastNow() { return new Date(Date.now() + 2 * 60 * 60 * 1000); }
function sastDateStr() { return sastNow().toISOString().slice(0, 10); }

async function fetchBirthdaysFor(SB, H, dateStr) {
  const mmdd = dateStr.slice(5);
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const year   = Number(dateStr.slice(0, 4));
  const r = await fetch(`${SB}/rest/v1/players?select=id,name,dob&dob=not.is.null&active=not.eq.false`, { headers: H });
  let rows = [];
  try { rows = await r.json(); } catch (e) { return []; }
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const p of rows) {
    const dob = String(p.dob || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) continue;
    let theirs = dob.slice(5);
    // 29 Feb birthdays are marked on 28 Feb in non-leap years.
    if (theirs === '02-29' && !isLeap(year)) theirs = '02-28';
    if (theirs !== mmdd) continue;
    out.push({ id: p.id, name: p.name, age: year - Number(dob.slice(0, 4)) });
  }
  return out;
}

/* The message posted to WhatsApp. Deliberately does NOT include age —
   several players are minors and their age should not be broadcast to a
   group chat. Age is shown in the admin panel only, for context. */
function birthdayMessage(names) {
  const who = names.length === 1
    ? names[0]
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  const plural = names.length > 1;
  return '\uD83C\uDF82 Happy Birthday ' + who + '!' +
         '\n\nEveryone at Tygerberg Cricket Club wishes ' + (plural ? 'you all' : 'you') +
         ' a brilliant day. \uD83C\uDFCF' +
         '\n\nFacta Non Verba.';
}
/* ── Helpers ── */
function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, headers });
}

/* ============================================================
   CONFIDENTIALITY UNDERTAKING — Executive & captains
   Backs agreement.html. The agreement TEXT lives here (single source of
   truth), so the on-screen text and the hashed text can never drift apart.
   Requires the confidentiality_agreements table (see
   confidentiality_agreements.sql).

   Routes:
     GET  /api/agreement/current          -> the text to display
     POST /api/agreement/sign             -> record a signature
     GET  /api/agreement/list?token=JWT   -> who has signed (role: super)
   ============================================================ */

const CURRENT_AGREEMENT_VERSION = '1.0';

const AGREEMENTS = {
  '1.0': {
    version: '1.0',
    effective: '2026',
    consentText:
      'I have read and understood this undertaking and agree to be bound by it.',
    // Keep this as a single canonical string. Any edit changes the hash, so
    // treat changes as a new version (add a key and bump CURRENT_AGREEMENT_VERSION).
    text: `TYGERBERG CRICKET CLUB — CONFIDENTIALITY UNDERTAKING
Version 1.0

This undertaking is given by a member of the Executive Committee or a team captain of Tygerberg Cricket Club (established 1957) ("the Club"), in recognition of the trust placed in that office and of the access it brings to sensitive Club information.

1. Confidential Information means any non-public information I receive or become aware of by reason of my position, including but not limited to: the personal information of members, players, parents and guardians (including minors' dates of birth, contact details and guardian details); financial records, budgets, banking and sponsorship terms; disciplinary, grievance and selection matters; Executive and committee discussions and decisions not yet made public; contracts and supplier terms; passwords, system credentials and access to Club platforms; and any information marked or reasonably understood to be confidential.

2. Undertaking. I will: (a) keep Confidential Information strictly confidential; (b) use it only to carry out my duties for the Club; (c) not disclose it to any person outside the Club, or to any member without a legitimate need to know; (d) not copy, publish, post to social media, forward or discuss it in any public or private forum; and (e) take reasonable care to safeguard it, including any device or account through which I access it.

3. Personal information. I understand that member and player personal information is protected under the Protection of Personal Information Act, 2013 (POPIA), that minors' information is especially protected, and that I will process it only as needed for Club duties and never for personal purposes.

4. Exclusions. This does not apply to information that is or becomes public other than through my breach, or that I am legally compelled to disclose — in which case I will, where lawful, notify the Executive before disclosing.

5. Duration. These obligations apply for as long as I hold my position and continue after I leave it: indefinitely in respect of personal information, and for a period of three (3) years in respect of other Confidential Information.

6. On leaving office. When I leave my position I will return or securely destroy Confidential Information in my possession and surrender access to Club systems.

7. Consequences of breach. I understand that a breach of this undertaking is a serious matter that may result in disciplinary action by the Executive up to and including removal from my position and/or Club membership, and that where the breach involves personal information or unlawful conduct it may also expose me to liability under POPIA or other law.

8. Governing law. This undertaking is governed by the law of the Republic of South Africa.

9. Signature. I confirm that I have read and understood this undertaking and agree to be bound by it. I consent, in terms of the Electronic Communications and Transactions Act, 2002, to signing it electronically, and I understand that my name, email, the date and time, and my network address will be recorded as proof of signing.

Facta Non Verba.`,
  },
};

function agJson(data, status = 200, noStore = false) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (noStore) headers['Cache-Control'] = 'no-store';
  return new Response(JSON.stringify(data), { status, headers });
}

// Stable, ordered serialisation so the record hash is reproducible on re-check.
function agCanonical(rec) {
  return [
    rec.agreement_version,
    rec.agreement_hash,
    rec.consent_text,
    rec.signer_name,
    rec.signer_email,
    rec.signer_role || '',
    rec.signature_type,
    rec.signature_data,
    rec.ip_address || '',
    rec.user_agent || '',
    rec.signed_at,
  ].join('\n\u001f\n'); // unit-separator delimiter, won't appear in content
}

async function handleAgreement(request, env, url, verifyJwt) {
  const p = url.pathname;

  /* ---------- GET current: the text the page renders ---------- */
  if (p === '/api/agreement/current' && request.method === 'GET') {
    const a = AGREEMENTS[CURRENT_AGREEMENT_VERSION];
    if (!a) return agJson({ ok: false, error: 'No current agreement' }, 500);
    return agJson({
      ok: true,
      version: a.version,
      effective: a.effective,
      consentText: a.consentText,
      text: a.text,
    });
  }

  /* ---------- POST sign ---------- */
  if (p === '/api/agreement/sign' && request.method === 'POST') {
    let body;
    try { body = await request.json(); }
    catch { return agJson({ ok: false, error: 'Invalid JSON' }, 400); }

    const name = (body.name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const role = (body.role || '').trim();
    const signatureType = body.signatureType;
    const signatureData = body.signatureData || '';
    const version = body.agreementVersion || CURRENT_AGREEMENT_VERSION;
    const consent = body.consent === true;

    const agreement = AGREEMENTS[version];
    if (!agreement) return agJson({ ok: false, error: 'Unknown agreement version' }, 400);
    if (!name) return agJson({ ok: false, error: 'Name is required' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return agJson({ ok: false, error: 'A valid email is required' }, 400);
    if (signatureType !== 'drawn' && signatureType !== 'typed')
      return agJson({ ok: false, error: 'Signature is required' }, 400);
    if (!signatureData || (signatureType === 'typed' && !signatureData.trim()))
      return agJson({ ok: false, error: 'Signature is required' }, 400);
    if (!consent)
      return agJson({ ok: false, error: 'You must tick the agreement box' }, 400);

    // Server-authoritative values — never trust the client for these.
    const agreement_hash = await sha256(agreement.text);
    const signed_at = new Date().toISOString();
    const ip_address =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For') || '';
    const user_agent = request.headers.get('User-Agent') || '';

    const rec = {
      agreement_version: version,
      agreement_hash,
      consent_text: agreement.consentText,
      signer_name: name,
      signer_email: email,
      signer_role: role || null,
      signature_type: signatureType,
      signature_data: signatureData,
      ip_address,
      user_agent,
      signed_at,
    };
    rec.record_hash = await sha256(agCanonical(rec));

    const KEY = env.SUPABASE_SERVICE_KEY;
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/confidentiality_agreements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(rec),
    });

    // 409 = unique-index violation: this person already signed this version.
    // Keep the original signing (it's the binding one) and report it back
    // rather than creating a second row or re-sending the email.
    if (resp.status === 409) {
      const prevRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/confidentiality_agreements` +
          `?signer_email=eq.${encodeURIComponent(email)}` +
          `&agreement_version=eq.${encodeURIComponent(version)}` +
          `&select=id,signed_at,record_hash&limit=1`,
        { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
      );
      const prev = (prevRes.ok ? await prevRes.json() : [])[0] || {};
      return agJson({
        ok: true,
        alreadySigned: true,
        id: prev.id,
        signedAt: prev.signed_at,
        recordHash: prev.record_hash,
        version,
      });
    }

    if (!resp.ok) {
      const detail = await resp.text();
      return agJson({ ok: false, error: 'Could not save signature', detail }, 502);
    }
    const rows = await resp.json();
    const saved = Array.isArray(rows) ? rows[0] : rows;

    // Confirmation copy to the signer — reuses the same EmailJS secrets and
    // generic template ('template_iifjomq') as the rest of the Worker.
    // Non-fatal: the signature is already saved, so a failed email never
    // blocks a valid record.
    try {
      const whenZA = new Date(saved.signed_at).toLocaleString('en-ZA', {
        dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Johannesburg',
      });
      const ref = String(saved.record_hash || '').slice(0, 12);
      const message =
        'Hi ' + name + ',\n\n' +
        'This confirms that you have signed the Tygerberg Cricket Club ' +
        'Confidentiality Undertaking (version ' + version + ') on ' + whenZA + '.\n\n' +
        'Reference: ' + ref + '\n\n' +
        'A copy of what you agreed to is below.\n\n' +
        '----------------------------------------\n' +
        agreement.text + '\n' +
        '----------------------------------------\n\n' +
        'Facta Non Verba \ud83c\udfcf\nTygerberg Cricket Club';
      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: env.EMAILJS_SERVICE_ID,
          template_id: 'template_iifjomq',
          user_id: env.EMAILJS_PUBLIC_KEY,
          accessToken: env.EMAILJS_PRIVATE_KEY,
          template_params: {
            to_email: email,
            email: email,
            subject: 'Your signed TCC confidentiality undertaking',
            name: name,
            message: message,
          },
        }),
      });
    } catch (e) {
      // swallow — the record is saved regardless of email delivery
    }

    return agJson({
      ok: true,
      id: saved.id,
      signedAt: saved.signed_at,
      recordHash: saved.record_hash,
      version,
    });
  }

  /* ---------- GET list: who has signed (admin only) ---------- */
  if (p === '/api/agreement/list' && request.method === 'GET') {
    // Token in the query string (not a header) so the cross-origin GET stays a
    // simple request and needs no extra CORS allow-headers.
    const token = url.searchParams.get('token') || '';
    const claims = await verifyJwt(token, env.JWT_SECRET || '');
    if (!claims) return agJson({ ok: false, error: 'Unauthorized' }, 401, true);
    if (claims.role !== 'super' && claims.role !== 'chair') return agJson({ ok: false, error: 'Forbidden' }, 403, true);

    const version = url.searchParams.get('version') || CURRENT_AGREEMENT_VERSION;
    const KEY = env.SUPABASE_SERVICE_KEY;
    const resp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/confidentiality_agreements` +
        `?agreement_version=eq.${encodeURIComponent(version)}` +
        `&select=id,signer_name,signer_email,signer_role,signed_at,record_hash` +
        `&order=signed_at.desc`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
    );
    if (!resp.ok) return agJson({ ok: false, error: 'Could not load list' }, 502, true);
    const rows = await resp.json();
    return agJson({ ok: true, version, count: rows.length, signatures: rows }, 200, true);
  }

  /* ---------- GET records: full evidentiary export (admin only) ----------
     Everything needed to reproduce each signed undertaking as a document:
     the audit trail, the signature itself, and the exact text that version
     pinned. Sensitive (signature image, IP, user agent) — super only.
     Omit ?version to export every version. */
  if (p === '/api/agreement/records' && request.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    const claims = await verifyJwt(token, env.JWT_SECRET || '');
    if (!claims) return agJson({ ok: false, error: 'Unauthorized' }, 401, true);
    if (claims.role !== 'super' && claims.role !== 'chair') return agJson({ ok: false, error: 'Forbidden' }, 403, true);

    const version = url.searchParams.get('version'); // optional filter
    const KEY = env.SUPABASE_SERVICE_KEY;
    const filter = version
      ? `?agreement_version=eq.${encodeURIComponent(version)}`
      : '?';
    const resp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/confidentiality_agreements` +
        filter +
        `&select=id,agreement_version,agreement_hash,consent_text,signer_name,` +
        `signer_email,signer_role,signature_type,signature_data,ip_address,` +
        `user_agent,signed_at,record_hash` +
        `&order=signed_at.asc`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
    );
    if (!resp.ok) return agJson({ ok: false, error: 'Could not load records' }, 502, true);
    const rows = await resp.json();

    // Attach the exact text each row's version pinned (single source of truth).
    for (const r of rows) {
      const a = AGREEMENTS[r.agreement_version];
      r.agreement_text = a ? a.text : null;
    }
    return agJson(
      { ok: true, version: version || 'all', count: rows.length, records: rows },
      200,
      true
    );
  }

  return null; // not an agreement route — let the other routes run
}

/* ============================================================
   TOURNAMENT DRAW — phone-remote rooms
   Backs draw.html?display=CODE (arena) and draw.html?remote=CODE (phone).
   The draw is deterministic from (names, mode, seed), so the network only
   ever carries a step number. Requires the draw_rooms table (see draw_rooms.sql).

   Routes:
     POST   /api/draw/rooms                 -> create a room, returns { code, ... }
     GET    /api/draw/rooms/:code           -> read room state
     POST   /api/draw/rooms/:code/advance   -> draw the next ball (compare-and-set)
     POST   /api/draw/rooms/:code/reset     -> back to step 0
   ============================================================ */

// No I, O, 0 or 1 — nobody has to guess what they're reading off a screen.
const DRAW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function drawCode(len = 6) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => DRAW_ALPHABET[b % DRAW_ALPHABET.length]).join('');
}

function drawJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',            // polling must never see a cached step
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function sbDraw(env, path, init = {}) {
  const KEY = env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function handleDraw(request, env, url) {
  const match = url.pathname.match(
    /^\/api\/draw\/rooms(?:\/([A-Za-z0-9]{4,10}))?(?:\/(advance|reset))?\/?$/
  );
  if (!match) return null;                    // not a draw route — let the other routes run

  const code   = match[1] ? match[1].toUpperCase() : null;
  const action = match[2] ? match[2].toLowerCase() : null;
  const NOT_FOUND = { error: 'No draw is running under that code.' };

  try {
    /* ---------- create ---------- */
    if (!code && request.method === 'POST') {
      /* These routes are open by design (the phone remote must work without a
         login), so creation is rate limited instead. The fingerprint is a
         salted SHA-256 of the caller's IP — the IP itself is never stored. */
      const rawIp    = request.headers.get('CF-Connecting-IP') || 'unknown';
      const ipHash = await (async (s) => {
        const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
        return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
      })((env.JWT_SECRET || 'tcc-draw') + '|' + rawIp);
      const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      try {
        const recent = await sbDraw(env,
          `draw_rooms?creator_hash=eq.${ipHash}&created_at=gte.${sinceIso}&select=code`);
        if (Array.isArray(recent) && recent.length >= 10) {
          return drawJson({ error: 'Too many draws started from this device. Try again later.' }, 429);
        }
      } catch (e) { /* never block a real draw because the check failed */ }

      const body  = await request.json().catch(() => ({}));
      const names = Array.isArray(body.names)
        ? body.names.map(n => String(n).trim()).filter(Boolean)
        : [];

      if (names.length !== 8) {
        return drawJson({ error: 'Eight team names are required.' }, 400);
      }
      if (new Set(names.map(n => n.toLowerCase())).size !== 8) {
        return drawJson({ error: 'Two teams share a name.' }, 400);
      }

      const room = {
        code:  drawCode(),
        names,
        mode:  body.mode === 'open' ? 'open' : 'seeded',
        seed:  String(body.seed || 'TCC').slice(0, 60),
        step:  0,
        total: 8,
        creator_hash: ipHash,
      };

      const [created] = await sbDraw(env, 'draw_rooms', {
        method: 'POST',
        body: JSON.stringify(room),
      });
      return drawJson(created, 201);
    }

    if (!code) return drawJson({ error: 'Room code required.' }, 400);

    /* ---------- read ---------- */
    if (!action && request.method === 'GET') {
      const rows = await sbDraw(env, `draw_rooms?code=eq.${code}&select=*`);
      if (!rows || !rows.length) return drawJson(NOT_FOUND, 404);
      return drawJson(rows[0]);
    }

    /* ---------- advance ----------
       The PATCH is filtered on the step the caller believes is current, so
       Postgres does the compare-and-set. A double tap can only move the draw
       on by one ball — the second request comes back 409 with the true step
       and the phone re-syncs. */
    if (action === 'advance' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));

      const rows = await sbDraw(env, `draw_rooms?code=eq.${code}&select=*`);
      if (!rows || !rows.length) return drawJson(NOT_FOUND, 404);

      const room = rows[0];
      if (room.step >= room.total) {
        return drawJson({ ...room, done: true });
      }

      const from = Number.isInteger(body.expected) ? body.expected : room.step;

      const updated = await sbDraw(env, `draw_rooms?code=eq.${code}&step=eq.${from}`, {
        method: 'PATCH',
        body: JSON.stringify({ step: from + 1, updated_at: new Date().toISOString() }),
      });

      if (!updated || !updated.length) {
        return drawJson({ ...room, stale: true }, 409);   // somebody got there first
      }
      return drawJson(updated[0]);
    }

    /* ---------- reset ---------- */
    if (action === 'reset' && request.method === 'POST') {
      const updated = await sbDraw(env, `draw_rooms?code=eq.${code}`, {
        method: 'PATCH',
        body: JSON.stringify({ step: 0, updated_at: new Date().toISOString() }),
      });
      if (!updated || !updated.length) return drawJson(NOT_FOUND, 404);
      return drawJson(updated[0]);
    }

    return drawJson({ error: 'Method not allowed.' }, 405);

  } catch (err) {
    return drawJson(
      { error: 'The draw service is unavailable.', detail: String(err.message || err) },
      500
    );
  }
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

  // ── DRAW ROOMS: clear anything older than 24h ─────────────────────────
  //    A draw is a one-evening event; nothing needs to outlive the night.
  //    Non-fatal: a failure here must never stop the jobs below.
  try {
    const drawCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${SB}/rest/v1/draw_rooms?created_at=lt.${drawCutoff}`, {
      method: 'DELETE', headers: PH
    });
  } catch (e) { /* ignore */ }


  // ── AUTO-LOCK: lock any unlocked round whose deadline has passed ──────
  // Runs unconditionally — independent of VAPID config.
  try {
    const overdueRes = await fetch(
      `${SB}/rest/v1/fantasy_rounds?locked=eq.false&select=id,name,deadline`,
      { headers: H }
    );
    const overdueRounds = await overdueRes.json();
    if (Array.isArray(overdueRounds)) {
      const closing = overdueRounds.filter(r => new Date(r.deadline).getTime() < now);
      await Promise.all(closing.map(r => fetch(
        `${SB}/rest/v1/fantasy_rounds?id=eq.${r.id}`,
        { method: 'PATCH', headers: PH, body: JSON.stringify({ locked: true }) }
      )));

      /* Only the rounds this tick just closed. Running over every
         locked round would be harmless — a participant who already has
         a pick is skipped — but it would re-read the whole league every
         hour for the rest of the season.

         After the lock, not before: the lock is the job that must
         happen, and a carry that fails must not keep a round open. */
      for (const r of closing) {
        try {
          const carry = await carryForwardRound(SB, H, r.id);
          if (carry.carried || carry.dormant || carry.skipped) {
            console.log('Auto-carry ' + (r.name || r.id) + ':', JSON.stringify(carry));
          }
          if (carry.errors.length) console.error('Auto-carry errors:', carry.errors.join(' | '));
        } catch (e) {
          console.error('Auto-carry threw for ' + (r.name || r.id) + ':', e && e.message);
        }
      }
    }
  } catch(e) {
    // Non-fatal — don't block push notifications
    console.error('Auto-lock error:', e);
  }

  // ── BIRTHDAY NUDGE ────────────────────────────────────────────────────
  // Once a day, after 07:00 SAST, email the club a ready-to-send WhatsApp
  // link for today's birthdays. Deliberately NOT auto-posted: WhatsApp has no
  // API path to an existing group chat, and a human tapping send means the
  // message reads as the club and can be skipped when it isn't appropriate.
  try {
    const bToday = sastDateStr();
    if (sastNow().getUTCHours() >= 7) {
      const jlRes  = await fetch(`${SB}/rest/v1/job_log?job=eq.birthday_notify&select=last_run_date`, { headers: H });
      let jlRows = []; try { jlRows = await jlRes.json(); } catch (e) { jlRows = []; }
      const lastRun = (Array.isArray(jlRows) && jlRows[0]) ? String(jlRows[0].last_run_date).slice(0, 10) : null;

      if (lastRun !== bToday) {
        const people = await fetchBirthdaysFor(SB, H, bToday);
        if (people.length) {
          const msg     = birthdayMessage(people.map(p => p.name));
          const waLink  = 'https://wa.me/?text=' + encodeURIComponent(msg);
          const listing = people.map(p => p.name + ' (turns ' + p.age + ')').join('<br>');
          const html =
            '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#1a1a1a;color:#f2ede3">' +
            '<div style="font-size:13px;letter-spacing:3px;color:#c9a84c;text-transform:uppercase">Tygerberg Cricket Club</div>' +
            '<h2 style="margin:8px 0 18px;font-size:22px;color:#f2ede3">Birthday today</h2>' +
            '<p style="font-size:15px;line-height:1.6;color:#f2ede3;margin:0 0 18px">' + listing + '</p>' +
            '<p style="font-size:13px;line-height:1.6;color:#9a9a92;margin:0 0 20px">Tap below to open WhatsApp with the message ready. Pick the club group and send.</p>' +
            '<a href="' + waLink + '" style="display:inline-block;background:#c9a84c;color:#1a1a1a;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:6px;font-size:15px">Open in WhatsApp</a>' +
            '<p style="font-size:12px;color:#6e737f;margin:22px 0 0">Ages are shown here for your reference only \u2014 the WhatsApp message does not include them.</p>' +
            '</div>';
          const notifyTo = env.BIRTHDAY_NOTIFY_EMAIL || 'info@tygerbergcc.co.za';
          await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              service_id: env.EMAILJS_SERVICE_ID, template_id: 'template_iifjomq',
              user_id: env.EMAILJS_PUBLIC_KEY, accessToken: env.EMAILJS_PRIVATE_KEY,
              template_params: {
                to_email: notifyTo, email: notifyTo,
                subject: '\uD83C\uDF82 Birthday today \u2014 ' + people.map(p => p.name).join(', '),
                name: 'TCC Admin', message: html
              }
            })
          }).catch(() => {});
        }
        // Record the run even when nobody has a birthday, so we check once a day.
        await fetch(`${SB}/rest/v1/job_log`, {
          method: 'POST',
          headers: { ...H, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ job: 'birthday_notify', last_run_date: bToday, updated_at: new Date().toISOString() })
        });
      }
    }
  } catch (e) {
    console.error('Birthday notify error:', e);
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

/* ══════════════════════════════════════════════════════
   TOURNAMENT MODE — helpers
   Shared by the typed route (tournament.saveResult) and the automatic one
   (tournament.captureFromMatch), so a result means the same thing whichever
   way it arrived.
══════════════════════════════════════════════════════ */

/* Marks the fixture as played, in the words the fixtures list expects.
   The club's own matches read Won / Lost / Tie as they do for league cricket;
   a match between two visiting clubs says who won, since "Won" would be
   meaningless on a fixture the club is not in. */
function tcFixtureResultFor(row) {
  if (row.outcome === 'no_result')  return 'No Result';
  if (row.outcome === 'abandoned')  return 'Abandoned';
  if (row.outcome === 'forfeit')    return 'Forfeit';
  if (row.outcome === 'tie')        return 'Tie';
  if (!row.winner)                  return 'Played';
  const club = /tygerberg|\btcc\b/i;
  const clubIsIn = club.test(String(row.team_a || '')) || club.test(String(row.team_b || ''));
  if (!clubIsIn) return row.winner + ' won';
  return club.test(String(row.winner)) ? 'Won' : 'Lost';
}

async function tcCloseFixture(SB, H, fixtureId, row) {
  try {
    await fetch(`${SB}/rest/v1/fixtures?id=eq.${encodeURIComponent(fixtureId)}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ result: tcFixtureResultFor(row) })
    });
  } catch (e) { /* the result itself is filed — this is the tidy-up */ }
}

/* Is the club itself playing in this fixture? A club fixture names the club's
   own side ("1st XI", "Tygerberg CC"); a tournament match between two visiting
   clubs names neither. */
function isClubFixture(f) {
  const both = String((f && f.team) || '') + ' ' + String((f && f.opponent) || '');
  return /tygerberg|\btcc\b/i.test(both);
}

/* A result is only useful if the table can trust it. Everything a wrong
   entry could do to the standings is checked here, once, for both the typed
   and the automatic route. */
function tcValidateResult(result, teamNames) {
  const r = result || {};
  const a = String(r.team_a || '').trim();
  const b = String(r.team_b || '').trim();
  if (!a || !b) return { error: 'Both teams are needed.' };
  if (a.toLowerCase() === b.toLowerCase()) return { error: 'A team cannot play itself.' };

  /* Teams have to be in the tournament, or the table grows a column nobody
     entered. Checked case-insensitively, then stored with the tournament's
     own spelling so "cravenby cc" and "Cravenby CC" are one team. */
  const known = {};
  (teamNames || []).forEach(n => { known[String(n).trim().toLowerCase()] = String(n).trim(); });
  if (teamNames && teamNames.length) {
    if (!known[a.toLowerCase()]) return { error: a + ' is not in this tournament.' };
    if (!known[b.toLowerCase()]) return { error: b + ' is not in this tournament.' };
  }
  const teamA = known[a.toLowerCase()] || a;
  const teamB = known[b.toLowerCase()] || b;

  const outcome = String(r.outcome || 'result');
  const allowed = ['result', 'tie', 'no_result', 'abandoned', 'forfeit'];
  if (allowed.indexOf(outcome) === -1) return { error: 'Unknown outcome: ' + outcome };

  const num = v => (v === '' || v == null) ? null : Number(v);
  const aRuns = num(r.a_runs), bRuns = num(r.b_runs);
  const aBalls = num(r.a_balls), bBalls = num(r.b_balls);
  const aWk = num(r.a_wickets), bWk = num(r.b_wickets);

  const bad = [
    ['runs', aRuns], ['runs', bRuns], ['balls', aBalls], ['balls', bBalls]
  ].find(([, v]) => v != null && (!isFinite(v) || v < 0));
  if (bad) return { error: 'Runs and balls must be positive numbers.' };
  if ((aWk != null && (aWk < 0 || aWk > 10)) || (bWk != null && (bWk < 0 || bWk > 10))) {
    return { error: 'Wickets must be between 0 and 10.' };
  }

  let winner = r.winner ? String(r.winner).trim() : null;
  if (outcome === 'result') {
    if (!winner) return { error: 'A completed match needs a winner.' };
    const w = known[winner.toLowerCase()] || winner;
    if (w !== teamA && w !== teamB) return { error: 'The winner must be one of the two teams.' };
    winner = w;
    if (aRuns == null || bRuns == null) return { error: 'Both scores are needed for a completed match.' };
    if (aRuns === bRuns) return { error: 'The scores are level — record it as a tie.' };
    /* The side with more runs wins, unless the match was forfeited. A table
       built on a mistyped winner is worse than no table. */
    const higher = aRuns > bRuns ? teamA : teamB;
    if (winner !== higher) {
      return { error: 'The winner does not match the scores — ' + higher + ' scored more.' };
    }
  } else {
    winner = null;
    if (outcome === 'tie' && aRuns != null && bRuns != null && aRuns !== bRuns) {
      return { error: 'A tie needs the scores to be level.' };
    }
  }

  /* An innings cut short all out still counts its full allocation for net run
     rate. Filled in automatically when wickets say all out and the innings
     was short, unless the entry already says otherwise. */
  const full = num(r.full_allocation_balls);
  const nrrBalls = (balls, wk, given) => {
    if (given != null) return given;
    if (full && wk === 10 && balls != null && balls < full) return full;
    return null;
  };

  return {
    row: {
      fixture_id:  r.fixture_id || null,
      stage:       r.stage || 'group',
      played_on:   r.played_on || null,
      team_a: teamA, team_b: teamB,
      a_runs: aRuns, a_wickets: aWk, a_balls: aBalls,
      b_runs: bRuns, b_wickets: bWk, b_balls: bBalls,
      a_balls_nrr: nrrBalls(aBalls, aWk, num(r.a_balls_nrr)),
      b_balls_nrr: nrrBalls(bBalls, bWk, num(r.b_balls_nrr)),
      winner, outcome,
      result_text: r.result_text || null,
      potm:        r.potm || null,
      notes:       r.notes || null
    }
  };
}

/* Turns a finished match in live_scores into a result row. The first innings
   is stored separately from the second, so which side is which has to be
   worked out from who was batting when it ended. */
function tcResultFromMatch(match, fixture, tournament) {
  const parse = (v, fb) => {
    if (v == null || v === '') return fb;
    if (typeof v !== 'string') return v;
    try { const p = JSON.parse(v); return p == null ? fb : p; } catch (e) { return fb; }
  };
  const first = parse(match.first_innings_score, null);
  if (!first || first.runs == null) {
    return { error: 'That match has only one innings recorded.' };
  }

  const hundred = (match.format === 'hundred');
  const perSet  = hundred ? 5 : 6;
  const ballsOf = (overs, balls) => (Number(overs) || 0) * perSet + (Number(balls) || 0);

  /* The team batting second is match.batting_team; the other batted first. */
  const secondName = match.batting_team;
  const firstName  = match.bowling_team;

  const secondRuns  = Number(match.runs) || 0;
  const secondWk    = Number(match.wickets) || 0;
  const secondBalls = ballsOf(match.overs, match.balls);
  const firstRuns   = Number(first.runs) || 0;
  const firstWk     = Number(first.wickets) || 0;
  const firstBalls  = ballsOf(first.overs, first.balls);

  const allowed = hundred
    ? (Number(match.total_balls) || 100)
    : (Number(match.revised_overs || match.max_overs) || 0) * 6;

  const resultText = match.result || '';
  let outcome = 'result';
  if (/no result/i.test(resultText))      outcome = 'no_result';
  else if (/abandon/i.test(resultText))   outcome = 'abandoned';
  else if (/forfeit/i.test(resultText))   outcome = 'forfeit';
  else if (/^tie$|\btied\b/i.test(resultText) || firstRuns === secondRuns) outcome = 'tie';

  let winner = null;
  if (outcome === 'result') winner = secondRuns > firstRuns ? secondName : firstName;

  /* Names as the fixture has them — live_scores stores TCC's side as "TCC",
     which would otherwise appear in the table beside "Tygerberg CC". */
  const club = fixture && fixture.team;
  const opp  = fixture && fixture.opponent;
  const proper = (n) => {
    if (!n) return n;
    const s = String(n).trim();
    if (club && (s === 'TCC' || /tygerberg/i.test(s))) return club;
    if (opp && s.toLowerCase() === String(opp).toLowerCase()) return opp;
    return s;
  };

  const nrr = (balls, wk) => (wk === 10 && allowed && balls < allowed) ? allowed : null;

  return {
    row: {
      played_on: (fixture && fixture.date) || (match.updated_at || '').slice(0, 10) || null,
      team_a: proper(firstName),  a_runs: firstRuns,  a_wickets: firstWk,  a_balls: firstBalls,
      team_b: proper(secondName), b_runs: secondRuns, b_wickets: secondWk, b_balls: secondBalls,
      a_balls_nrr: nrr(firstBalls, firstWk),
      b_balls_nrr: nrr(secondBalls, secondWk),
      winner: winner ? proper(winner) : null,
      outcome,
      result_text: resultText || null,
      potm: (parse(match.lineup_state, {}) || {}).potm
              ? (parse(match.lineup_state, {}).potm.name || null) : null
    }
  };
}
