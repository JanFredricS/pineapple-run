# Pineapple Run — Implementation Plan

A modern remake of *Coconut Run* (Johnson Controls, 2008) with a drinks/tiki
theme. See `research/coconut-run-mechanics.md` for the decompiled original
mechanics and `research/tech-stack-evaluation.md` for the stack rationale.

## Locked decisions

- **Builder:** freehand drawing like the original (draw straws/wheels at any
  size/angle; overlapping parts weld into one rigid body), with touch aids
  (pinch-zoom, generous hit targets, optional angle snap).
- **Physics:** Box2D v3 via `box2d3-wasm` (compat single-threaded build),
  behind an own wrapper module so Rapier stays a swappable fallback.
- **No breakage** — faithful to the original; carts fail by flipping,
  beaching, or spilling cargo. (Breakage possible later as hard mode.)
- **Rendering:** PixiJS v8 (WebGL); SVG-authored assets rasterized to sprite
  sheets at load; builder UI in HTML/CSS overlaying the canvas.
- **Stack:** TypeScript + Vite. **Hosting:** GitHub Pages via Actions.
- **Scope:** builder + run mode, 3 themed levels (beach, kitchen bench,
  workbench), procedural endless mode, map-builder tool, mobile landscape
  support, original recovered course as bonus level, local best scores +
  saved carts, sound & music.
- **Stretch:** gravity zones level (low-grav pockets, gravity "shooter"
  force fields) and a physics bead-ocean section.

## Core mechanics spec (from the original, reskinned)

| Mechanic | Value |
|---|---|
| Engine scale | 30 px = 1 m, gravity (0, 10) |
| Parts | straw (thin bar), sugar cube (box), lime wheel (free circle), bottle-cap wheel (powered, pin joint), umbrella shock (distance joint, freq 5 Hz, damping 0.5) |
| Welding | overlapping straws/cubes/limes merge into one compound body, density 1 |
| Drive | ←/→ (or touch buttons): torque = 20 × wheel mass on all powered wheels, spin capped ±20 rad/s (big wheels = faster) |
| Cargo | 15 pineapples: ellipse-ish circles, density 1, friction 0.9, restitution 0.3, CCD on, rolling resistance on |
| Run flow | Start (physics on) → Release (funnel plug pulled, pineapples drop, timer starts) → reach blender |
| Goal | pineapple touches blender base sensor → run ends; count pineapples past goal line |
| Score | `round(clamp(100 − (seconds − 15), 0, 100) × delivered / 15)` "Efficiency Rating"; red <33, yellow 33–66, green >66 |
| Terrain | ground friction 0.9, restitution 0.3 |
| Timestep | fixed 60 Hz, 4 sub-steps, render interpolation (fixes original's wall-clock unfairness) |

## Architecture

```
src/
  physics/      # ONLY place that imports box2d3-wasm
    engine.ts   # wrapper: world, step, body/joint create+destroy, force query
    compound.ts # ShapeCombiner equivalent: overlapping parts -> one body
  model/        # pure data, no deps — the parallelization seam
    cart.ts     # CartDesign schema (parts list, versioned JSON)
    level.ts    # LevelDef schema (terrain points, props, theme id, zones)
  builder/      # freehand builder (HTML/CSS UI + canvas preview)
  run/          # run phase: spawn, drive, camera, scoring
  render/       # Pixi setup, SVG->texture pipeline, terrain mesh, parallax
  terrain/      # chunked chain shapes, procedural generator (seeded simplex)
  ui/           # screens: title, level select, HUD, results
  audio/        # music loops, SFX
  app.ts        # state machine: title -> select -> build -> run -> results
tools/
  mapbuilder/   # separate Vite page: draw height profile, place props, export LevelDef JSON
assets/svg/     # authored art, per theme
levels/         # *.json premade levels (authored via mapbuilder)
```

The **`model/` schemas (CartDesign, LevelDef) are defined in Slice 0** and
frozen early — they are the contract that lets every other slice proceed in
parallel.

## Slices

Dependency shape: S0 blocks everything; S1–S5 run in parallel after S0;
S6–S8 integrate; S9 stretch.

### S0 — Foundation (blocking, small)
Vite + TS + PixiJS scaffold; box2d3-wasm integrated behind `physics/engine.ts`
(create world/bodies/joints, fixed-step loop with interpolation, debug-draw
overlay); `model/` schemas for CartDesign + LevelDef (versioned);
app state machine skeleton; GitHub Actions deploy to Pages (game live from
day one). **Includes the stability spike:** 12-straw chassis, 4 powered
wheels, 15 pineapples, washboard terrain — verified stable on desktop +
a real phone before S1–S5 start. Exit criteria: deployed page shows the spike
cart driving on test terrain at 60 fps.

### S1 — Physics gameplay core (parallel)
Compound-body welding (`compound.ts`) from a CartDesign; powered wheel pin
joints + umbrella shocks; drive controls (keyboard + touch) with torque/spin
cap; pineapple spawner + funnel with plug; goal sensor + delivered counting;
camera follow (right-most body, smoothing 0.1). Test harness page that loads
a CartDesign JSON + LevelDef JSON directly — no builder needed.

### S2 — Builder (parallel)
Freehand tools: straw, cube, lime, powered wheel, shock; click-drag sizing,
min sizes; overlap detection preview; delete part / clear all (confirm);
"Example Cart" button (port of the original sample); "missing wheels"
validation; pinch-zoom + pan, angle-snap toggle; HTML/CSS tool palette
(napkin-sketch styling hooks); outputs a CartDesign. Save/load named carts
(localStorage). Works standalone against mock start-area render.

### S3 — Terrain & levels (parallel)
Chunked chain-shape terrain from LevelDef points (shared edge vertices, ghost
vertices — no seams); procedural generator: seeded layered simplex, distance
difficulty ramp, slope clamping, feature grammar (valleys, launch lips,
washboards, kickers — mirroring the original's course vocabulary); streaming
create-ahead/destroy-behind for endless mode; **map-builder tool**
(`tools/mapbuilder`): draw/edit height profile, place props/zones, test-roll a
ball, import/export LevelDef JSON. Port the recovered 71-vertex original
course (`research/original-game-files/terrain.txt`) to a LevelDef.

### S4 — Art & rendering (parallel)
SVG asset pipeline (rasterize at devicePixelRatio ≤2, sprite sheets); part
art (straws, sugar cubes, lime wheels, bottle caps, umbrellas, pineapples);
terrain skinning: textured mesh from height points + edge strip per theme;
3–4 parallax background layers per theme; three themes: **beach** (sand,
sea, palms), **kitchen bench** (countertop, tile wall, morning light),
**workbench** (rulers/planks, pegboard, blueprint homage); blender goal
animation; napkin-sketch builder backdrop. Deliverable includes a style-guide
page rendering every asset in all themes.

### S5 — UI, flow & scoring (parallel)
Title, level select (locked/best-score badges), HUD (timer, pineapple count,
Give Up pill), Release button flow, results screen (Efficiency Rating with
color bands, retry/next), landscape-lock prompt on portrait phones, PWA
manifest + icons; local best scores per level.

### S6 — Integration & premade levels (after S1–S5)
Wire builder → run → results end-to-end; author the 3 premade levels in the
map builder (beach = classic-style course; kitchen = cutting-board ramps and
gaps; workbench = reskinned original 71-vertex course as bonus, plus its own
level); difficulty pass; endless mode entry with seed display/entry.

### S7 — Audio (parallel with S6)
Per-theme music loops (cross-fade by course quarter, like the original), SFX:
straw clatter, pineapple bounces, wheel motor, blender whir, win/lose stings.
Web Audio, mobile unlock-on-gesture handling.

### S8 — Mobile & performance hardening
Real-device pass (iOS Safari + Android Chrome): touch drive buttons sizing,
builder gestures, 60 fps check on mid-range hardware, texture memory audit,
load-time budget (<3 s on 4G), Pages cache headers sanity.

### S9 — Stretch: exotic physics level(s)
Gravity zones via per-body `gravityScale` sensors (low-grav pockets) and
directional force fields ("gravity shooters"); bead-ocean section (300–600
small sleeping-enabled beads, adaptive count by device perf); one new level
("Zero-G Tiki Bar") using both, with its own backdrop.

## Risks

1. **box2d3-wasm bus factor** — mitigated by the wrapper seam; S0 spike
   validates before deep investment.
2. **Freehand builder on touch** — S2 ships zoom/snap aids; S8 validates on
   real devices; preset "Example Cart" always gives a playable fallback.
3. **Bead ocean mobile perf** — stretch-only, adaptive cap, measured in S9.
4. **Art volume (3 themes × parallax × parts)** — S4's style-guide page keeps
   it reviewable early; themes share geometry, differ in palette/textures.
