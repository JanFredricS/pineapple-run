/**
 * Shock travel limits keep working on a DAMAGED cart (S6T audit-1 #2,
 * re-pinned in S8a).
 *
 * Once any non-chassis body crosses the kill plane the controller drives the
 * surviving wheels itself (compound.preStep would touch removed bodies). In
 * S6T the limits were emulated bump stops run from preStep, so that branch
 * had to call CartInstance.applyShockStops explicitly (the audit found it
 * did not). Since S8a the limits are real Box2D distance-joint limits: they
 * live in the solver and hold whatever the controller does. Scenario: the
 * example cart loses its left wheel over the kill plane and keeps driving on
 * the right one.
 *
 *  1. The surviving shocks still report their 0.8–1.15× limits.
 *  2. Plain driving: the surviving shocks stay inside the limits.
 *  3. Abuse: every 0.5 s the surviving wheel is kicked 14 m/s away from the
 *     chassis, then shoved 14 m/s into it for 5 steps (its velocity is
 *     OVERWRITTEN each of those steps, which no constraint can fully undo
 *     within the step). The shocks must stay within OVERSHOOT of the limits
 *     and do measurably better than a control run with the survivors'
 *     limits switched off (spring only). Measured worst ratio: 1.23 with
 *     the limits, 1.28 without (S6T's emulated stops: 1.25). Plain driving
 *     peaks at 1.07.
 */
import { describe, expect, it } from 'vitest';
import { exampleCart } from '../../src/builder/exampleCart';
import { courseFor } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import { SHOCK_MAX_RATIO, SHOCK_MIN_RATIO } from '../../src/physics/compound';
import type { DistanceJointSpec } from '../../src/model/attach';
import type { BodyHandle, JointHandle, PhysicsWorld } from '../../src/physics/engine';

/** Test-only teleport through the raw binding (PhysicsWorld has no setTransform by design). */
function teleport(world: PhysicsWorld, h: BodyHandle, x: number, y: number): void {
  const raw = world as unknown as {
    b2: { b2Body_SetTransform(id: unknown, p: unknown, q: unknown): void; b2Vec2: new (x: number, y: number) => { delete(): void }; b2MakeRot(a: number): { delete(): void } };
    body(h: BodyHandle): { id: unknown };
  };
  const p = new raw.b2.b2Vec2(x, y);
  const q = raw.b2.b2MakeRot(0);
  raw.b2.b2Body_SetTransform(raw.body(h).id, p, q);
  p.delete();
  q.delete();
  world.setLinearVelocity(h, { x: 0, y: 0 });
}

/** Test-only: switch a distance joint's limit off through the raw binding (the control run). */
function disableLimit(world: PhysicsWorld, h: JointHandle): void {
  const raw = world as unknown as {
    b2: { b2DistanceJoint_EnableLimit(id: unknown, on: boolean): void };
    joint(h: JointHandle): { id: unknown };
  };
  raw.b2.b2DistanceJoint_EnableLimit(raw.joint(h).id, false);
}

/** Allowed overshoot past a limit under abuse (the same bar the emulated stops had). */
const OVERSHOOT = 0.1;

interface Outcome {
  plain: { min: number; max: number };
  abused: { min: number; max: number };
  limits: Array<{ enabled: boolean; min: number; max: number }>;
}

/** The scenario. `limitsOn = false` is the control: the survivors' limits are switched off (spring only). */
async function damagedRun(limitsOn: boolean): Promise<Outcome> {
  const s = await RunSession.create(exampleCart(), courseFor('beach')!);
  try {
    const c = s.controller;
    const bodyOf = (part: string) => c.cart.bodies.get(c.spec.partBody.get(part)!)!;
    const lost = bodyOf('wheel-l');
    const kept = bodyOf('wheel-r');
    const chassis = c.cart.bodies.get(c.chassisId)!;
    const survivors = c.spec.joints.filter((j): j is DistanceJointSpec => j.type === 'distance' && (j.partId === 'shock-r1' || j.partId === 'shock-r2'));
    expect(survivors).toHaveLength(2);
    const ratios = () =>
      survivors.map((j) => {
        const p = s.world.getJointAnchors(c.cart.shockJoints.get(j.partId)!);
        return Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) / j.length;
      });

    s.start();
    for (let i = 0; i < 60; i++) s.step();
    s.release();
    for (let i = 0; i < 120; i++) s.step();

    // lose the left wheel: its shocks go with it (Box2D removes a body's joints)
    for (const id of ['shock-l1', 'shock-l2']) s.world.destroyJoint(c.cart.shockJoints.get(id)!);
    teleport(s.world, lost, s.world.getTransform(lost).x, c.level.killY + 5);
    s.step();
    expect(s.world.hasBody(lost)).toBe(false);
    expect(c.cartDamaged).toBe(true);
    expect(c.cartLost).toBe(false);
    expect(s.world.hasBody(kept)).toBe(true);

    if (!limitsOn) for (const j of survivors) disableLimit(s.world, c.cart.shockJoints.get(j.partId)!);
    const limits = survivors.map((j) => {
      const l = s.world.getDistanceJointLimits(c.cart.shockJoints.get(j.partId)!);
      return { enabled: l.enabled, min: l.minLength / j.length, max: l.maxLength / j.length };
    });
    const run = (n: number, perturb: (i: number) => void) => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < n; i++) {
        s.setDrive(1);
        perturb(i);
        s.step();
        expect(c.phase).toBe('released');
        for (const r of ratios()) {
          min = Math.min(min, r);
          max = Math.max(max, r);
        }
      }
      return { min, max };
    };
    const plain = run(60 * 10, () => {});
    // abuse: kick the surviving wheel away, then shove it in for 5 steps, every 0.5 s
    const abused = run(60 * 6, (i) => {
      if (i % 30 >= 6) return;
      const cv = s.world.getLinearVelocity(chassis);
      s.world.setLinearVelocity(kept, { x: cv.x, y: cv.y + (i % 30 === 0 ? 14 : -14) });
    });
    return { plain, abused, limits };
  } finally {
    s.destroy();
  }
}

describe('S6T audit-1 #2 / S8a: shock limits on a damaged cart', () => {
  it('after losing a wheel over the kill plane, the surviving shocks keep their 0.8–1.15× travel limits while driving', async () => {
    const on = await damagedRun(true);
    const off = await damagedRun(false);
    // 1. the surviving shocks still carry their real Box2D limits
    for (const l of on.limits) {
      expect(l.enabled).toBe(true);
      expect(l.min).toBeCloseTo(SHOCK_MIN_RATIO, 5);
      expect(l.max).toBeCloseTo(SHOCK_MAX_RATIO, 5);
    }
    // 2. plain one-wheel driving stays inside the limits
    expect(on.plain.max).toBeLessThanOrEqual(SHOCK_MAX_RATIO + 0.005);
    expect(on.plain.min).toBeGreaterThanOrEqual(SHOCK_MIN_RATIO - 0.005);
    // 3. under abuse the limits hold the shocks near their bounds, and
    //    measurably better than the spring alone (the control run)
    expect(on.abused.max).toBeLessThan(SHOCK_MAX_RATIO + OVERSHOOT);
    expect(on.abused.min).toBeGreaterThan(SHOCK_MIN_RATIO - OVERSHOOT);
    expect(off.limits.every((l) => !l.enabled)).toBe(true);
    const excess = (o: Outcome) => Math.max(0, o.abused.max - SHOCK_MAX_RATIO) + Math.max(0, SHOCK_MIN_RATIO - o.abused.min);
    expect(excess(on)).toBeLessThan(excess(off));
  });
});
