/**
 * Scripted test driver: holds the pace-note target speed for the chassis x
 * (drive right below target, coast inside the band, brake well above it).
 */
import type { DriveDirection } from '../../src/physics/compound';
import type { RunSession } from '../../src/game/session';
import type { PaceNote } from '../../tools/levels/track';

export function targetSpeed(pace: readonly PaceNote[], x: number, fallback = 5): number {
  let v = pace[0]?.speed ?? fallback;
  for (const n of pace) if (x >= n.x) v = n.speed;
  return v;
}

export function paceDrive(s: RunSession, pace: readonly PaceNote[]): DriveDirection {
  const c = s.controller;
  if (c.cartLost) return 0;
  const h = c.cart.bodies.get(c.chassisId);
  if (h === undefined || !s.world.hasBody(h)) return 0;
  const x = s.world.getTransform(h).x;
  const vx = s.world.getLinearVelocity(h).x;
  const v = targetSpeed(pace, x);
  if (vx < v) return 1;
  if (vx > v + 1.5) return -1;
  return 0;
}

export interface DriveResult {
  steps: number;
  maxX: number;
}

/**
 * S6T #6: the reference expert line for the recovered original course (kept
 * vertex-exact): hold 9.3 m/s — fast enough to clear the launch lip at 82 m
 * and the dip behind it, slow enough not to cartwheel on the first hill —
 * and ease to 6 m/s for the last 55 m. Measured with the example cart:
 * 10/15 delivered, 37.9 s. The switch point is forgiving (6 m/s from
 * anywhere in 185–215 m, or 6.5 m/s from 200–215 m: 10 delivered), the
 * cruise speed is not: 9.3, 10.0 and 10.1 m/s finish with 10–11; 9.0–9.25,
 * 9.9 and 10.05 get stuck (the cart bellies at ~94 m or ~100 m). That knife
 * edge is why the course is labelled Bonus · Expert.
 *
 * S8a: the cruise was 9 m/s (10/15, 38.3 s) until the real shock limits and
 * the 0.3 pineapple–wheel friction; with them 9 m/s gets stuck at ~94 m, so
 * the line moved to the nearest cruise speed that finishes.
 */
export const ORIGINAL_EXPERT_LINE: readonly PaceNote[] = [
  { x: 0, speed: 9.3 },
  { x: 200, speed: 6 },
];

/** "Flooring it": a pace plan that never brakes (the player who just holds →). */
export const FLOOR_IT: readonly PaceNote[] = [{ x: -Infinity, speed: Infinity }];

/** Start, settle 1 s, Release, let the load drop 3 s, then drive by pace notes until the run ends. */
export function runWithPace(s: RunSession, pace: readonly PaceNote[], maxSeconds = 150): DriveResult {
  s.start();
  for (let i = 0; i < 60; i++) s.step();
  s.release();
  for (let i = 0; i < 180; i++) s.step();
  let maxX = -Infinity;
  let n = 0;
  for (; s.controller.phase !== 'ended' && n < maxSeconds * 60; n++) {
    s.setDrive(paceDrive(s, pace));
    s.step();
    const r = s.controller.rightmostCartBody();
    if (r) maxX = Math.max(maxX, r.x);
  }
  return { steps: n, maxX };
}
