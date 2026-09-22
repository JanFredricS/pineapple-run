# Coconut Run (Johnson Controls, 2008): Mechanics Research Report

Research performed 2026-09-22 by decompiling the original game files recovered
from the Wayback Machine (`JCCarGame.swf`, `land.swf`, `en-us.xml`).

Labels: **[CODE]** = confirmed from the original SWF/bytecode or language XML.
**[SRC]** = from a web source (URL given). **[INF]** = inference.

---

## 1. What the game was

- **Campaign.** One of three games on **ingenuitywelcome.com**, the site for
  Johnson Controls' 2008 "Ingenuity Welcome" rebrand, in a section called "Test
  Your Ingenuity", built to recruit engineers. [SRC]
  https://starkwords.com/portfolio/johnson-controls/
- **Credits.** Agency: Fallon Worldwide (Minneapolis). Production: Colossal
  Squid Industries. Game developer: Jason K. Smith. Code packages are named
  `com.colossalsquid.*`. [CODE]
- **Awards.** One Show 2009 Merit in Brand Gaming/Online; Cannes Cyber
  shortlist. [SRC]
  https://www.oneclub.org/awards/theoneshow/-award/11155/ingenuity-online-games/
- **Reach.** 30 million page views, ~17 minutes per visit. [SRC]
- **Dates.** Earliest Wayback capture 2008-10-17; blog coverage 2008-10-24;
  forum threads Nov 2008 – Feb 2009. By 2010–2012 a mirror at
  `jasonkentsmith.com/JC/game/index2.html` circulated.
- **URLs/files.** Game page `ingenuitywelcome.com/game/`, loading
  `preloader.swf` → `JCCarGame.swf`. Stage 920×615, Flash Player 9. [CODE]
- **What it promoted.** Automotive Interiors / seating: "turn a sustainable raw
  material into comfortable car seats… deliver coconuts to the shredder." [CODE]
- **Sister games.** Particle Pro, Piggy Power. [CODE]
- **Preservation.** Playable at https://flashmuseum.net/game/coconut-run-5zn/
  (that copy may have broken collision).

## 2. Build phase (confirmed from code)

Engine: **Box2DFlashAS3 2.0.x**. Scale: 30 px per metre. [CODE]

- **No preset parts — freehand drawing.** Click-drag to size each part. Tool
  panel: green translucent card, groups "Build Tools" and "Delete Tools", plus
  "Show Tips" and "Example Cart" buttons. [CODE]
  - **Line** — thin rigid bar, 5 px thick, density 1 (chassis/struts).
  - **Box** — rectangle for structure or mass.
  - **Circle** — *unpowered* round part (free-rolling wheels or joints).
  - **Wheel** — *powered* circle; drawing its centre over another part attaches
    it there with a revolute (pin) joint.
  - **Shock** — spring between two parts: distance joint, `frequencyHz = 5`,
    `dampingRatio = 0.5`. Ends within 10 px of a wheel/circle centre snap to it.
  - **Delete** removes one part; **Clear** removes all (with confirmation).
- **Attachment.** Overlapping lines/boxes/circles are merged by `ShapeCombiner`
  into **one rigid compound body** — welding, not joints. Only wheels (pins) and
  shocks (springs) are flexible connections. [CODE]
- **Limits.** No budget/cost/part limit found. Minimum part sizes 5 px (7 px
  boxes). [CODE]
- **Validation.** Cannot start without wheels ("Your cart is missing wheels!").
- **Example cart.** Hard-coded: bed of two lines, two raised end rails, two
  wheels radius 25 px, four shocks (two per wheel). [CODE `Car.drawSample`]
- **Camera.** Zooms 1.77× on the start area; build clicks at x > 366 ignored.

## 3. Run phase

- **Sequence.** Press **Start** (physics begins) then **Release** — a plug under
  a V-shaped funnel is removed, 15 coconuts drop into the cart, timer starts.
- **Cargo.** 15 coconuts. [CODE, SRC]
- **Controls.** Active driving: holding **→** applies equal torque to every
  wheel (20 × wheel mass); **←** reverses. Wheel spin capped at ±20 rad/s.
  [CODE `WheelCommand`]
  - [INF] The speed cap means top speed grows with wheel radius — matches forum
    advice that 1.5–2× the example wheel works well.
  - No tilt control.
- **Goal.** Shredder at x ≈ 7660 with animated rotating blades. A coconut
  touching the base sensor ends the run; every coconut past x 7670 counts.
  Coconuts only have to *arrive* — players catapulted them in. Cart parts
  touching the shredder bounce upward with random spin. "Give Up" ends the run.
- **Scoring ("Efficiency Rating").** [CODE `EndScreen.show`]
  ```
  timeScore = clamp(100 - (seconds - 15), 0, 100)
  rating    = round(timeScore * collected / 15)
  ```
  Red < 33, yellow 33–66, green > 66. Best score saved as SharedObject
  `coconutScore`.
- **Quirk.** Physics steps a fixed 1/30 s per frame (3 iterations) at 60 fps
  while the timer uses wall-clock time — faster PCs scored better.

## 4. Course and terrain

**One fixed course**, ~8000 × 411 px: 71 hard-coded vertices, each pair
extruded down as a solid column. Ground friction 0.9, restitution 0.3.
[CODE `GroundShape.frame1`] Full vertex list:
`original-game-files/terrain.txt`.

Profile features in order:
1. Flat start plateau (y 278) with coconut funnel.
2. Dip to a valley at x ~550.
3. Climb to a high crest x 1174–1276, then a **steep drop** (y 163 → 432) —
   the famous "first hill" trap.
4. Long ramp up to x 2460, then a **launch lip** (226 → 335).
5. Flat stretch, then a **washboard** x 3174–3519: nine triangular bumps,
   15 px tall, 40 px apart.
6. Rolling ground, sharp **kicker** at x 4869 (306 → 187 → 356).
7. Lowest point at x ~5691.
8. Long climb to a high plateau x 6379–6873.
9. Drop, final rise to the shredder lip at x 7662, pit behind it.

Theme is **not tropical**: no beaches, palms or water.

## 5. Visual style

- **Engineering-blueprint look**: white graph-paper sheet with curled corner,
  faint grid, on a warm yellow-orange gradient page background.
- **Terrain**: pale blue-grey angular rock slabs, flat vector style.
- **Cart parts**: semi-transparent light-blue boxes/lines/circles, grey
  spoked-hub wheels; shocks drawn in `#616A7C` / fill `#E0E8F7`.
- **Coconuts**: hand-drawn fibrous tan illustrations, ~20 px.
- **UI**: green glassy tool panel; blue/white pill buttons; timer; arrow-keys
  hint; three-panel sliding end screen with cross-promo cards.
- **Camera**: side view, follows right-most cart body, smoothing 0.1,
  offset −100 px.
- **Rendering**: terrain art from `land.swf`, cut into 440 px bitmap strips.
- **Music**: four loops cross-fading by course quarter.

## 6. Physics feel

- **All rigid bodies** — no soft-body. Flex only from shocks and pin joints.
- **Nothing breaks** (Box2D 2.0 has no breakable joints; none added). Failure =
  flipping, getting stuck, or spilling cargo.
- **Coconuts**: free circles, density 1, friction 0.9, restitution 0.3, minimal
  damping, CCD on. Random start rotations; bounce out easily — players built
  bowl beds and half-lids.
- **Other**: gravity (0, 10); wheels angular damping 0.1; all parts density 1.

## 7. Similar games [INF]

- **Fantastic Contraption (Jan 2008)** — closest match: freehand parts,
  powered vs unpowered wheels, rods, goal area. No driving, no cargo count.
- **Dream Car Racing (~2009)** — freehand vehicle drawing + driving + scoring.
- **Bad Piggies (2012)** — build then drive with cargo intact; grid parts.
- **Truck Loader / Cargo Bridge** — "deliver cargo intact" pressure.
- **Happy Wheels (2010)** — physics driving, no build phase.

## Files

In `research/original-game-files/`: `JCCarGame.swf`, `land.swf`, `en-us.xml`
(all UI text), `terrain.txt` (71 ground vertices).

Archive source:
`web.archive.org/web/20130805033135id_/http://jasonkentsmith.com/JC/game/JCCarGame.swf`

Gameplay videos: https://www.youtube.com/watch?v=TsUPFJD62-Q (zero-wheel),
https://www.youtube.com/watch?v=Y22oSkpoWjM (100%),
https://www.youtube.com/watch?v=pzU5Qo1pfTo (default cart, 0%).
