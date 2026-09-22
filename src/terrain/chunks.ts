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
 *   is normally not cut AT a vertex: the cut point is interpolated strictly
 *   inside a segment (>= MIN_CUT_CLEARANCE from both of its vertices). Both
 *   pieces then end on the same straight segment, the extrapolated ghost lies exactly on
 *   the neighbour's first segment, and the two pieces share the cut vertex
 *   (the same computed numbers, bit-for-bit). Real span ends (gap edges) keep
 *   the engine's straight ghost extension, as before. Where the span is too
 *   dense near a boundary for that, cutAt falls back to a vertex seam chosen
 *   only when its ghost error is bounded (see cutAt), otherwise it stays uncut.
 *
 * Determinism: every cut decision is LOCAL (the segment containing the
 * nominal boundary's window, plus the span's own ends, on the once-sanitized
 * span), so a chunk can be rebuilt at any time from the same input and comes out identical. The procedural source
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
  /** Actual geometric x-extent of the pieces (may overhang nominal bounds when no safe seam exists); null if empty. */
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
  /** Owners of uncut pieces intersecting this window outside their nominal chunk. */
  overlappingChunks?(minX: number, maxX: number): readonly number[];
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
 * Furthest a cut may be pushed past its nominal boundary (m). If no safe
 * cut exists in this window, retain the unsplit piece by its actual extent.
 */
export const MAX_CUT_SHIFT = 0.5;

const maxShift = (width: number) => Math.min(MAX_CUT_SHIFT, width / 8);

/**
 * Largest |sin(turn)| at which a vertex counts as straight (a bounded-error vertex
 * seam, see cutAt). The engine's 1 m ghost then deviates from the true
 * neighbour segment's line by <= 1 mm, and the angle is 10x inside Box2D's own
 * chain-normal tolerance (sinTol = 0.01 in Box2D v3's chain-segment manifold).
 */
export const STRAIGHT_SIN_TOL = 1e-3;

/**
 * Shortest segment the vertex-avoiding fallback may split at its midpoint (m):
 * both halves stay >= 1.1 * MIN_VERTEX_SPACING, the spacing every chain
 * segment already honours (Box2D's linear slop is 5 mm).
 */
export const MIN_SPLIT_LENGTH = 2.2 * MIN_VERTEX_SPACING;

interface Cut {
  /** Span vertices with index < leftUpTo (not yet emitted) go into the left piece. */
  leftUpTo: number;
  /** Interpolated end point appended to the left piece after those vertices (segment cuts only). */
  leftExtra: Vec2 | null;
  /** First point of the right piece. */
  rightHead: Vec2;
  /** First span vertex of the right piece after rightHead. */
  resume: number;
}

/**
 * Choose a cut in [max(X, afterX + MIN_PIECE_WIDTH), X + maxShift].
 * Try x-clearance interpolation, then a >=11 mm segment midpoint, then the
 * leftmost straight vertex. Otherwise do NOT cut, even for a full window.
 *
 * Seam bound, independent of window size/count and distance to either end:
 * an interior segment cut has collinear neighbours. A vertex is accepted
 * only if dot(u,w)>0 and cross(u,w)^2 <= 1e-6 |u|^2 |w|^2. Thus its turn
 * satisfies |theta| <= asin(1e-3), and either one-metre ghost is at most
 * 1 mm from the true neighbour's ray. No concave/convex exception exists.
 * Segment cuts also pass this predicate on the ACTUAL interpolated point,
 * guarding coordinate-rounding on very steep segments. With validated
 * coordinates (|coordinate|<=1e6), spacing >=5 mm, and IEEE double arithmetic,
 * squared norms/products neither overflow nor approach underflow. The
 * accumulated error in normalized cross is <64*Number.EPSILON (bound each
 * rounded sum/product by epsilon times the sum of absolute products).
 * Thus |sin(theta)| <= 1e-3 + 64*epsilon; dot>0 excludes the near-pi branch.
 * A conservative bound including rounding is 0.001001 radians / 1.001 mm.
 * Only +,-,*,/ and comparisons are used; no sqrt/trig decides a cut.
 *
 * Sanitization happens once BEFORE selection, so the tested neighbours are
 * the emitted neighbours. A truncated or empty window cannot weaken the
 * predicate: it can only cause no cut. Uncut pieces can cross any number of
 * boundaries; their owner is retained by actual extent (LevelChunkSource).
 */
function cutAt(pts: readonly Vec2[], X: number, afterX: number, width: number): Cut | null {
  const n = pts.length;
  const xs = pts[0]!.x;
  const xe = pts[n - 1]!.x;
  if (X - xs < MIN_PIECE_WIDTH || xe - X < MIN_PIECE_WIDTH) return null;
  const limit = X + maxShift(width);
  const lowX = Math.max(X, afterX + MIN_PIECE_WIDTH);
  if (lowX > limit) return null; // unreachable while width >= 8 * (maxShift + MIN_PIECE_WIDTH)
  // First segment whose right end is beyond X (binary search).
  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid + 1]!.x > X) hi = mid;
    else lo = mid + 1;
  }
  const segmentCut = (i: number, p: Vec2): Cut => ({ leftUpTo: i + 1, leftExtra: p, rightHead: { ...p }, resume: i + 1 });
  // 1. x-clearance segment cut.
  for (let i = lo; i < n - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const cx = Math.max(lowX, a.x + MIN_CUT_CLEARANCE);
    if (cx > limit) break;
    if (cx > b.x - MIN_CUT_CLEARANCE) continue; // segment too short in x: try the next one
    if (xe - cx < MIN_PIECE_WIDTH) return null;
    const t = (cx - a.x) / (b.x - a.x);
    const p = { x: cx, y: a.y + (b.y - a.y) * t };
    if (isStraightVertex(a, p, b)) return segmentCut(i, p);
  }
  // 2. length-clearance segment cut (midpoint of a segment >= MIN_SPLIT_LENGTH).
  const minLenSq = MIN_SPLIT_LENGTH * MIN_SPLIT_LENGTH;
  for (let i = lo; i < n - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (a.x > limit) break;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx * dx + dy * dy < minLenSq) continue;
    const m = { x: a.x + dx * 0.5, y: a.y + dy * 0.5 };
    if (m.x < lowX) continue;
    if (m.x > limit) break;
    if (!(m.x > a.x && m.x < b.x)) continue; // too steep to place a distinct x inside
    if (xe - m.x < MIN_PIECE_WIDTH) break; // end sliver: vertex fallback
    if (isStraightVertex(a, m, b)) return segmentCut(i, m);
  }
  // 3. A hard per-vertex bound, including a one-candidate end window.
  for (let c = Math.max(1, lo); c < n - 1; c++) {
    const v = pts[c]!;
    if (v.x < lowX) continue;
    if (v.x > limit || xe - v.x < MIN_PIECE_WIDTH) break;
    if (isStraightVertex(pts[c - 1]!, v, pts[c + 1]!)) return vertexCut(c, v);
  }
  return null;
}

const vertexCut = (c: number, v: Vec2): Cut => ({ leftUpTo: c + 1, leftExtra: null, rightHead: { ...v }, resume: c + 1 });

/**
 * True iff segments a->v and v->b point the same way to within
 * STRAIGHT_SIN_TOL: dot > 0 and cross² <= tol² * |u|² * |w|².
 *
 * Determinism (audit S3-3 #4): this uses only IEEE-754 double
 * + − × and comparisons, which ECMAScript specifies exactly (round to nearest,
 * ties to even, no fused multiply-add), so every conforming engine computes
 * the same booleans for the same inputs — unlike Math.sqrt/hypot/atan2, which
 * the spec lets implementations approximate. Candidates are then chosen by
 * position (leftmost), so no near-tie can
 * resolve differently on another engine.
 */
export function isStraightVertex(a: Vec2, v: Vec2, b: Vec2): boolean {
  const ux = v.x - a.x;
  const uy = v.y - a.y;
  const wx = b.x - v.x;
  const wy = b.y - v.y;
  const dot = ux * wx + uy * wy;
  if (!(dot > 0)) return false;
  const cross = ux * wy - uy * wx;
  return cross * cross <= STRAIGHT_SIN_TOL * STRAIGHT_SIN_TOL * ((ux * ux + uy * uy) * (wx * wx + wy * wy));
}

const MIN_VERTEX_SPACING_SQ = MIN_VERTEX_SPACING * MIN_VERTEX_SPACING;

/**
 * Drop interior vertices closer than MIN_VERTEX_SPACING to the previous kept
 * one or to the end point (ends are kept). Squared distances only (+ − ×,
 * exactly specified by ECMAScript), so the result is engine-independent.
 */
export function sanitizePiece(points: readonly Vec2[]): Vec2[] | null {
  if (points.length < 2) return null;
  const out: Vec2[] = [points[0]!];
  const last = points[points.length - 1]!;
  const far = (p: Vec2, q: Vec2) => {
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    return dx * dx + dy * dy >= MIN_VERTEX_SPACING_SQ;
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
 * Try to cut one span at each nominal chunk boundary it crosses.
 * Each piece belongs to the chunk where it starts (allowing the existing
 * near-start sliver fold). Skipped unsafe boundaries leave it in that owner,
 * even if a later boundary is cut. LevelChunkSource records oversized extents
 * so streaming can load/retain the owner wherever the piece is needed.
 *
 * The span is sanitized ONCE, before any cut decision (audit S3-3 #2): the
 * cut logic (clearances, straightness) sees exactly the vertices the
 * pieces will contain, and the pieces are not re-sanitized — they are runs of
 * consecutive sanitized vertices plus interpolated cut points >=
 * MIN_CUT_CLEARANCE in x, or half MIN_SPLIT_LENGTH in length, from their
 * segment's vertices, so every piece already satisfies the spacing rule. (Generated terrain is spaced
 * far above MIN_VERTEX_SPACING, so sanitizing is the identity on it and the
 * procedural source's local windows cut exactly like the whole level.)
 */
export function cutSpan(raw: readonly Vec2[], width = CHUNK_WIDTH): { chunk: number; points: Vec2[] }[] {
  const points = sanitizePiece(raw);
  if (!points) return [];
  const xs = points[0]!.x;
  const xe = points[points.length - 1]!.x;
  const pieces: { chunk: number; points: Vec2[] }[] = [];
  let current: Vec2[] = [{ ...points[0]! }];
  let nextVertex = 1; // next span vertex not yet emitted into `current`
  let lastCutX = -Infinity;
  const first = chunkIndexAt(xs, width) + 1;
  // A span starting within MIN_PIECE_WIDTH of boundary `first` belongs to chunk `first`.
  let chunk = first * width - xs < MIN_PIECE_WIDTH ? first : first - 1;
  for (let k = first; k * width < xe; k++) {
    const cut = cutAt(points, k * width, lastCutX, width);
    if (!cut) continue;
    for (; nextVertex < cut.leftUpTo; nextVertex++) current.push({ ...points[nextVertex]! });
    if (cut.leftExtra) current.push(cut.leftExtra);
    pieces.push({ chunk, points: current });
    current = [cut.rightHead];
    nextVertex = cut.resume;
    lastCutX = cut.rightHead.x;
    chunk = k;
  }
  for (; nextVertex < points.length; nextVertex++) current.push({ ...points[nextVertex]! });
  pieces.push({ chunk, points: current });
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
  private readonly overhangs: { chunk: number; minX: number; maxX: number }[] = [];

  constructor(terrain: TerrainDef, width = CHUNK_WIDTH) {
    this.chunkWidth = width;
    this.friction = terrain.friction;
    this.restitution = terrain.restitution;
    this.byChunk = chunkSpans(
      terrain.spans.map((s) => s.points),
      width,
    );
    for (const [chunk, pieces] of this.byChunk) {
      for (const p of pieces) {
        const minX = p[0]!.x;
        const maxX = p[p.length - 1]!.x;
        if (minX < chunk * width || maxX > (chunk + 1) * width) {
          this.overhangs.push({ chunk, minX, maxX });
        }
      }
    }
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

  overlappingChunks(minX: number, maxX: number): readonly number[] {
    return [...new Set(this.overhangs.filter((p) => p.minX <= maxX && p.maxX >= minX).map((p) => p.chunk))].sort((a, b) => a - b);
  }

  occupiedChunks(): readonly number[] {
    return [...this.byChunk.keys()].sort((a, b) => a - b);
  }
}
