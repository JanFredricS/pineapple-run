import { describe, expect, it } from 'vitest';
import { transition, type AppState } from '../../src/app';
import { emptyScoreBook, recordLevelResult } from '../../src/model/score';
import { COURSES, endlessLevelId, isUnlocked, nextCourse, parseRunTarget } from '../../src/ui/catalog';
import { shouldShowRotate } from '../../src/ui/orientation';
import { buildVersionFrom } from '../../src/ui/pwa';
import { randomSeed, SEED_MAX_LENGTH, validateSeed } from '../../src/ui/seed';

describe('seed entry validation', () => {
  it('accepts and normalises', () => {
    expect(validateSeed('abc123')).toEqual({ ok: true, seed: 'ABC123' });
    expect(validateSeed('  pine-42_x ')).toEqual({ ok: true, seed: 'PINE-42_X' });
    expect(validateSeed('7')).toEqual({ ok: true, seed: '7' });
    expect(validateSeed('A'.repeat(SEED_MAX_LENGTH)).ok).toBe(true);
  });
  it('rejects empty, too long, bad characters, non-strings', () => {
    for (const bad of ['', '   ', 'A'.repeat(SEED_MAX_LENGTH + 1), 'a b', 'ÆØÅ', 'x:y', '<script>', '12.5']) {
      expect(validateSeed(bad).ok, bad).toBe(false);
    }
    expect(validateSeed(42).ok).toBe(false);
    expect(validateSeed(null).ok).toBe(false);
  });
  it('random seeds are valid and deterministic for a given rng', () => {
    const s = randomSeed(() => 0.5);
    expect(validateSeed(s)).toEqual({ ok: true, seed: s });
    expect(randomSeed(() => 0.999999)).toHaveLength(6);
    expect(validateSeed(randomSeed(() => NaN)).ok).toBe(true);
    expect(validateSeed(randomSeed()).ok).toBe(true);
  });
});

describe('run targets', () => {
  it('encodes endless as endless:<seed>', () => {
    expect(parseRunTarget(endlessLevelId('PINE42'))).toEqual({ kind: 'endless', seed: 'PINE42' });
    expect(parseRunTarget('beach')).toMatchObject({ kind: 'level', levelId: 'beach', course: { name: 'Beach Run' } });
    expect(parseRunTarget('s0-spike')).toEqual({ kind: 'level', levelId: 's0-spike', course: null });
  });
  it('an invalid or non-normalised endless seed is not guessed at', () => {
    expect(parseRunTarget('endless:')).toMatchObject({ kind: 'level' });
    expect(parseRunTarget('endless:bad seed')).toMatchObject({ kind: 'level' });
    expect(parseRunTarget('endless:lower')).toMatchObject({ kind: 'level' });
  });
});

describe('unlock rules', () => {
  const clear = (b = emptyScoreBook(), ...ids: string[]) => ids.reduce((acc, id) => recordLevelResult(acc, id, 20, 10), b);
  it('first course open; each next opens when the previous is cleared', () => {
    const empty = emptyScoreBook();
    expect(isUnlocked(empty, 'beach')).toBe(true);
    expect(isUnlocked(empty, 'kitchen')).toBe(false);
    expect(isUnlocked(clear(empty, 'beach'), 'kitchen')).toBe(true);
    expect(isUnlocked(clear(empty, 'beach'), 'workbench')).toBe(false);
  });
  it('a 0% record does not count as cleared', () => {
    const zero = recordLevelResult(emptyScoreBook(), 'beach', 20, 0);
    expect(isUnlocked(zero, 'kitchen')).toBe(false);
  });
  it('bonus course needs every campaign course', () => {
    expect(isUnlocked(clear(undefined, 'beach', 'kitchen'), 'original')).toBe(false);
    expect(isUnlocked(clear(undefined, 'beach', 'kitchen', 'workbench'), 'original')).toBe(true);
  });
  it('unknown ids are unlocked; next course follows catalog order', () => {
    expect(isUnlocked(emptyScoreBook(), 'dev-level')).toBe(true);
    expect(nextCourse('beach')?.levelId).toBe('kitchen');
    expect(nextCourse(COURSES[COURSES.length - 1]!.levelId)).toBeNull();
    expect(nextCourse('nope')).toBeNull();
  });
});

describe('app transitions added by S5', () => {
  it('runEnded carries endless stats into results', () => {
    const run: AppState = { name: 'run', levelId: 'endless:ABC' };
    const outcome = { type: 'gaveUp', simTime: 12 } as const;
    const s = transition(run, { type: 'runEnded', outcome, endless: { furthestMetres: 80, aboard: 3 } });
    expect(s).toEqual({ name: 'results', levelId: 'endless:ABC', outcome, endless: { furthestMetres: 80, aboard: 3 } });
    expect('endless' in transition(run, { type: 'runEnded', outcome })).toBe(false);
  });
  it('results -> next level / new seed goes straight to build', () => {
    const r: AppState = { name: 'results', levelId: 'beach', outcome: null };
    expect(transition(r, { type: 'selectLevel', levelId: 'kitchen' })).toEqual({ name: 'build', levelId: 'kitchen' });
  });
  it('full loop: title -> select -> build -> run -> results -> retry', () => {
    let s: AppState = { name: 'title' };
    s = transition(s, { type: 'play' });
    s = transition(s, { type: 'selectLevel', levelId: endlessLevelId('Z9') });
    s = transition(s, { type: 'startRun' });
    s = transition(s, { type: 'runEnded', outcome: { type: 'pineappleLost', simTime: 5, pineappleId: 1, remaining: 0 }, endless: { furthestMetres: 9, aboard: 0 } });
    expect(s.name).toBe('results');
    s = transition(s, { type: 'startRun' });
    expect(s).toEqual({ name: 'run', levelId: 'endless:Z9' });
  });
});

describe('orientation + pwa helpers', () => {
  it('rotate overlay only on portrait phone-sized viewports', () => {
    expect(shouldShowRotate(390, 844)).toBe(true);
    expect(shouldShowRotate(844, 390)).toBe(false);
    expect(shouldShowRotate(800, 400)).toBe(false);
    expect(shouldShowRotate(1024, 1366)).toBe(false);
    expect(shouldShowRotate(400, 400)).toBe(false);
  });
  it('SW cache version comes from the hashed entry file name', () => {
    expect(buildVersionFrom('https://x.io/pineapple-run/assets/main-0xaiCj1A.js')).toBe('0xaiCj1A');
    expect(buildVersionFrom('https://x.io/pineapple-run/assets/index-Ab_c-12.js?v=1')).toBe('Ab_c-12');
    expect(buildVersionFrom('/src/main.ts')).toBe('dev');
    expect(buildVersionFrom(undefined)).toBe('dev');
  });
});
