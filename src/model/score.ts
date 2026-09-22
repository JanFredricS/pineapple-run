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

/**
 * Carry bonus points for the results screen: what the aboard multiplier adds
 * on top of the raw distance. DISPLAY FLAVOUR ONLY (INTEGRATION.md endless
 * scoring ruling) — best comparisons always use raw furthest distance.
 */
export function endlessCarryBonus(furthestMetres: number, aboardAtEnd: number): number {
  return endlessScore(furthestMetres, aboardAtEnd) - endlessScore(furthestMetres, 0);
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

/** Largest seconds / metres a ScoreBook stores (validator limit). */
export const MAX_SCORE_VALUE = 1e6;
/** Max length of a level id or endless seed (validator limit). */
export const MAX_SCORE_ID_LENGTH = 64;
/** Max level records in a ScoreBook (validator limit). */
export const MAX_SCORE_LEVELS = 10_000;
/** Max endless seed records in a ScoreBook (validator limit). */
export const MAX_SCORE_SEEDS = 10_000;

/** Thrown by the record helpers for inputs that cannot be stored. */
export class ScoreInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoreInputError';
  }
}

function scoreId(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_SCORE_ID_LENGTH) {
    throw new ScoreInputError(`${what} must be a non-empty string of at most ${MAX_SCORE_ID_LENGTH} characters`);
  }
  return v;
}

/** Non-finite -> ScoreInputError; finite values are clamped into [0, MAX]. */
function scoreNumber(v: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ScoreInputError(`${what} must be a finite number`);
  return Math.min(MAX_SCORE_VALUE, Math.max(0, v));
}

/**
 * Eviction rule for the record caps. validateScoreBook rejects a book with
 * more than MAX_SCORE_LEVELS level records or MAX_SCORE_SEEDS seed records,
 * so the record helpers must never return one. When recording a NEW id/seed
 * would exceed the cap, the helpers keep the new result and drop the least
 * valuable existing records instead: lowest bestRating (levels) / lowest
 * bestDistance (seeds); ties drop the earliest entry in the array (updates
 * re-append, so earlier = least recently improved). Updating an existing
 * id/seed never grows the array and so never evicts. endless.overallBestDistance
 * is a separate field and is never reduced by evicting a seed.
 *
 * Returns `entries` itself when already within `cap`; otherwise a copy with
 * the `entries.length - cap` lowest-valued entries removed, order preserved.
 */
function evictLowest<T>(entries: T[], cap: number, value: (e: T) => number): T[] {
  const excess = entries.length - cap;
  if (excess <= 0) return entries;
  const drop = new Set(
    entries
      .map((e, i) => ({ v: value(e), i }))
      .sort((a, b) => a.v - b.v || a.i - b.i)
      .slice(0, excess)
      .map((x) => x.i),
  );
  return entries.filter((_, i) => !drop.has(i));
}

export function emptyScoreBook(): ScoreBook {
  return { version: SCORE_BOOK_VERSION, levels: [], endless: { overallBestDistance: 0, seeds: [] } };
}

export function levelBest(book: ScoreBook, levelId: string): LevelBest | undefined {
  return book.levels.find((l) => l.levelId === levelId);
}

/**
 * Returns a new book with the level result recorded if it beats the best.
 * Total: every returned book passes validateScoreBook. Non-finite inputs or a
 * bad level id throw ScoreInputError; finite out-of-range numbers are clamped
 * (seconds to [0, 1e6], delivered to an integer in [0, 15]). A new level id
 * at the MAX_SCORE_LEVELS cap evicts the lowest-rated record (see evictLowest).
 */
export function recordLevelResult(book: ScoreBook, levelId: string, seconds: number, delivered: number): ScoreBook {
  const id = scoreId(levelId, 'levelId');
  const secs = scoreNumber(seconds, 'seconds');
  const del = Math.min(TOTAL_PINEAPPLES, Math.floor(scoreNumber(delivered, 'delivered')));
  const rating = efficiencyRating(secs, del);
  const prev = levelBest(book, id);
  if (prev && prev.bestRating >= rating) return book;
  const entry: LevelBest = { levelId: id, bestRating: rating, seconds: secs, delivered: del };
  const others = evictLowest(
    book.levels.filter((l) => l.levelId !== id),
    MAX_SCORE_LEVELS - 1,
    (l) => l.bestRating,
  );
  return { ...book, levels: [...others, entry] };
}

/**
 * Returns a new book with the endless distance recorded per seed and overall.
 * Total like recordLevelResult: bad seed / non-finite distance throw
 * ScoreInputError; finite distances are clamped to [0, 1e6]. A new seed at the
 * MAX_SCORE_SEEDS cap evicts the lowest-distance seed record (see evictLowest).
 */
export function recordEndlessResult(book: ScoreBook, seed: string, distance: number): ScoreBook {
  seed = scoreId(seed, 'seed');
  const d = scoreNumber(distance, 'distance');
  const prev = book.endless.seeds.find((s) => s.seed === seed);
  const seeds =
    prev && prev.bestDistance >= d
      ? book.endless.seeds
      : [
          ...evictLowest(
            book.endless.seeds.filter((s) => s.seed !== seed),
            MAX_SCORE_SEEDS - 1,
            (s) => s.bestDistance,
          ),
          { seed, bestDistance: d },
        ];
  const overallBestDistance = Math.max(book.endless.overallBestDistance, d);
  if (seeds === book.endless.seeds && overallBestDistance === book.endless.overallBestDistance) return book;
  return { ...book, endless: { overallBestDistance, seeds } };
}
