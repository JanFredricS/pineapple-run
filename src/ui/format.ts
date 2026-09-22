/**
 * Display formatting for the HUD and results screens. Pure (no DOM).
 *
 * Scoring numbers always come from model/score — this module only turns them
 * into strings/labels. It never computes a rating or an endless score itself.
 */

import {
  TOTAL_PINEAPPLES,
  efficiencyRating,
  endlessScore,
  ratingBand,
  type RatingBand,
} from '../model/score';

/**
 * Sim-time seconds -> "m:ss" (or "h:mm:ss" from one hour). With `tenths`,
 * appends ".d" (truncated, never rounded up, so the display never runs ahead
 * of the clock). Non-finite / negative input shows as zero.
 */
export function formatClock(seconds: number, opts: { tenths?: boolean } = {}): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  // +1e-9 guards float noise like 2.9999999999 from step accumulation.
  const totalTenths = Math.floor(s * 10 + 1e-9);
  const whole = Math.floor(totalTenths / 10);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const sec = whole % 60;
  const ss = String(sec).padStart(2, '0');
  const base = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  return opts.tenths ? `${base}.${totalTenths % 10}` : base;
}

/** Integer with thin-space-free "," thousands separators (locale-independent). */
export function formatInt(n: number): string {
  const v = Number.isFinite(n) ? Math.trunc(n) : 0;
  const sign = v < 0 ? '-' : '';
  return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Metres -> "123 m" (floored: distance is never over-reported). */
export function formatDistance(metres: number): string {
  const m = Number.isFinite(metres) && metres > 0 ? Math.floor(metres + 1e-9) : 0;
  return `${formatInt(m)} m`;
}

/** "11/15" */
export function formatDelivered(delivered: number, total = TOTAL_PINEAPPLES): string {
  const d = Number.isFinite(delivered) ? Math.min(total, Math.max(0, Math.floor(delivered))) : 0;
  return `${d}/${total}`;
}

export interface RatingView {
  /** Integer 0..100 straight from model/score efficiencyRating. */
  rating: number;
  band: RatingBand;
  /** "66%" */
  text: string;
  /** Accessible band name: "low" | "medium" | "high". */
  bandLabel: string;
}

const BAND_LABEL: Record<RatingBand, string> = { red: 'low', yellow: 'medium', green: 'high' };

/** View of a stored/known rating value (e.g. a best-score badge). */
export function ratingViewOf(rating: number): RatingView {
  const r = Number.isFinite(rating) ? Math.round(rating) : 0;
  const band = ratingBand(r);
  return { rating: r, band, text: `${r}%`, bandLabel: BAND_LABEL[band] };
}

/** Efficiency Rating view for a finished level run (math in model/score). */
export function ratingView(seconds: number, delivered: number): RatingView {
  return ratingViewOf(efficiencyRating(seconds, delivered));
}

export interface EndlessView {
  distanceText: string;
  aboard: number;
  /** Final score from model/score endlessScore. */
  score: number;
  /** Points the carry bonus added: endlessScore(d, aboard) - endlessScore(d, 0). */
  bonus: number;
}

export function endlessView(furthestMetres: number, aboardAtEnd: number): EndlessView {
  const aboard = Number.isFinite(aboardAtEnd) ? Math.min(TOTAL_PINEAPPLES, Math.max(0, Math.floor(aboardAtEnd))) : 0;
  const score = endlessScore(furthestMetres, aboard);
  return {
    distanceText: formatDistance(furthestMetres),
    aboard,
    score,
    bonus: score - endlessScore(furthestMetres, 0),
  };
}
