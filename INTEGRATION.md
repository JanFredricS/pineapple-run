# Integration notes for S6

Cross-slice decisions and reconciliations collected during S1–S5 parallel
work. S6 works through this list; each item is a plan-owner ruling.

## Contract amendments (additive, apply at S6 merge)

1. **`RunEventSource` gains a `simTime(): number` getter** (S5 request #1).
   The HUD currently takes a separate `clock` callback; S1's controller
   already has the value. Amend src/model contract 3 + mock, wire directly.
2. **Endless progress**: add `furthestMetres(): number` getter to the run
   controller surface (S5 request #2). Not an event — polled for display.

## Endless scoring ruling (S5 request #3)

- The canonical recorded/compared metric is **raw furthest distance while
  carrying** — ScoreBook semantics unchanged.
- The carry bonus is **display flavour only** (shown on the results screen,
  never part of the best comparison, regardless of how the run ended).
  This removes the reward-for-quitting exploit and the stored-vs-displayed
  inconsistency. Update src/model/score endless helper accordingly in S6
  (small change; re-run S5 display tests).

## Conventions to reconcile

3. **Y-origin**: S2 builder assumes design y = 0 is the ground line;
   the spike level used a different offset. S6: set `LevelDef.cartStart`
   to ground height at start for all levels; verify spike/run fixtures.
4. **Course ids** (S5 fixed them): `beach`, `kitchen`, `workbench`,
   `original`, endless as `levelId = "endless:<SEED>"`, seed charset
   1–16 chars of A–Z 0–9 - _. S3's premade levels must use these ids.
5. **Unlock rule** (S5): next course unlocks when previous best rating > 0;
   original-course bonus unlocks when all three campaign courses cleared.
6. **Build area / funnel placement**: S2's build area (360×210 px) and mock
   funnel are placeholders; S1's funnel treats `LevelDef.funnel` as outlet
   centre (2.4 m outlet, 70° frictionless walls — narrower jams). S6 aligns
   the builder start area with each level's start plateau + funnel.

## Known gaps S6 must cover

7. **Blender solid body**: S1 built the goal sensor geometrically but no
   solid blender prop (original bounced cart parts off the shredder). S6
   adds the blender collision body + the S4 blender animation at the goal.
8. **Rotate-overlay pause**: S5 exposes `onPortraitChange` — S6 wires it to
   the S0 clock's pause causes.
9. **HUD mount**: use `mountRunHudScreen` from src/ui/appScreens.ts.
10. **"All pineapples lost" in level runs**: no event; S5 pulses Give Up
    (original behaviour: run continues). Endless: run ends on last loss
    (S1 handles). Verify both paths in integration.

## Incidents / environment

- S1's first browser check attached to another session's headless Chrome
  (port 9333, tender-analysis) and navigated it; restored via history but
  page state may be lost. All later browser checks use isolated instances
  with a port-collision guard.
