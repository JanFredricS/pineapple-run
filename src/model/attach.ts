/**
 * resolveAttachments(CartDesign) -> CompoundSpec  (S0 contract 2)
 *
 * The ONE place that decides how a drawn cart becomes rigid bodies and joints.
 * Used by the builder's live weld preview (S2) and by physics construction
 * (physics/compound.ts), so what you see welded is what gets welded.
 *
 * Geometry rules (from PLAN.md / the original's ShapeCombiner):
 *  1. Straws, cubes and limes that overlap (or touch) are welded into ONE
 *     rigid body with several shapes. Welding is transitive.
 *  2. A powered wheel never welds. If its centre lies over other parts it is
 *     pinned (revolute joint at its centre) to the TOPMOST such part, i.e. the
 *     most recently drawn one (highest index in `parts`). Otherwise it is a
 *     free body.
 *  3. Each shock end: if within SHOCK_SNAP_PX of a wheel/lime centre, it
 *     snaps to that centre (nearest wins; ties -> topmost) and attaches to that
 *     part's body. Else it attaches to the topmost part overlapping the end
 *     point. Else the shock is invalid (floatingShock).
 *  4. Deleting a part = re-running this function on the edited design; there
 *     is no incremental state.
 *  5. Enumerated validation errors (AttachmentErrorCode).
 *
 * Pure: no Pixi, no physics imports. Input in design px, output in metres.
 */

import {
  CartDesign,
  CartPart,
  MIN_CUBE_SIZE_PX,
  MIN_PART_SIZE_PX,
  SHOCK_SNAP_PX,
  STRAW_THICKNESS_PX,
} from './cart';
import {
  AABB,
  Convex,
  Vec2,
  convexAABB,
  convexOverlap,
  distance,
  orientedBox,
  pointInConvex,
  thickSegment,
  unionAABB,
} from './geometry';
import { PX_PER_M } from './coords';

export const COMPOUND_SPEC_VERSION = 1 as const;

/** Shape in body-local metres. */
export type ShapeSpec =
  | { type: 'polygon'; partId: string; vertices: Vec2[] }
  | { type: 'circle'; partId: string; center: Vec2; radius: number };

export type BodyKind = 'rigid' | 'wheel';

export interface BodySpec {
  /** Stable id: "body:<id of the oldest part in it>". */
  id: string;
  kind: BodyKind;
  /** Powered wheels get motors in physics. */
  powered: boolean;
  /** Parts welded into this body, in draw order. */
  partIds: string[];
  /** Body origin in design-frame metres (y-down). */
  origin: Vec2;
  /** Shapes relative to `origin`, metres. */
  shapes: ShapeSpec[];
}

export interface RevoluteJointSpec {
  type: 'revolute';
  /** The wheel part that created this pin. */
  partId: string;
  /** Body the wheel is pinned to. */
  bodyA: string;
  /** The wheel body. */
  bodyB: string;
  /** Pin point (the wheel centre), design-frame metres. */
  anchor: Vec2;
  powered: boolean;
}

export interface DistanceJointSpec {
  type: 'distance';
  /** The shock part. */
  partId: string;
  bodyA: string;
  bodyB: string;
  /** Resolved (possibly snapped) end points, design-frame metres. */
  anchorA: Vec2;
  anchorB: Vec2;
  /** Rest length, metres. */
  length: number;
}

export type JointSpec = RevoluteJointSpec | DistanceJointSpec;

export type AttachmentErrorCode =
  | 'noWheels'
  | 'floatingShock'
  | 'disconnectedIslands'
  | 'shockSameBody'
  | 'partTooSmall';

export type AttachmentError =
  | { code: 'noWheels' }
  | { code: 'floatingShock'; partId: string; ends: Array<'a' | 'b'> }
  | { code: 'disconnectedIslands'; islands: string[][] }
  | { code: 'shockSameBody'; partId: string }
  | { code: 'partTooSmall'; partId: string };

/** Per-shock resolution in DESIGN PX, for the builder preview. */
export interface ShockEndResolution {
  /** Resolved point (snapped to a centre if within range), design px. */
  point: Vec2;
  /** Body this end attaches to, or null if floating. */
  bodyId: string | null;
  /** Part the end attached to, or null if floating. */
  partId: string | null;
  snapped: boolean;
}

export interface CompoundSpec {
  version: typeof COMPOUND_SPEC_VERSION;
  bodies: BodySpec[];
  joints: JointSpec[];
  /**
   * partId -> bodyId for every non-shock part. Maps (not plain objects) so
   * user-supplied part ids such as "__proto__" are ordinary keys.
   */
  partBody: Map<string, string>;
  /** wheel partId -> partId it is pinned to (null = free wheel). */
  wheelPins: Map<string, string | null>;
  shockEnds: Map<string, { a: ShockEndResolution; b: ShockEndResolution }>;
  errors: AttachmentError[];
  /** True when `errors` is empty (the cart may be started). */
  valid: boolean;
}

/** Collision shape of a part in design px (the shape used for overlap rules). */
export function partShapePx(part: Exclude<CartPart, { kind: 'shock' }>): Convex {
  switch (part.kind) {
    case 'straw':
      return { type: 'polygon', vertices: thickSegment(part.a, part.b, STRAW_THICKNESS_PX) };
    case 'cube':
      return {
        type: 'polygon',
        vertices: orientedBox(part.center, part.width / 2, part.height / 2, part.angle),
      };
    case 'lime':
    case 'wheel':
      return { type: 'circle', center: part.center, radius: part.radius };
  }
}

function isTooSmall(part: CartPart): boolean {
  switch (part.kind) {
    case 'straw':
    case 'shock':
      return distance(part.a, part.b) < MIN_PART_SIZE_PX;
    case 'cube':
      return part.width < MIN_CUBE_SIZE_PX || part.height < MIN_CUBE_SIZE_PX;
    case 'lime':
    case 'wheel':
      return part.radius < MIN_PART_SIZE_PX;
  }
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r]!;
    // path compression
    let c = i;
    while (this.parent[c] !== r) {
      const next = this.parent[c]!;
      this.parent[c] = r;
      c = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // keep the lower index as root so ordering is deterministic
    if (ra < rb) this.parent[rb] = ra;
    else this.parent[ra] = rb;
  }
}

function aabbOverlap(a: AABB, b: AABB, eps = 1e-6): boolean {
  return a.minX <= b.maxX + eps && b.minX <= a.maxX + eps && a.minY <= b.maxY + eps && b.minY <= a.maxY + eps;
}

const toM = (v: Vec2): Vec2 => ({ x: v.x / PX_PER_M, y: v.y / PX_PER_M });

export function resolveAttachments(design: CartDesign): CompoundSpec {
  const parts = design.parts;
  const errors: AttachmentError[] = [];

  for (const p of parts) {
    if (isTooSmall(p)) errors.push({ code: 'partTooSmall', partId: p.id });
  }

  // Shapes for every non-shock part, indexed like `parts` (undefined for shocks).
  const shapes: Array<Convex | undefined> = parts.map((p) => (p.kind === 'shock' ? undefined : partShapePx(p)));
  const boxes: Array<AABB | undefined> = shapes.map((s) => (s ? convexAABB(s) : undefined));

  // --- 1. Welding ---------------------------------------------------------
  const uf = new UnionFind(parts.length);
  const weldable = (p: CartPart) => p.kind === 'straw' || p.kind === 'cube' || p.kind === 'lime';
  for (let i = 0; i < parts.length; i++) {
    if (!weldable(parts[i]!)) continue;
    for (let j = i + 1; j < parts.length; j++) {
      if (!weldable(parts[j]!)) continue;
      if (!aabbOverlap(boxes[i]!, boxes[j]!)) continue;
      if (convexOverlap(shapes[i]!, shapes[j]!)) uf.union(i, j);
    }
  }

  // Group non-shock parts into bodies. Wheels are always their own body.
  const groupOf = new Map<number, number[]>(); // root index -> member indices
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.kind === 'shock') continue;
    const root = p.kind === 'wheel' ? i : uf.find(i);
    const g = groupOf.get(root);
    if (g) g.push(i);
    else groupOf.set(root, [i]);
  }
  const groups = [...groupOf.values()].sort((a, b) => a[0]! - b[0]!);

  const partBody = new Map<string, string>();
  const bodies: BodySpec[] = groups.map((members) => {
    const first = parts[members[0]!]!;
    const id = `body:${first.id}`;
    let box = boxes[members[0]!]!;
    for (const m of members) box = unionAABB(box, boxes[m]!);
    const originPx = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const origin = toM(originPx);
    const shapesM: ShapeSpec[] = members.map((m) => {
      const s = shapes[m]!;
      const partId = parts[m]!.id;
      if (s.type === 'circle') {
        return { type: 'circle', partId, center: toM({ x: s.center.x - originPx.x, y: s.center.y - originPx.y }), radius: s.radius / PX_PER_M };
      }
      return {
        type: 'polygon',
        partId,
        vertices: s.vertices.map((v) => toM({ x: v.x - originPx.x, y: v.y - originPx.y })),
      };
    });
    for (const m of members) partBody.set(parts[m]!.id, id);
    const isWheel = first.kind === 'wheel';
    return {
      id,
      kind: isWheel ? 'wheel' : 'rigid',
      powered: isWheel,
      partIds: members.map((m) => parts[m]!.id),
      origin,
      shapes: shapesM,
    };
  });

  // Topmost non-shock part (other than `exclude`) whose shape contains p.
  const topmostAt = (p: Vec2, exclude: number): number => {
    for (let i = parts.length - 1; i >= 0; i--) {
      if (i === exclude) continue;
      const s = shapes[i];
      if (s && pointInConvex(p, s)) return i;
    }
    return -1;
  };

  const joints: JointSpec[] = [];
  const edges: Array<[string, string]> = [];

  // --- 2. Wheel pins ------------------------------------------------------
  const wheelPins = new Map<string, string | null>();
  for (let i = 0; i < parts.length; i++) {
    const w = parts[i]!;
    if (w.kind !== 'wheel') continue;
    const target = topmostAt(w.center, i);
    if (target < 0) {
      wheelPins.set(w.id, null);
      continue;
    }
    const targetPart = parts[target]!;
    wheelPins.set(w.id, targetPart.id);
    const bodyA = partBody.get(targetPart.id)!;
    const bodyB = partBody.get(w.id)!;
    joints.push({ type: 'revolute', partId: w.id, bodyA, bodyB, anchor: toM(w.center), powered: true });
    edges.push([bodyA, bodyB]);
  }

  // --- 3. Shocks ----------------------------------------------------------
  const shockEnds: CompoundSpec['shockEnds'] = new Map();
  const resolveEnd = (p: Vec2, shockIndex: number): ShockEndResolution => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const c = parts[i]!;
      if (c.kind !== 'wheel' && c.kind !== 'lime') continue;
      const d = distance(p, c.center);
      // `<=` with ascending i: equal distances resolve to the topmost part.
      if (d <= SHOCK_SNAP_PX && d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best >= 0) {
      const c = parts[best]! as Extract<CartPart, { kind: 'wheel' | 'lime' }>;
      return { point: { ...c.center }, bodyId: partBody.get(c.id)!, partId: c.id, snapped: true };
    }
    const t = topmostAt(p, shockIndex);
    if (t >= 0) {
      const tp = parts[t]!;
      return { point: { ...p }, bodyId: partBody.get(tp.id)!, partId: tp.id, snapped: false };
    }
    return { point: { ...p }, bodyId: null, partId: null, snapped: false };
  };

  for (let i = 0; i < parts.length; i++) {
    const s = parts[i]!;
    if (s.kind !== 'shock') continue;
    const a = resolveEnd(s.a, i);
    const b = resolveEnd(s.b, i);
    shockEnds.set(s.id, { a, b });
    const floating: Array<'a' | 'b'> = [];
    if (!a.bodyId) floating.push('a');
    if (!b.bodyId) floating.push('b');
    if (floating.length) {
      errors.push({ code: 'floatingShock', partId: s.id, ends: floating });
      continue;
    }
    if (a.bodyId === b.bodyId) {
      errors.push({ code: 'shockSameBody', partId: s.id });
      continue;
    }
    const anchorA = toM(a.point);
    const anchorB = toM(b.point);
    joints.push({
      type: 'distance',
      partId: s.id,
      bodyA: a.bodyId!,
      bodyB: b.bodyId!,
      anchorA,
      anchorB,
      length: distance(anchorA, anchorB),
    });
    edges.push([a.bodyId!, b.bodyId!]);
  }

  // --- 5. Design-level validation ----------------------------------------
  if (!parts.some((p) => p.kind === 'wheel')) errors.push({ code: 'noWheels' });

  if (bodies.length > 1) {
    const index = new Map(bodies.map((b, i) => [b.id, i]));
    const buf = new UnionFind(bodies.length);
    for (const [a, b] of edges) buf.union(index.get(a)!, index.get(b)!);
    const islands = new Map<number, string[]>();
    bodies.forEach((b, i) => {
      const r = buf.find(i);
      const list = islands.get(r) ?? [];
      list.push(...b.partIds);
      islands.set(r, list);
    });
    if (islands.size > 1) {
      errors.push({ code: 'disconnectedIslands', islands: [...islands.values()] });
    }
  }

  return {
    version: COMPOUND_SPEC_VERSION,
    bodies,
    joints,
    partBody,
    wheelPins,
    shockEnds,
    errors,
    valid: errors.length === 0,
  };
}
