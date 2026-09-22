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

function withDecor(a: AuthoredLevel, art: string, xs: number[], scale = 1): AuthoredLevel {
  xs.forEach((x, i) => {
    const y = groundAt(a.level, x);
    if (y === null) return;
    const pos: Vec2 = { x, y: Math.round(y * 1000) / 1000 };
    a.level.props.push({ id: `${art}-${i}`, art, position: pos, scale });
  });
  return a;
}

/** Beach Run — the classic: plateau, valley, first hill, launch lip, washboard, kicker, climb, pit. */
export function beach(): AuthoredLevel {
  const t = new Track(0, 10);
  t.speed(5).flat(16, 'plateau')
    .ease(12, 1.5, 'valley').ease(12, -1.5)
    .speed(6).ease(20, -3.5, 'ramp')
    .flat(5, 'crest')
    .speed(4).ease(9, 4, 'drop')
    .flat(6)
    .speed(7).ease(24, -2.5, 'ramp')
    .kicker(3, 0.35, 2.5, 1.4, 'launchLip')
    .flat(10)
    .speed(4).washboard(9, 0.5, 4 / 3)
    .flat(6)
    .speed(6).hump(12, 1).hump(10, -0.8, 'valley')
    .kicker(2.5, 0.6, 2, 1)
    .ease(14, 1.5, 'valley')
    .speed(6).ease(22, -4, 'ramp')
    .flat(10, 'plateau')
    .speed(4).ease(8, 2.2, 'drop')
    .ease(10, -1)
    .speed(4).flat(5)
    .finish();
  return withDecor(t.build({ id: 'beach', name: 'Beach Run', theme: 'beach' }), 'palm', [-4, 22, 58, 96, 140, 176], 1);
}

/** Kitchen Bench — cutting-board ramps, tile grout, and real gaps (a sink to jump). */
export function kitchen(): AuthoredLevel {
  const t = new Track(0, 10);
  t.speed(5).flat(16, 'plateau')
    // first cutting board: ramp on, ride the board, drop off
    .line(6, -1.2, 'ramp').flat(9).line(1.2, 1.2, 'drop')
    .flat(7)
    // gap between two counter tops
    .speed(6).gap(1.4)
    .flat(9)
    // tile grout washboard
    .speed(4).washboard(12, 0.3, 1)
    .flat(6)
    // cutting-board launch ramp over the sink: land a little lower
    .speed(9).flat(4).line(9, -1.6, 'launchLip')
    .gap(3, 1.2)
    .speed(5).flat(10)
    // stacked boards: up three steps, then off the edge and over a gap
    .speed(4).steps(3, 3.5, -0.5)
    .flat(3)
    .speed(6).line(1.5, 1.5, 'drop')
    .flat(5)
    .gap(2, 0.4)
    .flat(6)
    .ease(12, 1.5, 'valley').ease(10, -1.5)
    .speed(5).kicker(2.5, 0.7, 2, 1.1)
    .flat(8)
    .speed(4).ease(12, -1.2, 'ramp')
    .flat(5)
    .finish();
  return t.build({ id: 'kitchen', name: 'Kitchen Bench', theme: 'kitchen' });
}

/** Workbench — steep plank ramps, a trap drop, a long washboard, a launch gap between rulers, a raised landing. */
export function workbench(): AuthoredLevel {
  const t = new Track(0, 10);
  t.speed(5).flat(16, 'plateau')
    // plank ramp to a crest, then the trap: a steep drop
    .line(7, -2.5, 'ramp').flat(4, 'crest')
    .speed(2.5).line(4, 3.5, 'drop')
    .flat(6)
    // long washboard (rasp)
    .speed(4).washboard(14, 0.5, 4 / 3)
    .flat(6)
    // ruler launch over a wide gap, landing lower
    .speed(10).flat(4).line(10, -2, 'launchLip')
    .gap(4, 1.4)
    .speed(5).flat(9)
    // sharp kicker
    .kicker(2, 0.9, 1.5, 1.5)
    .flat(4)
    // deep valley
    .ease(12, 3, 'valley').ease(14, -3)
    // step down a stack of planks
    .speed(4).steps(4, 3, 0.5)
    .flat(4)
    // up a plank lip and over a gap onto a landing above the approach
    .speed(8).flat(3).line(3, -0.6, 'launchLip').gap(2, 0.3)
    .speed(5).flat(6)
    // bumpy planks
    .hump(6, 0.7).hump(6, 0.9).hump(6, 0.7)
    // long climb, plateau, then a drop onto the final rise
    .speed(6).ease(20, -4, 'ramp')
    .flat(6, 'plateau')
    .speed(4).line(2.5, 2.5, 'drop')
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
