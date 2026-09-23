/**
 * S6T backlog #4: shocks have (emulated) travel limits — SHOCK_MIN_RATIO ..
 * SHOCK_MAX_RATIO × rest length — applied by CartInstance.preStep() as
 * momentum-conserving bump stops (the frozen engine wrapper exposes no
 * distance-joint limits).
 *
 * With the shipped 8 Hz springs a lone shock rarely reaches a stop (the
 * spring wins), so the stop itself is exercised on a deliberately soft
 * (0.5 Hz) joint where the limit is what holds the bodies.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { bumpStop, localCentroid, SHOCK_MAX_RATIO, SHOCK_MIN_RATIO, type ShockStop } from '../../src/physics/compound';
import { PhysicsWorld } from '../../src/physics/engine';

let worlds: PhysicsWorld[] = [];
afterEach(() => {
  worlds.forEach((w) => w.destroy());
  worlds = [];
});

const REST = 2;

/** Two boxes joined off-centre (so rotation matters) by a soft 0.5 Hz distance joint of rest length 2 m. */
async function softPair() {
  const w = await PhysicsWorld.create({ gravity: { x: 0, y: 0 } });
  worlds.push(w);
  const box = [{ x: -0.5, y: -0.25 }, { x: 0.5, y: -0.25 }, { x: 0.5, y: 0.25 }, { x: -0.5, y: 0.25 }];
  const a = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
  w.addPolygon(a, box, { density: 1 });
  const b = w.createBody({ type: 'dynamic', position: { x: 0, y: -2 } });
  w.addPolygon(b, box, { density: 3 });
  // anchors 0.4 m off each centre: pulling rotates the boxes too
  const joint = w.createDistanceJoint({ bodyA: a, bodyB: b, anchorA: { x: 0.4, y: 0 }, anchorB: { x: 0.4, y: -2 }, hertz: 0.5, dampingRatio: 0.1 });
  const stop: ShockStop = { joint, a, b, comA: { x: 0, y: 0 }, comB: { x: 0, y: 0 }, min: REST * SHOCK_MIN_RATIO, max: REST * SHOCK_MAX_RATIO };
  const ratio = () => {
    const p = w.getJointAnchors(joint);
    return Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) / REST;
  };
  const momentum = () => {
    const va = w.getLinearVelocity(a);
    const vb = w.getLinearVelocity(b);
    return { x: w.getMass(a) * va.x + w.getMass(b) * vb.x, y: w.getMass(a) * va.y + w.getMass(b) * vb.y };
  };
  return { w, a, b, stop, ratio, momentum };
}

async function kicked(vy: number, stops: boolean) {
  const p = await softPair();
  p.w.setLinearVelocity(p.b, { x: 0, y: vy });
  const m0 = p.momentum();
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 180; i++) {
    if (stops) bumpStop(p.w, p.stop);
    p.w.step();
    min = Math.min(min, p.ratio());
    max = Math.max(max, p.ratio());
  }
  return { min, max, m0, m1: p.momentum() };
}

describe('shock bump stops (S6T #4)', () => {
  it('a pull past the max length is stopped there (soft joint alone overshoots far)', async () => {
    const free = await kicked(-5, false);
    const held = await kicked(-5, true);
    expect(free.max).toBeGreaterThan(SHOCK_MAX_RATIO + 0.3);
    expect(held.max).toBeLessThan(SHOCK_MAX_RATIO + 0.06);
    // internal impulses only: linear momentum is conserved
    expect(held.m1.x).toBeCloseTo(held.m0.x, 3);
    expect(held.m1.y).toBeCloseTo(held.m0.y, 3);
  });

  it('a push past the min length is stopped there', async () => {
    const free = await kicked(5, false);
    const held = await kicked(5, true);
    expect(free.min).toBeLessThan(SHOCK_MIN_RATIO - 0.2);
    expect(held.min).toBeGreaterThan(SHOCK_MIN_RATIO - 0.06);
    expect(held.m1.y).toBeCloseTo(held.m0.y, 3);
  });

  it('inside the limits the stops never act', async () => {
    const a = await kicked(-0.3, false);
    const b = await kicked(-0.3, true);
    expect(a.max).toBeLessThan(SHOCK_MAX_RATIO);
    expect(b.max).toBe(a.max);
    expect(b.min).toBe(a.min);
  });

  it('stops use the body centre of mass (uniform density): a rectangle has it in the middle', () => {
    expect(localCentroid([{ type: 'polygon', partId: 'p', vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }] }])).toEqual({ x: 1, y: 0.5 });
  });
});
