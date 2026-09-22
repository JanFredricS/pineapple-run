/**
 * Palette -> CartDesign edit operations (pure).
 *
 * Draw tools turn a stroke (start/end in design px) into a draft part. Whether
 * a draft is too small is decided by `resolveAttachments` (the contract's
 * `partTooSmall` rule) — the builder never re-states the minimum sizes.
 *
 *  - straw / shock: segment start -> end (optionally angle-snapped);
 *  - sugar cube: axis-aligned box spanning the drag corners;
 *  - lime / wheel: centre at the press point, radius = drag distance,
 *    clamped so the whole disc stays inside the area (S6V: see maxRadiusInArea).
 */

import { partShapePx, resolveAttachments } from '../model/attach';
import { CART_DESIGN_VERSION, MAX_PARTS, deletePart, type CartDesign, type CartPart } from '../model/cart';
import { closestPointOnSegment, distance, pointInConvex, type Vec2 } from '../model/geometry';
import { ANGLE_SNAP_DEG, BUILD_AREA, COORD_DECIMALS, type Area } from './constants';

export type DrawTool = 'straw' | 'cube' | 'lime' | 'wheel' | 'shock';
export type Tool = DrawTool | 'delete';

export const DRAW_TOOLS: readonly DrawTool[] = ['straw', 'cube', 'lime', 'wheel', 'shock'];

export interface DraftOptions {
  snap: boolean;
  area?: Area;
}

export interface Draft {
  part: CartPart;
  /** The contract says this part is too small (it will not be committed). */
  tooSmall: boolean;
  /** Human-readable size for the live label, e.g. "42 px" or "r 25 px". */
  label: string;
}

const round = (n: number): number => {
  const k = 10 ** COORD_DECIMALS;
  const r = Math.round(n * k) / k;
  return Object.is(r, -0) ? 0 : r;
};
const roundV = (p: Vec2): Vec2 => ({ x: round(p.x), y: round(p.y) });

export function clampToArea(p: Vec2, area: Area = BUILD_AREA): Vec2 {
  return { x: Math.min(area.maxX, Math.max(area.minX, p.x)), y: Math.min(area.maxY, Math.max(area.minY, p.y)) };
}

export function isInArea(p: Vec2, area: Area = BUILD_AREA): boolean {
  return p.x >= area.minX && p.x <= area.maxX && p.y >= area.minY && p.y <= area.maxY;
}

/**
 * Largest radius whose disc centred at `c` lies fully inside `area`: the
 * distance to the nearest edge, rounded DOWN to the stored precision so the
 * rounded part can never poke out (S6V finding 7 — keeps the start-area
 * invariant that no drawable part reaches the funnel above the area).
 */
export function maxRadiusInArea(c: Vec2, area: Area = BUILD_AREA): number {
  const d = Math.min(c.x - area.minX, area.maxX - c.x, c.y - area.minY, area.maxY - c.y);
  const k = 10 ** COORD_DECIMALS;
  return Math.max(0, Math.floor(d * k + 1e-9) / k);
}

/** Snap the direction a->b to `stepDeg` increments, keeping the length. */
export function snapAngle(a: Vec2, b: Vec2, stepDeg = ANGLE_SNAP_DEG): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ...b };
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

/** True when the contract (resolveAttachments) flags this part as too small. */
export function isPartTooSmall(part: CartPart): boolean {
  return resolveAttachments({ version: CART_DESIGN_VERSION, parts: [part] }).errors.some((e) => e.code === 'partTooSmall');
}

/** Build the draft part for a stroke. `id` is used as-is. */
export function makeDraft(tool: DrawTool, start: Vec2, end: Vec2, id: string, opts: DraftOptions): Draft {
  const area = opts.area ?? BUILD_AREA;
  const s = clampToArea(start, area);
  let e = clampToArea(end, area);
  let part: CartPart;
  let label: string;
  switch (tool) {
    case 'straw':
    case 'shock': {
      if (opts.snap) e = clampToArea(snapAngle(s, e), area);
      const a = roundV(s);
      const b = roundV(e);
      part = { id, kind: tool, a, b };
      label = `${Math.round(distance(a, b))} px`;
      break;
    }
    case 'cube': {
      const w = round(Math.abs(e.x - s.x));
      const h = round(Math.abs(e.y - s.y));
      part = { id, kind: 'cube', center: roundV({ x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }), width: w, height: h, angle: 0 };
      label = `${Math.round(w)} × ${Math.round(h)} px`;
      break;
    }
    case 'lime':
    case 'wheel': {
      // Clamp (not reject): the circle keeps following the pointer and simply
      // stops growing at the nearest edge, like the drag endpoints themselves.
      const center = roundV(s);
      const r = Math.min(round(distance(s, e)), maxRadiusInArea(center, area));
      part = { id, kind: tool, center, radius: r };
      label = `r ${Math.round(r)} px`;
      break;
    }
  }
  return { part, tooSmall: isPartTooSmall(part), label };
}

/** A part id not used in `design` ("p1", "p2", ...). */
export function nextPartId(design: CartDesign): string {
  const used = new Set(design.parts.map((p) => p.id));
  let n = design.parts.length + 1;
  for (const p of design.parts) {
    const m = /^p(\d+)$/.exec(p.id);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  while (used.has(`p${n}`)) n++;
  return `p${n}`;
}

export type EditOutcome =
  | { kind: 'added'; partId: string }
  | { kind: 'deleted'; partId: string }
  | { kind: 'rejected'; reason: 'tooSmall' | 'partLimit' | 'outsideArea' | 'nothingHere'; message: string };

export interface EditResult {
  design: CartDesign;
  outcome: EditOutcome;
}

const KIND_NAME: Record<CartPart['kind'], string> = {
  straw: 'Straw',
  cube: 'Sugar cube',
  lime: 'Lime wheel',
  wheel: 'Bottle-cap wheel',
  shock: 'Umbrella shock',
};

export const kindName = (k: CartPart['kind']): string => KIND_NAME[k];

/**
 * Apply a completed stroke (design px) with `tool`. `tolerance` (design px) is
 * the delete tool's pick slop. Returns the new design (unchanged on reject).
 */
export function applyStroke(
  design: CartDesign,
  tool: Tool,
  start: Vec2,
  end: Vec2,
  opts: DraftOptions & { tolerance?: number },
): EditResult {
  if (tool === 'delete') {
    const id = hitTest(design, end, opts.tolerance ?? 0);
    if (!id) return { design, outcome: { kind: 'rejected', reason: 'nothingHere', message: 'Nothing to delete there' } };
    return { design: deletePart(design, id), outcome: { kind: 'deleted', partId: id } };
  }
  if (!isInArea(start, opts.area ?? BUILD_AREA)) {
    return { design, outcome: { kind: 'rejected', reason: 'outsideArea', message: 'Start drawing inside the build area' } };
  }
  if (design.parts.length >= MAX_PARTS) {
    return { design, outcome: { kind: 'rejected', reason: 'partLimit', message: `Part limit reached (${MAX_PARTS})` } };
  }
  const draft = makeDraft(tool, start, end, nextPartId(design), opts);
  if (draft.tooSmall) {
    return {
      design,
      outcome: { kind: 'rejected', reason: 'tooSmall', message: `${kindName(draft.part.kind)} too small — drag further` },
    };
  }
  return { design: { ...design, parts: [...design.parts, draft.part] }, outcome: { kind: 'added', partId: draft.part.id } };
}

export function clearAll(design: CartDesign): CartDesign {
  return { ...design, parts: [] };
}

/**
 * Distance from `p` to a part's drawn shape (0 when inside). Shocks are thin
 * lines, so they are measured to their segment.
 */
function distanceToPart(part: CartPart, p: Vec2): number {
  if (part.kind === 'shock') return distance(p, closestPointOnSegment(p, part.a, part.b));
  const shape = partShapePx(part);
  if (pointInConvex(p, shape)) return 0;
  if (shape.type === 'circle') return Math.max(0, distance(p, shape.center) - shape.radius);
  let best = Infinity;
  const v = shape.vertices;
  for (let i = 0; i < v.length; i++) best = Math.min(best, distance(p, closestPointOnSegment(p, v[i]!, v[(i + 1) % v.length]!)));
  return best;
}

/**
 * The part under `p` for the delete tool: the closest part within `tolerance`
 * (design px); ties (e.g. several parts containing p) go to the topmost —
 * the most recently drawn — matching the contract's notion of "topmost".
 */
export function hitTest(design: CartDesign, p: Vec2, tolerance: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (let i = design.parts.length - 1; i >= 0; i--) {
    const part = design.parts[i]!;
    const d = distanceToPart(part, p);
    if (d <= tolerance && d < bestD) {
      best = part.id;
      bestD = d;
    }
  }
  return best;
}
