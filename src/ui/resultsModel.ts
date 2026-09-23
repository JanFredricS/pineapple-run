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
  /** Run ended because every pineapple was lost with nothing recoverable (S6T #16). Implies gaveUp (unscored). */
  allLost: boolean;
  seconds: number;
  delivered: number;
  rating: RatingView;
  previousBest: LevelBest | undefined;
  best: LevelBest | undefined;
  newBest: boolean;
  /** True only when this result is really in storage (not memory / read-only / unrecorded). */
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
    // Carry bonus is DISPLAY FLAVOUR ONLY (INTEGRATION.md): shown from the
    // real aboard count (RunTelemetry.aboard) however the run ended, never
    // part of the best comparison — bests are raw furthest distance.
    const aboard = stats?.aboard ?? 0;
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
      saved: !!rec && rec.persisted,
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
    allLost: e?.type === 'allLost',
    seconds,
    delivered: scored ? Math.max(0, Math.floor(delivered)) : 0,
    rating: ratingView(seconds, scored ? delivered : 0),
    previousBest,
    best: rec ? rec.best : previousBest,
    newBest: !!rec && rec.improved,
    saved: !!rec && rec.persisted,
    next,
    nextUnlocked: next ? isUnlocked(book, next.levelId) : false,
  };
}

/**
 * Recorded results, per store, for the page's lifetime — deliberately NOT
 * evicted. Contract: a resultId is recorded at most once per ScoreStore for
 * as long as the page lives, and every mount of it renders the identical
 * model.
 *
 * Why in memory, unbounded: resultIds only exist inside in-memory AppState
 * (App state is never persisted), so no results state can outlive the page
 * that holds this map — page-lifetime memory is exactly as durable as the
 * ids themselves, and persisting them in the ScoreBook would add nothing.
 * Growth is one small model (well under 1 KB) per FINISHED run; a run takes
 * tens of seconds at least, so even a marathon 1,000-run session stays under
 * ~1 MB. An LRU cap would silently break record-once (round-2 audit).
 */
const recorded = new WeakMap<ScoreStore, Map<string, ResultsModel>>();

/**
 * Record-once / render-many: the first call for a `resultId` records the run
 * through `buildResults` and keeps the model; later calls (re-mounts of the
 * same results state, however many runs later) return that model without
 * touching the store, so a result is never double-recorded and always renders
 * identically.
 */
export function resultsFor(resultId: string, input: ResultsInput, store: ScoreStore): ResultsModel {
  let cache = recorded.get(store);
  if (!cache) recorded.set(store, (cache = new Map()));
  const hit = cache.get(resultId);
  if (hit) return hit;
  const model = buildResults(input, store);
  cache.set(resultId, model);
  return model;
}

/** True if `resultId` has already been recorded against `store`. */
export function isResultRecorded(resultId: string, store: ScoreStore): boolean {
  return recorded.get(store)?.has(resultId) ?? false;
}
