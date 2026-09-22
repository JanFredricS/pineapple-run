/**
 * 1D gradient ("Perlin/simplex-style") noise, implemented here instead of
 * pulling in the `simplex-noise` package:
 *
 *  - Terrain is a 1D height profile; 1D gradient noise is ~15 lines and 1D
 *    simplex degenerates to exactly this (a gradient per lattice point,
 *    blended by a smooth kernel), so a 2D/3D library buys nothing.
 *  - The generator must be bit-identical across engines and across
 *    dependency upgrades (per-seed best scores, reverse regeneration). Here
 *    the gradients come straight from an integer hash of (seed, lattice
 *    index) — no permutation table built by a PRNG we don't control — and
 *    only +, -, *, / and floor are used (no Math.sin/cos/exp, whose last
 *    bits are implementation-defined).
 *  - We need the ANALYTIC DERIVATIVE to budget slopes by construction
 *    (see generator.ts); we compute it alongside the value.
 */

import { hash32, hashToUnit } from './prng';

/** Quintic fade 6u^5 - 15u^4 + 10u^3 and its derivative. */
const fade = (u: number): number => u * u * u * (u * (u * 6 - 15) + 10);
const dfade = (u: number): number => 30 * u * u * (u * (u - 2) + 1);

/** Gradient in [-1, 1] at integer lattice point i. */
function gradient(seed: number, salt: number, i: number): number {
  return hashToUnit(hash32(seed, salt, i)) * 2 - 1;
}

/**
 * Noise value in [-1, 1] and its derivative d/dt, at t (lattice units).
 * Value is 0 at every integer t.
 */
export function gradientNoise1D(seed: number, salt: number, t: number): { value: number; slope: number } {
  const i0 = Math.floor(t);
  const u = t - i0;
  const g0 = gradient(seed, salt, i0);
  const g1 = gradient(seed, salt, i0 + 1);
  const a = g0 * u;
  const b = g1 * (u - 1);
  const f = fade(u);
  // Raw 1D gradient noise lies in [-0.5, 0.5]; scale to [-1, 1].
  const value = 2 * (a + f * (b - a));
  const slope = 2 * (g0 + dfade(u) * (b - a) + f * (g1 - g0));
  return { value, slope };
}

/**
 * Upper bound on |d value / dt| for gradientNoise1D:
 *   slope/2 = g0 (1 - f) + g1 f + f' (b - a)
 * with |g0 (1 - f) + g1 f| <= 1 (convex combination), |b - a| =
 * |g1 (u - 1) - g0 u| <= (1 - u) + u = 1 and max f' = 1.875, so
 * |slope| <= 2 * 2.875. Checked numerically in test/terrain/noise.test.ts.
 */
export const NOISE_SLOPE_BOUND = 5.75;

export interface NoiseLayer {
  /** Wavelength in metres (lattice spacing). */
  wavelength: number;
  /** Peak amplitude in metres. */
  amplitude: number;
  salt: number;
}

/** Height (m) and slope (m/m) of one layer at x (m). */
export function layerAt(seed: number, layer: NoiseLayer, x: number): { value: number; slope: number } {
  const n = gradientNoise1D(seed, layer.salt, x / layer.wavelength);
  return { value: n.value * layer.amplitude, slope: (n.slope * layer.amplitude) / layer.wavelength };
}
