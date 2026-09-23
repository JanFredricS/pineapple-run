# Integration notes for S6

Cross-slice decisions and reconciliations collected during S1–S5 parallel
work. S6 works through this list; each item is a plan-owner ruling.

## Contract amendments (additive, apply at S6 merge)

1. **`RunEventSource` gains a `simTime(): number` getter** (S5 request #1).
   The HUD currently takes a separate `clock` callback; S1's controller
   already has the value. Amend src/model contract 3 + mock, wire directly.
2. **Endless progress**: add `furthestMetres(): number` getter to the run
   controller surface (S5 request #2). Not an event — polled for display.

## Endless scoring ruling (S5 request #3)

- The canonical recorded/compared metric is **raw furthest distance while
  carrying** — ScoreBook semantics unchanged.
- The carry bonus is **display flavour only** (shown on the results screen,
  never part of the best comparison, regardless of how the run ended).
  This removes the reward-for-quitting exploit and the stored-vs-displayed
  inconsistency. Update src/model/score endless helper accordingly in S6
  (small change; re-run S5 display tests).

## S1 audit rulings (plan owner, 2026-09-22)

- **Lost is advisory in level runs**: the lost flag drives HUD/aboard counts
  only; it never excludes a pineapple from triggering the goal or being
  delivered. Catapulted/recovered cargo counts, as in the original.
- **Run mode is explicit**: RunController takes `mode: "level" | "endless"`.
  Endless ends when the last pineapple is lost, via a new terminal
  `allLost` lifecycle event — an authorized ADDITIVE amendment to contract 3
  (event + mock + docs). S5's remaining===0 inference is replaced by this
  event at S6 wiring.

## S6T playability refinements (implementer, 2026-09-23 — for plan-owner review)

- **Goal settle window** (backlog #2): the first base-sensor touch freezes the
  clock (rating time = first touch, as before) and starts a
  `GOAL_SETTLE_SECONDS` = 2 s window. `goalReached` fires at the end of the
  window, or early once every live pineapple is past `lineX`, with delivered
  counted at that point. Give Up during the window finalises the goal. The
  event's shape is unchanged; only the moment it fires has moved.
- **Level `allLost`** (backlog #16): this refines the "lost is advisory"
  ruling and does not break it. A level run ends with `allLost` only when
  nothing is recoverable for `LEVEL_ALL_LOST_SECONDS` = 2 s: every pineapple
  is lost AND either the cart is gone or no pineapple body is left. A lost
  pile with a live cart still keeps the run going, because bulldozing it in
  counts. Results show "All pineapples lost — no score recorded" (unscored,
  like Give Up).
- **Retry mid-run** (backlog #5): AppState gains 'run' + startRun → a fresh
  run (R key, and the Retry button of the stuck hint).

## S9 exotic physics (implementer, 2026-09-23 — for plan-owner review)

- **Second engine.ts opening**: gravity scale, applyForceToCenter, sensors
  (header lists them; re-frozen). Worlds without field zones are created
  exactly as before (no sensor visitors), so pre-S9 physics is bit-identical.
- **Contract additions** (additive): `ZoneKind` gains `'beads'`; `BodyRole`
  gains `'zone'` and `'bead'`; `ThemeId` gains `'tiki'`; census
  `HAZARD_KINDS` gains `lowGravity`, `shooter`, `beads`;
  `RunSessionOptions.beadCount` / `RunScreenDeps.beadCount` (test override;
  no URL parameter, the run screen reads no query string).
- **Unlock order**: beach → kitchen → workbench → tikibar; the Original
  bonus now unlocks when all FOUR campaign courses are cleared (catalog's
  generic rule; flow/acceptance tests updated to say so).
- **Music**: tikibar uses the beach loop (marimba/shaker/lazy reggae bass fit
  a slow, floaty course; endless's steel drum escalates).
- **Beads are furniture**: not scored, not streaming anchors (the bead
  zone's fixed ends are, via `RunSession.furnitureXs`), swept below killY.
- Builder untouched; renderer reads only the manifest (zone tag in partIds).

## Conventions to reconcile

3. **Y-origin**: S2 builder assumes design y = 0 is the ground line;
   the spike level used a different offset. S6: set `LevelDef.cartStart`
   to ground height at start for all levels; verify spike/run fixtures.
4. **Course ids** (S5 fixed them): `beach`, `kitchen`, `workbench`,
   `original`, endless as `levelId = "endless:<SEED>"`, seed charset
   1–16 chars of A–Z 0–9 - _. S3's premade levels must use these ids.
5. **Unlock rule** (S5): next course unlocks when previous best rating > 0;
   original-course bonus unlocks when all three campaign courses cleared.
6. **Build area / funnel placement**: S2's build area (360×210 px) and mock
   funnel are placeholders; S1's funnel treats `LevelDef.funnel` as outlet
   centre (2.4 m outlet, 70° frictionless walls — narrower jams). S6 aligns
   the builder start area with each level's start plateau + funnel.

## Known gaps S6 must cover

7. **Blender solid body**: S1 built the goal sensor geometrically but no
   solid blender prop (original bounced cart parts off the shredder). S6
   adds the blender collision body + the S4 blender animation at the goal.
8. **Rotate-overlay pause**: S5 exposes `onPortraitChange` — S6 wires it to
   the S0 clock's pause causes.
9. **HUD mount**: use `mountRunHudScreen` from src/ui/appScreens.ts.
10. **"All pineapples lost" in level runs**: no event; S5 pulses Give Up
    (original behaviour: run continues). Endless: run ends on last loss
    (S1 handles). Verify both paths in integration.

11. **Renderer needs the cart design**: S4's manifest has no joint data, so
    shocks render only via `Scene.setCartDesign(design)`; without it, part
    art is guessed from shape. S6 must always call `setCartDesign` when
    starting a run (S4 audit confirmed the fallback is safe but wrong-looking).
12. **Solid props semantics** (S1 fix cycle 1): `src/run/props.ts` treats
    `LevelDef` prop `position` as the box CENTRE, rotated by `angle`;
    non-positive sizes are skipped. S3 level authoring and the S4 renderer
    must use the same convention — verify at S6.
13. **Kill-plane semantics** (S1 fix cycle 1): only the chassis (heaviest
    rigid body) crossing killY ends the cart; other bodies are removed
    individually with their joints; detached parts remain as debris bodies.
    S6/S8: check debris growth over long endless runs.
    STATUS: S6 verified bounded debris/body counts headlessly
    (test/integration/debris.test.ts); S8 owns long-duration perf
    profiling — see "S6 status" below.

## Incidents / environment

- S1's first browser check attached to another session's headless Chrome
  (port 9333, tender-analysis) and navigated it; restored via history but
  page state may be lost. All later browser checks use isolated instances
  with a port-collision guard.

## S6 status (implementer notes)

- #3: every shipped level (premade, original, endless) has `cartStart` = the
  ground under design (0, 0); `src/game/startArea.ts` holds the shared
  start-area rules (funnel outlet = cartStart + (115, −225) px). The S0
  spike/run-harness fixtures keep their own cart offset (the spike cart's
  wheels reach design y = +52 px); they are dev fixtures, not App levels.
- #7/#12: the blender is a solid LevelDef prop (centre convention); S4 places
  the BlenderView on its bottom-centre and draws other solid props centred.
- Funnel: manifest 'prop' bodies are not drawn by S4, so the run screen passes
  `funnelGeometry` to `SceneRenderer.setFunnel` (plug hidden on release).
- Audio: `src/game/audioHooks.ts` is the no-op seam for S7 (TODO(S7)).
- #13 (debris growth), S6 coverage — `test/integration/debris.test.ts`: an
  endless run (ABC123) with a spring-heavy cart (example cart + a shock-held
  arm carrying a tip held only by the arm). A scripted crash severs the arm's
  shocks and drops it past killY; the controller removes it, the tip becomes
  detached debris, and the cart drives on for exactly 7,200 more steps
  (asserted: the run stays `released` throughout; 2 min sim, ~550 m).
  Enforced: removed/detached parts never come back (cart body count
  non-increasing); the debris is NOT a streaming anchor and is NOT deleted
  on detach — it rests on its terrain (>= 10 s, measured 26.8 s) until its x
  leaves the loaded window, and is removed only after that, 2–6 s later
  (measured 2.5 s: the fall to killY); `manifest().bodies` always equals the
  world's bodies; the world body count in the second half of the run is no
  higher than in the first (measured max 25 / 24: terrain window + cart +
  live pineapples).
  Remaining for S8: long-duration performance profiling (frame time, WASM
  heap via `heapBytesInUse()`, GC pressure from per-frame snapshots/renderer
  views over 10+ minute endless runs, on real devices). Reason: that is a
  timing/device measurement, not a correctness property a headless unit test
  can assert; the S6 test only proves body/manifest counts stay bounded. Also
  unexercised: debris that comes to rest INSIDE the kept terrain window (e.g.
  the cart reversing to park next to it) lives until the cart moves away —
  bounded by the cart's own part count, so not a growth risk.
- Run screen (audit fix 1): Pixi app, theme textures and the RunSession load
  via `acquireRunResources` (allSettled) — a created session is destroyed if
  any other loader fails; any setup failure unwinds a LIFO cleanup stack.
  `window.__prRun` exists only in `import.meta.env.DEV` builds (browser
  checks use `npm run dev`).
- Screen init failures (audit round 2): run and build screens never leave a
  blank host — `src/game/errorScreen.ts` shows the error with "Try again"
  (re-mount in place) and "Back to builder" / "Levels"; `App.mount` catches
  anything else (e.g. a lazy chunk failing offline) with a Reload prompt.
- Builder Fit (audit fix 3): `fitArea` frames the build area plus every funnel
  wall/plug vertex (12 px clearance above the walls' top).
