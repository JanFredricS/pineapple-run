Static audit only: I have no Docker access and could not execute the test suites or production build. Findings are based solely on code inspection.

## Findings

1. **High — Service-worker versioning is not tied to the complete precache manifest.**  
   [src/ui/pwa.ts:23](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/pwa.ts:23), [src/ui/precache.ts:53](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/precache.ts:53), [public/sw.js:29](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/public/sw.js:29)

   The generated manifest has a digest covering every emitted asset, but that digest is unused. Both the worker URL and cache name instead use only the main entry chunk hash. A change confined to extracted CSS, the secondary harness entry, public files, or other output that does not alter the main entry hash can leave both `sw.js?v=…` and `CACHE` unchanged. If `sw.js` itself is unchanged, the browser has no changed worker script to install, so the new manifest is never processed.

   **Failure scenario:** a CSS-only deployment emits a new hashed CSS asset while the main JS hash remains unchanged. Existing installations keep the old worker/cache indefinitely and never precache the new CSS. The next offline load can receive a cached or previously network-cached shell without the new stylesheet.

   This also undermines atomic isolation when `sw.js` changes without the main entry hash: the installing worker opens the active worker’s cache. `Promise.all` is not transactional, so it can overwrite the shell before another required fetch rejects, leaving the old worker active over a partially modified cache.

2. **Medium — Installation does not strictly cache all PWA assets.**  
   [public/sw.js:35](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/public/sw.js:35), [public/sw.js:75](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/public/sw.js:75), [src/ui/precache.ts:35](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/precache.ts:35)

   Only files under `assets/` are placed in the generated manifest. Icons are handled as optional, with all fetch failures swallowed, despite the acceptance criterion that installation include all assets.

   **Failure scenario:** an icon request transiently returns 404 during installation. The worker still installs successfully, but the installed PWA later has no cached icon while offline. This is not the promised all-assets atomic installation.

3. **Medium — Result recording is only idempotent for the most recent 32 result IDs.**  
   [src/ui/resultsModel.ts:105](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/resultsModel.ts:105), [src/ui/resultsModel.ts:114](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/resultsModel.ts:114)

   Evicting an ID forgets that its result was already recorded. This contradicts the stated resultId-keyed “record once” contract.

   **Failure scenario:** retain an old results `AppState`, complete 32 further runs using the same `ScoreStore`, then mount the retained state. Its ID has been evicted, so `buildResults` records it again and the rendering can change from “New best!” to an ordinary prior-best display.

4. **Low — The direct `mountAppScreen` fallback defeats remount idempotence.**  
   [src/ui/appScreens.ts:49](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/appScreens.ts:49)

   A results state lacking `resultId` receives a fresh ID inside every `mountAppScreen` call. `App.mount()` stamps a stable ID, so the primary App path is safe, but the exported direct-mount API is not.

   **Failure scenario:** a harness or integrator mounts the same bare results state twice through `mountAppScreen`. The first call records a new best; the second gets another ID, records again, and no longer renders the same model.

## Round-one status

1. **Aboard telemetry and display-only bonus — FIXED.**  
   `RunTelemetry.aboard()` is sampled for every HUD-recognized ending at [runHud.ts:239](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/screens/runHud.ts:239). Raw distance alone is passed to persistence. Telemetry remains optional, but the intended S6 wiring path uses it.

2. **Complete atomic precache — PARTIAL.**  
   Lazy chunks and WASM are now enumerated, but findings 1–2 leave update identity, cache isolation, and public assets incomplete.

3. **Truthful `persisted`/`saved` — FIXED.**  
   Quota failure, null/unavailable storage, and future-version read-only mode all produce `persisted: false`.

4. **Record-once and stale-mount protection — PARTIAL.**  
   `MountContext.isCurrent()` prevents the built-in stale results mount from writing, but the 32-entry eviction and fallback-ID behavior violate durable record-once semantics.

5. **Additive score helper — FIXED.**  
   `endlessCarryBonus` is the only model addition; no existing score export or behavior changed. `format.ts` uses the new helper.

6. **Destroy/chrome cancellation and overlay teardown — FIXED.**  
   `App.destroy()` invalidates pending mounts/imports and invokes the reference-counted overlay uninstall.

## Test gaps

No test is wholly vacuous, but these tests can all pass with the defects above:

- [precache.test.ts:9](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/test/ui/precache.test.ts:9) explicitly expects public files to be skipped and never tests that manifest digest drives worker registration/cache identity.
- There is no service-worker lifecycle test for failed-install cache isolation or build takeover.
- [lifecycle.test.ts:36](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/test/ui/lifecycle.test.ts:36) exercises only two result IDs, so it cannot expose the 33rd-entry eviction.
- The direct `mountAppScreen` test supplies a result ID and never remounts a bare results state.

The strict “one transient 404 rejects installation” behavior is acceptable when the cache version is genuinely unique: the old worker remains active and a later online registration can retry. A successfully installed worker takes over once all clients controlled by the previous worker close; an indefinitely open old tab can therefore delay activation indefinitely by design.

I found no additional security issue or unrelated scope creep. **S5 does not yet pass.**
[exited with code 0]
