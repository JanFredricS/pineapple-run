I have no Docker access and did not execute the test suites. This is a read-only static assessment.

No defects found in the round-3 scope. **S1 passes.**

1. **FIXED — terminal dispatch re-entrancy**

   [src/model/runEvents.ts:121](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/model/runEvents.ts:121)

   `advance()` now sets `ended` before emitting every event recognized by `isTerminalRunEvent`, including `goalReached`, `gaveUp`, and `allLost`. Consequently, `giveUp()` called by a terminal listener returns without emitting.

   `giveUp()` itself also sets `ended` before dispatch at line 135. Those are the mock’s only two dispatch paths; there is no separate auto-advance path. For non-re-entrant callers, event ordering, cursor advancement, and final state remain unchanged.

2. **FIXED — support-chain calculation**

   [src/run/controller.ts:528](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:528)

   The implementation:

   - Seeds support from terrain, funnel walls/plug, solid props, and attached cart wheels.
   - Excludes aboard pineapples from both seeding and propagation at line 541.
   - Extends only to slow, touching candidates whose supporting pineapple is at or below them at lines 560–568.
   - Uses a frontier until exhaustion, so it computes a fixed-point closure independent of pineapple iteration order.
   - Correctly propagates upward through a resting stack: in y-down coordinates, `m.c.y >= k.c.y` means supporter `m` is at or below candidate `k`.
   - Caches only for the current step and explicitly invalidates after aboard flags change at line 598.
   - Performs at most quadratic pairwise work over the production load of 15 pineapples, which is small and bounded for the specified run.

3. **FIXED — exact spill regression**

   [test/run/scenarios.test.ts:124](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/test/run/scenarios.test.ts:124)

   The scenario now requires exactly 11 losses with `expect(lost.length).toBe(11)`.

The mock re-entrancy test would fail with the original terminal-ordering defect. The exact spill assertion cannot pass with a different loss count. The new airborne-cluster test could pass despite a one-pass/order-dependent closure or broken positive stack propagation because it tests only rejection of unsupported mid-air clusters; however, static inspection confirms the actual implementation uses the correct fixed-point closure.

No new correctness defect, security issue, or fix-cycle scope creep was found.
[exited with code 0]
