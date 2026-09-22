/**
 * Pure geometric queries against LevelDef terrain spans (no physics).
 *
 * Used by the run controller for "is this pineapple on the ground?" (the
 * endless-mode lost rule) and for the kept-terrain window. The terrain is
 * static, so a geometric distance test is exact enough and deterministic;
 * it avoids needing contact events from the physics wrapper.
 */

import type { Vec2 } from '../model/geometry';
import { closestPointOnSegment, distance } from '../model/geometry';
import type { TerrainSpan } from '../model/level';

interface Segment {
  a: Vec2;
  b: Vec2;
}

/** Bucket width (metres) of the x-grid that indexes segments. */
const BUCKET_M = 2;

export class TerrainIndex {
  private readonly segments: Segment[] = [];
  private readonly buckets = new Map<number, number[]>();
  /** Horizontal extent of all spans (metres); empty terrain -> [0, 0]. */
  readonly minX: number;
  readonly maxX: number;

  constructor(spans: readonly TerrainSpan[]) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const span of spans) {
      for (let i = 0; i + 1 < span.points.length; i++) {
        const a = span.points[i]!;
        const b = span.points[i + 1]!;
        const idx = this.segments.length;
        this.segments.push({ a, b });
        const lo = Math.floor(Math.min(a.x, b.x) / BUCKET_M);
        const hi = Math.floor(Math.max(a.x, b.x) / BUCKET_M);
        for (let k = lo; k <= hi; k++) {
          const list = this.buckets.get(k);
          if (list) list.push(idx);
          else this.buckets.set(k, [idx]);
        }
      }
      for (const p of span.points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
      }
    }
    this.minX = Number.isFinite(minX) ? minX : 0;
    this.maxX = Number.isFinite(maxX) ? maxX : 0;
  }

  /**
   * Distance from `p` to the nearest terrain segment whose x-range lies within
   * `reach` of p.x (Infinity if none). Callers only care about small
   * distances, so `reach` bounds the search.
   */
  distanceTo(p: Vec2, reach = 1): number {
    const lo = Math.floor((p.x - reach) / BUCKET_M);
    const hi = Math.floor((p.x + reach) / BUCKET_M);
    let best = Infinity;
    const seen = new Set<number>();
    for (let k = lo; k <= hi; k++) {
      for (const i of this.buckets.get(k) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const s = this.segments[i]!;
        best = Math.min(best, distance(p, closestPointOnSegment(p, s.a, s.b)));
      }
    }
    return best;
  }

  /** True when a circle at `p` with `radius` touches terrain (within `slop`). */
  circleTouches(p: Vec2, radius: number, slop = 0.05): boolean {
    return this.distanceTo(p, radius + slop + 0.01) <= radius + slop;
  }
}
