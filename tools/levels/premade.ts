/**
 * The three premade campaign courses (S6), authored with the Track DSL.
 * `levels/<id>.json` is generated from here and kept in sync by
 * test/levels/premade.test.ts (UPDATE_FIXTURES=1 rewrites the JSON).
 *
 * Difficulty ramp: beach (gentle, classic original-style profile) ->
 * kitchen (cutting-board ramps and real gaps between the tiles) ->
 * workbench (steep plank ramps, a big launch gap, a long washboard, a
 * trap drop). The recovered 2008 course (levels/original-course.json) is
 * the bonus.
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

/**
 * Kitchen Bench — cutting-board ramps, tile grout, and real gaps (a sink to
 * jump). Pace notes are a skilled line: a steady 10 m/s through the gaps
 * and the stairs, then faster home; holding right loses pineapples on the
 * stairs and the kicker.
 */
export function kitchen(): AuthoredLevel {
  const t = new Track(0, 10);
  t.speed(10).flat(16, 'plateau')
    // first cutting board: ramp on, ride the board, drop off
    .line(6, -1.2, 'ramp').flat(9).line(1.2, 1.2, 'drop')
    .flat(7)
    // gap between two counter tops
    .gap(1.4)
    .flat(9)
    // tile grout washboard
    .washboard(12, 0.3, 1)
    .flat(6)
    // cutting-board launch ramp over the sink: land a little lower
    .flat(4).line(9, -1.6, 'launchLip')
    .gap(3, 1.2)
    .flat(10)
    // stacked boards: up three steps, then off the edge and over a gap
    .steps(3, 3.5, -0.5)
    .flat(3)
    .line(1.5, 1.5, 'drop')
    .flat(5)
    .gap(2, 0.4)
    .flat(6)
    .speedAt(120, 12)
    .ease(12, 1.5, 'valley').ease(10, -1.5)
    .kicker(2.5, 0.7, 2, 1.1)
    .speed(13).flat(8)
    // the shortcut: jump the sink (a ribbed drainer floor) or rattle through it
    .pool(pool((t) => t.washboard(6, 0.35, 1)))
    .ease(12, -1.2, 'ramp')
    .flat(5)
    .finish();
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

export const PREMADE: Record<'beach' | 'kitchen' | 'workbench', () => AuthoredLevel> = {
  beach,
  kitchen,
  workbench,
};
