/**
 * Small, dependency-free, seeded randomness for the terrain generator.
 *
 * Everything here is integer/IEEE-754 arithmetic with no platform-dependent
 * functions, so the same seed produces bit-identical terrain on every JS
 * engine (a requirement for "reverse-then-forward regenerates identical
 * terrain" and for per-seed best scores to mean the same course everywhere).
 */

/** Endless seeds are strings in the ScoreBook; numbers are accepted too. */
export type TerrainSeed = string | number;

/**
 * Normalise a seed to a uint32. Strings are hashed with FNV-1a over UTF-16
 * code units; numbers are truncated to uint32 (non-finite numbers -> 0).
 * A decimal-integer string and the same number map to the same seed
 * ("42" === 42), so a seed typed into the UI matches one stored as a number.
 */
export function normalizeSeed(seed: TerrainSeed): number {
  if (typeof seed === 'number') return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
  if (/^\d{1,9}$/.test(seed)) return Number(seed) >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer hash (lowbias32 finaliser) — well mixed, cheap. */
export function mix32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash a seed with any number of integer keys (lattice index, block index, salt). */
export function hash32(seed: number, ...keys: number[]): number {
  let h = mix32(seed ^ 0x9e3779b9);
  for (const k of keys) h = mix32(h ^ mix32((k | 0) + 0x632be5ab));
  return h;
}

/** Uniform float in [0, 1) from a hash. */
export const hashToUnit = (h: number): number => (h >>> 0) / 4294967296;

/** Seeded PRNG (mulberry32). Deterministic sequence per seed. */
export class Rng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Pick a key by non-negative weight. Falls back to the first key if all weights are 0. */
  weighted<K extends string>(weights: Readonly<Record<K, number>>): K {
    const keys = Object.keys(weights) as K[];
    let total = 0;
    for (const k of keys) total += Math.max(0, weights[k]);
    if (!(total > 0)) return keys[0]!;
    let r = this.next() * total;
    for (const k of keys) {
      r -= Math.max(0, weights[k]);
      if (r < 0) return k;
    }
    return keys[keys.length - 1]!;
  }
}
