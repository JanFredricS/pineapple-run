/**
 * Pure run-phase geometry: goal-sensor overlap, cart bounds and the
 * "aboard" box (PLAN.md "Endless mode rules": aboard = within the cart's
 * bounding box + margin).
 */

import type { ShapeSpec } from '../model/attach';
import type { AABB, Vec2 } from '../model/geometry';
import type { Rect } from '../model/level';

/** True when a circle overlaps (or touches) an axis-aligned rect (y-down, x/y = top-left). */
export function circleTouchesRect(c: Vec2, radius: number, r: Rect): boolean {
  const qx = Math.min(Math.max(c.x, r.x), r.x + r.width);
  const qy = Math.min(Math.max(c.y, r.y), r.y + r.height);
  return Math.hypot(c.x - qx, c.y - qy) <= radius;
}

export interface Pose {
  x: number;
  y: number;
  angle: number;
}

/** World AABB of body-local shapes at a pose; null when there are no shapes. */
export function shapesWorldAABB(shapes: readonly ShapeSpec[], pose: Pose): AABB | null {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  let box: AABB | null = null;
  const add = (x: number, y: number, r: number) => {
    const wx = pose.x + c * x - s * y;
    const wy = pose.y + s * x + c * y;
    if (!box) box = { minX: wx - r, minY: wy - r, maxX: wx + r, maxY: wy + r };
    else {
      box.minX = Math.min(box.minX, wx - r);
      box.minY = Math.min(box.minY, wy - r);
      box.maxX = Math.max(box.maxX, wx + r);
      box.maxY = Math.max(box.maxY, wy + r);
    }
  };
  for (const sh of shapes) {
    if (sh.type === 'circle') add(sh.center.x, sh.center.y, sh.radius);
    else for (const v of sh.vertices) add(v.x, v.y, 0);
  }
  return box;
}

export function unionBoxes(boxes: ReadonlyArray<AABB | null>): AABB | null {
  let out: AABB | null = null;
  for (const b of boxes) {
    if (!b) continue;
    out = out
      ? { minX: Math.min(out.minX, b.minX), minY: Math.min(out.minY, b.minY), maxX: Math.max(out.maxX, b.maxX), maxY: Math.max(out.maxY, b.maxY) }
      : { ...b };
  }
  return out;
}

export interface AboardMargin {
  /** Added left and right of the cart bounds, metres. */
  side: number;
  /** Added above the cart bounds (room for a piled load), metres. */
  top: number;
  /** Added below the cart bounds, metres. */
  bottom: number;
}

export function expandBox(b: AABB, m: AboardMargin): AABB {
  return { minX: b.minX - m.side, maxX: b.maxX + m.side, minY: b.minY - m.top, maxY: b.maxY + m.bottom };
}

export function pointInBox(p: Vec2, b: AABB): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/** Distance from point p to segment ab. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when segment ab passes through (or touches) the rect (Liang–Barsky slab test). */
export function segmentIntersectsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const d = { x: b.x - a.x, y: b.y - a.y };
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-d.x, a.x - r.x) && clip(d.x, r.x + r.width - a.x) && clip(-d.y, a.y - r.y) && clip(d.y, r.y + r.height - a.y) && t0 <= t1
  );
}

/**
 * Swept circle test: does a circle of `radius` moving in a straight line from
 * `from` to `to` touch the rect at any point along the way? Exact (the swept
 * circle is a capsule; capsule ∩ rect ⇔ distance(segment, rect) ≤ radius).
 */
export function sweptCircleTouchesRect(from: Vec2, to: Vec2, radius: number, r: Rect): boolean {
  if (segmentIntersectsRect(from, to, r)) return true;
  if (circleTouchesRect(from, radius, r) || circleTouchesRect(to, radius, r)) return true;
  // otherwise the closest approach is between a rect corner and the segment
  const corners: Vec2[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  return corners.some((c) => pointSegmentDistance(c, from, to) <= radius);
}

/** True when a circle overlaps (or is within `slop` of) a convex polygon given in world coordinates. */
export function circleTouchesPolygon(c: Vec2, radius: number, poly: readonly Vec2[], slop = 0): boolean {
  let inside = true;
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (pointSegmentDistance(c, a, b) <= radius + slop) return true;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) inside = false;
    }
  }
  return inside;
}

/** Corners of a w×h box centred at `center`, rotated by `angle` (y-down, radians). */
export function boxPolygon(center: Vec2, size: Vec2, angle = 0): Vec2[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hx = size.x / 2;
  const hy = size.y / 2;
  return [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ].map(([x, y]) => ({ x: center.x + c * x! - s * y!, y: center.y + s * x! + c * y! }));
}
