/**
 * S8a (backlog #9, R19): pineapple–wheel contact friction.
 *
 * Pineapples and wheels are both friction 0.9 and Box2D mixes contact
 * friction as sqrt(fA · fB), so a pineapple pressed against a wheel gripped
 * it at 0.9 and a pile of them braked the wheel to a stop. The engine now
 * has a pairwise override (PhysicsWorld.setPairFriction, a Box2D friction
 * callback keyed on MaterialDef.surface); src/physics/surfaces.ts sets
 * pineapple–wheel to 0.3. Every other pair must be untouched.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PINEAPPLE_MATERIAL, PINEAPPLE_RADIUS, spawnPineapple } from '../../src/physics/cargo';
import { FIXED_DT } from '../../src/physics/clock';
import { DRIVE_MAX_SPEED, DRIVE_TORQUE_PER_MASS, PART_MATERIAL, WHEEL_ANGULAR_DAMPING, WHEEL_MATERIAL } from '../../src/physics/compound';
import { PhysicsWorld, type BodyHandle, type MaterialDef } from '../../src/physics/engine';
import { PINEAPPLE_WHEEL_FRICTION, SURFACE } from '../../src/physics/surfaces';

let worlds: PhysicsWorld[] = [];
async function world(): Promise<PhysicsWorld> {
  const w = await PhysicsWorld.create();
  worlds.push(w);
  return w;
}
afterEach(() => {
  worlds.forEach((w) => w.destroy());
  worlds = [];
});

const WHEEL_R = 25 / 30;

/** The game's drive law (compound.preStep) on one wheel. */
function drive(w: PhysicsWorld, wheel: BodyHandle): void {
  const headroom = DRIVE_MAX_SPEED - w.getAngularVelocity(wheel);
  if (headroom > 0) w.applyTorque(wheel, Math.min(DRIVE_TORQUE_PER_MASS * w.getMass(wheel), (w.getRotationalInertia(wheel) * headroom) / FIXED_DT));
}

/**
 * The pinch: a driven wheel on a fixed axle, a static wall to its right
 * leaving a gap of 0.7 pineapple diameters, and `n` pineapples dropped into
 * the gap. The wheel's right side moves DOWN when it drives right, so it
 * drags the pineapple deeper into the wedge — a self-locking brake when the
 * contact friction is high. `pair` = the pineapple–wheel friction for this
 * world (null = the shipped value). Returns the wheel's mean angular
 * velocity over the last second of 3 s of full drive.
 */
async function pinch(pair: number | null, n: number): Promise<number> {
  const w = await world();
  const axle = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
  const wheel = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 }, angularDamping: WHEEL_ANGULAR_DAMPING });
  w.addCircle(wheel, { x: 0, y: 0 }, WHEEL_R, { density: 1, ...WHEEL_MATERIAL });
  w.createRevoluteJoint({ bodyA: axle, bodyB: wheel, anchor: { x: 0, y: 0 } });
  const wx = WHEEL_R + 2 * PINEAPPLE_RADIUS * 0.7;
  const wall = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
  w.addPolygon(wall, [{ x: wx, y: -4 }, { x: wx + 0.2, y: -4 }, { x: wx + 0.2, y: 2 }, { x: wx, y: 2 }], PART_MATERIAL);
  for (let i = 0; i < n; i++) spawnPineapple(w, { x: wx - PINEAPPLE_RADIUS - 0.01, y: -1.2 - i * 0.7 });
  if (pair !== null) w.setPairFriction(SURFACE.pineapple, SURFACE.wheel, pair);
  for (let i = 0; i < 120; i++) w.step(); // settle into the wedge
  let sum = 0;
  for (let i = 0; i < 180; i++) {
    drive(w, wheel);
    w.step();
    if (i >= 120) sum += w.getAngularVelocity(wheel);
  }
  return sum / 60;
}

describe('pineapple–wheel pair friction (S8a, backlog #9)', () => {
  it('ships at 0.3 for the pineapple–wheel pair', () => {
    expect(PINEAPPLE_WHEEL_FRICTION).toBe(0.3);
    expect(PINEAPPLE_MATERIAL.surface).toBe(SURFACE.pineapple);
    expect(WHEEL_MATERIAL.surface).toBe(SURFACE.wheel);
    expect(PINEAPPLE_MATERIAL.friction).toBe(0.9);
    expect(WHEEL_MATERIAL.friction).toBe(0.9);
  });

  it('a pineapple pinched against a driven wheel no longer stalls it (the old 0.9 mix locks it dead)', async () => {
    for (const n of [1, 3]) {
      const old = await pinch(Math.sqrt(Math.fround(Math.fround(0.9) * Math.fround(0.9))), n);
      const now = await pinch(null, n);
      // measured: 0.00 rad/s at 0.9, ~19.8 rad/s (the 20 rad/s cap) at 0.3
      expect(Math.abs(old), `n=${n} old`).toBeLessThan(0.5);
      expect(now, `n=${n} new`).toBeGreaterThan(0.9 * DRIVE_MAX_SPEED);
    }
  });

  /**
   * Every pair except pineapple–wheel keeps Box2D's own mix, bit-for-bit:
   * a wheel driving up a slope and a pineapple rolling away from it down
   * a gentle one (no pineapple–wheel contact) trace identically in a world with the
   * override installed and in one with no surfaces and no callback at all.
   */
  it('pineapple–terrain and wheel–terrain are unchanged (bit-identical traces with and without the override)', async () => {
    const trace = async (withSurfaces: boolean): Promise<number[]> => {
      const w = await world();
      const strip = (m: MaterialDef): MaterialDef => {
        const { surface: _s, ...rest } = m;
        return withSurfaces ? m : rest;
      };
      const ground = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
      w.addChain(ground, [{ x: -60, y: 2 }, { x: -20, y: 0 }, { x: 0, y: 0 }, { x: 20, y: -4 }, { x: 40, y: -4 }], { friction: 0.9, restitution: 0.3 });
      const wheel = w.createBody({ type: 'dynamic', position: { x: -5, y: -WHEEL_R }, angularDamping: WHEEL_ANGULAR_DAMPING });
      w.addCircle(wheel, { x: 0, y: 0 }, WHEEL_R, { density: 1, ...strip(WHEEL_MATERIAL) });
      const p = w.createBody({ type: 'dynamic', position: { x: -12, y: -PINEAPPLE_RADIUS - 0.5 }, bullet: true, linearVelocity: { x: -4, y: 0 } });
      w.addCircle(p, { x: 0, y: 0 }, PINEAPPLE_RADIUS, strip(PINEAPPLE_MATERIAL));
      // a part box sliding on the terrain: an unequal pair (0.6 × 0.9), so the mix math itself is exercised
      const box = w.createBody({ type: 'dynamic', position: { x: -40, y: 1 - 0.3 }, linearVelocity: { x: -5, y: 0 } });
      w.addPolygon(box, [{ x: -0.3, y: -0.2 }, { x: 0.3, y: -0.2 }, { x: 0.3, y: 0.2 }, { x: -0.3, y: 0.2 }], { density: 1, ...PART_MATERIAL });
      if (withSurfaces) w.setPairFriction(SURFACE.pineapple, SURFACE.wheel, PINEAPPLE_WHEEL_FRICTION);
      const out: number[] = [];
      for (let i = 0; i < 240; i++) {
        drive(w, wheel);
        w.step();
        for (const h of [wheel, p, box]) {
          const t = w.getTransform(h);
          out.push(t.x, t.y, t.angle);
        }
      }
      // the two never met (else this would not test the unchanged pairs)
      expect(Math.hypot(w.getTransform(p).x - w.getTransform(wheel).x, w.getTransform(p).y - w.getTransform(wheel).y)).toBeGreaterThan(WHEEL_R + PINEAPPLE_RADIUS);
      return out;
    };
    const plain = await trace(false);
    const overridden = await trace(true);
    expect(overridden).toEqual(plain);
    // and something actually moved: the wheel climbed, the pineapple rolled
    expect(plain.at(-9)!).toBeGreaterThan(-5 + 3);
  });

  it('validates its inputs', async () => {
    const w = await world();
    expect(() => w.setPairFriction(0, 1, 0.3)).toThrow();
    expect(() => w.setPairFriction(1, 1.5, 0.3)).toThrow();
    expect(() => w.setPairFriction(1, 2, -1)).toThrow();
    const b = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
    expect(() => w.addCircle(b, { x: 0, y: 0 }, 1, { surface: -1 })).toThrow();
  });
});
