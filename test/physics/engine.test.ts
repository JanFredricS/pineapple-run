import { afterEach, describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../../src/physics/engine';

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

function ground(w: PhysicsWorld, y = 10) {
  const g = w.createBody({ type: 'static', position: { x: 0, y: 0 }, role: 'terrain' });
  w.addChain(g, [{ x: -50, y }, { x: 50, y }], { friction: 0.9, restitution: 0 });
  return g;
}

describe('PhysicsWorld', () => {
  it('falls under gravity (0, +10), y-down, at 60 Hz', async () => {
    const w = await world();
    const b = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
    w.addCircle(b, { x: 0, y: 0 }, 0.5);
    for (let i = 0; i < 60; i++) w.step();
    expect(w.simTime).toBeCloseTo(1);
    // ~ 0.5 g t^2 = 5 m (semi-implicit Euler lands slightly above)
    expect(w.getTransform(b).y).toBeGreaterThan(4.8);
    expect(w.getTransform(b).y).toBeLessThan(5.2);
  });

  it('a two-point chain span is fully solid (ghost vertices are added)', async () => {
    const w = await world();
    ground(w);
    for (const x of [-49, 0, 49]) {
      const b = w.createBody({ type: 'dynamic', position: { x, y: 8 } });
      w.addCircle(b, { x: 0, y: 0 }, 0.5);
    }
    for (let i = 0; i < 180; i++) w.step();
    const ys = w.bodyHandles().filter((h) => h !== 1).map((h) => w.getTransform(h).y);
    ys.forEach((y) => expect(y).toBeCloseTo(9.5, 1));
  });

  it('terrain friction is applied (a spinning wheel drives off)', async () => {
    const w = await world();
    ground(w);
    const b = w.createBody({ type: 'dynamic', position: { x: 0, y: 9.5 }, angularVelocity: 10 });
    w.addCircle(b, { x: 0, y: 0 }, 0.5, { friction: 0.9 });
    for (let i = 0; i < 120; i++) w.step();
    expect(w.getTransform(b).x).toBeGreaterThan(1);
  });

  it('snapshot interpolates between the previous and current step', async () => {
    const w = await world();
    const b = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 }, linearVelocity: { x: 6, y: 0 } });
    w.addCircle(b, { x: 0, y: 0 }, 0.5);
    w.step();
    w.step();
    const s0 = w.snapshot(0).bodies.find((t) => t.id === b)!;
    const s1 = w.snapshot(1).bodies.find((t) => t.id === b)!;
    const sh = w.snapshot(0.5).bodies.find((t) => t.id === b)!;
    expect(s1.x - s0.x).toBeCloseTo(0.1, 3);
    expect(sh.x).toBeCloseTo((s0.x + s1.x) / 2, 6);
  });

  it('manifest carries roles, part ids and local shapes; revision bumps on change', async () => {
    const w = await world();
    const r0 = w.manifest().revision;
    const b = w.createBody({ type: 'dynamic', position: { x: 1, y: 2 }, role: 'cart', partIds: ['s1'] });
    w.addPolygon(b, [{ x: -1, y: -0.1 }, { x: 1, y: -0.1 }, { x: 1, y: 0.1 }, { x: -1, y: 0.1 }], {}, 's1');
    const m = w.manifest();
    expect(m.revision).toBeGreaterThan(r0);
    expect(m.bodies).toEqual([
      { id: b, role: 'cart', partIds: ['s1'], shapes: [{ type: 'polygon', partId: 's1', vertices: expect.any(Array) }] },
    ]);
    w.destroyBody(b);
    expect(w.manifest().bodies).toHaveLength(0);
  });

  it('snapshot has a transform for exactly the manifest bodies (static included)', async () => {
    const w = await world();
    ground(w);
    const b = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
    w.addCircle(b, { x: 0, y: 0 }, 0.5);
    w.step();
    const ids = w.manifest().bodies.map((x) => x.id).sort();
    expect(w.snapshot(0.5).bodies.map((x) => x.id).sort()).toEqual(ids);
  });

  it('revolute joints: anchors coincide, motor spins, force is queryable', async () => {
    const w = await world();
    const a = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
    const b = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
    w.addCircle(b, { x: 0, y: 0 }, 0.5);
    const j = w.createRevoluteJoint({ bodyA: a, bodyB: b, anchor: { x: 0, y: 0 } });
    w.setRevoluteMotor(j, { enabled: true, speed: 5, maxTorque: 100 });
    for (let i = 0; i < 60; i++) w.step();
    expect(w.getAngularVelocity(b)).toBeCloseTo(5, 1);
    const { a: pa, b: pb } = w.getJointAnchors(j);
    expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeLessThan(1e-3);
    // Pin holds the wheel's weight: |F| ~ m g
    const f = w.getJointForce(j);
    expect(Math.hypot(f.x, f.y)).toBeCloseTo(w.getMass(b) * 10, 0);
  });

  it('distance joints behave as springs', async () => {
    const w = await world();
    const a = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
    const b = w.createBody({ type: 'dynamic', position: { x: 0, y: 1 } });
    w.addCircle(b, { x: 0, y: 0 }, 0.2);
    const j = w.createDistanceJoint({ bodyA: a, bodyB: b, anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: 1 }, hertz: 5, dampingRatio: 0.5 });
    for (let i = 0; i < 240; i++) w.step();
    const y = w.getTransform(b).y;
    // sags below rest length under gravity, but stays bounded
    expect(y).toBeGreaterThan(1);
    expect(y).toBeLessThan(1.2);
    w.destroyJoint(j);
    expect(w.hasJoint(j)).toBe(false);
    for (let i = 0; i < 60; i++) w.step();
    expect(w.getTransform(b).y).toBeGreaterThan(3); // free fall once released
  });

  it('destroying a body drops its joints', async () => {
    const w = await world();
    const a = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
    const b = w.createBody({ type: 'dynamic', position: { x: 1, y: 0 } });
    w.addCircle(a, { x: 0, y: 0 }, 0.2);
    w.addCircle(b, { x: 0, y: 0 }, 0.2);
    const j = w.createRevoluteJoint({ bodyA: a, bodyB: b, anchor: { x: 0.5, y: 0 } });
    w.destroyBody(a);
    expect(w.hasJoint(j)).toBe(false);
    expect(() => w.getJointForce(j)).toThrow(/unknown joint/);
    w.step();
  });

  it('refuses use after destroy', async () => {
    const w = await PhysicsWorld.create();
    w.destroy();
    expect(() => w.step()).toThrow(/after destroy/);
    w.destroy(); // idempotent
  });

  it('does not leak wasm heap per step / snapshot / query', async () => {
    const w = await world();
    ground(w);
    const b = w.createBody({ type: 'dynamic', position: { x: 0, y: 5 } });
    w.addCircle(b, { x: 0, y: 0 }, 0.5);
    const c = w.createBody({ type: 'dynamic', position: { x: 1, y: 5 } });
    w.addCircle(c, { x: 0, y: 0 }, 0.5);
    const j = w.createDistanceJoint({ bodyA: b, bodyB: c, anchorA: { x: 0, y: 5 }, anchorB: { x: 1, y: 5 } });
    const work = () => {
      w.step();
      w.snapshot(0.5);
      w.getJointForce(j);
      w.getJointAnchors(j);
      w.getLinearVelocity(b);
      w.setLinearVelocity(c, { x: 0.1, y: 0 });
    };
    for (let i = 0; i < 200; i++) work(); // warm-up (contacts, islands)
    const before = w.heapBytesInUse();
    for (let i = 0; i < 2000; i++) work();
    expect(w.heapBytesInUse() - before).toBeLessThan(4096);
  });

  it('does not leak when creating and destroying bodies/joints', async () => {
    const w = await world();
    const cycle = () => {
      const a = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
      w.addPolygon(a, [{ x: -1, y: -0.1 }, { x: 1, y: -0.1 }, { x: 1, y: 0.1 }, { x: -1, y: 0.1 }], { groupIndex: -3 });
      const b = w.createBody({ type: 'dynamic', position: { x: 1, y: 0 } });
      w.addCircle(b, { x: 0, y: 0 }, 0.3);
      w.createRevoluteJoint({ bodyA: a, bodyB: b, anchor: { x: 1, y: 0 }, motor: { enabled: true, speed: 1, maxTorque: 1 } });
      w.step();
      w.destroyBody(a);
      w.destroyBody(b);
      w.step();
    };
    for (let i = 0; i < 50; i++) cycle();
    const before = w.heapBytesInUse();
    for (let i = 0; i < 500; i++) cycle();
    expect(w.heapBytesInUse() - before).toBeLessThan(4096);
  });
});
