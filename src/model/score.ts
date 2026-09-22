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
