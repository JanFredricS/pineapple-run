/**
 * Map-builder editing operations — pure functions over a LevelDef working
 * copy (never mutate the input; return a new doc). The UI (main.ts) wires
 * them to mouse/keyboard; tests cover them in test/mapbuilder/ops.test.ts.
 *
 * Every op keeps the LevelDef span invariants that model/validate checks:
 * points strictly increasing in x within a span, spans ordered left to
 * right without overlap, >= 2 points per span, >= 1 span, unique ids.
 */

import type { Vec2 } from '../../src/model/geometry';
import { DEFAULT_TERRAIN_FRICTION, DEFAULT_TERRAIN_RESTITUTION, LEVEL_DEF_VERSION, type LevelDef, type TerrainSpan } from '../../src/model/level';

/** Minimum x spacing the editor keeps between neighbouring points (m). */
export const MIN_DX = 0.02;

export interface PointRef {
  span: number;
  point: number;
}

export interface SegmentRef {
  span: number;
  /** Segment i joins points i and i+1. */
  seg: number;
}

const clone = (doc: LevelDef): LevelDef => structuredClone(doc);

export function defaultLevel(): LevelDef {
  return {
    version: LEVEL_DEF_VERSION,
    id: 'new-level',
    name: 'New level',
    theme: 'beach',
    terrain: {
      spans: [
        {
          id: 'ground',
          points: [
            { x: -0.1, y: 4 },
            { x: 0, y: 10 },
            { x: 20, y: 10 },
            { x: 40, y: 9 },
            { x: 60, y: 10 },
          ],
        },
      ],
      friction: DEFAULT_TERRAIN_FRICTION,
      restitution: DEFAULT_TERRAIN_RESTITUTION,
    },
    cartStart: { x: 3, y: 8.2 },
    funnel: { x: 5, y: 4 },
    goal: { sensor: { x: 55, y: 8, width: 3, height: 2 }, lineX: 55 },
    props: [],
    zones: [],
    killY: 40,
  };
}

/** Allowed x-interval for a point so every invariant still holds. */
export function pointXRange(doc: LevelDef, ref: PointRef): { min: number; max: number } {
  const spans = doc.terrain.spans;
  const pts = spans[ref.span]!.points;
  let min = -Infinity;
  let max = Infinity;
  if (ref.point > 0) min = pts[ref.point - 1]!.x + MIN_DX;
  else if (ref.span > 0) {
    const prev = spans[ref.span - 1]!.points;
    min = prev[prev.length - 1]!.x; // may touch (shared endpoint), not overlap
  }
  if (ref.point < pts.length - 1) max = pts[ref.point + 1]!.x - MIN_DX;
  else if (ref.span < spans.length - 1) max = spans[ref.span + 1]!.points[0]!.x;
  return { min, max };
}

export function movePoint(doc: LevelDef, ref: PointRef, to: Vec2): LevelDef {
  const out = clone(doc);
  const { min, max } = pointXRange(doc, ref);
  const p = out.terrain.spans[ref.span]!.points[ref.point]!;
  p.x = Math.min(max, Math.max(min, to.x));
  p.y = to.y;
  return out;
}

/** Insert a point into segment `ref` (x clamped strictly inside it). Returns the doc and the new point's ref. */
export function insertPoint(doc: LevelDef, ref: SegmentRef, at: Vec2): { doc: LevelDef; point: PointRef } | null {
  const pts = doc.terrain.spans[ref.span]!.points;
  const a = pts[ref.seg]!;
  const b = pts[ref.seg + 1]!;
  if (b.x - a.x < 2 * MIN_DX) return null;
  const x = Math.min(b.x - MIN_DX, Math.max(a.x + MIN_DX, at.x));
  const out = clone(doc);
  out.terrain.spans[ref.span]!.points.splice(ref.seg + 1, 0, { x, y: at.y });
  return { doc: out, point: { span: ref.span, point: ref.seg + 1 } };
}

/**
 * Extend the nearest span end towards `at` (append beyond its last point or
 * prepend before its first) if that does not overlap a neighbour.
 */
export function extendSpan(doc: LevelDef, at: Vec2): { doc: LevelDef; point: PointRef } | null {
  const spans = doc.terrain.spans;
  for (let i = 0; i < spans.length; i++) {
    const pts = spans[i]!.points;
    const nextStart = i < spans.length - 1 ? spans[i + 1]!.points[0]!.x : Infinity;
    const prevEnd = i > 0 ? spans[i - 1]!.points[spans[i - 1]!.points.length - 1]!.x : -Infinity;
    if (at.x > pts[pts.length - 1]!.x + MIN_DX && at.x <= nextStart) {
      const out = clone(doc);
      out.terrain.spans[i]!.points.push({ x: at.x, y: at.y });
      return { doc: out, point: { span: i, point: pts.length } };
    }
    if (at.x < pts[0]!.x - MIN_DX && at.x >= prevEnd) {
      const out = clone(doc);
      out.terrain.spans[i]!.points.unshift({ x: at.x, y: at.y });
      return { doc: out, point: { span: i, point: 0 } };
    }
  }
  return null;
}

/** Delete a point; a 2-point span is removed entirely (unless it is the last span). */
export function deletePoint(doc: LevelDef, ref: PointRef): LevelDef | null {
  const span = doc.terrain.spans[ref.span]!;
  const out = clone(doc);
  if (span.points.length > 2) {
    out.terrain.spans[ref.span]!.points.splice(ref.point, 1);
    return out;
  }
  if (doc.terrain.spans.length <= 1) return null;
  out.terrain.spans.splice(ref.span, 1);
  return out;
}

export function uniqueSpanId(doc: LevelDef, base = 'span'): string {
  const ids = new Set(doc.terrain.spans.map((s) => s.id));
  for (let i = 1; ; i++) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * Cut a gap into segment `ref`: its middle third is removed, splitting the
 * span in two (each side keeps >= 2 points). Drag the new edge points to
 * size the gap.
 */
export function cutGap(doc: LevelDef, ref: SegmentRef): LevelDef | null {
  const span = doc.terrain.spans[ref.span]!;
  const a = span.points[ref.seg]!;
  const b = span.points[ref.seg + 1]!;
  if (b.x - a.x < 6 * MIN_DX) return null;
  const lerp = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const left: TerrainSpan = { id: span.id, points: [...span.points.slice(0, ref.seg + 1), lerp(1 / 3)].map((p) => ({ ...p })) };
  const right: TerrainSpan = { id: uniqueSpanId(doc, span.id), points: [lerp(2 / 3), ...span.points.slice(ref.seg + 1)].map((p) => ({ ...p })) };
  const out = clone(doc);
  out.terrain.spans.splice(ref.span, 1, left, right);
  return out;
}

/** Join span i with span i+1 (closing the gap between them). */
export function joinSpans(doc: LevelDef, i: number): LevelDef | null {
  if (i < 0 || i >= doc.terrain.spans.length - 1) return null;
  const out = clone(doc);
  const a = out.terrain.spans[i]!;
  const b = out.terrain.spans[i + 1]!;
  const aEnd = a.points[a.points.length - 1]!;
  const rest = b.points[0]!.x - aEnd.x < MIN_DX ? b.points.slice(1) : b.points;
  if (rest.length && rest[0]!.x - aEnd.x < MIN_DX) return null;
  a.points.push(...rest);
  out.terrain.spans.splice(i + 1, 1);
  return out;
}

/** Add a new 2-point span starting at `at` (width up to 4 m, fitted into free space). */
export function addSpan(doc: LevelDef, at: Vec2): { doc: LevelDef; span: number } | null {
  const spans = doc.terrain.spans;
  let idx = spans.length;
  for (let i = 0; i < spans.length; i++) {
    if (spans[i]!.points[0]!.x > at.x) {
      idx = i;
      break;
    }
  }
  const prevEnd = idx > 0 ? spans[idx - 1]!.points[spans[idx - 1]!.points.length - 1]!.x : -Infinity;
  const nextStart = idx < spans.length ? spans[idx]!.points[0]!.x : Infinity;
  if (at.x < prevEnd) return null; // inside an existing span
  const x1 = Math.min(at.x + 4, nextStart);
  if (x1 - at.x < 2 * MIN_DX) return null;
  const out = clone(doc);
  out.terrain.spans.splice(idx, 0, {
    id: uniqueSpanId(doc),
    points: [
      { x: at.x, y: at.y },
      { x: x1, y: at.y },
    ],
  });
  return { doc: out, span: idx };
}

// ------------------------------------------------------------ hit tests

export function hitPoint(doc: LevelDef, p: Vec2, tol: number): PointRef | null {
  let best: PointRef | null = null;
  let bestD = tol;
  doc.terrain.spans.forEach((s, si) =>
    s.points.forEach((q, pi) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bestD) {
        bestD = d;
        best = { span: si, point: pi };
      }
    }),
  );
  return best;
}

export function hitSegment(doc: LevelDef, p: Vec2, tol: number): SegmentRef | null {
  let best: SegmentRef | null = null;
  let bestD = tol;
  doc.terrain.spans.forEach((s, si) => {
    for (let i = 0; i < s.points.length - 1; i++) {
      const a = s.points[i]!;
      const b = s.points[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
      if (d <= bestD) {
        bestD = d;
        best = { span: si, seg: i };
      }
    }
  });
  return best;
}

export function uniqueId(existing: Iterable<string>, base: string): string {
  const ids = new Set(existing);
  for (let i = 1; ; i++) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}
