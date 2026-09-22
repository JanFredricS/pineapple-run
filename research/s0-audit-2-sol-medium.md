I performed a read-only static audit. I have no Docker access and did not execute the test, build, browser, or WASM suites. Runtime measurements and reported test results are therefore unverified.

## New findings

No high-severity defects found.

### Medium

1. **The angular-speed cap is not valid across the supported wheel-size range** — [src/physics/compound.ts:125](/Users/janfredricsandvik/dev/pineapple-run/src/physics/compound.ts:125), [src/model/cart.ts:22](/Users/janfredricsandvik/dev/pineapple-run/src/model/cart.ts:22), [test/physics/compound.test.ts:54](/Users/janfredricsandvik/dev/pineapple-run/test/physics/compound.test.ts:54)

   `preStep()` applies the full torque whenever the wheel begins a step below 20 rad/s, without limiting torque to the remaining angular-speed headroom. The `<21.3` test only covers radius-22 px wheels.

   Failure scenario: a valid minimum-radius wheel is 5 px = 1/6 m. For a solid circle, `torque = 20m` produces approximately `24 rad/s` of angular acceleration in one 1/60-second step from rest, overshooting the specified 20 rad/s cap by about 20%. Smaller valid wheels therefore do not satisfy the tested 21.3 bound. The direct-torque model itself is correct; the global cap implementation is not.

2. **Level validation has no aggregate terrain-point limit** — [src/model/validate.ts:247](/Users/janfredricsandvik/dev/pineapple-run/src/model/validate.ts:247), [src/model/validate.ts:293](/Users/janfredricsandvik/dev/pineapple-run/src/model/validate.ts:293)

   Each span may contain 100,000 points and a level may contain 10,000 spans, permitting up to one billion validated points. Validation also creates normalized copies, and physics subsequently allocates more copies and WASM vectors.

   Failure scenario: importing a crafted map with many maximum-sized spans passes the declared limits but can exhaust browser memory or freeze the map builder before a recoverable validation error can be surfaced. This is an availability/security issue on an untrusted import path.

### Low

3. **Score update helpers can manufacture books rejected by their own validator** — [src/model/score.ts:90](/Users/janfredricsandvik/dev/pineapple-run/src/model/score.ts:90), [src/model/score.ts:99](/Users/janfredricsandvik/dev/pineapple-run/src/model/score.ts:99), [src/model/validate.ts:338](/Users/janfredricsandvik/dev/pineapple-run/src/model/validate.ts:338)

   `recordLevelResult()` stores raw `seconds` and incompletely normalized `delivered`; `recordEndlessResult()` does not enforce the schema’s seed or maximum-distance constraints.

   Failure scenario: `recordLevelResult(emptyScoreBook(), "x", NaN, 5)` creates a book containing `seconds: NaN`; JSON serialization converts that to `null`, and the next load rejects the saved score. Likewise, a distance over `1e6` or an empty seed can be produced by the update API but is rejected on reload.

## Prior findings

| # | Status | Evidence |
|---|---|---|
| 1. Incorrect motor-based drive | **FIXED** | Torque is computed as `20 × mass` and applied directly to every powered wheel at [compound.ts:87](/Users/janfredricsandvik/dev/pineapple-run/src/physics/compound.ts:87) and [compound.ts:125](/Users/janfredricsandvik/dev/pineapple-run/src/physics/compound.ts:125). Revolute pins are motorless at [compound.ts:97](/Users/janfredricsandvik/dev/pineapple-run/src/physics/compound.ts:97). The separate small-wheel cap defect is reported above. |
| 2. Prototype-sensitive attachment maps | **FIXED** | All three public lookup structures are `Map`s at [attach.ts:124](/Users/janfredricsandvik/dev/pineapple-run/src/model/attach.ts:124), instantiated at [attach.ts:239](/Users/janfredricsandvik/dev/pineapple-run/src/model/attach.ts:239), [attach.ts:285](/Users/janfredricsandvik/dev/pineapple-run/src/model/attach.ts:285), and [attach.ts:303](/Users/janfredricsandvik/dev/pineapple-run/src/model/attach.ts:303). |
| 3. Missing saved-score contract | **FIXED** | Versioned `ScoreBook` schema exists at [score.ts:53](/Users/janfredricsandvik/dev/pineapple-run/src/model/score.ts:53); migration routing and validation exist at [validate.ts:61](/Users/janfredricsandvik/dev/pineapple-run/src/model/validate.ts:61) and [validate.ts:360](/Users/janfredricsandvik/dev/pineapple-run/src/model/validate.ts:360). An empty migration table is appropriate for the initial version. |
| 4. Mock terrain omitted from snapshots | **FIXED** | Mock snapshot now includes terrain body 1 at [snapshot.ts:120](/Users/janfredricsandvik/dev/pineapple-run/src/model/snapshot.ts:120). |
| 5. Extra attachment errors | **FIXED by authoritative amendment** | PLAN now explicitly closes the union over all five codes at [PLAN.md:116](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:116), matching [attach.ts:99](/Users/janfredricsandvik/dev/pineapple-run/src/model/attach.ts:99). This is no longer scope creep and should not be re-litigated. |
| 6. Cart-wide collision suppression | **FIXED** | No shared negative group is assigned. Only directly connected revolute and distance pairs use `collideConnected: false` at [compound.ts:97](/Users/janfredricsandvik/dev/pineapple-run/src/physics/compound.ts:97) and [compound.ts:100](/Users/janfredricsandvik/dev/pineapple-run/src/physics/compound.ts:100). |
| 7. Reset race/world leak | **FIXED** | Generation and destroyed-page guards dispose stale worlds at [page.ts:63](/Users/janfredricsandvik/dev/pineapple-run/src/spike/page.ts:63) and invalidate pending resets during destruction at [page.ts:119](/Users/janfredricsandvik/dev/pineapple-run/src/spike/page.ts:119). |
| 8. Missing select state | **FIXED** | `select` state/action and transitions are present at [app.ts:11](/Users/janfredricsandvik/dev/pineapple-run/src/app.ts:11) and [app.ts:28](/Users/janfredricsandvik/dev/pineapple-run/src/app.ts:28). |
| 9. Inadequate washboard control | **FIXED substantively** | The revised test uses equal seven-pineapple loads, identical controller/duration, verifies both settle at 7/7, and imposes disjoint results: flat ≥6 and washboard ≤3 at [scenarios.test.ts:142](/Users/janfredricsandvik/dev/pineapple-run/test/physics/scenarios.test.ts:142). Aboard bounds are derived from chassis geometry at [scene.ts:101](/Users/janfredricsandvik/dev/pineapple-run/src/spike/scene.ts:101). |
| 10. Non-composed pause causes | **FIXED** | Hidden, blurred, and manual causes are independently retained and OR-composed at [clock.ts:105](/Users/janfredricsandvik/dev/pineapple-run/src/physics/clock.ts:105), with both ordering cases covered at [clock.test.ts:73](/Users/janfredricsandvik/dev/pineapple-run/test/physics/clock.test.ts:73). |

## Washboard-control judgment

The 7/7 control is sound for the claim being tested. It holds cart, load layout, throttle controller, duration, material, and aboard calculation constant; only whether the route crosses the washboard changes. Flat can lose at most one pineapple, while washboard must lose at least four. The single-layer load also avoids confounding the test with an intrinsically unstable upper layer.

It does not demonstrate behavior for a 15-pineapple pile, but that is not necessary to establish the narrower causal claim that this washboard spills a load which the corresponding flat run retains. I accept the divergence from the requested ≥12-of-15 control.

## Acceptance status

The real-phone stability/60-fps exit criterion remains explicitly outstanding in [RESIDUALS.md:9](/Users/janfredricsandvik/dev/pineapple-run/RESIDUALS.md:9).

The deploy workflow exists and the residual log says Pages deployment is resolved, but I cannot independently confirm deployment, green CI, 60 fps, physics thresholds, or WASM heap behavior through static reading alone.
[exited with code 0]
