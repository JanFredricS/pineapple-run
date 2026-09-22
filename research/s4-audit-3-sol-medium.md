Static reading only. I have no Docker access and could not execute the test suites or browser style guide.

S4 does not pass due to one remaining correctness defect.

### Medium

- [src/render/scene.ts:105](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:105), [src/render/scene.ts:331](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/scene.ts:331) — `bodyFingerprint()` does not encode `partIds` unambiguously. Joining with commas makes different valid arrays collide; for example, `['a,b', 'c']` and `['a', 'b,c']` produce the same fingerprint. Part IDs are arbitrary validated strings, so commas are permitted. The equal fingerprint causes same-revision fresh references to be accepted without recomputing the exact signature.  
  **Failure scenario:** a new manifest source reuses a revision and body ID, supplies fresh arrays, and changes between those two `partIds` arrays. Without `resetSource()`, the renderer retains its old signature and does not increment `bodyGeneration`. Umbrella bindings, which map bodies through individual part IDs at [src/render/pose.ts:149](/Users/janfredricsandvik/dev/pineapple-run-wt/s4/src/render/pose.ts:149), consequently remain missing or attached to the wrong body. This is an additional, undocumented fingerprint blind spot beyond interior chain points. Encode the array structurally—such as `JSON.stringify(info.partIds ?? [])`—rather than using a delimiter.

The six round-2 items otherwise appear fixed:

1. Revision changes, `resetSource()`, and `setCartDesign()` force exact signature recomputation. Identical references take the cheap path. The documented interior-chain blind spot is reachable when separate `PhysicsWorld` instances restart their revision counters, but the renderer API requires source-switch callers to call `resetSource()`; the included source switch does so.
2. Join tolerance uses both candidate endpoints’ x/y magnitudes. The float32 reconstruction test is meaningful, and the documented approximately-21-km bound for preserving 1 cm gaps is accurate. Beyond that bound, small real gaps can be joined, but this limitation is stated.
3. `horizonReferenceY()` implements the weighted mixture correctly: flat segments are point masses, slopes contribute uniform distributions, vertical segments contribute no mass, and interpolation/ties are handled correctly. The nonuniform collinear-resampling test is meaningful.
4. Rasterization failure after destruction resolves `ready`; live failure still rejects with the asset ID.
5. `terrainFillPositions()` returns new `Float32Array` copies.
6. The per-frame complexity is documented, and the `JSON.stringify` spy meaningfully verifies that unchanged-revision fresh arrays avoid full signatures.

Full signature storage is O(total serialized manifest content), retained once per body with shared references in the renderer’s caches. It is bounded for validated levels by the 200,000-point input limit, but the generic `SceneManifest` interface itself has no renderer-enforced bound. I found no leak from the change.

No security issue or material scope creep was found.
[exited with code 0]
