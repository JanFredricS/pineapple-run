I found five defects. This was a static audit only: I have no Docker access and could not execute the test suites.

## Findings

1. **High — valid dense spans can be assigned to the wrong chunks, removing terrain under live bodies.**  
   [src/terrain/chunks.ts:111](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/chunks.ts:111), [src/terrain/chunks.ts:158](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/chunks.ts:158)

   `cutAt` skips short segments until it finds one with sufficient clearance, potentially moving a cut arbitrarily far past its nominal boundary. `cutSpan` then assigns the entire resulting piece according to its endpoint midpoint, assuming cuts remain within a few centimetres of the boundary.

   Concrete failure: an imported, valid span containing sub-2 cm segments continuously from x≈40 to x≈80 can move the x=40 cut to just past x=80. A piece covering x=0…80 is then assigned to chunk 1 by its midpoint, leaving chunk 0 empty. A body at x=10 requests chunk 0 and falls through terrain that exists in the LevelDef. Consecutive boundaries may also cut the same later segment and produce multiple pieces assigned to one chunk.

   The micro-segment test at [test/terrain/chunks.test.ts:72](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/test/terrain/chunks.test.ts:72) only covers a short run that ends immediately after x=40, so it cannot detect displacement across another chunk boundary.

2. **High — the 256-chunk cap violates body-aware retention by explicitly discarding trailing live bodies’ terrain.**  
   [src/terrain/streaming.ts:107](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/streaming.ts:107), [src/terrain/streaming.ts:114](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/streaming.ts:114)

   When the required window exceeds `maxChunks`, `want.from` and `hold.from` are moved toward the right edge. This no longer keeps `[min live body − margin, max live body + ahead]`.

   Concrete failure: with a still-live pineapple at x=0 and the cart more than about 10.24 km ahead, the pineapple’s chunk is destroyed despite still being included in `bodyXs`. It then loses its supporting terrain and can be incorrectly counted as lost. With a lower configured cap, the same failure happens over much smaller distances.

   The cap test at [test/terrain/streaming.test.ts:63](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/test/terrain/streaming.test.ts:63) codifies this contract violation by checking only that the forward end survives.

3. **High — a small validated level can make map-builder test-roll allocate tens of thousands of empty physics bodies.**  
   [src/terrain/runtime.ts:54](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/runtime.ts:54), [src/terrain/runtime.ts:94](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/runtime.ts:94), [tools/mapbuilder/main.ts:846](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/tools/mapbuilder/main.ts:846)

   `loadAll()` enumerates every index between the first and last occupied chunks. `apply()` creates a static body even when `source.chunk(k).pieces` is empty. Validation limits individual coordinates but does not bound the chunk-index range.

   Concrete failure: import a valid level with one short span near x=-1,000,000 and another near x=1,000,000, then press Test Roll. It attempts to create roughly 50,001 static bodies, almost all empty, from a tiny JSON document. This can freeze or exhaust the browser and is an untrusted-import resource-exhaustion issue.

4. **Medium — lifecycle listeners can mutate the streamer’s internal chunk geometry.**  
   [src/terrain/runtime.ts:80](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/runtime.ts:80), [src/terrain/runtime.ts:96](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/runtime.ts:96)

   The chunk stored in `loaded` is passed directly to every listener and returned directly by `loadedChunkData()`.

   Concrete failure: the first renderer/listener changes `chunk.pieces[0][0].y` while caching or transforming it. Later listeners and late subscribers receive the modified geometry, while the physics chain was already created from the original values. Rendering therefore no longer mirrors physics. A listener can also change `chunk.index`, breaking renderer cleanup bookkeeping.

5. **Low — generated levels can be shorter than the requested length.**  
   [src/terrain/generator.ts:543](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/generator.ts:543), [src/terrain/generator.ts:589](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/generator.ts:589)

   `blocks = ceil(length / 40)`, but the finish ends at approximately `blocks × 40 − 13.34 m`. This contradicts the function’s “at least length” contract.

   Concrete failure: `generateLevel(seed, 2000)` ends near x=1986.66 rather than reaching 2000 m. The existing test only requires the goal to exceed 1900 m, so it misses the shortfall.

## Clean areas

- No S0 `src/model` contract files were modified.
- Original-course loading and map-builder JSON import/export go through model validation.
- The 71 recovered vertices, unit conversion, washboard measurements, goal line, and clearly documented inferred additions appear consistent with the research material.
- The gradient-noise derivative is algebraically correct, and the PRNG/noise path uses deterministic integer and basic IEEE-754 operations. I found no concrete cross-engine generator divergence.
- The finish surface’s unclamped slopes are within the minimum configured limits: the lip is 0.2 and the pit drop is 1.6. The intentionally steep end wall is a separate span.
- The gap landing-height formula correctly compensates for an ascending anchor line.
- Adding `tools/` to `tsconfig` and the extra Vite page entries are in scope.
- The `ENDLESS_KILL_Y` test is only a finite sweep, not a proof, but static inspection did not establish a terrain formula that exceeds the bound.
[exited with code 0]
