import { describe, expect, it } from 'vitest';
import { emptyScoreBook, recordLevelResult } from '../../src/model/score';
import { parseScoreBook } from '../../src/model/validate';
import { buildResults } from '../../src/ui/resultsModel';
import { SCORE_BACKUP_KEY, SCORE_STORAGE_KEY, ScoreStore, type StoreNotice } from '../../src/ui/scoreStore';

class FakeStorage {
  data = new Map<string, string>();
  throwGet = false;
  throwSet = false;
  getItem(k: string) {
    if (this.throwGet) throw new Error('SecurityError');
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.throwSet) throw new Error('QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

function setup(raw?: string) {
  const storage = new FakeStorage();
  if (raw !== undefined) storage.data.set(SCORE_STORAGE_KEY, raw);
  const notices: StoreNotice[] = [];
  const store = new ScoreStore(storage, (n) => notices.push(n));
  return { storage, notices, store };
}

describe('ScoreStore load / corruption recovery', () => {
  it('empty storage -> empty book, no notice', () => {
    const { store, notices } = setup();
    expect(store.load()).toEqual(emptyScoreBook());
    expect(notices).toEqual([]);
  });

  it('round-trips a valid book', () => {
    const book = recordLevelResult(emptyScoreBook(), 'beach', 20, 12);
    const { store } = setup(JSON.stringify(book));
    expect(store.load()).toEqual(book);
    expect(store.levelBest('beach')?.bestRating).toBe(book.levels[0]!.bestRating);
  });

  it.each([
    ['invalid JSON', '{"version":1,"levels":['],
    ['schema error', JSON.stringify({ version: 1, levels: [{ levelId: 'beach', bestRating: 300 }] })],
    ['not an object', '42'],
    ['missing version', JSON.stringify({ levels: [] })],
  ])('%s: discards with a notice, backs up the raw text, and keeps working', (_label, raw) => {
    const { store, storage, notices } = setup(raw);
    expect(store.load()).toEqual(emptyScoreBook());
    expect(notices.map((n) => n.kind)).toEqual(['discarded']);
    expect(storage.data.has(SCORE_STORAGE_KEY)).toBe(false);
    expect(storage.data.get(SCORE_BACKUP_KEY)).toBe(raw);
    // Recovered: second load is clean, and saving works again.
    expect(store.load()).toEqual(emptyScoreBook());
    expect(notices).toHaveLength(1);
    const r = store.recordLevel('beach', 20, 15);
    expect(r.improved).toBe(true);
    const saved = parseScoreBook(storage.data.get(SCORE_STORAGE_KEY)!);
    expect(saved.ok && saved.value.levels[0]?.levelId).toBe('beach');
  });

  it('future-versioned data is never overwritten (read-only session)', () => {
    const raw = JSON.stringify({ version: 99, levels: [{ fancy: true }] });
    const { store, storage, notices } = setup(raw);
    expect(store.load()).toEqual(emptyScoreBook());
    expect(store.isReadOnly).toBe(true);
    const r = store.recordLevel('beach', 10, 15);
    expect(r.improved).toBe(true);
    expect(storage.data.get(SCORE_STORAGE_KEY)).toBe(raw);
    store.load();
    expect(notices.map((n) => n.kind)).toEqual(['newerVersion']);
  });

  it('storage that throws on read -> in-memory session, one notice', () => {
    const { store, storage, notices } = setup();
    storage.throwGet = true;
    expect(store.load()).toEqual(emptyScoreBook());
    store.recordLevel('beach', 20, 10);
    expect(store.levelBest('beach')?.delivered).toBe(10);
    store.load();
    expect(notices.map((n) => n.kind)).toEqual(['unavailable']);
  });

  it('quota error on save keeps the result in memory for the session', () => {
    const { store, storage, notices } = setup();
    storage.throwSet = true;
    const r = store.recordLevel('beach', 20, 10);
    expect(r.improved).toBe(true);
    expect(store.levelBest('beach')?.delivered).toBe(10);
    expect(notices.map((n) => n.kind)).toEqual(['saveFailed']);
  });

  it('null storage works in memory', () => {
    const notices: StoreNotice[] = [];
    const store = new ScoreStore(null, (n) => notices.push(n));
    store.recordEndless('ABC', 50);
    expect(store.endlessSeedBest('ABC')?.bestDistance).toBe(50);
    expect(notices.map((n) => n.kind)).toEqual(['unavailable']);
  });

  it('non-finite results are refused with a notice, not thrown', () => {
    const { store, notices } = setup();
    const r = store.recordLevel('beach', NaN, 10);
    expect(r.improved).toBe(false);
    expect(notices.map((n) => n.kind)).toEqual(['badResult']);
  });
});

describe('ScoreStore records via model/score', () => {
  it('level: only improvements are saved; previous best reported', () => {
    const { store } = setup();
    const a = store.recordLevel('beach', 25, 11); // 66
    expect(a).toMatchObject({ improved: true, previous: undefined });
    const b = store.recordLevel('beach', 40, 5); // worse
    expect(b.improved).toBe(false);
    expect(b.best?.bestRating).toBe(66);
    const c = store.recordLevel('beach', 12, 15); // 100
    expect(c.improved).toBe(true);
    expect(c.previous?.bestRating).toBe(66);
  });

  it('endless: best per seed and overall', () => {
    const { store } = setup();
    const a = store.recordEndless('AAA', 100);
    expect(a).toMatchObject({ improvedSeed: true, improvedOverall: true, seedBest: 100, overallBest: 100 });
    const b = store.recordEndless('BBB', 60);
    expect(b).toMatchObject({ improvedSeed: true, improvedOverall: false, seedBest: 60, overallBest: 100 });
    const c = store.recordEndless('AAA', 80);
    expect(c).toMatchObject({ improvedSeed: false, seedBest: 100, previousSeedBest: 100 });
  });
});

describe('buildResults', () => {
  it('level goal: rating, save, next course unlocks', () => {
    const { store } = setup();
    const m = buildResults({ levelId: 'beach', outcome: { type: 'goalReached', simTime: 25, delivered: 11 } }, store);
    expect(m.kind).toBe('level');
    if (m.kind !== 'level') return;
    expect(m).toMatchObject({ gaveUp: false, delivered: 11, newBest: true, saved: true, nextUnlocked: true, courseName: 'Beach Run' });
    expect(m.rating).toMatchObject({ rating: 66, band: 'yellow' });
    expect(m.next?.levelId).toBe('kitchen');
  });

  it('level give-up: rating 0, nothing saved', () => {
    const { store, storage } = setup();
    const m = buildResults({ levelId: 'beach', outcome: { type: 'gaveUp', simTime: 30 } }, store);
    expect(m).toMatchObject({ kind: 'level', gaveUp: true, newBest: false, saved: false, nextUnlocked: false });
    expect(storage.data.has(SCORE_STORAGE_KEY)).toBe(false);
  });

  it('level allLost (S6T #16): unscored like a give-up, but flagged so the screen says why', () => {
    const { store, storage } = setup();
    const m = buildResults({ levelId: 'beach', outcome: { type: 'allLost', simTime: 30 } }, store);
    expect(m).toMatchObject({ kind: 'level', gaveUp: true, allLost: true, delivered: 0, saved: false, nextUnlocked: false });
    expect(storage.data.has(SCORE_STORAGE_KEY)).toBe(false);
    const g = buildResults({ levelId: 'beach', outcome: { type: 'gaveUp', simTime: 30 } }, store);
    expect(g).toMatchObject({ allLost: false });
  });

  it('0 delivered does not unlock the next course', () => {
    const { store } = setup();
    const m = buildResults({ levelId: 'beach', outcome: { type: 'goalReached', simTime: 20, delivered: 0 } }, store);
    expect(m).toMatchObject({ kind: 'level', nextUnlocked: false });
  });

  it('endless: carry bonus shown from real aboard count however the run ended; best is raw distance', () => {
    const { store } = setup();
    // allLost-style end (remaining 0) but telemetry reports what is really aboard
    const lost = buildResults(
      { levelId: 'endless:PINE', outcome: { type: 'pineappleLost', simTime: 90, pineappleId: 1, remaining: 0 }, endless: { furthestMetres: 250, aboard: 0 } },
      store,
    );
    expect(lost).toMatchObject({ kind: 'endless', seed: 'PINE', seedBest: 250, overallBest: 250, newSeedBest: true, newOverallBest: true, saved: true });
    if (lost.kind === 'endless') expect(lost.view).toMatchObject({ aboard: 0, bonus: 0, score: 250 });
    // a non-give-up end with pineapples aboard still shows the bonus
    const other = buildResults(
      { levelId: 'endless:PINE', outcome: { type: 'goalReached', simTime: 60, delivered: 3 }, endless: { furthestMetres: 200, aboard: 3 } },
      store,
    );
    if (other.kind === 'endless') expect(other.view).toMatchObject({ aboard: 3, bonus: 12, score: 212 });
    // bonus never lifts a best: 240 m with 15 aboard (score 312) is not a new best over 250 m
    const gave = buildResults({ levelId: 'endless:PINE', outcome: { type: 'gaveUp', simTime: 30 }, endless: { furthestMetres: 240, aboard: 15 } }, store);
    expect(gave).toMatchObject({ kind: 'endless', gaveUp: true, seedBest: 250, overallBest: 250, newSeedBest: false, newOverallBest: false });
    if (gave.kind === 'endless') {
      expect(gave.view.aboard).toBe(15);
      expect(gave.view.score).toBeGreaterThan(250);
    }
  });

  describe('saved is true only when the write hit storage', () => {
    it('quota failure -> saved false (level and endless)', () => {
      const { store, storage, notices } = setup();
      storage.throwSet = true;
      const lvl = buildResults({ levelId: 'beach', outcome: { type: 'goalReached', simTime: 25, delivered: 11 } }, store);
      expect(lvl).toMatchObject({ kind: 'level', newBest: true, saved: false });
      const end = buildResults({ levelId: 'endless:Q', outcome: { type: 'gaveUp', simTime: 5 }, endless: { furthestMetres: 80, aboard: 2 } }, store);
      expect(end).toMatchObject({ kind: 'endless', newSeedBest: true, saved: false });
      expect(notices.map((n) => n.kind)).toContain('saveFailed');
      // storage recovers, but this session stays in memory: still not claimed saved
      storage.throwSet = false;
      const again = buildResults({ levelId: 'beach', outcome: { type: 'goalReached', simTime: 12, delivered: 15 } }, store);
      expect(again).toMatchObject({ newBest: true, saved: false });
    });

    it('null storage -> saved false', () => {
      const store = new ScoreStore(null);
      const lvl = buildResults({ levelId: 'beach', outcome: { type: 'goalReached', simTime: 25, delivered: 11 } }, store);
      expect(lvl).toMatchObject({ kind: 'level', newBest: true, saved: false });
      const end = buildResults({ levelId: 'endless:N', outcome: { type: 'gaveUp', simTime: 5 }, endless: { furthestMetres: 80, aboard: 2 } }, store);
      expect(end).toMatchObject({ kind: 'endless', saved: false });
    });

    it('getItem throws (storage disabled) -> saved false', () => {
      const { store, storage } = setup();
      storage.throwGet = true;
      const lvl = buildResults({ levelId: 'beach', outcome: { type: 'goalReached', simTime: 25, delivered: 11 } }, store);
      expect(lvl).toMatchObject({ saved: false });
    });

    it('read-only (future version on disk) -> saved false, disk untouched', () => {
      const raw = JSON.stringify({ version: 99, levels: [] });
      const { store, storage } = setup(raw);
      const lvl = buildResults({ levelId: 'beach', outcome: { type: 'goalReached', simTime: 25, delivered: 11 } }, store);
      expect(lvl).toMatchObject({ saved: false });
      expect(storage.data.get(SCORE_STORAGE_KEY)).toBe(raw);
    });

    it('no improvement on healthy storage -> saved true (best already stored)', () => {
      const { store } = setup();
      buildResults({ levelId: 'beach', outcome: { type: 'goalReached', simTime: 12, delivered: 15 } }, store);
      const worse = buildResults({ levelId: 'beach', outcome: { type: 'goalReached', simTime: 40, delivered: 5 } }, store);
      expect(worse).toMatchObject({ newBest: false, saved: true });
    });
  });
});
