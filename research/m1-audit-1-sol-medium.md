I could not run Docker, the test suites, or the build. This is a static review only.

M1 does not pass as written.

### Findings

- **Medium — [test/levels/roughness.test.ts:93](/Users/janfredricsandvik/dev/pineapple-run-wt/m1/test/levels/roughness.test.ts:93), [test/levels/excitement.test.ts:21](/Users/janfredricsandvik/dev/pineapple-run-wt/m1/test/levels/excitement.test.ts:21): the original’s new pre-goal stretch is hidden from both audit paths.** Roughness is explicitly capped at the obsolete 7670 px line, preserving the old values, while the excitement census includes only the four premade IDs despite claiming coverage “on every course.”  
  **Failure scenario:** the new roughly 10 m landing counter becomes longer, malformed, or an excessive dull stretch; all existing roughness/excitement pins still pass because that section of the original is never measured.

- **Medium — [test/integration/originalFinish.test.ts:98](/Users/janfredricsandvik/dev/pineapple-run-wt/m1/test/integration/originalFinish.test.ts:98): the new bridger test does not pin the documented 12–15/15 acceptance band.** Each measured minimum is reduced by one at line 110. In particular, the 9 m/s case documents 12 delivered but accepts 11, below the slice’s claimed minimum. Ratings are similarly reduced from the documented exact measurements to a generic `>= 40`.  
  **Failure scenario:** steady 9 m/s regresses from 12/15 to 11/15; the test remains green while R31’s “12–15/15” claim is false.

- **Low — [RESIDUALS.md:37](/Users/janfredricsandvik/dev/pineapple-run-wt/m1/RESIDUALS.md:37): R30 retains zoom-derived figures contradicted by M1.** It still says the blender becomes fully visible at about 4.3 m and ends with “Camera unchanged,” while the same slice documents the new phone threshold as about 9 m and changes the follow-camera zoom formula.  
  **Failure scenario:** later framing work or playtesting uses the obsolete 4.3 m threshold and incorrectly concludes the M1 camera behavior has regressed.

- **Low — [RESIDUALS.md:38](/Users/janfredricsandvik/dev/pineapple-run-wt/m1/RESIDUALS.md:38), [src/spike/page.ts:101](/Users/janfredricsandvik/dev/pineapple-run-wt/m1/src/spike/page.ts:101): R31 does not accurately record the requested spike-page residual.** It names `src/run/harness.ts`, but `src/spike/page.ts` separately retains the width-only formula.  
  **Failure scenario:** maintainers update the documented run harness and consider R31 resolved while the actual spike page still uses width-only phone zoom.

### Other checks

Static inspection found:

- `src/physics/engine.ts` and the spring-cart/bracing tests unchanged.
- The committed JSON changes are limited to pit-floor extent, goal geometry, and blender position; the recovered course span is unchanged.
- Kitchen source/fixture values are untouched.
- `100%` precedes `100dvh`, and the observer is disconnected during teardown.
- No committed scratch or `.codex` files and no security issue found. The worktree does contain an untracked `.codex/runs/...audit-prompt.txt`, but it is not part of the four-commit diff.
[exited with code 0]
