S6 does not pass this audit. Static review found two implementation defects and one unmet ledger requirement.

I had no Docker access and did not execute any test suite. All conclusions below come from static reading only.

## Findings

1. **Medium — Failed run-screen initialization can leak a complete physics session.**  
   [src/game/runScreen.ts:123](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/src/game/runScreen.ts:123)

   `Promise.all` assigns `session` only after Pixi, assets, and `RunSession.create()` all succeed. If texture/Pixi initialization rejects while the session succeeds, the catch block sees `session === null` and cannot destroy the newly created world.

   Concrete failure: a missing/corrupt theme asset rejects `assetsFor()` after the WASM world has initialized. The screen reports the error, but the physics world, terrain bodies, controller, and listeners remain unreachable and cannot be reclaimed normally. Repeated attempts leak additional worlds.

2. **Low/security — The supposedly dev/test-only run handle is exposed in production through a query parameter.**  
   [src/game/runScreen.ts:227](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/src/game/runScreen.ts:227)

   `?debug` bypasses `import.meta.env.DEV` and publishes the live `RunSession`, `PhysicsWorld`, controller, and level as `window.__prRun` in a production build.

   Concrete failure: opening the deployed game with `?debug` exposes mutable gameplay internals to any same-page script or console user, allowing world mutation and score/run manipulation. If the hook is intended to be dev-only, production must not enable it from user-controlled URL input.

3. **Low — The builder’s initial “Fit” calculation crops the real funnel.**  
   [src/builder/builder.ts:466](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/src/builder/builder.ts:466)

   The fit bounds use only the plug position minus 40 px. The shared outlet is at design `y = -225`, while the real 3.6 m funnel walls extend approximately 108 px upward to `y = -333`. The fitted minimum is therefore about `-265`, cropping roughly 68 px of the walls.

   Concrete failure: entering any shipped course’s builder initially shows only the lower funnel; users must manually pan or zoom to see its full relationship to the build area, contrary to ledger item #6’s real-start-area integration.

4. **Unmet ledger requirement — Item #13 is neither verified nor explicitly deferred.**  
   [INTEGRATION.md:70](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/INTEGRATION.md:70), [test/integration/acceptance.test.ts:234](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/test/integration/acceptance.test.ts:234)

   The ledger requires S6/S8 to check debris growth over long endless runs. The S6 status does not defer this to S8 with a reason, and the integration suite’s endless test exercises streaming/reversal but never damages a cart or bounds debris/body counts.

   Concrete failure: a spring-heavy cart sheds multiple non-chassis bodies during a long endless run; persistent debris or manifest/body growth could degrade performance without any S6 acceptance test detecting it.

## Ledger assessment

- #1 implemented: `simTime()` is wired through the controller, session, HUD, and mock.
- #2 implemented: `furthestMetres()` is exposed and used by endless HUD/results.
- #3 implemented for shipped courses and endless.
- #4 implemented: catalog IDs and seed parsing agree with course loading.
- #5 implemented and covered by scoring/unlock tests.
- #6 implemented, subject to the funnel-fit defect above.
- #7 implemented: solid blender collider plus animated renderer view.
- #8 implemented: portrait state composes with FrameLoop pause causes.
- #9 implemented using `mountRunHudScreen`.
- #10 implemented and tested for both level and endless behavior.
- #11 implemented: every run calls `setCartDesign`.
- #12 implemented consistently between physics, authoring, and renderer.
- #13 incomplete as described above.

The endless scoring ruling is correctly preserved: raw distance is stored, while the carry bonus is display-only.

## Clean areas

- Streamed terrain retention includes attached cart bodies and every live, non-lost pineapple. Loss evaluation occurs before the next streaming update, so a resting pineapple’s terrain is not removed merely because the cart moved away.
- Oversized/overhanging terrain-piece ownership remains handled by the S3 streaming planner.
- Normal run teardown order is coherent: loop/input/HUD/renderer are removed before session and world destruction.
- The shared Pixi application is reused, the canvas is detached per run, and `resetSource()` is called for every new world.
- Renderer additions continue to consume manifests and snapshots rather than physics objects.
- Retry and save/reload comparisons are substantive: both event streams and chassis traces are compared.
- Gap acceptance includes geometric queries and a real falling body; it is not a vacuous test.
- The recovered original course vertices remain unchanged. The added 7 m pit floor replaces only the inferred end structure and is clearly documented. The original course’s incompatibility with the premade pace driver is not an S6 blocker because the checklist requires completion of the three premade campaign levels; it is appropriately a playtest/tuning residual.
- The initial run camera hiding most of the funnel is cosmetic rather than a correctness blocker.
- `src/physics` is untouched. The only `src/model` diff is the authorized `RunEventSource.simTime()` amendment and corresponding mock adaptation.
[exited with code 0]
