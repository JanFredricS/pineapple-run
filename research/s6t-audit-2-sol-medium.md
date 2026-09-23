I have no Docker access and could not execute any test suite. This is a static-reading audit only.

S6T does not pass.

## Finding

1. **Medium — The geometry census does not reliably implement its stated minimum feature scales.**  
   [tools/levels/census.ts:181](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/tools/levels/census.ts:181), [tools/levels/census.ts:280](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/tools/levels/census.ts:280), [tools/levels/census.ts:291](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/tools/levels/census.ts:291), [tools/levels/census.ts:311](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/tools/levels/census.ts:311)

   The surface is sampled every 0.25 m, and gap width and peak-top width are inferred solely from sampled indices. That is insufficient for the declared 0.3 m gap threshold, 0.12 m tooth threshold, and 2 m maximum peak-top width.

   **Concrete failure scenario:** place a 0.5 m hole between grid-aligned terrain endpoints. The endpoints remain ground and only one interior 0.25 m sample is null, so line 285 computes a width of 0.25 m and rejects the hole even though 0.5 ≥ 0.3. Conversely, a flat hilltop slightly wider than 2 m can have a sampled flat run measuring at most 2 m and be counted as a crest; that false crest can satisfy a crest label, increase density/kind counts, and suppress dull-window detection.

   The self-tests at [test/levels/excitement.test.ts:47](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/test/levels/excitement.test.ts:47) cover a long flat crest and a 9 m mandatory gap, but do not exercise these minimum-scale/alignment boundaries.

## Round-1 findings

1. **Census-from-labels: NOT FIXED completely.** Counts and dull detection are now geometry-derived, label/no-label equality is tested, the exact 5 m flat-crest case is real, and cross-kind confirmation cannot turn an entirely flat road into hazards. However, the sampling defect above violates the promised geometric definitions.

2. **Damaged-cart shock stops: FIXED statically.**  
   [src/run/controller.ts:492](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/src/run/controller.ts:492) invokes `applyShockStops()` on every damaged-cart step. [src/physics/compound.ts:158](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/src/physics/compound.ts:158) skips destroyed joints/bodies through `bumpStop`, and the frozen wrapper removes joint records when bodies are destroyed. The test’s strict 0.8–1.15 assertion applies to ordinary driving; abusive kicks deliberately use a wider 0.7–1.25 bound and compare against the stubbed control. That reconciles the documented 1.248 result.

3. **Framing: FIXED for the stated whole-shape requirement.** Real rotated polygon, chain, and circle AABBs are used. Funnel-plus-cart is preferred at zoom ≥0.35; otherwise the complete cart is fitted, including below 0.35. Static HUD padding is considered, although tests validate the declared padding rectangle rather than actual DOM-element intersections.

4. **Shortcuts: FIXED statically.** Every premade course contains the pool geometry. Detection requires continuous sampled ground, a ≥1 m dip, an entirely skipped washboard/steps hazard, and slow landing before the deepest point. The integration assertions distinguish airborne and through-pool routes and require both to deliver 15/15 with a ≥2-second advantage. Greater risk remains intentionally unasserted.

5. **Original-course bound: FIXED statically.** Three nearby lines require ≥9 deliveries, while the reference line requires exactly 10.

## Other verification

- `src/physics/engine.ts` is byte-identical to `main`—matching SHA-256 hashes.
- The entire `levels/original-course.json` is byte-identical to `main`, which is stronger than comparing only the 71 recovered vertices.
- Premade JSON/source synchronization still uses exact deep equality at [test/levels/premade.test.ts:38](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/test/levels/premade.test.ts:38).
- No `test/_scratch` file is committed. An ignored local `test/_scratch` directory exists, but `git ls-files test/_scratch` is empty.
- No new security issue or material scope creep was evident in the seven fix commits.

Expected residuals remain: friction callback and real V-sag joint limits deferred to S8; shortcut risk is chaotic and unasserted; 2/700 endless labels remain detector misses; minimal-cart delivery remains 1–3; and there is no M-key mute shortcut.
[exited with code 0]
