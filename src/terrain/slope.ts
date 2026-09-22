/**
 * Slope clamping for generated terrain (pure).
 *
 * Constraint for every segment (y-down, driving left -> right):
 *   rising  (dy < 0): -dy/dx <= maxUp
 *   falling (dy > 0):  dy/dx <= maxDown
 * Limits may vary along x (the difficulty ramp), so they are functions of
 * the segment's left x.
 *
 * Endpoints may be PINNED (block connectors must meet the neighbouring block
 * exactly). With pins the problem is: find heights inside the feasible band
 * that stay as close to the input as a single greedy pass allows. We compute
 * the band each point can occupy given the pins ("reachable from the left pin
 * AND able to reach the right pin"), then sweep left -> right clamping each
 * point into band ∩ [cone from the previous (final) point]. If the band is
 * non-empty everywhere (pins mutually reachable) that intersection is never
 * empty, so every segment satisfies the constraint afterwards. Returns false
 * (and leaves the input unchanged) if the pins are infeasible.
 */

import type { Vec2 } from '../model/geometry';

export interface SlopeLimits {
  maxUp(x: number): number;
  maxDown(x: number): number;
}

export function clampSlopes(points: Vec2[], limits: SlopeLimits, pinFirst: boolean, pinLast: boolean): boolean {
  const n = points.length;
  if (n < 2) return true;
  // Band from the left pin (forward reachability).
  const lo = new Array<number>(n).fill(-Infinity);
  const hi = new Array<number>(n).fill(Infinity);
  if (pinFirst) {
    lo[0] = hi[0] = points[0]!.y;
    for (let i = 1; i < n; i++) {
      const dx = points[i]!.x - points[i - 1]!.x;
      const x = points[i - 1]!.x;
      lo[i] = lo[i - 1]! - limits.maxUp(x) * dx;
      hi[i] = hi[i - 1]! + limits.maxDown(x) * dx;
    }
  }
  if (pinLast) {
    // Backward reachability from the right pin.
    let bl = points[n - 1]!.y;
    let bh = points[n - 1]!.y;
    lo[n - 1] = Math.max(lo[n - 1]!, bl);
    hi[n - 1] = Math.min(hi[n - 1]!, bh);
    for (let i = n - 2; i >= 0; i--) {
      const dx = points[i + 1]!.x - points[i]!.x;
      const x = points[i]!.x;
      // y[i+1] - y[i] in [-maxUp dx, maxDown dx]  =>  y[i] in [y[i+1] - maxDown dx, y[i+1] + maxUp dx]
      bl = bl - limits.maxDown(x) * dx;
      bh = bh + limits.maxUp(x) * dx;
      lo[i] = Math.max(lo[i]!, bl);
      hi[i] = Math.min(hi[i]!, bh);
    }
  }
  for (let i = 0; i < n; i++) if (!(lo[i]! <= hi[i]!)) return false;

  const ys = points.map((p) => p.y);
  ys[0] = Math.min(hi[0]!, Math.max(lo[0]!, ys[0]!));
  for (let i = 1; i < n; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const x = points[i - 1]!.x;
    const cLo = Math.max(lo[i]!, ys[i - 1]! - limits.maxUp(x) * dx);
    const cHi = Math.min(hi[i]!, ys[i - 1]! + limits.maxDown(x) * dx);
    ys[i] = Math.min(cHi, Math.max(cLo, ys[i]!));
  }
  for (let i = 0; i < n; i++) points[i]!.y = ys[i]!;
  return true;
}

/** Largest violation of the limits (0 if none) — for tests and asserts. */
export function maxSlopeViolation(points: readonly Vec2[], limits: SlopeLimits): number {
  let worst = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const s = (b.y - a.y) / (b.x - a.x);
    worst = Math.max(worst, -s - limits.maxUp(a.x), s - limits.maxDown(a.x));
  }
  return worst;
}
