I found two high-severity correctness defects, plus several lower-severity lifecycle and edge-case issues. This was static inspection only: I have no Docker access and could not execute the test suites or browser harness.

## Findings

### High

- [src/render/scene.ts:366](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:366) — Terrain invalidation ignores manifest revision, chain contents, and transforms. The cache key contains only theme, body IDs, and each body’s shape count.  
  **Failure scenario:** transition between two levels of the same theme whose new physics worlds reuse terrain body ID `1` with one chain each. Even if the new manifest revision differs, the key remains `beach|1:1`, so the old terrain mesh, gaps, and horizon remain visible while physics uses the new course. The same problem occurs if a streamed body ID is reused with different points.

- [src/render/scene.ts:199](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:199), [src/render/scene.ts:225](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:225), [src/render/scene.ts:435](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:435) — Manifest `prop` bodies and `LevelDef.props` share one layer but incompatible ownership. Manifest props are rendered as magenta collision shapes in addition to their LevelDef artwork. Worse, `placeLevelDecor()` removes and destroys every child in that layer without removing corresponding entries from `this.bodies`.  
  **Failure scenario:** a solid palm exists both as a LevelDef prop and as a static manifest body. It appears with a magenta collider overlay. Changing theme later destroys that manifest body’s `Container`; the following `render()` retains it in `this.bodies` and calls `v.view.position.set(...)` on the destroyed container, whose position has been nulled by Pixi, causing a runtime exception.

### Medium

- [src/render/scene.ts:195](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:195) — `bodySignature` does not solve body-ID reuse when the new source has the same revision number. `sync()` returns before computing signatures. Manifest revisions are source-local, not globally unique.  
  **Failure scenario:** a renderer switches from one snapshot source at revision `10` to a new world also at revision `10`, with reused body IDs but different shapes. Old body visuals remain. Shocks likewise retain old bindings because their key is only the revision at [src/render/scene.ts:314](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:314).

- [src/render/assets.ts:293](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/assets.ts:293), [src/render/assets.ts:362](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/assets.ts:362) — Destroying an `AssetLibrary` while rasterization is pending does not cancel or invalidate the completion callback.  
  **Failure scenario:** navigation destroys the library during SVG decoding. When `bakeAssets()` resolves, it uploads all canvases, repopulates the maps, and marks the supposedly destroyed library ready, leaking GPU resources.

- [src/render/styleguide/main.ts:298](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/styleguide/main.ts:298) — The asynchronous live-physics selector has a stale-completion race.  
  **Failure scenario:** select “Live physics,” then switch back to “Mock cart” before WASM initialization finishes. The pending completion installs the physics level/design even though mode is mock and leaves a physics world plus keyboard listeners alive. The motion source and renderer context then disagree.

### Low

- [src/render/terrainMesh.ts:40](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/terrainMesh.ts:40) — The `1e-4 m` endpoint tolerance converts some valid gaps into joined terrain. Level validation requires only strictly increasing x and defines no minimum gap. The test at [test/render/terrainMesh.test.ts:58](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/test/render/terrainMesh.test.ts:58) explicitly enshrines this behavior.  
  **Failure scenario:** consecutive validated spans end at `x=1` and begin at `x=1.00005`. Physics preserves the gap, but rendering merges the spans and draws fill and edge across it.

- [src/render/terrainMesh.ts:261](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/terrainMesh.ts:261) — Horizon placement is the median of vertices, so it depends on sampling density rather than the spatial terrain profile.  
  **Failure scenario:** a short deep section sampled with 100 points and a long normal-height section represented by a few points makes the parallax horizon follow the short deep section. Through [src/render/parallax.ts:52](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/parallax.ts:52), valid extreme profiles can move background bands hundreds of pixels off their expected horizon.

- [test/render/pose.test.ts:181](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/test/render/pose.test.ts:181) — The test says “wheels touch the ground” but asserts only ID coverage and finite transforms.  
  **Failure scenario:** mock wheel positions drift several metres above or below terrain; this test still passes. There are also no tests covering terrain cache invalidation, solid manifest props, or destruction while assets are loading.

## Clean/static-positive areas

- The production renderer has no physics-object dependency. Physics imports are confined to the style-guide harness at [src/render/styleguide/main.ts:348](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/styleguide/main.ts:348).
- The shock-anchor assumption is currently correct: [src/physics/compound.ts:75](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/physics/compound.ts:75) creates bodies unrotated at `offset + origin`.
- No `src/model` contract files were modified in this slice.
- Atlas overflow is explicit: oversized entries throw, and ordinary overflow creates additional pages rather than corrupting coordinates.
- The three production themes plus the pre-existing test theme are typed exhaustively, have 3–4 layers, and export complete CSS palettes.
- Unknown props/shapes use visible magenta placeholders.
- The no-design fallback is safe for valid S0 manifest shapes, but omits shocks and may choose wrong art. S6 must always call `setCartDesign()` because the manifest contains no joint data.
- Pre-ready access fails loudly rather than rendering partial assets. Callers must await `AssetLibrary.ready`; the style guide does.
- Theme switching and renderer destruction do not request destruction of shared textures, so I found no static texture-ownership leak there.
- Gaps of normal size remain separate and show the background rather than a dark pit.
- Sampled SVGs were structurally consistent with their declared SVG documents.
[exited with code 0]
