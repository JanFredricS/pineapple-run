import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../src/model/geometry';
import {
  JOIN_TOLERANCE_FLOOR_M,
  chainPolylines,
  joinTolerance,
  edgeStrip,
  horizonReferenceY,
  fillMesh,
  maxY,
  medianY,
  miterNormals,
  shadeMesh,
  triangleArea2,
  withWrappedEnds,
  type MeshData,
} from '../../src/render/terrainMesh';

const hill: Vec2[] = [
  { x: 0, y: 5 },
  { x: 2, y: 4 },
  { x: 4, y: 4.5 },
  { x: 5, y: 3 }, // steep kicker
  { x: 6, y: 5.5 },
  { x: 9, y: 5 },
];

function vert(m: MeshData, i: number): Vec2 {
  return { x: m.positions[i * 2]!, y: m.positions[i * 2 + 1]! };
}

function expectClockwise(m: MeshData, allowDegenerate = false): void {
  expect(m.indices.length % 3).toBe(0);
  const nVerts = m.positions.length / 2;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
    expect(Math.max(a, b, c)).toBeLessThan(nVerts);
    const area = triangleArea2(m.positions, a, b, c);
    if (allowDegenerate) expect(area).toBeGreaterThanOrEqual(-1e-6);
    else expect(area).toBeGreaterThan(0);
  }
}

describe('chainPolylines', () => {
  it('merges polylines sharing endpoints, in any input order', () => {
    const a = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const b = [{ x: 1, y: 0 }, { x: 2, y: 1 }];
    const c = [{ x: 2, y: 1 }, { x: 3, y: 1 }];
    const chains = chainPolylines([c, a, b]);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.map((p) => p.x)).toEqual([0, 1, 2, 3]);
  });

  it('keeps real gaps as separate chains, sorted by x', () => {
    const right = [{ x: 5, y: 0 }, { x: 8, y: 0 }];
    const left = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
    const chains = chainPolylines([right, left]);
    expect(chains.map((c) => c[0]!.x)).toEqual([0, 5]);
  });

  it('joins only float-identical endpoints; drops degenerate lines and duplicate points', () => {
    const chains = chainPolylines([
      [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 1, y: 0 }, { x: 2, y: 0 }],
      [{ x: 9, y: 9 }],
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toHaveLength(3);
    // transform round-off (as produced by rotating/translating chunk bodies) still joins
    const t = 0.3;
    const p = { x: 1, y: 0 };
    const rt = { x: Math.cos(t) * (Math.cos(-t) * p.x - Math.sin(-t) * p.y) - Math.sin(t) * (Math.sin(-t) * p.x + Math.cos(-t) * p.y), y: 0 };
    expect(chainPolylines([[{ x: 0, y: 0 }, p], [rt, { x: 2, y: 0 }]])).toHaveLength(1);
  });

  it('keeps tiny but real gaps near the origin (level validation has no minimum gap)', () => {
    for (const gap of [5e-5, 1e-6]) {
      const chains = chainPolylines([
        [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        [{ x: 1 + gap, y: 0 }, { x: 2, y: 0 }],
      ]);
      expect(chains, `gap ${gap}`).toHaveLength(2);
    }
    expect(joinTolerance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(JOIN_TOLERANCE_FLOOR_M);
    expect(joinTolerance({ x: 1, y: 0 }, { x: 1, y: 0 })).toBe(4 * 2 ** -23); // 4 float32 ulps of 1 m
  });

  it('joins chunk seams through float32 body transforms at x ≈ 20 000 m, keeps 1 cm gaps', () => {
    const f = Math.fround;
    // Chunk k is a static body at a (double) origin that Box2D stores as float32;
    // its chain points are stored body-local in doubles (manifest). The renderer
    // reconstructs world = origin_f32 + local. A shared mathematical endpoint X
    // is therefore off by that chunk's origin rounding error.
    let maxSeamError = 0;
    let joined = 0;
    for (let k = 0; k < 200; k++) {
      const oA = 19_950 + k * 0.731 + 0.0001234; // arbitrary non-representable origins
      const oB = oA + 50.000_0567;
      const X = oA + 49.99_31; // shared endpoint (world, double)
      const Y = 3.217;
      const worldA = (o: number, px: number, py: number) => ({ x: f(o) + (px - o), y: f(4.1) + (py - 4.1) });
      const endA = worldA(oA, X, Y);
      const startB = worldA(oB, X, Y);
      maxSeamError = Math.max(maxSeamError, Math.abs(endA.x - startB.x));
      const chains = chainPolylines([
        [worldA(oA, oA, 3), endA],
        [startB, worldA(oB, oB + 40, 3)],
      ]);
      if (chains.length === 1) joined++;
      // a genuine 1 cm gap at the same place stays a gap
      const gapped = chainPolylines([
        [worldA(oA, oA, 3), endA],
        [{ x: startB.x + 0.01, y: startB.y }, worldA(oB, oB + 40, 3)],
      ]);
      expect(gapped).toHaveLength(2);
    }
    // the scenario is real: seams differ by far more than double round-off
    expect(maxSeamError).toBeGreaterThan(1e-4);
    expect(joined).toBe(200);
    expect(joinTolerance({ x: 20_000, y: 0 }, { x: 20_000, y: 0 })).toBeLessThan(0.01);
  });

  it('maxY / medianY', () => {
    expect(maxY([hill])).toBe(5.5);
    expect(medianY([hill])).toBe(5);
    expect(medianY([])).toBe(0);
  });

  it('horizon reference is invariant under collinear resampling of the same geometry', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    expect(horizonReferenceY([line])).toBeCloseTo(5, 12);
    // the auditor's case: add the collinear point (1,1)
    expect(horizonReferenceY([[line[0]!, { x: 1, y: 1 }, line[1]!]])).toBeCloseTo(5, 12);
    // arbitrary non-uniform collinear subdivisions of a multi-segment profile
    const profile = [{ x: 0, y: 4 }, { x: 3, y: 1 }, { x: 7, y: 1 }, { x: 8, y: 9 }, { x: 20, y: 6 }];
    const base = horizonReferenceY([profile]);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 20; trial++) {
      const sub: { x: number; y: number }[] = [profile[0]!];
      for (let i = 1; i < profile.length; i++) {
        const a = profile[i - 1]!;
        const b = profile[i]!;
        const ts = Array.from({ length: Math.floor(rnd() * 6) }, rnd).sort((p, q) => p - q);
        for (const t of ts) sub.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        sub.push(b);
      }
      // also split into separate touching polylines at a random vertex
      const cut = 1 + Math.floor(rnd() * (sub.length - 2));
      expect(horizonReferenceY([sub])).toBeCloseTo(base, 9);
      expect(horizonReferenceY([sub.slice(0, cut + 1), sub.slice(cut)])).toBeCloseTo(base, 9);
    }
  });

  it('horizon reference is weighted by horizontal distance, not vertex count', () => {
    // 100 m of flat ground at y=2 (2 vertices) + a 2 m pit at y=30 sampled with 101 vertices
    const flat = [{ x: 0, y: 2 }, { x: 100, y: 2 }];
    const pit = Array.from({ length: 101 }, (_, i) => ({ x: 100 + i * 0.02, y: 30 }));
    expect(medianY([flat, pit])).toBe(30); // the vertex median follows the dense pit
    expect(horizonReferenceY([flat, pit])).toBe(2);
    // a sampled curve converges as sampling densifies
    const dense = Array.from({ length: 1001 }, (_, i) => ({ x: i * 0.1, y: 2 + Math.sin(i * 0.1) }));
    const sparse = dense.filter((_, i) => i % 10 === 0);
    expect(horizonReferenceY([dense])).toBeCloseTo(horizonReferenceY([sparse]), 1);
    // exact: the median of a uniform ramp is its middle height
    expect(horizonReferenceY([[{ x: 0, y: 0 }, { x: 10, y: 10 }]])).toBeCloseTo(5, 12);
    // vertical-only / empty input falls back safely
    expect(horizonReferenceY([[{ x: 1, y: 0 }, { x: 1, y: 4 }]])).toBe(4);
    expect(horizonReferenceY([])).toBe(0);
  });
});

describe('fillMesh', () => {
  const m = fillMesh(hill, 20, 4);

  it('is a strip of top/bottom pairs with clockwise (on-screen) triangles', () => {
    expect(m.positions.length).toBe(hill.length * 4);
    expect(m.indices.length).toBe((hill.length - 1) * 6);
    expectClockwise(m);
  });

  it('tops follow the surface, bottoms are flat', () => {
    hill.forEach((p, i) => {
      expect(vert(m, i * 2)).toEqual(p);
      expect(vert(m, i * 2 + 1)).toEqual({ x: p.x, y: 20 });
    });
  });

  it('uses world-anchored UVs (u = x / tile, v = y / tile)', () => {
    expect(m.uvs[2 * 4 + 1]).toBeCloseTo(4.5 / 4); // top of point 2: v
    expect(m.uvs[4]).toBeCloseTo(2 / 4); // top of point 1: u
    expect(m.uvs[3]).toBeCloseTo(20 / 4);
  });

  it('never inverts when the bottom is above a point', () => {
    const inv = fillMesh(hill, 4, 4);
    expectClockwise(inv, true);
  });
});

describe('shadeMesh', () => {
  it('three rows per point; mid row clamped to the fill bottom', () => {
    const m = shadeMesh(hill, 6, 1.5);
    expect(m.positions.length).toBe(hill.length * 6);
    expectClockwise(m, true);
    hill.forEach((p, i) => {
      const top = vert(m, i * 3);
      const mid = vert(m, i * 3 + 1);
      const bottom = vert(m, i * 3 + 2);
      expect(top).toEqual(p);
      expect(mid.y).toBeCloseTo(Math.min(p.y + 1.5, 6));
      expect(bottom.y).toBe(6);
      expect(mid.y).toBeLessThanOrEqual(bottom.y);
      // v: 0 at the surface, 1 at shade depth
      expect(m.uvs[i * 6 + 1]).toBe(0);
      if (p.y + 1.5 <= 6) expect(m.uvs[i * 6 + 3]).toBeCloseTo(1);
    });
  });
});

describe('edge strip', () => {
  const opts = { above: 0.2, below: 0.5, metresPerTile: 3 };

  it('offsets outward by `above` and inward by `below` along the normal', () => {
    const flat = [{ x: 0, y: 2 }, { x: 3, y: 2 }, { x: 6, y: 2 }];
    const m = edgeStrip(flat, opts);
    flat.forEach((p, i) => {
      expect(vert(m, i * 2).y).toBeCloseTo(p.y - 0.2); // outer (up, y-down world)
      expect(vert(m, i * 2 + 1).y).toBeCloseTo(p.y + 0.5); // inner (into the solid)
      expect(vert(m, i * 2).x).toBeCloseTo(p.x);
    });
    expectClockwise(m);
  });

  it('keeps constant thickness at bends (mitred) and u follows arc length', () => {
    const m = edgeStrip(hill, opts);
    expectClockwise(m);
    const normals = miterNormals(hill);
    // perpendicular distance from each surface point to the inner offset line, measured along the adjacent segment normal
    for (let i = 1; i < hill.length - 1; i++) {
      const p = hill[i]!;
      const q = hill[i + 1]!;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const segN = { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
      const inner = vert(m, i * 2 + 1);
      const d = (inner.x - p.x) * segN.x + (inner.y - p.y) * segN.y;
      const k = Math.hypot(normals[i]!.x, normals[i]!.y);
      if (k < 2.5 - 1e-6) expect(d).toBeCloseTo(0.5, 5); // exact where the mitre isn't clamped
    }
    let arc = 0;
    for (let i = 1; i < hill.length; i++) {
      arc += Math.hypot(hill[i]!.x - hill[i - 1]!.x, hill[i]!.y - hill[i - 1]!.y);
      expect(m.uvs[i * 4]).toBeCloseTo(arc / 3);
      expect(m.uvs[i * 4 + 1]).toBe(0);
      expect(m.uvs[i * 4 + 3]).toBe(1);
    }
  });

  it('normals point into the solid (down for a left->right surface) and clamp the mitre', () => {
    const n = miterNormals([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    expect(n[0]!.x).toBeCloseTo(0);
    expect(n[0]!.y).toBeCloseTo(1);
    // a near-hairpin spike: mitre length is limited
    const spike = miterNormals([{ x: 0, y: 1 }, { x: 0.05, y: -5 }, { x: 0.1, y: 1 }], 2.5);
    expect(Math.hypot(spike[1]!.x, spike[1]!.y)).toBeLessThanOrEqual(2.5 + 1e-9);
    // 180° fold-back does not produce NaN
    const fold = miterNormals([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }]);
    for (const v of fold) expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
  });

  it('wraps chain ends down the cliff face at gaps (still clockwise)', () => {
    const left = [{ x: 0, y: 2 }, { x: 4, y: 2 }];
    const wrapped = withWrappedEnds(left, 1);
    expect(wrapped).toEqual([{ x: 0, y: 3 }, ...left, { x: 4, y: 3 }]);
    const m = edgeStrip(left, { ...opts, wrapDepth: 1 });
    expect(m.positions.length / 2).toBe(8);
    expectClockwise(m);
    // left cliff: inner side is to the right (+x) of the face, outer to the left
    expect(vert(m, 1).x).toBeGreaterThan(0);
    expect(vert(m, 0).x).toBeLessThan(0);
    // right cliff: mirrored
    expect(vert(m, 7).x).toBeLessThan(4);
    expect(vert(m, 6).x).toBeGreaterThan(4);
    expect(withWrappedEnds(left, 0)).toEqual(left);
  });

  it('two chains across a gap produce disjoint meshes', () => {
    const [a, b] = chainPolylines([
      [{ x: 0, y: 0 }, { x: 4, y: 0 }],
      [{ x: 6, y: 0 }, { x: 9, y: 0 }],
    ]);
    const ma = fillMesh(a!, 10, 4);
    const mb = fillMesh(b!, 10, 4);
    const maxA = Math.max(...Array.from(ma.positions).filter((_, i) => i % 2 === 0));
    const minB = Math.min(...Array.from(mb.positions).filter((_, i) => i % 2 === 0));
    expect(maxA).toBe(4);
    expect(minB).toBe(6);
  });
});
