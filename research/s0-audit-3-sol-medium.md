I performed a read-only static audit. I have no Docker access and cannot execute the test, build, browser, or WASM suites; runtime behavior and reported measurements remain unverified.

## Finding

Low — Score helpers can still return a book rejected by `validateScoreBook`.

- [src/model/score.ts:129](/Users/janfredricsandvik/dev/pineapple-run/src/model/score.ts:129)
- [src/model/score.ts:141](/Users/janfredricsandvik/dev/pineapple-run/src/model/score.ts:141)
- [src/model/validate.ts:381](/Users/janfredricsandvik/dev/pineapple-run/src/model/validate.ts:381)
- [src/model/validate.ts:388](/Users/janfredricsandvik/dev/pineapple-run/src/model/validate.ts:388)

Both record helpers append without enforcing the validator’s 10,000-entry limits. The 5,000-case property test starts from an empty book and draws from only a few distinct IDs, so it never exercises this boundary.

Concrete failure scenario: take a valid book containing exactly 10,000 uniquely identified level records and call `recordLevelResult` with a new level ID. It returns 10,001 records, which `validateScoreBook` rejects at `levels`. The equivalent failure occurs for a valid book with 10,000 seeds passed to `recordEndlessResult`.

This leaves round-2 finding 3 incompletely fixed and contradicts the helpers’ stated guarantee that every returned book validates.

## Verified clean areas

- Torque uses the wheel body’s actual rotational inertia and implements `min(20 × mass, I × (cap − drive·ω) / dt)`, with zero torque at or beyond the directional cap. Reversal and opposite-spin handling are correct.
- The minimum-radius test asserts an absolute peak no greater than `20 + 0.001 rad/s`.
- The post-braking backward nudge is consistent with the specified torque law: reverse torque can spin an airborne wheel toward −20 rad/s, and touchdown friction can transfer that stored rotation to the cart after drive release. Static reading does not indicate lingering drive torque.
- Terrain limits are checked on raw arrays before point normalization: at most 2,000 spans and 200,000 aggregate points, with the crossing span reported. No large validator-created point copy occurs before rejection.
- Numeric score inputs are checked for finiteness and clamped using constants shared with validation; ID and seed constraints match validation.
- No new scope creep or security defect was found in these fixes.

Because of the remaining score-cap defect, I cannot conclude “S0 passes.”
[exited with code 0]
