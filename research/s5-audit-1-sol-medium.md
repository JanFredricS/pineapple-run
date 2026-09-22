Static audit only: I have no Docker access and could not execute the test suites or build. Findings below are based solely on code and spec inspection.

## Findings

1. **High — Endless carry bonus uses “not yet lost,” not “aboard.”**  
   [src/ui/screens/runHud.ts:216](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/screens/runHud.ts:216), [src/ui/appScreens.ts:83](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/appScreens.ts:83)  
   `RunEndInfo.aboard` is populated from `state.remaining`. That state only changes on `pineappleLost`; it is not the endless-mode aboard measurement defined as “within the cart bounding box + margin, re-checked per second.” `RunTelemetry` exposes only distance, so the HUD cannot obtain the real aboard count.  
   **Failure scenario:** a pineapple falls out immediately before Give Up but has not yet remained out for the three-second loss threshold. It is still included in `remaining`, so the results award carry bonus for a pineapple that is not aboard.

2. **High — The service worker cannot protect unloaded lazy chunks/WASM across a deployment.**  
   [public/sw.js:52](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/public/sw.js:52), [src/ui/pwa.ts:30](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/pwa.ts:30)  
   Installation precaches only assets referenced directly by HTML. The resource-timing message caches only resources already loaded. Neither walks the entry module’s lazy import graph, so an old build’s unloaded run chunk and WASM are absent from its cache. Avoiding `skipWaiting` preserves existing cache entries but cannot preserve files that were never cached.  
   **Failure scenario:** a player opens the title screen, then a deployment removes the previous hashed files before the player enters a run. The old entry requests its old spike/run chunk or WASM, the cache misses, and the network returns 404. The open game breaks despite the claimed deployment safety.

3. **Medium — Results claim scores were saved after persistence has fallen back to memory.**  
   [src/ui/resultsModel.ts:76](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/resultsModel.ts:76), [src/ui/resultsModel.ts:97](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/resultsModel.ts:97), [src/ui/scoreStore.ts:124](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/scoreStore.ts:124)  
   `saved` is calculated only as “a record outcome exists and the store is not read-only.” `isReadOnly` remains false when storage is unavailable or a quota write fails and the store switches to memory. This contradicts the field’s own “can be persisted” meaning.  
   **Failure scenario:** `localStorage.setItem` throws for quota. The toast says the score lasts only until the game closes, but the results omit “(not saved)” and report `saved: true`. Null or inaccessible storage behaves similarly. Existing tests verify the fallback book and notice but never verify the results model’s `saved` value.

4. **Medium — Recording is a screen-mount side effect and is not presentation-idempotent.**  
   [src/ui/appScreens.ts:44](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/appScreens.ts:44), [src/ui/resultsModel.ts:82](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/resultsModel.ts:82)  
   Every results mount calls `buildResults`, which records the outcome. The model persistence helper avoids a second write for an equal score, but the displayed result changes: the first mount gets `newBest: true`; the second sees that score as the prior best and gets `newBest: false`.  
   **Failure scenario:** overlapping/repeated `App.start()` calls mount the same results state twice. The discarded first mount records the score, while the surviving mount no longer shows “New best!” This also means a stale async mount can mutate storage before `App` destroys it.

5. **Medium — Carry-bonus arithmetic remains in UI code, violating the explicit scoring boundary.**  
   [src/ui/format.ts:86](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/format.ts:86)  
   The UI derives bonus using `score - endlessScore(distance, 0)`. Although the operands come from `model/score`, the slice’s hard requirement says every bonus must come from that model and that UI must contain no scoring math.  
   **Failure scenario:** the model later changes how the displayed carry bonus is defined independently of final-score delta. The UI continues deriving its own value and displays a bonus inconsistent with the authoritative scoring API.

6. **Low — `App.destroy()` does not cancel pending app-wide chrome installation.**  
   [src/app.ts:108](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/app.ts:108), [src/app.ts:115](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/app.ts:115), [src/ui/orientation.ts:45](/Users/janfredricsandvik/dev/pineapple-run-wt/s5/src/ui/orientation.ts:45)  
   The dynamic chrome import is fire-and-forget and is not covered by the generation token. Orientation listeners and the body-level overlay have no teardown.  
   **Failure scenario:** an embedded app is started and immediately destroyed; once the import resolves, it still adds the overlay and permanent window/media-query listeners to the host document.

## Clean areas

- The HUD timer reads the supplied simulation clock only for display; I found no UI wall-clock value entering level scoring.
- Level ratings and bands delegate to `model/score`, including the required 32/33 and 66/67 boundaries.
- ScoreBook loads pass through `parseScoreBook`; corrupt data is backed up and discarded, future-version data is protected from overwrite, and quota failures retain an in-memory book.
- Seed normalization and the `[A-Z0-9-_]`, 1–16-character rule are internally consistent.
- Pointer capture, multi-touch sets, pointer cancellation, blur/visibility clearing, and destroy-time drive clearing are statically sound.
- Course IDs and the campaign/bonus unlock ordering are internally consistent.
- I found no evident security vulnerability or unrelated scope creep.
[exited with code 0]
