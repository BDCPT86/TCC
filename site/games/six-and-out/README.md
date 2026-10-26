# Tygerberg Six & Out Challenge

A browser cricket arcade game for **Tygerberg Cricket Club** — built with
nothing but HTML5, CSS3, vanilla JavaScript and the HTML5 Canvas. No
frameworks, no build step, no backend.

> **Facta Non Verba**

## Run it

Just open **`index.html`** in any modern browser. That's it.

(Opening the file directly works because the scripts are plain classic
scripts, not ES modules — there's no server requirement.)

## How to play

A bowler runs in and delivers. A **timing bar** sweeps across the bottom of
the screen — tap, click, or press **Space** to lock your shot:

| Where you stop | Result |
|---|---|
| **Gold** centre | SIX |
| Green | FOUR |
| Lime | 1–3 runs |
| Orange | Dot ball |
| Red edges | Wicket chance |

You have **one wicket**. Make it count, and beat the clubhouse best.

## Features

- Swing-meter timing mechanic (golf-meter-meets-cricket)
- Combo multiplier x1 → x1.5 → x2 → x3 on consecutive boundaries
- **Golden Ball** every 10–15 balls (four = 8, six = 12)
- **Fire Mode** after five boundaries in a row
- Bowled / Caught / LBW dismissals
- Runs, balls, strike rate, combo and high score (saved via `localStorage`)
- Local **leaderboard** (top 10) and **achievements**
- Synthesised SFX (Web Audio) with a mute toggle
- Bowler run-up, ball flight, bat swing, boundary celebrations, stump
  shatter, floating numbers, particles and screen shake
- Fully responsive — desktop click/Space and mobile tap

## Structure

```
index.html
css/style.css
js/ui.js      → storage, Web Audio SFX, leaderboard, achievements, crest
js/ball.js    → the ball: delivery + shot flight, shared scene geometry
js/player.js  → batter, bowler and stumps
js/game.js    → loop, meter, scoring, effects, rendering, input
assets/       → (intentionally empty — all audio/art is generated)
```

Colours: Old Gold `#C9A227` · Black `#000000` · White `#FFFFFF`.
