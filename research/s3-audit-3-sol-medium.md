S3 does not pass this round-3 audit. Finding 2 is fixed, but the vertex-fallback seam still has correctness gaps.

I have no Docker access and did not execute any suites. All conclusions are from static reading.

## Findings

1. **Medium — the documented dense-zig-zag residual can recreate the original collision lip.**  
   [src/terrain/chunks.ts:197](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/chunks.ts:197), [src/terrain/chunks.ts:224](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/chunks.ts:224)

   `vertexTurn` correctly orders ordinary vertices by `1 − cos(angle)`, but validation imposes no useful bound on that angle. A valid import can make every candidate in the 0.5 m window an almost-180° turn. The selected “smallest” turn can therefore still be nearly π, producing mutually incompatible ghost directions.

   Concrete failure scenario: use x increments of 0.005 m from x=40 through x=40.5, alternating y between 9 and 11. Every segment is too short in x for interpolation, while every interior turn is approximately 179.7°. The fallback cuts at one of those vertices, and each chain extrapolates in nearly the opposite direction from the true adjacent segment. A wheel can catch or launch differently than on the original unbroken chain.

   The residual is bounded only by the mathematical maximum turn of π—not by a gameplay-tolerable bound. The comment also says the mismatch “equals” the `vertexTurn` value, but that value is `1 − cos(angle)`, not the angular or positional ghost mismatch. This is a real remaining defect, not merely acceptable documentation.

2. **Medium — neighbour clearance does not guarantee sanitization preserves the neighbours used to score the seam.**  
   [src/terrain/chunks.ts:205](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/chunks.ts:205), [src/terrain/chunks.ts:231](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/chunks.ts:231), [src/terrain/chunks.ts:246](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/chunks.ts:246)

   `vertexTurn` only verifies that `a–v` and `v–b` are at least 5 mm. `sanitizePiece` can nevertheless discard `a` because it is less than 5 mm from the preceding kept vertex. The actual left-chain end direction then differs from the direction that scored zero.

   Concrete failure scenario: around x=40, use consecutive vertices `(39.999,10)`, `(40,10)`, `(40.006,9.994)`, `(40.012,9.988)`, followed by enough dense points to force fallback. The candidate at x=40.006 has zero mathematical turn using its immediate neighbours. Sanitization drops `(40,10)` because it is only 1 mm from `(39.999,10)`, so the physical left-chain direction becomes `(39.999,10) → (40.006,9.994)`, which is not collinear with the right-hand 45° segment. Thus the claimed exact seam is not produced.

   Existing geometric tests use uniformly spaced profiles and do not cover this interaction.

3. **Medium — distinct generated courses can receive the same level ID.**  
   [src/terrain/generator.ts:612](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/generator.ts:612), [src/terrain/generator.ts:666](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/generator.ts:666)

   Geometry is selected from the clamped length and block count, while the ID uses `Math.ceil(requestedLength)`.

   Concrete failure scenario: requests 61.3 and 61.31 with the same seed both receive `gen-<seed>-62`, but the former has two blocks and goal x=61.3, while the latter has three blocks and goal x=101.3. Since score persistence identifies levels by `levelId`, results for two different courses can overwrite or share one record. Conversely, requests 1 and 61.3 produce the same geometry but different IDs, fragmenting scores for an identical course.

   The 18-length test exercises both sides of this boundary but never asserts ID behavior.

4. **Low — the cross-engine determinism claim is not guaranteed.**  
   [src/terrain/chunks.ts:218](/Users/janfredricsandvik/dev/pineapple-run-wt/s3/src/terrain/chunks.ts:218)

   ECMAScript does not guarantee that `Math.sqrt` is correctly rounded identically by every implementation. Valid coordinates can also produce arbitrarily close candidate scores, so an implementation-level last-bit difference can change which vertex wins.

   Concrete failure scenario: two candidate vertices have turn scores separated only at the final floating-point bit. Different conforming square-root approximations may reverse their comparison, selecting different cut coordinates and producing different serialized chunks.

## Verification disposition

- Vertex-fallback seam: **NOT FIXED** due to findings 1 and 2.
- Shift bound: **FIXED** for the standard 40 m chunks; the cut remains within the stated 0.51 m allowance.
- Geometric and convex physics tests: structurally meaningful and would discriminate the old first-vertex fallback. The concave physics case remains non-discriminating as admitted.
- The `2π` angle comparison is sound here because transforms obtain angles through `atan2`, keeping each angle in `[-π, π]`.
- Minimum generated length and clamp contract: **FIXED**. `MIN_GENERATED_LENGTH` is 61.3, the skip is removed, maximum length is consistent, and the listed boundary lengths are exercised.
- Generated level identity: **NOT FIXED** due to finding 3.
- No new security issue or material scope creep was found within the narrow reviewed changes.
[exited with code 0]
