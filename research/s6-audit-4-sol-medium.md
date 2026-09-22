S6 passes.

I had no Docker access and could not execute any test suite. This audit is based solely on static reading; I made no file changes.

- Builder init leak: **FIXED**. [builder.ts:146](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/src/builder/builder.ts:146) owns one idempotent LIFO teardown stack. It covers the root, initialized Pixi app, renderer, stage view, toast timers, animation frames, listeners, input reset, and resize observer. Successful Pixi initialization necessarily assigns `renderer` before returning, so the guard at [builder.ts:187](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/src/builder/builder.ts:187) does not omit a successfully initialized app.
- Concurrent/stale retry: **FIXED symmetrically** in [buildScreen.ts:42](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/src/game/buildScreen.ts:42) and [runScreen.ts:125](/Users/janfredricsandvik/dev/pineapple-run-wt/s6/src/game/runScreen.ts:125). Generation increments synchronously, making a second activation of the old retry callback inert. Stale completions destroy themselves, destroy-during-load is handled, and there is no await between the final liveness check and installation.
- Tests: the new failure tests exercise the real `mountBuilder` body with counting Pixi/renderer substitutes, including failure after successful app initialization and repeated retries. The retry tests genuinely hold attempts mid-flight with deferred promises and cover both screens. They are not tautologies.
- New defects from `a87f829`: none found.
- Scope creep or security issues: none found.

Residuals to record:

- Original course versus constant-pace driver remains for S6V playtesting.
- Debris remaining inside the retained terrain window persists until the cart moves away, bounded by cart part count.
- Device performance profiling remains deferred to S8.
- Coverage this cycle is fake-DOM-only; S6V supplies live-browser playtesting.
- A destroyed attempt’s “Loading…” root can remain until pending loaders settle; cosmetic and pre-existing.
- Cleanup of a partially failed Pixi initialization remains best-effort; teardown errors are caught and logged.
[exited with code 0]
