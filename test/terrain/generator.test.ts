import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../src/model/geometry';
import type { LevelDef } from '../../src/model/level';
import { MAX_TERRAIN_POINTS_TOTAL, MAX_TERRAIN_SPANS, validateLevelDef } from '../../src/model/validate';
import { LevelChunkSource, sanitizePiece } from '../../src/terrain/chunks';
import {
  BASE_Y,
  BLOCK_WIDTH,
  blockDifficulty,
  ENDLESS_KILL_Y,
  GAP_MAX,
  GAP_WALL_LEAN,
  GAP_MIN,
  generateBlock,
  generateLevel,
  GENERATOR_SLOPE_LIMITS,
  MAX_BLOCK_POINTS,
  MAX_GENERATED_BLOCKS,
  MAX_GENERATED_LENGTH,
  blocksForLength,
  courseLength,
  MIN_GENERATED_LENGTH,
  ProceduralChunkSource,
  slopeLimitsFor,
  START_CART,
  START_FLAT_END,
  WASHBOARD,
  type FeatureInstance,
} from '../../src/terrain/generator';
import { maxSlopeViolation } from '../../src/terrain/slope';

/** Gap side walls (S6T #1) run from a gap edge down to ENDLESS_KILL_Y: not driving surface. */
const isWallPoint = (p: Vec2) => p.y >= ENDLESS_KILL_Y - 1e-9;
const groundSpans = (level: LevelDef) =>
  level.terrain.spans.filter((s) => !s.id.endsWith('-wall')).map((s) => ({ ...s, points: s.points.filter((p) => !isWallPoint(p)) }));
const pointsIn = (level: LevelDef, x0: number, x1: number): Vec2[] =>
  groundSpans(level).flatMap((s) => s.points.filter((p) => p.x >= x0 - 1e-9 && p.x <= x1 + 1e-9));

// A shared corpus: 100 seeds × 2 km.
const SEEDS = Array.from({ length: 100 }, (_, i) => (i % 3 === 0 ? `seed-${i}` : i * 7919));
const corpus = SEEDS.map((s) => ({ seed: s, gen: generateLevel(s, 2000) }));

describe('determinism', () => {
  it('same seed -> identical LevelDef (and identical block geometry)', () => {
    for (const s of [0, 1, 'tiki', 123456789]) {
      expect(generateLevel(s, 1500)).toEqual(generateLevel(s, 1500));
      expect(JSON.stringify(generateBlock(s, 17))).toBe(JSON.stringify(generateBlock(s, 17)));
    }
    expect(generateLevel('42', 800)).toEqual(generateLevel(42, 800));
  });

  it('different seeds -> different terrain', () => {
    const sigs = new Set(corpus.map((c) => JSON.stringify(c.gen.level.terrain)));
    expect(sigs.size).toBe(corpus.length);
    // not just a shifted copy: heights at the same x differ
    const a = generateLevel(1, 600).level;
    const b = generateLevel(2, 600).level;
    const ya = pointsIn(a, 300, 300.001);
    const yb = pointsIn(b, 300, 300.001);
    expect(ya).not.toEqual(yb);
  });

  it('a shorter level is a prefix of a longer one (same seed)', () => {
    const short = generateLevel(9, 400);
    const long = generateLevel(9, 1200);
    const srcShort = new LevelChunkSource(short.level.terrain);
    const srcLong = new LevelChunkSource(long.level.terrain);
    for (let k = 0; k < short.blocks - 1; k++) expect(srcShort.chunk(k)).toEqual(srcLong.chunk(k));
  });
});

describe('validity', () => {
  it('100 seeds all pass model/validate', () => {
    for (const { seed, gen } of corpus) {
      const r = validateLevelDef(JSON.parse(JSON.stringify(gen.level)));
      if (!r.ok) throw new Error(`seed ${seed}: ${r.error.message}`);
      expect(r.value).toEqual(gen.level);
    }
  });

  it('the longest allowed level stays within the LevelDef limits', () => {
    const g = generateLevel('max', MAX_GENERATED_LENGTH);
    expect(g.blocks).toBe(MAX_GENERATED_BLOCKS);
    const pts = g.level.terrain.spans.reduce((n, s) => n + s.points.length, 0);
    expect(g.level.terrain.spans.length).toBeLessThanOrEqual(MAX_TERRAIN_SPANS);
    expect(pts).toBeLessThanOrEqual(MAX_TERRAIN_POINTS_TOTAL);
    // worst case by construction, too
    expect(MAX_GENERATED_BLOCKS * MAX_BLOCK_POINTS).toBeLessThanOrEqual(MAX_TERRAIN_POINTS_TOTAL);
    expect(MAX_GENERATED_BLOCKS + 3).toBeLessThanOrEqual(MAX_TERRAIN_SPANS);
    expect(validateLevelDef(g.level).ok).toBe(true);
  });

  it('rejects bad lengths', () => {
    expect(() => generateLevel(1, 0)).toThrow(RangeError);
    expect(() => generateLevel(1, NaN)).toThrow(RangeError);
    expect(() => generateLevel(1, MAX_GENERATED_LENGTH + 1)).toThrow(RangeError);
    expect(generateLevel(1, 1).blocks).toBe(2); // minimum: start + finish
    expect(generateLevel(1, 1).level.goal.lineX).toBeCloseTo(MIN_GENERATED_LENGTH, 9); // clamped up
  });

  it('starts on a flat plateau with the cart on it and ends with a goal', () => {
    const { level } = corpus[0]!.gen;
    for (const p of pointsIn(level, 0.1, START_FLAT_END)) expect(p.y).toBe(BASE_Y);
    expect(level.cartStart.x).toBeLessThan(START_FLAT_END);
    expect(level.cartStart.y).toBe(BASE_Y); // INTEGRATION #3: cartStart = ground
    expect(START_CART.y).toBe(level.cartStart.y);
    const lastSpan = groundSpans(level).at(-1)!;
    expect(level.goal.lineX).toBeLessThan(lastSpan.points.at(-1)!.x);
    expect(level.goal.lineX).toBeGreaterThan(1900);
  });

  it('goal line: L <= goal < L + one block, with L = max(requested, MIN_GENERATED_LENGTH)', () => {
    const lens = [0.001, 1, 21.3, 40, 41.3, 61.29, MIN_GENERATED_LENGTH, 61.31, 100, 101.3, 101.31, 599.9, 600, 2000, 2021.3, 2021.31, 12345, MAX_GENERATED_LENGTH];
    for (const len of lens) {
      const g = generateLevel('len', len);
      const L = Math.max(len, MIN_GENERATED_LENGTH);
      expect(g.level.goal.lineX, `len ${len}`).toBeGreaterThanOrEqual(L);
      expect(g.level.goal.lineX - L, `len ${len}`).toBeLessThan(BLOCK_WIDTH);
      expect(g.blocks).toBe(blocksForLength(len));
      const end = g.level.terrain.spans.at(-1)!.points.at(-1)!.x;
      expect(end).toBeGreaterThan(g.level.goal.lineX);
      // the id names the course actually built (its goal distance), not the request
      expect(g.level.id, `len ${len}`).toMatch(new RegExp(`^gen-\\d+-${Math.ceil(courseLength(g.blocks))}$`));
    }
  });

  it('audit S3-3 #3: the level id identifies the generated course — same course <=> same id', () => {
    const id = (len: number) => generateLevel(7, len).level.id;
    const course = (len: number) => JSON.stringify(generateLevel(7, len).level.terrain);
    // clamped up to the same 2-block course: one id
    for (const len of [0.001, 1, 21.3, 40, 61.29]) {
      expect(course(len)).toBe(course(MIN_GENERATED_LENGTH));
      expect(id(len), `len ${len}`).toBe(id(MIN_GENERATED_LENGTH));
    }
    expect(id(1)).toBe('gen-7-62');
    // either side of a block boundary: different courses, different ids (both ceil to 62 as requests)
    expect(course(61.31)).not.toBe(course(MIN_GENERATED_LENGTH));
    expect(id(61.31)).not.toBe(id(MIN_GENERATED_LENGTH));
    expect(id(61.31)).toBe('gen-7-102');
    expect(id(61.31)).toBe(id(101.3)); // same 3-block course
    expect(id(101.31)).not.toBe(id(101.3));
    // ids are injective over block counts
    const ids = new Set<string>();
    for (let b = 2; b <= 60; b++) ids.add(`gen-7-${Math.ceil(courseLength(b))}`);
    expect(ids.size).toBe(59);
  });
});

describe('slope clamp & drivability', () => {
  it('every segment stays within the per-block slope limits (100 seeds + endless blocks)', () => {
    for (const { seed, gen } of corpus) {
      for (const s of groundSpans(gen.level)) {
        const v = maxSlopeViolation(s.points, GENERATOR_SLOPE_LIMITS);
        if (v > 1e-9) throw new Error(`seed ${seed} span ${s.id}: slope violation ${v}`);
      }
    }
    // far-out endless blocks (full difficulty) too
    for (let seed = 0; seed < 20; seed++) {
      for (const k of [100, 500, 5000, 100000]) {
        for (const line of generateBlock(seed, k).lines) expect(maxSlopeViolation(line, GENERATOR_SLOPE_LIMITS)).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it('sustained climbs are gentle: average rise over any 6–12 m stretch stays drivable', () => {
    let worst = 0;
    for (const { gen } of corpus) {
      for (const s of groundSpans(gen.level)) {
        const P = s.points;
        for (let i = 0; i < P.length; i++) {
          for (let j = i + 1; j < P.length; j++) {
            const dx = P[j]!.x - P[i]!.x;
            if (dx < 6) continue;
            if (dx > 12) break;
            worst = Math.max(worst, -(P[j]!.y - P[i]!.y) / dx);
          }
        }
      }
    }
    expect(worst).toBeLessThan(0.7); // < 35°, and only on short feature ramps
  });

  it('limits ramp up with distance', () => {
    expect(slopeLimitsFor(blockDifficulty(1)).maxUp).toBeLessThan(slopeLimitsFor(blockDifficulty(60)).maxUp);
    expect(blockDifficulty(0)).toBe(0);
    expect(blockDifficulty(1000)).toBe(1);
  });

  it('all endless heights stay above the endless kill plane', () => {
    let maxY = -Infinity;
    for (let seed = 0; seed < 30; seed++) {
      for (let k = 0; k < 200; k++) for (const l of generateBlock(seed, k).lines) for (const p of l) maxY = Math.max(maxY, p.y);
    }
    expect(maxY).toBeLessThan(ENDLESS_KILL_Y - 5);
  });
});

describe('feature grammar', () => {
  const features = corpus.flatMap((c) => c.gen.features.map((f) => ({ f, level: c.gen.level })));
  const ofKind = (k: FeatureInstance['kind']) => features.filter((x) => x.f.kind === k);

  it('produces the whole vocabulary', () => {
    for (const k of ['valley', 'crest', 'launchLip', 'washboard', 'kicker', 'gap'] as const) {
      expect(ofKind(k).length).toBeGreaterThan(20);
    }
  });

  it('washboards match the spec: 9 bumps, 15 px (0.5 m) tall, 40 px (1.333 m) apart', () => {
    const wbs = ofKind('washboard');
    expect(wbs.length).toBeGreaterThan(50);
    for (const { f, level } of wbs) {
      const pts = pointsIn(level, f.x0, f.x1);
      const anchor = (x: number) => f.y0 + ((f.y1 - f.y0) * (x - f.x0)) / (f.x1 - f.x0);
      const rel = pts.map((p) => ({ x: p.x, o: p.y - anchor(p.x) }));
      const peaks = rel.filter((p, i) => i > 0 && i < rel.length - 1 && p.o < rel[i - 1]!.o && p.o < rel[i + 1]!.o);
      expect(peaks).toHaveLength(WASHBOARD.bumps);
      for (const p of peaks) expect(p.o).toBeCloseTo(-15 / 30, 9);
      for (let i = 1; i < peaks.length; i++) expect(peaks[i]!.x - peaks[i - 1]!.x).toBeCloseTo(40 / 30, 9);
      // bump bases sit on the anchor line
      rel.filter((p) => !peaks.includes(p)).forEach((p) => expect(p.o).toBeCloseTo(0, 9));
    }
  });

  it('gaps are real (a span break), bounded in width, and never land higher than take-off', () => {
    const gaps = ofKind('gap');
    expect(gaps.length).toBeGreaterThan(20);
    for (const { f, level } of gaps) {
      const width = f.gapX1! - f.gapX0!;
      expect(width).toBeGreaterThanOrEqual(GAP_MIN - 1e-9);
      expect(width).toBeLessThanOrEqual(GAP_MAX + 1e-9);
      const spans = groundSpans(level);
      const left = spans.find((s) => s.points.at(-1)!.x === f.gapX0);
      const right = spans.find((s) => s.points[0]!.x === f.gapX1);
      expect(left).toBeDefined();
      expect(right).toBeDefined();
      expect(pointsIn(level, f.gapX0! + 1e-6, f.gapX1! - 1e-6)).toEqual([]);
      expect(right!.points[0]!.y).toBeGreaterThanOrEqual(left!.points.at(-1)!.y - 1e-9);
      // S6T #1: both edges carry a side wall down to the kill plane, leaning into the hole
      const raw = (id: string) => level.terrain.spans.find((s) => s.id === id)!.points;
      expect(raw(left!.id).at(-1)).toEqual({ x: f.gapX0! + GAP_WALL_LEAN, y: ENDLESS_KILL_Y });
      expect(raw(right!.id)[0]).toEqual({ x: f.gapX1! - GAP_WALL_LEAN, y: ENDLESS_KILL_Y });
      expect(f.x0).toBeGreaterThan(200); // no gaps in the easy opening
    }
  });

  it('difficulty ramps: later blocks carry more gaps and fewer plain stretches', () => {
    const early = features.filter((x) => x.f.x0 < 700);
    const late = features.filter((x) => x.f.x0 >= 1300);
    const rate = (xs: typeof features, kind: string) => xs.filter((x) => x.f.kind === kind).length / xs.length;
    expect(rate(late, 'gap')).toBeGreaterThan(rate(early, 'gap') * 1.5);
    const blocksEarly = corpus.length * (700 / BLOCK_WIDTH);
    const blocksLate = corpus.length * (700 / BLOCK_WIDTH);
    expect(late.length / blocksLate).toBeGreaterThan(early.length / blocksEarly);
    const meanCrest = (xs: typeof features) => {
      const c = xs.filter((x) => x.f.kind === 'crest');
      return c.reduce((s, x) => s + x.f.params.height!, 0) / c.length;
    };
    expect(meanCrest(late)).toBeGreaterThan(meanCrest(early));
  });
});

describe('endless source == generated LevelDef', () => {
  it('ProceduralChunkSource chunks equal the chunks of generateLevel for the same seed', () => {
    for (const { seed, gen } of corpus.slice(0, 25)) {
      const endless = new ProceduralChunkSource(seed);
      const finite = new LevelChunkSource(gen.level.terrain);
      for (let k = 0; k < gen.blocks - 1; k++) expect(endless.chunk(k)).toEqual(finite.chunk(k));
    }
  });

  it('generated spans are already sanitized (cutSpan\'s whole-span sanitize is the identity on them)', () => {
    for (const { gen } of corpus) for (const s of gen.level.terrain.spans) expect(sanitizePiece(s.points)).toEqual(s.points);
  });

  it('adjacent endless chunks share their seam vertex exactly', () => {
    const src = new ProceduralChunkSource('seams');
    for (let k = 0; k < 100; k++) {
      const a = src.chunk(k).pieces.at(-1)!;
      const b = src.chunk(k + 1).pieces[0]!;
      expect(b[0]).toEqual(a.at(-1));
      expect(Math.abs(b[0]!.x - (k + 1) * BLOCK_WIDTH)).toBeLessThan(0.02);
    }
    expect(src.chunk(-1).pieces).toEqual([]);
  });
});
