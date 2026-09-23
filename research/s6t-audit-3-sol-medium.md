I have no Docker access and could not execute any test suite. This is a static-reading audit only.

S6T does not pass.

## Finding

1. **Medium — The test still permits the claimed 843/843 label-confirmation acceptance criterion to regress.**  
   [test/levels/excitement.test.ts:236](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/test/levels/excitement.test.ts:236), [test/levels/excitement.test.ts:240](/Users/janfredricsandvik/dev/pineapple-run-wt/s6t/test/levels/excitement.test.ts:240)

   The slice claims all 843 endless labels are confirmed, but the assertion only requires 99% confirmation and does not assert that 843 labels were examined.

   **Concrete failure scenario:** if seven labels become unconfirmed, `7 / 843 ≈ 0.0083`, so the test passes despite confirmation falling to 836/843. Likewise, changing the generated label total from 843 is not detected. The acceptance should assert `hazardLabels === 843` and `unconfirmed.length === 0`.

## Static verification

- The new `Surface` construction correctly partitions segment endpoints and cross-span intersections, selects the topmost piece between breakpoints, and derives holes from uncovered intervals.
- Production gap walls are excluded because their wall segment has an endpoint at `killY`; adjoining genuine surface segments remain included.
- The 1 mm top band widens top widths, so its conservative error rejects borderline peaks rather than turning plateaus into peaks.
- Adding drop-to-crest label compatibility does not affect hazard counts or kinds: those remain derived solely from `detected`. Labels only populate `unconfirmedLabels`.
- The twelve boundary cases are hand-built `LevelDef` polylines rather than constructed through `Track`. Their wall representation nevertheless exercises the same census input contract, while real premade and endless geometry receive separate coverage.
- Commit `f2adaa7` changes only `TUNING.md`, `test/levels/excitement.test.ts`, and `tools/levels/census.ts`; no unrelated scope creep or security issue was evident.
- `src/physics/engine.ts` is byte-identical to `main` (SHA-256 `95e81f…89021`).
- `levels/original-course.json` is byte-identical to `main` (SHA-256 `a11f3b…f715`).

Expected residuals remain: friction callback and real joint limits → S8; shortcut risk remains chaotic/unasserted; minimal cart delivers 1–3; no M-key mute; endless opening worst documented dull stretch is 17.9 seconds against the 20-second rule.
[exited with code 0]
