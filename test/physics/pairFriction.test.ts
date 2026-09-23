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
import { frictionTagsForTests, PhysicsWorld, type BodyHandle, type MaterialDef } from '../../src/physics/engine';
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
  const r = await pinchRig(pair, n);
  for (let i = 0; i < 300; i++) r.step();
  return r.mean();
}

/** The pinch rig, stepped by the caller (300 steps: 120 settle, 180 drive; mean over the last 60). */
async function pinchRig(pair: number | null, n: number, own = true): Promise<{ w: PhysicsWorld; step: () => void; mean: () => number }> {
  const w = own ? await world() : await PhysicsWorld.create();
  const axle = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
  const wheel = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 }, angularDamping: WHEEL_ANGULAR_DAMPING });
  w.addCircle(wheel, { x: 0, y: 0 }, WHEEL_R, { density: 1, ...WHEEL_MATERIAL });
  w.createRevoluteJoint({ bodyA: axle, bodyB: wheel, anchor: { x: 0, y: 0 } });
  const wx = WHEEL_R + 2 * PINEAPPLE_RADIUS * 0.7;
  const wall = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
  w.addPolygon(wall, [{ x: wx, y: -4 }, { x: wx + 0.2, y: -4 }, { x: wx + 0.2, y: 2 }, { x: wx, y: 2 }], PART_MATERIAL);
  for (let i = 0; i < n; i++) spawnPineapple(w, { x: wx - PINEAPPLE_RADIUS - 0.01, y: -1.2 - i * 0.7 });
  if (pair !== null) w.setPairFriction(SURFACE.pineapple, SURFACE.wheel, pair);
  let i = 0;
  let sum = 0;
  const step = () => {
    if (i >= 120) drive(w, wheel); // the first 120 steps settle into the wedge
    w.step();
    if (i >= 240) sum += w.getAngularVelocity(wheel);
    i++;
  };
  return { w, step, mean: () => sum / 60 };
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
    expect(() => w.setPairFriction(1, 2, Infinity)).toThrow();
    expect(() => w.setPairFriction(1, 2, NaN)).toThrow();
    const b = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
    expect(() => w.addCircle(b, { x: 0, y: 0 }, 1, { surface: -1 })).toThrow();
    expect(() => w.addCircle(b, { x: 0, y: 0 }, 1, { surface: NaN })).toThrow();
    expect(() => w.addCircle(b, { x: 0, y: 0 }, 1, { surface: Infinity })).toThrow();
    expect(() => w.addCircle(b, { x: 0, y: 0 }, 1, { surface: 1.5 })).toThrow();
    expect(() => w.addCircle(b, { x: 0, y: 0 }, 1, { surface: 1048576 })).toThrow();
    // 0 is valid and means "no surface"
    expect(() => w.addCircle(b, { x: 0, y: 0 }, 1, { surface: 0 })).not.toThrow();
  });

  /**
   * Callback lifetime. The binding holds ONE JS friction callback for the
   * whole module (the latest b2World_SetFrictionCallback wins) and does not
   * say which world is calling, so the engine installs a single dispatcher
   * and tags each shape's userMaterialId with its world. Without that, the
   * second world's table silently replaced the first's (a 0.9 world ran at
   * 0.3 — measured before the fix).
   */
  it('two live worlds keep their own overrides, stepped interleaved', async () => {
    const lock = await pinchRig(0.9, 3);
    const free = await pinchRig(0.3, 3);
    for (let i = 0; i < 300; i++) {
      lock.step();
      free.step();
    }
    expect(Math.abs(lock.mean())).toBeLessThan(0.5);
    expect(free.mean()).toBeGreaterThan(0.9 * DRIVE_MAX_SPEED);
  });

  it('create/destroy in sequence (the retry pattern): the current world\'s override is the one in effect, every time', async () => {
    const results: number[] = [];
    for (let n = 0; n < 8; n++) {
      const pair = n % 2 ? 0.9 : 0.3;
      const r = await pinchRig(pair, 3, false);
      for (let i = 0; i < 300; i++) r.step();
      results.push(r.mean());
      r.w.destroy(); // drops its table; the next world must not see it
    }
    for (let n = 0; n < 8; n++) {
      if (n % 2) expect(Math.abs(results[n]!), `world ${n} (0.9)`).toBeLessThan(0.5);
      else expect(results[n]!, `world ${n} (0.3)`).toBeGreaterThan(0.9 * DRIVE_MAX_SPEED);
    }
    // deterministic across recreations: same configuration, bit-identical result
    expect(new Set(results.filter((_, n) => n % 2 === 0)).size).toBe(1);
    expect(new Set(results.filter((_, n) => n % 2 === 1)).size).toBe(1);
    // a world that outlives a destroyed one keeps its override
    const keep = await pinchRig(0.3, 3);
    const gone = await pinchRig(0.9, 3, false);
    gone.w.destroy();
    for (let i = 0; i < 300; i++) keep.step();
    expect(keep.mean()).toBeGreaterThan(0.9 * DRIVE_MAX_SPEED);
  });

  /**
   * World tags live in the 44 bits above the 20 surface bits of the 64-bit
   * userMaterialId, so the allocator is bounded: it counts to 2^44 − 1, then
   * reuses the lowest tag no live world holds, and throws (never truncates)
   * if every tag is live. The real bound cannot be exhausted in a test, so the
   * seam moves the counter and lowers the bound.
   */
  describe('world-tag allocator (bounded, reuses freed tags)', () => {
    afterEach(() => {
      worlds.forEach((w) => w.destroy());
      worlds = [];
      frictionTagsForTests.reset();
    });

    it('the top 44-bit tag round-trips exactly, and past the bound a freed tag is reused with correct dispatch', async () => {
      const MAX = frictionTagsForTests.MAX_FRICTION_TAG;
      expect(MAX).toBe(2 ** 44 - 1);
      frictionTagsForTests.set({ next: MAX });
      // NON-DEFAULT override (0.3, not the 0.9 default mix): a spin here can only
      // come from dispatch finding the table through the fully packed max tag.
      const top = await pinchRig(0.3, 3); // tag 2^44 − 1: (tag << 20) | surface uses all 64 bits
      expect(frictionTagsForTests.tagOf(top.w)).toBe(MAX);
      const lowestFree = (): number => {
        const live = new Set(frictionTagsForTests.live());
        let t = 1;
        while (live.has(t)) t++;
        return t;
      };
      const expectReuse = lowestFree();
      const reused = await pinchRig(0.9, 3); // counter is past the bound: reuse
      expect(frictionTagsForTests.tagOf(reused.w)).toBe(expectReuse);
      for (let i = 0; i < 300; i++) {
        top.step();
        reused.step();
      }
      expect(top.mean(), 'top tag dispatches its non-default 0.3').toBeGreaterThan(0.9 * DRIVE_MAX_SPEED);
      expect(Math.abs(reused.mean()), 'reused tag keeps its 0.9').toBeLessThan(0.5);
      // a destroyed world's tag goes back to the pool, and the next world gets it
      // with a fresh table; its non-default 0.3 proves dispatch through the reused tag
      const t = frictionTagsForTests.tagOf(reused.w);
      reused.w.destroy();
      const again = await pinchRig(0.3, 3);
      expect(frictionTagsForTests.tagOf(again.w)).toBe(t);
      for (let i = 0; i < 300; i++) again.step();
      expect(again.mean(), 'fresh table on the reused tag, no stale 0.9').toBeGreaterThan(0.9 * DRIVE_MAX_SPEED);
    });

    it('throws a clear error, rather than truncating, when every tag is live', async () => {
      // tags 1..bound, counter already past the bound: only free tags can be handed out
      const live = frictionTagsForTests.live();
      const bound = (live.at(-1) ?? 0) + 3;
      frictionTagsForTests.set({ next: bound + 1, bound });
      const made: PhysicsWorld[] = [];
      for (let i = 0; i < bound - live.length; i++) made.push(await world());
      expect(new Set(made.map((w) => frictionTagsForTests.tagOf(w))).size).toBe(made.length);
      expect(frictionTagsForTests.live()).toEqual(Array.from({ length: bound }, (_, i) => i + 1));
      await expect(PhysicsWorld.create()).rejects.toThrow(/friction world tags are live/);
      // one freed tag makes creation work again, with that tag
      const freed = frictionTagsForTests.tagOf(made[0]!);
      made[0]!.destroy();
      const w = await world();
      expect(frictionTagsForTests.tagOf(w)).toBe(freed);
    });
  });
});
