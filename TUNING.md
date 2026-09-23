# Tuning log (S6T)

Every constant changed in slice S6T (Tuning & playability), as **old → new → why**.
The input was the headless-Chrome playtest in `research/s6t-playtest-backlog.md`; `#n` refers to its items.
"new" means the constant did not exist before.
`src/physics/engine.ts` (the Box2D wrapper) is unchanged.
The 71 recovered original-course vertices are unchanged.

## Physics feel

| Constant (file) | Old → new | Why |
|---|---|---|
| `SHOCK_HERTZ` (src/physics/compound.ts) | 5 → **8** | #4: the shock-hung wheels folded under the bed. A spring 2.56× stiffer keeps the wheel where the designer put it. |
| `SHOCK_DAMPING` (compound.ts) | 0.5 → **0.7** | #4: the shocks oscillated after every landing. 0.7 settles in about one bounce. |
| `SHOCK_MIN_RATIO` / `SHOCK_MAX_RATIO` (compound.ts) | new: **0.8 / 1.15** × rest length | #4: the shocks had no travel limits. These are emulated bump stops. Box2D distance-joint limits sit behind the frozen engine.ts. The limits are tighter than the playtest's suggested 0.6–1.3: the example cart's two-shock triangle can flip, folding the wheel under the bed, at 1.22 / 0.88 of rest, and 0.8–1.15 cannot reach that. On the scratch matrix (example and articulated carts, 4 courses, 5 driving styles) finishes were 16 with no stops, 14 at 0.6–1.3, and 23 at 0.8–1.15. |
| `SHOCK_STOP_BIAS` / `SHOCK_STOP_MAX_PUSH` (compound.ts) | new: **0.2 / 1 m/s** | #4: each step a bump stop removes 20% of the overshoot, capped at 1 m/s, so a stop never launches the cart. |
| Bump stops on a damaged cart (`CartInstance.applyShockStops`, controller.ts) | new | Audit-1 #2: once any non-chassis body fell past the kill plane, the controller's survivors-only drive branch skipped `preStep`, so the surviving shocks lost their limits. It now calls `applyShockStops` every damaged step. test/integration/damagedShocks.test.ts drops a wheel past the kill plane and keeps driving. Plain driving stays inside 0.8–1.15. Under ±14 m/s wheel kicks the worst ratio is 1.25 with the stops and 1.28 in a control run with them stubbed out. |
| springCart test tolerance (test/physics/springCart.test.ts) | 0.05 → **0.03** m | A consequence of #4. The stiffer, better-damped shock swings about 0.043 m on the reference drop instead of about 0.1 m. That is still ten times what a welded pair shows (under 0.005 m), so the test still tells a spring from a rod. |
| Wheel/pineapple friction | 0.9, **unchanged** | #9 **deferred**. A separate wheel–pineapple friction needs a contact or friction callback in engine.ts, which is frozen. |

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
| Pace notes (test data) | slow per-feature speeds (2.5–10 m/s) → **skilled lines**: beach `0:12 58:8 80:12 98:8 112:12 163:6 185:13` (audit-1: 13 m/s to the pool jump); kitchen `0:10 120:12 150:13`; workbench `0:13 62:11 160:6 178:13` | Score: 1 point per second and about 6.7 per pineapple. A skilled line is fast and brakes only at hazards. The old creep lines scored lower than flooring it. |

Acceptance (test/integration/acceptance.test.ts, "S6T: pacing beats flooring it") with the example cart:

| Level | Pace line | Flooring it | Required |
|---|---|---|---|
| Beach | 15/15, rating **89** | 13/15, **81** | pace ≥ floor + 5 |
| Kitchen | 15/15, **92** | 12/15, **76** | same |
| Workbench | 15/15, **88** | 12/15, **73** | same |

These are after audit-1, with the pools. Shortcut proof (acceptance, "risk/reward shortcut") compares the pace line, which jumps, with the careful line, 5 m/s from 20 m before the pool to the goal:

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
| `ORIGINAL_EXPERT_LINE` (test/integration/driver.ts) | new: **9 m/s, then 6 m/s from x = 200** | A reference line that reaches the goal with 10/15 in 38.3 s, proving the course can be finished. A constant 8.5 or 9.5 m/s gets stuck. |
| Acceptance bar | ≥ 5 delivered → **≥ 9 on the reference line and 3 nearby lines (185/6, 215/6.5, 200/6.5); the reference line exactly 10** | Audit-1 #5: the old bar was weaker than the documented evidence. A sweep of 105 nearby lines found that the switch point is forgiving: anywhere in 185–215 m at 6–6.5 m/s delivers 9–10. The cruise speed is a knife edge: 8.8 and 9.0 m/s finish; 8.7, 8.9 and 9.1–9.3 get stuck. |

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
