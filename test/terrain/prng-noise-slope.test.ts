import { describe, expect, it } from 'vitest';
import { gradientNoise1D, NOISE_SLOPE_BOUND } from '../../src/terrain/noise';
import { normalizeSeed, Rng } from '../../src/terrain/prng';
import { clampSlopes, maxSlopeViolation, type SlopeLimits } from '../../src/terrain/slope';

describe('prng', () => {
  it('normalizes seeds: strings hash, integers pass through, digit strings equal numbers', () => {
    expect(normalizeSeed(42)).toBe(42);
    expect(normalizeSeed('42')).toBe(42);
    expect(normalizeSeed('beach')).toBe(normalizeSeed('beach'));
    expect(normalizeSeed('beach')).not.toBe(normalizeSeed('Beach'));
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(normalizeSeed(NaN)).toBe(0);
    expect(normalizeSeed(3.9)).toBe(3);
  });

  it('Rng is deterministic per seed', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    const c = new Rng(8);
    const sa = Array.from({ length: 50 }, () => a.next());
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 50 }, () => c.next())).not.toEqual(sa);
    sa.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
  });
});

describe('gradient noise', () => {
  it('is 0 at lattice points, bounded, and its slope stays within NOISE_SLOPE_BOUND', () => {
    let maxSlope = 0;
    let maxVal = 0;
    for (let seed = 0; seed < 20; seed++) {
      for (let i = 0; i < 2000; i++) {
        const t = i * 0.0371 - 30;
        const n = gradientNoise1D(seed, 1, t);
        maxSlope = Math.max(maxSlope, Math.abs(n.slope));
        maxVal = Math.max(maxVal, Math.abs(n.value));
      }
      expect(Math.abs(gradientNoise1D(seed, 1, 5).value)).toBe(0);
    }
    expect(maxVal).toBeLessThanOrEqual(1);
    expect(maxSlope).toBeLessThanOrEqual(NOISE_SLOPE_BOUND);
  });

  it('analytic slope matches a finite difference', () => {
    for (const t of [0.13, 1.5, 7.77, -3.2]) {
      const h = 1e-6;
      const fd = (gradientNoise1D(3, 2, t + h).value - gradientNoise1D(3, 2, t - h).value) / (2 * h);
      expect(gradientNoise1D(3, 2, t).slope).toBeCloseTo(fd, 5);
    }
  });
});

describe('clampSlopes', () => {
  const limits: SlopeLimits = { maxUp: () => 0.5, maxDown: () => 1 };

  it('enforces the limits with pinned ends and leaves compliant points alone', () => {
    const pts = [
      { x: 0, y: 10 },
      { x: 1, y: 10.2 },
      { x: 2, y: 5 }, // violent rise
      { x: 3, y: 12 }, // violent drop
      { x: 4, y: 10.1 },
      { x: 10, y: 10 },
    ];
    expect(clampSlopes(pts, limits, true, true)).toBe(true);
    expect(maxSlopeViolation(pts, limits)).toBeLessThanOrEqual(1e-12);
    expect(pts[0]!.y).toBe(10);
    expect(pts[5]!.y).toBe(10);
    expect(pts[1]!.y).toBe(10.2);
  });

  it('reports infeasible pins without touching the input', () => {
    const pts = [
      { x: 0, y: 10 },
      { x: 1, y: 10 },
      { x: 2, y: 0 },
    ];
    const copy = pts.map((p) => ({ ...p }));
    expect(clampSlopes(pts, limits, true, true)).toBe(false);
    expect(pts).toEqual(copy);
  });

  it('works with one or no pins', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 10 + (i % 2 ? 3 : -3) }));
    expect(clampSlopes(pts, limits, false, true)).toBe(true);
    expect(maxSlopeViolation(pts, limits)).toBeLessThanOrEqual(1e-12);
    expect(pts[29]!.y).toBe(13);
  });
});
