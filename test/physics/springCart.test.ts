import { afterEach, describe, expect, it } from 'vitest';
import { resolveAttachments } from '../../src/model/attach';
import type { CartDesign } from '../../src/model/cart';
import { buildCompound } from '../../src/physics/compound';
import { PhysicsWorld } from '../../src/physics/engine';

let worlds: PhysicsWorld[] = [];
async function world(): Promise<PhysicsWorld> {
  const w = await PhysicsWorld.create({ gravity: { x: 0, y: 10 } });
  worlds.push(w);
  return w;
}
afterEach(() => {
  worlds.forEach((w) => w.destroy());
  worlds = [];
});

/**
 * Two cubes that never touch, held together only by two shocks (the
 * original game's articulated-cart behaviour). Lower cube L carries the
 * wheels; upper cube U floats 50 px above it on springs.
 */
function twoBoxSpringCart(): CartDesign {
  return {
    version: 1,
    parts: [
      { id: 'L', kind: 'cube', center: { x: 90, y: 0 }, width: 180, height: 30, angle: 0 },
      { id: 'w1', kind: 'wheel', center: { x: 20, y: 0 }, radius: 22 },
      { id: 'w2', kind: 'wheel', center: { x: 160, y: 0 }, radius: 22 },
      { id: 'U', kind: 'cube', center: { x: 90, y: -80 }, width: 120, height: 30, angle: 0 },
      { id: 's1', kind: 'shock', a: { x: 70, y: -80 }, b: { x: 70, y: 0 } },
      { id: 's2', kind: 'shock', a: { x: 110, y: -80 }, b: { x: 110, y: 0 } },
    ],
  };
}

describe('two-box spring-only cart', () => {
  it('is a valid design: shocks alone connect the islands, boxes land on separate bodies', () => {
    const spec = resolveAttachments(twoBoxSpringCart());
    expect(spec.errors).toEqual([]);
    expect(spec.valid).toBe(true);
    const lBody = spec.partBody.get('L');
    const uBody = spec.partBody.get('U');
    expect(lBody).toBeDefined();
    expect(uBody).toBeDefined();
    expect(lBody).not.toBe(uBody);
    const shockJoints = spec.joints.filter((j) => j.type === 'distance');
    expect(shockJoints).toHaveLength(2);
  });

  it('moves independently: the sprung box oscillates against the wheeled box and they never touch', async () => {
    const w = await world();
    const ground = w.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'terrain' });
    w.addChain(ground, [{ x: -30, y: 10 }, { x: 60, y: 10 }], { friction: 0.9, restitution: 0 });

    const spec = resolveAttachments(twoBoxSpringCart());
    expect(spec.errors).toEqual([]);
    // Drop from ~1 m above the resting wheel height so the springs get a jolt.
    const cart = buildCompound(w, spec, { x: 0, y: 10 - 22 / 30 - 1 });
    const l = cart.bodies.get(spec.partBody.get('L')!)!;
    const u = cart.bodies.get(spec.partBody.get('U')!)!;

    // Design rest separation of the box centres: 80 px = 2.667 m.
    const rest = 80 / 30;
    // Centres closer than both half-heights (15 px + 15 px = 1 m) means contact.
    const touchDist = 30 / 30;

    const sep: number[] = [];
    for (let s = 0; s < 300; s++) {
      w.step();
      const tl = w.getTransform(l);
      const tu = w.getTransform(u);
      sep.push(Math.hypot(tl.x - tu.x, tl.y - tu.y));
    }

    const min = Math.min(...sep);
    const max = Math.max(...sep);
    // Real relative motion: the spring visibly compresses and extends
    // during the drop, not a welded pair at constant distance.
    expect(max - min).toBeGreaterThan(0.05);
    // The springs work: separation deviates from the rest length under load...
    expect(min).toBeLessThan(rest - 0.01);
    // ...but the boxes never collide.
    expect(min).toBeGreaterThan(touchDist + 0.05);

    // After settling, the sprung box is still carried above the wheeled box
    // near (but not exactly at) the rest length.
    const settled = sep[sep.length - 1]!;
    expect(Math.abs(settled - rest)).toBeLessThan(0.4);
    const tl = w.getTransform(l);
    const tu = w.getTransform(u);
    expect(tu.y).toBeLessThan(tl.y); // y-down: U stays above L
  });
});
