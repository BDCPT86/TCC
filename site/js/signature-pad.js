/* ══════════════════════════════════════════════════════════════════
   SIGNATURE PAD
   A canvas you sign with a finger, a stylus or a mouse. Shared by the
   player's page and the admin, and written to match what the
   confidentiality register already stores: a type ('typed' | 'drawn')
   and the data — a PNG data URL when drawn.

   Four things that are easy to get wrong and matter here:

   · Pointer events, not mouse and touch separately. One code path for a
     finger, an Apple Pencil and a mouse.
   · touch-action: none on the canvas, or signing on a phone scrolls the
     page instead of drawing.
   · The canvas is sized in device pixels and scaled back with CSS, or a
     signature on a retina phone comes out as a blurry smear.
   · What is saved is cropped to the ink and scaled down. A full-width
     canvas saved whole is mostly empty space, and these get stored on
     every record and printed on every copy.
   ══════════════════════════════════════════════════════════════════ */

function makeSignaturePad(canvas, opts) {
  opts = opts || {};
  var ctx = canvas.getContext('2d');
  var drawing = false, dirty = false;
  var last = null, lastMid = null;
  /* The ink's bounding box, so the saved image is the signature and not
     the empty paper around it. */
  var box = null;

  var ink = opts.color || '#13120e';
  var width = opts.lineWidth || 2.2;

  function fit() {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var r = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width));
    var h = Math.max(1, Math.round(r.height));
    if (canvas._w === w && canvas._h === h && canvas._dpr === dpr) return;
    /* Keep what is already drawn across a resize — an orientation change
       halfway through signing should not wipe the signature. */
    var prev = dirty ? canvas.toDataURL('image/png') : null;
    canvas._w = w; canvas._h = h; canvas._dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink;
    ctx.lineWidth = width;
    if (prev) {
      var img = new Image();
      img.onload = function () { ctx.drawImage(img, 0, 0, w, h); };
      img.src = prev;
    }
  }

  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function note(p) {
    if (!box) box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    else {
      box.x0 = Math.min(box.x0, p.x); box.y0 = Math.min(box.y0, p.y);
      box.x1 = Math.max(box.x1, p.x); box.y1 = Math.max(box.y1, p.y);
    }
  }

  function down(e) {
    if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
    fit();
    drawing = true;
    last = pos(e);
    lastMid = last;
    note(last);
    /* A tap with no movement is still a mark — a dot, like a full stop. */
    ctx.beginPath();
    ctx.arc(last.x, last.y, width / 2, 0, Math.PI * 2);
    ctx.fillStyle = ink;
    ctx.fill();
    dirty = true;
    if (canvas.setPointerCapture && e.pointerId != null) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    }
    if (opts.onChange) opts.onChange();
    e.preventDefault();
  }

  function move(e) {
    if (!drawing) return;
    var p = pos(e);
    /* Curve from the previous midpoint to this one, bending around the
       point between them. Drawing from the point to the midpoint instead
       leaves the other half of every segment unpainted, which comes out as
       a dashed line rather than a signature. */
    var mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(lastMid.x, lastMid.y);
    ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    ctx.stroke();
    lastMid = mid;
    last = p;
    note(p);
    dirty = true;
    e.preventDefault();
  }

  function up(e) {
    if (!drawing) return;
    /* The last sample never reached a midpoint, so the tail of the stroke
       would be missing. Close it off to where the pen actually stopped. */
    if (last && lastMid) {
      ctx.beginPath();
      ctx.moveTo(lastMid.x, lastMid.y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    drawing = false;
    last = null; lastMid = null;
    if (opts.onChange) opts.onChange();
    if (e) e.preventDefault();
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', up);
  window.addEventListener('resize', fit);

  function clear() {
    fit();
    ctx.clearRect(0, 0, canvas._w || canvas.width, canvas._h || canvas.height);
    dirty = false; box = null;
    if (opts.onChange) opts.onChange();
  }

  /* Cropped to the ink, with a little air around it, and no wider than
     maxWidth. A signature is stored on every record and printed on every
     copy, so it has no business being a megabyte. */
  function toDataURL(maxWidth) {
    if (!dirty || !box) return null;
    maxWidth = maxWidth || 600;
    var pad = 8;
    var x0 = Math.max(0, box.x0 - pad), y0 = Math.max(0, box.y0 - pad);
    var x1 = Math.min(canvas._w, box.x1 + pad), y1 = Math.min(canvas._h, box.y1 + pad);
    var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    var dpr = canvas._dpr || 1;

    var scale = Math.min(1, maxWidth / w);
    var out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    var octx = out.getContext('2d');
    octx.drawImage(canvas,
      Math.round(x0 * dpr), Math.round(y0 * dpr), Math.round(w * dpr), Math.round(h * dpr),
      0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  function isEmpty() { return !dirty; }

  fit();
  /* The box has a width only once it is on screen; a pad inside a modal is
     laid out after it opens, so callers call resize() when they show it. */
  return { clear: clear, toDataURL: toDataURL, isEmpty: isEmpty, resize: fit };
}

/* A drawn signature arriving from a page is just a string until it has been
   checked. PNG only — an SVG data URL can carry script, and a huge one can
   fill a row. Used on both sides: the page checks before sending so the
   person is told straight away, the Worker checks because the page cannot
   be trusted. */
var SIG_MAX_CHARS = 160000;   // ~120 KB of PNG
function validSignatureData(s) {
  if (typeof s !== 'string' || !s) return false;
  if (s.length > SIG_MAX_CHARS) return false;
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validSignatureData: validSignatureData, SIG_MAX_CHARS: SIG_MAX_CHARS };
}
