S6V does not pass.

This was a static, read-only review. I have no Docker access and did not execute any test suites, builds, or browser playtests. Findings below are limited to what repository reading supports.

## Findings

1. **High — S7 audio is not integrated into the application.**  
   `src/app.ts:234-236`, `src/game/runScreen.ts:171-174`, `src/game/audioHooks.ts:13-27`

   The app mounts `mountRunScreen` without an audio dependency, so every run selects `NO_AUDIO`. `AudioHooks` also does not directly match `GameAudio`: the latter exposes `onRunEvent`, `setCourseProgress`, `setEndlessDistance`, `stopRunSounds`, and music/SFX objects rather than `runStarted`, `drive`, `paused`, and `runStopped`. No adapter, app-level `GameAudio` instance, `init()`, progress updates, mute UI, or `destroy()` call exists.

   **Failure scenario:** launch the completed game, play any campaign or endless run, release cargo, drive, lose pineapples, and reach the blender. No music, motor loop, release clatter, goal sting, blender whir, or loss sting plays. Course-quarter and endless-distance stage changes never occur, and mute persistence is inaccessible from the game.

2. **Medium — “Lost is advisory” cargo loses its streamed ground and can become irrecoverable.**  
   `src/game/session.ts:146-157`, `src/run/controller.ts:463-470`, `src/run/controller.ts:514-526`

   `RunSession.liveXs()` excludes every pineapple marked `lost`, including in level mode. Those bodies remain alive and eligible for goal delivery, but no longer retain terrain. Once the cart moves far enough away, their terrain can unload; they then fall through the absent ground and are destroyed at `killY`. This makes the lost flag affect simulation and recoverability, despite the ledger saying it drives HUD/aboard state only and recovered cargo must still count.

   **Failure scenario:** a pineapple spills, rests outside the cart for three seconds, and is marked lost. The cart drives more than the retention margin ahead, unloading that chunk. The pineapple falls through the removed chain and is destroyed. Driving back can no longer recover or deliver it, unlike the stated advisory-lost behavior.

3. **Medium — Secondary HTML entry points are emitted but not precached.**  
   `vite.config.ts:27-37`, `src/ui/precache.ts:55-63`, `src/ui/precache.ts:76-81`, `public/sw.js:73-81`

   All requested entry points, including `run-harness`, `mapbuilder`, and `audio-harness`, are in the Vite input. However, `precacheEntries()` admits only paths under `assets/`; emitted HTML files are omitted from `assets`. The worker precaches only the main `./` shell plus that list.

   **Failure scenario:** after a successful online install, navigate offline directly to `mapbuilder.html` or `audio-harness.html`. The worker has not cached that HTML; navigation fallback returns the main game shell rather than the requested tool page.

4. **Medium — HUD touch cancellation does not honor the run input contract’s full clear.**  
   `src/ui/screens/runHud.ts:106-145`, compared with `src/run/input.ts:88-95` and `src/run/input.ts:119-151`

   The production HUD implements its own pointer tracking. Both `pointercancel` and active `lostpointercapture` call the same handler as a normal `pointerup`, deleting only one pointer. The canonical run binding performs `touchCancel()`, which clears every held input source.

   **Failure scenario:** two fingers are tracked by the drive controls and the browser cancels one during a system gesture. The other stale pointer remains in the HUD set, so the cart can continue driving or unexpectedly switch direction instead of coasting.

5. **Medium — Valid non-positive solid props render despite having no physics body.**  
   `src/model/validate.ts:281-292`, `src/run/props.ts:29-40`, `src/render/scene.ts:602-623`

   Validation allows zero or negative `size` components. Physics deliberately skips such props, but the renderer tests only `prop.solid && prop.size` and renders them as solid decoration. A blender with an unusable size is also selected as the animated goal prop even though no collider was created.

   **Failure scenario:** a validated level contains `{solid:true,size:{x:0,y:3.6}}`. The player sees a solid prop or blender body, but the cart and pineapples pass through it because physics skipped it.

6. **Medium — Rotated blender visuals ignore the collider’s angle.**  
   `src/run/props.ts:33-40`, `src/render/scene.ts:638-647`

   Physics rotates every solid prop around its centre. The special blender renderer places its view at `position.y + size.y / 2` and never applies `prop.angle`, unlike ordinary solid props.

   **Failure scenario:** a validated level authors a blender on a sloped platform with a non-zero angle. Its collision box is rotated, while the visible blender remains upright and vertically offset, causing collisions against apparently empty space or visible penetration.

7. **Low — Circular builder parts can escape the build area and overlap the funnel.**  
   `src/builder/edits.ts:68-95`, `src/game/startArea.ts:6-14`, `src/game/session.ts:65-78`

   Circle centres and drag endpoints are clamped, but radius is their distance; the circle itself is not constrained to the build area. A radius approaching the build-area diagonal is therefore legal. This contradicts the start-area invariant that no drawable part can overlap the funnel.

   **Failure scenario:** draw a wheel near one corner and drag to the opposite corner, then pin it to a small cube. Attachment validation accepts the cart. The session lifts it to put the huge wheel’s bottom on the ground, leaving the wheel enveloping the funnel and initial pineapple load, producing immediate unintended collisions.

## Clean seam

- **Run events → controller → UI/scoring is clean by static inspection.** `simTime()`, `furthestMetres()`, terminal `allLost`, level-mode advisory delivery counting, score persistence/unlocks, retry identity, and display-only endless carry bonus are coherently wired.
- Within the other seams, the manifest/snapshot-only renderer boundary, shock connectivity through distance-joint edges, px/metre conversion, `setCartDesign()`, `resetSource()`, shared-Pixi retry teardown, deterministic terrain recreation, overhang ownership, kill-plane chassis handling, and portrait/visibility pause-cause composition appear coherent.

No security vulnerability or material scope creep was identified statically. No new acceptable-only residuals need recording; the items above are defects rather than residual observations.
[exited with code 0]
