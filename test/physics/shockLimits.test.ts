/**
 * Shock travel limits — SHOCK_MIN_RATIO .. SHOCK_MAX_RATIO × rest length.
 * S6T #4 emulated them with velocity-level bump stops in CartInstance.preStep
 * (the engine wrapper was frozen); since S8a they are real Box2D
 * distance-joint limits (b2DistanceJointDef enableLimit/minLength/maxLength),
 * enforced inside the solver on every sub-step.
 *
 * With the shipped 8 Hz springs a lone shock rarely reaches a limit (the
 * spring wins), so the limit itself is exercised on a deliberately soft
 * (0.5 Hz) joint where the limit is what holds the bodies.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAttachments } from '../../src/model/attach';
import { exampleCart } from '../../src/builder/exampleCart';
import { buildCompound, SHOCK_MAX_RATIO, SHOCK_MIN_RATIO } from '../../src/physics/compound';
import { PhysicsWorld } from '../../src/physics/engine';

let worlds: PhysicsWorld[] = [];
afterEach(() => {
  worlds.forEach((w) => w.destroy());
  worlds = [];
});

const REST = 2;

/** Two boxes joined off-centre (so rotation matters) by a soft 0.5 Hz distance joint of rest length 2 m. */
async function softPair(limited: boolean) {
  const w = await PhysicsWorld.create({ gravity: { x: 0, y: 0 } });
  worlds.push(w);
  const box = [{ x: -0.5, y: -0.25 }, { x: 0.5, y: -0.25 }, { x: 0.5, y: 0.25 }, { x: -0.5, y: 0.25 }];
  const a = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
  w.addPolygon(a, box, { density: 1 });
  const b = w.createBody({ type: 'dynamic', position: { x: 0, y: -2 } });
  w.addPolygon(b, box, { density: 3 });
  // anchors 0.4 m off each centre: pulling rotates the boxes too
  const joint = w.createDistanceJoint({
    bodyA: a,
    bodyB: b,
    anchorA: { x: 0.4, y: 0 },
    anchorB: { x: 0.4, y: -2 },
    hertz: 0.5,
    dampingRatio: 0.1,
    ...(limited ? { limits: { minLength: REST * SHOCK_MIN_RATIO, maxLength: REST * SHOCK_MAX_RATIO } } : {}),
  });
  const ratio = () => {
    const p = w.getJointAnchors(joint);
    return Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) / REST;
  };
  const momentum = () => {
    const va = w.getLinearVelocity(a);
    const vb = w.getLinearVelocity(b);
    return { x: w.getMass(a) * va.x + w.getMass(b) * vb.x, y: w.getMass(a) * va.y + w.getMass(b) * vb.y };
  };
  return { w, a, b, joint, ratio, momentum };
}

async function kicked(vy: number, limited: boolean) {
  const p = await softPair(limited);
  p.w.setLinearVelocity(p.b, { x: 0, y: vy });
  const m0 = p.momentum();
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 180; i++) {
    p.w.step();
    min = Math.min(min, p.ratio());
    max = Math.max(max, p.ratio());
  }
  return { min, max, m0, m1: p.momentum() };
}

describe('shock travel limits (real Box2D distance-joint limits, S8a)', () => {
  it('the engine reports the limits it was given', async () => {
    const p = await softPair(true);
    const lim = p.w.getDistanceJointLimits(p.joint);
    expect(lim.enabled).toBe(true);
    expect(lim.minLength).toBeCloseTo(REST * SHOCK_MIN_RATIO, 5);
    expect(lim.maxLength).toBeCloseTo(REST * SHOCK_MAX_RATIO, 5);
    expect(p.w.getDistanceJointLength(p.joint)).toBeCloseTo(REST, 5);
    const q = await softPair(false);
    expect(q.w.getDistanceJointLimits(q.joint).enabled).toBe(false);
  });

  it('rejects an empty or non-positive range', async () => {
    const p = await softPair(false);
    const def = { bodyA: p.a, bodyB: p.b, anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: -2 } };
    expect(() => p.w.createDistanceJoint({ ...def, limits: { minLength: 0, maxLength: 1 } })).toThrow();
    expect(() => p.w.createDistanceJoint({ ...def, limits: { minLength: 2, maxLength: 1 } })).toThrow();
  });

  it('a pull past the max length is stopped there (soft joint alone overshoots far)', async () => {
    const free = await kicked(-5, false);
    const held = await kicked(-5, true);
    expect(free.max).toBeGreaterThan(SHOCK_MAX_RATIO + 0.3);
    // a hard constraint: sub-millimetre, not the emulation's 0.06 slack
    expect(held.max).toBeLessThan(SHOCK_MAX_RATIO + 0.005);
    // internal impulses only: linear momentum is conserved
    expect(held.m1.x).toBeCloseTo(held.m0.x, 3);
    expect(held.m1.y).toBeCloseTo(held.m0.y, 3);
  });

  it('a push past the min length is stopped there', async () => {
    const free = await kicked(5, false);
    const held = await kicked(5, true);
    expect(free.min).toBeLessThan(SHOCK_MIN_RATIO - 0.2);
    expect(held.min).toBeGreaterThan(SHOCK_MIN_RATIO - 0.005);
    expect(held.m1.y).toBeCloseTo(held.m0.y, 3);
  });

  it('inside the limits they do not act', async () => {
    const a = await kicked(-0.3, false);
    const b = await kicked(-0.3, true);
    expect(a.max).toBeLessThan(SHOCK_MAX_RATIO);
    expect(b.max).toBeCloseTo(a.max, 6);
    expect(b.min).toBeCloseTo(a.min, 6);
  });

  it('buildCompound gives every shock of a cart real limits at 0.8–1.15 × its rest length', async () => {
    const w = await PhysicsWorld.create();
    worlds.push(w);
    const spec = resolveAttachments(exampleCart());
    const cart = buildCompound(w, spec);
    const shocks = spec.joints.filter((j) => j.type === 'distance');
    expect(shocks.length).toBeGreaterThan(0);
    for (const j of shocks) {
      const lim = w.getDistanceJointLimits(cart.shockJoints.get(j.partId)!);
      expect(lim.enabled).toBe(true);
      expect(lim.minLength).toBeCloseTo(j.length * SHOCK_MIN_RATIO, 5);
      expect(lim.maxLength).toBeCloseTo(j.length * SHOCK_MAX_RATIO, 5);
    }
  });
});
