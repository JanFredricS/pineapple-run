import { describe, expect, it } from 'vitest';
import { MAX_SCORE_LEVELS, MAX_SCORE_SEEDS, ScoreInputError, emptyScoreBook, levelBest, recordEndlessResult, recordLevelResult, type ScoreBook } from '../../src/model/score';
import { parseScoreBook, validateScoreBook } from '../../src/model/validate';

const book = (): ScoreBook => ({
  version: 1,
  levels: [{ levelId: 'beach-1', bestRating: 70, seconds: 45, delivered: 15 }],
  endless: { overallBestDistance: 812.5, seeds: [{ seed: '12345', bestDistance: 812.5 }, { seed: 'daily-2026-09-22', bestDistance: 300 }] },
});

describe('ScoreBook validation', () => {
  it('accepts a valid book and returns a normalised copy', () => {
    const r = validateScoreBook({ ...book(), junk: 1 });
    expect(r).toEqual({ ok: true, value: book() });
  });

  it('round-trips through JSON text; empty book is valid', () => {
    expect(parseScoreBook(JSON.stringify(book()))).toEqual({ ok: true, value: book() });
    expect(validateScoreBook(emptyScoreBook())).toEqual({ ok: true, value: emptyScoreBook() });
  });

  it('rejects invalid JSON, missing / future versions', () => {
    expect(parseScoreBook('{')).toMatchObject({ ok: false, error: { code: 'invalidJson' } });
    expect(validateScoreBook({ levels: [] })).toMatchObject({ ok: false, error: { code: 'missingVersion' } });
    expect(validateScoreBook({ ...book(), version: 2 })).toMatchObject({ ok: false, error: { code: 'futureVersion' } });
    expect(validateScoreBook({ ...book(), version: 0 })).toMatchObject({ ok: false, error: { code: 'unsupportedVersion' } });
  });

  it.each([
    ['rating > 100', (b: any) => (b.levels[0].bestRating = 101), 'levels[0].bestRating'],
    ['fractional rating', (b: any) => (b.levels[0].bestRating = 50.5), 'levels[0].bestRating'],
    ['delivered > 15', (b: any) => (b.levels[0].delivered = 16), 'levels[0].delivered'],
    ['negative seconds', (b: any) => (b.levels[0].seconds = -1), 'levels[0].seconds'],
    ['empty level id', (b: any) => (b.levels[0].levelId = ''), 'levels[0].levelId'],
    ['duplicate level', (b: any) => b.levels.push({ ...b.levels[0] }), 'levels[1].levelId'],
    ['NaN distance', (b: any) => (b.endless.seeds[0].bestDistance = NaN), 'endless.seeds[0].bestDistance'],
    ['duplicate seed', (b: any) => b.endless.seeds.push({ ...b.endless.seeds[0] }), 'endless.seeds[2].seed'],
    ['overall below a seed best', (b: any) => (b.endless.overallBestDistance = 10), 'endless.overallBestDistance'],
    ['missing endless', (b: any) => delete b.endless, 'endless'],
  ])('rejects %s', (_n, mutate, path) => {
    const b = JSON.parse(JSON.stringify(book()));
    mutate(b);
    expect(validateScoreBook(b)).toMatchObject({ ok: false, error: { code: 'schema', path } });
  });

  it('treats "__proto__" / "constructor" as ordinary ids', () => {
    const b = JSON.parse('{"version":1,"levels":[{"levelId":"__proto__","bestRating":10,"seconds":100,"delivered":15}],"endless":{"overallBestDistance":1,"seeds":[{"seed":"constructor","bestDistance":1}]}}');
    const r = validateScoreBook(b);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(levelBest(r.value, '__proto__')?.bestRating).toBe(10);
      expect(levelBest(r.value, 'toString')).toBeUndefined();
    }
  });
});

describe('ScoreBook updates', () => {
  it('keeps the best efficiency rating per level', () => {
    let b = emptyScoreBook();
    b = recordLevelResult(b, 'l1', 45, 15); // 70
    expect(levelBest(b, 'l1')).toEqual({ levelId: 'l1', bestRating: 70, seconds: 45, delivered: 15 });
    const same = recordLevelResult(b, 'l1', 60, 15); // 55: worse
    expect(same).toBe(b);
    b = recordLevelResult(b, 'l1', 20, 15); // 95
    expect(levelBest(b, 'l1')?.bestRating).toBe(95);
    expect(b.levels).toHaveLength(1);
    expect(validateScoreBook(b).ok).toBe(true);
  });

  it('keeps best distance per endless seed and overall', () => {
    let b = emptyScoreBook();
    b = recordEndlessResult(b, 'a', 100);
    b = recordEndlessResult(b, 'b', 250);
    b = recordEndlessResult(b, 'a', 50);
    expect(b.endless).toEqual({ overallBestDistance: 250, seeds: [{ seed: 'a', bestDistance: 100 }, { seed: 'b', bestDistance: 250 }] });
    expect(recordEndlessResult(b, 'b', 10)).toBe(b);
    expect(validateScoreBook(b).ok).toBe(true);
  });
});

describe('ScoreBook record caps', () => {
  /** A valid book holding exactly MAX_SCORE_LEVELS levels and MAX_SCORE_SEEDS seeds. */
  const fullBook = (): ScoreBook => ({
    version: 1,
    levels: Array.from({ length: MAX_SCORE_LEVELS }, (_, i) => ({
      levelId: `l${i}`,
      bestRating: i === 7 ? 1 : 50 + (i % 40),
      seconds: 30,
      delivered: 15,
    })),
    endless: {
      overallBestDistance: 5000,
      seeds: Array.from({ length: MAX_SCORE_SEEDS }, (_, i) => ({ seed: `s${i}`, bestDistance: i === 11 ? 2 : 100 + (i % 500) })),
    },
  });

  it('the full fixture itself validates (caps are shared with the validator)', () => {
    expect(validateScoreBook(fullBook()).ok).toBe(true);
    const over = fullBook();
    over.levels.push({ levelId: 'extra', bestRating: 1, seconds: 1, delivered: 1 });
    expect(validateScoreBook(over)).toMatchObject({ ok: false, error: { path: 'levels' } });
  });

  it('updating an existing level / seed at the cap evicts nothing', () => {
    const b0 = fullBook();
    const b = recordLevelResult(b0, 'l7', 20, 15); // 1 -> 95
    expect(b.levels).toHaveLength(MAX_SCORE_LEVELS);
    expect(levelBest(b, 'l7')?.bestRating).toBe(95);
    expect(new Set(b.levels.map((l) => l.levelId))).toEqual(new Set(b0.levels.map((l) => l.levelId)));
    expect(validateScoreBook(b).ok).toBe(true);

    const e = recordEndlessResult(b0, 's11', 200);
    expect(e.endless.seeds).toHaveLength(MAX_SCORE_SEEDS);
    expect(e.endless.seeds.find((s) => s.seed === 's11')?.bestDistance).toBe(200);
    expect(new Set(e.endless.seeds.map((s) => s.seed))).toEqual(new Set(b0.endless.seeds.map((s) => s.seed)));
    expect(validateScoreBook(e).ok).toBe(true);
  });

  it('a new level id at the cap evicts the lowest-rated record and keeps the new one', () => {
    const b = recordLevelResult(fullBook(), 'new-level', 45, 15); // 70
    expect(b.levels).toHaveLength(MAX_SCORE_LEVELS);
    expect(levelBest(b, 'l7')).toBeUndefined();
    expect(levelBest(b, 'new-level')?.bestRating).toBe(70);
    expect(validateScoreBook(JSON.parse(JSON.stringify(b))).ok).toBe(true);
    // Even a new result worse than every record is kept (the lowest existing one goes).
    const w = recordLevelResult(b, 'worst', 1000, 1);
    expect(w.levels).toHaveLength(MAX_SCORE_LEVELS);
    expect(levelBest(w, 'worst')).toBeDefined();
    expect(validateScoreBook(w).ok).toBe(true);
  });

  it('a new seed at the cap evicts the lowest-distance seed; overall best is untouched', () => {
    const b = recordEndlessResult(fullBook(), 'new-seed', 150);
    expect(b.endless.seeds).toHaveLength(MAX_SCORE_SEEDS);
    expect(b.endless.seeds.find((s) => s.seed === 's11')).toBeUndefined();
    expect(b.endless.seeds.find((s) => s.seed === 'new-seed')?.bestDistance).toBe(150);
    expect(b.endless.overallBestDistance).toBe(5000);
    expect(validateScoreBook(JSON.parse(JSON.stringify(b))).ok).toBe(true);
  });

  it('ties evict the earliest entry', () => {
    const b0 = fullBook();
    b0.levels[7]!.bestRating = 50; // now l0 (rating 50) is the earliest lowest
    const b = recordLevelResult(b0, 'new-level', 45, 15);
    expect(levelBest(b, 'l0')).toBeUndefined();
    expect(levelBest(b, 'l7')).toBeDefined();
  });
});

describe('ScoreBook helpers are total (property-style)', () => {
  const numbers = [NaN, Infinity, -Infinity, -1, -0, 0, 0.4, 14.99, 15, 16, 45.5, 115, 999_999.9, 1e6, 1e6 + 1, 1e12, Number.MAX_VALUE];
  const ids = ['', 'a', 'beach-1', '__proto__', 'constructor', 'x'.repeat(64), 'x'.repeat(65)];

  /** Deterministic PRNG so failures reproduce. */
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;

  it('every returned book survives a JSON round-trip and validates, or the helper throws ScoreInputError', () => {
    const r = rng(2026);
    let book = emptyScoreBook();
    let thrown = 0;
    let recorded = 0;
    for (let i = 0; i < 5000; i++) {
      try {
        const next =
          r() < 0.5
            ? recordLevelResult(book, pick(r, ids), pick(r, numbers), pick(r, numbers))
            : recordEndlessResult(book, pick(r, ids), pick(r, numbers));
        const v = validateScoreBook(JSON.parse(JSON.stringify(next)));
        if (!v.ok) throw new Error(`invalid book after step ${i}: ${v.error.message}`);
        expect(v.value).toEqual(JSON.parse(JSON.stringify(next)));
        if (next !== book) recorded++;
        book = next;
      } catch (e) {
        if (!(e instanceof ScoreInputError)) throw e;
        thrown++;
      }
    }
    expect(thrown).toBeGreaterThan(0);
    expect(recorded).toBeGreaterThan(0);
  });

  it('near the record caps, fresh ids/seeds never produce a book the validator rejects', () => {
    const r = rng(7);
    const start = MAX_SCORE_LEVELS - 3; // a few steps below the cap, so draws push past it
    let book: ScoreBook = {
      version: 1,
      levels: Array.from({ length: start }, (_, i) => ({ levelId: `p${i}`, bestRating: i % 101, seconds: 20, delivered: 15 })),
      endless: {
        overallBestDistance: 1e6,
        seeds: Array.from({ length: Math.min(start, MAX_SCORE_SEEDS - 3) }, (_, i) => ({ seed: `p${i}`, bestDistance: i % 997 })),
      },
    };
    expect(validateScoreBook(book).ok).toBe(true);
    let fresh = 0;
    let atCap = 0;
    for (let i = 0; i < 300; i++) {
      // Mix of: brand-new ids (grow / evict), prefilled ids (update), edge ids (incl. invalid).
      const u = r();
      const id = u < 0.5 ? `n${fresh++}` : u < 0.8 ? `p${Math.floor(r() * start)}` : pick(r, ids);
      try {
        const next =
          r() < 0.5
            ? recordLevelResult(book, id, pick(r, numbers), pick(r, numbers))
            : recordEndlessResult(book, id, pick(r, numbers));
        const v = validateScoreBook(JSON.parse(JSON.stringify(next)));
        if (!v.ok) throw new Error(`invalid book after step ${i}: ${v.error.message}`);
        expect(next.levels.length).toBeLessThanOrEqual(MAX_SCORE_LEVELS);
        expect(next.endless.seeds.length).toBeLessThanOrEqual(MAX_SCORE_SEEDS);
        expect(next.endless.overallBestDistance).toBeGreaterThanOrEqual(book.endless.overallBestDistance);
        if (next.levels.length === MAX_SCORE_LEVELS || next.endless.seeds.length === MAX_SCORE_SEEDS) atCap++;
        book = next;
      } catch (e) {
        if (!(e instanceof ScoreInputError)) throw e;
      }
    }
    expect(atCap).toBeGreaterThan(100); // the run actually spent time at the caps
  });

  it.each([
    ['NaN seconds', () => recordLevelResult(emptyScoreBook(), 'x', NaN, 5)],
    ['Infinity delivered', () => recordLevelResult(emptyScoreBook(), 'x', 20, Infinity)],
    ['empty level id', () => recordLevelResult(emptyScoreBook(), '', 20, 5)],
    ['NaN distance', () => recordEndlessResult(emptyScoreBook(), 's', NaN)],
    ['empty seed', () => recordEndlessResult(emptyScoreBook(), '', 10)],
    ['65-char seed', () => recordEndlessResult(emptyScoreBook(), 'x'.repeat(65), 10)],
  ])('throws ScoreInputError for %s', (_n, f) => {
    expect(f).toThrow(ScoreInputError);
  });

  it('clamps finite out-of-range numbers', () => {
    const b = recordEndlessResult(emptyScoreBook(), 's', 5e6);
    expect(b.endless).toEqual({ overallBestDistance: 1e6, seeds: [{ seed: 's', bestDistance: 1e6 }] });
    expect(recordEndlessResult(emptyScoreBook(), 's', -3).endless.seeds).toEqual([{ seed: 's', bestDistance: 0 }]);
    const l = recordLevelResult(emptyScoreBook(), 'l', 5, 99.7);
    expect(levelBest(l, 'l')).toEqual({ levelId: 'l', bestRating: 100, seconds: 5, delivered: 15 });
  });
});
