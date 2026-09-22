/**
 * Scoring formulas. The ONLY place scoring math lives (PLAN.md contract 3):
 * S5 consumes run events and calls these; no slice reimplements them.
 */

export const TOTAL_PINEAPPLES = 15;
/** Seconds of simulation time that are "free" before the rating drops. */
export const PAR_SECONDS = 15;

export type RatingBand = 'red' | 'yellow' | 'green';

/**
 * Efficiency Rating (original EndScreen.show):
 *   timeScore = clamp(100 - (seconds - 15), 0, 100)
 *   rating    = round(timeScore * delivered / 15)
 * `seconds` is SIMULATION time since Release (steps / 60), never wall clock.
 */
export function efficiencyRating(seconds: number, delivered: number, total = TOTAL_PINEAPPLES): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(delivered) || total <= 0) return 0;
  const timeScore = Math.min(100, Math.max(0, 100 - (seconds - PAR_SECONDS)));
  const d = Math.min(total, Math.max(0, Math.floor(delivered)));
  return Math.round((timeScore * d) / total);
}

/** Red < 33, yellow 33-66, green > 66. */
export function ratingBand(rating: number): RatingBand {
  if (rating < 33) return 'red';
  if (rating <= 66) return 'yellow';
  return 'green';
}

/**
 * PROVISIONAL (owned by S5 to finalise): endless score = furthest distance
 * carried (metres) with a small bonus multiplier per pineapple still aboard.
 */
export const ENDLESS_CARRY_BONUS_PER_PINEAPPLE = 0.02;

export function endlessScore(furthestMetres: number, aboardAtEnd: number): number {
  const dist = Math.max(0, Number.isFinite(furthestMetres) ? furthestMetres : 0);
  const aboard = Math.min(TOTAL_PINEAPPLES, Math.max(0, Math.floor(aboardAtEnd)));
  return Math.round(dist * (1 + ENDLESS_CARRY_BONUS_PER_PINEAPPLE * aboard));
}

// ------------------------------------------------------------ persistence

/**
 * Saved best scores (localStorage), versioned and validated through
 * model/validate like carts and levels (PLAN.md contract 5).
 *
 * Stored as arrays of records, not objects keyed by id, so arbitrary level
 * ids / seeds can never collide with Object.prototype keys.
 */
export const SCORE_BOOK_VERSION = 1 as const;

export interface LevelBest {
  levelId: string;
  /** Best Efficiency Rating, integer 0..100. */
  bestRating: number;
  /** Simulation seconds and pineapples delivered on the best run. */
  seconds: number;
  delivered: number;
}

export interface EndlessSeedBest {
  /** Endless seed as a string (numeric seeds are stringified). */
  seed: string;
  /** Furthest distance carried, metres. */
  bestDistance: number;
}

export interface ScoreBook {
  version: typeof SCORE_BOOK_VERSION;
  levels: LevelBest[];
  endless: {
    /** Best distance over all seeds, metres. */
    overallBestDistance: number;
    seeds: EndlessSeedBest[];
  };
}

export function emptyScoreBook(): ScoreBook {
  return { version: SCORE_BOOK_VERSION, levels: [], endless: { overallBestDistance: 0, seeds: [] } };
}

export function levelBest(book: ScoreBook, levelId: string): LevelBest | undefined {
  return book.levels.find((l) => l.levelId === levelId);
}

/** Returns a new book with the level result recorded if it beats the best. */
export function recordLevelResult(book: ScoreBook, levelId: string, seconds: number, delivered: number): ScoreBook {
  const rating = efficiencyRating(seconds, delivered);
  const prev = levelBest(book, levelId);
  if (prev && prev.bestRating >= rating) return book;
  const entry: LevelBest = { levelId, bestRating: rating, seconds, delivered: Math.min(TOTAL_PINEAPPLES, Math.max(0, Math.floor(delivered))) };
  return { ...book, levels: [...book.levels.filter((l) => l.levelId !== levelId), entry] };
}

/** Returns a new book with the endless distance recorded per seed and overall. */
export function recordEndlessResult(book: ScoreBook, seed: string, distance: number): ScoreBook {
  const d = Math.max(0, Number.isFinite(distance) ? distance : 0);
  const prev = book.endless.seeds.find((s) => s.seed === seed);
  const seeds = prev && prev.bestDistance >= d ? book.endless.seeds : [...book.endless.seeds.filter((s) => s.seed !== seed), { seed, bestDistance: d }];
  const overallBestDistance = Math.max(book.endless.overallBestDistance, d);
  if (seeds === book.endless.seeds && overallBestDistance === book.endless.overallBestDistance) return book;
  return { ...book, endless: { overallBestDistance, seeds } };
}
