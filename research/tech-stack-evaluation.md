# Physics & Rendering Stack Evaluation (September 2026)

Survey for a browser vehicle-builder physics game (builder phase + run phase,
procedural terrain, desktop + mobile landscape, static hosting on GitHub
Pages). Version numbers and dates verified against npm and the GitHub API on
2026-09-22; joint features verified from each package's shipped TypeScript
definitions.

**Short version:** use **Box2D v3 via `box2d3-wasm`** for physics, **PixiJS
v8** for rendering, plain HTML/CSS for the builder UI. Rapier is the fallback.
The single change that fixes most wobbly builds is structural, not engine
choice: parts welded together should become **one physics body**, not many
bodies held by joints.

---

## 1. Physics engines

| | Matter.js | Planck.js | Rapier (`@dimforge/rapier2d`) | Box2D v3 (`box2d3-wasm`) | Phaser Box2D | p2-es |
|---|---|---|---|---|---|---|
| Latest release | 0.20.0, Jun 2024 | 1.5.0, Apr 2026 | 0.20.0, Aug 2026 | 5.2.0, Feb 2026 | 1.1.0, Dec 2024 | 1.2.3, Nov 2023 |
| Maintained? | Dormant (278 open issues) | Yes | Very active | Yes, small project (2 authors) | Stalled Apr 2025 | Dormant |
| Solver | Soft position-based | Box2D v2.4 style | Soft solver + sub-steps | Box2D v3 "Soft Step" | Box2D v3 (older) | Own |
| Size (gzip) | ~26 KB | ~55 KB | ~555 KB WASM | ~153 KB WASM + 26 KB JS | ~70 KB | small |
| Wheel hinge + motor | Approximation only | Yes | Yes | Yes, **plus wheel joint with built-in suspension** | Yes | Yes |
| Weld joint | Springy even at max stiffness | Yes but v2 chains wobble | Yes (fixed joint) | Yes, adjustable stiffness | Yes | Yes |
| Joint force readback (breakable joints) | No | Yes | **No** (0.20.0) | Yes (`b2Joint_GetConstraintForce` + events) | Yes | Partly |
| CCD (fast objects) | **None** | Yes (not joints) | Yes | Yes | Yes | No |
| Determinism | Same machine | Fixed timestep | Separate deterministic pkg (cross-platform) | Designed cross-platform | – | – |
| TypeScript | Community types | Full | Full | Generated; C-style API, manual `.delete()` | JS only | Yes |

**Matter.js's bad reputation for constraints still holds** (no release since
June 2024, no CCD; its own issues #706, #515, #272 describe constraints
staying spring-like at max stiffness). Phaser's bundled physics is Matter.js —
this is almost certainly the source of past "physics builder" pain. Avoid.

**Why Box2D v3 fits best:**
- Solver designed for high mass ratios, long joint chains, tall stacks.
- Adjustable weld-joint stiffness.
- Wheel joint gives suspension for free.
- Joint force/torque readable → breakable joints possible.
- Box2D 3.1 added **rolling resistance** — round cargo (pineapples) settles
  instead of rolling forever.
- Chain shapes with ghost vertices stop wheels snagging on terrain-segment
  seams.

**Rapier**: strongest overall project, fastest, best funded. Gaps: no joint
force readback from JS (breakage needs workarounds), WASM ~3.6× larger.

**Planck**: safe pure-JS option, but the older v2 solver is exactly where
welded stick structures sag and wobble.

### The design rule that matters more than the engine

Welding many separate bodies together is the main source of wobble in every
engine:
- Rigidly-attached parts → **one body with several shapes**.
- Joints only where something must move (wheel hinges, suspension) or break.
- To break a structure: split the combined body at run time on impact
  threshold, or weld joint + poll force.

Other settings: fixed 60 Hz step with 4 sub-steps, interpolate rendering;
keep mass ratios within ~10:1; build in metres at a sensible scale.

## 2. Framework

- **Phaser 4** (4.2.1): new faster WebGL renderer, but bundled physics is
  Arcade/Matter — you'd bring your own engine anyway. Heavy for this job.
- **PixiJS v8** (8.21.0): rendering only, doesn't get in the way. Suits the
  split: HTML/CSS builder UI over a Pixi canvas, physics run phase on the same
  canvas. **Recommended**, with a small own state machine (build → run →
  results).
- **Plain Canvas2D**: too slow on mid-range phones with terrain + parallax +
  particles.

## 3. Rendering a modern vector look

- **SVG assets converted to textures at load (recommended)** — rasterize at
  devicePixelRatio (capped 2×), pack into a sprite sheet. Texture limit
  4096 px.
- Pixi's SVG-to-graphics path works for static shapes but lacks text, filters,
  patterns.
- Terrain: textured mesh from the same height points as physics + grass/edge
  strip on top.
- Background: parallax layers of repeating tiles.
- **Avoid DOM SVG for moving game objects** (layout/paint cost per frame on
  phones). Keep DOM/SVG for builder UI only.

## 4. Procedural terrain best practice

1. **Height**: layered seeded simplex noise (`simplex-noise` 4.x); difficulty
   curve grows hills with distance; clamp slopes to stay drivable.
2. **Sampling**: point every 0.5–1 m; chunks of 30–50 m.
3. **Physics per chunk**: Box2D chain shape (or Rapier polyline/heightfield);
   chunks share edge points so no seams.
4. **Streaming**: create 2–3 chunks ahead, destroy behind. Visual mesh and
   decorations from the same points.
5. **Scenery**: seeded random decorations per chunk; 3–4 parallax layers.

## 5. GitHub Pages hosting

- WASM served with correct `application/wasm` type and compression — works.
- Multi-threaded WASM builds need COOP/COEP headers Pages can't set;
  `box2d3-wasm` auto-falls-back to its single-threaded "compat" build, which
  is plenty for one vehicle + cargo. (`coi-serviceworker` exists if threads
  ever needed.)
- Vite: `base: '/<repo>/'`; Rapier would need `vite-plugin-wasm` or the compat
  package.

## Recommendation

**Box2D v3 (`box2d3-wasm`, compat build) + PixiJS v8 + HTML/CSS builder UI +
TypeScript/Vite, hosted on GitHub Pages.**

Risks & mitigations:
1. Small maintainer base → wrap all physics behind an own module (create body,
   create joint, step, read force) so a swap to Rapier/Planck stays possible.
2. C-style API, manual memory freeing → same wrapper handles it.
3. No maintained pure-JS Box2D v3 → WASM-free fallback means Planck (v2
   solver).
4. Most wobble is design, not engine → merge welded parts into single bodies
   from day one.

**Before committing:** 1–2 day spike — 12-rod chassis, 4 motorised wheels,
6 loose pineapples — in both Box2D v3 and Rapier on a mid-range Android and an
iPhone. If equally stable, Rapier's momentum is a fair tiebreaker (designing
breakage around missing force readback).

## Sources

- Matter.js: https://github.com/liabru/matter-js · issues #706, #515, #272 ·
  https://brm.io/matter-js/docs/classes/Constraint.html
- Planck: https://github.com/piqnt/planck.js/ · https://piqnt.github.io/planck.js/docs/
- Rapier: https://dimforge.com/blog/2026/01/09/the-year-2025-in-dimforge/ ·
  https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md ·
  https://rapier.rs/javascript2d/classes/ImpulseJoint.html
- Box2D v3: https://github.com/Birch-san/box2d3-wasm ·
  https://box2d.org/posts/2024/08/releasing-box2d-3.0/ ·
  https://box2d.org/posts/2025/04/box2d-3.1/ ·
  https://box2d.org/posts/2024/02/solver2d/
- Phaser: https://phaser.io/box2d · https://github.com/phaserjs/phaser-box2d ·
  https://phaser.io/news/2026/05/phaser-3-vs-phaser-4
- PixiJS: https://pixijs.com/8.x/guides/components/assets/svg ·
  https://pixijs.com/8.x/guides/concepts/performance-tips
- Hosting: https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/ ·
  https://birch-san.github.io/box2d3-wasm/demo/modern/ (Box2D v3 demo on Pages)
