/* TCC Games page */
var hamburger  = document.getElementById('hamburger');
var navLinksEl = document.getElementById('nav-links');
hamburger.addEventListener('click', function() { hamburger.classList.toggle('open'); navLinksEl.classList.toggle('open'); });
document.querySelectorAll('.nav-links a').forEach(function(a) {
  a.addEventListener('click', function() { hamburger.classList.remove('open'); navLinksEl.classList.remove('open'); });
});

document.querySelectorAll('.copy-year').forEach(function(el) { el.textContent = new Date().getFullYear(); });

/* Animate the Six & Out meter bar */
(function() {
  var bar = document.getElementById('six-meter-bar');
  if (!bar) return;
  var pos = 0, dir = 1, speed = 0.6;
  function tick() {
    pos += dir * speed;
    if (pos >= 100) { pos = 100; dir = -1; }
    if (pos <= 0)   { pos = 0;   dir =  1; }
    bar.style.left = pos + '%';
    requestAnimationFrame(tick);
  }
  tick();
})();
