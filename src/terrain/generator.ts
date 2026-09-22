/**
 * Procedural terrain generator (pure, seeded, deterministic).
 *
 * The world is cut into BLOCKS of CHUNK_WIDTH metres (block k = chunk k,
 * x in [k*W, (k+1)*W)). Every block is a pure function of (seed, k): no
 * block depends on another one having been generated, so the endless
 * streamer can rebuild any chunk at any time — reverse-then-forward driving
 * regenerates bit-identical terrain.
 *
 * What ties blocks together is the BOUNDARY at x_k = k*W: its height h_k and
 * slope s_k come only from the low-frequency noise layer. The terrain is a
 * straight "connector" line across every boundary, from
 * (x_k - C, h_k - s_k C) to (x_k + C, h_k + s_k C); block k-1 ends on the
 * first of those points and block k starts on the second. The chunk cut
 * (chunks.ts) then lands strictly inside that straight segment, so seams are
 * perfectly smooth for the engine's ghost-vertex extension.
 *
 * Inside a block (see generateBlock):
 *   1. layered gradient noise heightfield (low + mid + small), mid/small
 *      faded to zero at the connectors and around the block's feature;
 *   2. at most one FEATURE from the original course's vocabulary — valley,
 *      crest (climb + steep drop: the "first hill" trap), launch lip,
 *      washboard (9 bumps, 15 px tall, 40 px apart), kicker, gap — picked by
 *      a difficulty-weighted grammar and shaped relative to the anchor line
 *      between the feature's end heights;
 *   3. slope clamping (slope.ts) with the block's difficulty limits, pinned
 *      at both connectors.
 *
 * Difficulty ramps with distance (difficultyAt): noise amplitude, slope
 * limits, feature intensity/probabilities and gap widths all grow from the
 * start plateau to RAMP_END_X.
 *
 * Only +, -, *, /, sqrt and floor are used (no Math.sin/cos/exp, whose last
 * bits vary by engine), so terrain is identical on every platform.
 */

import type { Vec2 } from '../model/geometry';
import {
  DEFAULT_TERRAIN_FRICTION,
  DEFAULT_TERRAIN_RESTITUTION,
  LEVEL_DEF_VERSION,
  type LevelDef,
  type TerrainSpan,
  type ThemeId,
} from '../model/level';
import { MAX_TERRAIN_POINTS_TOTAL, MAX_TERRAIN_SPANS } from '../model/validate';
import { CHUNK_WIDTH, chunkSpans, makeChunk, type TerrainChunk, type TerrainSource } from './chunks';
import { layerAt, type NoiseLayer } from './noise';
import { hash32, normalizeSeed, Rng, type TerrainSeed } from './prng';
import { clampSlopes, type SlopeLimits } from './slope';

// ------------------------------------------------------------------ tuning

/** Block width == chunk width (m). */
export const BLOCK_WIDTH = CHUNK_WIDTH;
/** Half-length of the straight connector across each block boundary (m). */
export const CONNECTOR = 1;
/** Baseline ground height (m, y-down): the original's start plateau is y 278 px ≈ 9.3 m. */
export const BASE_Y = 10;
/** Start plateau is flat up to here (m); the cart and funnel sit on it. */
export const START_FLAT_END = 20;
/** Noise fades in between START_FLAT_END and this x (m). */
export const NOISE_FULL_X = 120;
/** Difficulty is 0 before RAMP_START_X and 1 after RAMP_END_X (linear between). */
export const RAMP_START_X = 80;
export const RAMP_END_X = 1680;
/** Base heightfield sample spacing (m), on a global grid. */
export const SAMPLE_STEP = 2;

/** Washboard spec (original course x 3174–3519 px): 9 bumps, 15 px tall, 40 px apart. */
export const WASHBOARD = { bumps: 9, height: 15 / 30, pitch: 40 / 30, lead: 1 } as const;
/** Relative slope of a washboard bump flank (height / half-pitch). */
export const WASHBOARD_FLANK_SLOPE = WASHBOARD.height / (WASHBOARD.pitch / 2);

/**
 * Gap widths (m). The original example cart (radius-25 px wheels ≈ 0.83 m,
 * ~5 m long) bridges GAP_MIN at walking pace; GAP_MAX (90 px) needs speed —
 * but the far side is never higher than the take-off lip, so a cart at a
 * moderate speed clears it.
 */
export const GAP_MIN = 1.2;
export const GAP_MAX = 3;

/** Features only from this block on (block 0 is the start plateau). */
export const FIRST_FEATURE_BLOCK = 1;
/** Gaps need at least this difficulty (≈ x 240 m). */
export const GAP_MIN_DIFFICULTY = 0.1;

/**
 * Per-segment slope limits (the clamp), y-down, driving left -> right:
 * rise ≤ maxUp, fall ≤ maxDown. Short features (washboard flanks, kickers)
 * use most of this; long grades are much gentler by construction (see the
 * sustained-grade test). Falls may be steep: drops are the course's traps.
 */
export const slopeLimitsFor = (d: number): { maxUp: number; maxDown: number } => ({
  maxUp: 0.9 + 0.3 * d,
  maxDown: 1.8 + 1.2 * d,
});

/**
 * Upper bound on any generated y for endless terrain (m). Baseline + every
 * layer amplitude + deepest feature, with margin; asserted over many seeds in
 * the tests. Endless mode uses it as the kill plane.
 */
export const ENDLESS_KILL_Y = BASE_Y + 30;

/** Where the cart / funnel go on the start plateau (m). */
export const START_CART = { x: 3, y: BASE_Y - 1.8 } as const;
export const START_FUNNEL = { x: 5, y: BASE_Y - 6 } as const;

/** Generated LevelDefs are capped so they always pass model/validate limits. */
export const MAX_GENERATED_BLOCKS = 1500;
/** Hard cap on points one block may emit (asserted; keeps MAX_GENERATED_BLOCKS under the point limit). */
export const MAX_BLOCK_POINTS = 120;

const LOW: NoiseLayer = { wavelength: 260, amplitude: 6, salt: 1 };
const MID_BASE = { wavelength: 55, salt: 2 };
const SMALL_BASE = { wavelength: 13, salt: 3 };
const midLayer = (d: number): NoiseLayer => ({ ...MID_BASE, amplitude: 1.6 + 1.6 * d });
const smallLayer = (d: number): NoiseLayer => ({ ...SMALL_BASE, amplitude: 0.15 + 0.35 * d });

const SALT_FEATURE = 0x5eed;

// --------------------------------------------------------------- helpers

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** smoothstep from e0 to e1 (e0 > e1 gives a falling step). */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
function dSmoothstep(e0: number, e1: number, x: number): number {
  const t = (x - e0) / (e1 - e0);
  if (t <= 0 || t >= 1) return 0;
  return (6 * t * (1 - t)) / (e1 - e0);
}

/** Distance difficulty in [0, 1]. */
export function difficultyAt(x: number): number {
  return clamp01((x - RAMP_START_X) / (RAMP_END_X - RAMP_START_X));
}

/** Difficulty is constant per block (evaluated at the block's left edge). */
export const blockDifficulty = (k: number): number => difficultyAt(k * BLOCK_WIDTH);
export const blockIndexAt = (x: number): number => Math.floor(x / BLOCK_WIDTH);

/** Slope limits used by the clamp, piecewise constant per block. */
export const GENERATOR_SLOPE_LIMITS: SlopeLimits = {
  maxUp: (x) => slopeLimitsFor(blockDifficulty(blockIndexAt(x))).maxUp,
  maxDown: (x) => slopeLimitsFor(blockDifficulty(blockIndexAt(x))).maxDown,
};

/** Noise envelope: 0 on the start plateau, 1 from NOISE_FULL_X. */
const envelope = (x: number) => smoothstep(START_FLAT_END, NOISE_FULL_X, x);

/** Low-frequency layer (with the start envelope): the only input to boundaries. */
function lowAt(seed: number, x: number): { value: number; slope: number } {
  const n = layerAt(seed, LOW, x);
  const e = envelope(x);
  return { value: e * n.value, slope: e * n.slope + dSmoothstep(START_FLAT_END, NOISE_FULL_X, x) * n.value };
}

/** Max |slope| allowed on a connector. */
const MAX_CONNECTOR_SLOPE = 0.2;

/** Boundary k: height and connector slope at x_k = k*W. */
export function boundary(seed: number, k: number): { x: number; y: number; slope: number } {
  const x = k * BLOCK_WIDTH;
  const l = lowAt(seed, x);
  const slope = Math.max(-MAX_CONNECTOR_SLOPE, Math.min(MAX_CONNECTOR_SLOPE, l.slope));
  return { x, y: BASE_Y + l.value, slope };
}

/** The two connector points around boundary k: [left (end of block k-1), right (start of block k)]. */
export function connectorPoints(seed: number, k: number): [Vec2, Vec2] {
  const b = boundary(seed, k);
  return [
    { x: b.x - CONNECTOR, y: b.y - b.slope * CONNECTOR },
    { x: b.x + CONNECTOR, y: b.y + b.slope * CONNECTOR },
  ];
}

// --------------------------------------------------------------- features

export type FeatureKind = 'none' | 'valley' | 'crest' | 'launchLip' | 'washboard' | 'kicker' | 'gap';
export const FEATURE_KINDS: readonly FeatureKind[] = ['none', 'valley', 'crest', 'launchLip', 'washboard', 'kicker', 'gap'];

export interface FeatureInstance {
  kind: Exclude<FeatureKind, 'none'>;
  block: number;
  /** World x-range the feature occupies. */
  x0: number;
  x1: number;
  /** Anchor line heights at x0 / x1 (the feature is shaped relative to it). */
  y0: number;
  y1: number;
  /** For gaps: the hole [gapX0, gapX1]. */
  gapX0?: number;
  gapX1?: number;
  /** Kind-specific numbers (heights/slopes/widths), for tests and debugging. */
  params: Record<string, number>;
}

/** Feature shape: offset points (dx from x0, o = y offset, + = down) and optional gap split. */
interface Shape {
  length: number;
  pts: { dx: number; o: number }[];
  /** Index in pts after which the terrain breaks (gap between pts[i] and pts[i+1]). */
  gapAfter?: number;
  params: Record<string, number>;
}

/** Feature weights by difficulty (the grammar). */
export function featureWeights(d: number, allowGap: boolean): Record<FeatureKind, number> {
  return {
    none: 3 - 2 * d,
    valley: 2,
    crest: 1 + d,
    launchLip: 1 + d,
    washboard: 1.2,
    kicker: 0.8 + d,
    gap: allowGap ? 0.3 + 1.2 * d : 0,
  };
}

/** Longest a feature may be: the block body minus margins. */
const FEATURE_MARGIN = 2;
const MAX_FEATURE_LENGTH = BLOCK_WIDTH - 2 * CONNECTOR - 2 * FEATURE_MARGIN;

/**
 * Build a feature's shape relative to an anchor line of slope `m` (dy/dx,
 * y-down). A rising flank of relative slope r climbs at r - m in absolute
 * terms and a falling one drops at r + m, so the RELATIVE budgets are
 * rise = maxUp + m and fall = maxDown - m. Returns null when the feature
 * cannot be built within them (the caller falls back to no feature).
 */
function shapeFeature(
  kind: Exclude<FeatureKind, 'none'>,
  rng: Rng,
  d: number,
  maxUp: number,
  maxDown: number,
  m: number,
): Shape | null {
  const rise = maxUp + m;
  const fall = maxDown - m;
  const pts: { dx: number; o: number }[] = [];
  switch (kind) {
    case 'valley': {
      // o = v * 16 t^2 (1-t)^2 : zero value & slope at both ends; max |do/dt| = 3.0792 v.
      const length = rng.range(14, 28);
      const flank = 3.0792;
      const rMax = Math.min(0.14 + 0.06 * d, (0.95 * Math.min(rise, fall)) / flank);
      const r = rng.range(0.08, 0.14 + 0.06 * d);
      const depth = length * Math.min(r, rMax);
      if (!(depth > 0.3)) return null;
      const n = Math.max(8, Math.round(length));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = t * (1 - t);
        pts.push({ dx: t * length, o: depth * 16 * u * u });
      }
      return { length, pts, params: { depth, length } };
    }
    case 'crest': {
      const up = Math.min(rng.range(0.3, 0.45 + 0.15 * d), 0.95 * rise);
      const down = Math.min(rng.range(0.9, 1.3 + 0.9 * d), 0.95 * fall);
      const recoverSlope = Math.min(0.2, 0.95 * rise);
      let height = rng.range(1.5, 3 + 2 * d);
      let extra = rng.range(0.3, 1 + d);
      const top = rng.range(2, 4);
      if (!(up > 0.1 && down > 0.3 && recoverSlope > 0.05)) return null;
      const lengthOf = () => height / up + top + (height + extra) / down + Math.max(3, extra / recoverSlope);
      for (let i = 0; i < 8 && lengthOf() > MAX_FEATURE_LENGTH; i++) {
        const s = Math.max(0.1, (MAX_FEATURE_LENGTH - top - 3) / (lengthOf() - top));
        height *= s;
        extra *= s;
      }
      if (lengthOf() > MAX_FEATURE_LENGTH) return null;
      let x = 0;
      pts.push({ dx: 0, o: 0 });
      x += height / up;
      pts.push({ dx: x, o: -height });
      x += top;
      pts.push({ dx: x, o: -height });
      x += (height + extra) / down;
      pts.push({ dx: x, o: extra });
      x += Math.max(3, extra / recoverSlope);
      pts.push({ dx: x, o: 0 });
      return { length: x, pts, params: { height, extra, up, down, top } };
    }
    case 'launchLip': {
      const approach = 2;
      let rise1 = rng.range(0.8, 1.6 + 1.2 * d);
      const s1 = Math.min(0.3, 0.95 * rise);
      const s2 = Math.min(rng.range(0.5, 0.7 + 0.2 * d), 0.95 * rise);
      let drop = rng.range(0.5, 1.5 + 1.5 * d);
      const sd = Math.min(rng.range(1.4, 2 + 0.6 * d), 0.95 * fall);
      const rs = Math.min(0.2, 0.95 * rise);
      if (!(s1 > 0.05 && s2 > 0.05 && sd > 0.3 && rs > 0.05)) return null;
      const lengthOf = () => approach + rise1 / 2 / s1 + rise1 / 2 / s2 + (rise1 + drop) / sd + Math.max(4, drop / rs);
      for (let i = 0; i < 8 && lengthOf() > MAX_FEATURE_LENGTH; i++) {
        const s = Math.max(0.1, (MAX_FEATURE_LENGTH - approach - 4) / (lengthOf() - approach));
        rise1 *= s;
        drop *= s;
      }
      if (lengthOf() > MAX_FEATURE_LENGTH) return null;
      let x = 0;
      pts.push({ dx: 0, o: 0 });
      x += approach;
      pts.push({ dx: x, o: 0 });
      x += rise1 / 2 / s1;
      pts.push({ dx: x, o: -rise1 / 2 });
      x += rise1 / 2 / s2;
      pts.push({ dx: x, o: -rise1 }); // the lip
      x += (rise1 + drop) / sd;
      pts.push({ dx: x, o: drop });
      x += Math.max(4, drop / rs);
      pts.push({ dx: x, o: 0 });
      return { length: x, pts, params: { rise: rise1, drop, lipSlope: s2, dropSlope: sd } };
    }
    case 'washboard': {
      // Exact spec geometry, never altered: skip if the anchor line would push a flank past the limits.
      if (WASHBOARD_FLANK_SLOPE > rise || WASHBOARD_FLANK_SLOPE > fall) return null;
      const { bumps, height, pitch, lead } = WASHBOARD;
      pts.push({ dx: 0, o: 0 });
      for (let j = 0; j < bumps; j++) {
        const x0 = lead + j * pitch;
        pts.push({ dx: x0, o: 0 });
        pts.push({ dx: x0 + pitch / 2, o: -height });
      }
      const end = lead + bumps * pitch;
      pts.push({ dx: end, o: 0 });
      pts.push({ dx: end + lead, o: 0 });
      return { length: end + lead, pts, params: { bumps, height, pitch } };
    }
    case 'kicker': {
      const approach = 1;
      const h = rng.range(0.5, 0.9 + 0.7 * d);
      const ku = Math.min(rng.range(0.6, 0.75 + 0.1 * d), 0.95 * rise);
      const kd = Math.min(rng.range(1.5, 2.4 + 0.4 * d), 0.95 * fall);
      const land = rng.range(0, 0.5 + 0.5 * d);
      const rs = Math.min(0.2, 0.95 * rise);
      if (!(ku > 0.2 && kd > 0.5 && rs > 0.05)) return null;
      let x = 0;
      pts.push({ dx: 0, o: 0 });
      x += approach;
      pts.push({ dx: x, o: 0 });
      x += h / ku;
      pts.push({ dx: x, o: -h });
      x += (h + land) / kd;
      pts.push({ dx: x, o: land });
      x += Math.max(2, land / rs);
      pts.push({ dx: x, o: 0 });
      return { length: x, pts, params: { height: h, upSlope: ku, downSlope: kd, land } };
    }
    case 'gap': {
      const approach = rng.range(3, 5);
      const lipRise = 0.25;
      const lipSlope = 0.25;
      if (lipSlope > 0.95 * rise) return null;
      const width = rng.range(GAP_MIN, Math.min(GAP_MAX, 1.6 + 1.4 * d));
      // Landing side lower than the take-off edge (easier to clear), never
      // higher — even when the anchor line itself climbs across the gap.
      const q = Math.max(rng.range(0, 0.3 + 0.7 * d), -m * width - lipRise + 0.05);
      const rs = Math.min(0.2, 0.95 * rise);
      if (!(rs > 0.05)) return null;
      let x = 0;
      pts.push({ dx: 0, o: 0 });
      x += approach;
      pts.push({ dx: x, o: 0 });
      x += lipRise / lipSlope;
      pts.push({ dx: x, o: -lipRise }); // take-off edge
      const gapAfter = pts.length - 1;
      x += width;
      pts.push({ dx: x, o: q }); // landing edge
      x += 1;
      pts.push({ dx: x, o: q });
      x += Math.max(2, (q + 0) / rs);
      pts.push({ dx: x, o: 0 });
      return { length: x, pts, gapAfter, params: { width, landingDrop: q, approach } };
    }
  }
}

// ----------------------------------------------------------------- blocks

export interface BlockGeometry {
  index: number;
  /**
   * Ground polylines, left -> right. The first starts on the block's left
   * connector point (except block 0, which starts on the plateau) and the
   * last ends on its right connector point; more than one means a gap.
   */
  lines: Vec2[][];
  /** Block 0 only: the steep backstop left of the start plateau (its own span). */
  wallBefore?: Vec2[];
  feature: FeatureInstance | null;
}

/** Start-wall geometry: a near-vertical 2-point span like the S0 spike's walls. */
const START_WALL: Vec2[] = [
  { x: 0, y: BASE_Y - 6 },
  { x: 0.1, y: BASE_Y },
];

/**
 * Generate block k (k >= 0) — a pure function of (seed, k). `forceNone`
 * disables the feature (fallback when a feature cannot be clamped).
 */
export function generateBlock(seedIn: TerrainSeed, k: number, forceNone = false): BlockGeometry {
  if (!Number.isInteger(k) || k < 0) throw new RangeError(`generateBlock: bad block index ${k}`);
  const seed = normalizeSeed(seedIn);
  const x0 = k * BLOCK_WIDTH;
  const x1 = x0 + BLOCK_WIDTH;
  const d = blockDifficulty(k);
  const limits = slopeLimitsFor(d);
  const rng = new Rng(hash32(seed, k, SALT_FEATURE));

  const leftPin: Vec2 = k === 0 ? { ...START_WALL[1]! } : connectorPoints(seed, k)[1];
  const rightPin: Vec2 = connectorPoints(seed, k + 1)[0];
  const bodyStart = k === 0 ? START_FLAT_END : leftPin.x;
  const bodyEnd = rightPin.x;

  // ---- choose the feature (the grammar)
  let kind: FeatureKind = 'none';
  if (!forceNone && k >= FIRST_FEATURE_BLOCK) {
    kind = rng.weighted(featureWeights(d, d >= GAP_MIN_DIFFICULTY));
  }
  // Placement and shape come from a second stream so the kind draw is stable.
  const frng = new Rng(hash32(seed, k, SALT_FEATURE + 1));

  const mid = midLayer(d);
  const small = smallLayer(d);
  let fa = Infinity; // feature x-range (for the mid/small fade)
  let fb = -Infinity;
  const conn = (x: number) => smoothstep(bodyStart, bodyStart + 4, x) * smoothstep(bodyEnd, bodyEnd - 4, x);
  const featFade = (x: number) =>
    !(fb >= fa) ? 0 : x < fa ? smoothstep(fa - 4, fa, x) : x > fb ? smoothstep(fb + 4, fb, x) : 1;
  const heightAt = (x: number): number => {
    const e = envelope(x);
    if (e === 0) return BASE_Y;
    const w = conn(x) * (1 - featFade(x));
    const detail = w === 0 ? 0 : w * (layerAt(seed, mid, x).value + layerAt(seed, small, x).value);
    return BASE_Y + e * (layerAt(seed, LOW, x).value + detail);
  };

  let feature: FeatureInstance | null = null;
  let shape: Shape | null = null;
  if (kind !== 'none') {
    // The shape's slope budget depends on the anchor line's slope m, which
    // depends on where the feature sits, which depends on its length. Iterate
    // (same random draws each time) until the shape was built for the anchor
    // slope of its own placement; give up (no feature) if it does not settle.
    const u = frng.next();
    const shapeRng = () => new Rng(hash32(seed, k, SALT_FEATURE + 2));
    let m = 0;
    let cand = shapeFeature(kind, shapeRng(), d, limits.maxUp, limits.maxDown, m);
    for (let iter = 0; cand && iter < 6; iter++) {
      const slack = Math.max(0, bodyEnd - bodyStart - 2 * FEATURE_MARGIN - cand.length);
      const a = bodyStart + FEATURE_MARGIN + u * slack;
      const b = a + cand.length;
      fa = a;
      fb = b;
      const ya = heightAt(a);
      const yb = heightAt(b);
      m = (yb - ya) / (b - a);
      const next = shapeFeature(kind, shapeRng(), d, limits.maxUp, limits.maxDown, m);
      if (next && next.length === cand.length) {
        shape = next;
        feature = { kind: kind as Exclude<FeatureKind, 'none'>, block: k, x0: a, x1: b, y0: ya, y1: yb, params: next.params };
        break;
      }
      cand = next;
    }
    if (!feature) {
      fa = Infinity;
      fb = -Infinity;
    }
  }

  // ---- assemble the polyline(s)
  const pts: Vec2[] = [leftPin];
  let gapIndex = -1; // gap between pts[gapIndex] and pts[gapIndex + 1]
  const firstGrid = Math.floor(bodyStart / SAMPLE_STEP) * SAMPLE_STEP + SAMPLE_STEP;
  const addBase = (from: number, to: number) => {
    // Base samples strictly inside (from, to), at least 0.5 m clear of both ends.
    for (let x = Math.max(firstGrid, Math.floor(from / SAMPLE_STEP) * SAMPLE_STEP); x < to - 0.5; x += SAMPLE_STEP) {
      if (x > from + 0.5) pts.push({ x, y: heightAt(x) });
    }
  };
  if (feature && shape) {
    addBase(leftPin.x, feature.x0);
    const { x0: a, y0: ya, y1: yb } = feature;
    const L = shape.length;
    shape.pts.forEach((p, i) => {
      const t = p.dx / L;
      // Pin the exact end x so rounding in dx never differs from x1.
      const x = i === shape!.pts.length - 1 ? feature!.x1 : a + p.dx;
      pts.push({ x, y: lerp(ya, yb, t) + p.o });
      if (shape!.gapAfter === i) gapIndex = pts.length - 1;
    });
    if (gapIndex >= 0) {
      feature.gapX0 = pts[gapIndex]!.x;
      feature.gapX1 = pts[gapIndex + 1]!.x;
    }
    addBase(feature.x1, rightPin.x);
  } else {
    addBase(leftPin.x, rightPin.x);
  }
  pts.push(rightPin);
  // Block 0: flat plateau up to START_FLAT_END (base samples start after it).
  if (k === 0) pts.splice(1, 0, { x: START_FLAT_END, y: BASE_Y });

  const lines = gapIndex >= 0 ? [pts.slice(0, gapIndex + 1), pts.slice(gapIndex + 1)] : [pts];
  // Slope clamp: pinned at the connectors, free at gap edges.
  let ok = true;
  lines.forEach((line, i) => {
    ok = clampSlopes(line, GENERATOR_SLOPE_LIMITS, i === 0, i === lines.length - 1) && ok;
  });
  if (!ok) {
    if (forceNone) throw new Error(`generateBlock: base terrain infeasible (seed ${seed}, block ${k})`);
    return generateBlock(seed, k, true);
  }
  const count = lines.reduce((n, l) => n + l.length, 0);
  if (count > MAX_BLOCK_POINTS) throw new Error(`generateBlock: ${count} points exceeds MAX_BLOCK_POINTS`);

  const out: BlockGeometry = { index: k, lines, feature };
  if (k === 0) out.wallBefore = START_WALL.map((p) => ({ ...p }));
  return out;
}

// ------------------------------------------------------------- the finish

export interface FinishGeometry {
  lines: Vec2[][];
  wallAfter: Vec2[];
  goal: LevelDef['goal'];
  blenderAt: Vec2;
}

/** Finish block for finite generated levels: run-out, lip, blender pit, back wall. */
function generateFinish(seed: number, k: number): FinishGeometry {
  const leftPin = connectorPoints(seed, k)[1];
  const y = leftPin.y;
  const lipX = leftPin.x + 20;
  const lipY = y - 0.6; // gentle lip: rise 0.6 over 3 m
  const pitDepth = 2.5;
  const floorY = lipY + pitDepth;
  const pitX0 = lipX + pitDepth / 1.6; // drop at slope 1.6 (within every maxDown)
  const pitX1 = pitX0 + 4;
  const line: Vec2[] = [
    leftPin,
    { x: lipX - 3, y }, // flat run-out
    { x: lipX, y: lipY },
    { x: pitX0, y: floorY },
    { x: pitX1, y: floorY },
  ];
  return {
    lines: [line],
    wallAfter: [
      { x: pitX1, y: floorY },
      { x: pitX1 + 0.1, y: floorY - 8 },
    ],
    goal: { sensor: { x: pitX0 + 0.3, y: floorY - 1.2, width: pitX1 - pitX0 - 0.6, height: 1.2 }, lineX: lipX + 0.3 },
    blenderAt: { x: (pitX0 + pitX1) / 2, y: floorY },
  };
}

// ---------------------------------------------------------- whole levels

export interface GeneratedLevel {
  level: LevelDef;
  features: FeatureInstance[];
  /** Number of blocks including the finish block. */
  blocks: number;
}

export interface GenerateOptions {
  theme?: ThemeId;
  id?: string;
  name?: string;
}

/** Longest level generateLevel accepts (m). */
export const MAX_GENERATED_LENGTH = MAX_GENERATED_BLOCKS * BLOCK_WIDTH;

/**
 * A finite, valid LevelDef of (at least) `length` metres: start plateau,
 * ceil(length / W) - 1 generated blocks, then a finish block with the goal.
 * Blocks 0..blocks-2 are exactly the blocks the endless source streams, so
 * their chunks are identical to ProceduralChunkSource's.
 */
export function generateLevel(seedIn: TerrainSeed, length: number, opts: GenerateOptions = {}): GeneratedLevel {
  if (!(length > 0) || !Number.isFinite(length)) throw new RangeError('generateLevel: length must be a positive number');
  if (length > MAX_GENERATED_LENGTH) throw new RangeError(`generateLevel: length > ${MAX_GENERATED_LENGTH} m`);
  const seed = normalizeSeed(seedIn);
  const blocks = Math.max(2, Math.ceil(length / BLOCK_WIDTH));
  const spans: TerrainSpan[] = [];
  const features: FeatureInstance[] = [];
  let current: Vec2[] | null = null;
  let spanNo = 0;
  const flush = () => {
    if (current) spans.push({ id: `s${spanNo++}`, points: current });
    current = null;
  };
  for (let k = 0; k < blocks - 1; k++) {
    const g = generateBlock(seed, k);
    if (g.wallBefore) spans.push({ id: 'start-wall', points: g.wallBefore });
    if (g.feature) features.push(g.feature);
    g.lines.forEach((line, i) => {
      if (i === 0 && current) current.push(...line);
      else {
        flush();
        current = [...line];
      }
    });
  }
  const fin = generateFinish(seed, blocks - 1);
  (current as Vec2[] | null)?.push(...fin.lines[0]!);
  flush();
  spans.push({ id: 'end-wall', points: fin.wallAfter });

  let maxY = -Infinity;
  let total = 0;
  for (const s of spans) {
    total += s.points.length;
    for (const p of s.points) maxY = Math.max(maxY, p.y);
  }
  if (spans.length > MAX_TERRAIN_SPANS || total > MAX_TERRAIN_POINTS_TOTAL) {
    throw new Error('generateLevel: exceeded LevelDef limits (MAX_BLOCK_POINTS / MAX_GENERATED_BLOCKS mis-tuned)');
  }
  const level: LevelDef = {
    version: LEVEL_DEF_VERSION,
    id: opts.id ?? `gen-${seed}-${blocks * BLOCK_WIDTH}`,
    name: opts.name ?? `Generated ${seed} (${blocks * BLOCK_WIDTH} m)`,
    theme: opts.theme ?? 'beach',
    terrain: { spans, friction: DEFAULT_TERRAIN_FRICTION, restitution: DEFAULT_TERRAIN_RESTITUTION },
    cartStart: { ...START_CART },
    funnel: { ...START_FUNNEL },
    goal: fin.goal,
    props: [{ id: 'blender', art: 'blender', position: fin.blenderAt }],
    zones: [],
    killY: maxY + 20,
  };
  return { level, features, blocks };
}

// -------------------------------------------------------- endless source

/**
 * Endless terrain as a TerrainSource: chunk k is cut from block k alone
 * (plus the neighbouring connector points, which are pure functions of the
 * boundaries). Unbounded to the right; nothing left of x = 0.
 */
export class ProceduralChunkSource implements TerrainSource {
  readonly chunkWidth = BLOCK_WIDTH;
  readonly firstChunk = 0;
  readonly lastChunk = Infinity;
  readonly friction = DEFAULT_TERRAIN_FRICTION;
  readonly restitution = DEFAULT_TERRAIN_RESTITUTION;
  readonly seed: number;

  constructor(seed: TerrainSeed) {
    this.seed = normalizeSeed(seed);
  }

  chunk(index: number): TerrainChunk {
    if (!Number.isInteger(index) || index < 0) return makeChunk(index, [], this.chunkWidth);
    const g = generateBlock(this.seed, index);
    const local: Vec2[][] = [];
    if (g.wallBefore) local.push(g.wallBefore);
    g.lines.forEach((line, i) => {
      const l = [...line];
      if (i === 0 && index > 0) l.unshift(connectorPoints(this.seed, index)[0]);
      if (i === g.lines.length - 1) l.push(connectorPoints(this.seed, index + 1)[1]);
      local.push(l);
    });
    return makeChunk(index, chunkSpans(local, this.chunkWidth).get(index) ?? [], this.chunkWidth);
  }

  /** Feature (if any) in block `index` — for renderers/props and debugging. */
  feature(index: number): FeatureInstance | null {
    return index >= 0 && Number.isInteger(index) ? generateBlock(this.seed, index).feature : null;
  }
}
