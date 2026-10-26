Assets
======

This game ships with **zero binary assets** — by design.

· All sound effects (bat, crowd, horn, wicket, golden chime, fire) are
  synthesised at runtime with the Web Audio API in js/ui.js.
· The club crest is inline SVG (also in js/ui.js).
· All graphics are vector shapes drawn directly on the canvas.

That keeps the whole game tiny and instant-loading. This folder is kept
so the structure matches the brief; drop any future images/audio here.
