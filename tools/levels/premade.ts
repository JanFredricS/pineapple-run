/**
 * The three premade campaign courses (S6), authored with the Track DSL.
 * `levels/<id>.json` is generated from here and kept in sync by
 * test/levels/premade.test.ts (UPDATE_FIXTURES=1 rewrites the JSON).
 *
 * Difficulty ramp: beach (gentle, classic original-style profile) ->
 * kitchen (K1: the original's rough slab profile, and a sink too wide for
 * the example cart: the first course that asks for a purpose-built cart) ->
 * workbench (steep plank ramps, a big launch gap, a long washboard, a
 * trap drop) -> tikibar (exotic physics). The recovered 2008 course
 * (levels/original-course.json) is the bonus.
 */

import type { Vec2 } from '../../src/model/geometry';
import type { LevelDef } from '../../src/model/level';
import { Track, type AuthoredLevel } from './track';

/** Ground height (m) of a level's terrain at x (topmost span covering x), or null over a gap. */
export function groundAt(level: LevelDef, x: number): number | null {
  let best: number | null = null;
  for (const s of level.terrain.spans) {
    const pts = s.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (x < a.x || x > b.x || b.x === a.x) continue;
      const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
      if (best === null || y < best) best = y;
    }
  }
  return best;
}

/**
 * S6T audit-1 #4: the risk/reward shortcut shared by the three courses (the
 * floor differs): a 1.5 m take-off lip, a pool 1.5 m below the approach
 * with a 6 m washboard floor, a rim 1.5 m below the lip and a 10 m landing
 * slope. Taken at >= ~12 m/s the
 * cart flies the pool (seconds faster); at ~5 m/s it rolls down, crosses the
 * floor and climbs out with every pineapple. In between is the risk: too slow
 * to clear it, too fast to roll in, the cart lands on the climb face and
 * sheds cargo.
 */
function pool(floor: (t: Track) => void): Parameters<Track['pool']>[0] {
  return { lipRun: 3, lipRise: 1.5, entryRun: 2.5, depth: 1.5, floor, climbRun: 4, rimBelowLip: 1.5, landRun: 10, landDrop: 2 };
}

function withDecor(a: AuthoredLevel, art: string, xs: number[], scale = 1): AuthoredLevel {
  xs.forEach((x, i) => {
    const y = groundAt(a.level, x);
    if (y === null) return;
    const pos: Vec2 = { x, y: Math.round(y * 1000) / 1000 };
    a.level.props.push({ id: `${art}-${i}`, art, position: pos, scale });
  });
  return a;
}

/**
 * Beach Run — the classic: plateau, valley, first hill, launch lip,
 * washboard, kicker, the dune jump, climb, pit. The easiest course (no
 * gaps, soft 0.3 m washboard), but NOT a hold-right course: the dune jump
 * at ~173–190 m (launch lip, dip, steep dune face) throws a cart that takes
 * it much above 10 m/s into the face. Pace notes are a skilled line (fast,
 * braking for the first hill, the launch lip, the dune jump and the pit).
 */
export function beach(): AuthoredLevel {
  const t = new Track(0, 10);
  t.speed(12).flat(16, 'plateau')
    .ease(12, 1.5, 'valley').ease(12, -1.5)
    .ease(20, -3.5, 'ramp')
    .speedAt(58, 8).flat(5)
    .ease(9, 4, 'drop')
    .flat(6)
    .speed(12).ease(24, -2.5, 'ramp')
    .speedAt(98, 8).kicker(3, 0.35, 2.5, 1.4, 'drop')
    .flat(10)
    .speedAt(112, 12).washboard(9, 0.3, 1)
    .flat(6)
    .hump(12, 1).hump(10, -0.8, 'valley')
    .kicker(2.5, 0.6, 2, 1)
    .speedAt(163, 6).ease(12, 1.5, 'valley')
    // the dune jump: a launch lip, a short dip, then a steep dune face
    .kicker(2.5, 0.9, 1.5, 0.9, 'launchLip')
    .flat(8)
    .line(3.5, -2.8, 'ramp')
    .speedAt(185, 13).ease(12, -1)
    .flat(6)
    // the shortcut: jump the sand pool (soft washboard floor) or roll through it
    .pool(pool((t) => t.washboard(6, 0.3, 1)))
    .flat(4)
    .finish();
  return withDecor(t.build({ id: 'beach', name: 'Beach Run', theme: 'beach' }), 'palm', [-4, 22, 58, 96, 140, 176], 1);
}

/** A run of straight slabs, [dx, dy] each (y-down): the recovered original's angular rock-slab profile. */
function slabs(t: Track, runs: readonly (readonly [number, number])[]): Track {
  for (const [dx, dy] of runs) t.line(dx, dy);
  return t;
}

/**
 * Kitchen Bench (K1, TUNING.md "K1: Kitchen difficulty"): rough tile slabs
 * like the original's rock slabs, a cutting board, tile-grout washboard,
 * and THE SINK: a 5.5 m hole to a counter 0.5 m higher. The example cart
 * (5 m wheelbase) cannot cross it: it falls in or stops at the far wall. A
 * long cart with a wheel on each side of the hole at every moment can
 * (test/integration/kitchenBridger.ts), so the pit's landing strip is long
 * enough for a 17.5 m cart (`KITCHEN_FINISH`). Pace notes are the
 * Kitchen Bridger's line: 6.5 m/s (it clears at a steady 4-9 m/s), then
 * 10 m/s from the kicker through the drainer.
 */
/**
 * Kitchen's finish pit: a 20 m landing strip so the 17.5 m Kitchen Bridger
 * gets its bed down to the goal sensor, and (K1 audit #4) the goal line and
 * sensor 10.5 m before the blender, so every cart scores where the finish
 * framing shows the whole blender (the camera shows all of it from ~10.8 m
 * for a normal cart). The first ~9.5 m of the pit floor is a sunken landing
 * counter. Delivered = pineapples past the line, so one ~10 m short of the
 * blender counts (RESIDUALS R30). The Bridger's load rests 5.5-9.2 m before the blender, past the
 * line.
 */
export const KITCHEN_FINISH = { frontGap: 20, lineGap: 10.5 } as const;

export function kitchen(): AuthoredLevel {
  const t = new Track(0, 10);
  t.speed(6.5).flat(16, 'plateau');
  // rough counter: angular tile slabs like the original's rock slabs
  slabs(t, [[6, -2.2], [3, -0.3], [5, 2.5], [5, -1.8], [5, 1.8]]);
  // first cutting board: ramp on, ride the board, drop off
  t.line(4, -1.0, 'ramp').flat(3).line(1.2, 1.2, 'drop');
  slabs(t, [[2, -0.5], [2, 0.5]]);
  // gap between two counter tops
  t.gap(1.4)
    .flat(4)
    // tile grout washboard (the original's teeth: ~0.5 m, 4/3 m pitch)
    .washboard(10, 0.45, 4 / 3)
    // a calm run-up: a long cart still pitching from the grout noses into the sink
    .flat(12)
    // THE SINK: a 5.5 m hole to a counter 0.5 m higher
    .gap(5.5, -0.5)
    // a long landing: the stairs must not meet a long cart's front while its rear is still over the hole
    .flat(12)
    // stacked boards: up three steps, then off the edge and over a gap
    .steps(3, 3.5, -0.5)
    .flat(3)
    .line(1.5, 1.5, 'drop');
  slabs(t, [[3, -0.9], [3, 0.9]]);
  t.gap(2, 0.4).flat(3);
  // rough bench: more slabs
  slabs(t, [[7, -2.6], [4, 0.6], [5, -1.6], [7, 3.2], [6, -2.4], [6, 2.8]]);
  // the drainer run-in: faster (the long cart rattles through the pool quicker than a careful line)
  t.speed(10).kicker(2.5, 0.7, 2, 1.1)
    .flat(8)
    // the shortcut: jump the drainer (a ribbed floor) or rattle through it
    .pool(pool((t) => t.washboard(6, 0.35, 1)));
  slabs(t, [[4, -1.3], [3, 0.5], [5, -1.4], [2, 0.5]]);
  t.flat(5)
    .finish(KITCHEN_FINISH);
  return t.build({ id: 'kitchen', name: 'Kitchen Bench', theme: 'kitchen' });
}

/**
 * Workbench — steep plank ramps, a trap drop, a long washboard, a launch gap
 * between rulers, a raised landing, and the saw-horse jump (launch lip, dip,
 * steep face) before the final climb: the brake-here moment that stops a
 * held-right run from winning. Pace notes are a skilled line (fast, braking
 * only for the jump).
 */
export function workbench(): AuthoredLevel {
  const t = new Track(0, 10);
  t.speed(13).flat(16, 'plateau')
    // plank ramp to a crest, then the trap: a steep drop
    .line(7, -2.5, 'ramp').flat(4)
    .line(4, 3.5, 'drop')
    .flat(6)
    // long washboard (rasp)
    .washboard(14, 0.5, 4 / 3)
    .flat(6)
    // ruler launch over a wide gap, landing lower
    .speedAt(62, 11).flat(4).line(10, -2, 'launchLip')
    .gap(4, 1.4)
    .flat(9)
    // sharp kicker
    .kicker(2, 0.9, 1.5, 1.5)
    .flat(4)
    // deep valley
    .ease(12, 3, 'valley').ease(14, -3)
    // step down a stack of planks
    .steps(4, 3, 0.5)
    .flat(4)
    // up a plank lip and over a gap onto a landing above the approach
    .flat(3).line(3, -0.6, 'launchLip').gap(2, 0.3)
    .flat(6)
    // bumpy planks
    .hump(6, 0.7).hump(6, 0.9)
    // the saw-horse jump: lip, dip, steep face (brake!), then the climb
    .speedAt(160, 6).kicker(2.5, 0.9, 1.5, 0.9, 'launchLip')
    .flat(8)
    .line(3.5, -2.8, 'ramp')
    .speedAt(178, 13).ease(14, -1.2)
    .flat(4)
    // the shortcut: jump the tray (a rasp floor) or grind through it
    .pool(pool((t) => t.washboard(6, 0.4, 1)))
    .flat(6, 'plateau')
    .line(2.5, 2.5, 'drop')
    .ease(10, -1.2)
    .flat(4)
    .finish();
  return t.build({ id: 'workbench', name: 'Workbench', theme: 'workbench' });
}

/**
 * Zero-G Tiki Bar (S9 stretch): the exotic-physics course, after Workbench.
 * Terrain hazards as usual, plus zone hazards (LevelDef zones, see
 * src/run/zones.ts and src/run/beads.ts):
 *   - the moon hop: a launch lip over a wide gap inside a low-gravity pocket
 *     (only floatable in it), then a moon-gravity washboard where a fast cart
 *     bounces its load out;
 *   - the shooter: a force column at the foot of a bar-stool cliff lifts the
 *     cart onto the upper deck (the cliff is unclimbable without it);
 *   - the ice-bucket pool shortcut right after the upper deck (jump it at
 *     pace, or roll through the crushed-ice floor);
 *   - the bead ocean: a basin full of cocktail beads to plough through, then
 *     steps down to the blender.
 * The pool comes BEFORE the beads: a cart that has just ploughed the ocean is
 * too slow (beads on its nose) to jump anything.
 */
export function tikibar(): AuthoredLevel {
  const t = new Track(0, 10);
  t.speed(9).flat(16, 'plateau')
    .ease(10, 1.2, 'valley').ease(10, -1.2)
    // the moon hop
    .speedAt(38, 7)
    .field({ id: 'moon-hop', kind: 'gravity', gravityScale: 0.3, above: 7, below: 3 }, (u) =>
      u.flat(3).line(6, -1.5, 'launchLip').gap(8, 0.5).flat(6).washboard(8, 0.25, 1).flat(4))
    .speed(6).flat(6)
    .hump(6, -0.5)
    .speed(4).hump(6, 0.25)
    // the shooter: a force column at the foot of a cliff
    .field({ id: 'shooter', kind: 'force', force: { x: 2, y: -16 }, above: 6.5, below: 2 }, (u) => u.flat(9))
    .line(1.8, -6)
    .speed(6).flat(12)
    // the shortcut: jump the ice bucket (a crushed-ice rasp floor) or roll through it
    .speed(9).ease(12, 1.5, 'valley').speed(13).ease(8, -0.5)
    .flat(4)
    .pool(pool((u) => u.washboard(6, 0.35, 1)))
    .speed(9).flat(4)
    .speed(6)
    // the bead ocean
    .beadPool({ id: 'bead-ocean', entryRun: 3, depth: 1.2, floor: 12, exitRun: 7, fill: 0.7 })
    .flat(6)
    .steps(3, 3.5, 0.5)
    .flat(5)
    .finish();
  return t.build({ id: 'tikibar', name: 'Zero-G Tiki Bar', theme: 'tiki' });
}

export const PREMADE: Record<'beach' | 'kitchen' | 'workbench' | 'tikibar', () => AuthoredLevel> = {
  beach,
  kitchen,
  workbench,
  tikibar,
};
