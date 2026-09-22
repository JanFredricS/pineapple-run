I performed a read-only static audit. I have no Docker access and did not execute any test suite, so runtime/timing claims below are limited to what the code establishes.

## Findings

### High — Level runs permanently discard pineapples that could later be delivered

[src/run/controller.ts:368](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:368), [src/run/controller.ts:405](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:405), [src/run/controller.ts:409](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:409)

The endless-mode loss rule is applied unconditionally to level runs. Once `p.lost` is set, that still-live pineapple can neither trigger the goal nor be included in `delivered`. This conflicts with the level rule: the run ends when a pineapple touches the blender base, and delivered is every pineapple past the line. The original explicitly supported catapulted cargo.

Concrete failure: a pineapple spills, rests outside the cart for three seconds, and emits `pineappleLost`; a moving cart or another pineapple later knocks it into the blender. It is physically past `lineX`, but it cannot end the run and is excluded from the delivered count. The test at [test/run/scenarios.test.ts:97](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/test/run/scenarios.test.ts:97) codifies this altered behavior instead of detecting it.

### High — The fixture’s “base sensor” ends runs while cargo is still falling through open air

[src/run/fixtures/flat-goal-level.json:75](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/fixtures/flat-goal-level.json:75), [src/run/controller.ts:401](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:401)

The fixture sensor occupies `y=10.5..13`, while the pit base is at `y=13`. `circleTouchesRect` therefore fires when a pineapple first enters the upper part of the pit, roughly 2.8 metres before touching the base. This does not implement “pineapple touches blender base.”

Concrete failure: a pineapple flies horizontally through the upper pit at `y=11` and would clear or strike another surface without reaching the base. The controller immediately emits `goalReached`.

There is also no swept intersection. A sufficiently fast pineapple can move from one side of a thin valid sensor to the other between fixed-step samples and never overlap it at an observed pose, missing the goal entirely.

### High — Solid LevelDef props, including blender collision, are never instantiated

[src/run/controller.ts:138](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:138), [src/model/level.ts:67](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/model/level.ts:67)

World construction handles terrain, cart, and funnel but ignores `level.props`, including props marked `solid` with a `size`. Consequently, the original behavior where cart parts bounce off the blender is absent, and the frozen LevelDef solid-prop contract is unused.

Concrete failure: a validated level contains `{ solid: true, size: ... }` for its blender or an obstacle. The cart passes through it because no body is created.

This belongs in S1’s physics/world construction, not S6: S6 can author a solid blender, but authoring cannot make an ignored `solid` field collide.

### Medium — Any one cart-body origin crossing the kill plane destroys the entire cart

[src/run/controller.ts:321](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:321)

`killCart()` calls `cart.destroy()` as soon as any cart body’s origin exceeds `killY`. That is broader than handling the body that left the world and assumes every excursion means the entire cart is irrecoverable.

Concrete failure: a shock-mounted wheel extends or bounces briefly below `killY` while the chassis remains safely on terrain. The wheel’s centre crosses the threshold and the complete chassis, all wheels, and all joints disappear mid-run. The kill-plane test at [test/run/scenarios.test.ts:141](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/test/run/scenarios.test.ts:141) only validates total-cart deletion and has no shock excursion case.

### Medium — Pointer cancellation does not perform the required full input clear

[src/run/harness.ts:247](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/harness.ts:247), [src/run/input.ts:78](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/input.ts:78)

`pointercancel` and `lostpointercapture` call `touchEnd(pointerId)`, which removes only that pointer. The specification requires full input clearing on cancellation. Blur/visibility correctly call `clear()`, but cancellation does not.

Concrete failure: two fingers or a keyboard key and one finger are held when the browser cancels one pointer during gesture/system interruption. The cancelled source is removed, but the other stale source remains held and the cart continues driving.

The test titled “blur / visibility / cancel” at [test/run/units.test.ts:49](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/test/run/units.test.ts:49) invokes `clear()` directly; it never exercises the cancellation wiring and therefore cannot detect this defect.

### Medium — Terminal events are not re-entrancy safe

[src/run/controller.ts:315](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:315), [src/run/controller.ts:332](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:332), [src/run/controller.ts:367](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:367)

Lifecycle events are synchronous. If a `pineappleLost` listener calls `giveUp()`, the controller becomes ended and emits `gaveUp`, but the active kill-plane or aboard loop continues marking other pineapples lost. That violates the controller’s stated guarantee that no events follow an ending event.

Concrete failure: several pineapples cross the kill plane in one step. A listener gives up on the first `pineappleLost`; the sequence can become `pineappleLost`, `gaveUp`, `pineappleLost`, ….

There is no re-entrancy test.

### Medium — A schema-valid but unplayable cart destroys the working harness run

[src/run/harness.ts:63](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/harness.ts:63), [src/run/harness.ts:121](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/harness.ts:121)

After JSON/schema validation, the candidate replaces `design`, and `rebuild()` destroys the existing run before `resolveAttachments` validation occurs in the new controller. This contradicts the harness checklist promise that a broken cart shows an error and keeps the current run.

Concrete failure: load a syntactically and structurally valid cart with no wheels or disconnected islands. `parseCartDesign` succeeds, the current run is destroyed, `RunController` rejects the attachment result, and the harness is left with no run. Reset retries the invalid stored design until Fixtures is selected.

### Medium — The controller cannot implement the endless “last pineapple lost ends run” rule

[src/run/controller.ts:315](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:315), [src/run/controller.ts:278](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:278)

When `remaining` reaches zero, the controller stays in `released`, keeps accepting drive input, and continues stepping indefinitely. There is no mode distinction or terminal transition for the endless rule.

Concrete failure: all 15 pineapples fall outside the kept window in an endless run. Fifteen loss events are emitted, but the cart remains controllable and the run never ends unless the user explicitly gives up.

### Low — “Low speed” can start the grounded-loss timer without ground contact

[src/run/controller.ts:352](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:352)

Any outside pineapple moving below `0.5 m/s` is permanently marked grounded until it is later observed aboard. This includes an airborne pineapple near the apex of a trajectory; the code cannot distinguish that from resting on another object.

Concrete failure: a high catapulted pineapple is outside the cart at a 1 Hz check and slows below the threshold near its apex. Its three-second grounded timer begins before it touches anything, allowing it to be declared lost while still airborne.

A normally upright pineapple resting on top of the cart should remain within the expanded AABB, so the specific common “slow cargo on the bed” case appears protected. The false-positive remains possible around unusual/inverted geometry or airborne trajectories.

### Low — Kill-plane handling contradicts “past the goal line is never lost”

[src/run/controller.ts:332](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:332), [src/run/controller.ts:374](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/src/run/controller.ts:374)

The goal-line exemption exists only in the once-per-second aboard check. `killPlane()` does not check `lineX`, runs first, and marks every falling pineapple lost.

Concrete failure: with a valid level whose sensor is small or offset, a pineapple passes `lineX`, misses the sensor, then crosses `killY`. It emits `pineappleLost` despite already having arrived, and can no longer contribute to delivery.

## Test weaknesses

- The tests named “delivers all 15” accept 14 at [test/run/scenarios.test.ts:63](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/test/run/scenarios.test.ts:63) and [test/run/scenarios.test.ts:80](/Users/janfredricsandvik/dev/pineapple-run-wt/s1/test/run/scenarios.test.ts:80).
- No test covers goal crossing at height, swept sensor crossing, event re-entrancy, cancellation wiring, a shock body briefly crossing `killY`, or late delivery of an already-lost pineapple.
- The stability re-run uses the copied rigid spike cart with directly pinned wheels, not a shock-equipped cart. It therefore does not exercise the kill-plane/shock interaction.
- Importing `src/spike/data` for the accepted read-only level fixture is not itself a production dependency or contract violation.

## Clean aspects

- Event names and payload shapes match S0 contract 3.
- Release-time and terminal-time calculations use fixed simulation steps, with no scoring wall-clock leak.
- The Start → Release plug flow, production `resolveAttachments` → `buildCompound` path, direct-torque drive, blur/visibility pause handling, camera smoothing/offset, deterministic seeded spawning, and 1 Hz aboard cadence are present.
- The funnel outlet-centre interpretation is consistent with `LevelDef.funnel` being the release location. The wider frictionless funnel is a reasonable documented tuning choice, not inherently spec drift.
- Both cart fixture JSON files are exact copies of their S0 spike counterparts.
- No changes to `src/model`, `src/physics`, or `src/spike` are present in the reviewed branch diff.
- I found no material security vulnerability. `fixtureJson` is an unused export and minor cleanup debt, not a correctness issue.
[exited with code 0]
