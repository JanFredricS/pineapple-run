I found one low-severity correctness defect. S8a does not fully pass.

### Finding

- **Low — world tags eventually overflow the 64-bit `userMaterialId` packing.**  
  [src/physics/engine.ts:164](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/src/physics/engine.ts:164), [src/physics/engine.ts:688](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/src/physics/engine.ts:688), [src/physics/engine.ts:697](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/src/physics/engine.ts:697)

  `nextFrictionTag` grows without a bound or reuse policy. With 20 bits reserved for the surface, a 64-bit `userMaterialId` can represent only 44 tag bits. At tag `2^44`, `(tag << 20) | surface` no longer fits in the binding’s WASM integer, while `frictionTables` remains keyed by the untruncated JavaScript number.

  Concrete failure scenario: a sufficiently long-lived process creates and destroys `2^44` worlds. The packed ID wraps/truncates to a tag that does not match the map key, so `frictionDispatch` misses the world’s override and pineapple–wheel contacts revert to the default 0.9 mix. Depending on binding conversion behavior, shape creation could instead reject the out-of-range value. The eight-cycle test cannot expose this boundary.

  A bounded allocator that reuses only tags absent from `frictionTables`, or an explicit exhaustion check, would preserve uniqueness.

### Round-one findings

All four requested fixes are otherwise present by static inspection:

1. V-sag now checks the controller’s aboard count, uses the same rig/course for an executable disabled-limit/0.9-friction control, asserts overrun at every speed, and requires at least one stuck run.
2. Friction and surface numeric contracts, including non-finite rejection, are enforced and tested.
3. The expert-line and removed-`applyShockStops` records are corrected, and R19 cites the executable control.
4. Scenario timings are pinned to the four exact step counts; interleaved worlds, recreate cycles, and a surviving world are covered; the hot-path measurement is recorded and consistent with begin-touch behavior.

I found no other raw `userMaterialId` reader, stale table after normal `destroy()`, security issue, or unrelated scope creep. Residuals R21 and R22 are recorded, and the process-global callback constraint is documented.

I had no Docker access and did not execute any suite. Runtime measurements and test outcomes remain unverified; these conclusions are from static reading only.
[exited with code 0]
