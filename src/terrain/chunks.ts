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
  /**
   * Finite sources: the ascending indices of the chunks that hold terrain.
   * TerrainStreamer#loadAll uses it so a level with far-apart spans does not
   * enumerate (and allocate) every empty chunk in between.
   */
  occupiedChunks?(): readonly number[];
}

/** A chunk as handed to listeners: deep-frozen, shared by every listener (never mutate). */
export interface ReadonlyTerrainChunk {
  readonly index: number;
  readonly x0: number;
  readonly x1: number;
  readonly extent: Readonly<{ minX: number; maxX: number }> | null;
  readonly pieces: readonly (readonly Readonly<Vec2>[])[];
}

/** Deep-freeze a chunk in place (one pass over its points) and return it. */
export function freezeChunk(chunk: TerrainChunk): ReadonlyTerrainChunk {
  for (const piece of chunk.pieces) {
    for (const v of piece) Object.freeze(v);
    Object.freeze(piece);
  }
  Object.freeze(chunk.pieces);
  if (chunk.extent) Object.freeze(chunk.extent);
  return Object.freeze(chunk);
}

/**
 * Chunk lifecycle (the renderer mirrors physics through this).
 *
 * The streaming runtime (runtime.ts) calls `chunkCreated` right AFTER the
 * chunk's physics body exists and `chunkDestroyed` right AFTER it is gone,
 * destroys before creates within one update, each group in ascending chunk
 * index. A listener registered late can be brought up to date with
 * TerrainStreamer#loadedChunkData(). Chunks WITHOUT terrain (no pieces) get
 * no physics body and are not announced: listeners only ever see chunks with
 * geometry. The chunk object is deep-frozen and the SAME object goes to every
 * listener and to loadedChunkData() (freezing is one O(points) pass per
 * chunk creation, cheaper than a clone per listener; a listener that tries to
 * mutate it throws in strict-mode code). Geometry is plain data (metres, y-down)
 * so a renderer never touches physics objects (S0 contract 4 spirit); the
 * `body` handle is provided only for debugging/telemetry.
 */
export interface ChunkLifecycleListener {
  chunkCreated(chunk: ReadonlyTerrainChunk, body: number): void;
  chunkDestroyed(index: number, body: number): void;
}

export const chunkIndexAt = (x: number, width = CHUNK_WIDTH): number => Math.floor(x / width);

interface Piece {
  points: Vec2[];
}

/**
 * Furthest a cut may be pushed past its nominal boundary (m). Past this the
 * cut falls back to a vertex (see cutAt), so a piece never strays far from
 * its chunk's nominal bounds whatever the input's vertex density.
 */
export const MAX_CUT_SHIFT = 0.5;

const maxShift = (width: number) => Math.min(MAX_CUT_SHIFT, width / 8);

interface Cut {
  /** Original vertices with index < leftEnd (not yet emitted) end the left piece, before `p`. */
  leftEnd: number;
  /** First original vertex of the right piece after `p`. */
  resume: number;
  p: Vec2;
}

/**
 * Choose the cut point for nominal boundary X inside `pts` (one span), or
 * null when this boundary is not cut (the span starts or ends within
 * MIN_PIECE_WIDTH of it — that boundary's sliver stays with its neighbour).
 *
 * Preferred: interpolated strictly inside a segment, >= MIN_CUT_CLEARANCE from
 * both of its vertices (the seam rule above), at the first such position at
 * or after X. Segments too short for that clearance are skipped, but only up
 * to X + maxShift: if the span is so dense there that no segment qualifies,
 * the cut is placed ON a vertex instead (vertex fallback).
 *
 * Vertex fallback and the seam rule: the engine's ghost vertex continues each
 * piece's END SEGMENT direction, so a vertex seam is exact (both ghosts point
 * at the true neighbouring vertices) iff the segments meeting at that vertex
 * are collinear. The fallback therefore picks, among the interior vertices in
 * [lowX, X + maxShift], the one with the SMALLEST TURN (ties: the leftmost),
 * preferring vertices whose neighbours are >= MIN_VERTEX_SPACING away (so
 * sanitizePiece keeps those neighbours and the end segments are the true
 * ones). Any straight vertex in the window gives an exact seam — e.g. inside
 * a densely sampled incline that starts at the boundary. Residual (documented,
 * audit S3-2 #1): if a 0.5 m window of sub-2-cm segments has NO straight
 * vertex (dense zig-zag / curve), the seam's ghost mismatch equals the
 * smallest vertex turn in that window.
 *
 * Invariant (relied on by cutSpan): a returned cut lies in
 * [X, X + maxShift + MIN_CUT_CLEARANCE] and after `afterX` + MIN_PIECE_WIDTH.
 * (A fallback vertex beyond X + maxShift is only taken when it is the first
 * candidate — the right end of a skipped short segment, so at most
 * MIN_CUT_CLEARANCE past the limit.)
 */
function cutAt(pts: readonly Vec2[], X: number, afterX: number, width: number): Cut | null {
  const xs = pts[0]!.x;
  const xe = pts[pts.length - 1]!.x;
  if (X - xs < MIN_PIECE_WIDTH || xe - X < MIN_PIECE_WIDTH) return null;
  const limit = X + maxShift(width);
  const lowX = Math.max(X, afterX + MIN_PIECE_WIDTH);
  if (lowX > limit) return null; // unreachable while width >= 8 * (maxShift + MIN_PIECE_WIDTH)
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
    const cx = Math.max(lowX, a.x + MIN_CUT_CLEARANCE);
    if (cx > limit) break; // too far from the boundary: vertex fallback
    if (cx > b.x - MIN_CUT_CLEARANCE) continue; // segment too short: try the next one
    if (xe - cx < MIN_PIECE_WIDTH) return null;
    const t = (cx - a.x) / (b.x - a.x);
    return { leftEnd: i + 1, resume: i + 1, p: { x: cx, y: a.y + (b.y - a.y) * t } };
  }
  // Vertex fallback: the straightest interior vertex in [lowX, limit].
  let best = -1;
  let bestTurn = Infinity;
  for (let j = Math.max(1, lo); j < pts.length - 1; j++) {
    const v = pts[j]!;
    if (v.x < lowX) continue;
    if (best >= 0 && v.x > limit) break;
    if (xe - v.x < MIN_PIECE_WIDTH) break; // the rest is an end sliver
    const turn = vertexTurn(pts[j - 1]!, v, pts[j + 1]!);
    if (turn < bestTurn || best < 0) {
      best = j;
      bestTurn = turn;
      if (turn === 0) break;
    }
  }
  if (best < 0) return null;
  const v = pts[best]!;
  return { leftEnd: best, resume: best + 1, p: { x: v.x, y: v.y } };
}

/**
 * Turn score at vertex v between segments a->v and v->b: 1 − cos(turn), in
 * [0, 2], monotonic in the turn angle (0 = straight). Only + − × ÷ and sqrt
 * (correctly rounded everywhere), so the chosen cut is identical across JS
 * engines. A neighbour closer than MIN_VERTEX_SPACING (which sanitizePiece
 * would drop, changing the end segment) scores Infinity.
 */
export function vertexTurn(a: Vec2, v: Vec2, b: Vec2): number {
  const ux = v.x - a.x;
  const uy = v.y - a.y;
  const wx = b.x - v.x;
  const wy = b.y - v.y;
  const lu = Math.sqrt(ux * ux + uy * uy);
  const lw = Math.sqrt(wx * wx + wy * wy);
  if (lu < MIN_VERTEX_SPACING || lw < MIN_VERTEX_SPACING) return Infinity;
  return Math.max(0, 1 - (ux * wx + uy * wy) / (lu * lw));
}

/** Drop interior vertices closer than MIN_VERTEX_SPACING to the previous kept one (ends are kept). */
export function sanitizePiece(points: readonly Vec2[]): Vec2[] | null {
  if (points.length < 2) return null;
  const out: Vec2[] = [points[0]!];
  const last = points[points.length - 1]!;
  // sqrt, not hypot: correctly rounded on every engine, and identical to vertexTurn's spacing test
  const far = (p: Vec2, q: Vec2) => {
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    return Math.sqrt(dx * dx + dy * dy) >= MIN_VERTEX_SPACING;
  };
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
 * Each piece is tagged with the chunk it covers: a piece runs from the cut
 * for boundary k*W (or the span start) to the cut for boundary (k+1)*W (or
 * the span end), and belongs to chunk k. Cuts sit in [k*W, k*W + ~maxShift]
 * (cutAt), so a piece covers its chunk's nominal range up to that shift. A
 * skipped boundary (span end within MIN_PIECE_WIDTH of it) folds the sliver
 * into the neighbouring piece: a span starting just before boundary k*W
 * belongs to chunk k; one ending just after it stays in chunk k-1.
 */
export function cutSpan(points: readonly Vec2[], width = CHUNK_WIDTH): { chunk: number; points: Vec2[] }[] {
  if (points.length < 2) return [];
  const xs = points[0]!.x;
  const xe = points[points.length - 1]!.x;
  const pieces: { chunk: number; points: Vec2[] }[] = [];
  let current: Vec2[] = [{ ...points[0]! }];
  let nextVertex = 1; // next original vertex not yet emitted
  let lastCutX = -Infinity;
  const first = chunkIndexAt(xs, width) + 1;
  // A span starting within MIN_PIECE_WIDTH of boundary `first` belongs to chunk `first`.
  let chunk = first * width - xs < MIN_PIECE_WIDTH ? first : first - 1;
  const push = (pts: Vec2[], k: number) => {
    const clean = sanitizePiece(pts);
    if (clean) pieces.push({ chunk: k, points: clean });
  };
  for (let k = first; k * width < xe; k++) {
    const cut = cutAt(points, k * width, lastCutX, width);
    if (!cut) continue;
    for (; nextVertex < cut.leftEnd; nextVertex++) current.push({ ...points[nextVertex]! });
    current.push(cut.p);
    push(current, k - 1);
    current = [{ ...cut.p }];
    nextVertex = cut.resume;
    lastCutX = cut.p.x;
    chunk = k;
  }
  for (; nextVertex < points.length; nextVertex++) current.push({ ...points[nextVertex]! });
  push(current, chunk);
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
export function surfaceYAt(chunk: ReadonlyTerrainChunk, x: number): number | null {
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

  occupiedChunks(): readonly number[] {
    return [...this.byChunk.keys()].sort((a, b) => a - b);
  }
}
