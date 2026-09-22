S6 does not pass this verification audit.

I had no Docker access and could not execute any test suite. These conclusions are based only on static reading. I made no file changes.

## Findings

1. **Medium — Run initialization errors leave a blank screen instead of displaying the error.**  
   [src/game/runScreen.ts:128](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/src/game/runScreen.ts:128), [src/game/buildScreen.ts:46](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/src/game/buildScreen.ts:46)

   The resource leak itself is fixed: `acquireRunResources()` waits for every loader, destroys a fulfilled session exactly once on failure, and rethrows the original loader error. `RunSession.destroy()` is idempotent.

   However, `mountRunScreen()` removes its root and rethrows. Normal entry into the run screen comes from a `void dispatch(...)`; only the initial `app.start()` has an error handler. Consequently, a transition-time rejection is unhandled and nothing renders the error.

   Concrete failure: a missing beach texture rejects `assetsFor()` after the user selects Test Cart. The session is correctly destroyed, but the run root disappears and the player sees a blank host rather than an error or recovery action.

2. **Low — The debris test does not enforce its claimed long-run and terrain-unload behavior.**  
   [test/integration/debris.test.ts:102](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/test/integration/debris.test.ts:102), [test/integration/debris.test.ts:108](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/test/integration/debris.test.ts:108), [INTEGRATION.md:101](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/INTEGRATION.md:101)

   The post-crash loop stops whenever the endless run leaves `released`, but there is no assertion that all 7,200 iterations completed. It also accepts any nonnegative `tipGoneAt`; it does not establish that the tip persisted as debris until its terrain unloaded, or that removal occurred around 29 seconds as documented.

   Concrete failure: all pineapples become lost after 90 seconds, ending the run early. If the cart has already moved 80 metres and the tip is gone, every subsequent assertion can pass despite fewer than 7,200 post-crash steps. Likewise, a regression that deletes detached bodies on the next step would produce `tipGoneAt === 0` and still pass, without testing cleanup through terrain unload.

## Four-finding verification

1. **Session leak: cleanup FIXED; error presentation NOT FIXED.** `Promise.allSettled` prevents pending-resource leakage, handles synchronous loader throws, and preserves the loader rejection unless cleanup itself throws. The real-session test could not pass against the original checkout because the helper did not exist, although it tests the helper rather than mounting the screen.

2. **Production `window.__prRun`: FIXED.** Both assignment and teardown reset are DEV-gated, the URL-query route is gone, and static grep of the existing `dist` found no `__prRun`. The source test is string-fragile—it only recognizes exact `window.__prRun` syntax and does not itself inspect the production bundle—but no current exposure was found.

3. **Builder Fit: FIXED.** `fitArea()` unions the entire build rectangle with every funnel wall and plug vertex and adds 12 px above the highest point. The no-start-area behavior is unchanged.

4. **Ledger #13: NOT FULLY VERIFIED.** Test-only raw Box2D access is acceptably confined to the test, and the S8 device-performance deferral is reasoned. The test gap described above makes the stronger S6 verification claim unsupported.

No new security exposure or material scope creep was found.

Residuals remain as expected: the original course still needs S6V playtesting with a non-constant driver; debris resting inside the retained terrain window persists until the cart departs, bounded by cart part count; real-device performance profiling remains deferred to S8.
[exited with code 0]
