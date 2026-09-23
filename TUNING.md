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
| `READY_MIN_ZOOM` | new: **0.35** | #13: never zoom out so far that the cart becomes unreadable. |

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
| Kitchen | geometry unchanged | #1 side walls only. Pace line retuned (below). |
| All three, finish | `PIT` + **`wall: 8, shelf: 30`** (a flat 30 m shelf from the wall top) | #17: past the goal there was a hairline wall into a void. It now renders as solid ground. |
| Pace notes (test data) | slow per-feature speeds (2.5–10 m/s) → **skilled lines**: beach `0:12 58:8 80:12 98:8 112:12 163:6 185:12 200:8 216:10`; kitchen `0:10 120:12`; workbench `0:13 62:11 160:6 178:13` | Score: 1 point per second and about 6.7 per pineapple. A skilled line is fast and brakes only at hazards. The old creep lines scored lower than flooring it. |

Acceptance (test/integration/acceptance.test.ts, "S6T: pacing beats flooring it") with the example cart:

| Level | Pace line | Flooring it | Required |
|---|---|---|---|
| Beach | 15/15, rating **89** | under 15, **75** | pace ≥ floor + 5 |
| Kitchen | 15/15, **95** | **84** | same |
| Workbench | 15/15, **90** | **81** | same |

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

## Excitement audit (new: tools/levels/census.ts, test/levels/excitement.test.ts)

| Constant | Value | Why |
|---|---|---|
| `HAZARD_KINDS` | crest, drop, launchLip, washboard, kicker, gap, steps | Features that make the player do something. Valleys and plain ground do not count. |
| `DULL_WINDOW` / `DULL_STRAIGHTNESS` / `DULL_MAX_SLOPE` | **4 m / 0.2 m / 0.25** | A window is dull when the ground in it is straight within 0.2 m, gentle, has no hole, and no hazard overlaps it. |
| `ENDLESS_RULES` | max dull **20 s**, ≥ **3** kinds, ≥ **1.2** hazards per 100 m, crest ≤ **0.6** | The brief: more than 20 s of flat at typical speed is boring. Every seed must pass the dull and crest rules; the kind and density rules apply to the mean over 40 seeds at 3 depths. |
| `PREMADE_RULES` | max dull **6 s**, ≥ **5** kinds, ≥ **3** hazards per 100 m, crest ≤ **0.6** | Handmade courses are held to a higher bar. |

Results:

| Course | Hazards per 100 m | Hazard kinds |
|---|---|---|
| Beach (fewest: the easiest) | 3.2 | 5 |
| Kitchen | 5.6 | 6 |
| Workbench | 5.4 | 7 |

Endless worst dull stretch: 17.9 s in the opening, 11.1 s in the middle and 11.1 s deep.

## Original course (levels/original-course.json)

The geometry is unchanged: all 71 recovered vertices are exact (#6).

| Item | Old → new | Why |
|---|---|---|
| Course-select tag | 'Bonus' → **'Bonus · Expert'**, and the blurb adds "Expert: it forgives only the right speed." | #6: the course is a knife edge. |
| `ORIGINAL_EXPERT_LINE` (test/integration/driver.ts) | new: **9 m/s, then 6 m/s from x = 200** | A reference line that reaches the goal with 10/15 in 38.3 s, proving the course can be finished. A constant 8.5 or 9.5 m/s gets stuck. |

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
