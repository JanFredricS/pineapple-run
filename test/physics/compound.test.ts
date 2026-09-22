import { afterEach, describe, expect, it } from 'vitest';
import { resolveAttachments } from '../../src/model/attach';
import { MIN_PART_SIZE_PX, type CartDesign } from '../../src/model/cart';
import { DRIVE_MAX_SPEED, buildCompound } from '../../src/physics/compound';
import { PhysicsWorld } from '../../src/physics/engine';

let worlds: PhysicsWorld[] = [];
async function world(gravity = { x: 0, y: 10 }): Promise<PhysicsWorld> {
  const w = await PhysicsWorld.create({ gravity });
  worlds.push(w);
  return w;
}
afterEach(() => {
  worlds.forEach((w) => w.destroy());
  worlds = [];
});

/** Bed straw A with two pinned wheels; w2 also carries a shock. */
function baseParts(): CartDesign['parts'] {
  return [
    { id: 'A', kind: 'straw', a: { x: 0, y: 0 }, b: { x: 180, y: 0 } },
    { id: 'w1', kind: 'wheel', center: { x: 20, y: 0 }, radius: 22 },
    { id: 'w2', kind: 'wheel', center: { x: 160, y: 0 }, radius: 22 },
  ];
}

describe('buildCompound', () => {
  it('drive: pinned and shock-mounted wheels get the same direct torque, capped at 20 rad/s, with no reaction on the chassis', async () => {
    const w = await world({ x: 0, y: 0 });
    const design: CartDesign = {
      version: 1,
      parts: [
        ...baseParts(),
        // a free wheel hung below the bed on a shock snapped to its centre
        { id: 'w3', kind: 'wheel', center: { x: 90, y: 90 }, radius: 22 },
        { id: 'k', kind: 'shock', a: { x: 90, y: 0 }, b: { x: 90, y: 90 } },
      ],
    };
    const spec = resolveAttachments(design);
    expect(spec.errors).toEqual([]);
    const cart = buildCompound(w, spec, { x: 0, y: 0 });
    const chassis = cart.bodies.get(spec.partBody.get('A')!)!;
    const free = cart.bodies.get(spec.partBody.get('w3')!)!;
    expect(cart.wheelJoints.has('w3')).toBe(false);
    cart.setDrive(1);
    let peak = 0;
    for (let s = 0; s < 180; s++) {
      cart.preStep();
      w.step();
      for (const h of cart.wheelBodies) peak = Math.max(peak, w.getAngularVelocity(h));
    }
    for (const h of cart.wheelBodies) expect(w.getAngularVelocity(h)).toBeGreaterThan(DRIVE_MAX_SPEED * 0.9);
    expect(w.getAngularVelocity(free)).toBeGreaterThan(DRIVE_MAX_SPEED * 0.9);
    // torque is limited to the remaining headroom: never past the cap
    expect(peak).toBeLessThanOrEqual(DRIVE_MAX_SPEED + 1e-3);
    // external torque on the wheels only: the chassis does not counter-rotate
    expect(Math.abs(w.getAngularVelocity(chassis))).toBeLessThan(0.05);
    // coasting applies nothing
    cart.setDrive(0);
    const before = w.getAngularVelocity(free);
    cart.preStep();
    w.step();
    expect(w.getAngularVelocity(free)).toBeLessThanOrEqual(before);
  });

  it.each([
    ['in the air', { x: 0, y: 0 }],
    ['on the ground', { x: 0, y: 10 }],
  ])('drive cap holds for minimum-radius (5 px) wheels, both directions (%s)', async (_n, gravity) => {
    const w = await world(gravity);
    if (gravity.y) {
      const g = w.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'terrain' });
      w.addChain(g, [{ x: -50, y: 10 }, { x: 50, y: 10 }], { friction: 0.9, restitution: 0 });
    }
    const r = MIN_PART_SIZE_PX;
    const design: CartDesign = {
      version: 1,
      parts: [
        { id: 'A', kind: 'straw', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } },
        { id: 'w1', kind: 'wheel', center: { x: 5, y: 0 }, radius: r },
        { id: 'w2', kind: 'wheel', center: { x: 35, y: 0 }, radius: r },
      ],
    };
    const spec = resolveAttachments(design);
    expect(spec.errors).toEqual([]);
    const cart = buildCompound(w, spec, { x: 0, y: 10 - r / 30 - 0.01 });
    let peak = 0;
    for (const dir of [1, -1, 1] as const) {
      cart.setDrive(dir);
      for (let s = 0; s < 90; s++) {
        cart.preStep();
        w.step();
        for (const h of cart.wheelBodies) peak = Math.max(peak, Math.abs(w.getAngularVelocity(h)));
      }
    }
    expect(peak).toBeGreaterThan(DRIVE_MAX_SPEED * 0.9);
    expect(peak).toBeLessThanOrEqual(DRIVE_MAX_SPEED + 1e-3);
  });

  it('collision: only directly jointed bodies skip collision; other bodies of the same cart collide', async () => {
    const w = await world();
    const ground = w.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'terrain' });
    w.addChain(ground, [{ x: -20, y: 10 }, { x: 30, y: 10 }], { friction: 0.9, restitution: 0 });
    // Cube B hangs on a shock from wheel w2 (B–w2 jointed, w2 pinned to A).
    // B and A share no joint, so B swinging down must land on A, not fall
    // through it.
    const design: CartDesign = {
      version: 1,
      parts: [
        ...baseParts(),
        { id: 'B', kind: 'cube', center: { x: 90, y: -40 }, width: 30, height: 30, angle: 0 },
        { id: 'k', kind: 'shock', a: { x: 90, y: -40 }, b: { x: 160, y: 0 } },
      ],
    };
    const spec = resolveAttachments(design);
    expect(spec.errors).toEqual([]);
    const cart = buildCompound(w, spec, { x: 0, y: 10 - 22 / 30 });
    const a = cart.bodies.get(spec.partBody.get('A')!)!;
    const b = cart.bodies.get(spec.partBody.get('B')!)!;
    for (let s = 0; s < 180; s++) w.step();
    // B rests on top of A (y-down: smaller y is higher)
    expect(w.getTransform(b).y).toBeLessThan(w.getTransform(a).y);
  });
});
