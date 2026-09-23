I could not execute the test suites because Docker is unavailable. This is a static audit only.

S6T does not pass.

## Findings

1. **High — The excitement census can pass based on incorrect authoring labels rather than actual terrain geometry.**  
   [tools/levels/census.ts:107](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/tools/levels/census.ts:107) counts hazards entirely from `features`, and line 117 also exempts those metadata ranges from dull-stretch detection. Beach explicitly labels a flat five-metre section as a `crest` at [tools/levels/premade.ts:56](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/tools/levels/premade.ts:56); workbench does likewise at [tools/levels/premade.ts:130](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/tools/levels/premade.ts:130).  
   **Failure scenario:** Beach reports five hazard kinds only because the flat section counts as `crest`; based on actual geometry it has four kinds and should fail the premade ≥5-kinds rule. More generally, flat ground mislabeled `launchLip`, `crest`, etc. increases density and masks dull windows without changing the track.

2. **Medium — Shock travel limits stop running as soon as any non-chassis cart body is lost.**  
   Normal carts invoke `cart.preStep()` at [src/run/controller.ts:494](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/src/run/controller.ts:494), which applies every bump stop. The damaged-cart branch at [src/run/controller.ts:499](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/src/run/controller.ts:499) reimplements wheel torque only and never applies bump stops to surviving shocks.  
   **Failure scenario:** One wheel or auxiliary body crosses the kill plane while the chassis and a shock-articulated section survive. From that step onward the remaining shocks have no 0.8–1.15× limits and can fold or overextend—the exact backlog #4 failure the slice claims to prevent. The direct shock test calls `bumpStop` manually, so it cannot catch this integration path.

3. **Medium — Ready framing uses body origins, not cart geometry, so it does not guarantee that the cart is visible.**  
   [src/game/runScreen.ts:237](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/src/game/runScreen.ts:237) expands each body centre by a fixed one metre instead of using its shape/AABB. The test at [test/game/framing.test.ts:30](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/test/game/framing.test.ts:30) likewise checks only body centres. `frameBox` also refuses to zoom below 0.35 at [src/game/framing.ts:50](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/src/game/framing.ts:50).  
   **Failure scenario:** A legal cart with a cube, straw, or wheel extending more than one metre from its body origin is clipped behind the HUD or screen edge while the test passes. Driving sufficiently far from the funnel before Release can also make fitting both impossible because of the minimum zoom. This leaves backlog #13 only partially met.

4. **Medium — PLAN’s required risk/reward shortcut is absent and untested.**  
   PLAN requires every premade level to have “at least one risk/reward shortcut” at [PLAN.md:248](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/PLAN.md:248). The three builders at [tools/levels/premade.ts:51](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/tools/levels/premade.ts:51), line 86, and line 126 author a single linear route with hazards; gaps only split that route and do not create an alternate path. The audit rules at [tools/levels/census.ts:52](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/tools/levels/census.ts:52) have no shortcut criterion.  
   **Failure scenario:** A course containing only mandatory obstacles passes every excitement assertion despite offering no optional faster-but-riskier route.

5. **Low — The original-course acceptance test is weaker than the documented disposition.**  
   Backlog #6 and TUNING claim the 9→6 m/s reference line delivers 10/15, but [test/integration/acceptance.test.ts:153](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/test/integration/acceptance.test.ts:153) accepts only five.  
   **Failure scenario:** A regression halves reference-line delivery from 10 to 5 and still passes, even though the evidence supporting the “Bonus · Expert” disposition is no longer true.

## Clean/static verification

- `src/physics/engine.ts` and all 71-vertex `levels/original-course.json` content are byte-identical to `main`.
- No committed scratch files or skipped tests were found. The only untracked file is the audit harness prompt.
- Backlog #1 walls are present in authored and generated gaps, with the 0.05 m lean; the regression includes a real far-edge wheel scenario.
- Backlog #2 uses fixed-step timing, freezes score time at first touch, counts at finalization, and covers Give Up during settlement.
- Backlog #5 uses simulation steps, resets outside a live run, wires Retry through a fresh run state, and cleans HUD listeners/animation frames.
- Backlog #10 rounding is applied in Track/generator authoring only, not to the recovered original course.
- Backlog #16’s two-second `allLost` condition matches the stated “all lost and unrecoverable” rule.
- Backlog #17’s shelf is after the goal wall; goal sensors and line placement remain before it. The pacing-vs-flooring test constructs current post-shelf levels, so it is not testing stale geometry.
- The art swap is confined to labels/catalog/rendering/assets; the four spring SVGs exist and the styleguide references the new art.
- No security issue was evident from static reading.
- Expected residuals remain: #9 friction callback and real joint limits/V-sag to S8, minimal cart behavior, no M-key mute shortcut, and no repeated hidden-tab real-audio check.
[exited with code 0]
