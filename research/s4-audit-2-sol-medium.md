Static reading only. I have no Docker access and could not execute the test suites or browser style guide.

S4 does not pass yet.

## Findings

### Medium

- [src/render/scene.ts:235](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:235), [src/render/scene.ts:246](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:246) — In-place shape mutations are not detected, even when the manifest revision changes. Once array identities match, `sync()` reuses the old signature instead of recomputing content. This contradicts the claimed “revision change → full content diff.”  
  **Failure scenario:** `PhysicsWorld.addChain()` pushes into the existing `rec.shapes` array and increments the revision at [src/physics/engine.ts:329](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/physics/engine.ts:329). If this happens after an initial render, the renderer sees the new revision but identical `shapes` reference, retains the old signature, and never draws the added terrain chain. The same applies to `addPolygon()` and `addCircle()`.

- [src/render/terrainMesh.ts:42](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/terrainMesh.ts:42), [src/render/scene.ts:449](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:449), [src/physics/engine.ts:542](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/physics/engine.ts:542) — `1e-9 m` does not cover independently rounded Box2D body transforms at large endless-world coordinates. Box2D positions are single-precision; near `x=20,000`, float32 spacing is approximately `0.001953 m`. Converting the returned values to JavaScript numbers cannot restore the lost precision.  
  **Failure scenario:** two contiguous terrain chunks use separate static bodies with different origins but share a mathematical world endpoint. Their independently quantized origins can produce endpoint coordinates differing by roughly millimetres, far exceeding `1e-9`. Rendering treats them as separate chains and adds two wrapped cliff lips at what should be a seamless join. The current test at [test/render/terrainMesh.test.ts:68](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/test/render/terrainMesh.test.ts:68) uses only JavaScript double arithmetic around `x=1`, so it cannot expose this.

- [src/render/terrainMesh.ts:285](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/terrainMesh.ts:285), [src/render/terrainMesh.ts:294](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/terrainMesh.ts:294) — The horizon remains sampling-dependent. Weighting each segment’s midpoint by `|dx|` is an approximation, not an invariant weighted median of the represented piecewise-linear terrain.  
  **Failure scenario:** the line `(0,0) → (10,10)` produces horizon `5`. Adding the redundant collinear point `(1,1)` changes the same geometric profile into segments with weighted midpoint heights `0.5` and `5.5`, producing horizon `5.5`. The test at [test/render/terrainMesh.test.ts:98](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/test/render/terrainMesh.test.ts:98) checks only approximately uniform resampling and misses nonuniform resampling.

### Low

- [src/render/assets.ts:298](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/assets.ts:298) — Destroyed libraries resolve `ready` only when baking succeeds. A later rasterization rejection bypasses the `.then()` destroyed check, so `ready` rejects despite the acceptance criterion that it still resolves after destruction.  
  **Failure scenario:** destroy the library while an image is decoding, then have that decode fail. An awaiting teardown or navigation path receives a rejection—potentially unhandled—instead of benign completion. The new test exercises only successful decoding after destruction.

- [src/render/scene.ts:559](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:559) — `terrainFillPositions()` exposes the live mutable Pixi geometry buffers rather than diagnostic copies.  
  **Failure scenario:** test or style-guide code assigns `terrainFillPositions()[0][0] = NaN`. The displayed terrain is corrupted, and subsequent renders retain it because the terrain cache key has not changed. `stats` itself exposes only values and is safe.

- [src/render/scene.ts:237](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:237), [src/render/scene.ts:247](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:247) — Fresh arrays every frame cause a full `JSON.stringify` of every body and terrain point every frame. This is bounded to 200,000 terrain points only for validated `LevelDef` input; `SceneManifest` itself has no bound.  
  **Failure scenario:** a valid maximum-size level source recreates its shape arrays on each `manifest()` call. The renderer allocates and compares a multi-megabyte signature every frame, creating severe frame stalls despite an unchanged revision.

## Round-1 disposition

1. **Terrain cache: PARTIAL.** Fresh-array content and pose changes are handled, but in-place changes are missed. Equal-length FNV-1a collisions can also deliberately or randomly suppress a terrain re-skin. The consequence is limited to stale terrain rendering; the full signature still protects body visuals, so I found no worse memory or security consequence.
2. **Prop ownership: FIXED.** Only cart, wheel, and pineapple roles enter the body map. Prop/debug bodies are not drawn, decor has separate ownership, and renderer destruction tears down the decor layer. I found no remaining path where decor teardown leaves a destroyed container in the body map.
3. **Source identity: PARTIAL.** `PhysicsWorld.manifest()` recreates the outer body records but reuses `rec.shapes` and `rec.partIds`, so the normal steady-state assumption is valid. However, its shape arrays can be mutated in place by the public fixture-add methods. `MockRunSource` now builds once. Fresh-array cost remains potentially excessive.
4. **Destroy while loading: PARTIAL.** Successful baking after destruction no longer uploads or becomes ready, and `texture()` throws. Rejection after destruction still rejects `ready`. No current style-guide path can destroy its local library while `main()` awaits it.
5. **Style-guide race: FIXED.** Switch tokens invalidate stale loads, and late worlds are destroyed with their listeners.
6. **Join tolerance: PARTIAL.** Real `1e-6 m` gaps remain gaps, but `1e-9 m` is insufficient for separate float32 body transforms around large endless coordinates.
7. **Horizon reference: PARTIAL.** It is distance-weighted and the `medianY` fallback is reachable and correct, but it is not invariant under nonuniform resampling of identical geometry.
8. **Tests: PARTIAL.** The wheel-centre assertion is meaningful rather than tautological and the new scene tests cover the stated ordinary cases. They omit in-place mutation, large-coordinate/float32 joins, nonuniform horizon resampling, and rejected loading after destruction.

I found no direct security vulnerability and no material scope creep beyond the mutable test accessor.
[exited with code 0]
