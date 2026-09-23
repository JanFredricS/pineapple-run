/**
 * S8a (backlog #4 residual, R19): the articulated cart's V-sag on the
 * workbench washboard.
 *
 * The playtest's articulated cart is two rigid halves joined ONLY by shocks
 * (research/s6t-playtest-backlog.md, "Carts"). Loaded with pineapples, the
 * halves could fold into a V at the shocks and belly on a washboard tooth
 * (seen at workbench 42 m). S6T's emulated bump stops (velocity-level, one
 * step late, one shock at a time) let the shocks run to 1.3–1.36× rest on
 * this washboard; at a constant 5 m/s the cart stuck for good at x 42.6 —
 * the playtest's failure, reproduced. Real Box2D distance-joint limits hold
 * every shock at 0.8–1.15× inside the solver.
 *
 * Measured on this rig (constant speeds 2.5–6 m/s):
 *   S6T emulated stops: shocks 0.75..1.36× rest, 5 m/s stuck at 42.6 m
 *   spring only:        shocks 0.44..1.38×, 5 m/s folded 36.5°
 *   real limits (S8a):  shocks 0.79..1.18×, fold <= 11°, every speed clears
 *                       the washboard
 * (Box2D joints are slightly soft, so a hard landing shows up to ~3% give
 * past a limit.) The limits alone hold the shocks; the 0.3 pineapple–wheel
 * friction (backlog #9) is what lets every speed through: with real limits
 * but the old 0.9 friction, 3 m/s still stalls at x 50.7 (the load brakes
 * a wheel).
 */
import { describe, expect, it } from 'vitest';
import { courseFor } from '../../src/game/courses';
import { RunSession } from '../../src/game/session';
import { resolveAttachments, type DistanceJointSpec } from '../../src/model/attach';
import type { CartDesign } from '../../src/model/cart';
import { SHOCK_MAX_RATIO, SHOCK_MIN_RATIO } from '../../src/physics/compound';
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

interface Crossing {
  maxX: number;
  minRatio: number;
  maxRatio: number;
  foldDeg: number;
}

async function crossWashboard(speed: number, board: { x0: number; x1: number }): Promise<Crossing> {
  const s = await RunSession.create(articulatedCart(), courseFor('workbench')!);
  try {
    const c = s.controller;
    const A = c.cart.bodies.get(c.spec.partBody.get('floorA')!)!;
    const B = c.cart.bodies.get(c.spec.partBody.get('floorB')!)!;
    const shocks = c.spec.joints.filter((j): j is DistanceJointSpec => j.type === 'distance');
    s.start();
    for (let i = 0; i < 60; i++) s.step();
    s.release();
    for (let i = 0; i < 180; i++) s.step();
    const rel = () => s.world.getTransform(B).angle - s.world.getTransform(A).angle;
    const rel0 = rel();
    const out: Crossing = { maxX: -Infinity, minRatio: Infinity, maxRatio: -Infinity, foldDeg: 0 };
    // drive until the cart is well past the washboard (or 40 s)
    for (let n = 0; c.phase !== 'ended' && n < 40 * 60 && out.maxX < board.x1 + 5; n++) {
      s.setDrive(paceDrive(s, [{ x: 0, speed }]));
      s.step();
      expect(s.world.hasBody(A) && s.world.hasBody(B)).toBe(true);
      const x = s.world.getTransform(A).x;
      out.maxX = Math.max(out.maxX, x);
      if (x < board.x0 - 7 || x > board.x1 + 2) continue;
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
    }
  }, 120_000);
});
