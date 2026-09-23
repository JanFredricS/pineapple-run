# Tuning log (S6T, S8a, UX1)

Every constant changed in slice S6T (Tuning & playability), as **old → new → why**.
The input was the headless-Chrome playtest in `research/s6t-playtest-backlog.md`; `#n` refers to its items.
"new" means the constant did not exist before.
`src/physics/engine.ts` (the Box2D wrapper) was unchanged in S6T; S8a opened it once (see "S8a" at the end).
The 71 recovered original-course vertices are unchanged.

## Physics feel

| Constant (file) | Old → new | Why |
|---|---|---|
| `SHOCK_HERTZ` (src/physics/compound.ts) | 5 → **8** | #4: the shock-hung wheels folded under the bed. A spring 2.56× stiffer keeps the wheel where the designer put it. |
| `SHOCK_DAMPING` (compound.ts) | 0.5 → **0.7** | #4: the shocks oscillated after every landing. 0.7 settles in about one bounce. |
| `SHOCK_MIN_RATIO` / `SHOCK_MAX_RATIO` (compound.ts) | new: **0.8 / 1.15** × rest length | #4: the shocks had no travel limits. These were emulated bump stops (**S8a: now real Box2D distance-joint limits, same bounds**). Box2D distance-joint limits sit behind the frozen engine.ts. The limits are tighter than the playtest's suggested 0.6–1.3: the example cart's two-shock triangle can flip, folding the wheel under the bed, at 1.22 / 0.88 of rest, and 0.8–1.15 cannot reach that. On the scratch matrix (example and articulated carts, 4 courses, 5 driving styles) finishes were 16 with no stops, 14 at 0.6–1.3, and 23 at 0.8–1.15. |
| `SHOCK_STOP_BIAS` / `SHOCK_STOP_MAX_PUSH` (compound.ts) | new: **0.2 / 1 m/s** (**removed in S8a**) | #4: each step a bump stop removes 20% of the overshoot, capped at 1 m/s, so a stop never launches the cart. |
| Bump stops on a damaged cart (`CartInstance.applyShockStops`, controller.ts) | new (**removed in S8a**: real limits hold on a damaged cart with no call) | Audit-1 #2: once any non-chassis body fell past the kill plane, the controller's survivors-only drive branch skipped `preStep`, so the surviving shocks lost their limits. S6T made it call `applyShockStops` every damaged step (**S8a removed that call and the API: the real Box2D limits live in the joints and need no call**). test/integration/damagedShocks.test.ts drops a wheel past the kill plane and keeps driving. Plain driving stays inside 0.8–1.15. Under ±14 m/s wheel kicks the worst ratio was 1.25 with the S6T stops and 1.28 in a control run with them stubbed out (S8a real limits: 1.23). |
| springCart test tolerance (test/physics/springCart.test.ts) | 0.05 → **0.03** m | A consequence of #4. The stiffer, better-damped shock swings about 0.043 m on the reference drop instead of about 0.1 m. That is still ten times what a welded pair shows (under 0.005 m), so the test still tells a spring from a rod. |
| Wheel/pineapple friction | 0.9, **unchanged** in S6T | #9 was deferred (engine.ts frozen). **S8a: 0.3** — see "S8a". |

## Run rules

| Constant (file) | Old → new | Why |
|---|---|---|
| `GOAL_SETTLE_SECONDS` (src/run/controller.ts) | new: **2 s** | #2: the goal rule ended the run the moment the cart touched the goal, cutting delivery short. Pineapples still in flight now get 2 s to land in the pit. |
| `LEVEL_ALL_LOST_SECONDS` (controller.ts) | new: **2 s** | #16: a level run with nothing left to deliver never ended. It now ends as `allLost` after 2 s, matching endless. |
| `STUCK_SECONDS` / `STUCK_DISPLACEMENT` (src/run/stuck.ts) | new: **5 s / 0.3 m** | #5: there was no feedback when stuck. A live run whose cart moves less than 0.3 m in 5 s of sim time shows the "Stuck?" hint with Retry. R retries on the run and results screens. |
| `GAP_WALL_LEAN` (tools/levels/track.ts, src/terrain/generator.ts) | new: **0.05 m** | #1: gaps get side walls down to killY. The walls lean 0.05 m into the hole because chain x must strictly increase. |

## Camera and HUD

| Constant (src/game/framing.ts) | Old → new | Why |
|---|---|---|
| `READY_PAD` | new: **{top 76, bottom 100, side 24} px** | #13: before Release the camera frames the funnel and the cart, and leaves room for the HUD and the Release button. |
| `READY_MARGIN_M` | new: **0.6 m** | #13: a world-space margin around the funnel-and-cart box. |
| `READY_BLEND_SECONDS` | new: **0.9 s** | #13: after Release, the camera blends from the ready framing to the follow camera. |
| `READY_MIN_ZOOM` | new: **0.35** | #13: never zoom out below this just to fit the funnel too. |

Ready-framing policy (audit-1 #3, `readyFrame`):
- The cart box is the union of real per-body shape AABBs (`bodyAabb`: circles, polygons and chains, rotated as the engine does). It used to be body origins plus a fixed 1 m.
- The camera frames the funnel and the cart together when both fit at `READY_MIN_ZOOM` or closer.
- When the cart has been driven too far from the funnel for that, it frames the cart alone.
- The cart is always fitted whole, even below 0.35 for a huge cart.
- Tested with the example cart and a 6 m mast cart on 5 courses × 3 viewports: every shape point is on screen.

The Release button also moved to bottom centre, clear of the funnel (#13, CSS).

## Crest rounding (new: src/terrain/rounding.ts; used by the Track DSL and the generator)

| Constant | Value | Why |
|---|---|---|
| `CREST_SLOPE_DELTA` | **0.6** | #10: a crest is sharp when dy/dx grows by more than 0.6 at a vertex. This is the threshold the playtest identified. |
| `CREST_RADIUS` | **1.5 m** | #10: the arc radius. It is enough for a 3 m wheelbase not to high-centre. |
| `CREST_MIN_SEGMENTS` | **3** | #10: the arc has at least 3 segments. |
| `CREST_MAX_SEGMENTS` | **16** | More segments are added until no slope jump exceeds `ROUNDED_MAX_JUMP`. Kicker apexes needed up to 16; with 3 they left jumps of 0.60–0.77. |
| `ROUNDED_MAX_JUMP` | **0.5** | Rounded crests must stay clearly under the 0.6 threshold. |
| `CREST_MAX_TANGENT_FRACTION` | **0.45** | The tangent length is capped at 45% of each neighbouring segment, so neighbouring arcs never overlap. Short step lips get a smaller radius. |

Kept sharp: washboard teeth (the teeth are the feature), the goal pit, span end points, and valleys.

## Premade courses (tools/levels/premade.ts → levels/*.json)

| Item | Old → new | Why |
|---|---|---|
| Beach washboard | `washboard(9, 0.5, 4/3)` → **`washboard(9, 0.3, 1)`** | Brief: a 0.3 m washboard with 1.0 m pitch, so beach stays the easiest level. The old one trapped slow articulated carts (#3, run 6). |
| Beach opening | none → **`ease(12, 1.5, 'valley').ease(12, -1.5)`** after the plateau | A first swoop, so the opening is not a dull stretch (excitement audit). |
| Beach 150–190 m | `ease(14, 1.5, 'valley').ease(22, -4, 'ramp')` → **the dune jump**: `ease(12,1.5,'valley').kicker(2.5,0.9,1.5,0.9,'launchLip').flat(8).line(3.5,-2.8,'ramp').ease(12,-1)` | #3: holding right was optimal. The launch lip at about 175 m throws a cart doing more than 10 m/s into a 0.8-slope dune face. A 1.0 slope trapped slow articulated carts, so 0.8 was used. The brief asked for a hazard around 180 m that punishes more than 10 m/s. |
| Workbench 150–190 m | `hump(6,0.7) ×3, ease(20,-4)` → **the saw-horse jump**: `hump,hump,kicker(2.5,0.9,1.5,0.9,'launchLip').flat(8).line(3.5,-2.8).ease(14,-1.2)` | #18: pacing beat flooring it by only 8.6 points. |
| Kitchen | geometry unchanged until audit-1 (the sink pool below) | #1 side walls only. Pace line retuned (below). |
| Beach 58–63 m, workbench 23–27 m | `flat(5, 'crest')`, `flat(4, 'crest')` → **plain `flat`** | Audit-1 #1: these were flat tops mislabeled as crests. Beach's 104 m lip was relabeled `drop`, which is what its geometry is. Its 210 m `ease(8, 2.2, 'drop')` was too gentle to be a drop and is gone (see the next row). |
| **Risk/reward shortcut, all three** (`pool()` in premade.ts, `Track.pool`) | new: a 1.5 m take-off lip over a pool 1.5 m below the approach. The pool has a 6 m washboard floor, a 4 m climb out to a rim 1.5 m below the lip, and a 10 m landing slope. Floors: beach `washboard(6, 0.3, 1)` sand at 206–232 m (it replaces the plateau and drop at 200–219); kitchen `washboard(6, 0.35, 1)` sink at 158–184 m; workbench `washboard(6, 0.4, 1)` tray at 200–225 m | Audit-1 #4, PLAN S6: every premade level needs an optional faster-but-riskier route. At 12 m/s the cart flies over the floor, taking about 2.0 s through the section. At 5 m/s it rolls down, crosses the floor and climbs out, taking 4.6–5.1 s. Both routes deliver 15/15. A 2 m-deep pool with a 3.5 m climb made the careful route lose 1–3 pineapples on the climb, which was too steep, so it was made gentler. The risk sits at 10–11 m/s: the cart lands on the climb face, and some runs lose 1 pineapple. |
| All three, finish | `PIT` + **`wall: 8, shelf: 30`** (a flat 30 m shelf from the wall top) | #17: past the goal there was a hairline wall into a void. It now renders as solid ground. |
| Pace notes (test data) | slow per-feature speeds (2.5–10 m/s) → **skilled lines**: beach `0:12 58:8 80:12 98:8 112:12 163:6 185:13` (audit-1: 13 m/s to the pool jump); kitchen `0:10 120:12 150:13` (**S8a: `0:10.5 …`**); workbench `0:13 62:11 160:6 178:13` | Score: 1 point per second and about 6.7 per pineapple. A skilled line is fast and brakes only at hazards. The old creep lines scored lower than flooring it. |

Acceptance (test/integration/acceptance.test.ts, "S6T: pacing beats flooring it") with the example cart:

| Level | Pace line | Flooring it | Required |
|---|---|---|---|
| Beach | 15/15, rating **89** | 13/15, **81** | pace ≥ floor + 5 |
| Kitchen | 15/15, **92** | 12/15, **76** | same |
| Workbench | 15/15, **88** | 12/15, **73** | same |

These are after audit-1, with the pools (S6T numbers; S8a re-measured them — see "S8a"). Shortcut proof (acceptance, "risk/reward shortcut") compares the pace line, which jumps, with the careful line, 5 m/s from 20 m before the pool to the goal:

| Level | Pace line (jump) | Careful line (through the pool) |
|---|---|---|
| Beach | 2.05 s through the pool, rating 89 | 4.62 s, rating 85 |
| Kitchen | 2.17 s, 92 | 5.13 s, 87 |
| Workbench | 2.02 s, 88 | 4.92 s, 82 |

Every run delivers 15/15. The test requires: the jump's wheels stay more than 2 m above the floor; the careful line's wheels reach the floor; the jump saves at least 2 s through the pool; and the jump rates at least 3 points higher.

## Endless generator (src/terrain/generator.ts)

| Constant | Old → new | Why |
|---|---|---|
| `RAMP_START_X` | 80 → **40** m | #8: 100–600 m was flat and boring. Difficulty d now reaches 0.5 at about 520 m instead of about 880 m. |
| `RAMP_END_X` | 1680 → **1000** m | #8: as above; full difficulty from 1000 m. |
| `GAP_MIN_DIFFICULTY` | 0.1 → **0.04** | #8: gaps start at about 90 m (block 2), not about 330 m. |
| `GAP_MIN` | 1.2 → **1.0** m | #8: early gaps are short. |
| `EARLY_GAP_MAX` / `EARLY_GAP_DIFFICULTY` | new: **1.5 m / 0.3** | #8: gaps are at most 1.5 m wide until d = 0.3. |
| `LAUNCH_LIP_MIN_X` | new: **120** m | #7: launch lips at 40–90 m ended 2 of the 3 playtest runs. |
| `EASY_DIFFICULTY` | new: **0.15** | #7: below this, the opening is gentle. |
| `EASY_CREST_HEIGHT` | new: **0.8–1.8** m (was 1.5–3) | #7: a 2.7 m crest at 53 m cartwheeled the cart. |
| `EASY_CREST_DOWN` | new: **0.8** (max drop slope) | #7 |
| `EASY_LIP_DROP` / `EASY_LIP_DROP_SLOPE` | new: **0.8 m / 1.2** | #7: early lips drop gently. |
| `crestHeightCap(d)` | none (up to 5 m at d = 1) → **2 + 1.5d** | #8: the late game should be hard, not random death. |
| weight `none` | 3 − 2d → **2 − 1.5d** | Excitement audit: fewer plain blocks. |
| weight `valley` | 2 → **1.5** | Same. |
| weight `launchLip` | 1 + d → 1 + d, but **0 before 120 m** | #7 |
| Rule: never three plain blocks in a row | new | Excitement audit: the worst dull stretch at 7 m/s went from 20.7 s to 17.9 s, under the 20 s rule. It uses the neighbours' raw draws, so it stays pure and O(1) per block. |
| Crest rounding | new | #10: every line is rounded after the slope clamp. The washboard is kept sharp. |

Headless playtest, example cart at a constant 5, 7 and 9 m/s for 150 s, over the seeds SFX2N8, XUR9ZY, 5GCCHB, PINE and A1B2C3:
- no early deaths;
- reached 797–1383 m;
- losses grow with depth: 0–5 at 5–7 m/s on most seeds, up to 13 on 5GCCHB at 9 m/s;
- 3 of the 15 runs got stuck, all beyond 860 m.

## Excitement audit (tools/levels/census.ts, test/levels/excitement.test.ts)

Audit-1 #1: the census is derived from the TERRAIN GEOMETRY. Authoring labels (Track features, generator FeatureInstances) are only cross-checked; the census is identical with or without them. The driving surface is the topmost ground; gap side walls are not ground, and where there is no ground there is a hole.

Audit-2: nothing with a threshold is sampled any more. The old 0.25 m grid measured a 0.5 m hole as 0.25 m and could measure a 2.05 m flat top as 2 m. `Surface` rebuilds the driving surface as an exact piecewise-linear function. Its breakpoints are every segment end point and every crossing of overlapping segments. Measurements on it:
- Hole widths come from the exact hole end points.
- Range extremes (tooth height, rise, fall, prominence, pool depth) are taken at piece end points, where a piecewise-linear function has its extremes.
- A peak's top width runs to where the ground leaves a `PEAK_FLAT_TOL` = **1 mm** band around the top height. The crossing is interpolated exactly. The tolerance can only widen a top, so a plateau is never under-measured into a peak.
- Drop and riser runs are runs of whole pieces.
- Dull windows check holes and chord deviation exactly at every vertex.

Minimum thresholds pass at the threshold minus 1e-9 (float slack in the hazard's favour). The only grid left is the 0.5 m spacing of dull-window starts. It only affects a dull stretch's length, by under one step at each end, which is well under the 6 s threshold.

Boundary self-tests run at the old grid-aligned offset and at 3 misaligned ones (0.1, 0.137, 0.2 m). All 12 fail on the old sampled census:
- a 0.5 m hole is a gap, a 0.3 m hole is a gap, a 0.29 m hole is not;
- a 1.95 m hilltop is a crest and confirms a crest label; a 2.05 m hilltop is not, cannot confirm the label, and hides no dull window;
- 0.12 m teeth make a washboard, 0.11 m teeth do not.

It then detects:

| Kind | Geometric definition |
|---|---|
| peak (shared by crest, launchLip and kicker) | A local top, with no ground higher within ±1 m, whose top (the connected ground within 1 mm of its height) is no wider than `PEAK_MAX_TOP` = **2 m**. A wider flat top is a plateau, whose edges can only be drops. This rule rejects audit-1's flat 5 m "crest". |
| gap | A hole at least **0.3 m** wide. |
| washboard | At least **4** teeth, each within **2 m** of the last. A tooth is a peak no wider than **0.5 m** that stands ≥ **0.12 m** above the lowest ground within **0.75 m** on both sides. |
| launchLip / kicker | A peak with all three of: a rising approach (the last **1.5 m** before its far edge at slope ≥ **0.15**); ≥ 0.3 m of rise within 3 m; and ground that falls ≥ **0.5 m** within 2 m or into a hole. It is a launchLip if the fall within 4 m exceeds the rise by 0.3 m (the cart lands lower), else a kicker. |
| crest | Any other peak with ≥ **0.8 m** of ground below it within **8 m** on both sides. Overlapping crest peaks count once. |
| drop | A run of consecutive surface pieces, each falling at slope ≥ **0.5**, totalling ≥ **0.8 m**, that is not a lip's far side and not into a gap. |
| steps | At least 2 same-direction risers (0.25–1.2 m high, slope ≥ 1, over ≤ 0.75 m), separated by treads of 1–6 m. |

A label must be confirmed by an overlapping detected hazard of a compatible kind, or the audit fails with "unconfirmed label". Compatible kinds:
- launchLip and kicker are both lips;
- a lip also confirms a crest label (a lip is a peak with an abrupt far side);
- a launchLip also confirms a drop label;
- a drop also confirms a crest label (audit-2). The generator's crest is a climb to a 2–4 m flat top ending in a steep drop. Once top widths were measured exactly, that top is a plateau, so its hazard is the drop.

The rules count only detected hazards. Only detected hazards stop a window from being dull.

SHORTCUT (audit-1 #4) is detected at a launchLip or kicker when all of these hold:
- A point projectile leaving the lip along its approach at **13 m/s** lands at least **8 m** on.
- The ground under the flight is continuous. A hole means the jump is mandatory, not optional.
- That ground dips at least **1 m** below both the take-off and the landing.
- A washboard or steps lies wholly under the flight.
- At **6 m/s** the projectile lands before the dip's deepest point, so a slow cart rolls through.

The pace driver then proves that the route is taken, faster and viable (see the premade section above).

| Constant | Value | Why |
|---|---|---|
| `DULL_WINDOW` / `DULL_STRAIGHTNESS` / `DULL_MAX_SLOPE` | **4 m / 0.2 m / 0.25** | A window is dull when its ground is straight within 0.2 m, gentle, has no hole, and no DETECTED hazard overlaps it. |
| `ENDLESS_RULES` | max dull **20 s**, ≥ **3** kinds, ≥ **1.2** hazards per 100 m, crest ≤ **0.6**, **0** shortcuts | The brief: more than 20 s of flat at typical speed is boring. Every seed must pass the dull and crest rules. The kind and density rules apply to the mean over 40 seeds at 3 depths. Generator labels: at least 99% must be confirmed by the geometry. Measured 843 of 843 on the exact surface; it was 698 of 700 with sampling. |
| `PREMADE_RULES` | max dull **6 s**, ≥ **5** kinds, ≥ **3** hazards per 100 m, crest ≤ **0.6**, ≥ **1** shortcut, every label confirmed | Handmade courses are held to a higher bar. |

Results (geometry):

| Course | Hazards per 100 m | Kinds | Shortcut |
|---|---|---|---|
| Beach (fewest: the easiest) | 4.06 | 5: drop ×2, washboard ×2, crest ×2, launchLip ×2, kicker | lip 209 m, fast landing 223 m, skips the washboard |
| Kitchen | 6.45 | 6 | lip 161 m, landing 175 m |
| Workbench | 6.87 | 7 | lip 202 m, landing 217 m |

Before the pools, but with the mislabels removed, beach had 5 detected kinds and only 2.74 hazards per 100 m. It failed the density rule. The pool supplies real hazards: a launch lip and a washboard.

Self-tests:
- A flat road labelled with all 7 kinds fails: 7 unconfirmed labels, 0 hazards, a dull stretch, too few kinds, and no shortcut.
- The audit's exact case fails: ramp, flat 5 m labelled 'crest', then road.
- A wrong-kind label fails.
- The same lip over a gap is not a shortcut.

Endless worst dull stretch at 7 m/s: 17.9 s in the opening, 11.8 s in the middle and 11.4 s deep, on the exact surface. Mean kinds are 4.2, 4.5 and 4.7; mean hazards per 100 m are 2.3, 3.2 and 3.9. Detected gaps grow with depth. After audit-2 the premade results are unchanged (the table above), and no level needed a retune.

## Original course (levels/original-course.json)

The geometry is unchanged: all 71 recovered vertices are exact (#6).

| Item | Old → new | Why |
|---|---|---|
| Course-select tag | 'Bonus' → **'Bonus · Expert'**, and the blurb adds "Expert: it forgives only the right speed." | #6: the course is a knife edge. |
| `ORIGINAL_EXPERT_LINE` (test/integration/driver.ts) | new: **9 m/s, then 6 m/s from x = 200** (**S8a: 9.3 m/s**) | A reference line that reached the goal with 10/15 in 38.3 s, proving the course can be finished. A constant 8.5 or 9.5 m/s got stuck. **After S8a, 9 m/s gets stuck at ~94 m; the line is 9.3 m/s (10/15, 37.9 s).** |
| Acceptance bar | ≥ 5 delivered → **≥ 9 on the reference line and 3 nearby lines (185/6, 215/6.5, 200/6.5); the reference line exactly 10** | Audit-1 #5: the old bar was weaker than the documented evidence. A sweep of 105 nearby lines found that the switch point is forgiving: anywhere in 185–215 m at 6–6.5 m/s delivers 9–10. The cruise speed is a knife edge. S6T: 8.8 and 9.0 m/s finished; 8.7, 8.9 and 9.1–9.3 got stuck. **S8a (current physics): 9.3, 10.0 and 10.1 finish; 9.0–9.25, 9.9 and 10.05 get stuck.** The bar and variants are unchanged, at a 9.3 cruise. |

## Builder parts: reviewed, unchanged

- `PART_DENSITY` is 1, as in the original.
- `STRAW_THICKNESS_PX` is 5.
- `MIN_PART_SIZE_PX` is 5 and `MIN_CUBE_SIZE_PX` is 7.
- `WHEEL_MATERIAL` is 0.9 / 0.2 and `PART_MATERIAL` is 0.6 / 0.2.
- There is no cost system, so there is nothing to tune there.

A density experiment scaled the non-wheel part density ×1, ×2 and ×3. It ran the example and articulated carts through the pace line, constant 3, 5 and 7 m/s, and flooring it, on beach, kitchen and workbench. Example-cart pace-line ratings:

| Density | Beach | Kitchen | Workbench |
|---|---|---|---|
| ×1 (current) | **89** | **95** | **90** |
| ×2 | 5 (dumped 14 at the dune jump) | 94 | 84 |
| ×3 | 88 | 94 | 70 |

Heavier parts gave no consistent gain for any cart, only noise and some collapses. The minimal cart (#11) is left as it is.

## Shock art (no physics change)

The umbrella shock is replaced by a Hawthorne-strainer coil spring:
- `assets/svg/parts/spring-{compressed,rest,stretched,rod}.svg`;
- `ART.umbrella` → `ART.spring` and `ART.umbrellaStick` → `ART.springRod`;
- the builder label "Umbrella shock" → "Coil spring".

## S8a: engine opening — pair friction and real shock limits

`src/physics/engine.ts` was opened once for residual R19 and re-frozen (its header records the opening).

### Binding surfaces (box2d3-wasm 5.2.0, compat build)

| Capability | Engine API | Box2D binding |
|---|---|---|
| Pairwise contact friction | `MaterialDef.surface`, `PhysicsWorld.setPairFriction(a, b, f)` | `b2SurfaceMaterial.userMaterialId` (bigint) on the shape def; `b2World_SetFrictionCallback(worldId, (fA, idA, fB, idB) => f)` |
| Distance-joint limits | `DistanceJointDef.limits {minLength, maxLength}`, `getDistanceJointLength`, `getDistanceJointLimits` | `b2DistanceJointDef.enableLimit / minLength / maxLength`; `b2DistanceJoint_GetCurrentLength / IsLimitEnabled / GetMinLength / GetMaxLength` |

Box2D sets a contact's friction by calling the friction callback when the contact begins touching (measured: ~383 calls per step in a churning 500-body heap, 0 once it settles; ~8 per step in a real beach run). The callback returns the override for a registered surface pair, and otherwise Box2D's own `b2MixFriction`, `sqrtf(fA · fB)`, computed in float32 (`Math.sqrt(Math.fround(fA * fB))`, rounded to float32 on return). A trace test shows that installing it changes nothing but the overridden pair, bit for bit, including an unequal part–terrain pair.

**One callback per module.** Audit-1 found (and a test now pins) that the binding keeps a single JS friction callback for the whole module: the latest `b2World_SetFrictionCallback` wins for every world that installed one, and the callback is not told which world is calling. Measured before the fix: two live worlds, one at 0.9 and one at 0.3, both ran at 0.3. The engine now installs one module-level dispatcher on every world, and each shape's `userMaterialId` is `(worldTag << 20) | surface`. The dispatcher masks off the surface ids and looks up the calling world's table. `destroy()` drops that world's table and frees its tag. Tags are bounded (audit-2): they must fit in the 44 bits above the surface, so the allocator counts to 2^44 − 1, then reuses the lowest tag no live world holds, and throws rather than truncating if every tag is live. test/physics/pairFriction.test.ts checks two interleaved live worlds and 8 create/destroy cycles alternating 0.3/0.9.

**Hot-path cost** (node 22, M-series laptop, not a gate): a 500-body heap of pineapples and wheels in a box runs 0.47 ms/step without the callback and 0.56 ms/step with it (+0.09 ms, about 0.24 µs per call). A real beach run makes ~8 calls per step, about 2 µs against a ~86 µs step.

### Constants

| Constant (file) | Old → new | Why |
|---|---|---|
| `PINEAPPLE_WHEEL_FRICTION` (src/physics/surfaces.ts) | mix sqrt(0.9 · 0.9) = 0.9 → **0.3** | #9: a pineapple pressed against a wheel braked it. Pinch rig (driven wheel on a fixed axle, a wall 0.7 pineapple diameters away, 3 pineapples in the wedge): **|ω| < 0.5 rad/s at 0.9, ω > 18 rad/s at 0.3** (test/physics/pairFriction.test.ts). A friction sweep shows ≥ 0.4 re-locks the 0.7-diameter wedge, so ~0.3 is needed. |
| Other pairs | unchanged | pineapple–terrain 0.9, wheel–terrain 0.9, pineapple–part sqrt(0.9 · 0.6) ≈ 0.735, part–terrain ≈ 0.735. Pineapple and wheel materials still say 0.9; only their pair is overridden. |
| `SURFACE` (surfaces.ts) | new: pineapple **1**, wheel **2** | Surface ids. 0 = no surface (terrain chains, parts). `buildCompound` and `spawnPineapple` register the pair (idempotent). |
| Shock limits (compound.ts) | emulated bump stops → **real Box2D limits, 0.8 / 1.15 × rest** | #4 residual (V-sag). The joint's `minLength`/`maxLength` are hard in-solver constraints on every sub-step, so the damaged-cart branch needs no call. Box2D joints have a little world-level softness: hard landings show up to ~3% give (R21). |
| `SHOCK_STOP_BIAS`, `SHOCK_STOP_MAX_PUSH`, `bumpStop`, `ShockStop`, `localCentroid`, `CartInstance.applyShockStops` | **removed** | Replaced by the real limits. |

### What the tests show

- **V-sag** (test/integration/vSag.test.ts): the playtest's articulated cart is rebuilt (two halves joined only by three shocks), loaded, and driven across the workbench washboard (37–56 m) at 2.5, 3, 4, 4.5, 4.8, 5, 5.2, 5.5 and 6 m/s.
  - **Shipped (asserted):** the shocks stay at **0.78–1.18×**, the fold is at most 11°, every speed crosses, and 12–14 of 15 pineapples stay aboard on the washboard. The test requires ≥ 10 aboard, so an emptied cart cannot pass.
  - **Executable control (asserted):** the same rig with the pre-S8a physics (limits switched off with `b2DistanceJoint_EnableLimit`, pineapple–wheel back at the 0.9 mix) runs the shocks to 1.25–1.47× at every speed, and 5 m/s sticks for good at x 46.5.
  - Scratch measurements, not tests: the S6T emulated stops ran to 1.36× and stuck at 42.6 m at 5 m/s (the playtest's failure); real limits with the old 0.9 friction stalled at 50.7 m at 3 m/s.
- **Collapse is intact.** test/physics/springCart.test.ts and springBracing.test.ts pass with identical numbers with and without the limits: swing 0.0429; unbraced shear 2.41 m vs braced 0.172 m, a ratio of 14. A parallelogram shears at constant shock length, so length limits cannot stop it. The braced diagonal stretches only a few percent and never reaches 1.15×.
- **Damaged cart** (test/integration/damagedShocks.test.ts): the surviving shocks still report their limits, and plain driving stays inside 0.8–1.15× (±0.005). Under the per-step 14 m/s velocity overwrite, the worst ratio is 1.23×, against 1.28× with the survivors' limits switched off (S6T emulation: 1.25×).
- **S1 timings are bit-identical**, and test/run/scenarios.test.ts now pins them exactly as step counts (it used to allow ±0.25–0.3 s): full throttle 8.683 s (step 521), cruise 3 m/s 17.25 s (1035), cruise 5 m/s 13.05 s (783). The spill scenario's goal time is unchanged at 11.917 s (715), but its counts moved from 11 lost / 4 delivered to **7 / 9**: the load slides off the wheels instead of being thrown by them.
- Retry and save/reload determinism tests pass.

### Re-pinned test data

These pins were chaotic, and they flipped.

| Item | Old → new | Why |
|---|---|---|
| Kitchen pace (tools/levels/premade.ts) | `0:10 120:12 150:13` → **`0:10.5 120:12 150:13`** | The 10 m/s line lost 3 on the kicker (12/15, rating 74). The kitchen line was already a knife edge before S8a: the emulated build gave 12–15/15 across opening speeds 9.5–11. 10.5 gives 15/15 in both builds (93 before and after). |
| `ORIGINAL_EXPERT_LINE` + 3 variants | cruise **9 → 9.3 m/s** (switch points unchanged) | 9 m/s now bellies at ~94 m. 9.3 with 6 m/s from 185/200/215 m or 6.5 m/s from 200/215 m delivers 10/15 on every line. Cruise speeds 9.3, 10.0 and 10.1 finish; 9.0–9.25, 9.9 and 10.05 get stuck. The course is still an expert knife edge. |
| S0 stability gate re-run (test/run/scenarios.test.ts) | goal moved out of reach (+1000 m) | The load now mostly stays aboard (at 0.9 the wheels flung all 15 off). One pineapple rolls into the blender at ~12 s, which correctly ends the run and would cut the 60 s shuttle short. The test now also asserts the cart itself never passes x 115. |
| lostTerrain bulldoze (test/integration/lostTerrain.test.ts) | spike fixture cart → **example cart** | At 0.3 the fixture cart's low front wheels slip on the heap face and stall (R22). The example cart pushes the heap through at 0.3; at 0.9 the heap locked its wheels. |

### Ratings, example cart, pace-note driver (before = S6T main, after = S8a)

| Line | Before | After |
|---|---|---|
| Beach pace | 89 (15/15, 26.1 s) | **89** (15/15, 26.1 s) |
| Beach flooring it | 81 (13/15) | 75 (12/15) |
| Beach careful (pool) | 85 (15/15) | 85 (15/15) |
| Kitchen pace | 92 (15/15, 22.6 s) | **93** (15/15, 22.2 s; line 10 → 10.5 m/s) |
| Kitchen flooring it | 76 (12/15) | 70 (11/15) |
| Kitchen careful (pool) | 87 (15/15) | 88 (15/15) |
| Workbench pace | 88 (15/15, 27.1 s) | **88** (15/15, 27.1 s) |
| Workbench flooring it | 73 (12/15) | 67 (11/15) |
| Workbench careful (pool) | 82 (15/15) | 82 (15/15) |
| Original expert line | 9 m/s: 51 (10/15, 38.3 s) | 9.3 m/s: **51** (10/15, 37.9 s); 9 m/s now stuck |

Pacing beats flooring it by 14, 23 and 21 points (it must beat it by ≥ 5).

Pool shortcut, jump vs careful line:

| Level | Jump | Careful |
|---|---|---|
| Beach | 2.05 s, 89 | 4.62 s, 85 |
| Kitchen | 2.15 s, 93 | 4.80 s, 88 |
| Workbench | 2.02 s, 88 | 4.92 s, 82 |

Every one of these runs delivers 15/15.

## S9: exotic physics — Zero-G Tiki Bar

`src/physics/engine.ts` was opened a second time and re-frozen (its header lists additions 3–5).

### Engine surface (box2d3-wasm 5.2.0)

| Capability | Engine API | Box2D binding |
|---|---|---|
| Per-body gravity scale | `setGravityScale(h, s)`, `getGravityScale(h)` (non-finite throws; Box2D stores float32) | `b2Body_SetGravityScale` / `b2Body_GetGravityScale` |
| Continuous force | `applyForceToCenter(h, {x, y})` (wakes; for the next step only) | `b2Body_ApplyForceToCenter(id, f, true)` |
| Sensors | `addSensorPolygon(h, vertices, partId)`; `WorldOptions.sensorVisitors`; `MaterialDef.sensorVisitor` (per-shape opt-in / opt-out); `sensorEvents(): {begin, end}` of `{sensor, visitor}` body handles | `b2ShapeDef.isSensor` + `enableSensorEvents`; `b2World_GetSensorEvents` (shape ids mapped back through the ids the engine recorded; events with dead shape ids are dropped) |

Only a world with at least one field zone is created with `sensorVisitors: true`. Every other world creates every shape exactly as before, so the four S1 step-count pins (521 / 1035 / 783 / 715) and all pre-S9 traces are unchanged.

### Zones (src/run/zones.ts, src/model/zones.ts)

- A `gravity` or `force` zone is a static sensor box (role `zone`; the zone tag in `partIds` is all the renderer reads).
- Membership comes from the previous step's begin/end events. It is counted per visitor shape, so a multi-shape body stays inside while any of its shapes is.
- Before each step, every member gets:
  - the **lowest** gravity scale of its pockets (never compounded);
  - mass × the **sum** of its force-zone accelerations.
- A body that leaves every zone gets scale 1 back once. Destroyed bodies are pruned.
- Everything is keyed and ordered by body handle, with no clock or randomness, so it is deterministic.

### Bead ocean (src/run/beads.ts, src/game/deviceTier.ts)

- A `beads` zone is filled at load with 300–600 sleeping-enabled circles (role `bead`).
- Bead properties: density 0.35, friction 0.2, restitution 0.05. Beads opt out of sensor events.
- The layout is a hex lattice filled bottom-up, a pure function of (terrain, rect, count).
- The radius is derived from the count, so the pile keeps its extent and mass: r = 0.090 / 0.075 / 0.064 m at 300 / 450 / 600.
- The count is fixed **at level load** and **pinned per device** (`resolveBeadCount`, audit-1 #1). The first bead level a browser loads stores its tier count in localStorage (`pineapple-run.beadCount.v1`); courses without a bead zone never resolve or store a count (`runSessionOptions`, audit-2), so Beach or Endless runs cannot pin a stale tier. Every later load, including retries, page reloads and reloads after the device reports different cores or memory, uses the stored count, so a run and its reload always build the same bead ocean. There is no run/replay save format; saved carts are designs only. Tiers for the first load:

  | Tier | Reported device | Beads |
  |---|---|---|
  | low | ≤ 2 cores or ≤ 2 GB | 300 |
  | mid | ≤ 4 cores, or nothing reported | 450 |
  | high | anything more | 600 |

  There is no frame-time feedback and no URL override (the run screen reads no query string). Tests override the count through `RunSessionOptions.beadCount` / `RunScreenDeps.beadCount` (an override is never pinned), and can inject `RunScreenDeps.deviceInfo` / `beadStorage`. Invalid or unreadable storage falls back to the tier; unwritable storage skips pinning.
- Run worlds are configured from the level in one place, `src/run/runWorld.ts` (`worldOptionsForLevel`, `createRun`). Both RunSession and the run harness page use it, so the harness loads `levels/tikibar.json` (audit-1 #2).
- Beads are not cargo and are never scored.
- Beads are not streaming anchors. `RunSession.furnitureXs` pins the zone's two fixed ends, so the basin terrain stays loaded while the cart is away.
- A bead that falls below killY is swept every 30 steps, so the count only goes down (asserted).

### Level layout (tools/levels/premade.ts `tikibar` → levels/tikibar.json)

The level uses the tiki theme (dusk sky, moon, lagoon, bar back, lanterns; bamboo ground with a bar-top edge). It is 195.5 m from the plateau to the goal line at x 210.35. In course order:

| x (m) | Section | Pace (m/s) |
|---|---|---|
| 0–36 | plateau, valley | 9 |
| 36–71 | **moon hop**: gravity 0.3 pocket over a launch lip, an 8 m gap and a moon washboard | 7 |
| 71–89 | exit humps | 6 → 4 |
| 89–98 | **shooter**: force (2, −16) m/s² column at the foot of a 6 m bar-stool cliff (`line(1.8, -6)`) | 4 |
| 98–124 | upper deck, valley | 6 → 9 → 13 |
| 136–162 | ice-bucket pool shortcut (crushed-ice washboard floor) | 13 |
| 166–188 | **bead ocean**, 22 m wide | 9 → 6 |
| 194–205 | steps down to the blender | 6 |

The pool comes before the beads because a cart that has just ploughed the ocean is too slow to jump anything.

### Driver results (example cart, pace-note driver, test/integration/tikibar.test.ts)

| Line | Beads | Delivered | Rating |
|---|---|---|---|
| Pace | 300 | 14/15 | 76 |
| Pace | 450 | 12/15 | 66 |
| Pace | 600 | 13/15 | 72 |
| Flooring it | 450 | 5/15 | 29 |
| Careful (5 m/s from 20 m before the pool) | 450 | 14/15 | 70 |

- Pacing beats flooring it by 37 points.
- **What the tests pin** (audit-1 #3; runs are deterministic):
  - pace: ≥ 12/15 and rating ≥ 60 at every tier (measured 12–14, 66–76; the acceptance floor is 10);
  - flooring it: ≤ 7/15, and pacing wins by ≥ 25 points (measured 5/15 and 37; acceptance ≥ 5);
  - pool: careful ≥ 2 s slower than the jump (measured 2.77 s);
  - census: exactly 10 hazards / 8 kinds / 5.11 per 100 m with zones and 7 / 5 / 3.58 without, dull ≤ 4 s (3.83), crest ≤ 0.5 (0.49), 1 shortcut.
- Pool shortcut, time from pool start to pool end: jump 2.05 s, careful 4.82 s.
  - At 450 beads the careful line scores higher, because the jump costs two pineapples (R23).
- Both mechanics are load-bearing. With the moon-hop pocket removed, or with the shooter removed, the pace line does not finish (asserted).
- Retry and save → reload → rerun are bit-identical: events, chassis trace and every bead pose.

### Census (tools/levels/census.ts, test/levels/censusZones.test.ts)

A zone becomes a hazard only if it reaches the driving corridor, meaning the band from the exact surface up to 3 m above it, tested per surface piece. The kinds and thresholds are:

| Hazard kind | Zone kind | Counts when |
|---|---|---|
| `lowGravity` | gravity | scale ≤ 0.6 |
| `shooter` | force | \|a\| ≥ 3 m/s² |
| `beads` | beads | width ≥ 2 m and depth ≥ 0.3 m |

Zone hazards count, and break dull stretches, like terrain hazards. Weak, tiny, out-of-corridor and past-the-finish zones are asserted not to count.

Tikibar passes the premade rules in two ways:

- **With the zones:** 10 hazards in 8 kinds, 5.11 / 100 m, longest dull stretch 3.83 s, sharpest crest 0.49, 1 shortcut.
- **Honestly without any zone credit:** zones and zone labels removed, 7 hazards in 5 kinds, 3.58 / 100 m, same dull and crest figures. The zones add variety; they are not what gets the level past the audit.

### Perf (headless, node 22, this laptop; `S9_PERF=1 npx vitest run test/integration/beadPerf.test.ts`, exactly `1`, any other value skips; not a gate)

| Beads | Build (ms) | Settle (steps) | Parked (ms/step) | Ploughing (ms/step) | Ploughing max (ms) | Whole run (ms/step) |
|---|---|---|---|---|---|---|
| 0 (bead zone removed) | 1 | 0 | 0.051 | 0.069 | 0.19 | 0.072 |
| 300 | 3 | 75 | 0.275 | 0.598 | 1.03 | 0.418 |
| 450 | 4 | 94 | 0.399 | 1.003 | 1.52 | 0.594 |
| 600 | 4 | 83 | 0.513 | 1.429 | 2.07 | 0.829 |

Column meanings:

- **Parked:** cart on the plateau with every bead asleep.
- **Ploughing:** steps while the chassis is inside the bead zone.
- **Settle:** steps after Start until every bead sleeps.

Sleeping beads are not free, at about 0.75 µs each per step. `PhysicsWorld.step` reads every dynamic body's transform for render interpolation, whether awake or not (R24). The worst ploughing step at 600 beads is about 2 ms, well inside a 16.7 ms frame, but a real phone is slower. That is why low-tier devices get 300.
## UX1: Jan's playtest feedback (camera, blender, builder)

Slice UX1 made five changes from Jan's playtest feedback, listed as **old → new → why**. `src/physics/engine.ts` is untouched.

### 1. Look-ahead run camera (src/game/framing.ts, src/game/runScreen.ts)

Jan: the cart should sit about 30% from the left edge with about 70% of the view ahead of it ("[..x.....]").

| Constant / rule | Old → new | Why |
|---|---|---|
| Follow x | right-most body − 100 px, screen-centred (`CameraFollow`, src/run/camera.ts) → **cart AABB centre placed at `LOOK_AHEAD_FRACTION` of the view width** (`LookAheadFollow` + `followCamera`) | The old camera put the cart's front about 100 px right of centre, so only 40–45% of the view showed what was coming. |
| `LOOK_AHEAD_FRACTION` | new: **0.3** | Jan's "[..x.....]": 30% behind, 70% ahead. It holds at every zoom (`followZoom` = clamp(w/720, 0.5, 1.5)). |
| `LOOK_SMOOTHING` | new: **0.1** per 60 Hz step | Same smoothing as the old follow. |
| Lag compensation | new: target = anchor + vel·(1 − s)/s | A plain exponential follow trails a moving cart by vel·(1 − s)/s, which is about 1.2 m at 9 m/s, or 5% of the view. The estimated per-step velocity is fed forward, so at constant speed the cart sits exactly at 0.3. On beach, kitchen, workbench, the original and endless, the worst deviation while cruising is 0.007–0.011 of the view width. The test (test/game/framing.test.ts) measures the rendered, interpolated path at five alphas per step. It bounds cruising at 0.015 and the mean at 0.005, and checks that interpolation adds under 0.002 of its own, including while accelerating. |
| Vertical | unchanged | y still comes from the controller's `CameraFollow`, centred. Jan asked for no change there. |
| Ready framing and blend | unchanged | Before Release the camera still frames the funnel and cart (`readyFrame`). After Release it blends into the new follow camera over `READY_BLEND_SECONDS`. |
| Finish framing (`withFinish`, `runCamera`) | new (audit-1 #2) | The 9 m blender is taller than half the view on an 844×390 phone (zoom 1.17, about 11 m of view height), so at follow framing its top was off screen with the cart in the pit. As the blender nears the view, the camera now eases into a frame that holds the whole blender and the cart between the HUD pads. It first moves the look point up or down, and zooms out only if blender plus cart cannot fit at the follow zoom (a little on 844×390; not at all on 1280×720). The cart stays at 0.3 throughout. Tested on beach, kitchen, workbench and the original at 844×390 and 1280×720: every step with the cart over the pit has the blender's four corners and the cart on screen, and the zoom never drops below 0.75× follow. Without the finish frame this test fails on all four courses. |
| `FINISH_PAD` | new: **{top 56, bottom 16} px** | The HUD chips and timer at the top; a small bottom margin. |
| `FINISH_MARGIN_M` | new: **0.3 m** | World margin above the blender top and below the lowest of blender and cart. |
| `FINISH_LEAD_M` / `FINISH_RAMP_M` | new: **4 m / 6 m** | The ease starts when the blender's front is 4 m past the follow view's right edge and is complete 6 m of travel later. The blender is therefore framed before it reaches the screen edge, and the view never jumps. |
| `FINISH_MIN_ZOOM_RATIO` | new (audit-2 #1): **0.75** | The finish frame never zooms out below 0.75× the follow zoom (nor below `READY_MIN_ZOOM`), so the cart never gets tiny. When blender plus cart are taller than that allows (a cart flung far above the pit), the frame is centred on them and clipped instead of shrunk further. For example, on 844×390 the floor is 0.879 against a follow zoom of 1.172; a test builds that pose and checks the clamp engages. On the pace lines the zoom never gets near the floor. A negative control runs the same four courses with finish framing bypassed; each one clips the blender top. |

**Reversing rule:** the look-ahead is always forward (+x). The camera does not mirror to put 70% of the view behind a reversing cart. Reasons:
- Every course runs left to right. Reversing is a short correction (backing off a lip or rocking out of a hole), and the target is still ahead.
- Mirroring would swing the whole view by 40% of its width on every brake-and-reverse, which is disorienting.
- The smoothed follow keeps the cart on screen while it reverses. The lag-compensated lead makes it drift a little toward the left while moving backwards, then settle back to 0.3.

### 2. Bigger goal blender (src/model/goal.ts: one shared size)

Jan: the goal blender should be much bigger (2.5–3.5× suggested).

| Constant | Old → new | Why |
|---|---|---|
| `BLENDER_SCALE` | new: **2.5** | This is the low end of Jan's range. At 1280×760 the 2.5× blender already fills most of the screen height at the finish and reads as a landmark. At 2.5× the finish frame (above) already has to lift and slightly zoom out on an 844×390 phone. At 3× it would have to zoom out further, and the cart would get small. |
| `BLENDER_SIZE` | per-level 1.5 × 3.6 m → **3.75 × 9 m**, shared | One constant feeds the Track DSL (beach, kitchen, workbench), the original course and the generator. No per-level edits. Physics and visuals agree: the solid prop's collider is `BLENDER_SIZE`, and the renderer scales the art to exactly the collider's height **and width**. The 160×340 art is drawn non-uniformly at the collider's aspect, about 11% narrower than its own. The jar reads fine at that, and a cart touches the drawn base exactly where it hits the collider (audit-1 #1). test/render/solidProps.test.ts checks both scales and the composed view's drawn bounds against the collider box. |
| Pit floor, premade (tools/levels/track.ts `PIT.floor`) | 9 → **11.25 m** (`blenderPitFloor(5.75)`) | The bigger blender needs a longer floor. It keeps a 5.75 m clear landing strip before the blender and 1.75 m behind it (`BLENDER_BACK_GAP`). |
| Pit floor, original (src/terrain/originalCourse.ts) | 7 → **9.25 m** (front gap 3.75 m) | The same rule, keeping the original's tighter landing. |
| Pit floor, generated (src/terrain/generator.ts `FINISH_PIT_FLOOR`) | 4 → **5.75 m** (`BLENDER_SIZE.x + 2`) | The generated blender is decor (non-solid), sized to fit its pit with 1 m either side. |

Re-run pace lines (tools/levels/premade.ts, test/integration/driver.ts). They were measured with the example cart after all of UX1's changes. The results match main before UX1, except workbench careful 82 → 81 (from the build-area change). **No retune was needed.**

| Line | Result |
|---|---|
| Beach: pace / floor it / careful | 15/15 26.00 s **89** / 12/15 75 / 15/15 85 |
| Kitchen: pace / floor it / careful | 15/15 22.12 s **93** / 13/15 83 / 15/15 88 |
| Workbench: pace / floor it / careful | 15/15 27.02 s **88** / 11/15 67 / 15/15 81 |
| Original: expert line + 3 variants | 10/15 on all four (52 / 51 / 53 / 52) |

Pacing still beats flooring it by 14, 10 and 21 points (the requirement is ≥ 5).

### 3. The builder opens empty (src/game/cartState.ts)

Jan: the builder should open empty, and the Example Cart button should load the demo.

| Rule | Old → new | Why |
|---|---|---|
| First builder entry in a page session | example cart → **empty design** (`draftDesign()` = draft ?? tested ?? empty) | The player should start with a blank build area. The Example Cart button still loads the demo, and the status line suggests it. |
| Later entries (Retry, back from a run, another course) | unchanged: keep the current draft or tested cart | Rebuilding after every run would be punishing. Retry replays the tested cart. A cleared design stays cleared. |

### 4. Wider build area (src/builder/constants.ts)

Jan: the build area is too small (about 1.5× linear was suggested).

| Constant | Old → new | Why |
|---|---|---|
| `BUILD_AREA` | x −20..340, y −210..0 px (12 × 7 m) → **x −190..340, y −210..0 px (17.67 × 7 m, 1.47× wide)** | It grows left, behind the cart start. The funnel outlet stays at design (115, −225), so the load still lands mid-cart, and the area keeps design (0, 0) = cartStart. |
| Build area height | kept at 210 px | Measured: a taller area moves the funnel up, and the longer fall makes the pour chaotic. At 1.5× height (minY −315), workbench delivered 3/15. Even +15 px (−225) sent the original expert line `pineappleLost` at 87 m and dropped kitchen pace to 12/15. The height is kept and all the extra room goes into width. |
| `MOCK_FUNNEL.y` | −250 → `BUILD_AREA.minY − 40` (still −250) | Now derived from the area, not a second literal. |
| Start plateau (`plateauRange` = build area ± 1 m; must be flat) | Track start wall at `x0` → **wall at min(x0, plateau minX)**, flat ground up to x0 | Every Track course (beach, kitchen, workbench) gets a start plateau wide enough for a full-width cart. Their fixtures are regenerated. Beach's palm-0 moved to x −4. |
| Original course start | 'start-wall' span → **'start-plateau' span** (`BUILD_MIN_X_PX` −190, `START_PLATEAU_MARGIN_M` 1.5) | The recovered 71 vertices and the start x are unchanged (`ORIGINAL_BUILD_MIN_X_PX` −20 keeps startX). Only the flat ground behind the start is extended. |
| Endless `START_CART.x` | 3 → **7.5 m** (funnel follows: 7.5 + 115/30) | The plateau must reach 1 m left of the wider area. |

Checks (test/integration/wideBuildArea.test.ts plus the existing acceptance and spring suites):
- A tray cart spanning the full width validates on beach, kitchen, workbench, the original and endless.
- It spawns resting on flat ground and catches at least 12 of the load.
- A wheel dragged 10 px below the ground line lifts the whole cart by exactly that much.
- Fit frames the whole area plus the funnel on every course (test/game/runScreen.test.ts, which is written against `BUILD_AREA`).
- The wheel and lime radius clamp (`maxRadiusInArea`) follows the area (test/builder/edits.test.ts).
- Designs saved with the old area still load, because the new area contains the old one.

**Merge note for slice S9 (tikibar).** S9 is now on main. A trial merge of slice-ux1 with main (done in a throwaway worktree; nothing committed) found:
- **Conflicts:** only two.
  - `src/game/session.ts`: keep UX1's plateau range and append S9's furniture:
    `terrain.update([plateau.minX, plateau.maxX, course.level.funnel.x, ...this.furnitureXs])`
  - `TUNING.md`: both sections are appended; keep both.
- **Regenerating tikibar.json:** S9's fixture generator (`test/levels/premade.test.ts`) already lists `tikibar` in its generated `ids`, so UPDATE_FIXTURES rewrites `levels/tikibar.json` with UX1's start wall and blender pit (13+ / 9− lines). Run the two commands **separately**, because running them in one vitest call races one fixture write against the other file's read:
  - `UPDATE_FIXTURES=1 npx vitest run test/terrain/original-course.test.ts`
  - `UPDATE_FIXTURES=1 npx vitest run test/levels/premade.test.ts`
- **Results:** after regeneration, the full suite passes (927 passed, 1 skipped file), including S9's tikibar pace and bead tests and UX1's shared-blender test over `SHIPPED_LEVEL_IDS`.
- **Tikibar in the UX1 course lists:** the `goalBlenderBox` test in test/game/framing.test.ts derives its courses from `SHIPPED_LEVEL_IDS`, as test/render/solidProps.test.ts does, so tikibar joins automatically. Three lists are still hard-coded; add `tikibar` to each in the merge commit:
  - the course list in test/integration/wideBuildArea.test.ts
  - the look-ahead `lines` in test/game/framing.test.ts (with `PREMADE.tikibar().pace`)
  - `PIT_COURSES` in test/game/framing.test.ts, which drives both the finish-pit tests and the finish-framing-disabled control

  The trial merge passed the first two lists and the finish-pit test with tikibar. The control did not exist yet, so after adding tikibar to `PIT_COURSES`, confirm that the bare follow camera also clips on tikibar.

### 5. Builder touch loupe (new: src/builder/loupe.ts, `BuilderLoupe` in src/builder/render.ts)

Jan: "Difficult to see where you click due to the finger being in the way". He asked for a magnifier circle next to the finger.

| Parameter (`LOUPE`) | Value | Why |
|---|---|---|
| `radius` | **64 px** | Judged in the dev harness at a 740×360 landscape phone size. At 2× it shows about 64 design-view px around the fingertip, enough to see a straw end against a snap ring or a wheel rim, and the circle still leaves most of the build area visible. |
| `zoom` | **2×** the current builder view | This follows any pinch zoom the player set. |
| `gap` | **44 px** from the fingertip to the circle's edge | A fingertip pad is about 40–50 px, so the circle is never under the finger. |
| `lean` | **0.35 × radius** toward the free area's horizontal centre | This keeps the loupe off the nearer screen edge and away from the palette. |
| `margin` | **8 px** | Minimum distance from the edges of the free area (the canvas minus the palette). |
| Placement | **above** the finger; near the top edge it **flips beside** the finger (on the side facing the centre, at finger height) | The hand is below the finger, so above is the clear side. Near the top, beside is the only side the hand does not cover. The circle is always clamped inside the free area. |
| Contents | the same model and overlay the builder draws | Includes the live draft (straw, cube, wheel or spring being drawn), snap rings, pin markers and error or hover outlines. It has an opaque paper backing, a red crosshair at the exact contact point (hollow centre), and a subtle border (a thin ink ring plus a soft shadow ring). |
| Visibility | **touch only** (`pointerType === 'touch'`) | Follows the first finger from press to release. It hides on pointerup, on lostpointercapture, on pointercancel, on any builder `resetInput` (blur, Escape, Clear or Load), and during pinch or pan. Mouse and pen never show it. |
| Cost | a second small `BuilderRenderer` into a 128×128 box behind a circular mask | Drawn only while a touch is active. |

The loupe is purely visual:
- It has its own canvas listeners and never reaches the InputRouter, the gesture machine or the editor.
- It is display-only (`eventMode 'none'`).
- It reads the gesture state only to hide during two-finger navigation.
- Hit-testing, snapping, edit semantics and the multi-touch and cancel rules are unchanged. test/builder/loupeMount.test.ts draws the same stroke with a finger and with a mouse and gets identical designs.
