/* ════════════════════════════════════════════════════
   HISTORY PAGE
════════════════════════════════════════════════════ */

/* ── Hamburger ── */
var hamburger  = document.getElementById('hamburger');
var navLinksEl = document.getElementById('nav-links');
hamburger.addEventListener('click', function() { hamburger.classList.toggle('open'); navLinksEl.classList.toggle('open'); });
navLinksEl.querySelectorAll('a').forEach(function(a) {
  a.addEventListener('click', function() { hamburger.classList.remove('open'); navLinksEl.classList.remove('open'); });
});

/* ── Copyright year ── */
document.querySelectorAll('.copy-year').forEach(function(el) { el.textContent = new Date().getFullYear(); });

/* ── Sidebar nav active state ── */
var navLinks = document.querySelectorAll('.history-nav a');
var eras     = document.querySelectorAll('.history-era');

function setActiveNav(id) {
  navLinks.forEach(function(l) { l.classList.remove('active'); });
  var link = document.querySelector('.history-nav a[href="#' + id + '"]');
  if (link) link.classList.add('active');
}

// Use scroll position to determine which era is most visible
function updateActiveNav() {
  var scrollMid = window.scrollY + window.innerHeight * 0.4;
  var active = null;
  eras.forEach(function(era) {
    if (era.getBoundingClientRect().top + window.scrollY <= scrollMid) {
      active = era.id;
    }
  });
  if (active) setActiveNav(active);
}

window.addEventListener('scroll', updateActiveNav, { passive: true });
updateActiveNav();

/* ── Scroll-triggered era animations ── */
var animObserver = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      animObserver.unobserve(entry.target); // animate once only
    }
  });
}, { threshold: 0.15 });

eras.forEach(function(era) { animObserver.observe(era); });
