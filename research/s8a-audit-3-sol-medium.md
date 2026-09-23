S8a does not fully pass. I found one test-coverage defect; the implementation itself appears correct by static inspection.

- **Low — maximum-tag test does not prove the override survives 64-bit packing.**  
  [test/physics/pairFriction.test.ts:215](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/test/physics/pairFriction.test.ts:215), [test/physics/pairFriction.test.ts:230](/Users/janfredricsandvik/dev/pineapple-run-wt/s8a/test/physics/pairFriction.test.ts:230)

  The world using tag `2^44−1` registers friction `0.9`, which is also the default Box2D mix for pineapple–wheel contacts. If the binding truncated or lost the high tag bits, dispatch would miss the table and fall back to `0.9`; the wheel would still lock and the assertion would pass. Thus the test does not meet the criterion that the maximum tag’s packed shape ID round-trips exactly and its override works.

  Concrete failure scenario: `userMaterialId` conversion drops the high tag bits at the unsigned-64-bit boundary. The maximum-tag world silently uses default friction, but this test remains green. Using a non-default override such as `0.3` for the maximum-tag world would expose that failure.

Static inspection otherwise supports the fix:

- The allocator is bounded, and the wrap scan is limited to at most `liveFrictionTags.size + 1` probes.
- Tags are freed only when their world is destroyed, correctly preventing two live worlds from sharing a tag.
- The live-tag set and friction-table map are updated together on normal destruction; table absence for a live world without overrides is intentional.
- `2^44−1` is exactly representable as a JavaScript number, and packing uses `bigint`.
- Exhaustion happens before Box2D resources are allocated.
- The test seam is imported only by tests; no production caller was found.
- No security issue or unrelated scope creep was found in `ef745d2`.

Residuals to retain: R21’s roughly 3% joint-limit give, R22’s heap-climbing trade-off, and the documented process-global callback plus `2^44−1` live-world bound.

I had no Docker access and did not execute any suite. All conclusions are from static reading only.
[exited with code 0]
