I performed a read-only static audit. I have no Docker access and did not execute any test suite. Findings below are limited to static evidence.

## Findings

### Medium — Mock terminal events remain re-entrancy unsafe

[src/model/runEvents.ts:124](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/model/runEvents.ts:124), [src/model/runEvents.ts:131](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/model/runEvents.ts:131)

`MockRunEventStream.advance()` marks the stream ended only after notifying listeners. A listener handling a scripted terminal event can therefore call `giveUp()` while `ended` is still false, producing a second terminal event.

Concrete failure: an `allLost` listener calls `mock.giveUp()`. The observed sequence becomes `allLost`, `gaveUp`, violating “exactly one terminal event; nothing emitted after it.” The test calls `giveUp()` only after `advance()` has returned, so it misses this re-entrant case.

### Medium — Airborne pineapple pairs can falsely “support” one another

[src/run/controller.ts:522](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:522), [src/run/controller.ts:530](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:530)

The pineapple support test accepts any nearby non-aboard pineapple. It does not require the other pineapple to be grounded, below the candidate, or itself connected through a support chain to terrain or a solid prop.

Concrete failure: two spilled pineapples remain close together near the apex of a high launch and both slow below `0.5 m/s`. Each treats the other as support, starts its grounded timer while airborne, and can be reported lost less than three seconds after actually landing—or, for a sufficiently high flight, while still airborne.

### Low — The required exact loss-count regression assertion is still permissive

[test/run/scenarios.test.ts:123](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/test/run/scenarios.test.ts:123)

The test documents an observed count of 11 losses but accepts any result from 9 through 13. This does not satisfy the re-audit brief’s exact-count requirement.

Concrete failure: a physics or support-detection regression changes the fixture from 11 losses to 9 or 13. The test still passes, despite a materially different cargo outcome.

## Round-one status

1. **FIXED** — Lost pineapples remain live goal candidates, and delivered counts live pineapples past `lineX` regardless of `lost`.
2. **FIXED** — The fixture has an 8 m pit and 0.25 m base strip; the swept-circle/rectangle calculation handles tunneling and corner distance correctly.
3. **FIXED** — Positive-sized solid props are centered at `position`, rotated about that center, and non-positive sizes are skipped. This is consistent with the schema’s static-box wording; no contrary origin convention exists in S0.
4. **FIXED** — Chassis identity is the heaviest rigid body; non-chassis bodies are removed individually, joints disappear with them, and connectivity is recomputed. Debris remains physical but no longer counts as cart.
5. **FIXED** — `pointercancel` and active capture loss clear all input; ordinary `pointerup` releases only its pointer.
6. **PARTIAL** — `RunController` is re-entrancy safe, including the requested loss/goal cases, but `MockRunEventStream` is not.
7. **FIXED** — Parsing, schema validation, and attachment resolution precede rebuild; construction occurs before the old run is destroyed.
8. **FIXED** — Endless ignores the goal and emits final `pineappleLost(remaining: 0)` followed by same-time `allLost`; level mode does not terminate on all-lost.
9. **PARTIAL** — Kill-plane delivery and dead-export cleanup are fixed, but support geometry permits unsupported pineapple chains and one scenario retains a ranged count assertion.

The `allLost` contract amendment is otherwise strictly additive: the new union member is appended, existing variants retain their order and shapes, new exports are additive, and the mock recognizes `allLost` as terminal.

I found no material security issue or unjustified production scope creep. Debris growth is bounded by the fixed cart/cargo body set. The fixture blade is a visible solid obstacle that makes the test level playable rather than a hidden bypass. Given fixed-step WASM physics, the ±0.25–0.3 second windows are not statically demonstrable as flaky.

**Verdict: S1 does not yet pass**, due to the two behavioral defects and the unmet exact-count test criterion above.
[exited with code 0]
