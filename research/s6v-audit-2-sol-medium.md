# S6V fixes pass

Static verification finds all seven round-1 defects fixed, with no new correctness defect, security issue, material scope creep, or obviously non-failing test introduced by this diff.

I have no Docker access and did not execute test suites, builds, or browser playtests. This conclusion is limited to static repository reading.

| Finding | Status | Static basis |
|---|---|---|
| 1. Audio wiring | **FIXED** | App-level ownership and lifecycle are wired in [appAudio.ts](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/game/appAudio.ts:58), production construction in [main.ts](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/main.ts:6), and run events/progress/distance/motor/pause/teardown are adapted in [audioHooks.ts](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/game/audioHooks.ts:109). Hooks are protected by `safeHooks`; first failure is logged rather than silently swallowed. Pre-gesture title music creates a suspended graph and the engine resumes it synchronously from the first registered gesture. Retry state is reset by `runStarted`. |
| 2. Lost terrain | **FIXED** | [session.ts](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/game/session.ts:156) retains every alive pineapple in level mode while preserving endless-mode terminal semantics. Existing capped/per-body streaming keeps retention bounded by live-body count rather than scatter distance. Cart debris remains excluded. |
| 3. Precache | **FIXED** | [precache.ts](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/ui/precache.ts:65) includes emitted HTML while preserving map/manifest exclusions and whole-deploy digesting. [sw.js](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/public/sw.js:116) performs network-first navigation, then requested-page lookup with query ignored, then shell fallback. |
| 4. HUD cancellation | **FIXED** | [runHud.ts](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/ui/screens/runHud.ts:154) distinguishes normal lift from cancellation and fully clears both touch sets. [runScreen.ts](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/game/runScreen.ts:266) also clears keyboard state, matching `DriveInput.touchCancel()`. |
| 5. Solid-prop sizes | **FIXED** | Shared `hasSolidBody` lives in [level.ts](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/model/level.ts:79) and is used by validation, physics construction, and rendering. Invalid solid props are rejected or consistently omitted, including blender selection. |
| 6. Rotated blender | **FIXED** | [scene.ts](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/render/scene.ts:645) positions the view at the rotated collider’s bottom-centre and applies its angle. The production renderer imports only the shared model predicate—not physics or run geometry. Angle zero preserves the previous placement. |
| 7. Circle clamp | **FIXED** | [edits.ts](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/builder/edits.ts:58) floors the nearest-edge distance to stored precision; [makeDraft](/Users/janfredricsandvik/dev/pineapple-run-wt/s6v/src/builder/edits.ts:104) clamps the stored radius. Edge presses yield radius zero and are rejected by the existing minimum-size rule. A wholly contained circle cannot reach the funnel geometry above the build area. |

`src/physics` and `src/audio` are untouched by the reviewed diff. The renderer’s production boundary remains manifest/snapshot based.

Residuals to record:

- No contact-event SFX; physics exposes no such event stream.
- Saved/share-code designs are not build-area checked and can bypass the builder clamp.
- The development-only `window.__prAudio` handle remains available and is not cleared on teardown.
[exited with code 0]
