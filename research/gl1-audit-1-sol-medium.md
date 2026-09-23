I found one lifecycle defect; GL1 does not fully pass.

### Medium

- [src/game/runScreen.ts:117](/Users/janfredricsandvik/dev/pineapple-run-wt/gl1/src/game/runScreen.ts:117) — `runPixi` does not destroy an `Application` when `app.init()` rejects after assigning a renderer. The equivalent builder factory explicitly performs this cleanup at [src/builder/builder.ts:84](/Users/janfredricsandvik/dev/pineapple-run-wt/gl1/src/builder/builder.ts:84).

  Concrete failure scenario: Pixi successfully creates the renderer/WebGL context, then an application plugin throws during initialization. `createSharedPixi` clears its rejected promise, but it never receives the partially initialized application and therefore cannot destroy it. Each “Try again” creates another context while the previous one remains allocated—the exact context churn this slice is intended to prevent. The new failed-init test rejects before constructing an application, so it does not cover this path.

### Clean areas

- Context-loss listeners are detached before destroying/replacing an application.
- Subscriber teardown occurs before dead-app destruction, and cleanup stacks are idempotent.
- Builder unmount stops the ticker, clears `resizeTo`, removes stage views, and detaches the canvas without destroying the shared application.
- Recovery generation guards prevent stale async attempts from installing themselves after navigation.
- The two-automatic-recovery cap and manual retry reset behave as documented.
- Builder recovery captures the live editor design, including save-renamed names that bypass `onChange`, without overwriting named storage.
- Run sessions, scene views, loops, HUD, audio hooks, and the development handle are torn down before remount; static reading shows no double-result recording path.
- Pixi v8’s code confirms it privately handles DOM `webglcontextlost`/`webglcontextrestored` events and exposes no public loss notification. Listening on the canvas is appropriate.
- Cached textures are not destroyed by the recovery path; the scene uses renderer-independent textures and Graphics data.
- The revised builder mount-failure assertions appropriately enforce the new singleton lifecycle and at-most-one-application behavior.
- Physics, spring tests, levels, and `tools/levels` are untouched. No scratch file is included in the reviewed diff and no security issue or unrelated gameplay change was found.

I had no Docker access and did not execute any test suite. This report is based solely on static reading of the diff, repository source, and installed Pixi v8 implementation. The real Safari `forceContextLoss()` check remains the correctly recorded R28 residual.
[exited with code 0]
