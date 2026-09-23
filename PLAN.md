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
| Timestep | fixed 60 Hz, 4 sub-steps, render interpolation |

### Clock & pause policy

`seconds` is **simulation time**: steps elapsed since Release × 1/60 — never
wall clock. The accumulator caps catch-up at 250 ms; beyond that, excess real
time is dropped (slow devices play in slight slow-motion rather than losing
score). `visibilitychange`/blur pauses the whole simulation and clock and
clears all input state. This is what actually fixes the original's
fast-PC-scores-better quirk.

### Endless mode rules

Terrain generation alone is not a game; the loop is: drive as far as you can
**while at least one pineapple is still aboard** ("aboard" = within the cart's
bounding box + margin, re-checked per second). Run ends when the last
pineapple is lost (touches ground and stays out for 3 s, or falls off the
kept-terrain window) or on Give Up. Score = furthest x reached in metres while
carrying, with a small bonus multiplier for pineapples still aboard at the
end. Best distance stored per seed and overall. No checkpoints in v1.

### Deliberate deviations from the original

Flagged so "faithful" stays honest:

1. **Simulation-time scoring** (above) — the original used wall clock.
2. **Rolling resistance on pineapples** — small coefficient, tuned so a flat
   open bed still spills on the washboard like the original; it only stops
   infinite rolling on flats. Tuned during the S0 spike.
3. **Pineapple visuals are oval, collision stays a circle** (sprite ≠ shape) —
   circle collision matches original behaviour and is cheaper.
4. **Wheel/part friction & restitution (0.9/0.2 and 0.6/0.2)** were not
   recovered from the original and are our own tuning constants; golden
   scenario thresholds depend on them, so changing them re-baselines tests.

## Architecture

```
src/
  physics/      # ONLY place that imports box2d3-wasm
    engine.ts   # wrapper: world, step, body/joint create+destroy, force query
    compound.ts # ShapeCombiner equivalent: overlapping parts -> one body
  model/        # pure data + pure functions, no deps — the parallelization seam
    cart.ts     # CartDesign schema (parts list, versioned JSON)
    level.ts    # LevelDef schema (terrain SPANS, props, theme id, zones)
    attach.ts   # resolveAttachments(CartDesign) -> CompoundSpec (see below)
    score.ts    # scoring formulas (level + endless) as pure functions
    validate.ts # schema validation + version migration for cart/level JSON
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

### The S0 contracts (what parallel work actually depends on)

Data schemas alone don't decouple the slices; S0 freezes **five contracts**,
each with a mock implementation so every slice can run standalone:

1. **CartDesign / LevelDef schemas** — versioned JSON. LevelDef terrain is a
   list of **polyline spans**, not one height profile, so gaps (kitchen
   level!) are first-class in the schema, the generator, the map builder, and
   the renderer alike. Includes zone regions (used by S9 gravity zones).
2. **`resolveAttachments(CartDesign) → CompoundSpec`** — one pure function,
   used by BOTH the builder preview (S2) and physics construction (S1), so
   what you see welded is what gets welded. It pins the geometry rules:
   overlapping straws/cubes/limes merge; a powered wheel's centre over a part
   pins to the **topmost (most recently drawn) overlapped part**; a shock end
   within 10 px of a wheel/circle centre snaps to that centre, else attaches
   to the topmost overlapping body, else the shock is invalid; deleting a part
   re-resolves the whole design; enumerated validation errors (no wheels,
   floating shock, disconnected islands, shock-within-one-body, part too
   small). The error union is closed: widening it later is a contract change.
3. **Run lifecycle interface** — S1 owns simulation and **emits events**
   (`started`, `released`, `pineappleLost`, `goalReached(delivered)`,
   `gaveUp`); S5 owns UI state, consumes events, and calls into `model/score`.
   Scoring math lives in `model/score.ts` only — no slice reimplements it.
4. **Render snapshot interface** — physics → renderer per-frame transform
   list (body id, interpolated position/angle), plus coordinate transform
   helpers (world metres ↔ screen px). S4 renders from snapshots, never from
   physics objects.
5. **Validation/persistence contract** (`model/validate.ts`) — every load path
   (localStorage carts/scores, level JSON, map-builder import) validates +
   migrates by version; corrupt or future-versioned data is rejected with a
   surfaced, recoverable error (discard-with-toast for saves, error panel in
   the map builder). No consumer ever feeds unvalidated JSON to physics.

## Slices

Dependency shape: S0 blocks everything; S1–S5 run in parallel after S0;
S6–S8 integrate; S9 stretch.

### S0 — Foundation (blocking; not "small" — budget it honestly)
Vite + TS + PixiJS scaffold; box2d3-wasm integrated behind `physics/engine.ts`
(create world/bodies/joints, fixed-step loop with 250 ms catch-up cap,
visibility pause, interpolation, debug-draw overlay); **the five S0 contracts
above, with mocks**, including production `resolveAttachments` +
`physics/compound.ts` (CompoundSpec → bodies/joints); app state machine
skeleton; GitHub Actions deploy to Pages (game live from day one).
**The stability spike uses the production path**: a hand-written CartDesign
(12-straw chassis, 4 powered wheels) run through `resolveAttachments` +
`compound.ts` — not hand-assembled bodies — with 15 pineapples over washboard
terrain, verified stable on desktop + a real phone before S1–S5 start. Also
tunes the pineapple rolling-resistance coefficient. Exit criteria: deployed
page shows the spike cart driving on test terrain at 60 fps, and the contract
mocks + `model/` unit tests are green.

### S1 — Physics gameplay core (parallel)
Builds on S0's `compound.ts`: umbrella shocks; drive controls (keyboard +
touch) with torque/spin cap and full input-clear on cancel/blur; pineapple
spawner + funnel with plug; goal sensor + delivered counting + "aboard"
tracking; emits the run-lifecycle events (S0 contract 3); camera follow
(right-most body, smoothing 0.1); kill-plane handling for bodies leaving the
world. Test harness page loads CartDesign + LevelDef JSON directly — no
builder needed. **Re-runs the S0 stability gate** on its final joint/shock
implementation. Ships headless scenario tests (see Testing).

### S2 — Builder (parallel)
Freehand tools: straw, cube, lime, powered wheel, shock; click-drag sizing,
min sizes; live weld/attachment preview driven by S0's `resolveAttachments`
(never its own geometry); delete part / clear all (confirm); "Example Cart"
button (port of the original sample); validation surface for the enumerated
errors; HTML/CSS tool palette (napkin-sketch styling hooks); outputs a
CartDesign. Save/load named carts via `model/validate` (localStorage, with
quota/corruption handling). **Gesture arbitration state machine**: one
pointer draws; a second pointer landing within the grace window cancels the
in-progress draw and becomes pinch-zoom/pan (no accidental part commit);
pointer capture on tool buttons; all input state cleared on blur, cancel,
and phase transitions; angle-snap toggle. Works standalone against mock
start-area render.

### S3 — Terrain & levels (parallel)
Chunked chain-shape terrain from LevelDef **spans** (shared edge vertices,
ghost vertices — no seams; spans make gaps real in physics and visuals);
procedural generator: seeded layered simplex, distance difficulty ramp, slope
clamping, feature grammar (valleys, launch lips, washboards, kickers,
occasional gaps — mirroring the original's course vocabulary), fully
deterministic per seed. **Streaming with body-aware retention**: keep every
chunk in the window `[min live-body x − margin, max live-body x + ahead]` —
not just ahead of the camera — so trailing pineapples never lose their
ground and reverse driving regenerates identical terrain from the seed;
renderer chunk cleanup mirrors physics cleanup. **Map-builder tool**
(`tools/mapbuilder`): draw/edit terrain spans (including splitting a span to
make a gap), place props/zones, test-roll a ball, import/export LevelDef
JSON through `model/validate`. Port the recovered 71-vertex original course
(`research/original-game-files/terrain.txt`) to a LevelDef.

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
Title, level select (locked/best-score badges), HUD (sim-time timer,
pineapple count, Give Up pill), Release button flow, results screens for both
level runs (Efficiency Rating with color bands, retry/next) and endless runs
(distance + carry bonus). S5 **consumes S1's lifecycle events and calls
`model/score`** — it owns no simulation and no scoring math. Landscape-lock
prompt on portrait phones, PWA manifest + icons; best scores per level and
per endless seed via `model/validate`. Developed against the S0 mock event
stream.

### S6 — Integration & premade levels (after S1–S5)
Wire builder → run → results end-to-end (mocks replaced by real
implementations of the same contracts); author the 3 premade levels in the
map builder (beach = classic-style course; kitchen = cutting-board ramps and
gaps; workbench = reskinned original 71-vertex course as bonus, plus its own
level); difficulty pass; endless mode entry with seed display/entry.
**Integration acceptance checklist** (all automated where possible): example
cart completes each premade level; scoring boundary cases (0 delivered,
15/15, >115 s); retry fully resets physics/render/input state; save → reload
→ rerun a cart is identical; gap levels have no invisible bridges; endless
reverse-then-forward drive is seamless; a cart of two boxes that do NOT
touch, connected only by springs, builds as two rigid bodies whose
relative motion is real (spring compresses/extends under load and
bounce — the original's articulated-cart charm; amendment 2026-09-22).

### S6V — Whole-game verification (after S6; plan amendment 2026-09-22)
Two independent checks of the integrated game, per the user's directive:
1. **Wide cross-seam audit (Codex sol-medium)**: one fresh-context review
   of the COMPLETE merged main — not per-slice; explicitly across the
   seams (builder→attach→physics, physics→snapshot→render, terrain
   streaming→render chunks, run events→UI/scoring, SW/precache→deploy),
   the INTEGRATION.md ledger items as its checklist, and the premade
   level data.
2. **Live playtest (Opus agent, browser)**: actually play each premade
   level and endless with several cart designs (example cart, minimal
   cart, spring-heavy cart); verify feel against the recovered original
   constants; screenshot each level; report tuning issues into S6T's
   backlog rather than fixing inline.

### S6T — Tuning & playability (after S6V; plan amendment 2026-09-22)
A dedicated slice for making it FUN, driven by S6V's playtest backlog:
- Physics feel pass: torque cap, shock frequency/damping, friction,
  restitution — small, recorded deviations from the original allowed
  where they play better; each change re-run against the S1 scenario
  timings.
- **Level excitement validation**: each premade level must contain
  tricky, distinct challenges (washboards, clearable-but-scary gaps,
  launch lips, at least one risk/reward shortcut); an automated
  "excitement audit" (feature census per level: counts + spacing of
  hazards vs. flat stretches) plus playtest judgment. Endless generator
  difficulty ramp checked at 3 depths.
- Builder part tuning: sizes, masses, costs of straws/boxes/wheels/
  springs so varied carts are viable.
- Spring/shock ART decision (RESOLVED 2026-09-22, user choice):
  replace the umbrella spring with a **Hawthorne-strainer coil spring**
  — the coiled spring off a bartender's Hawthorne strainer, drawn as a
  metal coil with compressed/rest/stretched states (same three-state
  scheme the umbrella used). Swap is art-only (artCatalog + SVGs);
  physics untouched.

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
STATUS (S9 implementer, 2026-09-23): done on branch slice-s9. engine.ts
opened a second time (gravity scale, applyForceToCenter, sensors) and
re-frozen; "adaptive count" is a static device-capability bucket chosen once
at level load (300/450/600), never adjusted mid-run (determinism). Tiki Bar
unlocks after Workbench; the Original now needs all four campaign courses.
See TUNING.md "S9" and RESIDUALS R23–R26.

## Testing strategy

- **Unit (Vitest)**: everything in `model/` is pure and fully tested —
  `resolveAttachments` (overlap cases, wheel/shock snapping, delete
  re-resolution, invalid designs), scoring boundaries, validation/migration,
  terrain-generator determinism (same seed → identical spans).
- **Headless physics scenarios (Node + box2d3-wasm)**: golden runs asserted
  by step count — example cart on flat ground reaches x within N steps ±
  tolerance; washboard spill test (flat open bed must lose pineapples);
  stability test (spike cart, no joint divergence over 60 s). These guard the
  highest-risk behaviour (welding/joints) against regressions no visual check
  would catch.
- **Per-slice acceptance**: each slice's harness page has a written checklist;
  S6 owns the cross-slice checklist above.
- **Device pass (S8)**: manual matrix — iOS Safari + Android Chrome, one
  mid-range device each, 60 fps and gesture correctness.

## Risks

1. **box2d3-wasm bus factor** — mitigated by the wrapper seam; S0 spike
   validates before deep investment.
2. **S0 is the real long pole** — it carries the contracts, the production
   welding path, and the spike. Underscoping it re-serializes S1–S5; treat
   contract changes after S0 as stop-the-line events.
3. **Freehand builder on touch** — S2 ships gesture arbitration + zoom/snap;
   S8 validates on real devices; "Example Cart" is the playable fallback.
4. **Bead ocean mobile perf** — stretch-only, adaptive cap, measured in S9.
5. **Art volume (3 themes × parallax × parts)** — S4's style-guide page keeps
   it reviewable early; themes share geometry, differ in palette/textures.
