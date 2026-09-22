import { describe, expect, it } from 'vitest';
import { transition, type AppState } from '../src/app';

describe('app state machine', () => {
  it('title -> build -> run -> results -> build', () => {
    let s: AppState = { name: 'title' };
    s = transition(s, { type: 'play' });
    expect(s).toEqual({ name: 'build' });
    s = transition(s, { type: 'startRun' });
    expect(s).toEqual({ name: 'run' });
    const outcome = { type: 'goalReached', simTime: 42, delivered: 12 } as const;
    s = transition(s, { type: 'runEnded', outcome });
    expect(s).toEqual({ name: 'results', outcome });
    s = transition(s, { type: 'backToBuild' });
    expect(s).toEqual({ name: 'build' });
  });

  it('ignores actions that do not apply to the current state', () => {
    const run: AppState = { name: 'run' };
    expect(transition(run, { type: 'play' })).toBe(run);
    const title: AppState = { name: 'title' };
    expect(transition(title, { type: 'startRun' })).toBe(title);
  });

  it('results can retry the run or go to title', () => {
    const r: AppState = { name: 'results', outcome: null };
    expect(transition(r, { type: 'startRun' })).toEqual({ name: 'run' });
    expect(transition(r, { type: 'toTitle' })).toEqual({ name: 'title' });
  });
});
