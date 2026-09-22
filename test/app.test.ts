import { describe, expect, it } from 'vitest';
import { transition, type AppState } from '../src/app';

describe('app state machine', () => {
  it('title -> select -> build -> run -> results -> build', () => {
    let s: AppState = { name: 'title' };
    s = transition(s, { type: 'play' });
    expect(s).toEqual({ name: 'select' });
    s = transition(s, { type: 'selectLevel', levelId: 'beach-1' });
    expect(s).toEqual({ name: 'build', levelId: 'beach-1' });
    s = transition(s, { type: 'startRun' });
    expect(s).toEqual({ name: 'run', levelId: 'beach-1' });
    const outcome = { type: 'goalReached', simTime: 42, delivered: 12 } as const;
    s = transition(s, { type: 'runEnded', outcome });
    expect(s).toEqual({ name: 'results', levelId: 'beach-1', outcome });
    s = transition(s, { type: 'backToBuild' });
    expect(s).toEqual({ name: 'build', levelId: 'beach-1' });
  });

  it('ignores actions that do not apply to the current state', () => {
    const run: AppState = { name: 'run', levelId: 'x' };
    expect(transition(run, { type: 'play' })).toBe(run);
    const title: AppState = { name: 'title' };
    expect(transition(title, { type: 'startRun' })).toBe(title);
    expect(transition(title, { type: 'selectLevel', levelId: 'x' })).toBe(title);
    const select: AppState = { name: 'select' };
    expect(transition(select, { type: 'startRun' })).toBe(select);
  });

  it('results can retry, rebuild, pick another level or go to title', () => {
    const r: AppState = { name: 'results', levelId: 'x', outcome: null };
    expect(transition(r, { type: 'startRun' })).toEqual({ name: 'run', levelId: 'x' });
    expect(transition(r, { type: 'backToSelect' })).toEqual({ name: 'select' });
    expect(transition(r, { type: 'toTitle' })).toEqual({ name: 'title' });
    expect(transition({ name: 'build', levelId: 'x' }, { type: 'backToSelect' })).toEqual({ name: 'select' });
  });
});
