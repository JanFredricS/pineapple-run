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
