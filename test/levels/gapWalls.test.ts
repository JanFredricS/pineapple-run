/**
 * S6T backlog #1 regression: gaps have side walls down to killY.
 *
 * Before: a span simply ended at the gap edge (one-sided chain), so a wheel
 * that dropped into a gap slid sideways UNDER the far span's surface and
 * ended up embedded ~1.4 m inside the far block — the cart could never get
 * out (3 stuck runs in the S6V playtest, at careful speeds). Now both edges
 * carry a wall to killY: a dropped wheel stays in the hole, so the cart is
 * either dragged back out or falls to killY and dies cleanly.
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { courseFor, levelById } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import type { LevelDef } from '../../src/model/level';
import { buildTerrain } from '../../src/physics/terrain';
import { PhysicsWorld } from '../../src/physics/engine';
import { WHEEL_MATERIAL } from '../../src/physics/compound';
import { PREMADE } from '../../tools/levels/premade';
import { GAP_WALL_LEAN } from '../../tools/levels/track';

/** Surface y of `level` at x from spans that cover x WITHOUT their wall points (null over a hole). */
function surfaceSpansAt(level: LevelDef, x: number): number[] {
  const ys: number[] = [];
  for (const s of level.terrain.spans) {
    const pts = s.points.filter((p) => p.y < level.killY);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (x >= a.x && x <= b.x && b.x > a.x) ys.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
    }
  }
  return ys;
}

/** A circle centre is "inside the ground" if it sits deeper than `slop` under a surface that covers its x. */
function embedded(level: LevelDef, c: { x: number; y: number }, slop: number): boolean {
  return surfaceSpansAt(level, c.x).some((y) => c.y > y + slop);
}

const gapsOf = (id: 'kitchen' | 'workbench') => PREMADE[id]().features.filter((f) => f.kind === 'gap');

describe('gap side walls (S6T #1)', () => {
  for (const id of ['kitchen', 'workbench'] as const) {
    it(`${id}: every gap edge has a wall from the edge to killY, leaning into the hole`, () => {
      const level = levelById(id)!;
      for (const g of gapsOf(id)) {
        const near = level.terrain.spans.find((s) => s.points.some((p, i) => p.x === g.x0 && s.points[i + 1]?.y === level.killY));
        const far = level.terrain.spans.find((s) => s.points[0]!.y === level.killY && Math.abs(s.points[0]!.x - (g.x1 - 0.35 - GAP_WALL_LEAN)) < 1e-6);
        expect(near, `${id} near wall at ${g.x0}`).toBeDefined();
        expect(far, `${id} far wall at ${g.x1}`).toBeDefined();
        expect(near!.points.at(-1)).toEqual({ x: +(g.x0 + GAP_WALL_LEAN).toFixed(3), y: level.killY });
      }
    });
  }

  it('a wheel dropped at 0 m/s into the 1.4 m kitchen gap, driven and pushed right while sinking, never passes under the far edge', async () => {
    const level = levelById('kitchen')!;
    const g = gapsOf('kitchen')[0]!;
    const farEdge = g.x1 - 0.35; // the far span's first surface point (bevel foot)
    const w = await PhysicsWorld.create();
    try {
      buildTerrain(w, level.terrain);
      const r = 0.4; // small enough to drop right in (a 1.4 m gap)
      const lip = Math.min(...surfaceSpansAt(level, g.x0));
      const wheel = w.createBody({ type: 'dynamic', position: { x: g.x0 + r + 0.1, y: lip + 0.1 }, role: 'wheel' });
      w.addCircle(wheel, { x: 0, y: 0 }, r, { density: 1, ...WHEEL_MATERIAL });
      const inertia = w.getRotationalInertia(wheel);
      let maxX = -Infinity;
      for (let i = 0; i < 60 * 4 && w.getTransform(wheel).y < level.killY; i++) {
        // full drive torque to the right (20 x mass), as a powered wheel
        if (w.getAngularVelocity(wheel) < 20) w.applyTorque(wheel, Math.min(20 * w.getMass(wheel), (inertia * (20 - w.getAngularVelocity(wheel))) * 60));
        // pushed right by its cart, which also holds it up: it sinks at most 0.5 m/s
        const v = w.getLinearVelocity(wheel);
        w.setLinearVelocity(wheel, { x: Math.max(v.x, 1), y: Math.min(v.y, 0.5) });
        w.step();
        const t = w.getTransform(wheel);
        if (t.y > lip + r) maxX = Math.max(maxX, t.x); // wholly below the lip: inside the hole
      }
      expect(maxX).toBeLessThanOrEqual(farEdge - r + 0.02);
    } finally {
      w.destroy();
    }
  });

  // K1: index 1 on kitchen is the sink (5.5 m, far side 0.5 m higher), which
  // the example cart cannot cross: it must still never end up embedded.
  for (const [id, speed, gapIndex] of [
    ['kitchen', 1, 0],
    ['kitchen', 3, 0],
    ['kitchen', 2, 1],
    ['kitchen', 5, 1],
    ['workbench', 2, 0],
  ] as const) {
    it(`${id}: the example cart crawling into gap ${gapIndex} at ${speed} m/s is never embedded in the far block (recoverable or dies cleanly)`, async () => {
      const c = courseFor(id)!;
      const level = c.level;
      const s = await RunSession.create(exampleCart(), c);
      try {
        s.start();
        for (let i = 0; i < 60; i++) s.step();
        s.release();
        for (let i = 0; i < 180; i++) s.step();
        const gapX = gapsOf(id)[gapIndex]!.x0;
        const wheels = s.controller.cart.wheelBodies;
        let worst = 0;
        for (let n = 0; n < 60 * 40 && s.controller.phase !== 'ended'; n++) {
          const h = s.controller.cart.bodies.get(s.controller.chassisId);
          if (s.controller.cartLost || h === undefined) break;
          const vx = s.world.getLinearVelocity(h).x;
          // crawl up to the gap, then keep pushing into it
          s.setDrive(vx < speed ? 1 : vx > speed + 1.5 ? -1 : 0);
          s.step();
          for (const wh of wheels) {
            if (!s.world.hasBody(wh)) continue;
            const t = s.world.getTransform(wh);
            if (t.x > gapX - 2 && embedded(level, t, 0.3)) worst = Math.max(worst, t.y - Math.min(...surfaceSpansAt(level, t.x)));
          }
        }
        expect(worst, `${id}: a wheel centre ended up ${worst.toFixed(2)} m inside the ground`).toBe(0);
      } finally {
        s.destroy();
      }
    }, 60_000);
  }
});
