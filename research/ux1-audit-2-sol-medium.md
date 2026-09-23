UX1 does not fully pass this verification audit. Static reading shows two implementation gaps and two test/merge-plan gaps. I have no Docker access and could not execute the suites; all conclusions are from static inspection.

## Findings

1. **Medium — Finish zoom does not enforce the required 0.75× floor.**  
   [src/game/framing.ts:310](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/src/game/framing.ts:310), [test/game/framing.test.ts:293](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/test/game/framing.test.ts:293)

   `finishFrame` clamps zoom to the absolute `READY_MIN_ZOOM` of 0.35, not to `follow.zoom * 0.75`. The test only observes that the example-cart pace runs happen to remain above 0.75; it does not enforce the rule for other valid cart poses.

   Concrete failure scenario: on 844×390, normal zoom is about 1.172, so the required floor is about 0.879. A tall cart launched several metres above the finish pit can expand the blender/cart vertical union enough for `finishFrame` to select roughly 0.85 or lower. The camera then violates the 0.75× floor while the existing pace-line test still passes.

2. **Low — The narrow styleguide still renders the blender at its natural aspect ratio.**  
   [src/render/styleguide/main.ts:157](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/src/render/styleguide/main.ts:157)

   The wide styleguide branch gives `blenderSmall` separate x/y scales, but the narrow branch still calls `scale.set(singleValue)`. Thus the promised collider-aspect scaling is not consistently applied by the styleguide.

   Concrete failure scenario: open the styleguide at its narrow breakpoint. The small blender remains approximately 4.24 m wide at a 9 m-equivalent height instead of the 3.75 m collider aspect, contradicting the styleguide acceptance criterion.

3. **Low — The required disabled-framing control is absent.**  
   [test/game/framing.test.ts:276](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/test/game/framing.test.ts:276)

   The positive pace tests cover four courses and two viewports, but there is no control that disables finish framing and proves all four courses fail. Searching the suite finds no such control.

   Concrete failure scenario: fixture or camera changes make the blender fit without `withFinish`; the positive tests still pass, so they no longer demonstrate that the new finish-framing behavior is actually under test.

4. **Low — The S9 merge plan omits one hard-coded camera course list.**  
   [TUNING.md:390](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/TUNING.md:390), [test/game/framing.test.ts:355](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/test/game/framing.test.ts:355)

   The plan names the look-ahead and finish-pit lists, but the test titled “every shipped level” also hard-codes `beach`, `kitchen`, `workbench`, and `original`. It should add `tikibar` there too, preferably by using `SHIPPED_LEVEL_IDS`.

   Concrete failure scenario: after merging S9, a tikibar-specific blender placement regression in `goalBlenderBox` is not exercised even though the test continues to claim coverage of every shipped level.

## Round-1 disposition

- Blender width: **partially fixed**. The actual scene renderer and real-art bounds test now cover both dimensions correctly. The narrow styleguide path remains uniform-scaled.
- Finish framing: **partially fixed**. The run screen genuinely calls the shared `runCamera`; the 4 m/6 m trigger arithmetic is correct, and the four positive course tests are non-vacuous. The zoom floor and required negative control remain unmet.
- Camera accuracy: **fixed by static inspection**. Five interpolation samples per step, 0.015 cruise bound, 0.005 mean bound, 0.002 interpolation bound, acceleration sampling, and the 10–50% envelope are present. The documented 0.007–0.011 is described as measured rather than falsely asserted.
- Endless threshold: **fixed**. Start x is pinned at 7.5 and the assertion requires `spawn.x + furthest > 163`, equivalent to `furthest > 155.5`.

The finish ease is deterministic but not monotonic over time: its weight is recomputed from position, so reversing through the trigger region reverses the ease and may make the frame “breathe.” I would record that as a feel risk rather than a correctness failure. The goal settle/results timing introduces no clear static defect.

The rest of the S9 merge plan—two conflict resolutions, separate fixture-regeneration invocations, and adding tikibar to wide-build and principal camera pace lists—is sane. No security issue or unrelated scope creep was found.
[exited with code 0]
