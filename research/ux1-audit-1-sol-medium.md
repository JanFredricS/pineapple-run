UX1 does not pass static audit. I found four issues. I have no Docker access and did not execute any test suites; conclusions below are from static reading only.

### Findings

1. **Medium — The drawn blender is wider than its physics collider.**  
   [src/render/scene.ts:653](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/src/render/scene.ts:653), [src/render/artCatalog.ts:94](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/src/render/artCatalog.ts:94), [test/render/solidProps.test.ts:158](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/test/render/solidProps.test.ts:158)

   The renderer uniformly scales the 160×340 artwork using collider height only. At 9 m tall, the artwork is about 4.235 m wide, while `BLENDER_SIZE.x` is 3.75 m. The test named “exactly its solid collider” checks only height and bottom position, never width.

   Concrete failure scenario: a cart visibly overlaps about 0.24 m into either side of the blender base before physics contact occurs. This violates the claimed drawn-blender/physics-box agreement.

2. **Medium — The 9 m blender clips on the supported short-landscape viewport used by the project.**  
   [src/game/framing.ts:157](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/src/game/framing.ts:157), [src/game/runScreen.ts:317](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/src/game/runScreen.ts:317), [TUNING.md:323](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/TUNING.md:323)

   Follow zoom depends only on viewport width; there is no finish/blender fitting. At the tested 844×390 phone viewport, zoom is `844/720 ≈ 1.172`, making the blender 316.5 px tall. A cart-follow camera near the pit floor places the blender top above the viewport. The 2.5× rationale claims clipping is why 3× was rejected, but 2.5× is not actually protected from it.

   Concrete failure scenario: the example cart reaches or rests in the finish pit on an 844×390 phone; the camera follows a cart body roughly 1–2 m above the floor, and the upper portion of the blender is off-screen.

3. **Low — The camera accuracy test does not enforce the claimed 0.007–0.011 bound or test the actual interpolated render path.**  
   [test/game/framing.test.ts:221](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/test/game/framing.test.ts:221), [test/game/framing.test.ts:227](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/test/game/framing.test.ts:227), [test/game/framing.test.ts:236](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/test/game/framing.test.ts:236)

   The test permits worst-case error below `0.03`, nearly three times the documented maximum, excludes low-speed and early acceleration samples, and compares discrete `look.x` with discrete cart bounds rather than `look.interpolated(alpha)` against the rendered snapshot.

   Concrete failure scenario: a change raises cruising deviation to 0.029, or creates interpolation-only overshoot during acceleration; the test still passes although the advertised 0.007–0.011 accuracy no longer holds.

4. **Low — The endless streaming acceptance threshold was weakened more than the start-position change requires.**  
   [test/integration/acceptance.test.ts:403](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/test/integration/acceptance.test.ts:403), [test/integration/acceptance.test.ts:429](/Users/janfredricsandvik/dev/pineapple-run-wt/ux1/test/integration/acceptance.test.ts:429)

   The start moved from x=3 to x=7.5, a 4.5 m shift, but the threshold changed from `>160` to `>160 - s.spawn.x`, or `>152.5`, a 7.5 m reduction. The fixed absolute target remains x=170.

   Concrete failure scenario: streaming distance regresses to 153 m. The revised test passes, although it is below both the old requirement and the equivalent shift-adjusted threshold of 155.5 m.

### Clean/static confirmations

- `src/physics/engine.ts`, `springCart.test.ts`, and `springBracing.test.ts` are untouched.
- The recovered terrain source and 71-vertex course span are untouched; only inferred start/end structures changed.
- Premade and original fixture JSON remains tied to source-generation equality tests.
- The empty-builder state is page-module scoped and preserves edits, cleared state, course switches, tested carts, and named-save access.
- The loupe uses persistent graphics, does not allocate textures per touch, is hit-test transparent, and its listeners are removed by builder teardown.
- Camera state is render-side and cannot feed back into physics.
- No security issue or implementation scope creep was found.
- No scratch artifact is included in the reviewed commit diff. The untracked `.codex/runs/...audit-prompt.txt` appears to be audit-harness output, not slice content.
- The S9 merge note is plausible only if S9’s merged fixture generator adds `tikibar` to its generated ID list; that cannot be verified from this pre-S9 branch.
[exited with code 0]
