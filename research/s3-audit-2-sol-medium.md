I found two residual correctness defects. S3 does not pass this re-audit.

I have no Docker access and did not execute the suites. All conclusions are from static reading.

## Findings

1. **Medium — vertex fallback can still create a non-smooth physical seam.**  
   [src/terrain/chunks.ts:186](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/chunks.ts:186), [src/physics/engine.ts:295](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/physics/engine.ts:295)

   The fallback cuts at the first vertex at or after the boundary. Although the displacement bound holds, that vertex can join a long incoming segment to a run of short outgoing segments with a completely different direction. Each resulting Box2D chain extrapolates its own end direction for its ghost vertex, rather than receiving the true adjacent vertex. This violates the seam rule the implementation otherwise relies on.

   Concrete failure scenario: a valid span has a horizontal segment ending exactly at x=40, followed by more than 0.5 m of 5 mm-spaced vertices forming a 45° incline. No segment in the search range is cuttable, so the fallback splits at x=40. The left chain extrapolates horizontally while the right chain extrapolates the incline backward. A wheel crossing x=40 can encounter different endpoint collision behavior—a lip or catch—than it would on the original continuous chain.

   The physics test at [test/terrain/runtime.test.ts:135](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/test/terrain/runtime.test.ts:135) cannot expose this: every boundary vertex in its profiles is followed by a long segment, so the implementation interpolates at x=40.01 instead of entering vertex fallback.

2. **Low — minimum-size generated levels violate the “less than one block past requested length” criterion.**  
   [src/terrain/generator.ts:600](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/generator.ts:600), [test/terrain/generator.test.ts:105](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/test/terrain/generator.test.ts:105)

   `blocksForLength` always returns at least two blocks. Their goal is at x=61.3 m, so requests below 21.3 m overshoot by at least 40 m.

   Concrete failure scenario: `generateLevel(seed, 1)` returns a goal at x=61.3, which is 60.3 m beyond the requested length—more than the 40 m block width.

   The new test explicitly skips the upper-bound assertion when `blocks === 2`, so its `len = 1` case cannot fail on this unmet criterion.

## Round-1 disposition

1. **PARTIAL.** Cut displacement is bounded—the fallback’s first vertex after the boundary is at most 0.01 m past it—and pieces are now assigned directly between consecutive boundaries. Default streaming keeps 30 m behind every body, including both harness and map-builder paths, so the ≤0.51 m overhang remains loaded. The fallback seam defect above remains.

2. **FIXED.** Past the contiguous cap, streaming retains the union of every live body’s neighborhood. With `maxChunks: 1`, the neighborhood legitimately exceeds the cap because live-body retention takes precedence. Hysteresis storage is bounded by the current per-body hold neighborhoods, plus at most one capped contiguous wanted window during a mode transition. Memory is O(live bodies), not O(distance).

3. **FIXED.** Empty chunks are recorded without bodies or lifecycle events. `loadAll()` uses occupied indices. The only existing sources are `LevelChunkSource`, which implements `occupiedChunks()`, and the unbounded procedural source, for which `loadAll()` throws first. The ±1,000,000 case is bounded through both `loadAll()` and the map-builder’s streaming test-roll path.

4. **FIXED.** Chunks are deep-frozen before body creation/listener notification; `loadedChunkData()` returns the frozen object, and physics receives a copied outer point array before copying every point internally.

5. **PARTIAL.** Normal generated lengths now place the goal at or after the request and `MAX_GENERATED_LENGTH` is consistent. The specified ID format is implemented, and no current generated-level persistence or old-ID comparison exists. The short-length overshoot above remains.

I found no additional security issue or material scope creep in the reviewed fixes.
[exited with code 0]
