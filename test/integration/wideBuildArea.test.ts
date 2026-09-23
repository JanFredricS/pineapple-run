/**
 * UX1 #4 (Jan: "The build area is too small"): the build area grew from
 * x −20..340 px to x −190..340 px (12 m -> 17.67 m wide, 7 m tall). A cart
 * spanning the whole new width validates, spawns resting on the flat start
 * plateau of every course (no part inside the ground), is lifted when a
 * wheel reaches below the ground line, and the funnel pours into it.
 */
import { describe, expect, it } from 'vitest';
import { BUILD_AREA } from '../../src/builder/constants';
import { courseFor } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import { plateauRange } from '../../src/game/startArea';
import type { CartDesign } from '../../src/model/cart';
import { PX_PER_M } from '../../src/model/coords';
import { chunkIndexAt, surfaceYAt } from '../../src/terrain/chunks';

/** A tray the full width of the build area: one long cube, end rails, three pinned wheels. */
function wideTray(radius = 25): CartDesign {
  const x0 = BUILD_AREA.minX + 10;
  const x1 = BUILD_AREA.maxX - 10;
  const cx = (x0 + x1) / 2;
  return {
    version: 1,
    parts: [
      { id: 'bed', kind: 'cube', center: { x: cx, y: -30 }, width: x1 - x0, height: 20, angle: 0 },
      { id: 'rail-l', kind: 'straw', a: { x: x0 + 5, y: -30 }, b: { x: x0 + 5, y: -110 } },
      { id: 'rail-r', kind: 'straw', a: { x: x1 - 5, y: -30 }, b: { x: x1 - 5, y: -110 } },
      { id: 'w1', kind: 'wheel', center: { x: x0 + 20, y: -25 }, radius },
      { id: 'w2', kind: 'wheel', center: { x: cx, y: -25 }, radius },
      { id: 'w3', kind: 'wheel', center: { x: x1 - 20, y: -25 }, radius },
    ],
  };
}

describe('UX1: the wider build area on every course', () => {
  it('the new area is 530 x 210 px (17.67 x 7 m) and contains the old one', () => {
    expect(BUILD_AREA).toEqual({ minX: -190, minY: -210, maxX: 340, maxY: 0 });
    expect((BUILD_AREA.maxX - BUILD_AREA.minX) / PX_PER_M).toBeCloseTo(17.667, 3);
    const old = { minX: -20, minY: -210, maxX: 340, maxY: 0 };
    expect(BUILD_AREA.minX).toBeLessThanOrEqual(old.minX);
    expect(BUILD_AREA.maxX).toBeGreaterThanOrEqual(old.maxX);
    expect(BUILD_AREA.minY).toBeLessThanOrEqual(old.minY);
  });

  for (const id of ['beach', 'kitchen', 'workbench', 'original', 'tikibar', 'endless:PINE']) {
    it(`${id}: a full-width tray spawns on the flat plateau, rests, and catches the load`, async () => {
      const course = courseFor(id)!;
      const cs = course.level.cartStart;
      // the plateau (build area + 1 m either side) is flat ground at cartStart.y
      // (the recovered original's plateau ends at the 2008 build-area edge: no margin on the right)
      const range = plateauRange(cs);
      const maxX = id === 'original' ? range.maxX - 1 : range.maxX;
      for (let x = range.minX; x <= maxX; x += 0.25) {
        const y = surfaceYAt(course.source.chunk(chunkIndexAt(x, course.source.chunkWidth)), x);
        expect(y, `${id}: ground at ${x.toFixed(2)}`).not.toBeNull();
        expect(Math.abs(y! - cs.y), `${id}: ground at ${x.toFixed(2)}`).toBeLessThan(0.02);
      }
      const s = await RunSession.create(wideTray(), course);
      try {
        s.start();
        for (let i = 0; i < 60; i++) s.step();
        const b = s.controller.cartBounds()!;
        // resting on the ground, not sunk into it, not moved
        expect(b.maxY).toBeLessThan(cs.y + 0.05);
        expect(b.maxY).toBeGreaterThan(cs.y - 0.1);
        expect(b.minX).toBeCloseTo(cs.x + (BUILD_AREA.minX + 10 + 20 - 25) / PX_PER_M, 1); // left wheel's edge
        s.release();
        for (let i = 0; i < 240; i++) s.step();
        expect(s.aboard(), `${id}: pineapples aboard after the pour`).toBeGreaterThanOrEqual(12);
      } finally {
        s.destroy();
      }
    }, 60_000);
  }

  it('a wheel dragged below the ground line lifts the whole wide cart by exactly the overlap', async () => {
    const s = await RunSession.create(wideTray(35), courseFor('beach')!); // wheel bottoms 10 px below the line
    try {
      expect(s.spawn.y).toBeCloseTo(courseFor('beach')!.level.cartStart.y - 10 / PX_PER_M, 9);
    } finally {
      s.destroy();
    }
  });
});
