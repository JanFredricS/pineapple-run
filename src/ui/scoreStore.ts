/**
 * Best-score persistence (PLAN.md contract 5), on top of model/score +
 * model/validate. Pure apart from the injected StorageLike, so the corruption
 * recovery paths are unit-testable with a fake localStorage.
 *
 * Recovery policy (every failure is surfaced once via `onNotice`, never thrown):
 *  - corrupt JSON / schema error / unsupported old version: the raw text is
 *    copied to BACKUP_KEY (best effort), the primary key is removed, and the
 *    game continues with an empty book ("discard with a toast").
 *  - futureVersion (saved by a newer build, e.g. a stale cached PWA tab): the
 *    data is LEFT UNTOUCHED and the store goes read-only for this session, so
 *    an old build can never overwrite a newer player's scores.
 *  - storage unavailable (getItem throws: disabled / private mode) or a write
 *    fails (quota): the store keeps an in-memory book for the session.
 */

import {
  emptyScoreBook,
  levelBest,
  recordEndlessResult,
  recordLevelResult,
  ScoreInputError,
  type EndlessSeedBest,
  type LevelBest,
  type ScoreBook,
} from '../model/score';
import { parseScoreBook } from '../model/validate';

export const SCORE_STORAGE_KEY = 'pineapple-run.scores';
export const SCORE_BACKUP_KEY = 'pineapple-run.scores.corrupt';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StoreNoticeKind = 'discarded' | 'newerVersion' | 'unavailable' | 'saveFailed' | 'badResult';

export interface StoreNotice {
  kind: StoreNoticeKind;
  message: string;
}

export interface LevelRecordOutcome {
  previous: LevelBest | undefined;
  best: LevelBest | undefined;
  /** This run set a new best (and it was stored, or kept in memory). */
  improved: boolean;
  book: ScoreBook;
  /**
   * True only when the result is really in storage: the write reached
   * setItem successfully, or no write was needed and the store is backed by
   * real storage. False for in-memory fallback, read-only, or unscorable runs.
   */
  persisted: boolean;
}

export interface EndlessRecordOutcome {
  previousSeedBest: number | undefined;
  previousOverall: number;
  seedBest: number;
  overallBest: number;
  improvedSeed: boolean;
  improvedOverall: boolean;
  book: ScoreBook;
  /** Same meaning as LevelRecordOutcome.persisted. */
  persisted: boolean;
}

export class ScoreStore {
  private memory: ScoreBook | null = null;
  private readOnly = false;
  private readonly shown = new Set<StoreNoticeKind>();

  constructor(
    private readonly storage: StorageLike | null,
    private readonly onNotice: (n: StoreNotice) => void = () => {},
  ) {
    if (!storage) this.memory = emptyScoreBook();
  }

  /** True when this session will not write scores (newer data on disk). */
  get isReadOnly(): boolean {
    return this.readOnly;
  }

  private notice(kind: StoreNoticeKind, message: string, once = true): void {
    if (once && this.shown.has(kind)) return;
    this.shown.add(kind);
    this.onNotice({ kind, message });
  }

  /**
   * True while scores go to real storage: storage present, no in-memory
   * fallback, not read-only. Call after load() for an up-to-date answer.
   */
  get isPersistent(): boolean {
    return !!this.storage && !this.memory && !this.readOnly;
  }

  /** Current book. Storage is the source of truth unless we fell back to memory. */
  load(): ScoreBook {
    if (!this.storage) this.notice('unavailable', "Scores can't be saved on this device right now.");
    if (this.memory) return this.memory;
    let raw: string | null;
    try {
      raw = this.storage!.getItem(SCORE_STORAGE_KEY);
    } catch {
      this.memory = emptyScoreBook();
      this.notice('unavailable', "Scores can't be saved on this device right now.");
      return this.memory;
    }
    if (raw === null) return emptyScoreBook();
    const res = parseScoreBook(raw);
    if (res.ok) return res.value;
    if (res.error.code === 'futureVersion') {
      this.readOnly = true;
      this.notice('newerVersion', 'Your scores were saved by a newer version of the game — reload to update. Scores from this session won’t be saved.');
      return emptyScoreBook();
    }
    this.discard(raw);
    return emptyScoreBook();
  }

  private discard(raw: string): void {
    try {
      this.storage!.setItem(SCORE_BACKUP_KEY, raw);
    } catch {
      /* best effort: backup may not fit */
    }
    try {
      this.storage!.removeItem(SCORE_STORAGE_KEY);
    } catch {
      /* next save overwrites it anyway */
    }
    this.notice('discarded', 'Saved scores were damaged and have been reset.', false);
  }

  /** Returns true only when the book actually reached storage. */
  private save(book: ScoreBook): boolean {
    if (this.readOnly) return false;
    if (this.memory) {
      this.memory = book;
      return false;
    }
    try {
      this.storage!.setItem(SCORE_STORAGE_KEY, JSON.stringify(book));
      return true;
    } catch {
      this.memory = book;
      this.notice('saveFailed', "Couldn't save your score (storage full?). It's kept until you close the game.");
      return false;
    }
  }

  levelBest(levelId: string): LevelBest | undefined {
    return levelBest(this.load(), levelId);
  }

  endlessSeedBest(seed: string): EndlessSeedBest | undefined {
    return this.load().endless.seeds.find((s) => s.seed === seed);
  }

  /** Record a finished level run via model/score. */
  recordLevel(levelId: string, seconds: number, delivered: number): LevelRecordOutcome {
    const before = this.load();
    const previous = levelBest(before, levelId);
    let after: ScoreBook;
    try {
      after = recordLevelResult(before, levelId, seconds, delivered);
    } catch (e) {
      if (!(e instanceof ScoreInputError)) throw e;
      this.notice('badResult', `This run couldn't be scored (${e.message}).`, false);
      return { previous, best: previous, improved: false, book: before, persisted: false };
    }
    const improved = after !== before;
    const persisted = improved ? this.save(after) : this.isPersistent;
    return { previous, best: levelBest(after, levelId), improved, book: after, persisted };
  }

  /** Record a finished endless run (furthest metres carried) via model/score. */
  recordEndless(seed: string, distance: number): EndlessRecordOutcome {
    const before = this.load();
    const prevSeed = before.endless.seeds.find((s) => s.seed === seed)?.bestDistance;
    const prevOverall = before.endless.overallBestDistance;
    let after: ScoreBook;
    let scorable = true;
    try {
      after = recordEndlessResult(before, seed, distance);
    } catch (e) {
      if (!(e instanceof ScoreInputError)) throw e;
      this.notice('badResult', `This run couldn't be scored (${e.message}).`, false);
      after = before;
      scorable = false;
    }
    const persisted = !scorable ? false : after !== before ? this.save(after) : this.isPersistent;
    const seedBest = after.endless.seeds.find((s) => s.seed === seed)?.bestDistance ?? 0;
    return {
      previousSeedBest: prevSeed,
      previousOverall: prevOverall,
      seedBest,
      overallBest: after.endless.overallBestDistance,
      improvedSeed: seedBest > (prevSeed ?? -1) && after !== before,
      improvedOverall: after.endless.overallBestDistance > prevOverall,
      book: after,
      persisted,
    };
  }
}

/** window.localStorage if reachable (accessing it can throw in some browsers). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
