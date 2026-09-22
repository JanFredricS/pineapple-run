/**
 * Minimal pure 2D geometry used by the model layer (attachment resolution,
 * validation). No dependencies. Coordinates are y-down (screen convention),
 * matching the physics world where gravity is (0, +10).
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const rotate = (p: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
};

/** A convex polygon (vertices in order) or a circle. */
export type Convex =
  | { type: 'polygon'; vertices: Vec2[] }
  | { type: 'circle'; center: Vec2; radius: number };

/** Oriented rectangle as 4 vertices. */
export function orientedBox(center: Vec2, halfW: number, halfH: number, angle: number): Vec2[] {
  const corners: Vec2[] = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  return corners.map((c) => add(center, rotate(c, angle)));
}

/** A segment thickened into a rectangle (thickness = full width). */
export function thickSegment(a: Vec2, b: Vec2, thickness: number): Vec2[] {
  const d = sub(b, a);
  const len = length(d);
  const center = scale(add(a, b), 0.5);
  const angle = Math.atan2(d.y, d.x);
  // Extend the straw by half its thickness at each end so that two straws
  // that merely share an endpoint do overlap (as a drawn line with a round
  // brush would).
  return orientedBox(center, len / 2 + thickness / 2, thickness / 2, angle);
}

function projectPolygon(vertices: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of vertices) {
    const p = dot(v, axis);
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}

function polygonAxes(vertices: Vec2[]): Vec2[] {
  const axes: Vec2[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    const e = sub(b, a);
    const len = length(e);
    if (len > 1e-12) axes.push({ x: -e.y / len, y: e.x / len });
  }
  return axes;
}

/** Closest point on segment ab to p. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 < 1e-12) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return add(a, scale(ab, t));
}

export function pointInPolygon(p: Vec2, vertices: Vec2[], eps = 1e-9): boolean {
  // Convex polygon: p must be on the same side of every edge.
  let sign = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    const c = cross(sub(b, a), sub(p, a));
    if (Math.abs(c) <= eps) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function distanceToPolygonBoundary(p: Vec2, vertices: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const q = closestPointOnSegment(p, vertices[i]!, vertices[(i + 1) % vertices.length]!);
    best = Math.min(best, distance(p, q));
  }
  return best;
}

export function pointInConvex(p: Vec2, shape: Convex): boolean {
  if (shape.type === 'circle') return distance(p, shape.center) <= shape.radius;
  return pointInPolygon(p, shape.vertices);
}

/**
 * True when the two convex shapes overlap or touch (within `eps`).
 * Separating-axis test for polygons, closest-point tests for circles.
 */
export function convexOverlap(a: Convex, b: Convex, eps = 1e-6): boolean {
  if (a.type === 'circle' && b.type === 'circle') {
    return distance(a.center, b.center) <= a.radius + b.radius + eps;
  }
  if (a.type === 'circle' || b.type === 'circle') {
    const circle = (a.type === 'circle' ? a : b) as Extract<Convex, { type: 'circle' }>;
    const poly = (a.type === 'polygon' ? a : b) as Extract<Convex, { type: 'polygon' }>;
    if (pointInPolygon(circle.center, poly.vertices)) return true;
    return distanceToPolygonBoundary(circle.center, poly.vertices) <= circle.radius + eps;
  }
  for (const axis of [...polygonAxes(a.vertices), ...polygonAxes(b.vertices)]) {
    const [aMin, aMax] = projectPolygon(a.vertices, axis);
    const [bMin, bMax] = projectPolygon(b.vertices, axis);
    if (aMax < bMin - eps || bMax < aMin - eps) return false;
  }
  return true;
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function convexAABB(shape: Convex): AABB {
  if (shape.type === 'circle') {
    return {
      minX: shape.center.x - shape.radius,
      minY: shape.center.y - shape.radius,
      maxX: shape.center.x + shape.radius,
      maxY: shape.center.y + shape.radius,
    };
  }
  const xs = shape.vertices.map((v) => v.x);
  const ys = shape.vertices.map((v) => v.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function unionAABB(a: AABB, b: AABB): AABB {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function polygonArea(vertices: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < vertices.length; i++) {
    a += cross(vertices[i]!, vertices[(i + 1) % vertices.length]!);
  }
  return Math.abs(a) / 2;
}
