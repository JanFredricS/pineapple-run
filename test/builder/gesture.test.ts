import { describe, expect, it } from 'vitest';
import { GESTURE_GRACE_MS } from '../../src/builder/constants';
import { GestureMachine, stepGesture, initialGestureState, type GestureEffect, type GestureEvent } from '../../src/builder/gesture';

const P = (x: number, y: number) => ({ x, y });
const down = (pointerId: number, x: number, y: number, time: number, button = 0): GestureEvent => ({ type: 'down', pointerId, pos: P(x, y), time, button });
const move = (pointerId: number, x: number, y: number, time = 0): GestureEvent => ({ type: 'move', pointerId, pos: P(x, y), time });
const up = (pointerId: number, x: number, y: number, time = 0): GestureEvent => ({ type: 'up', pointerId, pos: P(x, y), time });

function run(events: GestureEvent[]) {
  const m = new GestureMachine();
  const effects: GestureEffect[] = [];
  for (const e of events) effects.push(...m.send(e));
  return { m, effects, types: effects.map((e) => e.type) };
}

describe('gesture state machine — single pointer', () => {
  it('draws a stroke: start, updates, commit on release', () => {
    const { m, effects, types } = run([down(1, 10, 10, 0), move(1, 20, 10), move(1, 30, 15), up(1, 31, 16, 500)]);
    expect(types).toEqual(['strokeStart', 'strokeUpdate', 'strokeUpdate', 'strokeCommit']);
    expect(effects.at(-1)).toEqual({ type: 'strokeCommit', start: P(10, 10), pos: P(31, 16) });
    expect(m.state.name).toBe('idle');
  });

  it('ignores moves of pointers it is not tracking', () => {
    const { types } = run([move(9, 1, 1), down(1, 0, 0, 0), move(9, 5, 5), up(1, 1, 1)]);
    expect(types).toEqual(['strokeStart', 'strokeCommit']);
  });

  it('pointercancel on the drawing pointer cancels without committing', () => {
    const { m, types } = run([down(1, 0, 0, 0), move(1, 50, 0), { type: 'cancel', pointerId: 1 }, up(1, 60, 0)]);
    expect(types).toEqual(['strokeStart', 'strokeUpdate', 'strokeCancel']);
    expect(m.state.name).toBe('idle');
  });

  it('reset (blur / visibility / phase change) cancels the stroke and clears all state', () => {
    const { m, types } = run([down(1, 0, 0, 0), move(1, 50, 0), { type: 'reset' }, move(1, 70, 0), up(1, 80, 0)]);
    expect(types).toEqual(['strokeStart', 'strokeUpdate', 'strokeCancel']);
    expect(m.state).toEqual({ name: 'idle' });
  });

  it('reset while idle, pinching or panning emits nothing and returns to idle', () => {
    expect(stepGesture(initialGestureState, { type: 'reset' }).effects).toEqual([]);
    const pinch = run([down(1, 0, 0, 0), down(2, 100, 0, 50)]).m.state;
    expect(pinch.name).toBe('pinch');
    expect(stepGesture(pinch, { type: 'reset' })).toEqual({ state: { name: 'idle' }, effects: [] });
  });

  it('secondary mouse buttons pan instead of drawing', () => {
    const { effects, types, m } = run([down(1, 100, 100, 0, 1), move(1, 110, 90), up(1, 110, 90)]);
    expect(types).toEqual(['view']);
    expect(effects[0]).toEqual({ type: 'view', factor: 1, from: P(100, 100), to: P(110, 90) });
    expect(m.state.name).toBe('idle');
  });
});

describe('gesture state machine — second pointer', () => {
  it('a second pointer within the grace window cancels the draw and becomes a pinch (no commit)', () => {
    const { types, m } = run([
      down(1, 100, 100, 1000),
      move(1, 105, 100),
      down(2, 200, 100, 1000 + GESTURE_GRACE_MS),
      up(1, 105, 100),
      up(2, 200, 100),
    ]);
    expect(types).toEqual(['strokeStart', 'strokeUpdate', 'strokeCancel']);
    expect(types).not.toContain('strokeCommit');
    expect(m.state.name).toBe('idle');
  });

  it('pinch emits zoom factor = distance ratio and pans with the midpoint', () => {
    const { effects } = run([down(1, 100, 100, 0), down(2, 200, 100, 10), move(2, 300, 100)]);
    const view = effects.filter((e) => e.type === 'view');
    expect(view).toHaveLength(1);
    expect(view[0]).toEqual({ type: 'view', factor: 2, from: P(150, 100), to: P(200, 100) });
  });

  it('pinch updates are incremental (each relative to the previous positions)', () => {
    const { effects } = run([down(1, 0, 0, 0), down(2, 100, 0, 10), move(2, 200, 0), move(1, -100, 0)]);
    const view = effects.filter((e) => e.type === 'view') as Extract<GestureEffect, { type: 'view' }>[];
    expect(view.map((v) => v.factor)).toEqual([2, 1.5]);
  });

  it('after a pinch, the remaining finger never starts a stroke until all pointers are up', () => {
    const { types, m } = run([
      down(1, 0, 0, 0),
      down(2, 100, 0, 10),
      up(2, 100, 0),
      move(1, 50, 50),
      up(1, 50, 50),
      // a fresh single touch afterwards draws again
      down(3, 0, 0, 5000),
      up(3, 40, 0),
    ]);
    expect(types).toEqual(['strokeStart', 'strokeCancel', 'strokeStart', 'strokeCommit']);
    expect(m.state.name).toBe('idle');
  });

  it('new pointers landing while ignoring are also ignored', () => {
    const { types, m } = run([down(1, 0, 0, 0), down(2, 100, 0, 10), up(1, 0, 0), down(3, 5, 5, 100), up(2, 0, 0), up(3, 9, 9)]);
    expect(types).toEqual(['strokeStart', 'strokeCancel']);
    expect(m.state.name).toBe('idle');
  });

  it('a second pointer after the grace window is ignored; the stroke continues and commits', () => {
    const { types, effects } = run([
      down(1, 0, 0, 0),
      move(1, 20, 0),
      down(2, 100, 100, GESTURE_GRACE_MS + 1),
      move(2, 150, 100),
      up(2, 150, 100),
      move(1, 40, 0),
      up(1, 40, 0),
    ]);
    expect(types).toEqual(['strokeStart', 'strokeUpdate', 'strokeUpdate', 'strokeCommit']);
    expect(effects.at(-1)).toEqual({ type: 'strokeCommit', start: P(0, 0), pos: P(40, 0) });
  });

  it('ignored pointer still held when the stroke ends: state waits for it before drawing again', () => {
    const { types, m } = run([down(1, 0, 0, 0), down(2, 50, 50, 1000), up(1, 10, 0), down(3, 0, 0, 1100)]);
    expect(types).toEqual(['strokeStart', 'strokeCommit']);
    expect(m.state).toEqual({ name: 'ignoring', pointers: [2, 3] });
  });

  it('third pointer during a pinch is ignored; lifting it keeps the pinch', () => {
    const { m } = run([down(1, 0, 0, 0), down(2, 100, 0, 10), down(3, 50, 50, 20), up(3, 50, 50)]);
    expect(m.state.name).toBe('pinch');
  });

  it('pointercancel of a pinch pointer ends the pinch', () => {
    const { m } = run([down(1, 0, 0, 0), down(2, 100, 0, 10), { type: 'cancel', pointerId: 2 }]);
    expect(m.state).toEqual({ name: 'ignoring', pointers: [1] });
  });

  it('duplicate pointerdown for the drawing pointer is ignored', () => {
    const { types, m } = run([down(1, 0, 0, 0), down(1, 5, 5, 10)]);
    expect(types).toEqual(['strokeStart']);
    expect(m.state.name).toBe('stroke');
  });
});
