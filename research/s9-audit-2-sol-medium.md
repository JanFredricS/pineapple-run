I could not use Docker or execute the test suites. This audit is based solely on static reading.

## Finding

1. Medium — non-bead courses prematurely persist the bead tier  
   [runScreen.ts:224](/Users/janfredricsandvik/dev/pineapple-run-wt/s9/src/game/runScreen.ts:224), [deviceTier.test.ts:101](/Users/janfredricsandvik/dev/pineapple-run-wt/s9/test/game/deviceTier.test.ts:101)

   `runBeadCount(deps)` is called unconditionally for every course. Consequently, loading Beach, Kitchen, Workbench, Original, or Endless writes `pineapple-run.beadCount.v1`, contrary to the documented rule that the first **bead-level** load chooses and stores the tier.

   Concrete failure scenario: the user plays Beach while the injected/reported device information indicates the 300 tier. Before their first Tiki Bar run, the device information changes to the 600 tier. Tiki Bar still builds 300 beads because Beach already created the persistent pin. The new wiring test actively expects every session to call the resolver and therefore cannot catch this defect.

   The resolver should only be invoked—or at least only allowed to persist—when `course.level.zones` contains a bead zone.

## Verification results

1. **Bead-count persistence: core determinism fixed, but new persistence-scope defect above.** Once stored, the count is stable across same-browser reloads. Overrides win without being persisted. Invalid/unreadable storage falls back to the tier, and localStorage access, quota, private-window, and other write failures are caught. The namespaced/versioned key is consistent with existing storage naming. Given that no run/replay state crosses devices, excluding cross-device reproduction is honest.

2. **Harness zones: fixed.** `RunSession` uses `worldOptionsForLevel`; the generic run harness uses `createRun`. Candidate-build failure, stale-generation cleanup, and old-run preservation remain intact. The style guide, terrain harness, and map-builder test roll are specialized physics/terrain tools rather than `RunController` creation paths, so their default worlds are not omissions within this fix.

3. **Margins: fixed.** Tests enforce pace ≥12/15 and rating ≥60 at all tiers, flooring ≤7/15, and a ≥25-point advantage. Census counts and kinds are pinned to 10/8 and 7/5, with the stated rates and thresholds. The 450-bead result sitting exactly at 12 is brittle but honest: simulation is deterministic, and it remains two deliveries above the original acceptance floor.

4. **Performance gate: fixed.** It runs only when `S9_PERF === '1'`; `0` and other values skip.

5. **Music: fixed.** Tiki Bar has an explicit `COURSE_MUSIC` entry, the fallback is separate, and every catalog course is checked.

No security issue or unrelated scope creep was found. R23–R26 accurately record the accepted risks, apart from R25 and the documentation overclaiming that pinning occurs specifically on the first bead-level load.

Because of the premature persistence defect, I would not mark this round “S9 passes.”
[exited with code 0]
