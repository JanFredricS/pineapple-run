import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../src/model/geometry';
import { loadSpikeLevel } from '../../src/spike/data';
import {
  CHUNK_WIDTH,
  chunkSpans,
  cutSpan,
  LevelChunkSource,
  MIN_CUT_CLEARANCE,
  MIN_PIECE_WIDTH,
  sanitizePiece,
} from '../../src/terrain/chunks';

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
