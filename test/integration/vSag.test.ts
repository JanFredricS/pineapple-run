/**
 * S8a (backlog #4 residual, R19): the articulated cart's V-sag on the
 * workbench washboard.
 *
 * The playtest's articulated cart is two rigid halves joined ONLY by shocks
 * (research/s6t-playtest-backlog.md, "Carts"). Loaded with pineapples, the
 * halves could fold into a V at the shocks and belly on a washboard tooth
 * (seen at workbench 42 m). S8a gives the shocks real Box2D distance-joint
 * limits (0.8–1.15× rest) and the pineapple–wheel pair 0.3 friction.
 *
 * Both configurations run here on the same rig, loaded, at constant speeds
 * 2.5–6 m/s (measured):
 *   shipped (S8a):  shocks 0.78..1.18×, fold <= 11°, every speed crosses,
 *                   12–14 of 15 pineapples aboard on the washboard
 *   control (pre-S8a physics: limits switched off through the binding,
 *   pineapple–wheel back at the 0.9 mix):
 *                   shocks run to 1.25..1.47× at EVERY speed, and 5 m/s
 *                   sticks for good at x 46.5
 * (Box2D joints are slightly soft, so a hard landing shows up to ~3% give
 * past a limit — R21.)
 */
import { describe, expect, it } from 'vitest';
import { courseFor } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import { resolveAttachments, type DistanceJointSpec } from '../../src/model/attach';
import type { CartDesign } from '../../src/model/cart';
import { SHOCK_MAX_RATIO, SHOCK_MIN_RATIO } from '../../src/physics/compound';
import type { JointHandle, PhysicsWorld } from '../../src/physics/engine';
import { SURFACE } from '../../src/physics/surfaces';
import { PREMADE } from '../../tools/levels/premade';
import { paceDrive } from './driver';

/**
 * The playtest's articulated cart, rebuilt from its description: half A =
 * floor 40→112, rear wall, post, wheel at 40; half B = floor 122→194, front
 * wall, post, wheel at 194; joined only by three shocks (top, bottom,
 * diagonal) across the 10 px split.
 */
export function articulatedCart(): CartDesign {
  return {
    version: 1,
    parts: [
      { id: 'floorA', kind: 'straw', a: { x: 40, y: -25 }, b: { x: 112, y: -25 } },
      { id: 'wallA', kind: 'straw', a: { x: 40, y: -25 }, b: { x: 40, y: -85 } },
      { id: 'postA', kind: 'straw', a: { x: 105, y: -25 }, b: { x: 105, y: -75 } },
      { id: 'wheelA', kind: 'wheel', center: { x: 40, y: -25 }, radius: 25 },
      { id: 'floorB', kind: 'straw', a: { x: 122, y: -25 }, b: { x: 194, y: -25 } },
      { id: 'wallB', kind: 'straw', a: { x: 194, y: -25 }, b: { x: 194, y: -85 } },
      { id: 'postB', kind: 'straw', a: { x: 129, y: -25 }, b: { x: 129, y: -75 } },
      { id: 'wheelB', kind: 'wheel', center: { x: 194, y: -25 }, radius: 25 },
      { id: 'sTop', kind: 'shock', a: { x: 105, y: -75 }, b: { x: 129, y: -75 } },
      { id: 'sBot', kind: 'shock', a: { x: 110, y: -25 }, b: { x: 124, y: -25 } },
      { id: 'sDiag', kind: 'shock', a: { x: 105, y: -75 }, b: { x: 124, y: -25 } },
    ],
  };
}

const SPEEDS = [2.5, 3, 4, 4.5, 4.8, 5, 5.2, 5.5, 6];
/** Allowed give past a limit (Box2D's soft joint solver on hard landings). */
const GIVE = 0.04;
const MAX_FOLD_DEG = 15;
/** The funnel loads 15; the shipped runs keep 12–14 aboard across the washboard. */
const MIN_ABOARD = 10;

interface Crossing {
  maxX: number;
  minRatio: number;
  maxRatio: number;
  foldDeg: number;
  /** Fewest pineapples aboard (controller's aboard check) while on the washboard span. */
  minAboard: number;
}

/** Test-only: switch a distance joint's limit off through the raw binding (the control run). */
function disableLimit(world: PhysicsWorld, h: JointHandle): void {
  const raw = world as unknown as {
    b2: { b2DistanceJoint_EnableLimit(id: unknown, on: boolean): void };
    joint(h: JointHandle): { id: unknown };
  };
  raw.b2.b2DistanceJoint_EnableLimit(raw.joint(h).id, false);
}

/** Box2D's own pineapple–wheel mix before S8a: sqrtf(0.9f · 0.9f). */
const OLD_PAIR_FRICTION = Math.sqrt(Math.fround(Math.fround(0.9) * Math.fround(0.9)));

/**
 * `control` = the pre-S8a physics on the same rig: shock limits switched off
 * (spring only) and the pineapple–wheel pair back at the old 0.9 mix.
 */
async function crossWashboard(speed: number, board: { x0: number; x1: number }, control = false): Promise<Crossing> {
  const s = await RunSession.create(articulatedCart(), courseFor('workbench')!);
  try {
    const c = s.controller;
    const A = c.cart.bodies.get(c.spec.partBody.get('floorA')!)!;
    const B = c.cart.bodies.get(c.spec.partBody.get('floorB')!)!;
    const shocks = c.spec.joints.filter((j): j is DistanceJointSpec => j.type === 'distance');
    if (control) {
      for (const j of shocks) disableLimit(s.world, c.cart.shockJoints.get(j.partId)!);
      s.world.setPairFriction(SURFACE.pineapple, SURFACE.wheel, OLD_PAIR_FRICTION);
    }
    s.start();
    for (let i = 0; i < 60; i++) s.step();
    s.release();
    for (let i = 0; i < 180; i++) s.step();
    const rel = () => s.world.getTransform(B).angle - s.world.getTransform(A).angle;
    const rel0 = rel();
    const out: Crossing = { maxX: -Infinity, minRatio: Infinity, maxRatio: -Infinity, foldDeg: 0, minAboard: Infinity };
    // drive until the cart is well past the washboard (or 40 s)
    for (let n = 0; c.phase !== 'ended' && n < 40 * 60 && out.maxX < board.x1 + 5; n++) {
      s.setDrive(paceDrive(s, [{ x: 0, speed }]));
      s.step();
      expect(s.world.hasBody(A) && s.world.hasBody(B)).toBe(true);
      const x = s.world.getTransform(A).x;
      out.maxX = Math.max(out.maxX, x);
      if (x < board.x0 - 7 || x > board.x1 + 2) continue;
      out.minAboard = Math.min(out.minAboard, c.aboard);
      const d = rel() - rel0;
      out.foldDeg = Math.max(out.foldDeg, (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180) / Math.PI);
      for (const j of shocks) {
        const p = s.world.getJointAnchors(c.cart.shockJoints.get(j.partId)!);
        const r = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) / j.length;
        out.minRatio = Math.min(out.minRatio, r);
        out.maxRatio = Math.max(out.maxRatio, r);
      }
    }
    return out;
  } finally {
    s.destroy();
  }
}

describe('S8a: real shock limits stop the articulated V-sag on the workbench washboard', () => {
  it('the rebuilt articulated cart is valid: two rigid halves joined only by three shocks', () => {
    const spec = resolveAttachments(articulatedCart());
    expect(spec.errors).toEqual([]);
    expect(spec.partBody.get('floorA')).not.toBe(spec.partBody.get('floorB'));
    expect(spec.joints.filter((j) => j.type === 'distance')).toHaveLength(3);
    expect(spec.joints.filter((j) => j.type === 'revolute')).toHaveLength(2);
  });

  it('at every speed from 2.5 to 6 m/s the loaded halves stay within the limits and cross the washboard (x 37–56)', async () => {
    const board = PREMADE.workbench().features.find((f) => f.kind === 'washboard')!;
    expect(board.x0).toBeLessThan(42);
    expect(board.x1).toBeGreaterThan(42);
    for (const v of SPEEDS) {
      const r = await crossWashboard(v, board);
      const tag = `${v} m/s: shocks ${r.minRatio.toFixed(3)}..${r.maxRatio.toFixed(3)}, fold ${r.foldDeg.toFixed(1)}°, maxX ${r.maxX.toFixed(1)}`;
      expect(r.maxRatio, tag).toBeLessThan(SHOCK_MAX_RATIO + GIVE);
      expect(r.minRatio, tag).toBeGreaterThan(SHOCK_MIN_RATIO - GIVE);
      expect(r.foldDeg, tag).toBeLessThan(MAX_FOLD_DEG);
      // not bellied on a tooth: the rear half gets past the washboard
      expect(r.maxX, tag).toBeGreaterThan(board.x1 + 5);
      // and it crossed LOADED (an empty cart is lighter and would prove nothing)
      expect(r.minAboard, tag).toBeGreaterThanOrEqual(MIN_ABOARD);
    }
  }, 120_000);

  it('control: the same rig with the pre-S8a physics (no limits, 0.9 pineapple–wheel) overruns the limits and gets stuck', async () => {
    const board = PREMADE.workbench().features.find((f) => f.kind === 'washboard')!;
    let stuck = 0;
    for (const v of SPEEDS) {
      const r = await crossWashboard(v, board, true);
      const tag = `control ${v} m/s: shocks ${r.minRatio.toFixed(3)}..${r.maxRatio.toFixed(3)}, fold ${r.foldDeg.toFixed(1)}°, maxX ${r.maxX.toFixed(1)}`;
      // the rig is loaded here too, so the difference is the physics, not the load
      expect(r.minAboard, tag).toBeGreaterThanOrEqual(MIN_ABOARD);
      // without the limits the shocks run well past 1.15× at every speed (measured 1.25–1.47×)
      expect(r.maxRatio, tag).toBeGreaterThan(SHOCK_MAX_RATIO + GIVE);
      if (r.maxX <= board.x1 + 5) stuck++;
    }
    // and at least one speed bellies on the washboard for good (measured: 5 m/s, stuck at x 46.5)
    expect(stuck).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
