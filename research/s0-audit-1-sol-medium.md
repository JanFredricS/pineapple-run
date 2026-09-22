I performed a read-only static audit. I have no Docker access and did not execute the test or build suites; runtime, performance, deployment, and WASM heap claims remain unverified.

## Findings

### High

1. **Drive behavior violates the specified torque model** — [src/physics/compound.ts:101](/Users/janfredricsandvik/dev/pineapple-run/src/physics/compound.ts:101), [src/physics/compound.ts:139](/Users/janfredricsandvik/dev/pineapple-run/src/physics/compound.ts:139)

   Pinned wheels use a revolute motor with `20 × wheel mass` as a *maximum* torque and ±20 rad/s as a *relative joint-speed target*. The specification calls for direct `20 × wheel mass` torque on every powered wheel, capped by the wheel’s absolute angular velocity.

   Failure scenario: accelerating a pinned wheel applies equal reaction torque to the chassis, causing wheelies that the original drive model would not produce. Braking toward a negative relative-speed target can leave the wheel rotating backward; disabling the motor then lets the cart reverse-creep. Free and pinned wheels consequently implement different drive laws.

2. **Validated part IDs can corrupt attachment maps** — [src/model/validate.ts:182](/Users/janfredricsandvik/dev/pineapple-run/src/model/validate.ts:182), [src/model/attach.ts:236](/Users/janfredricsandvik/dev/pineapple-run/src/model/attach.ts:236), [src/model/attach.ts:256](/Users/janfredricsandvik/dev/pineapple-run/src/model/attach.ts:256)

   IDs accept any non-empty string, while `partBody`, `wheelPins`, and `shockEnds` are ordinary `{}` objects. The special key `__proto__` does not behave as an ordinary own property.

   Failure scenario: an imported, successfully validated cart containing a straw named `__proto__` and a wheel pinned to it produces a non-string `bodyA`. `buildCompound` cannot find that body and eventually fails with an unknown/undefined body handle. This is an untrusted-import denial-of-service/robustness issue.

3. **The validation/persistence contract omits saved scores entirely** — [src/model/validate.ts:211](/Users/janfredricsandvik/dev/pineapple-run/src/model/validate.ts:211), [src/model/validate.ts:283](/Users/janfredricsandvik/dev/pineapple-run/src/model/validate.ts:283)

   The module only defines cart and level validation. PLAN.md explicitly includes localStorage scores among data that must be versioned, validated, migrated, and recoverably rejected.

   Failure scenario: S5 has no frozen score schema or validator to use, so it must invent one after S0 or consume malformed/future-versioned score data without satisfying contract 5.

### Medium

4. **The render mock cannot render its own terrain through the contract** — [src/model/snapshot.ts:101](/Users/janfredricsandvik/dev/pineapple-run/src/model/snapshot.ts:101), [src/model/snapshot.ts:119](/Users/janfredricsandvik/dev/pineapple-run/src/model/snapshot.ts:119)

   Terrain body `id: 1` is present in the manifest but absent from the mock snapshot, and the manifest carries no body transform. The real `PhysicsWorld.snapshot()` does include static bodies, making the mock inconsistent with production.

   Failure scenario: S4 developed against `MockSnapshotSource` joins manifest bodies to snapshot transforms and silently skips the terrain, while the production source displays it.

5. **Two extra attachment errors change the frozen S0 contract** — [src/model/attach.ts:99](/Users/janfredricsandvik/dev/pineapple-run/src/model/attach.ts:99), [src/model/attach.ts:204](/Users/janfredricsandvik/dev/pineapple-run/src/model/attach.ts:204), [src/model/attach.ts:339](/Users/janfredricsandvik/dev/pineapple-run/src/model/attach.ts:339)

   The authoritative enumerated errors are `noWheels`, `floatingShock`, and `disconnectedIslands`. Adding `shockSameBody` and `partTooSmall` changes both the public union and which carts may start.

   Failure scenario: S2 implements an exhaustive UI for the specified three errors, then either fails compilation against this widened union or has no user-facing handling for these new failures. A design the agreed contract did not classify as invalid can also be rejected by `buildCompound`.

6. **Cart-wide collision suppression is broader than connected-joint suppression** — [src/physics/compound.ts:70](/Users/janfredricsandvik/dev/pineapple-run/src/physics/compound.ts:70), [src/physics/compound.ts:84](/Users/janfredricsandvik/dev/pineapple-run/src/physics/compound.ts:84)

   Every shape in the cart receives one negative collision group. This disables collision between all cart bodies, not merely a wheel and the body to which it is pinned.

   Failure scenario: two rigid islands connected only by shocks, or a shock-mounted wheel contacting another chassis section, pass through one another instead of colliding. This can materially change folding, stability, and cargo retention and is not an approved PLAN.md deviation.

7. **Reset is race-prone and can leak a complete WASM world** — [src/spike/page.ts:63](/Users/janfredricsandvik/dev/pineapple-run/src/spike/page.ts:63), [src/spike/page.ts:109](/Users/janfredricsandvik/dev/pineapple-run/src/spike/page.ts:109)

   Reset starts an untracked asynchronous `PhysicsWorld.create()`. There is no generation token, cancellation, or destroyed-page check.

   Failure scenario: pressing R twice can let the older promise resolve last and orphan the other newly created world. Leaving the screen while reset is pending allows the callback to create a new world after page destruction; that world is never destroyed.

8. **The app-state skeleton omits the required level-selection state** — [src/app.ts:11](/Users/janfredricsandvik/dev/pineapple-run/src/app.ts:11), [src/app.ts:25](/Users/janfredricsandvik/dev/pineapple-run/src/app.ts:25)

   PLAN.md specifies `title → select → build → run → results`; the implementation goes directly from title to build and has no `select` state or action.

   Failure scenario: S5 cannot add level selection while preserving the frozen S0 skeleton and must alter the shared state/action contract during parallel work.

9. **The washboard spill test does not establish its stated control condition** — [test/physics/scenarios.test.ts:133](/Users/janfredricsandvik/dev/pineapple-run/test/physics/scenarios.test.ts:133), [test/physics/scenarios.test.ts:144](/Users/janfredricsandvik/dev/pineapple-run/test/physics/scenarios.test.ts:144), [src/spike/scene.ts:98](/Users/janfredricsandvik/dev/pineapple-run/src/spike/scene.ts:98)

   Despite saying “but not on the flat,” the test permits the flat run to retain only 3 of 15 pineapples. It also uses a hard-coded 6.4 m × 4.2 m positional box rather than deriving the cart’s bounds or checking support/contact.

   Failure scenario: an implementation that spills 12 pineapples on flat terrain and 13 on washboard passes. A pineapple flying almost four metres above the bed can still be counted “aboard,” masking an actual spill.

### Low

10. **Blur and visibility pause causes are not composed** — [src/physics/clock.ts:116](/Users/janfredricsandvik/dev/pineapple-run/src/physics/clock.ts:116)

   `visibilitychange` directly sets pause from visibility alone, forgetting an outstanding blur state.

   Failure scenario: after window blur, a `visibilitychange` to `visible` while the window remains unfocused resumes simulation and input processing, contrary to the policy that blur pauses the loop.

## Deviations assessed

- Motor-based drive: not faithful enough; it changes both torque application and the speed cap. Finding 1.
- No self-collision: materially broader than necessary and not approved. Finding 6.
- Extra error codes: contract scope creep. Finding 5.
- Invented wheel/part friction and restitution: not directly forbidden because PLAN.md does not specify these values, but they are unrecovered tuning constants now baked into the golden distance. They should be explicitly accepted as a deviation.
- Endless bonus `0.02`: the plan leaves the bonus unspecified, so a provisional value is not itself a correctness defect. It should not be treated as frozen without S5 approval.
- Mixed units: acceptable and clearly documented; the 30 px/m conversion boundary is centralized.
- Chain ghost extension and per-segment material workaround: statically coherent and localized in the wrapper; no defect found.
- Reverse-creep: a concrete consequence of the motor/braking implementation and not covered by an assertion. Finding 1.

## Clean or unverified areas

The `model/` dependency boundary is clean, and `engine.ts` is the only source module importing the Box2D alias. Terrain spans, coordinate conversion, welding/transitive overlap, wheel pinning, shock snapping, fixed-step constants, catch-up cap, and production-path spike construction are represented.

I found no definite manual `.delete()` double-free or leaked temporary inside `engine.ts` by static inspection. The async reset leak is outside those ownership paths. Runtime heap behavior cannot be confirmed without running the suites.

The real-phone 60 fps/stability exit criterion remains unmet according to [RESIDUALS.md:9](/Users/janfredricsandvik/dev/pineapple-run/RESIDUALS.md:9). Deployment and desktop/runtime stability are also not independently established by this static audit.
[exited with code 0]
