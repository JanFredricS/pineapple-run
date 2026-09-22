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
