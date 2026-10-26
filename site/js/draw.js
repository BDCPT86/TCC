/* ============================================================
   CONFIG — point this at the Worker.
   Leave "" if the Worker serves this page's origin.
   ============================================================ */
const API = "https://tcc-admin.bydaries.workers.dev";
const ROOMS = `${API}/api/draw/rooms`;

/* ---------- role ---------- */
const qs   = new URLSearchParams(location.search);
const ROLE = qs.has("remote") ? "remote" : (qs.has("display") ? "display" : "solo");
const ARENA = ROLE !== "remote";
let roomCode = (qs.get("remote") || qs.get("display") || "").toUpperCase() || null;

/* ============================================================
   Deterministic draw — display and phone derive the identical
   queue from (names, mode, seed). The network only ever carries
   a step number.
   ============================================================ */
function hashSeed(str){
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++){
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function(){
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function buildQueue(names, mode, seed){
  const rand = hashSeed(seed);
  const q = [];
  if (mode === "open"){
    shuffle(names, rand).forEach(n => q.push({ name:n, pot:"" }));
  } else {
    // Pot 1 = seeds 1–2, Pot 2 = 3–4, Pot 3 = 5–6, Pot 4 = 7–8.
    // Reveals alternate A, B — one team from each pot per group.
    for (let p = 0; p < 4; p++){
      shuffle([names[p*2], names[p*2+1]], rand)
        .forEach(n => q.push({ name:n, pot:`Pot ${p + 1}` }));
    }
  }
  return q;
}
const groupOf = i => (i % 2 === 0 ? "A" : "B");

/* ============================================================
   STATE
   serverStep = balls the room says are drawn
   localStep  = balls this screen has actually played
   The display catches up one animation at a time, so a double
   tap can never desync the show.
   ============================================================ */
let queue = [], localStep = 0, serverStep = 0;
let busy = false, stageLive = false, online = false, paired = false;
let room = null;

/* ============================================================
   ARENA
   ============================================================ */
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MOBILE = Math.min(innerWidth, innerHeight) < 700 || matchMedia("(pointer: coarse)").matches;
const N = MOBILE ? 240 : 500, M = MOBILE ? 110 : 160;   // dust / sparks — lighter on phones

let renderer, scene, camera, dustGeo, camBase, keyLight, spot;
let ball, bat, sparksPts, flashSprite;
let sparkPos, sparkVel, sparkLife = 0, flashLife = 0;
let phase = "idle", ballT = 0, followT = 0, shakeT = 0;   // idle | bowling | follow

const REL = new THREE.Vector3( 0.55, 2.55, -16.5);   // bowler's release
const PIT = new THREE.Vector3(-0.12, 0.18,  -5.5);   // pitch / bounce (good length)
const HIT = new THREE.Vector3( 0.05, 0.98,  -1.6);   // contact zone, at the bat
const ricFrom = new THREE.Vector3(), ricTo = new THREE.Vector3();
const TB = 0.6, READY_X = -0.62, CONTACT_X = 0.55, FOLLOW_X = 1.2;

const clamp   = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp    = (a,b,t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIO  = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;

/* the delivery's flight path: descends to the pitch, then hops up to the bat */
function trajectory(t, out){
  t = Math.min(t, 1);
  if (t < TB){
    const u = t / TB;
    out.x = REL.x + (PIT.x - REL.x) * u;
    out.z = REL.z + (PIT.z - REL.z) * u;
    out.y = REL.y + (PIT.y - REL.y) * (u * u);              // accelerating drop
  } else {
    const u = (t - TB) / (1 - TB);
    out.x = PIT.x + (HIT.x - PIT.x) * u;
    out.z = PIT.z + (HIT.z - PIT.z) * u;
    out.y = PIT.y + (HIT.y - PIT.y) * u + Math.sin(u * Math.PI) * 0.22;  // hop
  }
}
function spinBall(dt, rate){
  if (!ball) return;
  ball.rotation.x += rate * dt;
  ball.rotation.y += rate * 0.15 * dt;
}

function makeBall(){
  const g = new THREE.Group();
  g.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.56, 40, 40),
    new THREE.MeshStandardMaterial({ color:0x8E1B14, roughness:.42, metalness:.12 })
  ));
  const ridge = new THREE.Mesh(
    new THREE.TorusGeometry(0.562, 0.022, 8, 64),
    new THREE.MeshStandardMaterial({ color:0x6E140E, roughness:.6 })
  );
  ridge.rotation.x = Math.PI / 2; g.add(ridge);
  const seamMat = new THREE.MeshStandardMaterial({ color:0xF2EDE0, roughness:.85 });
  [-0.035, 0.035].forEach(off => {
    const s = new THREE.Mesh(new THREE.TorusGeometry(0.559, 0.015, 8, 64), seamMat);
    s.rotation.x = Math.PI / 2; s.position.y = off; g.add(s);
  });
  return g;
}

function makeBat(){
  const g = new THREE.Group();
  const willow = new THREE.MeshStandardMaterial({ color:0xE7D6AE, roughness:.55, metalness:.05 });
  const blade  = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.9, 0.06), willow);
  blade.position.y = 0.35 + 0.45; g.add(blade);
  const spine  = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.86, 0.09),
    new THREE.MeshStandardMaterial({ color:0xD8C48F, roughness:.6 }));
  spine.position.set(0, 0.8, -0.05); g.add(spine);
  const grip   = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.35, 16),
    new THREE.MeshStandardMaterial({ color:0x14140F, roughness:.9 }));
  grip.position.y = 0.175; g.add(grip);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.05, 16),
    new THREE.MeshStandardMaterial({ color:0xC9A227, roughness:.4, metalness:.5 }));
  collar.position.y = 0.35; g.add(collar);
  return g;
}

function makeStumps(z){
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color:0xC9B48A, roughness:.7 });
  for (let i = -1; i <= 1; i++){
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 12), wood);
    s.position.set(i * 0.1, 0.5, 0); g.add(s);
  }
  const bailMat = new THREE.MeshStandardMaterial({ color:0xE8DCBE, roughness:.6 });
  [-0.05, 0.05].forEach(x => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8), bailMat);
    b.rotation.z = Math.PI / 2; b.position.set(x, 1.02, 0); g.add(b);
  });
  g.position.z = z; return g;
}

function goldTexture(){
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const gr = ctx.createRadialGradient(128,128,0,128,128,128);
  gr.addColorStop(0,  "rgba(255,240,200,.9)");
  gr.addColorStop(.35,"rgba(201,162,39,.5)");
  gr.addColorStop(1,  "rgba(201,162,39,0)");
  ctx.fillStyle = gr; ctx.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(c);
}

function emitSparks(x, y, z){
  for (let i = 0; i < M; i++){
    sparkPos[i*3] = x; sparkPos[i*3+1] = y; sparkPos[i*3+2] = z;
    const a  = Math.random() * Math.PI * 2;
    const el = Math.random() * Math.PI * 0.5;
    const sp = 3 + Math.random() * 9;
    sparkVel[i*3]   = Math.cos(a) * Math.cos(el) * sp;
    sparkVel[i*3+1] = Math.sin(el) * sp + 2.5;          // upward bias
    sparkVel[i*3+2] = Math.sin(a) * Math.cos(el) * sp + 3.5;  // toward the camera
  }
  sparksPts.geometry.attributes.position.needsUpdate = true;
  sparkLife = 1;
  sparksPts.material.opacity = 1;
  sparksPts.visible = true;
}

/* the moment of contact — bat meets ball */
function onContact(){
  phase = "follow"; followT = 0;
  emitSparks(ball.position.x, ball.position.y, ball.position.z);
  flashLife = 1;
  shakeT = 0.34;
  ricFrom.copy(ball.position);
  ricTo.set(ball.position.x + (Math.random() - .5) * 5, 6.5, 6.5);   // struck up and away
  onImpact();                                                        // sound + name + slot
}

function initArena(){
  const canvas = document.getElementById("scene");
  renderer = new THREE.WebGLRenderer({ canvas, antialias:!MOBILE, alpha:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07070A, 0.045);

  camera = new THREE.PerspectiveCamera(52, innerWidth/innerHeight, 0.1, 120);
  camBase = new THREE.Vector3(0, 1.55, 1.2);
  camera.position.copy(camBase);
  camera.lookAt(0, 0.55, -16);
  scene.add(camera);
  fitCamera();                       // responsive aspect + FOV (portrait needs a wider view)

  // lights — moody gold, a stadium spot on the batting zone
  scene.add(new THREE.AmbientLight(0x2A2418, 0.9));
  keyLight = new THREE.DirectionalLight(0xFFE9B0, 0.7); keyLight.position.set(6, 10, 2);  scene.add(keyLight);
  const rim = new THREE.DirectionalLight(0xC9A227, 1.1); rim.position.set(-6, 3, -8);     scene.add(rim);
  spot = new THREE.SpotLight(0xFFF0C4, 5, 34, Math.PI / 5, 0.5, 1.1);
  spot.position.set(0, 9, 2.5); spot.target.position.set(0, 0.6, -3);
  scene.add(spot); scene.add(spot.target);

  const gtex = goldTexture();

  // ground + pitch + creases
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color:0x0A0908, roughness:1 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 20),
    new THREE.MeshStandardMaterial({ color:0x201B12, roughness:.95 }));
  pitch.rotation.x = -Math.PI / 2; pitch.position.set(0, 0.002, -8); scene.add(pitch);
  const creaseMat = new THREE.MeshBasicMaterial({ color:0x9A8F72, transparent:true, opacity:.5 });
  [-0.6, -15.4].forEach(z => {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.04), creaseMat);
    c.rotation.x = -Math.PI / 2; c.position.set(0, 0.004, z); scene.add(c);
  });

  // stumps at the bowler's end + a glowing sightscreen behind them
  scene.add(makeStumps(-16));
  const sight = new THREE.Mesh(new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial({ map:gtex, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:.5 }));
  sight.position.set(0, 2.2, -17.5); scene.add(sight);

  // gold dust
  dustGeo = new THREE.BufferGeometry();
  const dpos = new Float32Array(N * 3), dvel = new Float32Array(N);
  for (let i = 0; i < N; i++){
    dpos[i*3]   = (Math.random() - .5) * 26;
    dpos[i*3+1] =  Math.random() * 9;
    dpos[i*3+2] = (Math.random() - .5) * 26 - 6;
    dvel[i] = .0015 + Math.random() * .004;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color:0xC9A227, size:.03, transparent:true, opacity:.5,
    blending:THREE.AdditiveBlending, depthWrite:false
  })));

  // the delivery ball
  ball = makeBall();
  ball.scale.setScalar(0.3);
  ball.visible = false;
  scene.add(ball);

  // the bat — held in view, a child of the camera
  bat = makeBat();
  bat.position.set(0.34, -1.75, -1.75);
  bat.rotation.set(READY_X, 0.16, 0.24);
  camera.add(bat);

  // spark burst
  sparkPos = new Float32Array(M * 3);
  sparkVel = new Float32Array(M * 3);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  sparksPts = new THREE.Points(sg, new THREE.PointsMaterial({
    color:0xF0D264, size:0.14, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, sizeAttenuation:true
  }));
  sparksPts.visible = false; scene.add(sparksPts);

  // contact flash
  flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map:gtex, color:0xffffff, transparent:true,
    blending:THREE.AdditiveBlending, depthWrite:false, opacity:0
  }));
  flashSprite.scale.setScalar(0.6); flashSprite.position.copy(HIT);
  flashSprite.visible = false; scene.add(flashSprite);

  const clock = new THREE.Clock();
  let dim = 0;

  (function tick(){
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), .05);
    const t  = clock.elapsedTime;

    // drifting dust
    const p = dustGeo.attributes.position.array;
    for (let i = 0; i < N; i++){
      p[i*3+1] += dvel[i];
      if (p[i*3+1] > 9) p[i*3+1] = 0;
    }
    dustGeo.attributes.position.needsUpdate = true;

    // ── delivery / swing state machine ──
    if (phase === "bowling"){
      ballT += dt / 1.25;
      trajectory(ballT, ball.position);
      spinBall(dt, 26);
      const sp = clamp((ballT - 0.66) / 0.34, 0, 1);
      bat.rotation.x = lerp(READY_X, CONTACT_X, sp * sp);
      bat.rotation.z = 0.24 + (bat.rotation.x - READY_X) * 0.12;
      if (ballT >= 1) onContact();
    } else if (phase === "follow"){
      followT += dt;
      const rt = clamp(followT / 0.34, 0, 1);
      ball.position.lerpVectors(ricFrom, ricTo, easeOut(rt));
      spinBall(dt, 46);
      if (rt >= 1) ball.visible = false;
      let bx;
      if (followT < 0.45){
        bx = lerp(CONTACT_X, FOLLOW_X, easeOut(followT / 0.45));
      } else {
        const q = clamp((followT - 0.45) / 0.7, 0, 1);
        bx = lerp(FOLLOW_X, READY_X, easeIO(q));
        if (q >= 1) phase = "idle";
      }
      bat.rotation.x = bx;
      bat.rotation.z = 0.24 + (bx - READY_X) * 0.12;
    } else {
      bat.rotation.x = READY_X + Math.sin(t * 1.1) * 0.03;
      bat.rotation.z = 0.24 + Math.sin(t * 0.9) * 0.02;
    }

    // sparks
    if (sparkLife > 0){
      sparkLife -= dt / 0.7;
      for (let i = 0; i < M; i++){
        sparkVel[i*3+1] -= 15 * dt;
        sparkPos[i*3]   += sparkVel[i*3]   * dt;
        sparkPos[i*3+1] += sparkVel[i*3+1] * dt;
        sparkPos[i*3+2] += sparkVel[i*3+2] * dt;
      }
      sparksPts.geometry.attributes.position.needsUpdate = true;
      sparksPts.material.opacity = Math.max(0, sparkLife);
      sparksPts.visible = sparkLife > 0;
    } else if (sparksPts.visible){ sparksPts.visible = false; }

    // flash
    if (flashLife > 0){
      flashLife -= dt / 0.26;
      const e = 1 - Math.max(0, flashLife);
      flashSprite.material.opacity = Math.max(0, flashLife);
      flashSprite.scale.setScalar(0.5 + e * 2.6);
      flashSprite.visible = flashLife > 0;
    } else if (flashSprite.visible){ flashSprite.visible = false; }

    // camera shake
    if (shakeT > 0){
      shakeT -= dt;
      const a = Math.max(0, shakeT / 0.34) * 0.14;
      camera.position.set(
        camBase.x + (Math.random() - .5) * a,
        camBase.y + (Math.random() - .5) * a,
        camBase.z + (Math.random() - .5) * a * 0.6
      );
    } else {
      camera.position.copy(camBase);
    }

    // dim the field a touch while the name holds the screen
    const want = document.getElementById("reveal").classList.contains("on") ? 1 : 0;
    dim += (want - dim) * 0.07;
    spot.intensity     = 5   - dim * 3.0;
    keyLight.intensity = 0.7 - dim * 0.35;

    if (!document.body.classList.contains("finale")) renderer.render(scene, camera);
  })();

  addEventListener("resize", fitCamera);
}

/* portrait screens need a wider vertical FOV so the pitch and delivery stay in frame */
function fitCamera(){
  if (!camera || !renderer) return;
  const a = innerWidth / innerHeight;
  camera.aspect = a;
  camera.fov = a < 1 ? Math.min(52 / a, 70) : 52;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function resetDelivery(){
  phase = "idle"; ballT = 0; followT = 0; shakeT = 0; sparkLife = 0; flashLife = 0;
  if (ball)        ball.visible = false;
  if (sparksPts)   sparksPts.visible = false;
  if (flashSprite) flashSprite.visible = false;
  if (camera && camBase) camera.position.copy(camBase);
}

/* ============================================================
   SOUND
   ============================================================ */
let ac = null, muted = false;
function audio(){
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === "suspended") ac.resume();
  return ac;
}
function whoosh(){
  if (muted) return;
  const a = audio(), n = Math.floor(a.sampleRate * 0.9);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random()*2 - 1) * Math.pow(i / n, 2);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.4;
  f.frequency.setValueAtTime(320, a.currentTime);
  f.frequency.exponentialRampToValueAtTime(2600, a.currentTime + 0.9);
  const g = a.createGain(); g.gain.value = 0.2;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
function thock(){
  if (muted) return;
  const a = audio(), t = a.currentTime;
  const o = a.createOscillator(); o.type = "triangle";
  o.frequency.setValueAtTime(420, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.16);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + 0.3);
}
function chime(){
  if (muted) return;
  const a = audio(), t = a.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => {
    const o = a.createOscillator(); o.type = "sine"; o.frequency.value = hz;
    const g = a.createGain(); const s = t + i * 0.13;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.2, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 1.1);
    o.connect(g).connect(a.destination);
    o.start(s); o.stop(s + 1.2);
  });
}
document.getElementById("sound").addEventListener("click", e => {
  muted = !muted;
  e.currentTarget.classList.toggle("off", muted);
});
document.getElementById("full").addEventListener("click", () => {
  document.fullscreenElement ? document.exitFullscreen()
                             : document.documentElement.requestFullscreen?.();
});

/* ============================================================
   SETUP (display / solo)
   ============================================================ */
const DEFAULTS = ["Tygerberg CC","Bellville CC","Durbanville CC","Ravensmead CC",
                  "Parow CC","Goodwood CC","Elsies River CC","Kuils River CC"];
const teamsEl = document.getElementById("teams");
DEFAULTS.forEach((n, i) => {
  const row = document.createElement("div");
  row.className = "team-row";
  row.innerHTML = `<span class="seed-no">${i + 1}</span>`;
  const inp = document.createElement("input");
  inp.type = "text"; inp.value = n; inp.autocomplete = "off";
  inp.setAttribute("aria-label", `Team ${i + 1}`);
  row.appendChild(inp);
  teamsEl.appendChild(row);
});
const inputs = () => [...teamsEl.querySelectorAll("input")];

/* A fresh, unpredictable seed for every draw. Uses crypto — not Math.random —
   so nobody, including whoever runs the draw, can arrange or foresee the result.
   It's still displayed and reproducible, so the draw can be audited afterwards. */
function randomSeed(){
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";              // no ambiguous chars to read out
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(b, x => A[x % A.length]).join("");
  return s.slice(0, 4) + "-" + s.slice(4);                    // e.g. R7K2-9QXM
}

const seedField = document.getElementById("seed");
if (seedField && ROLE !== "remote"){
  seedField.value = randomSeed();                             // random by default, never a fixed string
  const reroll = document.getElementById("reroll");
  if (reroll) reroll.addEventListener("click", () => {
    seedField.value = randomSeed();
    seedField.focus();
  });
}

function buildSlots(){
  ["groupA","groupB"].forEach(id => {
    const box = document.getElementById(id);
    box.innerHTML = "";
    for (let i = 1; i <= 4; i++){
      const s = document.createElement("div");
      s.className = "slot";
      s.innerHTML = `<span class="pos">${i}</span><span class="nm">&mdash;</span>`;
      box.appendChild(s);
    }
  });
}

document.getElementById("start").addEventListener("click", async () => {
  const names = inputs().map(i => i.value.trim());
  const err = document.getElementById("err");
  if (names.some(n => !n)){
    err.textContent = "Every team needs a name before the draw can run.";
    err.style.display = "block"; return;
  }
  if (new Set(names.map(n => n.toLowerCase())).size !== 8){
    err.textContent = "Two teams share a name. Give each one a distinct name.";
    err.style.display = "block"; return;
  }
  err.style.display = "none";

  const mode = document.querySelector("input[name=mode]:checked").value;
  const seed = document.getElementById("seed").value.trim() || randomSeed();
  const wantPhone = document.querySelector("input[name=ctrl]:checked").value === "phone";

  audio();                                        // unlock audio on this gesture

  if (wantPhone){
    const btn = document.getElementById("start");
    btn.disabled = true; btn.textContent = "Pairing…";
    try {
      const res = await fetch(ROOMS, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ names, mode, seed })
      });
      if (!res.ok){
        const raw = await res.text().catch(() => "");
        let serverMsg;
        try { serverMsg = JSON.parse(raw).error; } catch {}
        console.error("draw pairing failed:", res.status, ROOMS, raw.slice(0, 200));
        throw new Error(serverMsg
          ? `Pairing failed (${res.status}): ${serverMsg}`
          : `Pairing failed (${res.status}) — the request isn't reaching the draw Worker. Check the API URL and the /api/draw/* route.`);
      }
      room = await res.json();
      roomCode = room.code;
      paired = true;
      history.replaceState(null, "", `?display=${roomCode}`);
      startStage(names, mode, seed);
      startPolling(500);
    } catch (e) {
      err.textContent = `${e.message} You can still run the draw from this device.`;
      err.style.display = "block";
    } finally {
      btn.disabled = false; btn.textContent = "Begin the draw";
    }
    return;
  }

  startStage(names, mode, seed);
});

function startStage(names, mode, seed){
  exitFinale();
  queue = buildQueue(names, mode, seed);
  localStep = 0; serverStep = 0; busy = false; stageLive = true;
  if (ARENA) resetDelivery();
  buildSlots();
  document.getElementById("seedOut").textContent = seed;
  document.getElementById("reveal").classList.remove("on");
  document.getElementById("setup").style.display = "none";
  document.getElementById("stage").classList.add("live");
  document.getElementById("paired").classList.toggle("on", paired);
  if (paired){
    const remoteUrl = `${location.origin}${location.pathname}?remote=${roomCode}`;
    document.getElementById("pairCode").textContent = roomCode;
    document.getElementById("pairLink").textContent = remoteUrl;
    renderQr(remoteUrl);
  }
  updateStageButton();
  layout();
}

/* build a scannable QR of the remote URL — margin = cellSize*4 for the
   quiet zone the spec requires. Falls back silently to the code/link. */
function renderQr(url){
  const box = document.getElementById("pairQr");
  if (!box) return;
  try {
    const qr = qrcode(0, "M");        // type 0 = auto-size, medium error correction
    qr.addData(url);
    qr.make();
    box.innerHTML = `<img alt="Scan to open the remote" src="${qr.createDataURL(6, 24)}">`;
  } catch (e) {
    box.style.display = "none";       // no QR lib / failure — code + link still shown
  }
}

/* ---------- the display catches up, one ball at a time ---------- */
setInterval(() => {
  if (!stageLive || busy) return;
  if (localStep < serverStep && localStep < queue.length) fire();
}, 60);

function fire(){
  busy = true;
  updateStageButton();
  document.getElementById("reveal").classList.remove("on");
  if (!ARENA || reduce){ onImpact(); return; }
  startDelivery();
}

function startDelivery(){
  phase = "bowling"; ballT = 0; followT = 0;
  ball.visible = true;
  trajectory(0, ball.position);
  whoosh();                          // run-up / delivery
}

function onImpact(){
  thock();
  const flash = document.getElementById("flash");
  flash.classList.remove("pop"); void flash.offsetWidth; flash.classList.add("pop");

  const { name, pot } = queue[localStep];
  const g = groupOf(localStep);
  const label = `Group ${g}`;

  const rv = document.getElementById("reveal");
  document.getElementById("dest").textContent = pot ? `${pot} \u2192 ${label}` : label;
  document.getElementById("name").textContent = name;
  rv.classList.remove("on"); void rv.offsetWidth; rv.classList.add("on");

  setTimeout(() => {
    const slot = document.getElementById(`group${g}`).children[Math.floor(localStep / 2)];
    slot.classList.add("filled");
    slot.querySelector(".nm").textContent = name;
    localStep++;
    busy = false;
    if (localStep === queue.length){
      document.getElementById("dest").textContent = "The draw is complete";
      chime();
      setTimeout(enterFinale, reduce ? 200 : 1300);   // let the last name linger, then converge
    }
    updateStageButton();
  }, reduce ? 120 : 1500);
}

/* ---------- finale: the two group boards converge to centre ---------- */
function enterFinale(){
  if (document.body.classList.contains("finale")) return;
  const finGroups = document.getElementById("finGroups");
  const a = document.getElementById("wrapA"), b = document.getElementById("wrapB");
  document.getElementById("finSeed").textContent =
    document.getElementById("seedOut").textContent;
  finGroups.append(a, b);                       // move both boards into the centred stage
  document.body.classList.add("finale");
}

function exitFinale(){
  if (!document.body.classList.contains("finale")) return;
  document.body.classList.remove("finale");
  const stage = document.getElementById("stage");
  stage.appendChild(document.getElementById("wrapA"));   // hand the boards back to the stage
  stage.appendChild(document.getElementById("wrapB"));
  layout();                                     // re-sort for mobile / desktop
}

function updateStageButton(){
  const b = document.getElementById("next");
  const done = localStep >= queue.length && queue.length > 0;
  b.disabled = busy || done || localStep < serverStep;
  b.textContent = done ? "Draw complete"
                : paired ? (busy ? "Drawing…" : "Draw from here")
                : (busy ? "Drawing…" : "Draw the next ball");
  document.getElementById("dot").classList.toggle("up", online);
}

/* the display's own button still works — it just goes through the room
   so both devices agree. If the network is down it fires locally anyway. */
document.getElementById("next").addEventListener("click", () => {
  if (busy || localStep >= queue.length) return;
  advance();
});

async function advance(){
  if (!paired && ROLE !== "remote"){ serverStep = Math.min(serverStep + 1, queue.length || 8); return; }
  try {
    const res = await fetch(`${ROOMS}/${roomCode}/advance`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ expected: serverStep })
    });
    const data = await res.json().catch(() => null);
    if (data && Number.isInteger(data.step)) serverStep = Math.max(serverStep, data.step);
    online = true;
    return data;
  } catch {
    online = false;
    if (ROLE !== "remote") serverStep = Math.min(serverStep + 1, queue.length || 8);  // carry on regardless
    throw new Error("offline");
  }
}

/* ---------- polling ---------- */
let pollTimer = null;
function startPolling(ms){
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, ms);
  poll();
}
async function poll(){
  if (!roomCode) return;
  try {
    const res = await fetch(`${ROOMS}/${roomCode}`, { cache:"no-store" });
    if (!res.ok) throw new Error("gone");
    const data = await res.json();
    online = true;
    room = data;

    if (data.step === 0 && localStep > 0 && !busy) hardReset();
    serverStep = Math.max(serverStep, data.step);

    /* If we drew balls while the network was down, the room is behind what the
       room full of people just watched. The display is authoritative, so walk
       the room forward until it agrees — one CAS call per missed ball. */
    if (ROLE !== "remote" && paired && !busy && data.step < serverStep && data.step < (queue.length || 8)) {
      const behind = Math.min(serverStep, queue.length || 8) - data.step;
      for (let i = 0; i < behind; i++) {
        try {
          const r = await fetch(`${ROOMS}/${roomCode}/advance`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expected: data.step + i })
          });
          if (!r.ok) break;                       // someone else moved it; next poll re-reads
        } catch { break; }                        // still offline — try again next poll
      }
    }

    if (ROLE === "remote") paintRemote(data);
    else updateStageButton();
  } catch {
    online = false;
    if (ROLE === "remote") paintRemote(null);
    else updateStageButton();
  }
}

function hardReset(){
  exitFinale();
  localStep = 0; serverStep = 0; busy = false;
  if (ARENA) resetDelivery();
  buildSlots();
  document.getElementById("reveal").classList.remove("on");
  updateStageButton();
}


/* ============================================================
   TOURNAMENT FIXTURES
   Generated from the draw result — deliberately NOT written to the
   club `fixtures` table, which is TCC-centric (team / opponent /
   division) and models the club playing one match at a time.
   Eight visiting sides playing each other is a separate thing.

   Note on labels: A1..A4 below are DRAW ORDER within the group —
   the order teams came out of the bag. The knockout labels are
   FINAL STANDINGS ("Winner Group A"), which aren't known until the
   group stage finishes, so they stay unresolved here.
   ============================================================ */
const FIXTURE_PLAN = {
  venue: "Florida Park",
  slots: [9*60, 11*60 + 30, 14*60],          // 09:00, 11:30, 14:00
  matchMins: 150,                             // a 100-ball game runs ~2h30
  groupDays: [
    { date:"2026-09-24", label:"Thursday 24 September", note:"Heritage Day",
      fields:[ { field:"Field A", group:"A", pairs:[[1,2],[3,4],[1,3]] },
               { field:"Field B", group:"B", pairs:[[1,2],[3,4],[1,3]] } ] },
    { date:"2026-09-26", label:"Saturday 26 September", note:"fields swap",
      fields:[ { field:"Field A", group:"B", pairs:[[2,4],[1,4],[2,3]] },
               { field:"Field B", group:"A", pairs:[[2,4],[1,4],[2,3]] } ] },
  ],
  finals: { date:"2026-09-27", label:"Sunday 27 September", field:"Field A",
    games:[
      { t:9*60,       stage:"Semi-final 1", home:"Winner Group A", away:"Runner-up Group B" },
      { t:11*60 + 30, stage:"Semi-final 2", home:"Winner Group B", away:"Runner-up Group A" },
      { t:15*60,      stage:"Final",        home:"Winner SF1",     away:"Winner SF2" },
    ] }
};

const fxTime = m => String(Math.floor(m/60)).padStart(2,"0") + ":" + String(m%60).padStart(2,"0");

function drawnGroups(){
  const read = id => [...document.getElementById(id).querySelectorAll(".slot.filled .nm")]
                       .map(n => n.textContent.trim()).filter(Boolean);
  return { A: read("groupA"), B: read("groupB") };
}

/* Returns [{date,label,note,field,start,end,stage,home,away}] */
function buildFixtures(){
  const g = drawnGroups();
  if (g.A.length < 4 || g.B.length < 4) return null;      // draw not finished
  const out = [];
  FIXTURE_PLAN.groupDays.forEach(day => {
    day.fields.forEach(f => {
      f.pairs.forEach((pair, i) => {
        const start = FIXTURE_PLAN.slots[i];
        out.push({
          date: day.date, label: day.label, note: day.note, field: f.field,
          start, end: start + FIXTURE_PLAN.matchMins,
          stage: "Group " + f.group,
          home: g[f.group][pair[0]-1], away: g[f.group][pair[1]-1]
        });
      });
    });
  });
  FIXTURE_PLAN.finals.games.forEach(gm => {
    out.push({
      date: FIXTURE_PLAN.finals.date, label: FIXTURE_PLAN.finals.label, note: "",
      field: FIXTURE_PLAN.finals.field, start: gm.t, end: gm.t + FIXTURE_PLAN.matchMins,
      stage: gm.stage, home: gm.home, away: gm.away
    });
  });
  return out;
}

function fixturesText(){
  const fx = buildFixtures();
  if (!fx) return "";
  let s = "TYGERBERG CRICKET CLUB — 100-BALL TOURNAMENT\n" + FIXTURE_PLAN.venue + "\n";
  let day = null, field = null;
  fx.forEach(m => {
    if (m.label !== day){ day = m.label; field = null; s += "\n" + day.toUpperCase() + (m.note ? "  (" + m.note + ")" : "") + "\n"; }
    if (m.field !== field){ field = m.field; s += "  " + field + "\n"; }
    s += "    " + fxTime(m.start) + "  " + m.stage + " — " + m.home + " v " + m.away + "\n";
  });
  s += "\nSeed phrase: " + document.getElementById("seedOut").textContent +
       " (re-run the draw with this phrase to verify)\n";
  return s;
}

function renderFixtures(){
  const fx = buildFixtures();
  const body = document.getElementById("fxBody");
  if (!body) return;
  if (!fx){ body.innerHTML = '<p class="fx-empty">Finish the draw to see the fixtures.</p>'; return; }
  let html = "", day = null, field = null;
  fx.forEach(m => {
    if (m.label !== day){
      if (day) html += "</div>";
      day = m.label; field = null;
      html += '<div class="fx-day"><p class="fx-dh">' + m.label +
              (m.note ? ' <span class="fx-note">' + m.note + '</span>' : '') + '</p>';
    }
    if (m.field !== field){
      field = m.field;
      html += '<p class="fx-fh">' + field + '</p>';
    }
    html += '<div class="fx-m"><span class="fx-t">' + fxTime(m.start) + '</span>' +
            '<span class="fx-n">' + m.home + ' <em>v</em> ' + m.away + '</span>' +
            '<span class="fx-s">' + m.stage + '</span></div>';
  });
  html += "</div>";
  body.innerHTML = html;
}

document.getElementById("fixtures")?.addEventListener("click", () => {
  renderFixtures();
  document.getElementById("fxPanel").classList.add("on");
});
document.getElementById("fxClose")?.addEventListener("click", () => {
  document.getElementById("fxPanel").classList.remove("on");
});
document.getElementById("fxCopy")?.addEventListener("click", async () => {
  const toast = document.getElementById("toast");
  try { await navigator.clipboard.writeText(fixturesText()); toast.textContent = "Fixtures copied"; }
  catch { toast.textContent = "Copy blocked by the browser"; }
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
});

/* ---------- copy / clear / start over ---------- */
document.getElementById("copy").addEventListener("click", async () => {
  const pick = id => [...document.getElementById(id).querySelectorAll(".slot.filled .nm")]
                       .map((n, i) => `${i + 1}. ${n.textContent}`).join("\n");
  const text = `TYGERBERG CRICKET CLUB — TOURNAMENT DRAW\n\nGROUP A\n${pick("groupA") || "—"}\n\nGROUP B\n${pick("groupB") || "—"}\n\nSeed phrase: ${document.getElementById("seedOut").textContent} (re-run the draw with this phrase to verify)`;
  const toast = document.getElementById("toast");
  try { await navigator.clipboard.writeText(text); toast.textContent = "Copied"; }
  catch { toast.textContent = "Copy blocked by the browser"; }
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
});
document.getElementById("clear").addEventListener("click", () => {
  inputs().forEach(i => i.value = ""); inputs()[0].focus();
});
document.getElementById("again").addEventListener("click", async () => {
  if (paired && roomCode){
    try { await fetch(`${ROOMS}/${roomCode}/reset`, { method:"POST" }); } catch {}
  }
  clearInterval(pollTimer);
  paired = false; roomCode = null; stageLive = false;
  history.replaceState(null, "", location.pathname);
  exitFinale();
  document.getElementById("stage").classList.remove("live");
  document.getElementById("reveal").classList.remove("on");
  document.getElementById("paired").classList.remove("on");
  document.getElementById("setup").style.display = "grid";
  if (seedField) seedField.value = randomSeed();     // fresh seed → next draw can't repeat this one
  if (ARENA) resetDelivery();
});

/* ============================================================
   REMOTE (phone)
   ============================================================ */
function paintRemote(data){
  document.getElementById("rDot").classList.toggle("up", online);
  const status  = document.getElementById("rStatus");
  const trigger = document.getElementById("rTrigger");

  if (!data){
    status.textContent = "Lost the display. Retrying…";
    trigger.disabled = true;
    trigger.classList.remove("pulse");
    return;
  }

  const total = data.total || 8;
  const drawn = data.step;
  document.getElementById("rCode").textContent = data.code;
  document.getElementById("rProgress").textContent =
    drawn >= total ? "All eight drawn" : `Ball ${drawn + 1} of ${total}`;

  if (drawn >= total){
    status.textContent = "The draw is complete.";
    trigger.disabled = true;
    trigger.textContent = "Done";
    trigger.classList.remove("pulse");
  } else if (!trigger.dataset.cooling){
    status.textContent = "Tap when the room is ready.";
    trigger.disabled = false;
    trigger.textContent = "Draw\nthe ball";
    trigger.classList.add("pulse");
  }

  if (drawn > 0 && queue.length){
    const i = drawn - 1;
    document.getElementById("rLast").hidden = false;
    document.getElementById("rLastName").textContent = queue[i].name;
    document.getElementById("rLastGroup").textContent =
      (queue[i].pot ? queue[i].pot + " → " : "") + "Group " + groupOf(i);
  }
}

async function joinRoom(code){
  const err = document.getElementById("joinErr");
  try {
    const res = await fetch(`${ROOMS}/${code}`, { cache:"no-store" });
    if (!res.ok) throw new Error("No draw is running under that code.");
    room = await res.json();
    roomCode = room.code;
    queue = buildQueue(room.names, room.mode, room.seed);
    serverStep = room.step;
    online = true;

    history.replaceState(null, "", `?remote=${roomCode}`);
    document.getElementById("rJoin").hidden = true;
    ["rHead","rTrigger","rFoot"].forEach(id => document.getElementById(id).hidden = false);
    paintRemote(room);
    startPolling(1000);
  } catch (e) {
    err.textContent = e.message;
    err.style.display = "block";
  }
}

document.getElementById("joinBtn").addEventListener("click", () => {
  const code = document.getElementById("joinCode").value.trim().toUpperCase();
  if (code.length < 4){
    const err = document.getElementById("joinErr");
    err.textContent = "That code looks too short.";
    err.style.display = "block";
    return;
  }
  joinRoom(code);
});
document.getElementById("joinCode").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("joinBtn").click();
});

document.getElementById("rTrigger").addEventListener("click", async e => {
  const trigger = e.currentTarget;
  if (trigger.disabled) return;

  navigator.vibrate?.(35);
  trigger.disabled = true;
  trigger.dataset.cooling = "1";
  trigger.classList.remove("pulse");
  trigger.textContent = "On its way";
  document.getElementById("rStatus").textContent = "Watch the screen.";

  try {
    await advance();
  } catch {
    document.getElementById("rStatus").textContent = "Couldn't reach the display. Try again.";
  }

  // hold the button while the ball is in flight and the name is on screen
  setTimeout(() => {
    delete trigger.dataset.cooling;
    poll();
  }, 2700);
});

document.getElementById("rReset").addEventListener("click", async () => {
  if (!confirm("Reset the draw? The display goes back to eight balls in the bag.")) return;
  try {
    await fetch(`${ROOMS}/${roomCode}/reset`, { method:"POST" });
    serverStep = 0;
    poll();
  } catch {
    document.getElementById("rStatus").textContent = "Couldn't reach the display.";
  }
});

/* ---------- narrow screens: stack the boards ---------- */
function layout(){
  if (ROLE === "remote") return;
  if (document.body.classList.contains("finale")) return;   // boards live in the finale stage
  const narrow = innerWidth <= 860;
  const stage  = document.getElementById("stage");
  const a = document.getElementById("wrapA"), b = document.getElementById("wrapB");
  let holder = stage.querySelector(".mobile-boards");
  if (narrow && !holder){
    holder = document.createElement("div");
    holder.className = "mobile-boards";
    stage.appendChild(holder);
    holder.append(a, b);
  } else if (!narrow && holder){
    stage.prepend(b); stage.prepend(a);
    holder.remove();
  }
}
addEventListener("resize", layout);

/* ============================================================
   BOOT
   ============================================================ */
if (ROLE === "remote"){
  document.body.classList.add("remote");
  ["scene","setup","stage","tools","badge"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  document.querySelector(".vignette").style.display = "none";
  document.getElementById("remote").classList.add("on");
  if (roomCode) joinRoom(roomCode);
} else {
  initArena();
  buildSlots();
  layout();

  if (ROLE === "display" && roomCode){
    // rejoining an existing room — pick the config back up and carry on
    paired = true;
    fetch(`${ROOMS}/${roomCode}`, { cache:"no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("gone")))
      .then(data => {
        room = data;
        startStage(data.names, data.mode, data.seed);
        serverStep = data.step;
        localStep  = data.step;                 // don't replay balls already drawn
        for (let i = 0; i < data.step; i++){
          const g = groupOf(i);
          const slot = document.getElementById(`group${g}`).children[Math.floor(i / 2)];
          slot.classList.add("filled");
          slot.querySelector(".nm").textContent = queue[i].name;
        }
        updateStageButton();
        if (localStep === queue.length && queue.length) enterFinale();
        startPolling(500);
      })
      .catch(() => {
        paired = false;
        history.replaceState(null, "", location.pathname);
      });
  }
}
