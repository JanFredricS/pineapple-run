/**
 * Crest rounding (S6T backlog #10). A single vertex where a climb meets a
 * drop (+30° into −40°) catches the bed of any long cart and leaves it
 * high-centred with its wheels in the air. Every sharp CREST — a convex
 * vertex where the slope (dy/dx, y-down) grows by more than
 * CREST_SLOPE_DELTA — is replaced by a short curve of about CREST_RADIUS
 * metres radius made of at least CREST_MIN_SEGMENTS segments.
 *
 * The curve is the quadratic Bézier through the two tangent points with the
 * old vertex as its control point: tangent to both neighbours, x-monotone,
 * and every chord's slope lies between the two original slopes, so any
 * per-segment slope limit the polyline met still holds. The tangent length
 * is R·tan(θ/2) for the turn angle θ (computed without trig from the unit
 * directions, so the endless generator stays bit-identical across engines)
 * and is capped at CREST_MAX_TANGENT_FRACTION of each neighbouring segment,
 * so neighbouring rounds never overlap and short features (step lips) just
 * get a smaller radius. Bigger slope jumps get more segments (up to
 * CREST_MAX_SEGMENTS), until no jump left exceeds ROUNDED_MAX_JUMP.
 *
 * Only interior vertices are touched: a polyline's end points (gap edges,
 * chunk connectors, walls) stay exactly where they are. Valleys (concave
 * vertices) are left alone: the wheels roll through them.
 */

import type { Vec2 } from '../model/geometry';

export const CREST_SLOPE_DELTA = 0.6;
export const CREST_RADIUS = 1.5;
export const CREST_MIN_SEGMENTS = 3;
export const CREST_MAX_TANGENT_FRACTION = 0.45;
export const CREST_MAX_SEGMENTS = 16;
/** Target: every slope jump left on a rounded crest is at most this (below CREST_SLOPE_DELTA). */
export const ROUNDED_MAX_JUMP = 0.5;

function bezier(p0: Vec2, v: Vec2, p1: Vec2, n: number): Vec2[] {
  const pts: Vec2[] = [p0];
  for (let j = 1; j < n; j++) {
    const s = j / n;
    const w0 = (1 - s) * (1 - s);
    const w1 = 2 * s * (1 - s);
    const w2 = s * s;
    pts.push({ x: w0 * p0.x + w1 * v.x + w2 * p1.x, y: w0 * p0.y + w1 * v.y + w2 * p1.y });
  }
  pts.push(p1);
  return pts;
}

function maxJump(pts: readonly Vec2[]): number {
  let worst = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    worst = Math.max(worst, (c.y - b.y) / (c.x - b.x) - (b.y - a.y) / (b.x - a.x));
  }
  return worst;
}

export interface RoundOptions {
  radius?: number;
  minDelta?: number;
  /** Vertices for which this returns true are kept sharp (e.g. a washboard's teeth). */
  keep?: (p: Vec2) => boolean;
  /** Applied to every NEW point (e.g. rounding to mm in the authoring DSL). */
  snap?: (p: Vec2) => Vec2;
}

/** True when the vertex b (between a and c) is a crest sharper than minDelta. */
export function isSharpCrest(a: Vec2, b: Vec2, c: Vec2, minDelta = CREST_SLOPE_DELTA): boolean {
  const dx1 = b.x - a.x;
  const dx2 = c.x - b.x;
  if (!(dx1 > 0 && dx2 > 0)) return false;
  return (c.y - b.y) / dx2 - (b.y - a.y) / dx1 > minDelta;
}

/** A copy of `points` with every sharp crest rounded (see the module doc). */
export function roundCrests(points: readonly Vec2[], opts: RoundOptions = {}): Vec2[] {
  const R = opts.radius ?? CREST_RADIUS;
  const minDelta = opts.minDelta ?? CREST_SLOPE_DELTA;
  const snap = opts.snap ?? ((p: Vec2) => p);
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const out: Vec2[] = [{ ...points[0]! }];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    if (!isSharpCrest(a, b, c, minDelta) || opts.keep?.(b)) {
      out.push({ ...b });
      continue;
    }
    const l1 = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
    const l2 = Math.sqrt((c.x - b.x) * (c.x - b.x) + (c.y - b.y) * (c.y - b.y));
    const u1 = { x: (b.x - a.x) / l1, y: (b.y - a.y) / l1 };
    const u2 = { x: (c.x - b.x) / l2, y: (c.y - b.y) / l2 };
    const cross = Math.abs(u1.x * u2.y - u1.y * u2.x);
    const dot = u1.x * u2.x + u1.y * u2.y;
    const tanHalf = cross / (1 + dot);
    const t = Math.min(R * tanHalf, CREST_MAX_TANGENT_FRACTION * l1, CREST_MAX_TANGENT_FRACTION * l2);
    const p0 = { x: b.x - u1.x * t, y: b.y - u1.y * t };
    const p1 = { x: b.x + u2.x * t, y: b.y + u2.y * t };
    // Enough segments that no slope jump left along the curve (including
    // where it meets the neighbours) exceeds ROUNDED_MAX_JUMP.
    let pts = bezier(p0, b, p1, CREST_MIN_SEGMENTS);
    for (let n = CREST_MIN_SEGMENTS + 1; n <= CREST_MAX_SEGMENTS && maxJump([a, ...pts, c]) > ROUNDED_MAX_JUMP; n++) pts = bezier(p0, b, p1, n);
    for (const p of pts) {
      const q = snap(p);
      const last = out[out.length - 1]!;
      if (q.x > last.x + 1e-6) out.push(q);
    }
  }
  const end = points[points.length - 1]!;
  const last = out[out.length - 1]!;
  if (!(end.x > last.x + 1e-6)) out.pop();
  out.push({ ...end });
  return out;
}

/** Largest crest slope jump left in a polyline (tests / the excitement audit). */
export function sharpestCrest(points: readonly Vec2[], keep?: (p: Vec2) => boolean): number {
  let worst = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    if (keep?.(b) || !(b.x > a.x && c.x > b.x)) continue;
    worst = Math.max(worst, (c.y - b.y) / (c.x - b.x) - (b.y - a.y) / (b.x - a.x));
  }
  return worst;
}
