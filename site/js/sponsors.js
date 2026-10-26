/* Hamburger */
var hamburger  = document.getElementById('hamburger');
var navLinksEl = document.getElementById('nav-links');
hamburger.addEventListener('click', function() { hamburger.classList.toggle('open'); navLinksEl.classList.toggle('open'); });
navLinksEl.querySelectorAll('a').forEach(function(a) {
  a.addEventListener('click', function() { hamburger.classList.remove('open'); navLinksEl.classList.remove('open'); });
});
/* Copyright year */
document.querySelectorAll('.copy-year').forEach(function(el) { el.textContent = new Date().getFullYear(); });
