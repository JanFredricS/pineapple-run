/**
 * M1 (owner: "the original track goal zone is too small for large vehicles";
 * TUNING.md "M1"). Before M1 the original's pit had 3.75 m of floor before
 * the blender and the goal line at the 2008 lip: a long cart (the 17.5 m
 * Kitchen Bridger, test/integration/kitchenBridger.ts) drove into the pit
 * nose-first, stopped against the blender with its bed and load still above
 * the lip, the load never touched the goal sensor, and the run sat on the
 * stuck hint. M1 gives the original a Kitchen-style finish
 * (ORIGINAL_FINISH = { frontGap: 20, lineGap: 10.5 }, src/terrain/originalCourse.ts):
 * a 20 m landing strip, the goal line and the sensor 10.5 m before the
 * blender. The 71 recovered vertices are unchanged
 * (test/terrain/original-course.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { courseFor } from '../../src/game/courses';
import { goalBlenderBox } from '../../src/game/framing';
import { RunSession, type Course } from '../../src/game/session';
import type { CartDesign } from '../../src/model/cart';
import { pxToM } from '../../src/model/coords';
import { BLENDER_SIZE, blenderPitFloor } from '../../src/model/goal';
import type { LevelDef } from '../../src/model/level';
import { efficiencyRating } from '../../src/model/score';
import { LevelChunkSource } from '../../src/terrain/chunks';
import { ORIGINAL_FINISH, ORIGINAL_GOAL_LINE_PX } from '../../src/terrain/originalCourse';
import type { PaceNote } from '../../tools/levels/track';
import { FLOOR_IT, ORIGINAL_EXPERT_LINE, paceDrive, runWithPace } from './driver';
import { kitchenBridger } from './kitchenBridger';

const shipped = () => courseFor('original')!;

/**
 * The original exactly as it shipped before M1 (UX1/B1): pit floor 9.25 m
 * (3.75 m before the blender), the sensor over the whole floor, the goal line
 * at the 2008 lip (7670 px). Rebuilt from the shipped level, so everything
 * else (the 71 vertices, start, funnel, theme) is the same level.
 */
function preM1(): Course {
  const l = shipped().level;
  const course = l.terrain.spans.find((s) => s.id === 'course')!.points;
  const last = course[course.length - 1]!;
  const floor = blenderPitFloor(3.75);
  const level: LevelDef = {
    ...l,
    terrain: {
      ...l.terrain,
      spans: l.terrain.spans.map((s) =>
        s.id === 'pit-floor' ? { ...s, points: [{ ...last }, { x: last.x + floor, y: last.y }, { x: last.x + floor + 0.1, y: last.y - 8 }] } : s,
      ),
    },
    goal: { sensor: { x: last.x, y: last.y - 2.2, width: floor, height: 2.2 }, lineX: pxToM(ORIGINAL_GOAL_LINE_PX) },
    props: l.props.map((p) => (p.art === 'blender' ? { ...p, position: { x: last.x + 3.75 + BLENDER_SIZE.x / 2, y: p.position.y } } : p)),
  };
  return { levelId: 'original', mode: 'level', level, source: new LevelChunkSource(level.terrain) };
}

async function attempt(cart: CartDesign, course: Course, line: readonly PaceNote[]) {
  const s = await RunSession.create(cart, course);
  try {
    runWithPace(s, line, 150);
    const last = s.events.at(-1)!;
    return { last, stuck: s.stuck, box: s.controller.cartBounds(), cartLost: s.controller.cartLost };
  } finally {
    s.destroy();
  }
}

const steady = (v: number): PaceNote[] => [{ x: 0, speed: v }];

describe('M1: the original course has a finish long carts can score in', () => {
  it('the pre-M1 reconstruction is the old shipped finish (pit 9.25 m, blender 3.75 m in, line at the 2008 lip)', () => {
    const old = preM1().level;
    const b = goalBlenderBox(old);
    const course = old.terrain.spans.find((s) => s.id === 'course')!.points;
    const last = course[course.length - 1]!;
    expect(b.minX - last.x).toBeCloseTo(3.75, 9);
    expect(old.goal.lineX * 30).toBeCloseTo(7670, 9);
    expect(old.goal.sensor).toEqual({ x: last.x, y: last.y - 2.2, width: 9.25, height: 2.2 });
    expect(old.terrain.spans.find((s) => s.id === 'course')).toEqual(shipped().level.terrain.spans.find((s) => s.id === 'course'));
  });

  // The owner's report, reproduced: before M1 the bridger reaches the pit at 7, 9, 10 m/s and floored,
  // jams nose-on against the blender with its load above the lip, and never scores (the stuck hint shows).
  it('control: on the pre-M1 finish the 17.5 m bridger jams against the blender and never reaches the goal (7, 9, 10 m/s, floored)', async () => {
    const course = preM1();
    const blenderX = goalBlenderBox(course.level).minX;
    for (const [name, line] of [['7', steady(7)], ['9', steady(9)], ['10', steady(10)], ['floored', FLOOR_IT]] as const) {
      const r = await attempt(kitchenBridger(), course, line);
      expect(r.last.type, name).not.toBe('goalReached');
      expect(r.stuck, `${name}: the stuck hint`).toBe(true);
      expect(Math.abs(r.box!.maxX - blenderX), `${name}: nose against the blender`).toBeLessThan(0.1);
    }
  }, 240_000);

  // Bridger on the shipped original, pinned exactly (deterministic, like the expert line's 10/15 at 52): delivered/15 and
  // rating. Before M1: no goal at 7, 9, 10 and floored (the control above); 4/15 at 11 and 12.
  // Steady 6 and 8 m/s stall on the course itself, long before the finish (the original's terrain, not its pit).
  for (const [name, line, delivered, rating] of [
    ['steady 7 m/s', steady(7), 13, 46],
    ['steady 9 m/s', steady(9), 12, 51],
    ['steady 10 m/s', steady(10), 13, 63],
    ['steady 11 m/s', steady(11), 13, 65],
    ['steady 12 m/s', steady(12), 15, 76],
    ['holding right', FLOOR_IT, 14, 77],
  ] as const) {
    it(`the bridger ${name} reaches the goal with exactly ${delivered}/15, rating ${rating}`, async () => {
      const r = await attempt(kitchenBridger(), shipped(), line);
      expect(r.last.type).toBe('goalReached');
      if (r.last.type !== 'goalReached') return;
      expect(r.last.delivered).toBe(delivered);
      expect(efficiencyRating(r.last.simTime, r.last.delivered)).toBe(rating);
      expect(r.cartLost).toBe(false);
    }, 120_000);
  }

  it('the finish is ORIGINAL_FINISH: line and sensor edge 10.5 m before the blender, 20 m of floor before it', () => {
    const lvl = shipped().level;
    const blender = goalBlenderBox(lvl);
    expect(blender.minX - lvl.goal.lineX).toBeCloseTo(ORIGINAL_FINISH.lineGap, 9);
    expect(lvl.goal.sensor.x).toBe(lvl.goal.lineX);
    expect(ORIGINAL_FINISH).toEqual({ frontGap: 20, lineGap: 10.5 });
  });

  // The scoring contract (every course, src/model/runEvents.ts): delivered = pineapples past goal.lineX at
  // the count; the sensor starts the 2 s settle. As on Kitchen (R30), the first ~9.5 m of the pit floor is
  // a sunken landing strip where pineapples do not count.
  it('holding right with the bridger: delivered is exactly the pineapples past the line, all in the pit short of the blender', async () => {
    const lvl = shipped().level;
    const lineX = lvl.goal.lineX;
    const blenderX = goalBlenderBox(lvl).minX;
    const s = await RunSession.create(kitchenBridger(), shipped());
    try {
      s.start();
      for (let i = 0; i < 60; i++) s.step();
      s.release();
      for (let i = 0; i < 180; i++) s.step();
      for (let n = 0; s.controller.phase !== 'ended' && n < 150 * 60; n++) {
        s.setDrive(paceDrive(s, FLOOR_IT));
        s.step();
      }
      const last = s.events.at(-1)!;
      expect(last.type).toBe('goalReached');
      if (last.type !== 'goalReached') return;
      const states = s.controller.pineappleStates();
      const live = states.filter((p) => p.alive).map((p) => s.world.getTransform(p.handle).x);
      const past = live.filter((x) => x > lineX);
      // removed by the kill plane after crossing the line: arrived, counted (the controller's rule)
      const arrived = states.filter((p) => !p.alive && !p.lost).length;
      expect(last.delivered).toBe(past.length + arrived);
      expect(last.delivered).toBe(s.controller.pastGoalLine());
      expect(last.delivered).toBe(14); // 13 in the pit + 1 arrived (the holding-right pin above)
      for (const x of past) expect(x).toBeLessThan(blenderX);
    } finally {
      s.destroy();
    }
  }, 120_000);

  // The reference expert line with the example cart (acceptance.test.ts pins 10 delivered): M1 moves the line
  // 10 m on, and it still delivers 10 at the same rating as before (measured before/after: 10/15, 52 / 10/15, 52).
  it('the example cart expert line: 10/15 and rating 52, before and after M1', async () => {
    for (const course of [preM1(), shipped()]) {
      const r = await attempt(exampleCart(), course, ORIGINAL_EXPERT_LINE);
      expect(r.last.type).toBe('goalReached');
      if (r.last.type !== 'goalReached') return;
      expect(r.last.delivered).toBe(10);
      expect(efficiencyRating(r.last.simTime, r.last.delivered)).toBe(52);
    }
  }, 120_000);
});
