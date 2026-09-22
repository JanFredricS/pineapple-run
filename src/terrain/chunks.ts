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
 *   to keep the ghost error harmless (see cutAt).
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
 * cut falls back to a segment midpoint or a vertex (see cutAt), so a piece never strays far from
 * its chunk's nominal bounds whatever the input's vertex density.
 */
export const MAX_CUT_SHIFT = 0.5;

const maxShift = (width: number) => Math.min(MAX_CUT_SHIFT, width / 8);

/**
 * Largest |sin(turn)| at which a vertex counts as straight (an exact vertex
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
 * Choose the cut for nominal boundary X inside `pts` (one SANITIZED span, see
 * cutSpan), or null when this boundary is not cut (the span starts or ends
 * within MIN_PIECE_WIDTH of it — that boundary's sliver stays with its
 * neighbour). The window is [lowX, limit] = [max(X, afterX +
 * MIN_PIECE_WIDTH), X + maxShift]. In order of preference:
 *
 * 1. Segment cut, x-clearance (the normal case): interpolated strictly inside
 *    a segment, >= MIN_CUT_CLEARANCE in x from both of its vertices, at the
 *    first such position at or after X. Exact seam (the seam rule above).
 *
 * 2. Segment cut, length-clearance: the midpoint of the first segment at
 *    least MIN_SPLIT_LENGTH long whose midpoint lies in the window. Also
 *    exact. This catches segments that are short in x only (audit S3-3 #1's
 *    5 mm-pitch, 2 m-tall zig-zag is cut in the middle of a tooth).
 *
 * 3. Vertex seam (every segment near X is shorter than MIN_SPLIT_LENGTH or
 *    2 * MIN_CUT_CLEARANCE in x): both pieces end on a vertex c, each with
 *    an extrapolated (straight-on) ghost. Box2D uses a ghost only to decide
 *    how the chain end's VERTEX region collides; the segments' faces collide
 *    either way. Candidates are the vertices in the window, preferring
 *    (leftmost within a class):
 *    a. a STRAIGHT vertex (isStraightVertex): the ghosts run along the true
 *       neighbouring segments — exact.
 *    b. a CONCAVE vertex (the surface turns up, a valley): a straight-on
 *       ghost only loses vertex contacts that a true concave ghost would
 *       snap onto a face normal anyway, and a body in a valley touches both
 *       faces, which both chains keep — no lip. (Measured on dense zig-zags:
 *       trajectories identical to one continuous chain.)
 *    c. otherwise every window vertex is convex: the one with the SMALLEST
 *       turn (compareTurn). A span's x strictly increases, so its direction
 *       angles lie in (-90°, 90°) and k consecutive convex vertices turn by
 *       less than 180° in total: the chosen turn is < 180°/k. Step 1 leaves
 *       every segment starting in the window < 2 cm in x, so a 0.5 m window
 *       holds k >= 24 vertices: the ghost error is < 7.5°, only at a convex
 *       vertex of a crest sampled every < 2 cm over the whole window
 *       (documented residual, audit S3-3 #1). Turns under ~0.57° are inside
 *       Box2D's own tolerance and change nothing.
 *
 *    Why not overlap the two chains (end the left piece past c and start the
 *    right one before it, so c is interior to both)? Measured against one
 *    continuous chain, duplicated coincident segments on two bodies double
 *    the contact constraints there and perturb bodies MORE than a vertex seam
 *    does: a box sliding over a dense convex kink deviated 0.22 m with an
 *    overlap vs 0.002 m with the vertex seam; on a dense fine comb 0.08 m vs
 *    0 (concave vertex); a forced overlap on a dense straight incline, where
 *    the butt seam is exact, still deviated 0.03 m.
 *
 * The decision uses the sanitized span, i.e. exactly the neighbours the
 * pieces will have (audit S3-3 #2), and only + − × comparisons (audit S3-3
 * #4), so it is identical on every engine.
 *
 * Invariant (relied on by cutSpan): a returned cut lies in
 * [lowX, limit + MIN_CUT_CLEARANCE]. (A vertex beyond the limit is taken only
 * when the window holds no vertex at all: then it is the right end of a
 * segment step 1 skipped, so less than 2 * MIN_CUT_CLEARANCE past lowX.)
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
    return segmentCut(i, { x: cx, y: a.y + (b.y - a.y) * t });
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
    return segmentCut(i, m);
  }
  // 3. Vertex seam.
  let firstV = -1;
  let concave = -1;
  let convex = -1;
  for (let c = Math.max(1, lo); c < n - 1; c++) {
    const v = pts[c]!;
    if (v.x < lowX) continue;
    if (xe - v.x < MIN_PIECE_WIDTH) break; // the rest is an end sliver
    if (v.x > limit) {
      if (firstV < 0) firstV = c; // the window holds no vertex: take the first one after it
      break;
    }
    const a = pts[c - 1]!;
    const b = pts[c + 1]!;
    if (isStraightVertex(a, v, b)) return vertexCut(c, v);
    if (firstV < 0) firstV = c;
    if (turnCross(a, v, b) < 0) {
      if (concave < 0) concave = c;
    } else if (convex < 0 || compareTurn(a, v, b, pts[convex - 1]!, pts[convex]!, pts[convex + 1]!) < 0) {
      convex = c;
    }
  }
  const c = concave >= 0 ? concave : convex >= 0 ? convex : firstV;
  return c >= 0 ? vertexCut(c, pts[c]!) : null;
}

const vertexCut = (c: number, v: Vec2): Cut => ({ leftUpTo: c + 1, leftExtra: null, rightHead: { ...v }, resume: c + 1 });

/**
 * cross(v - a, b - v). Spans run left to right in y-down metres, so > 0 is a
 * CONVEX vertex (the surface turns down, away from the air: a crest), < 0 a
 * concave one (a valley), 0 collinear.
 */
function turnCross(a: Vec2, v: Vec2, b: Vec2): number {
  return (v.x - a.x) * (b.y - v.y) - (v.y - a.y) * (b.x - v.x);
}

/**
 * True iff segments a->v and v->b point the same way to within
 * STRAIGHT_SIN_TOL: dot > 0 and cross² <= tol² * |u|² * |w|².
 *
 * Determinism (audit S3-3 #4): this and compareTurn use only IEEE-754 double
 * + − × and comparisons, which ECMAScript specifies exactly (round to nearest,
 * ties to even, no fused multiply-add), so every conforming engine computes
 * the same booleans for the same inputs — unlike Math.sqrt/hypot/atan2, which
 * the spec lets implementations approximate. Candidates are then chosen by
 * class and position (leftmost), with a strict comparison, so no near-tie can
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

/**
 * Sign of turn(a1,v1,b1) − turn(a2,v2,b2) for two CONVEX, non-straight
 * vertices (cross > 0), without sqrt/atan2: the turn angle θ = atan2(cross,
 * dot) lies in (0, π) where cot θ = dot / cross is strictly decreasing, so
 * θ1 < θ2 ⇔ dot1 · cross2 > dot2 · cross1 (cross > 0, no sign flips). Rounded
 * products may order a near-tie arbitrarily, but identically on every engine.
 */
export function compareTurn(a1: Vec2, v1: Vec2, b1: Vec2, a2: Vec2, v2: Vec2, b2: Vec2): number {
  const dot = (a: Vec2, v: Vec2, b: Vec2) => (v.x - a.x) * (b.x - v.x) + (v.y - a.y) * (b.y - v.y);
  const l = dot(a1, v1, b1) * turnCross(a2, v2, b2);
  const r = dot(a2, v2, b2) * turnCross(a1, v1, b1);
  return l > r ? -1 : l < r ? 1 : 0;
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
 * Cut one span into pieces at every nominal chunk boundary it crosses.
 * Each piece is tagged with the chunk it covers: a piece runs from the cut
 * for boundary k*W (or the span start) to the cut for boundary (k+1)*W (or
 * the span end), and belongs to chunk k. Cuts sit in [k*W, k*W + ~maxShift]
 * (cutAt), so a piece covers its chunk's nominal range up to that shift. A
 * skipped boundary (span end within MIN_PIECE_WIDTH of it) folds the sliver
 * into the neighbouring piece: a span starting just before boundary k*W
 * belongs to chunk k; one ending just after it stays in chunk k-1.
 *
 * The span is sanitized ONCE, before any cut decision (audit S3-3 #2): the
 * cut logic (clearances, vertex classes) sees exactly the vertices the
 * pieces will contain, and the pieces are not re-sanitized — they are runs of
 * consecutive sanitized vertices plus interpolated cut points >=
 * MIN_CUT_CLEARANCE (> MIN_VERTEX_SPACING) from their segment's vertices, so
 * every piece already satisfies the spacing rule. (Generated terrain is spaced
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
    pieces.push({ chunk: k - 1, points: current });
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
