# S6T playtest — tuning backlog

Date: 2026-09-23. Build: `main` via the Vite dev server, run in headless Chrome at 1280×760 and a real 60 fps.
Input came only from real keyboard and mouse events: ←/→, Space, and button clicks. Carts were built by dragging in the builder.
Telemetry was read from `window.__prRun` and never written to. Where a run is described as "paced", a script held target speeds by pressing and releasing ←/→ the way a human would.

Carts:
- **Example**: the builder's Example Cart.
- **Minimal**: one straw floor (x 40→190, y −25) with two r25 wheels at its ends. No walls.
- **Articulated**: two rigid groups joined **only** by three shocks. The builder reported "2 rigid pieces · 5 joints".
  - Group A: floor 40→112, rear wall, post, and a wheel at 40.
  - Group B: floor 122→194, front wall, post, and a wheel at 194.

## 1. Run log

| # | Level | Cart | Style | Outcome | Delivered/15 | Time | Score |
|---|---|---|---|---|---|---|---|
| 1 | Beach | Example | paced 5 m/s | goal | 6 | 55.0 s | 24% |
| 2 | Beach | Example | full throttle | goal | 11 | 20.6 s | 69% |
| 3 | Beach | Example | fast, then crept into goal | goal | 8 | 26.1 s | ~45% |
| 4 | Beach | Minimal | paced 4 m/s | stuck: high-centred on the sharp crest at x 161.9, gave up | 0 (1 aboard) | — | 0 |
| 5 | Beach | Minimal | full throttle | goal | 1 | 23.9 s | ~6% |
| 6 | Beach | Articulated | paced 2.5 m/s | stuck for good on the washboard at x 120.6 (V-sag, belly on a tooth) | 0 | — | 0 |
| 7 | Beach | Articulated | 6–8 m/s | goal | 8 | 42.6 s | ~39% |
| 8 | Beach | Articulated | full throttle | goal | **15** | 21.4 s | **~94%** |
| 9 | Kitchen | Articulated | full throttle | goal | 1 | 25.0 s | ~6% |
| 10 | Kitchen | Articulated | paced | stuck: front wheel sank into the 1.4 m gap at x 36.8 | 0 | — | 0 |
| 11 | Kitchen | Example | paced 3–4 m/s | stuck: front wheel wedged under the far lip of the gap at 39.2 | 0 | — | 0 |
| 12 | Kitchen | Example | paced, 7 m/s at the gaps | goal | 15 | 44.4 s | 70.6% |
| 13 | Kitchen | Example | aggressive pacing | goal | 15 | 27.9 s | 87% |
| 14 | Kitchen | Minimal | paced | all lost by 20 s; cart inverted in the goal pit; the run never ends, so had to Give Up | 0 | — | 0 |
| 15 | Kitchen | Articulated | good pacing | stuck: wheel sank into the far block of the 2 m gap at x 113.5 | 0 | — | 0 |
| 16 | Workbench | Example | paced | goal | 15 | 47.8 s | 67% |
| 17 | Workbench | Example | full throttle | goal | 11 | 20.3 s | 69% |
| 18 | Workbench | Example | fast-paced | goal | 14 | 31.9 s | 77.6% |
| 19 | Workbench | Minimal | paced | all lost by 33 s; high-centred on the kicker at x 90 | 0 | — | 0 |
| 20 | Workbench | Articulated | paced | stuck: high-centred on the kicker crest at x 88.2; rear wheel locked by pineapples, front wheel spinning in the air | 0 | — | 0 |
| 21–31 | Original course | Example | ~11 attempts, 0.8–8 m/s | **none finished**; best reached x 161.2 with 7 aboard | — | — | — |
| 32 | Endless SFX2N8 | Example | lookahead pilot | high-centred on a launch lip at 57 m with 15 aboard; gave up | — | — | 55 m + 17 = 72 |
| 33 | Endless XUR9ZY | Example | lookahead pilot | 622 m; nose-dived into a 2.8 m crest (43° V-notch) at 612; stalled with 4 aboard | — | — | — |
| 34 | Endless 5GCCHB | Example | lookahead pilot | a 2.7 m crest at 53 m cartwheeled the cart at 7 m/s; all lost by 98 m | — | — | 81 m |

Where the original course fails, in the order a player meets it:
1. **Bottom of the first hill, x ≈ 54–55.** The example cart's shock-hung front wheel swings back under the bed and jams. It happened at 4 m/s, at 0.8 m/s, and in about half the runs at 2–2.5 m/s. The outcome is chaotic: the same approach sometimes passes.
2. **Launch lip, x ≈ 82**, a 3.6 m near-vertical drop into a dip at 86–90, then a 34° wall.
   - Crawling there high-centres the cart on the lip.
   - At 3–6 m/s the cart lands in the dip and then either flips or stalls against the wall, losing 5–8 pineapples.
   - At about 8 m/s it clears the dip but nose-dives on landing at 94–97.
3. **Kicker ramp, 158.8–162.3 (48°).** The best run stalled here, at x 161.2 with 7 aboard.

**Verdict:** a human-style run cannot finish the original course with the example cart.

Endless difficulty ramp, from the three runs plus a census of features in the generated chunks:
- **Around 50 m** (difficulty ≈ 0): already has spikes. Crests up to 2.7 m and launch lips spawn at 40–90 m and ended 2 of the 3 runs.
- **Around 150 m**: mild. From 0 to 620 m, seed XUR9ZY lost 1 pineapple in 88 s at a constant 7 m/s. It is flat and boring.
- **Around 300 m and beyond**: gaps start at about 330 m (seed 5GCCHB has 3 gaps between 330 and 423 m). Crests of 2.8–4.0 m appear from about 600 m and kill the run.

## 2. Ranked backlog

### 1. Gaps have no side walls, so wheels sink under the far lip and get trapped (BUG, severity high)
- **Context:** Kitchen gaps at 39.2–40.6 (1.4 m) and 115.2–117.2 (2 m). Workbench gaps at 75.7–79.7 and 145.7 are almost certainly affected too. Endless gaps use the same builder.
- **Observation:** terrain spans are one-sided chains that stop at the gap edge. A wheel that drops in slides sideways under the next span's surface. It ended up about 1.4 m below the surface inside the far block, and the cart could not get out. This caused 3 stuck runs at paced speeds, with both the example and articulated carts. Because slow, careful play gets punished by a geometry hole, it feels unfair.
- **Suggestion:** at each span end next to a gap, add a vertical wall segment from the surface down to killY, on both sides. Otherwise make the gap solid: a U-shaped chain with a floor at surface +3 m that counts as "supported" for the lost rule. Add a regression test that drops a wheel at 0 m/s into a 1.4 m gap and asserts the wheel centre stays at x ≤ far edge − r.

### 2. The goal rule cuts delivery short (tuning, high)
- **Context:** all levels, clearest on Beach.
- **Observation:** the run ends the moment the first pineapple touches the goal sensor. Carrying all 15 at a careful 5 m/s scored 6/15 (24%), and creeping in scored 8/15. Pineapples still in the cart and behind lineX do not count. As a result, full throttle (11/15) beats careful driving, which is the opposite of what the game intends.
- **Suggestion:** once the first pineapple crosses, run a 2.0 s "settle" window (the timer can freeze) and then count everything past lineX, plus everything still in a cart whose centre is past lineX − 2 m. Alternatively, put the sensor 3–4 m past lineX so the cart is over the line before it triggers.

### 3. Beach is beaten by holding →
- **Context:** Beach.
- **Observation:** the articulated cart at full throttle got 15/15 in 21.4 s (about 94%), and the example cart at full throttle beat every paced run. The only thing that punishes slow play is the washboard (run 6).
- **Suggestions:**
  - Add a single lip or 1.5–2 m gap at about 180 m that throws off carts above 10 m/s. With Beach's goal at 233 m, one "brake here" moment is enough.
  - Soften the washboard teeth from 0.5 m to 0.3 m and widen the pitch from 0.65 m to 1.0 m, so slow articulated carts get through.
  - Round the sharp crest at 162 (see item 10).

### 4. Shock-hung wheels fold under the bed (physics feel, high)
- **Context:** example cart on the original course's first-hill bottom (x 54); the articulated cart's V-sag on Beach and Workbench.
- **Observation:** shocks use `SHOCK_HERTZ 5` and `SHOCK_DAMPING 0.5` with no travel limits. A hard landing swings the wheel through its arc until it jams under the bed. With 15 pineapples aboard (about 15 × 0.35 kg), an articulated cart sags into a V and bellies out.
- **Suggestions:**
  - Give distance joints `minLength` 0.6× and `maxLength` 1.3× the rest length (b2DistanceJoint `enableLimit`).
  - Raise hertz to 7–8 and damping to 0.7.
  - Optionally scale the stiffness with the connected bodies' mass, so a loaded cart sags no more than about 15% of rest length.

### 5. Being stuck gives no feedback and has no quick exit (UX)
- **Context:** every stuck run: rows 4, 6, 10, 11, 15, 19, 20, 32, and many original-course attempts.
- **Observation:** a stuck cart just sits there. Give Up does carry `pr-attention`, but nothing tells the player that the run is over, and there is no retry key.
- **Suggestions:**
  - After 5 s with the cart's x changing by less than 0.3 m, show "Stuck? Give Up · Retry (R)" and pulse Give Up.
  - Add an R key for instant retry. The results screen's Space → Retry already works well, and retry takes about 21 ms.

### 6. The original course cannot be finished (level design)
- **Context:** original course with the example cart; about 11 attempts, best 161 of 256 m.
- **Observation:** it fails at three points, described in the run log. The failures are chaotic: the same input either passes or jams.
- **Suggestions:**
  - Blend the bottom of the first hill with a 2 m arc.
  - Cut the drop at the lip from 3.6 m to 2.2 m, and the wall after the dip from 34° to 25°.
  - Cut the kicker ramp from 48° to 35°.
  - Or keep it as locked "legendary" content, with a reference cart that has been shown to finish it (add a test that runs a scripted input to the goal).

### 7. Endless has difficulty spikes in the first 100 m
- **Context:** `src/terrain/generator.ts`. At d = 0, crest height is `range(1.5, 3 + 2d)`, so crests up to 3 m are possible, and launch lips are allowed too.
- **Observation:** 2 of 3 runs died or got stuck at 53–57 m, on a 2.7 m crest and a launch lip.
- **Suggestions:**
  - While d < 0.15: crest height `range(0.8, 1.8)`, crest down slope at most 0.8, launch-lip drop slope at most 1.2 and drop at most 0.8 m.
  - Keep launch lips at weight 0 until 120 m.

### 8. Endless is too easy and flat from 100 to 600 m
- **Context:** seed XUR9ZY lost 1 pineapple from 0 to 620 m at a constant 7 m/s, then died on the first real feature.
- **Suggestions:**
  - Move `RAMP_START_X` 80 → 40 and `RAMP_END_X` 1680 → 1000, so d reaches 0.5 at about 520 m instead of 880 m.
  - Start gaps at d ≥ 0.05, around 90 m on the new ramp. They should be short (1.0–1.5 m) until d = 0.3.
  - Cap crest height at `2 + 1.5d` so the late game stays hard without being random death.

### 9. Pineapples pressed against wheels lock them
- **Context:** Workbench kicker (articulated rear wheel stayed at 0 rad/s); Beach washboard; the minimal cart.
- **Observation:** pineapple and wheel both have friction 0.9, and a pile of pineapples against a wheel acts like a brake. Cart designs that use wheels as the sides of the bed jam.
- **Suggestion:** give the pineapple–wheel contact its own friction of about 0.3, through a custom friction callback or a separate wheel-contact material. Keep 0.9 for pineapples against parts and ground.

### 10. Sharp crests high-centre carts
- **Context:** Beach crest at 162, Workbench kicker at 89–91, Endless launch lips.
- **Observation:** a single vertex where +30° meets −40° catches the bed of any cart whose wheels are more than about 3 m apart. The minimal and articulated carts both hung there with their wheels in the air.
- **Suggestion:** at crests where the slope changes by more than 0.6, insert at least 3 segments of a 1.5 m radius arc. In the generator, apply the same rounding at each crest apex.

### 11. The minimal cart carries 14 pineapples with no walls
- **Context:** Beach runs 4 and 5.
- **Observation:** a single straw holds many pineapples once they settle between the wheels. Chaotic, but not harmful.
- **Suggestion:** leave it. If "no walls" should be punished, lower the pineapple friction against straws from 0.6 to 0.4.

### 12. The endless results equation is misleading
- **Observation:** the results read "55 m + 15 aboard = 72", but the bonus was 17, not 15.
- **Suggestion:** show the actual formula, for example "55 m + carry bonus 17 (15 aboard) = 72".

### 13. The funnel starts off-screen and the Release button covers it
- **Observation:** at run start, the camera shows only the bottom of the funnel, and the Release button overlaps it.
- **Suggestion:** during the 'ready' phase, frame the camera from the funnel top to the cart's base (zoom about 0.8×), and move Release to the bottom centre.

### 14. You can drive before releasing
- **Observation:** ←/→ work in the 'ready' phase while the timer stays at 0:00. You can position the cart freely, including away from the funnel.
- **Suggestion:** block drive until release, or start the clock on the first drive input.

### 15. Audio is not wired into the game (blocks the mute and hidden-tab tests)
- **Observation:**
  - `src/game/audioHooks.ts` uses `NO_AUDIO` with `TODO(S7)`, and there is no mute control in the game UI.
  - `src/audio/engine.ts` does implement mute (saved in localStorage) and suspends audio while the tab is hidden, but none of that can be tested in the game.
- **Suggestion:** when S7 is wired in, add an M key and a speaker icon in the HUD, and repeat the hidden-tab test with real audio.

### 16. A level run with 0 aboard never ends
- **Context:** Kitchen minimal cart (run 14).
- **Observation:** the HUD says "All pineapples lost", but the run goes on until Give Up.
- **Suggestion:** when `remaining === 0` in level mode, end the run after 2 s with 0/15 delivered, as endless already does. Or at least auto-open the results.

### 17. Rendering past the Kitchen end
- **Observation:** the end wall draws as a thin line to the top of the screen, with an empty void beyond the level end.
- **Suggestion:** fill the terrain past the goal to camera maxX + half a screen, and give the wall a body at least 0.5 m thick.

### 18. Workbench barely rewards pacing
- **Observation:** careful fast pacing scored 77.6% and full throttle 69%, only 8.6 points apart.
- **Suggestion:** after the goal-rule fix (item 2) this gap should widen. Otherwise make the 172–192 descent steeper, or add a lip there, so that full throttle loses 5 or more pineapples.

## 3. Observations

### Physics feel
- Driving feels good. Torque is 20 × wheel mass, capped at 20 rad/s, which gives the example cart about 16.7 m/s top speed. It feels punchy, and the wheel grip (0.9) is believable.
- Pineapples feel suitably heavy and roll nicely (restitution 0.3). A pile in a walled bed behaves well.
- Shocks are too soft and have no travel limits (item 4). This is the main source of chaotic, run-to-run-different failures.
- Wheels lock against pineapples (item 9).
- Gap geometry is broken (item 1).
- The lost rule (outside the cart for 3 s while supported) behaved as documented in every run.

### Excitement (per level)
- **Beach: NO.** Holding → is optimal (94% with the articulated cart), and there is no decision to make. The only hazard, the washboard, punishes only very slow articulated carts.
- **Kitchen: YES, mostly.** Speed choices really matter at the gaps and stairs, and 87% for aggressive pacing against 6% for flooring it is a good spread. However, the gap side-wall bug makes careful slow play an unfair trap.
- **Workbench: BORDERLINE yes.** The hazards are varied and the course looks good, but pacing wins only slightly over flooring it (77.6% against 69%).
- **Original course: NO (frustrating).** Each failure point is chaotic, and the course cannot be finished with the example cart.
- **Endless: NO in its current tuning.** Random deaths at about 50 m, a boring stretch from 100 to 600 m, then sudden deaths. Retuning the ramp (items 7 and 8) should fix it.

### UX friction
- There is no stuck feedback and no retry key (item 5). Space → Retry on the results screen works well.
- The funnel is off-screen and the Release button overlaps it (item 13).
- You can drive before release (item 14).
- Course select starts locked and the cards have large empty areas. Consider a thumbnail of the terrain profile.
- "New seed" goes to the builder instead of straight into a run. Add a direct "New seed → run" button.
- The builder is pleasant: colour-coded rigid groups, a clear status line ("2 rigid pieces · 5 joints"), and confirmations on Clear all and Replace.

### Bugs and explicit checks
| Check | Result |
|---|---|
| Mute toggle | **Cannot test in the game.** Audio is not wired in (`audioHooks.ts` → `NO_AUDIO`, TODO(S7)). The engine has mute, saved in localStorage. |
| Hide tab mid-run | **Pass for the simulation.** 0 steps while hidden, and it resumed at about 60 steps/s with no catch-up burst (1276 → 1276 → 1335 over 2 s hidden and 1 s visible). The engine suspends audio on `visibilitychange`, but that can't be exercised until audio is wired in. |
| Retry determinism | **Pass.** Retried twice with identical per-step input (Release, then → for steps 200–500). Cart and all 15 pineapple positions matched exactly at release +120, +240 and +600 steps (difference 0.0000). Caveat: human keyboard input is sampled per frame, so real-player retries differ by frame timing. |
| Window resize | **Pass.** 1280×760 → 800×600 → portrait 390×844 (paused at 0 steps, "Rotate your device" overlay) → back. The layout and simulation recovered. |
| Gap side walls | **FAIL** (item 1). |
| Level run with 0 aboard | Never ends (item 16). |
| Endless results label | Misleading (item 12). |
| Kitchen end-wall rendering | Thin line and void (item 17). |
