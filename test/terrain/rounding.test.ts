/** S6T #10: crest rounding (src/terrain/rounding.ts). */
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../src/model/geometry';
import { CREST_MIN_SEGMENTS, CREST_SLOPE_DELTA, ROUNDED_MAX_JUMP, roundCrests, sharpestCrest } from '../../src/terrain/rounding';

const slope = (a: Vec2, b: Vec2) => (b.y - a.y) / (b.x - a.x);

describe('roundCrests', () => {
  // +30° climb into a −40° drop (y-down: rising = negative slope)
  const crest: Vec2[] = [{ x: 0, y: 10 }, { x: 5, y: 10 - 5 * Math.tan(Math.PI / 6) }, { x: 10, y: 10 - 5 * Math.tan(Math.PI / 6) + 5 * Math.tan((40 * Math.PI) / 180) }];

  it('replaces a sharp crest with >= 3 segments, keeping the end points and staying between the two slopes', () => {
    expect(sharpestCrest(crest)).toBeGreaterThan(CREST_SLOPE_DELTA);
    const r = roundCrests(crest);
    expect(r[0]).toEqual(crest[0]);
    expect(r.at(-1)).toEqual(crest[2]);
    expect(r.length - 1).toBeGreaterThanOrEqual(2 + CREST_MIN_SEGMENTS); // two straight runs + the curve
    const s1 = slope(crest[0]!, crest[1]!);
    const s2 = slope(crest[1]!, crest[2]!);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.x).toBeGreaterThan(r[i - 1]!.x);
      const s = slope(r[i - 1]!, r[i]!);
      expect(s).toBeGreaterThanOrEqual(s1 - 1e-9);
      expect(s).toBeLessThanOrEqual(s2 + 1e-9);
    }
    expect(sharpestCrest(r)).toBeLessThanOrEqual(ROUNDED_MAX_JUMP + 1e-9);
    // the curve lies under the old apex (the peak is shaved, never raised)
    const apexY = crest[1]!.y;
    for (const p of r) expect(p.y).toBeGreaterThanOrEqual(apexY - 1e-9);
  });

  it('the curve spans about a 1.5 m radius (tangent length R·tan(θ/2))', () => {
    const r = roundCrests(crest);
    const curve = r.slice(1, -1);
    const theta = Math.PI / 6 + (40 * Math.PI) / 180;
    const t = 1.5 * Math.tan(theta / 2);
    expect(Math.hypot(curve[0]!.x - crest[1]!.x, curve[0]!.y - crest[1]!.y)).toBeCloseTo(t, 6);
    expect(Math.hypot(curve.at(-1)!.x - crest[1]!.x, curve.at(-1)!.y - crest[1]!.y)).toBeCloseTo(t, 6);
  });

  it('leaves valleys, gentle crests, kept vertices and 2-point lines alone', () => {
    const valley: Vec2[] = [{ x: 0, y: 0 }, { x: 5, y: 3 }, { x: 10, y: 0 }];
    expect(roundCrests(valley)).toEqual(valley);
    const gentle: Vec2[] = [{ x: 0, y: 0 }, { x: 5, y: -1 }, { x: 10, y: 0 }]; // slope jump 0.4
    expect(roundCrests(gentle)).toEqual(gentle);
    expect(roundCrests(crest, { keep: () => true })).toEqual(crest);
    expect(roundCrests(crest.slice(0, 2))).toEqual(crest.slice(0, 2));
  });

  it('short neighbours shrink the round (a step lip) instead of overlapping', () => {
    const step: Vec2[] = [{ x: 0, y: 10 }, { x: 0.3, y: 9.5 }, { x: 3.3, y: 9.5 }, { x: 3.6, y: 9 }, { x: 6.6, y: 9 }];
    const r = roundCrests(step);
    for (let i = 1; i < r.length; i++) expect(r[i]!.x).toBeGreaterThan(r[i - 1]!.x);
    expect(sharpestCrest(r)).toBeLessThanOrEqual(ROUNDED_MAX_JUMP + 1e-9);
    expect(r[0]).toEqual(step[0]);
    expect(r.at(-1)).toEqual(step[4]);
  });
});
