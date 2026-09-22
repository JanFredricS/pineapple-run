import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../src/model/geometry';
import { loadSpikeLevel } from '../../src/spike/data';
import {
  CHUNK_WIDTH,
  chunkSpans,
  cutSpan,
  LevelChunkSource,
  MAX_CUT_SHIFT,
  MIN_CUT_CLEARANCE,
  MIN_PIECE_WIDTH,
  isStraightVertex,
  MIN_SPLIT_LENGTH,
  MIN_VERTEX_SPACING,
  sanitizePiece,
  STRAIGHT_SIN_TOL,
  surfaceYAt,
} from '../../src/terrain/chunks';
import { auditorProfile, auditorProfileConvex, denseArcCorner, zigZagComb } from './profiles';

const W = CHUNK_WIDTH;

/** A wiggly span with a vertex every `step` m. */
function wiggly(x0: number, x1: number, step: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let x = x0, i = 0; x <= x1 + 1e-9; x += step, i++) pts.push({ x, y: 10 + ((i * 7) % 5) * 0.3 });
  return pts;
}

function segDir(a: Vec2, b: Vec2): Vec2 {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

/** physics/engine.ts#addChain's ghost: `to` continued 1 m along from->to. */
function engineGhost(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: to.x + dx / len, y: to.y + dy / len };
}

/**
 * Across every seam between consecutive pieces, the engine's extrapolated ghost
 * on each side lies on the ray from the shared cut vertex through the
 * NEIGHBOUR's true adjacent vertex (Box2D uses the ghost only through the
 * direction of the ghost segment, so this is "ghost == true neighbour").
 */
function expectExactSeams(pieces: Vec2[][], sinTol = 1e-9): void {
  expect(pieces.length).toBeGreaterThan(1);
  for (let i = 1; i < pieces.length; i++) {
    const L = pieces[i - 1]!;
    const R = pieces[i]!;
    const cut = L.at(-1)!;
    expect(R[0]).toEqual(cut);
    const onRay = (ghost: Vec2, trueNeighbour: Vec2) => {
      const gx = ghost.x - cut.x;
      const gy = ghost.y - cut.y;
      const nx = trueNeighbour.x - cut.x;
      const ny = trueNeighbour.y - cut.y;
      const nl = Math.hypot(nx, ny);
      expect(Math.abs(gx * ny - gy * nx) / nl, `seam at x=${cut.x}`).toBeLessThan(sinTol); // collinear (|ghost - cut| = 1 m)
      expect(gx * nx + gy * ny).toBeGreaterThan(0); // same direction
    };
    onRay(engineGhost(L.at(-2)!, cut), R[1]!); // left piece's right ghost -> right piece's 2nd vertex
    onRay(engineGhost(R[1]!, cut), L.at(-2)!); // right piece's left ghost -> left piece's 2nd-to-last vertex
  }
}

const turnAngle = (a: Vec2, v: Vec2, b: Vec2) => {
  const ux = v.x - a.x;
  const uy = v.y - a.y;
  const wx = b.x - v.x;
  const wy = b.y - v.y;
  return Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy); // > 0 convex (y-down), < 0 concave
};

type SeamKind = 'segment' | 'straight' | 'concave' | 'convex';

/**
 * Checks every seam between consecutive pieces of one span against cutAt's
 * rules and returns the seam kinds, left to right:
 * - the pieces share the seam point bit-for-bit, stay within the shift bound
 *   and honour the spacing rule (no second sanitize happens);
 * - 'segment': the seam lies strictly inside a sanitized segment — exact ghosts;
 * - vertex seams: no segment in the window could have been split, and the
 *   vertex is the preferred one: leftmost straight (ghosts exact to
 *   STRAIGHT_SIN_TOL), else leftmost concave, else the smallest convex turn.
 */
function classifySeams(pieces: { chunk: number; points: Vec2[] }[], span: readonly Vec2[]): SeamKind[] {
  const clean = sanitizePiece(span)!;
  const kinds: SeamKind[] = [];
  for (const { points: p } of pieces) {
    for (let i = 1; i < p.length; i++) {
      const dx = p[i]!.x - p[i - 1]!.x;
      const dy = p[i]!.y - p[i - 1]!.y;
      expect(p[i]!.x).toBeGreaterThan(p[i - 1]!.x);
      expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(MIN_VERTEX_SPACING * MIN_VERTEX_SPACING);
    }
  }
  for (let s = 1; s < pieces.length; s++) {
    const L = pieces[s - 1]!.points;
    const R = pieces[s]!.points;
    const X = pieces[s]!.chunk * W;
    expect(pieces[s]!.chunk).toBe(pieces[s - 1]!.chunk + 1);
    const cut = L.at(-1)!;
    expect(R[0]).toEqual(cut);
    expect(cut.x).toBeGreaterThanOrEqual(X);
    expect(cut.x).toBeLessThanOrEqual(X + MAX_CUT_SHIFT + MIN_CUT_CLEARANCE + 1e-9);
    const c = clean.findIndex((v) => v.x === cut.x && v.y === cut.y);
    if (c < 0) {
      expect(clean.some((v, j) => j < clean.length - 1 && v.x < cut.x && clean[j + 1]!.x > cut.x)).toBe(true);
      expectExactSeams([L, R]);
      kinds.push('segment');
      continue;
    }
    // vertex seam: nothing in the window was splittable
    const inWin = (x: number) => x >= X && x <= X + MAX_CUT_SHIFT;
    const j0 = Math.max(0, clean.findIndex((v) => v.x >= X - 1) - 1);
    const j1 = clean.findIndex((v) => v.x > X + MAX_CUT_SHIFT + 1);
    const jEnd = j1 < 0 ? clean.length - 1 : j1;
    for (let j = j0; j < jEnd; j++) {
      const a = clean[j]!;
      const b = clean[j + 1]!;
      if (inWin((a.x + b.x) / 2)) expect(Math.hypot(b.x - a.x, b.y - a.y), `splittable segment at ${a.x}`).toBeLessThan(MIN_SPLIT_LENGTH);
    }
    const win: number[] = [];
    for (let j = Math.max(1, j0); j < Math.min(jEnd + 1, clean.length - 1); j++) if (inWin(clean[j]!.x)) win.push(j);
    const straight = win.filter((j) => isStraightVertex(clean[j - 1]!, clean[j]!, clean[j + 1]!));
    const concave = win.filter((j) => !straight.includes(j) && turnAngle(clean[j - 1]!, clean[j]!, clean[j + 1]!) < 0);
    const turn = (j: number) => turnAngle(clean[j - 1]!, clean[j]!, clean[j + 1]!);
    if (straight.length) {
      expect(c).toBe(straight[0]);
      expectExactSeams([L, R], STRAIGHT_SIN_TOL + 1e-9);
      kinds.push('straight');
    } else if (concave.length) {
      expect(c).toBe(concave[0]);
      kinds.push('concave');
    } else {
      for (const j of win) expect(turn(c)).toBeLessThanOrEqual(turn(j) + 1e-12);
      expect(turn(c)).toBeLessThan(Math.PI / win.length);
      kinds.push('convex');
    }
    // the pieces keep the true neighbours of the seam vertex
    expect(L.at(-2)).toEqual(clean[c - 1]);
    expect(R[1]).toEqual(clean[c + 1]);
  }
  return kinds;
}

describe('cutSpan', () => {
  it('cuts at every nominal boundary, pieces share the exact cut vertex, and seams are straight', () => {
    // vertices every 4 m hit every 40 m boundary exactly: cuts must move off the vertex
    for (const span of [wiggly(-40, 210, 4), wiggly(3.3, 170.1, 2.7)]) {
      const pieces = cutSpan(span);
      expect(pieces.length).toBeGreaterThan(3);
      for (let i = 1; i < pieces.length; i++) {
        const a = pieces[i - 1]!.points;
        const b = pieces[i]!.points;
        const cut = a[a.length - 1]!;
        expect(b[0]).toEqual(cut); // shared, bit-identical
        expect(pieces[i]!.chunk).toBe(pieces[i - 1]!.chunk + 1);
        // the cut lies strictly inside an original segment, clear of its vertices
        const seg = span.findIndex((p, j) => j < span.length - 1 && p.x < cut.x && span[j + 1]!.x > cut.x);
        expect(seg).toBeGreaterThanOrEqual(0);
        expect(cut.x - span[seg]!.x).toBeGreaterThanOrEqual(MIN_CUT_CLEARANCE - 1e-12);
        expect(span[seg + 1]!.x - cut.x).toBeGreaterThanOrEqual(MIN_CUT_CLEARANCE - 1e-12);
        // end segment of a is collinear with the first segment of b (ghost vertex == true neighbour)
        const da = segDir(a[a.length - 2]!, cut);
        const db = segDir(cut, b[1]!);
        expect(Math.abs(da.x * db.y - da.y * db.x)).toBeLessThan(1e-9);
        // cut within a couple of cm of the nominal boundary
        expect(Math.abs(cut.x - pieces[i]!.chunk * W)).toBeLessThanOrEqual(MIN_CUT_CLEARANCE + 1e-9);
      }
      // concatenating the pieces (minus cut points) restores the span exactly
      const rebuilt: Vec2[] = [];
      pieces.forEach((p, i) => rebuilt.push(...(i === 0 ? p.points : p.points.slice(1))));
      const cuts = new Set(pieces.slice(0, -1).map((p) => p.points[p.points.length - 1]!));
      expect(rebuilt.filter((p) => !cuts.has(p))).toEqual(span);
    }
  });

  it('does not make slivers near span ends', () => {
    const span = [
      { x: 39.97, y: 10 },
      { x: 80.02, y: 11 },
    ];
    const pieces = cutSpan(span);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.chunk).toBe(1);
    expect(MIN_PIECE_WIDTH).toBeGreaterThan(0.03);
  });

  it('skips over runs of micro segments to a segment long enough to cut', () => {
    const span: Vec2[] = [{ x: 30, y: 10 }];
    for (let i = 0; i < 10; i++) span.push({ x: 39.995 + i * 0.001, y: 10 });
    span.push({ x: 50, y: 10 });
    const pieces = cutSpan(span);
    expect(pieces).toHaveLength(2);
    const cut = pieces[0]!.points[pieces[0]!.points.length - 1]!;
    expect(cut.x).toBeGreaterThan(40.004);
  });

  it('audit S3-1 #1: a long dense run of sub-2 cm segments across several boundaries keeps every piece in its own chunk', () => {
    // sparse -> dense (1.5 cm spacing, too short for a clearance cut) from 35 m to 125 m -> sparse
    const span: Vec2[] = [];
    for (let x = 0; x < 35; x += 2.5) span.push({ x, y: 10 + Math.sin(x) * 0.2 });
    for (let i = 0; 35 + i * 0.015 < 125; i++) span.push({ x: 35 + i * 0.015, y: 10 + (i % 3) * 0.004 });
    for (let x = 125; x <= 170; x += 2.5) span.push({ x, y: 10 });
    const pieces = cutSpan(span);
    // one piece per chunk 0..4, in order
    expect(pieces.map((p) => p.chunk)).toEqual([0, 1, 2, 3, 4]);
    const tol = MAX_CUT_SHIFT + MIN_CUT_CLEARANCE + 1e-9;
    for (const { chunk, points } of pieces) {
      // each piece covers its own chunk's nominal range (up to the bounded cut shift)
      if (chunk > 0) expect(points[0]!.x).toBeGreaterThanOrEqual(chunk * W - 1e-9);
      expect(points[0]!.x).toBeLessThanOrEqual(Math.max(span[0]!.x, chunk * W) + tol);
      expect(points.at(-1)!.x).toBeGreaterThanOrEqual(Math.min(span.at(-1)!.x, (chunk + 1) * W) - 1e-9);
      expect(points.at(-1)!.x).toBeLessThanOrEqual(Math.min(span.at(-1)!.x, (chunk + 1) * W + tol));
    }
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]!.points[0]).toEqual(pieces[i - 1]!.points.at(-1));
    // a body anywhere on the span finds ground in the chunk it is in — or, within the
    // bounded cut shift just past a boundary, in the previous chunk (always loaded then:
    // the streaming window keeps >= 30 m behind every live body)
    const src = new LevelChunkSource({ spans: [{ id: 'dense', points: span }], friction: 0.9, restitution: 0.3 });
    for (let x = 0.25; x < 170; x += 0.25) {
      const k = Math.floor(x / W);
      const y = surfaceYAt(src.chunk(k), x) ?? (x - k * W <= tol ? surfaceYAt(src.chunk(k - 1), x) : null);
      expect(y, `x=${x}`).not.toBeNull();
    }
  });

  it('dense runs: cuts stay within the shift bound for many densities and offsets', () => {
    for (const step of [0.004, 0.011, 0.0199, 0.021, 0.03]) {
      for (const off of [0, 0.003, 0.0071]) {
        const span: Vec2[] = [];
        for (let i = 0; off + i * step <= 130; i++) span.push({ x: off + i * step, y: 10 });
        const pieces = cutSpan(span);
        const byChunk = new Map<number, number>();
        for (const p of pieces) byChunk.set(p.chunk, (byChunk.get(p.chunk) ?? 0) + 1);
        expect([...byChunk.keys()]).toEqual([0, 1, 2, 3]);
        for (const n of byChunk.values()) expect(n).toBe(1);
        for (const p of pieces.slice(0, -1)) {
          const c = p.points.at(-1)!.x - (p.chunk + 1) * W;
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(MAX_CUT_SHIFT + MIN_CUT_CLEARANCE + 1e-9);
        }
      }
    }
  });

  it('audit S3-2 #1: vertex-fallback seams are exact — each piece\'s ghost vertex points at the neighbour\'s true vertex', () => {
    // the auditor's profile: horizontal ending exactly at x = 40, then > 0.5 m of a 5 mm-spaced 45° incline
    const span = auditorProfile();
    const pieces = cutSpan(span);
    expect(pieces.map((p) => p.chunk)).toEqual([-1, 0, 1, 2]);
    const seam = pieces[1]!.points.at(-1)!; // chunk 0 | chunk 1, the boundary at x = 40
    expect(seam.x).toBeGreaterThan(40); // not the corner at x = 40
    expect(seam.x).toBeLessThanOrEqual(40 + MAX_CUT_SHIFT + MIN_CUT_CLEARANCE);
    expectExactSeams(pieces.map((p) => p.points));
    expectExactSeams(cutSpan(auditorProfileConvex()).map((p) => p.points));
    // and the same for a span whose dense run straddles several boundaries at different phases
    for (const off of [0, 0.0013, 0.0049]) {
      const zig: Vec2[] = [{ x: -3, y: 10 }];
      for (let i = 0; off + 38 + i * 0.005 < 125; i++) zig.push({ x: off + 38 + i * 0.005, y: 10 - Math.floor(i / 60) * 0.2 - (i % 60) * 0.004 });
      zig.push({ x: 140, y: 5 });
      expectExactSeams(cutSpan(zig).map((p) => p.points));
    }
  });

  it('audit S3-3 #1: the 179.7° zig-zag comb (x step 5 mm, y 9 <-> 11) is cut exactly, mid-tooth', () => {
    for (const off of [0, 0.0013, 0.0049, -0.005]) {
      const span = zigZagComb(38 + off, 125, 9, 11);
      const pieces = cutSpan(span);
      expect(pieces.map((p) => p.chunk)).toEqual([0, 1, 2, 3]);
      expect(classifySeams(pieces, span)).toEqual(['segment', 'segment', 'segment']);
    }
  });

  it('audit S3-3 #1: a fine comb too short to split (6.4 mm segments, ~77° turns) is cut at a valley (concave) vertex', () => {
    for (const off of [0, -0.005, 0.0021]) {
      const span = zigZagComb(38 + off, 125, 10, 10.004);
      const pieces = cutSpan(span);
      expect(classifySeams(pieces, span)).toEqual(['concave', 'concave', 'concave']);
    }
  });

  it('audit S3-3 #1: an all-convex dense crest is cut at its smallest turn (bounded < 180°/k)', () => {
    const span = denseArcCorner();
    const pieces = cutSpan(span);
    expect(pieces.map((p) => p.chunk)).toEqual([-1, 0, 1, 2]);
    expect(classifySeams(pieces, span)).toEqual(['segment', 'convex', 'segment']);
    // a crest with varying turns: the smallest one wins, not the first
    const crest: Vec2[] = [{ x: 0, y: 10 }];
    let y = 10;
    let slope = 0;
    for (let i = 0; i <= 120; i++) {
      crest.push({ x: 39.9 + i * 0.006, y });
      slope += [0.03, 0.02, 0.05, 0.012, 0.04][i % 5]! * 0.3;
      y += 0.006 * slope;
    }
    crest.push({ x: 60, y: y + 20 * slope });
    expect(classifySeams(cutSpan(crest), crest)).toEqual(['convex']);
  });

  it('audit S3-3 #2: sanitization cannot change the seam direction (auditor profile with a 1 mm near-duplicate)', () => {
    // (40,10) is 1 mm from (39.999,10) and is merged away; judged on the RAW neighbours
    // (40,10)|(40.012,9.988) the vertex (40.006,9.994) looks straight, but its real left
    // neighbour after sanitizing is (39.999,10) — a turn. A dense 6 mm 45° run forces the fallback.
    const span: Vec2[] = [{ x: 0, y: 10 }, { x: 39.999, y: 10 }, { x: 40, y: 10 }, { x: 40.006, y: 9.994 }, { x: 40.012, y: 9.988 }];
    for (let i = 1; 40.012 + i * 0.006 < 41; i++) span.push({ x: 40.012 + i * 0.006, y: 9.988 - i * 0.006 });
    span.push({ x: 50, y: 0 });
    const pieces = cutSpan(span);
    expect(pieces.map((p) => p.chunk)).toEqual([0, 1]);
    const [L, R] = pieces.map((p) => p.points);
    expect(L!.some((v) => v.x === 40 && v.y === 10)).toBe(false); // the near-duplicate is gone ...
    expect(L!.at(-1)!.x).toBeGreaterThan(40.006); // ... and the seam is not the vertex it made look straight
    expectExactSeams([L!, R!]); // ghosts computed from the pieces physics actually gets
    expect(classifySeams(pieces, span)).toEqual(['straight']);
  });

  it('seams follow the rules on random dense profiles', () => {
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const kinds = new Set<string>();
    for (let trial = 0; trial < 240; trial++) {
      const span: Vec2[] = [{ x: 1, y: 10 }];
      let x = 1;
      let y = 10;
      let slope = 0;
      const mode = trial % 6;
      while (x < 121) {
        const near = Math.abs(x - Math.round(x / W) * W) < 1; // dense only around the boundaries
        const dx = near ? (mode === 0 ? 0.001 + rnd() * 0.018 : mode === 3 || mode === 5 ? 0.001 + rnd() * 0.003 : 0.001 + rnd() * 0.006) : 0.5;
        x += dx;
        if (!near) {
          slope = -0.8;
          span.push({ x, y });
          continue;
        }
        if (mode === 0) y = 10 + (rnd() - 0.5) * 2; // random comb
        else if (mode === 1) y += dx * (rnd() < 0.5 ? 1 : -1); // ±45° zig-zag, some straight runs
        else if (mode === 2) y += dx * 0.3; // straight incline, random spacing (incl. sub-5 mm)
        else if (mode === 3) y = 10 + Math.sin(x * 40) * 0.05; // wavy
        else if (mode === 4) y += dx * (rnd() - 0.5) * 0.2; // gentle random walk
        else {
          slope += rnd() * 0.004; // an all-convex crest across the boundary
          y += dx * slope;
        }
        span.push({ x, y });
      }
      span.push({ x: 140, y: 5 });
      const pieces = cutSpan(span);
      expect(pieces.map((p) => p.chunk)).toEqual([0, 1, 2, 3]);
      for (const k of classifySeams(pieces, span)) kinds.add(k);
      // the pieces hold every sanitized vertex
      const seen = new Set<string>();
      for (const p of pieces) for (const v of p.points) seen.add(`${v.x},${v.y}`);
      for (const v of sanitizePiece(span)!) expect(seen.has(`${v.x},${v.y}`)).toBe(true);
    }
    expect([...kinds].sort()).toEqual(['concave', 'convex', 'segment', 'straight']);
  });

  it('isStraightVertex: collinear same-direction only, within STRAIGHT_SIN_TOL', () => {
    const o = { x: 0, y: 0 };
    expect(isStraightVertex({ x: -1, y: -1 }, o, { x: 0.005, y: 0.005 })).toBe(true);
    expect(isStraightVertex({ x: -1, y: 0 }, o, { x: 1, y: 0.5 * STRAIGHT_SIN_TOL })).toBe(true);
    expect(isStraightVertex({ x: -1, y: 0 }, o, { x: 1, y: 2 * STRAIGHT_SIN_TOL })).toBe(false);
    expect(isStraightVertex({ x: -1, y: 0 }, o, { x: -2, y: 0 })).toBe(false); // reversal: cross 0, dot < 0
    expect(isStraightVertex({ x: -0.005, y: 2 }, o, { x: 0.005, y: 2 })).toBe(false); // comb tooth
  });

  it('merges near-duplicate vertices and drops fully degenerate spans', () => {
    expect(
      sanitizePiece([
        { x: 0, y: 0 },
        { x: 0.001, y: 0 },
        { x: 1, y: 0 },
        { x: 1.0001, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1.0001, y: 0 },
    ]);
    expect(sanitizePiece([{ x: 0, y: 0 }, { x: 0.0001, y: 0 }])).toBeNull();
    expect(cutSpan([{ x: 5, y: 0 }, { x: 5.0001, y: 0 }])).toEqual([]);
  });

  it('never bridges a gap: pieces of different spans stay separate', () => {
    const byChunk = chunkSpans([wiggly(0, 50, 2), wiggly(53, 130, 2)]);
    const all = [...byChunk.values()].flat();
    for (const piece of all) {
      const crossesGap = piece.some((p) => p.x > 50 && p.x < 53);
      expect(crossesGap).toBe(false);
    }
    expect(byChunk.get(1)!.length).toBe(2); // chunk 1 holds the end of span A and the start of span B
  });
});

describe('surfaceYAt', () => {
  it('interpolates the surface and reports gaps as null', () => {
    const src = new LevelChunkSource({
      spans: [
        { id: 'a', points: [{ x: 0, y: 10 }, { x: 10, y: 12 }] },
        { id: 'b', points: [{ x: 12, y: 8 }, { x: 30, y: 8 }] },
      ],
      friction: 0.9,
      restitution: 0.3,
    });
    const c = src.chunk(0);
    expect(surfaceYAt(c, 5)).toBeCloseTo(11, 12);
    expect(surfaceYAt(c, 11)).toBeNull();
    expect(surfaceYAt(c, 20)).toBe(8);
    expect(surfaceYAt(c, 35)).toBeNull();
  });
});

describe('LevelChunkSource', () => {
  it('chunks the S0 spike level (walls, washboard) with correct bounds and returns fresh copies', () => {
    const level = loadSpikeLevel();
    const src = new LevelChunkSource(level.terrain);
    expect(src.firstChunk).toBe(-2);
    expect(src.lastChunk).toBe(3);
    const c = src.chunk(0);
    expect(c.x0).toBe(0);
    expect(c.x1).toBe(W);
    expect(c.extent!.minX).toBeCloseTo(0, 1);
    c.pieces[0]![0]!.y = 999;
    expect(src.chunk(0).pieces[0]![0]!.y).not.toBe(999);
    expect(src.chunk(0)).toEqual(src.chunk(0));
    expect(src.chunk(50).pieces).toEqual([]);
    expect(src.chunk(50).extent).toBeNull();
    // every original vertex appears in some chunk
    const all = new Set<string>();
    for (let k = src.firstChunk; k <= src.lastChunk; k++) for (const p of src.chunk(k).pieces) for (const v of p) all.add(`${v.x},${v.y}`);
    for (const s of level.terrain.spans) for (const v of s.points) expect(all.has(`${v.x},${v.y}`)).toBe(true);
  });
});
