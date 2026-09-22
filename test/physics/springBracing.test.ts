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
 * Bracing rules are physics, not validation: a spring parallelogram has no
 * shear resistance, so an unbraced two-spring cart folds flat under a side
 * load, while the same cart with one diagonal spring stays standing. This is
 * the original game's "badly built carts collapse" behaviour, emergent from
 * distance-joint shocks.
 */
function cart(diagonal: boolean): CartDesign {
  const parts: CartDesign['parts'] = [
    { id: 'L', kind: 'cube', center: { x: 90, y: 0 }, width: 180, height: 30, angle: 0 },
    { id: 'w1', kind: 'wheel', center: { x: 20, y: 0 }, radius: 22 },
    { id: 'w2', kind: 'wheel', center: { x: 160, y: 0 }, radius: 22 },
    { id: 'U', kind: 'cube', center: { x: 90, y: -80 }, width: 120, height: 30, angle: 0 },
    // Two parallel vertical springs: a pure parallelogram.
    { id: 's1', kind: 'shock', a: { x: 50, y: -80 }, b: { x: 50, y: 0 } },
    { id: 's2', kind: 'shock', a: { x: 130, y: -80 }, b: { x: 130, y: 0 } },
  ];
  if (diagonal) {
    // One diagonal brace turns the parallelogram into a truss.
    parts.push({ id: 's3', kind: 'shock', a: { x: 50, y: -80 }, b: { x: 130, y: 0 } });
  }
  return { version: 1, parts };
}

async function shearAfterSideKick(diagonal: boolean): Promise<number> {
  const w = await world();
  const ground = w.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'terrain' });
  w.addChain(ground, [{ x: -60, y: 10 }, { x: 90, y: 10 }], { friction: 0.9, restitution: 0 });

  const spec = resolveAttachments(cart(diagonal));
  expect(spec.errors).toEqual([]);
  const built = buildCompound(w, spec, { x: 0, y: 10 - 22 / 30 });
  const l = built.bodies.get(spec.partBody.get('L')!)!;
  const u = built.bodies.get(spec.partBody.get('U')!)!;

  // Let the springs settle, then kick the sprung box sideways.
  for (let s = 0; s < 120; s++) w.step();
  w.setLinearVelocity(u, { x: 6, y: 0 });

  // Track the worst horizontal shear of U relative to L.
  let worst = 0;
  for (let s = 0; s < 360; s++) {
    w.step();
    const tl = w.getTransform(l);
    const tu = w.getTransform(u);
    worst = Math.max(worst, Math.abs(tu.x - tl.x));
  }
  return worst;
}

describe('spring bracing is a physics consequence, not a validation rule', () => {
  it('both variants are valid designs (bad bracing is allowed to run)', () => {
    expect(resolveAttachments(cart(false)).valid).toBe(true);
    expect(resolveAttachments(cart(true)).valid).toBe(true);
  });

  it('an unbraced spring parallelogram shears flat; a diagonal brace holds it up', async () => {
    const unbraced = await shearAfterSideKick(false);
    const braced = await shearAfterSideKick(true);

    // Design rest offset is 0: any large lateral offset is shear. The
    // unbraced upper box swings out well past a metre (folding over the
    // lower box); the truss keeps shear to centimetres.
    expect(unbraced).toBeGreaterThan(1);
    expect(braced).toBeLessThan(0.5);
    expect(unbraced).toBeGreaterThan(braced * 3);
  });
});
