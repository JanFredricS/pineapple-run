/**
 * Terrain skinning geometry (pure; no Pixi). Turns terrain polylines into
 * triangle meshes the renderer uploads once per terrain change:
 *
 *  - chainPolylines: merge polylines that share endpoints into continuous
 *    chains (so edge strips have no seams across span/chunk joins) while
 *    real gaps stay gaps.
 *  - fillMesh: vertical quads from the surface down to a flat bottom, with
 *    world-space tiling UVs.
 *  - shadeMesh: same footprint; v = depth below the surface / shade depth
 *    (the texture clamps, so everything deeper than `depth` gets full shade).
 *    Degenerate (zero-area) triangles are allowed where rows collapse.
 *  - edgeStrip: a band offset along mitred normals (`above` outward, `below`
 *    into the solid), u = arc length. Chain ends optionally wrap down the
 *    cliff face so a gap shows a finished lip.
 *
 * Conventions: world metres, y-down; the solid side is below the line
 * (larger y). All emitted triangles are clockwise ON SCREEN (y-down), i.e.
 * positive signed area with the standard `cross` formula — tests check it.
 */

import type { Vec2 } from '../model/geometry';

export interface MeshData {
  /** x,y pairs (metres). */
  positions: Float32Array;
  /** u,v pairs. */
  uvs: Float32Array;
  indices: Uint32Array;
}

const EPS = 1e-6;

/**
 * Default join tolerance: float round-off only. Level validation defines no
 * minimum gap, so any real separation — however small — must stay a gap in
 * the render exactly as it does in physics. Pieces that genuinely continue
 * each other (split spans, streamed chunks) share the SAME endpoint value;
 * the only difference that can creep in is the body-transform arithmetic
 * (t.x + c·p.x − s·p.y), which is ~1e-15 m for metre-scale coordinates.
 */
export const JOIN_TOLERANCE_M = 1e-9;

/**
 * Merge polylines whose end point coincides (within `tol`) with another's
 * start point. Input polylines run left -> right; output chains too, sorted
 * by their first x. Degenerate (< 2 point) polylines are dropped; exactly
 * repeated consecutive points are removed.
 */
export function chainPolylines(polylines: readonly (readonly Vec2[])[], tol = JOIN_TOLERANCE_M): Vec2[][] {
  const lines = polylines
    .map((pl) => dedupe(pl))
    .filter((pl) => pl.length >= 2)
    .sort((a, b) => a[0]!.x - b[0]!.x || a[0]!.y - b[0]!.y);
  const used = new Array<boolean>(lines.length).fill(false);
  const chains: Vec2[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain = [...lines[i]!];
    // extend forward greedily
    for (;;) {
      const tail = chain[chain.length - 1]!;
      const j = lines.findIndex((l, k) => !used[k] && near(l[0]!, tail, tol));
      if (j < 0) break;
      used[j] = true;
      chain.push(...lines[j]!.slice(1));
    }
    chains.push(chain);
  }
  // A chain may also be the continuation of a later-found chain's tail
  // (inputs out of order); fold those too.
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < chains.length && !merged; a++) {
      for (let b = 0; b < chains.length && !merged; b++) {
        if (a === b) continue;
        if (near(chains[a]![chains[a]!.length - 1]!, chains[b]![0]!, tol)) {
          chains[a]!.push(...chains[b]!.slice(1));
          chains.splice(b, 1);
          merged = true;
        }
      }
    }
  }
  return chains.sort((a, b) => a[0]!.x - b[0]!.x);
}

function near(a: Vec2, b: Vec2, tol: number): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

function dedupe(pl: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pl) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Deepest point of a set of chains (largest y). */
export function maxY(chains: readonly (readonly Vec2[])[]): number {
  let m = -Infinity;
  for (const c of chains) for (const p of c) m = Math.max(m, p.y);
  return m;
}

/**
 * Fill under a polyline down to `bottomY` (must be below every point).
 * UVs: u = x / tile, v = y / tile (world-anchored, so adjacent chunks and
 * gaps line up with no texture swimming). Vertices: [top_i, bottom_i] pairs.
 */
export function fillMesh(chain: readonly Vec2[], bottomY: number, metresPerTile: number): MeshData {
  const n = chain.length;
  const positions = new Float32Array(n * 4);
  const uvs = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = chain[i]!;
    const bottom = Math.max(bottomY, p.y);
    positions.set([p.x, p.y, p.x, bottom], i * 4);
    uvs.set([p.x / metresPerTile, p.y / metresPerTile, p.x / metresPerTile, bottom / metresPerTile], i * 4);
  }
  return { positions, uvs, indices: stripIndices(n) };
}

/**
 * Depth-shade overlay: three vertex rows per point — surface (v=0),
 * surface+depth (v=1) and the fill bottom (v=1 + extra; clamped texture).
 */
export function shadeMesh(chain: readonly Vec2[], bottomY: number, depth: number): MeshData {
  const n = chain.length;
  const positions = new Float32Array(n * 6);
  const uvs = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const p = chain[i]!;
    // never extend below the fill: rows collapse where the fill is shallower than `depth`
    const bottom = Math.max(bottomY, p.y);
    const mid = Math.min(p.y + depth, bottom);
    const u = p.x;
    positions.set([p.x, p.y, p.x, mid, p.x, bottom], i * 6);
    uvs.set([u, 0, u, (mid - p.y) / depth, u, (bottom - p.y) / depth], i * 6);
  }
  // two stacked strips: rows (0,1) and (1,2)
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let r = 0; r < 2; r++) {
      const a = i * 3 + r; // this column, upper
      const b = a + 1; // this column, lower
      const c = (i + 1) * 3 + r; // next column, upper
      const d = c + 1; // next column, lower
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, uvs, indices: Uint32Array.from(indices) };
}

/** Indices for a strip of [top_i, bottom_i] vertex pairs, clockwise on screen. */
function stripIndices(n: number): Uint32Array {
  const idx = new Uint32Array(Math.max(0, n - 1) * 6);
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2; // top i
    const b = a + 1; // bottom i
    const c = a + 2; // top i+1
    const d = a + 3; // bottom i+1
    idx.set([a, c, b, b, c, d], i * 6);
  }
  return idx;
}

/**
 * Unit normals pointing INTO the solid (for a left->right surface, that is
 * "down"): for direction d = (dx, dy) the inward normal is (-dy, dx).
 * Interior vertices get the mitre direction scaled by 1/cos(half-angle),
 * clamped to `miterLimit`, so the strip keeps constant thickness at bends.
 */
export function miterNormals(points: readonly Vec2[], miterLimit = 2.5): Vec2[] {
  const n = points.length;
  const segN: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    segN.push({ x: -(b.y - a.y) / len, y: (b.x - a.x) / len });
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = segN[i - 1];
    const next = segN[i];
    if (!prev || !next) {
      out.push({ ...(prev ?? next ?? { x: 0, y: 1 }) });
      continue;
    }
    let mx = prev.x + next.x;
    let my = prev.y + next.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      // 180° fold-back: use the incoming normal
      out.push({ ...prev });
      continue;
    }
    mx /= ml;
    my /= ml;
    const cosHalf = mx * next.x + my * next.y;
    const k = Math.min(1 / Math.max(cosHalf, 1e-9), miterLimit);
    out.push({ x: mx * k, y: my * k });
  }
  return out;
}

export interface EdgeStripOptions {
  /** Metres the strip extends outward (above the surface). */
  above: number;
  /** Metres the strip extends into the solid. */
  below: number;
  /** Metres of arc length per texture repeat (u). */
  metresPerTile: number;
  /** If > 0, extend the chain down each end's cliff face by this much (gap lips). */
  wrapDepth?: number;
  miterLimit?: number;
}

/**
 * Edge strip along a chain. Vertices come in [outer_i, inner_i] pairs
 * (outer = p - n*above, inner = p + n*below), u = arc length / tile,
 * v = 0 (outer) .. 1 (inner).
 */
export function edgeStrip(chain: readonly Vec2[], opts: EdgeStripOptions): MeshData {
  const pts = withWrappedEnds(chain, opts.wrapDepth ?? 0);
  const normals = miterNormals(pts, opts.miterLimit ?? 2.5);
  const n = pts.length;
  const positions = new Float32Array(n * 4);
  const uvs = new Float32Array(n * 4);
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    if (i > 0) arc += Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y);
    const nr = normals[i]!;
    const u = arc / opts.metresPerTile;
    positions.set([p.x - nr.x * opts.above, p.y - nr.y * opts.above, p.x + nr.x * opts.below, p.y + nr.y * opts.below], i * 4);
    uvs.set([u, 0, u, 1], i * 4);
  }
  return { positions, uvs, indices: stripIndices(n) };
}

/**
 * Prepend/append a vertical drop at each end of the chain: the strip then
 * wraps over the lip and down the cliff face. The drop is on the solid side
 * (x unchanged, y + depth) so normals still point into the solid.
 */
export function withWrappedEnds(chain: readonly Vec2[], depth: number): Vec2[] {
  if (depth <= 0 || chain.length < 2) return chain.map((p) => ({ ...p }));
  const first = chain[0]!;
  const last = chain[chain.length - 1]!;
  return [{ x: first.x, y: first.y + depth }, ...chain.map((p) => ({ ...p })), { x: last.x, y: last.y + depth }];
}

/** Signed area*2 of triangle (a,b,c) using the standard cross; > 0 = clockwise on a y-down screen. */
export function triangleArea2(positions: Float32Array, i0: number, i1: number, i2: number): number {
  const ax = positions[i0 * 2]!;
  const ay = positions[i0 * 2 + 1]!;
  const bx = positions[i1 * 2]!;
  const by = positions[i1 * 2 + 1]!;
  const cx = positions[i2 * 2]!;
  const cy = positions[i2 * 2 + 1]!;
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Median y of all chain points (vertex-weighted; sampling-density dependent — see horizonReferenceY). */
export function medianY(chains: readonly (readonly Vec2[])[]): number {
  const ys = chains.flatMap((c) => c.map((p) => p.y)).sort((a, b) => a - b);
  if (ys.length === 0) return 0;
  return ys[Math.floor(ys.length / 2)]!;
}

/**
 * Horizon reference for the parallax layers: the median terrain height over
 * HORIZONTAL DISTANCE — the weighted median of segment mid-heights, each
 * segment weighted by its |dx|. Equivalent to sampling the profile uniformly
 * in x, so how densely a stretch is sampled does not matter (a 2 m pit with
 * 100 vertices weighs 2 m, not 100 votes). Vertical segments carry no weight.
 * Falls back to the vertex median when the terrain has no horizontal extent.
 */
export function horizonReferenceY(chains: readonly (readonly Vec2[])[]): number {
  const segs: { y: number; w: number }[] = [];
  let total = 0;
  for (const c of chains) {
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1]!;
      const b = c[i]!;
      const w = Math.abs(b.x - a.x);
      if (w <= 0) continue;
      segs.push({ y: (a.y + b.y) / 2, w });
      total += w;
    }
  }
  if (total <= 0) return medianY(chains);
  segs.sort((p, q) => p.y - q.y);
  let acc = 0;
  for (const s of segs) {
    acc += s.w;
    if (acc >= total / 2) return s.y;
  }
  return segs[segs.length - 1]!.y;
}
