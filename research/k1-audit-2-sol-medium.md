I could not use Docker or execute the test suites. This is a static review only.

## Findings

1. **Medium — Kitchen can complete and score cargo roughly 10.5 m before the blender.**  
   `tools/levels/track.ts:398-401`, `levels/kitchen.json:636-656`

   Kitchen’s sensor begins at the goal line, while the blender’s front is at `241.89`; the sensor/line begins at `231.39`. `RunController` starts completion whenever a pineapple touches that sensor and counts every pineapple past `lineX`, rather than requiring contact with the blender (`src/run/controller.ts:732-758`). This conflicts with the documented `goalReached` meaning that a pineapple touched the blender base (`src/model/runEvents.ts:8-13`).

   Concrete failure scenario: a spilled pineapple rolls just beyond x=231.39 and stops on the flat pit floor. It triggers the settle window and counts as delivered even though it remains about ten metres short of the blender. That result can score and unlock the next course.

   This is an intentional and honestly documented geometry change, but the gameplay semantic is not consistent with the event contract. Other courses also use a pre-blender line, but Kitchen approximately doubles that distance.

2. **Medium — The excitement census deliberately excludes the newly playable stretch up to Kitchen’s real goal line.**  
   `test/levels/excitement.test.ts:25-37`

   `premadeCensus` caps its window at the old lip-based line using `Math.min(goal.lineX, fin.x0 + PIT.lineAfterLip)`. Consequently, the asserted hazard density and dull-stretch result do not cover the approximately 10.7 m from the old line to Kitchen’s new goal line.

   Concrete failure scenario: the landing counter can be lengthened substantially while keeping the line and blender relationship unchanged. Kitchen would gain a long featureless drive before completion, but the `≤1.2 s` dull-stretch and `8.26 hazards/100 m` pins would remain unchanged because that region is outside the census. This does not verify the goal-line move’s full blast radius.

3. **Medium — “Roughest premade by every measure” is contradicted by the recorded measurements and not asserted.**  
   `TUNING.md:620-635`, `test/levels/roughness.test.ts:121-127`

   TUNING reports Kitchen relief `0.58`, Workbench `0.61`, and Tiki Bar `0.64`, then claims Kitchen is roughest “by every measure.” The comparative test only checks travel, mean slope, and bump count; it omits relief and slope p90.

   Concrete failure scenario: Tiki Bar already has greater recorded relief, and a future change could increase another course’s relief or p90 further without failing the “roughest premade” test. Either the acceptance claim needs narrowing to the three asserted measures or those comparisons need to be enforced.

4. **Low — The claimed 92.8 px loaded centre of mass is not pinned.**  
   `test/integration/kitchen.test.ts:133-137`

   The test calculates `comPx`, but only asserts that it lies somewhere between 65 and 130 px. The stated 92.8 px value appears only in a comment. The calculation also reconstructs shape centroids instead of reading a physics-engine centre-of-mass value, although it does use engine-reported body masses.

   Concrete failure scenario: a cart change moving the loaded CoM from 92.8 px to 66 px would still pass, despite invalidating the claimed pin and leaving almost no stability margin over the rear-middle wheel.

## Verified clean areas

- The synthetic sink sweep covers every 5–15 m/s integer speed plus hold-right, all specified flat run-ups, margin sinks, washboard distances, humps, and kickers.
- “Never crosses” is based on maximum rear AABB position, so it covers later far-wall bounces rather than merely checking for a non-goal result.
- The shipped Kitchen run-up check is derived from `PREMADE.kitchen()`; the existing fixture-equality test ties that source to `levels/kitchen.json`.
- Per-speed failure modes are explicitly pinned: 5/6/7/9 fall with `allLost`; 8 and 10–15 plus hold-right jam, show stuck, and allow Give Up.
- Every steady 4–9 m/s Bridger run asserts goal and at least 13/15.
- Normal-cart framing uses the Kitchen pit at 3, 6.5, and 12 m/s plus hold-right; the Bridger allowance is separately named and bounded.
- `lineGap` is only used for Kitchen and its synthetic framing fixture; the default behavior remains intact for other courses.
- Roughness calculations use generated/shipped geometry rather than copied coordinate tables, notwithstanding the comparative-claim defect above.
- Sink bounds, dull limit, and crest limit use the intended tolerances.
- The 9-measured/8-pinned hold-right margin is honestly documented, as is the launch-lip caveat.
- Frozen production areas identified by the brief were untouched; no unexplained scratch files or security issues were found.

Because of the scoring-semantic, census-window, roughness-claim, and CoM-pin issues, **K1 does not pass this verification round**.
[exited with code 0]
