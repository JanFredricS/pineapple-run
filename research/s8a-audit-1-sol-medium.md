S8a does not fully pass static audit. The core engine implementation appears sound, but several acceptance and hardening gaps remain.

## Findings

1. **Medium — the V-sag test does not reproduce its documented controls or prove the cart is loaded.**  
   [test/integration/vSag.test.ts:117](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/test/integration/vSag.test.ts:117)

   The executable test only runs the shipped configuration. The “emulated stops stuck at 42.6 m,” spring-only control, and old-friction control exist only in comments. It also never asserts that any pineapples remain aboard while crossing the washboard.

   Concrete failure scenario: a regression causes all cargo to spill before the washboard. The lighter, empty articulated cart crosses with acceptable shock ratios, so this test passes without covering the loaded playtest failure. Likewise, an inaccurate historical reconstruction of the old stops would never be detected. The separate damaged-cart test has an honest `EnableLimit(false)` control, but it does not cover this V-sag scenario.

2. **Low — the new public engine inputs do not fully enforce their documented numeric contracts.**  
   [src/physics/engine.ts:508](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/src/physics/engine.ts:508), [src/physics/engine.ts:680](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/src/physics/engine.ts:680)

   `setPairFriction` accepts `Infinity` because it checks only `friction >= 0`. Surface validation is guarded by `if (m.surface)`, so `NaN` bypasses validation and silently becomes surface 0/default. The tests cover negative and fractional values, but not non-finite values.

   Concrete failure scenario: an internal caller passes `Infinity` as pair friction, allowing non-finite solver calculations; or passes `NaN` as a surface ID and silently loses the intended override rather than receiving an error. `Number.isFinite` should be part of both contracts.

3. **Low — the backlog and tuning records contradict the implemented expert line.**  
   [research/s6t-playtest-backlog.md:210](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/research/s6t-playtest-backlog.md:210), [TUNING.md:198](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/TUNING.md:198), [TUNING.md:199](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/TUNING.md:199)

   These passages still say the 9 m/s reference succeeds and that 9.3 m/s gets stuck, while the implementation and later S8a section say exactly the reverse. The old damaged-cart row also says the controller “now calls `applyShockStops`,” although that API was removed.

   Concrete failure scenario: a maintainer follows the authoritative backlog/reference line, uses 9 m/s, and receives a stuck run that contradicts the documented acceptance result.

4. **Low — “bit-identical” timings and callback performance/lifetime are not statically pinned by the tests.**  
   [test/run/scenarios.test.ts:65](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/test/run/scenarios.test.ts:65), [src/physics/engine.ts:512](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/src/physics/engine.ts:512)

   The three timing tests allow approximately ±0.25–0.3 seconds, so they do not enforce the documented bit-identical 8.683/17.25/13.05-second results. There is also no world-create/destroy callback retention test or measured/bounded hot-path cost. Box2D explicitly describes friction callbacks as frequent and recommends keeping them lightweight ([Box2D simulation documentation](https://github.com/erincatto/box2d/blob/main/docs/simulation.md)).

   Concrete failure scenario: a 12–18-frame timing regression still passes. Separately, repeated retries could retain callback closures through the binding, or a large contact heap could introduce an unnoticed phone-frame regression; neither condition is covered.

## Clean areas

- The engine opening is limited to the two authorized capabilities and has the required re-freeze header.
- Pair keys are symmetric, surface IDs use `bigint`, and installation is deterministic per newly created world.
- `Math.fround(fA * fB)` followed by `Math.sqrt` and float callback-return conversion matches the intended float32 multiply/square-root sequence. The trace test also compares exact state arrays and exercises an unequal 0.6×0.9 default mix.
- The callback is state-read-only and performs no explicit per-contact object allocation.
- Distance limits are enabled and assigned at joint construction, with valid 0.8–1.15× bounds.
- The complete old runtime emulation—`bumpStop`, `ShockStop`, constants, `localCentroid`, `applyShockStops`, and the damaged-controller call—is removed.
- Surviving joints remain Box2D-owned after unrelated body destruction; the damaged-cart test reads back limits and uses an honest disabled-limit control.
- `springCart.test.ts` and `springBracing.test.ts` are unchanged.
- R4 is correctly resolved through the shared `MAX_LEVEL_PROPS` constant and boundary test.
- The spill repin, stability isolation, bulldoze-cart substitution, kitchen retune, and original-course retune are documented rather than hidden. R21 and R22 match the implemented trade-offs.
- I found no security vulnerability or unrelated implementation scope creep.

I had no Docker access and did not execute any test suite. Runtime results, leak behavior, and reported numerical measurements therefore remain unverified beyond static reading.
[exited with code 0]
