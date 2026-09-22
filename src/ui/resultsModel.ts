/**
 * Results-screen model: turns the run outcome (AppState 'results') into what
 * the screen shows, recording the result through ScoreStore (-> model/score).
 * No DOM; no scoring math of its own.
 */

import type { EndlessRunStats } from '../app';
import type { RunEvent } from '../model/runEvents';
import type { LevelBest } from '../model/score';
import { isUnlocked, nextCourse, parseRunTarget, type CourseInfo } from './catalog';
import { endlessView, ratingView, type EndlessView, type RatingView } from './format';
import type { ScoreStore } from './scoreStore';

export interface LevelResults {
  kind: 'level';
  levelId: string;
  courseName: string;
  /** Run ended by Give Up (scored as 0 delivered, not saved). */
  gaveUp: boolean;
  seconds: number;
  delivered: number;
  rating: RatingView;
  previousBest: LevelBest | undefined;
  best: LevelBest | undefined;
  newBest: boolean;
  /** False when scores can't be persisted this session (read-only / not recorded). */
  saved: boolean;
  next: CourseInfo | null;
  nextUnlocked: boolean;
}

export interface EndlessResults {
  kind: 'endless';
  seed: string;
  gaveUp: boolean;
  seconds: number;
  view: EndlessView;
  seedBest: number;
  overallBest: number;
  newSeedBest: boolean;
  newOverallBest: boolean;
  saved: boolean;
}

export type ResultsModel = LevelResults | EndlessResults;

export interface ResultsInput {
  levelId: string;
  outcome: RunEvent | null;
  endless?: EndlessRunStats;
}

export function buildResults(input: ResultsInput, store: ScoreStore): ResultsModel {
  const target = parseRunTarget(input.levelId);
  const e = input.outcome;
  const seconds = e && Number.isFinite(e.simTime) ? Math.max(0, e.simTime) : 0;
  const gaveUp = !e || e.type === 'gaveUp';

  if (target.kind === 'endless') {
    const stats = input.endless;
    // Aboard at the end only counts on Give Up; losing the last one means 0.
    const aboard = e?.type === 'gaveUp' ? (stats?.aboard ?? 0) : 0;
    const furthest = stats?.furthestMetres ?? 0;
    const rec = stats ? store.recordEndless(target.seed, furthest) : null;
    const book = rec?.book ?? store.load();
    return {
      kind: 'endless',
      seed: target.seed,
      gaveUp,
      seconds,
      view: endlessView(furthest, aboard),
      seedBest: rec?.seedBest ?? book.endless.seeds.find((s) => s.seed === target.seed)?.bestDistance ?? 0,
      overallBest: book.endless.overallBestDistance,
      newSeedBest: !!rec && rec.improvedSeed && furthest > 0,
      newOverallBest: !!rec && rec.improvedOverall,
      saved: !!rec && !store.isReadOnly,
    };
  }

  const delivered = e?.type === 'goalReached' ? e.delivered : 0;
  const scored = e?.type === 'goalReached';
  const rec = scored ? store.recordLevel(target.levelId, seconds, delivered) : null;
  const previousBest = rec ? rec.previous : store.levelBest(target.levelId);
  const book = rec?.book ?? store.load();
  const next = nextCourse(target.levelId);
  return {
    kind: 'level',
    levelId: target.levelId,
    courseName: target.course?.name ?? target.levelId,
    gaveUp: !scored,
    seconds,
    delivered: scored ? Math.max(0, Math.floor(delivered)) : 0,
    rating: ratingView(seconds, scored ? delivered : 0),
    previousBest,
    best: rec ? rec.best : previousBest,
    newBest: !!rec && rec.improved,
    saved: !!rec && !store.isReadOnly,
    next,
    nextUnlocked: next ? isUnlocked(book, next.levelId) : false,
  };
}
