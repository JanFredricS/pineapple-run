/**
 * Terrain chunking (pure — no physics, no DOM).
 *
 * LevelDef terrain SPANS are cut into fixed-width x-chunks (CHUNK_WIDTH m).
 * Each chunk is a list of PIECES (polylines); each piece becomes one Box2D
 * chain in physics and one mesh strip in the renderer. Gaps between spans
 * stay gaps: a piece never bridges two spans.
 *
 * Seam rule (why there are no bumps at chunk boundaries):
 *   physics/engine.ts#addChain extends every chain by a ghost vertex that
 *   continues the END SEGMENT's direction. That is only equivalent to the true
 *   neighbouring vertex if the terrain is straight across the seam. So a span
 *   is never cut AT a vertex: the cut point is interpolated strictly inside a
 *   segment (>= MIN_CUT_CLEARANCE from both of its vertices). Both pieces then
 *   end on the same straight segment, the extrapolated ghost lies exactly on
 *   the neighbour's first segment, and the two pieces share the cut vertex
 *   (the same computed numbers, bit-for-bit). Real span ends (gap edges) keep
 *   the engine's straight ghost extension, as before.
 *
 * Determinism: every cut decision is LOCAL (the segment containing the
 * nominal boundary, plus the span's own ends), so a chunk can be rebuilt at
 * any time from the same input and comes out identical. The procedural source
 * relies on this to produce the same chunks from a local window of terrain as
 * this module produces from a whole generated LevelDef.
 */

import type { Vec2 } from '../model/geometry';
import type { TerrainDef } from '../model/level';

/** Nominal chunk width (m). Chunk k nominally covers [k*W, (k+1)*W). */
export const CHUNK_WIDTH = 40;

/** A cut is placed at least this far (in x, m) from either vertex of its segment. */
export const MIN_CUT_CLEARANCE = 0.01;

/** A span end closer than this (m) to a nominal boundary is not cut there (no slivers). */
export const MIN_PIECE_WIDTH = 0.05;

/**
 * Consecutive vertices closer than this (m) are merged before reaching
 * physics (Box2D rejects/misbehaves on near-zero chain segments). Validated
 * LevelDefs may legally contain such points; they are invisible at 30 px/m.
 */
export const MIN_VERTEX_SPACING = 0.005;

export interface TerrainChunk {
  index: number;
  /** Nominal bounds [index*W, (index+1)*W). */
  x0: number;
  x1: number;
  /** Actual geometric x-extent of the pieces (may overhang nominal bounds by a few cm); null if empty. */
  extent: { minX: number; maxX: number } | null;
  /** Polylines, left -> right, >= 2 points each, y-down metres. */
  pieces: Vec2[][];
}

/**
 * Anything that can produce chunks deterministically. Implemented by
 * LevelChunkSource (a finite LevelDef) and ProceduralChunkSource (endless,
 * generator.ts). `chunk(k)` must return an equal result every call.
 */
export interface TerrainSource {
  readonly chunkWidth: number;
  /** Inclusive chunk-index bounds that can hold terrain (Infinity for endless). */
  readonly firstChunk: number;
  readonly lastChunk: number;
  readonly friction: number;
  readonly restitution: number;
  chunk(index: number): TerrainChunk;
}

/**
 * Chunk lifecycle (the renderer mirrors physics through this).
 *
 * The streaming runtime (runtime.ts) calls `chunkCreated` right AFTER the
 * chunk's physics body exists and `chunkDestroyed` right AFTER it is gone,
 * destroys before creates within one update, each group in ascending chunk
 * index. A listener registered late can be brought up to date with
 * TerrainStreamer#loadedChunkData(). Geometry is plain data (metres, y-down)
 * so a renderer never touches physics objects (S0 contract 4 spirit); the
 * `body` handle is provided only for debugging/telemetry.
 */
export interface ChunkLifecycleListener {
  chunkCreated(chunk: TerrainChunk, body: number): void;
  chunkDestroyed(index: number, body: number): void;
}

export const chunkIndexAt = (x: number, width = CHUNK_WIDTH): number => Math.floor(x / width);

interface Piece {
  points: Vec2[];
}

/**
 * Choose the cut point for nominal boundary X inside `pts` (one span).
 * Returns the segment index `i` (cut lies strictly inside pts[i]..pts[i+1])
 * and the point, or null when this boundary is not cut.
 */
function cutAt(pts: readonly Vec2[], X: number, afterX: number): { i: number; p: Vec2 } | null {
  const xs = pts[0]!.x;
  const xe = pts[pts.length - 1]!.x;
  if (X - xs < MIN_PIECE_WIDTH || xe - X < MIN_PIECE_WIDTH) return null;
  // First segment whose right end is beyond X (binary search).
  let lo = 0;
  let hi = pts.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid + 1]!.x > X) hi = mid;
    else lo = mid + 1;
  }
  for (let i = lo; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const cx = Math.max(X, a.x + MIN_CUT_CLEARANCE, afterX + MIN_PIECE_WIDTH);
    if (cx > b.x - MIN_CUT_CLEARANCE) continue; // segment too short: try the next one
    if (xe - cx < MIN_PIECE_WIDTH) return null;
    const t = (cx - a.x) / (b.x - a.x);
    return { i, p: { x: cx, y: a.y + (b.y - a.y) * t } };
  }
  return null;
}

/** Drop interior vertices closer than MIN_VERTEX_SPACING to the previous kept one (ends are kept). */
export function sanitizePiece(points: readonly Vec2[]): Vec2[] | null {
  if (points.length < 2) return null;
  const out: Vec2[] = [points[0]!];
  const last = points[points.length - 1]!;
  const far = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y) >= MIN_VERTEX_SPACING;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    if (far(p, out[out.length - 1]!) && far(p, last)) out.push(p);
  }
  if (!far(last, out[out.length - 1]!)) {
    if (out.length === 1) return null; // whole piece is degenerate
    out.pop(); // keep the true end point instead of the near-duplicate interior one
  }
  out.push(last);
  return out.length >= 2 ? out : null;
}

/**
 * Cut one span into pieces at every nominal chunk boundary it crosses.
 * Each piece is tagged with its chunk: the chunk containing the piece's
 * x-midpoint (pieces lie between consecutive cuts, which sit within a few cm
 * of the nominal boundaries, so this is the chunk the piece belongs to).
 */
export function cutSpan(points: readonly Vec2[], width = CHUNK_WIDTH): { chunk: number; points: Vec2[] }[] {
  if (points.length < 2) return [];
  const xs = points[0]!.x;
  const xe = points[points.length - 1]!.x;
  const pieces: { chunk: number; points: Vec2[] }[] = [];
  let current: Vec2[] = [{ ...points[0]! }];
  let nextVertex = 1; // next original vertex not yet emitted
  let lastCutX = -Infinity;
  const push = (pts: Vec2[]) => {
    const clean = sanitizePiece(pts);
    if (!clean) return;
    const mid = (clean[0]!.x + clean[clean.length - 1]!.x) / 2;
    pieces.push({ chunk: chunkIndexAt(mid, width), points: clean });
  };
  for (let k = chunkIndexAt(xs, width) + 1; k * width < xe; k++) {
    const cut = cutAt(points, k * width, lastCutX);
    if (!cut) continue;
    for (; nextVertex <= cut.i; nextVertex++) current.push({ ...points[nextVertex]! });
    current.push(cut.p);
    push(current);
    current = [{ ...cut.p }];
    lastCutX = cut.p.x;
  }
  for (; nextVertex < points.length; nextVertex++) current.push({ ...points[nextVertex]! });
  push(current);
  return pieces;
}

/** Group pieces of many spans by chunk index. */
export function chunkSpans(spans: readonly (readonly Vec2[])[], width = CHUNK_WIDTH): Map<number, Vec2[][]> {
  const byChunk = new Map<number, Vec2[][]>();
  for (const span of spans) {
    for (const piece of cutSpan(span, width)) {
      let list = byChunk.get(piece.chunk);
      if (!list) byChunk.set(piece.chunk, (list = []));
      list.push(piece.points);
    }
  }
  return byChunk;
}

export function makeChunk(index: number, pieces: Vec2[][], width = CHUNK_WIDTH): TerrainChunk {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of pieces) {
    minX = Math.min(minX, p[0]!.x);
    maxX = Math.max(maxX, p[p.length - 1]!.x);
  }
  return {
    index,
    x0: index * width,
    x1: (index + 1) * width,
    extent: pieces.length ? { minX, maxX } : null,
    pieces,
  };
}

/**
 * Ground height (y, m) of a chunk at x, or null over a gap / outside the
 * chunk's pieces. Where pieces overlap in x (never in generated terrain), the
 * highest surface (smallest y) wins. For spawning and tools.
 */
export function surfaceYAt(chunk: TerrainChunk, x: number): number | null {
  let best: number | null = null;
  for (const piece of chunk.pieces) {
    if (x < piece[0]!.x || x > piece[piece.length - 1]!.x) continue;
    for (let i = 1; i < piece.length; i++) {
      const a = piece[i - 1]!;
      const b = piece[i]!;
      if (x >= a.x && x <= b.x) {
        const y = b.x === a.x ? Math.min(a.y, b.y) : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
        if (best === null || y < best) best = y;
        break;
      }
    }
  }
  return best;
}

const clonePieces =(pieces: readonly Vec2[][]): Vec2[][] => pieces.map((p) => p.map((v) => ({ x: v.x, y: v.y })));

/** Chunks of a finite, already-validated LevelDef terrain. */
export class LevelChunkSource implements TerrainSource {
  readonly chunkWidth: number;
  readonly firstChunk: number;
  readonly lastChunk: number;
  readonly friction: number;
  readonly restitution: number;
  private readonly byChunk: Map<number, Vec2[][]>;

  constructor(terrain: TerrainDef, width = CHUNK_WIDTH) {
    this.chunkWidth = width;
    this.friction = terrain.friction;
    this.restitution = terrain.restitution;
    this.byChunk = chunkSpans(
      terrain.spans.map((s) => s.points),
      width,
    );
    let first = Infinity;
    let last = -Infinity;
    for (const k of this.byChunk.keys()) {
      first = Math.min(first, k);
      last = Math.max(last, k);
    }
    // Empty terrain: an empty range (first > last).
    this.firstChunk = Number.isFinite(first) ? first : 0;
    this.lastChunk = Number.isFinite(last) ? last : -1;
  }

  chunk(index: number): TerrainChunk {
    return makeChunk(index, clonePieces(this.byChunk.get(index) ?? []), this.chunkWidth);
  }
}
