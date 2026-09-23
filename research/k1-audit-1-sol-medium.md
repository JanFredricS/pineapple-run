I have no Docker access and could not execute any suite. This audit is based only on static reading.

K1 does not pass yet.

## Findings

1. High — the “example cart can never cross” claim is not covered by the claimed synthetic sweep.  
   [test/integration/kitchen.test.ts:109](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/integration/kitchen.test.ts:109) tests only the shipped Kitchen run-up at hold-right and five speeds: 5, 7, 9, 11, and 13 m/s. There is no synthetic-track family covering different run-up lengths, widths/heights, intermediate speeds, or upward launch pitch, despite the measurements documented at [TUNING.md:593](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/TUNING.md:593).  
   Failure scenario: an example cart approaches at 10 or 12 m/s, or leaves a preceding bump with upward pitch, bounces off the far wall and lands on the counter. All committed negative tests still pass.

2. Medium — the asserted failure modes are weaker than specified.  
   [test/integration/kitchen.test.ts:122](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/integration/kitchen.test.ts:122) accepts either `allLost` or stuck/Give Up for every tested speed. It does not pin 5–9 m/s to falling and ending with `allLost`, nor 11–13 m/s to jamming with the stuck hint.  
   Failure scenario: 5 m/s becomes a prolonged wall jam instead of producing Retry, or 11 m/s falls and ends immediately; the test passes although the specified player-facing behavior changed.

3. Medium — the Bridger speed-band acceptance threshold is one pineapple too weak.  
   The slice requires every steady 4–9 m/s run to deliver at least 13/15, but [test/integration/kitchen.test.ts:155](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/integration/kitchen.test.ts:155) advertises and [line 159](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/integration/kitchen.test.ts:159) asserts only 12/15. This also contradicts the progression claim at [TUNING.md:723](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/TUNING.md:723).  
   Failure scenario: any steady speed regresses from 13 to 12 delivered; the suite remains green while the acceptance criterion fails.

4. Medium — Kitchen’s original finish-framing guarantee was silently weakened.  
   Kitchen now uses only the Bridger at [test/game/framing.test.ts:309](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/game/framing.test.ts:309), skips the first roughly 15 m of its enlarged finish pit at [line 332](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/game/framing.test.ts:332), and checks only the cart’s midpoint-to-front at [lines 341–349](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/game/framing.test.ts:341). Consequently there is no longer a Kitchen assertion preserving whole-cart, whole-blender framing for a normal-length cart, and even the Bridger is unchecked through most of the pit. The test name at [line 366](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/game/framing.test.ts:366) is now inaccurate.  
   Failure scenario: a camera change clips an ordinary cart, the blender, or the Bridger’s front during the first portion of Kitchen’s pit; the Kitchen framing test never observes that interval.

5. Medium — the claimed roughness improvement exists only as prose, not a committed measurement.  
   The figures for travel/m, slope mean/p90, relief, and bumps/100 m appear at [TUNING.md:620](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/TUNING.md:620). The added census test at [test/levels/excitement.test.ts:208](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/levels/excitement.test.ts:208) measures hazard classifications, not those roughness metrics or their floor relative to the original.  
   Failure scenario: later terrain edits flatten most slab relief while retaining the same detector-classified hazards; all committed pins pass even though Kitchen is no longer materially closer to the original’s bumpiness.

6. Low — several advertised census and Bridger properties are not actually pinned.  
   [test/levels/excitement.test.ts:213](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/levels/excitement.test.ts:213) pins 8.26 hazards/100 m, but [lines 214–226](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/levels/excitement.test.ts:214) do not pin the claimed 82.3–89.8 m detected-gap bounds, 1.08 s dull stretch, or exact 0.60 crest. Likewise, [test/integration/kitchen.test.ts:72](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/integration/kitchen.test.ts:72) checks wheel spacing but never verifies the claimed loaded centre of mass lies between the middle wheels.  
   Failure scenario: the detector bounds or dullness value drift substantially, or a mass/layout change moves loaded CoM outside the middle supports; the named “pins” still pass until a physics run happens to expose the instability.

7. Low — the hold-right Bridger result is not protected.  
   [test/integration/acceptance.test.ts:137](/Users/janfredricsandvik/dev/pineapple-run-wt/k1/test/integration/acceptance.test.ts:137) only requires the paced line to beat flooring by five points and flooring to deliver fewer than 15. It does not require hold-right to reach the goal, deliver 11, or rate 62.  
   Failure scenario: hold-right stops at the sink and scores zero; the test still passes because the paced result beats zero by more than five.

## Clean areas

Static reading supports these parts:

- The authored sink is 5.5 m wide, 0.5 m higher, with a flat run-up and no launch lip.
- The example wheelbase arithmetic is 5.0 m.
- Gap-wall coverage was extended without removing the prior Kitchen or Workbench cases.
- The Bridger goes through normal cart validation/attachment and `RunSession` paths; no physics backdoor was added.
- Its wheel reaches exceed 5.5 m, and its fit checks use the real build area and wheel-radius clamp.
- `finish({frontGap})` retains the 5.75 m default, and only Kitchen requests 20 m.
- The generated-fixture equality test remains intact.
- Frozen physics, renderer, other course sources, and other course pins were not changed.
- No security issue or material scope creep is evident in the reviewed diff.
[exited with code 0]
